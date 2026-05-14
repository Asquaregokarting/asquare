/**
 * Canonical "is this booking still alive?" predicate.
 *
 * The asquare-app data model carries FOUR orthogonal signals that all
 * mean "this booking should not count anywhere":
 *
 *   1. `cancelled === true`         (legacy POS Cancel-Transaction flag)
 *   2. `bookingStatus === 'cancelled'` (AllBookingsView Cancel action)
 *   3. `deletedAt` truthy           (soft-delete by Owner / admin)
 *   4. `voidedAt`  truthy           (legacy voided marker)
 *
 * Pre-fix, almost every aggregator (invoice generation, reports, scanner,
 * settlements, vendor-ledger trigger) checked SOME of these but not all.
 * Inconsistency leaked phantom revenue into vendor invoices, allowed
 * cancelled tickets to be scanned, and produced the recurring vendor-
 * vs-settlements drift.
 *
 * This helper is the single source of truth. Every aggregator that
 * touches the bookings collection should call `isLiveBooking(doc)` (or
 * its negation `isTerminatedBooking(doc)`) instead of inlining its own
 * subset of the checks.
 *
 * The signature accepts a loose `Record<string, unknown>` so it can run
 * over raw Firestore docs OR mapped TransactionRecord-style objects.
 */

export interface LiveBookingCheckInput {
  cancelled?: unknown
  bookingStatus?: unknown
  deletedAt?: unknown
  voidedAt?: unknown
}

const isTruthyString = (value: unknown): boolean =>
  typeof value === 'string' ? value.trim().length > 0 : Boolean(value)

/**
 * Returns true when the booking is in a terminal "dead" state — should
 * be excluded from every revenue / ledger / availability aggregation.
 *
 * Use this in READ-side aggregators (revenue reports, dashboards,
 * settlements, listFilteredBillingTransactions). It checks ALL four
 * signals: cancelled, bookingStatus='cancelled', deletedAt, voidedAt.
 *
 * Do NOT use this in the vendor-ledger-sync trigger — that needs the
 * narrower `isHardTerminatedBooking` because AllBookingsView's "Cancel"
 * action sets ONLY `bookingStatus: 'cancelled'` (without `cancelled:
 * true`) and manually reverses vendor credits client-side. If the
 * trigger tore down rows on `bookingStatus === 'cancelled'` it would
 * race with that manual reversal and produce orphan debit rows.
 */
export const isTerminatedBooking = (b: LiveBookingCheckInput | null | undefined): boolean => {
  if (!b) return false
  if (b.cancelled === true) return true
  if (typeof b.bookingStatus === 'string' && b.bookingStatus.toLowerCase() === 'cancelled')
    return true
  if (isTruthyString(b.deletedAt)) return true
  if (isTruthyString(b.voidedAt)) return true
  return false
}

/**
 * Trigger-safe terminator: cancelled / soft-deleted / voided ONLY.
 *
 * Use this in the vendor-ledger-sync trigger and any other write-side
 * cleanup path that needs to know "should the system tear down this
 * booking's downstream artifacts?" — i.e., the question is "did the
 * booking writer signal a tear-down via the legacy flags?", NOT "is the
 * booking excluded from reports?".
 *
 * AllBookingsView's `cancelBooking` deliberately writes
 * `bookingStatus: 'cancelled'` WITHOUT `cancelled: true` so that the
 * trigger leaves the credit rows alone — the client then writes its own
 * reverse-credit entries via `asquareBookingsApi.reverseVendorCreditsForBooking`.
 * If you add `bookingStatus === 'cancelled'` here that contract breaks.
 */
export const isHardTerminatedBooking = (
  b: LiveBookingCheckInput | null | undefined,
): boolean => {
  if (!b) return false
  if (b.cancelled === true) return true
  if (isTruthyString(b.deletedAt)) return true
  if (isTruthyString(b.voidedAt)) return true
  return false
}

/**
 * Negation of `isTerminatedBooking`. Use this on an `.filter()` over raw
 * booking docs to keep only the rows that should still count.
 */
export const isLiveBooking = (b: LiveBookingCheckInput | null | undefined): boolean =>
  !isTerminatedBooking(b)
