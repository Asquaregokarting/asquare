import { describe, it, expect } from 'vitest'
import { canBypassInvoiceLock, classifyForLockBypass } from './booking-lock-bypass'

describe('classifyForLockBypass', () => {
  describe("returns 'allow' (no money moved)", () => {
    it('for failed-payment bookings', () => {
      expect(classifyForLockBypass({ paymentStatus: 'failed' })).toBe('allow')
    })

    it('for pending-payment bookings', () => {
      expect(classifyForLockBypass({ paymentStatus: 'pending' })).toBe('allow')
    })

    it('for refunded paymentStatus (legacy mapping)', () => {
      expect(classifyForLockBypass({ paymentStatus: 'refunded' })).toBe('allow')
    })

    it('for cancelled paymentStatus (legacy mapping)', () => {
      expect(classifyForLockBypass({ paymentStatus: 'cancelled' })).toBe('allow')
    })
  })

  describe("returns 'check_payout' (refunded — needs vendor-paid check)", () => {
    it('for completed-then-refunded bookings', () => {
      expect(
        classifyForLockBypass({
          paymentStatus: 'completed',
          bookingStatus: 'cancelled',
          refundStatus: 'Refunded',
        }),
      ).toBe('check_payout')
    })
  })

  describe("returns 'deny' (strict guard required)", () => {
    it('for completed payments still confirmed', () => {
      expect(
        classifyForLockBypass({
          paymentStatus: 'completed',
          bookingStatus: 'confirmed',
        }),
      ).toBe('deny')
    })

    it('for completed cancelled but NOT refunded (refundStatus None)', () => {
      // Cancelled-without-refund means money was kept. The strict guard
      // applies because the locked invoice may already include this revenue.
      expect(
        classifyForLockBypass({
          paymentStatus: 'completed',
          bookingStatus: 'cancelled',
          refundStatus: 'None',
        }),
      ).toBe('deny')
    })

    it('for completed cancelled with refundStatus pending (not yet refunded)', () => {
      expect(
        classifyForLockBypass({
          paymentStatus: 'completed',
          bookingStatus: 'cancelled',
          refundStatus: 'Pending',
        }),
      ).toBe('deny')
    })

    it('when paymentStatus is missing — fail closed', () => {
      expect(classifyForLockBypass({})).toBe('deny')
    })

    it('when given null/undefined', () => {
      expect(classifyForLockBypass(null)).toBe('deny')
      expect(classifyForLockBypass(undefined)).toBe('deny')
    })

    it('for unknown paymentStatus values', () => {
      expect(classifyForLockBypass({ paymentStatus: 'weird' })).toBe('deny')
    })
  })
})

describe('canBypassInvoiceLock (legacy convenience)', () => {
  it('returns true only for the unconditional-allow bucket', () => {
    expect(canBypassInvoiceLock({ paymentStatus: 'failed' })).toBe(true)
    expect(canBypassInvoiceLock({ paymentStatus: 'pending' })).toBe(true)
  })

  it('returns false for refunded bookings (those need the async check)', () => {
    expect(
      canBypassInvoiceLock({
        paymentStatus: 'completed',
        bookingStatus: 'cancelled',
        refundStatus: 'Refunded',
      }),
    ).toBe(false)
  })

  it('returns false for completed bookings', () => {
    expect(canBypassInvoiceLock({ paymentStatus: 'completed' })).toBe(false)
  })

  it('returns false for null/undefined/empty', () => {
    expect(canBypassInvoiceLock(null)).toBe(false)
    expect(canBypassInvoiceLock(undefined)).toBe(false)
    expect(canBypassInvoiceLock({})).toBe(false)
  })
})
