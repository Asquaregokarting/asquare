/**
 * Decide whether a booking is safe to delete without first unlocking the
 * weekly invoice that covers its date range.
 *
 * The weekly-invoice lock is a coarse guard: it triggers on `createdAt`
 * falling inside any locked window, regardless of whether the booking
 * actually contributed any money to that period's aggregates. That's
 * over-protective for bookings that never moved money (payment-failed
 * pre-cancellations) or whose money has been net-zeroed by a refund.
 *
 * Two bypass paths:
 *   1. **Allow** — payment never completed. Ledger writer skipped this
 *      booking; deleting it cannot drift any locked total.
 *   2. **Check payout** — payment completed, but cancelled & refunded.
 *      Eligible for delete IF the vendor was not yet paid out for it.
 *      Caller MUST run the async vendor-payout check before allowing.
 *
 * If the vendor was already paid (cheque issued / payout initiated), the
 * booking can NEVER be deleted — reversing a vendor cheque is an external
 * (banking) action and silent deletion would desync books from bank.
 *
 * Pure function. No Firestore. Safe to import from anywhere.
 */

export interface LockBypassCandidate {
  paymentStatus?: string
  bookingStatus?: string
  refundStatus?: string
}

// Statuses that the unified-booking writer treats as non-contributing —
// the ledger write at unified-booking.ts:1085 is gated on
// `paymentStatus === 'completed' && billing.vendorTotal > 0`, so anything
// in this set produced no ledger entry, no invoice line, and no
// settlement contribution.
const NON_CONTRIBUTING_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  'failed',
  'pending',
  'refunded',
  'cancelled',
])

export type LockBypassDecision = 'allow' | 'check_payout' | 'deny'

/**
 * Triage a booking into one of three buckets. Sync, pure. Callers handle
 * the `check_payout` case by running the async vendor-payout check.
 */
export function classifyForLockBypass(
  booking: LockBypassCandidate | null | undefined,
): LockBypassDecision {
  if (!booking) return 'deny'

  const status = booking.paymentStatus
  if (typeof status === 'string' && NON_CONTRIBUTING_PAYMENT_STATUSES.has(status)) {
    return 'allow'
  }

  if (
    status === 'completed' &&
    booking.bookingStatus === 'cancelled' &&
    booking.refundStatus === 'Refunded'
  ) {
    return 'check_payout'
  }

  return 'deny'
}

/**
 * Convenience predicate for callers that don't have an async context.
 * Returns true only when the booking is unconditionally safe to delete
 * (the 'allow' bucket). Refunded bookings always return false here and
 * require the async vendor-payout check.
 */
export function canBypassInvoiceLock(booking: LockBypassCandidate | null | undefined): boolean {
  return classifyForLockBypass(booking) === 'allow'
}
