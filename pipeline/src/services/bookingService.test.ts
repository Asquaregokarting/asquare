/**
 * bookingService unit tests
 *
 * bookingService.ts is 980 lines and tightly coupled to Firestore. We are NOT
 * trying to cover it all here — Sprint 3.10/3.12 will refactor large modules.
 * For now we pin the highest-risk piece: updateBookingStatus, which the
 * payment-success path depends on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as firestore from 'firebase/firestore'
import { bookingService } from './bookingService'
import { createFakeDocSnapshot } from '../test/mocks/firebase'

const mockedFirestore = vi.mocked(firestore)

describe('bookingService.updateBookingStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns false when the booking does not exist', async () => {
    mockedFirestore.getDoc.mockResolvedValueOnce(
      createFakeDocSnapshot(undefined) as never,
    )
    const ok = await bookingService.updateBookingStatus(
      'ASQ-MISSING',
      'confirmed',
      'completed',
    )
    expect(ok).toBe(false)
    // Should NOT have written anything when the booking is missing
    expect(mockedFirestore.setDoc).not.toHaveBeenCalled()
  })

  it('writes an update on the bookings doc when found', async () => {
    mockedFirestore.getDoc.mockResolvedValueOnce(
      createFakeDocSnapshot({ userId: 'user-1' }) as never,
    )
    const ok = await bookingService.updateBookingStatus(
      'ASQ-001',
      'confirmed',
      'completed',
      'pay_123',
      'order_123',
      'sig_abc',
    )
    expect(ok).toBe(true)
    // One write to bookings/{id}, one write to users/{uid}/bookings/{id}
    expect(mockedFirestore.setDoc).toHaveBeenCalledTimes(2)
  })

  it('skips the user-subcollection write for offline bookings', async () => {
    mockedFirestore.getDoc.mockResolvedValueOnce(
      createFakeDocSnapshot({ userId: 'offline_abc' }) as never,
    )
    const ok = await bookingService.updateBookingStatus(
      'ASQ-002',
      'cancelled',
      'failed',
    )
    expect(ok).toBe(true)
    // Only the flat bookings write — the offline_ user is skipped
    expect(mockedFirestore.setDoc).toHaveBeenCalledTimes(1)
  })

  it('returns false when the underlying write throws', async () => {
    mockedFirestore.getDoc.mockResolvedValueOnce(
      createFakeDocSnapshot({ userId: 'user-1' }) as never,
    )
    mockedFirestore.setDoc.mockRejectedValueOnce(new Error('network down'))
    const ok = await bookingService.updateBookingStatus(
      'ASQ-003',
      'confirmed',
      'completed',
    )
    expect(ok).toBe(false)
  })

  it('only includes paymentId/razorpayOrderId/razorpaySignature when provided', async () => {
    mockedFirestore.getDoc.mockResolvedValueOnce(
      createFakeDocSnapshot({ userId: 'user-1' }) as never,
    )
    await bookingService.updateBookingStatus('ASQ-004', 'confirmed', 'pending')
    const call = mockedFirestore.setDoc.mock.calls[0]
    const updates = call[1] as Record<string, unknown>
    expect(updates.bookingStatus).toBe('confirmed')
    expect(updates.paymentStatus).toBe('pending')
    expect(updates.paymentId).toBeUndefined()
    expect(updates.razorpayOrderId).toBeUndefined()
    expect(updates.razorpaySignature).toBeUndefined()
  })
})
