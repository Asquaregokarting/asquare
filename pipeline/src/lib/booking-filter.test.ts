import { describe, it, expect } from 'vitest'
import { isHardTerminatedBooking, isLiveBooking, isTerminatedBooking } from './booking-filter'

describe('isTerminatedBooking', () => {
  it('returns false for a plain confirmed booking', () => {
    expect(isTerminatedBooking({ bookingStatus: 'confirmed' })).toBe(false)
  })

  it('catches cancelled flag', () => {
    expect(isTerminatedBooking({ cancelled: true })).toBe(true)
  })

  it("doesn't catch cancelled: false", () => {
    expect(isTerminatedBooking({ cancelled: false })).toBe(false)
  })

  it("catches bookingStatus 'cancelled'", () => {
    expect(isTerminatedBooking({ bookingStatus: 'cancelled' })).toBe(true)
    expect(isTerminatedBooking({ bookingStatus: 'CANCELLED' })).toBe(true)
  })

  it('catches deletedAt iso string', () => {
    expect(isTerminatedBooking({ deletedAt: '2026-05-12T10:00:00.000Z' })).toBe(true)
  })

  it('catches voidedAt iso string', () => {
    expect(isTerminatedBooking({ voidedAt: '2026-05-12T10:00:00.000Z' })).toBe(true)
  })

  it('treats empty / whitespace deletedAt as alive', () => {
    expect(isTerminatedBooking({ deletedAt: '' })).toBe(false)
    expect(isTerminatedBooking({ deletedAt: '   ' })).toBe(false)
  })

  it('handles null / undefined input', () => {
    expect(isTerminatedBooking(null)).toBe(false)
    expect(isTerminatedBooking(undefined)).toBe(false)
  })
})

describe('isLiveBooking', () => {
  it('is the negation', () => {
    expect(isLiveBooking({ bookingStatus: 'confirmed' })).toBe(true)
    expect(isLiveBooking({ cancelled: true })).toBe(false)
    expect(isLiveBooking({ deletedAt: '2026-05-12T10:00:00.000Z' })).toBe(false)
  })
})

describe('isHardTerminatedBooking (trigger-safe)', () => {
  it('catches cancelled flag', () => {
    expect(isHardTerminatedBooking({ cancelled: true })).toBe(true)
  })

  it('catches deletedAt + voidedAt', () => {
    expect(isHardTerminatedBooking({ deletedAt: '2026-05-12T10:00:00.000Z' })).toBe(true)
    expect(isHardTerminatedBooking({ voidedAt: '2026-05-12T10:00:00.000Z' })).toBe(true)
  })

  it("does NOT catch bookingStatus 'cancelled' — preserves AllBookingsView's manual reverse flow", () => {
    expect(isHardTerminatedBooking({ bookingStatus: 'cancelled' })).toBe(false)
    expect(isHardTerminatedBooking({ bookingStatus: 'CANCELLED' })).toBe(false)
  })

  it('null / undefined safe', () => {
    expect(isHardTerminatedBooking(null)).toBe(false)
    expect(isHardTerminatedBooking(undefined)).toBe(false)
  })
})
