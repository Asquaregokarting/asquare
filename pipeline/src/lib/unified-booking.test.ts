import { describe, it, expect, vi } from 'vitest'

vi.mock('./firebase', () => ({ db: {} }))
vi.mock('./locations', () => ({ slugToBranchId: vi.fn((s: string) => s) }))
vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  computeGst,
  computeRevenueSplit,
  isValidStatusTransition,
  canConfirmBooking,
  generateOrderNumber,
  isValidOrderNumber,
} from './unified-booking'

describe('computeGst', () => {
  it('computes 18% GST correctly', () => {
    const r = computeGst(1180)
    expect(r.baseAmount).toBe(1000)
    expect(r.gstAmount).toBe(180)
    expect(r.gstPercent).toBe(18)
  })

  it('computes GST for zero amount', () => {
    const r = computeGst(0)
    expect(r.baseAmount).toBe(0)
    expect(r.gstAmount).toBe(0)
  })

  it('handles custom GST percentage', () => {
    const r = computeGst(1050, 5)
    expect(r.baseAmount).toBe(1000)
    expect(r.gstAmount).toBe(50)
    expect(r.gstPercent).toBe(5)
  })

  it('rounds base amount and preserves total', () => {
    const r = computeGst(999)
    expect(r.baseAmount + r.gstAmount).toBe(999)
  })

  it('handles large amounts', () => {
    const r = computeGst(118000)
    expect(r.baseAmount).toBe(100000)
    expect(r.gstAmount).toBe(18000)
  })
})

describe('computeRevenueSplit', () => {
  it('ThirdParty: vendor gets share of both base + GST', () => {
    const r = computeRevenueSplit(1000, 180, 80, 'ThirdParty')
    expect(r.vendorBase).toBe(800)
    expect(r.vendorGst).toBe(144)
    expect(r.vendorTotal).toBe(944)
    expect(r.companyBase).toBe(200)
    expect(r.companyGst).toBe(36)
    expect(r.companyTotal).toBe(236)
  })

  it('SubLease: vendor gets base share only, company gets all GST', () => {
    const r = computeRevenueSplit(1000, 180, 80, 'SubLease')
    expect(r.vendorBase).toBe(800)
    expect(r.vendorGst).toBe(0)
    expect(r.vendorTotal).toBe(800)
    expect(r.companyBase).toBe(200)
    expect(r.companyGst).toBe(180)
    expect(r.companyTotal).toBe(380)
  })

  it('defaults to ThirdParty', () => {
    const r = computeRevenueSplit(1000, 180, 80)
    expect(r.vendorGst).toBe(144)
  })

  it('handles 0% share', () => {
    const r = computeRevenueSplit(1000, 180, 0)
    expect(r.vendorTotal).toBe(0)
    expect(r.companyTotal).toBe(1180)
  })

  it('handles 100% share', () => {
    const r = computeRevenueSplit(1000, 180, 100)
    expect(r.vendorTotal).toBe(1180)
    expect(r.companyTotal).toBe(0)
  })

  it('total always sums to base + gst', () => {
    const r = computeRevenueSplit(777, 140, 65, 'ThirdParty')
    expect(r.vendorTotal + r.companyTotal).toBe(777 + 140)
  })
})

describe('isValidStatusTransition', () => {
  it('allows same-status (identity)', () => {
    expect(isValidStatusTransition('confirmed', 'confirmed')).toBe(true)
  })
  it('allows pending → confirmed', () => {
    expect(isValidStatusTransition('pending', 'confirmed')).toBe(true)
  })
  it('allows pending → cancelled', () => {
    expect(isValidStatusTransition('pending', 'cancelled')).toBe(true)
  })
  it('allows confirmed → completed', () => {
    expect(isValidStatusTransition('confirmed', 'completed')).toBe(true)
  })
  it('allows confirmed → cancelled', () => {
    expect(isValidStatusTransition('confirmed', 'cancelled')).toBe(true)
  })
  it('allows confirmed → rescheduled', () => {
    expect(isValidStatusTransition('confirmed', 'rescheduled')).toBe(true)
  })
  it('allows completed → cancelled', () => {
    expect(isValidStatusTransition('completed', 'cancelled')).toBe(true)
  })
  it('allows cancelled → confirmed (admin reactivation)', () => {
    expect(isValidStatusTransition('cancelled', 'confirmed')).toBe(true)
  })
  it('allows cancelled → pending (admin reactivation)', () => {
    expect(isValidStatusTransition('cancelled', 'pending')).toBe(true)
  })
  it('blocks pending → completed', () => {
    expect(isValidStatusTransition('pending', 'completed')).toBe(false)
  })
  it('blocks completed → confirmed', () => {
    expect(isValidStatusTransition('completed', 'confirmed')).toBe(false)
  })
})

describe('canConfirmBooking', () => {
  it('allows when payment completed', () => {
    expect(canConfirmBooking('completed')).toBe(true)
  })
  it('allows cash method regardless of status', () => {
    expect(canConfirmBooking('pending', 'cash')).toBe(true)
  })
  it('allows zero-amount bookings (protocol/free)', () => {
    expect(canConfirmBooking('pending', 'link', 0)).toBe(true)
  })
  it('blocks pending with non-cash, non-zero', () => {
    expect(canConfirmBooking('pending', 'razorpay', 500)).toBe(false)
  })
  it('blocks failed payment', () => {
    expect(canConfirmBooking('failed', 'razorpay', 500)).toBe(false)
  })
})

describe('generateOrderNumber', () => {
  it('generates ASG-format ID', () => {
    expect(generateOrderNumber()).toMatch(/^ASG\d{12}\d{3}[A-Z0-9]{4}$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateOrderNumber()))
    expect(ids.size).toBe(20)
  })
})

describe('isValidOrderNumber', () => {
  it('validates correct format', () => {
    expect(isValidOrderNumber('ASG260413120000100ABCD')).toBe(true)
  })
  it('rejects wrong prefix', () => {
    expect(isValidOrderNumber('XYZ260413120000100ABCD')).toBe(false)
  })
  it('rejects too short', () => {
    expect(isValidOrderNumber('ASG123')).toBe(false)
  })
  it('rejects empty', () => {
    expect(isValidOrderNumber('')).toBe(false)
  })
})
