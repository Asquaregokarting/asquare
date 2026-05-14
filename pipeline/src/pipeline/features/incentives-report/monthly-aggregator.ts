import type { CashierIncentiveRecord, TelecallerMonthlyPerformanceRecord } from '../../api/types'
import type { BranchSummaryRow, CashierMonthlyRow, TelecallerMonthlyRow } from './types'

const cashierKey = (locationId: string, cashierId: string) => `${locationId}::${cashierId}`

export const aggregateCashierMonth = (
  records: CashierIncentiveRecord[],
  branchNameById: Record<string, string>,
): CashierMonthlyRow[] => {
  const map = new Map<string, CashierMonthlyRow>()

  for (const rec of records) {
    if (rec.status !== 'active') continue
    const key = cashierKey(rec.locationId, rec.cashierId)
    let row = map.get(key)
    if (!row) {
      row = {
        branchId: rec.locationId,
        branchName: branchNameById[rec.locationId] ?? rec.locationId,
        cashierId: rec.cashierId,
        cashierName: rec.cashierName,
        qualifyingTxns: 0,
        totalItemAmount: 0,
        byNonPerforming: 0,
        byGokartLaps: 0,
        byBoth: 0,
        totalIncentive: 0,
      }
      map.set(key, row)
    }
    row.qualifyingTxns += 1
    row.totalItemAmount += rec.itemAmount
    row.totalIncentive += rec.incentiveAmount
    if (rec.reason === 'non_performing') row.byNonPerforming += rec.incentiveAmount
    else if (rec.reason === 'gokart_laps') row.byGokartLaps += rec.incentiveAmount
    else if (rec.reason === 'both') row.byBoth += rec.incentiveAmount
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.branchName !== b.branchName) return a.branchName.localeCompare(b.branchName)
    return a.cashierName.localeCompare(b.cashierName)
  })
}

export const mapTelecallerMonth = (
  records: TelecallerMonthlyPerformanceRecord[],
): TelecallerMonthlyRow[] =>
  records
    .map((r) => ({
      telecallerId: r.telecallerId,
      telecallerName: r.telecallerName,
      hasPlan: r.hasPlan,
      bookingCount: r.bookingCount,
      bookedAmount: r.bookedAmount,
      targetAmount: r.targetAmount,
      achievementPercent: r.achievementPercent,
      incentivePercentUsed: r.incentivePercentUsed,
      incentiveEarned: r.estimatedIncentiveTotal,
    }))
    .sort((a, b) => a.telecallerName.localeCompare(b.telecallerName))

export const buildBranchSummary = (
  cashierRows: CashierMonthlyRow[],
  _telecallerRows: TelecallerMonthlyRow[],
  branchNameById: Record<string, string>,
): BranchSummaryRow[] => {
  if (cashierRows.length === 0) return []
  const byBranch = new Map<string, BranchSummaryRow>()
  for (const r of cashierRows) {
    let entry = byBranch.get(r.branchId)
    if (!entry) {
      entry = {
        branchId: r.branchId,
        branchName: branchNameById[r.branchId] ?? r.branchName,
        cashierIncentive: 0,
        telecallerIncentive: 0,
        total: 0,
      }
      byBranch.set(r.branchId, entry)
    }
    entry.cashierIncentive += r.totalIncentive
    entry.total += r.totalIncentive
  }
  return Array.from(byBranch.values()).sort((a, b) => a.branchName.localeCompare(b.branchName))
}
