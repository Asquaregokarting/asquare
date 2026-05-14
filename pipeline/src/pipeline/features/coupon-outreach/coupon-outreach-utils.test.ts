import { describe, expect, it } from 'vitest'
import {
  computeAvailableCoupons,
  computeCustomerValueTier,
  computeKpis,
  DEFAULT_VALUE_THRESHOLDS,
  formatRupees,
  relativeDateLabel,
  roundRobinPartition,
  sortInboxItems,
} from './coupon-outreach-utils'
import type { CouponOutreachItem } from '../../api/coupon-outreach'

const item = (
  overrides: Partial<CouponOutreachItem> & {
    phone: string
    status: CouponOutreachItem['status']
  },
): CouponOutreachItem => ({
  phone: overrides.phone,
  name: overrides.name ?? 'Test',
  email: overrides.email ?? '',
  assignedTo: overrides.assignedTo ?? 'u1',
  assignedAt: overrides.assignedAt ?? '2026-04-08T05:00:00.000Z',
  assignedBy: overrides.assignedBy ?? 'cron',
  status: overrides.status,
  snapshot: {
    totalVisits: 0,
    totalBillAmount: 0,
    coupons150Redeemed: 0,
    coupons150Available: 1,
    membership: 'Silver',
    starStatus: '0',
    lastVisitDate: null,
    lastVisitLocation: null,
    customerValueTier: 'low',
    ...(overrides.snapshot ?? {}),
  },
  createdAt: overrides.createdAt ?? '2026-04-08T05:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-04-08T05:00:00.000Z',
})

describe('computeAvailableCoupons', () => {
  it('returns 0 when spend is below the earn threshold', () => {
    expect(computeAvailableCoupons(599, 0)).toBe(0)
    expect(computeAvailableCoupons(0, 0)).toBe(0)
  })
  it('returns 1 when spend is exactly the earn threshold', () => {
    expect(computeAvailableCoupons(600, 0)).toBe(1)
  })
  it('subtracts redeemed from earned', () => {
    expect(computeAvailableCoupons(1800, 1)).toBe(2)
    expect(computeAvailableCoupons(1800, 3)).toBe(0)
  })
  it('clamps negative inputs to 0', () => {
    expect(computeAvailableCoupons(-500, -2)).toBe(0)
  })
})

describe('computeCustomerValueTier', () => {
  it('classifies high tier on spend OR visits', () => {
    expect(computeCustomerValueTier(15000, 1)).toBe('high')
    expect(computeCustomerValueTier(2000, 12)).toBe('high')
  })
  it('classifies mid tier on spend only', () => {
    expect(computeCustomerValueTier(5000, 2)).toBe('mid')
  })
  it('classifies low tier when below all thresholds', () => {
    expect(computeCustomerValueTier(1000, 1)).toBe('low')
  })
  it('respects custom thresholds', () => {
    const t = { tierHighSpend: 1000, tierHighVisits: 2, tierMidSpend: 500 }
    expect(computeCustomerValueTier(800, 1, t)).toBe('mid')
    expect(computeCustomerValueTier(800, 3, t)).toBe('high')
  })
  it('defaults match documented constants', () => {
    expect(DEFAULT_VALUE_THRESHOLDS.tierHighSpend).toBe(10000)
    expect(DEFAULT_VALUE_THRESHOLDS.tierMidSpend).toBe(3000)
  })
})

describe('roundRobinPartition', () => {
  it('returns an empty map when there are no owners', () => {
    const result = roundRobinPartition([1, 2, 3], [])
    expect(result.size).toBe(0)
  })
  it('distributes evenly when items divide cleanly', () => {
    const result = roundRobinPartition([1, 2, 3, 4], ['a', 'b'])
    expect(result.get('a')).toEqual([1, 3])
    expect(result.get('b')).toEqual([2, 4])
  })
  it('never differs by more than 1 across owners', () => {
    const result = roundRobinPartition([1, 2, 3, 4, 5], ['a', 'b', 'c'])
    const sizes = Array.from(result.values()).map((l) => l.length)
    const max = Math.max(...sizes)
    const min = Math.min(...sizes)
    expect(max - min).toBeLessThanOrEqual(1)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(5)
  })
  it('preserves item order within owner buckets', () => {
    const result = roundRobinPartition(['a', 'b', 'c', 'd', 'e'], ['x', 'y'])
    expect(result.get('x')).toEqual(['a', 'c', 'e'])
    expect(result.get('y')).toEqual(['b', 'd'])
  })
})

describe('formatRupees', () => {
  it('renders Indian comma grouping with rupee sign', () => {
    expect(formatRupees(1234567)).toBe('₹12,34,567')
    expect(formatRupees(0)).toBe('₹0')
  })
})

describe('relativeDateLabel', () => {
  it('returns em dash for null/invalid input', () => {
    expect(relativeDateLabel(null)).toBe('—')
    expect(relativeDateLabel('not-a-date')).toBe('—')
  })
  it("returns 'today' when the date is now", () => {
    expect(relativeDateLabel(new Date().toISOString())).toBe('today')
  })
})

describe('sortInboxItems', () => {
  it('orders pending items above contacted and done', () => {
    const items = [
      item({ phone: '1', status: 'done' }),
      item({ phone: '2', status: 'pending' }),
      item({ phone: '3', status: 'contacted' }),
    ]
    const sorted = sortInboxItems(items)
    expect(sorted.map((i) => i.phone)).toEqual(['2', '3', '1'])
  })
  it('ranks high-tier items above mid- and low-tier within the same status', () => {
    const items = [
      item({
        phone: '1',
        status: 'pending',
        snapshot: {
          totalVisits: 0,
          totalBillAmount: 0,
          coupons150Redeemed: 0,
          coupons150Available: 1,
          membership: 'Silver',
          starStatus: '0',
          lastVisitDate: null,
          lastVisitLocation: null,
          customerValueTier: 'low',
        },
      }),
      item({
        phone: '2',
        status: 'pending',
        snapshot: {
          totalVisits: 0,
          totalBillAmount: 0,
          coupons150Redeemed: 0,
          coupons150Available: 5,
          membership: 'Silver',
          starStatus: '0',
          lastVisitDate: null,
          lastVisitLocation: null,
          customerValueTier: 'high',
        },
      }),
    ]
    const sorted = sortInboxItems(items)
    expect(sorted[0].phone).toBe('2')
  })
})

describe('computeKpis', () => {
  it('counts each status bucket', () => {
    const items = [
      item({ phone: '1', status: 'pending' }),
      item({ phone: '2', status: 'pending' }),
      item({ phone: '3', status: 'contacted' }),
      item({ phone: '4', status: 'done' }),
      item({ phone: '5', status: 'skipped' }),
    ]
    expect(computeKpis(items)).toEqual({
      pending: 2,
      contacted: 1,
      done: 1,
      skipped: 1,
    })
  })
})
