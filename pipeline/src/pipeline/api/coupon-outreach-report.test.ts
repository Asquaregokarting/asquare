import { describe, expect, it } from 'vitest'
import { __test__ } from './coupon-outreach-report'
import type { CouponOutreachStatus } from './coupon-outreach'

const { aggregateReport, eachDayInclusive } = __test__

const item = (phone: string, assignedTo: string, status: CouponOutreachStatus) => ({
  phone,
  assignedTo,
  status,
  createdAt: '2026-04-08T05:00:00.000Z',
})

describe('eachDayInclusive', () => {
  it('returns the single day when from === to', () => {
    expect(eachDayInclusive('2026-04-08', '2026-04-08')).toEqual(['2026-04-08'])
  })
  it('returns each day inclusive across the range', () => {
    expect(eachDayInclusive('2026-04-08', '2026-04-10')).toEqual([
      '2026-04-08',
      '2026-04-09',
      '2026-04-10',
    ])
  })
  it('returns an empty list when from > to', () => {
    expect(eachDayInclusive('2026-04-10', '2026-04-08')).toEqual([])
  })
})

describe('aggregateReport', () => {
  it('counts statuses and computes call completion', () => {
    const result = aggregateReport({
      items: [
        item('1', 'alice', 'pending'),
        item('2', 'alice', 'contacted'),
        item('3', 'alice', 'done'),
        item('4', 'bob', 'skipped'),
        item('5', 'bob', 'pending'),
      ],
      conversionsByPhone: new Map(),
    })
    expect(result.summary.totalAssigned).toBe(5)
    expect(result.summary.pending).toBe(2)
    expect(result.summary.contacted).toBe(1)
    expect(result.summary.done).toBe(1)
    expect(result.summary.skipped).toBe(1)
    expect(result.summary.callsCompleted).toBe(2) // contacted + done
    expect(result.summary.missedCalls).toBe(2) // pending
    expect(result.summary.convertedBookings).toBe(0)
    expect(result.summary.conversionRate).toBe(0)
  })

  it('attributes converted bookings + revenue per phone', () => {
    const conversions = new Map<string, Array<{ amount: number; createdAt: string }>>()
    conversions.set('1', [{ amount: 1200, createdAt: '2026-04-08T07:00:00Z' }])
    conversions.set('3', [
      { amount: 800, createdAt: '2026-04-08T11:00:00Z' },
      { amount: 200, createdAt: '2026-04-08T12:00:00Z' },
    ])

    const result = aggregateReport({
      items: [
        item('1', 'alice', 'done'),
        item('2', 'alice', 'contacted'),
        item('3', 'bob', 'done'),
        item('4', 'bob', 'pending'),
      ],
      conversionsByPhone: conversions,
    })

    expect(result.summary.convertedBookings).toBe(2)
    expect(result.revenue.totalRevenue).toBe(2200)
    expect(result.revenue.averageTicket).toBe(1100)
    // 2 / 4 = 0.5
    expect(result.summary.conversionRate).toBe(0.5)
  })

  it('buckets metrics per telecaller and sorts by revenue', () => {
    const conversions = new Map<string, Array<{ amount: number; createdAt: string }>>()
    conversions.set('1', [{ amount: 5000, createdAt: '2026-04-08T07:00:00Z' }])
    conversions.set('3', [{ amount: 1000, createdAt: '2026-04-08T07:00:00Z' }])

    const result = aggregateReport({
      items: [
        item('1', 'alice', 'done'),
        item('2', 'alice', 'pending'),
        item('3', 'bob', 'done'),
        item('4', 'bob', 'skipped'),
      ],
      conversionsByPhone: conversions,
    })

    expect(result.perTelecaller).toHaveLength(2)
    // Sorted by revenue desc — alice's 5000 > bob's 1000
    expect(result.perTelecaller[0].telecallerId).toBe('alice')
    expect(result.perTelecaller[0].revenue).toBe(5000)
    expect(result.perTelecaller[0].convertedBookings).toBe(1)
    expect(result.perTelecaller[0].assigned).toBe(2)
    expect(result.perTelecaller[0].conversionRate).toBe(0.5)

    expect(result.perTelecaller[1].telecallerId).toBe('bob')
    expect(result.perTelecaller[1].revenue).toBe(1000)
  })

  it("handles unassigned items by bucketing under '(unassigned)'", () => {
    const result = aggregateReport({
      items: [item('1', '', 'pending')],
      conversionsByPhone: new Map(),
    })
    expect(result.perTelecaller).toHaveLength(1)
    expect(result.perTelecaller[0].telecallerId).toBe('(unassigned)')
    expect(result.perTelecaller[0].assigned).toBe(1)
  })

  it('returns zero metrics when there are no items', () => {
    const result = aggregateReport({
      items: [],
      conversionsByPhone: new Map(),
    })
    expect(result.summary.totalAssigned).toBe(0)
    expect(result.summary.conversionRate).toBe(0)
    expect(result.revenue.totalRevenue).toBe(0)
    expect(result.revenue.averageTicket).toBe(0)
    expect(result.perTelecaller).toEqual([])
  })
})
