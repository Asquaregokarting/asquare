import { describe, it, expect } from 'vitest'
import { aggregateCashierMonth, buildBranchSummary, mapTelecallerMonth } from './monthly-aggregator'
import type { CashierIncentiveRecord, TelecallerMonthlyPerformanceRecord } from '../../api/types'

const branchNames: Record<string, string> = {
  '0': 'Vizag',
  '1': 'Kakinada',
}

const baseCashierRec = (overrides: Partial<CashierIncentiveRecord>): CashierIncentiveRecord =>
  ({
    id: 'r1',
    bookingId: 'b1',
    invoiceNumber: 'INV-1',
    locationId: '0',
    cashierId: 'C1',
    cashierName: 'Alice',
    itemIndex: 0,
    itemName: 'Bowling',
    gameId: 'g1',
    subGameId: 'sg1',
    variantId: 'v1',
    itemAmount: 1000,
    incentivePercent: 2,
    incentiveAmount: 20,
    reason: 'non_performing',
    laps: null,
    weeklyRevenue: null,
    threshold: null,
    weekKey: '2026-W18',
    isComboItem: false,
    comboName: null,
    status: 'active',
    reversedAt: null,
    reversedReason: null,
    createdAt: '2026-05-01T10:00:00Z',
    transactionDate: '2026-05-01',
    ...overrides,
  }) as CashierIncentiveRecord

const baseTcRec = (
  overrides: Partial<TelecallerMonthlyPerformanceRecord>,
): TelecallerMonthlyPerformanceRecord => ({
  telecallerId: 'T1',
  telecallerName: 'Carol',
  monthKey: '2026-05',
  hasPlan: true,
  bookingCount: 10,
  bookedAmount: 100000,
  targetAmount: 80000,
  achievementPercent: 125,
  incentivePercentUsed: 2,
  estimatedIncentiveTotal: 2000,
  ...overrides,
})

describe('aggregateCashierMonth', () => {
  it('returns empty rows when records list is empty', () => {
    expect(aggregateCashierMonth([], branchNames)).toEqual([])
  })

  it('skips reversed records', () => {
    const records = [baseCashierRec({ status: 'reversed' })]
    expect(aggregateCashierMonth(records, branchNames)).toEqual([])
  })

  it('aggregates incentive by cashier across multiple records', () => {
    const records = [
      baseCashierRec({ id: 'r1', cashierId: 'C1', incentiveAmount: 20, reason: 'non_performing' }),
      baseCashierRec({ id: 'r2', cashierId: 'C1', incentiveAmount: 30, reason: 'gokart_laps' }),
      baseCashierRec({
        id: 'r3',
        cashierId: 'C2',
        cashierName: 'Bob',
        incentiveAmount: 15,
        reason: 'both',
      }),
    ]
    const rows = aggregateCashierMonth(records, branchNames)
    expect(rows).toHaveLength(2)
    const alice = rows.find((r) => r.cashierId === 'C1')!
    expect(alice.qualifyingTxns).toBe(2)
    expect(alice.byNonPerforming).toBe(20)
    expect(alice.byGokartLaps).toBe(30)
    expect(alice.byBoth).toBe(0)
    expect(alice.totalIncentive).toBe(50)
    const bob = rows.find((r) => r.cashierId === 'C2')!
    expect(bob.byBoth).toBe(15)
    expect(bob.totalIncentive).toBe(15)
  })

  it('keeps separate rows for the same cashier across different branches', () => {
    const records = [
      baseCashierRec({ id: 'r1', cashierId: 'C1', locationId: '0', incentiveAmount: 20 }),
      baseCashierRec({ id: 'r2', cashierId: 'C1', locationId: '1', incentiveAmount: 30 }),
    ]
    const rows = aggregateCashierMonth(records, branchNames)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.branchName).sort()).toEqual(['Kakinada', 'Vizag'])
  })

  it('falls back to locationId when branch name is missing', () => {
    const records = [baseCashierRec({ locationId: '99' })]
    const rows = aggregateCashierMonth(records, branchNames)
    expect(rows[0].branchName).toBe('99')
  })

  it('sums totalItemAmount correctly', () => {
    const records = [
      baseCashierRec({ id: 'r1', cashierId: 'C1', itemAmount: 1000 }),
      baseCashierRec({ id: 'r2', cashierId: 'C1', itemAmount: 2500 }),
    ]
    const rows = aggregateCashierMonth(records, branchNames)
    expect(rows[0].totalItemAmount).toBe(3500)
  })
})

describe('mapTelecallerMonth', () => {
  it('returns empty rows for empty input', () => {
    expect(mapTelecallerMonth([])).toEqual([])
  })

  it('maps performance records to row shape', () => {
    const rows = mapTelecallerMonth([baseTcRec({})])
    expect(rows[0]).toEqual({
      telecallerId: 'T1',
      telecallerName: 'Carol',
      hasPlan: true,
      bookingCount: 10,
      bookedAmount: 100000,
      targetAmount: 80000,
      achievementPercent: 125,
      incentivePercentUsed: 2,
      incentiveEarned: 2000,
    })
  })

  it('preserves hasPlan=false', () => {
    const rows = mapTelecallerMonth([baseTcRec({ hasPlan: false, telecallerId: 'T2' })])
    expect(rows[0].hasPlan).toBe(false)
  })

  it('sorts alphabetically by name', () => {
    const rows = mapTelecallerMonth([
      baseTcRec({ telecallerId: 'T1', telecallerName: 'Zara' }),
      baseTcRec({ telecallerId: 'T2', telecallerName: 'Alex' }),
    ])
    expect(rows.map((r) => r.telecallerName)).toEqual(['Alex', 'Zara'])
  })
})

describe('buildBranchSummary', () => {
  it('returns empty array when both inputs empty', () => {
    expect(buildBranchSummary([], [], branchNames)).toEqual([])
  })

  it('aggregates per branch from cashier rows', () => {
    const cashierRows = [
      {
        branchId: '0',
        branchName: 'Vizag',
        cashierId: 'C1',
        cashierName: 'Alice',
        qualifyingTxns: 1,
        totalItemAmount: 1000,
        byNonPerforming: 20,
        byGokartLaps: 0,
        byBoth: 0,
        totalIncentive: 20,
      },
      {
        branchId: '1',
        branchName: 'Kakinada',
        cashierId: 'C2',
        cashierName: 'Bob',
        qualifyingTxns: 1,
        totalItemAmount: 2000,
        byNonPerforming: 0,
        byGokartLaps: 40,
        byBoth: 0,
        totalIncentive: 40,
      },
    ]
    const summary = buildBranchSummary(cashierRows, [], branchNames)
    expect(summary).toHaveLength(2)
    const vizag = summary.find((s) => s.branchId === '0')!
    expect(vizag.cashierIncentive).toBe(20)
    expect(vizag.telecallerIncentive).toBe(0)
    expect(vizag.total).toBe(20)
  })
})
