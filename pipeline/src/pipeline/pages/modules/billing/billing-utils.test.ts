import { describe, it, expect } from 'vitest'
import {
  GST_PERCENT,
  subnav,
  titleMap,
  subtitleMap,
  formatBillingCurrency,
  calculateGst,
  calculateBaseFromInclusive,
  calculateCartTotal,
  canRoleMutateBilling,
  canRoleViewHelicopter,
  canRoleMutateHelicopter,
  getSubnavForRole,
  type BillingView,
} from './billing-utils'

describe('billing constants', () => {
  it('GST_PERCENT is 18', () => {
    expect(GST_PERCENT).toBe(18)
  })

  it('subnav has 7 items', () => {
    expect(subnav).toHaveLength(7)
  })

  it('all views have titles', () => {
    const views: BillingView[] = [
      'pos',
      'transactions',
      'invoice',
      'reprint',
      'refunds',
      'revenue',
      'report',
      'helicopter',
    ]
    for (const v of views) {
      expect(titleMap[v]).toBeTruthy()
      expect(subtitleMap[v]).toBeTruthy()
    }
  })
})

describe('formatBillingCurrency', () => {
  it('formats with INR prefix and Indian grouping', () => {
    expect(formatBillingCurrency(125000)).toBe('INR 1,25,000')
  })

  it('rounds to nearest integer', () => {
    expect(formatBillingCurrency(99.7)).toBe('INR 100')
  })

  it('handles zero', () => {
    expect(formatBillingCurrency(0)).toBe('INR 0')
  })
})

describe('calculateGst', () => {
  it('calculates 18% GST by default', () => {
    expect(calculateGst(1000)).toBe(180)
  })

  it('supports custom GST percentage', () => {
    expect(calculateGst(1000, 5)).toBe(50)
  })

  it('rounds to nearest integer', () => {
    expect(calculateGst(999)).toBe(180) // 999 * 0.18 = 179.82 → 180
  })

  it('handles zero', () => {
    expect(calculateGst(0)).toBe(0)
  })
})

describe('calculateBaseFromInclusive', () => {
  it('extracts base from 18% inclusive amount', () => {
    expect(calculateBaseFromInclusive(1180)).toBe(1000)
  })

  it('handles custom GST', () => {
    expect(calculateBaseFromInclusive(1050, 5)).toBe(1000)
  })

  it('rounds correctly', () => {
    const base = calculateBaseFromInclusive(999)
    expect(base + calculateGst(base)).toBeCloseTo(999, 0)
  })
})

describe('calculateCartTotal', () => {
  it('calculates subtotal - discount + GST', () => {
    const result = calculateCartTotal(1000, 100)
    expect(result.baseAmount).toBe(900)
    expect(result.gstAmount).toBe(162) // 900 * 0.18
    expect(result.total).toBe(1062)
  })

  it('handles zero discount', () => {
    const result = calculateCartTotal(500, 0)
    expect(result.baseAmount).toBe(500)
    expect(result.gstAmount).toBe(90)
    expect(result.total).toBe(590)
  })

  it('clamps negative base to zero', () => {
    const result = calculateCartTotal(100, 200)
    expect(result.baseAmount).toBe(0)
    expect(result.gstAmount).toBe(0)
    expect(result.total).toBe(0)
  })

  it('supports custom GST', () => {
    const result = calculateCartTotal(1000, 0, 5)
    expect(result.gstAmount).toBe(50)
    expect(result.total).toBe(1050)
  })

  it('total = baseAmount + gstAmount always', () => {
    const result = calculateCartTotal(777, 50, 18)
    expect(result.total).toBe(result.baseAmount + result.gstAmount)
  })
})

describe('role checks', () => {
  it('Cashier can mutate billing', () => {
    expect(canRoleMutateBilling('Cashier')).toBe(true)
  })

  it('Admin can mutate billing', () => {
    expect(canRoleMutateBilling('Admin')).toBe(true)
  })

  it('Telecaller cannot mutate billing', () => {
    expect(canRoleMutateBilling('Telecaller')).toBe(false)
  })

  it('Owner can view helicopter', () => {
    expect(canRoleViewHelicopter('Owner')).toBe(true)
  })

  it('Cashier cannot view helicopter', () => {
    expect(canRoleViewHelicopter('Cashier')).toBe(false)
  })

  it('Owner can mutate helicopter', () => {
    expect(canRoleMutateHelicopter('Owner')).toBe(true)
  })

  it('Developer cannot mutate helicopter', () => {
    expect(canRoleMutateHelicopter('Developer')).toBe(false)
  })
})

describe('getSubnavForRole', () => {
  it('Owner sees all 7 items', () => {
    expect(getSubnavForRole('Owner')).toHaveLength(7)
  })

  it('Cashier does not see helicopter', () => {
    const items = getSubnavForRole('Cashier')
    expect(items.find((i) => i.to.includes('helicopter'))).toBeUndefined()
  })

  it('Cashier does not see revenue', () => {
    const items = getSubnavForRole('Cashier')
    expect(items.find((i) => i.to.includes('revenue'))).toBeUndefined()
  })

  it('Admin sees all 7 items', () => {
    expect(getSubnavForRole('Admin')).toHaveLength(7)
  })
})
