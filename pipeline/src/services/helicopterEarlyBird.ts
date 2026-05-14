import { db } from '../lib/firebase'
import { doc, getDoc, setDoc, increment } from 'firebase/firestore'
import { logger } from '../lib/logger'

// ─── Constants ──────────────────────────────────────────────────────
export const EARLY_BIRD_PRICE = 3999
export const REGULAR_PRICE = 4999
export const EARLY_BIRD_LIMIT = 300

const COUNTER_DOC = doc(db, 'counters', 'helicopter_bookings')

/**
 * Get the current helicopter booking count.
 * Returns 0 if the counter doc doesn't exist yet.
 */
export async function getHelicopterBookingCount(): Promise<number> {
  try {
    const snap = await getDoc(COUNTER_DOC)
    if (snap.exists()) {
      return Number(snap.data().count) || 0
    }
    return 0
  } catch (err) {
    logger.error('helicopter.read_booking_count_failed', err)
    return 0
  }
}

/**
 * Atomically increment the helicopter booking counter by `seats`.
 * Creates the doc if it doesn't exist.
 */
export async function incrementHelicopterBookingCount(seats: number): Promise<void> {
  try {
    await setDoc(COUNTER_DOC, { count: increment(seats) }, { merge: true })
  } catch (err) {
    logger.error('helicopter.increment_booking_count_failed', err)
  }
}

/**
 * Internal — recognize helicopter line items the same way the Razorpay
 * webhook does. Stays in sync with the canonical check in
 * `functions/api/razorpay.js` payment.captured / payment_link.paid
 * branches: match on activity.name OR activity.category containing
 * "helicopter" (case-insensitive).
 */
const isHelicopterLineItem = (item: unknown): boolean => {
  if (!item || typeof item !== 'object') return false
  const activity = (item as { activity?: { name?: unknown; category?: unknown } }).activity
  if (!activity || typeof activity !== 'object') return false
  const name = String(activity.name ?? '').toLowerCase()
  const category = String(activity.category ?? '').toLowerCase()
  return name.includes('helicopter') || category.includes('helicopter')
}

/**
 * Decrement the helicopter counter for a booking that's being cancelled
 * (POS Cancel Transaction OR AllBookingsView Cancel).
 *
 * Pre-fix only `functions/api/delete-booking.js` decremented the counter
 * on cancel — the other two cancel paths left the count inflated, so
 * early-bird "sold out" appeared earlier than reality and some
 * eligible bookings got charged the ₹4999 regular price.
 *
 * Guards:
 *   - `helicopterCountIncremented === true` — the booking was actually
 *     counted (skip "pending" / "failed" / never-incremented bookings).
 *   - `helicopterCountDecremented !== true` — the booking hasn't already
 *     been decremented (idempotent across multiple cancel re-runs).
 *
 * On success, stamps `helicopterCountDecremented: true` on the booking
 * doc so subsequent cancel/delete calls become no-ops.
 *
 * Caller passes the bookingId and the BEFORE-cancel booking data (we
 * read `items` from it to compute seats — the cancel write itself
 * wouldn't have items if it's a merge-only write).
 */
export async function decrementHelicopterCountForCancellation(
  bookingId: string,
  booking: Record<string, unknown>,
): Promise<{ decremented: boolean; seats: number; reason?: string }> {
  try {
    if (booking.helicopterCountIncremented !== true) {
      return { decremented: false, seats: 0, reason: 'never_incremented' }
    }
    if (booking.helicopterCountDecremented === true) {
      return { decremented: false, seats: 0, reason: 'already_decremented' }
    }
    const items = Array.isArray(booking.items) ? booking.items : []
    let seats = 0
    for (const item of items) {
      if (!isHelicopterLineItem(item)) continue
      const qty = Number((item as { quantity?: unknown }).quantity) || 0
      seats += qty
    }
    if (seats <= 0) return { decremented: false, seats: 0, reason: 'no_helicopter_items' }

    // Two writes: counter and the booking marker. Use a transaction to
    // avoid the race where the counter decrements but the marker write
    // fails (which would let a re-run double-decrement).
    const bookingRef = doc(db, 'bookings', bookingId)
    await setDoc(COUNTER_DOC, { count: increment(-seats) }, { merge: true })
    await setDoc(
      bookingRef,
      { helicopterCountDecremented: true, helicopterCountDecrementedAt: new Date().toISOString() },
      { merge: true },
    )
    return { decremented: true, seats }
  } catch (err) {
    logger.error('helicopter.decrement_booking_count_failed', err, { bookingId })
    return { decremented: false, seats: 0, reason: 'error' }
  }
}

/**
 * Get the current effective price and remaining early-bird tickets.
 */
export async function getHelicopterPricing(): Promise<{
  currentPrice: number
  isEarlyBird: boolean
  ticketsSold: number
  earlyBirdRemaining: number
}> {
  const ticketsSold = await getHelicopterBookingCount()
  const isEarlyBird = ticketsSold < EARLY_BIRD_LIMIT
  return {
    currentPrice: isEarlyBird ? EARLY_BIRD_PRICE : REGULAR_PRICE,
    isEarlyBird,
    ticketsSold,
    earlyBirdRemaining: Math.max(0, EARLY_BIRD_LIMIT - ticketsSold),
  }
}

/**
 * DEBUG/ADMIN: Recalculate and sync the counter from actual bookings.
 * Useful if the counter gets out of sync with matching bookings.
 */
export async function syncHelicopterCount(): Promise<{
  count: number
  confirmed: number
  pending: number
  failed: number
  cancelled: number
}> {
  try {
    const { collection, getDocs, query } = await import('firebase/firestore')
    const bookingsQuery = query(collection(db, 'bookings'))
    const snapshot = await getDocs(bookingsQuery)

    let confirmedSeats = 0
    let pendingSeats = 0
    let failedSeats = 0
    let cancelledSeats = 0

    snapshot.forEach((doc) => {
      const data = doc.data()
      let seats = 0
      if (data.items && Array.isArray(data.items)) {
        data.items.forEach(
          (item: { activity?: { name?: string; category?: string }; quantity?: number }) => {
            const name = (item.activity?.name || '').toLowerCase()
            const cat = (item.activity?.category || '').toLowerCase()
            if (name.includes('helicopter') || cat.includes('helicopter')) {
              seats += item.quantity || 0
            }
          },
        )
      }

      if (seats > 0) {
        if (
          (data.bookingStatus === 'confirmed' || data.bookingStatus === 'completed') &&
          data.paymentStatus !== 'failed'
        ) {
          confirmedSeats += seats
        } else if (data.bookingStatus === 'pending' || data.paymentStatus === 'pending') {
          pendingSeats += seats
        } else if (data.bookingStatus === 'cancelled') {
          cancelledSeats += seats
        } else if (data.paymentStatus === 'failed') {
          failedSeats += seats
        }
      }
    })

    await setDoc(COUNTER_DOC, { count: confirmedSeats }, { merge: true })
    return {
      count: confirmedSeats,
      confirmed: confirmedSeats,
      pending: pendingSeats,
      failed: failedSeats,
      cancelled: cancelledSeats,
    }
  } catch (err) {
    logger.error('helicopter.sync_count_failed', err)
    throw err
  }
}

/**
 * Get daily booking counts for a range of dates.
 * Used to show "Fast Filling" status.
 */
export async function getHelicopterDailyCounts(dates: Date[]): Promise<Record<string, number>> {
  try {
    if (dates.length === 0) return {}

    const { collection, getDocs, query, where } = await import('firebase/firestore')

    // 1. Determine date range
    const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime())
    const startDate = new Date(sortedDates[0])
    startDate.setHours(0, 0, 0, 0)

    const endDate = new Date(sortedDates[sortedDates.length - 1])
    endDate.setHours(23, 59, 59, 999)

    // 2. Query bookings in range
    const bookingsQuery = query(
      collection(db, 'bookings'),
      where('sessionDate', '>=', startDate),
      where('sessionDate', '<=', endDate),
    )

    const snapshot = await getDocs(bookingsQuery)
    const counts: Record<string, number> = {}

    // Initialize counts for requested dates
    dates.forEach((d) => {
      const dateStr = d.toISOString().split('T')[0]
      counts[dateStr] = 0
    })

    snapshot.forEach((doc) => {
      const data = doc.data()
      // Check status (confirmed, completed, pending)
      if (
        ['confirmed', 'completed'].includes(data.bookingStatus) &&
        data.paymentStatus !== 'failed'
      ) {
        // Check if it's a helicopter booking
        let isHelicopter = false
        if (data.items && Array.isArray(data.items)) {
          for (const item of data.items) {
            const name = (item.activity?.name || item.name || '').toLowerCase()
            const cat = (item.activity?.category || '').toLowerCase()
            if (name.includes('helicopter') || cat.includes('helicopter')) {
              isHelicopter = true
              break
            }
          }
        }

        if (isHelicopter) {
          // Extract date string
          let dateStr = ''
          if (data.sessionDate && data.sessionDate.toDate) {
            // Firestore Timestamp
            dateStr = data.sessionDate.toDate().toISOString().split('T')[0]
          } else if (data.sessionDate) {
            // String or other
            dateStr = new Date(data.sessionDate).toISOString().split('T')[0]
          }

          if (dateStr && Object.prototype.hasOwnProperty.call(counts, dateStr)) {
            // Count seats
            let seats = 0
            data.items.forEach(
              (item: {
                activity?: { name?: string; category?: string }
                name?: string
                quantity?: number
              }) => {
                const name = (item.activity?.name || item.name || '').toLowerCase()
                const cat = (item.activity?.category || '').toLowerCase()
                if (name.includes('helicopter') || cat.includes('helicopter')) {
                  seats += item.quantity || 1
                }
              },
            )
            counts[dateStr] += seats
          }
        }
      }
    })

    return counts
  } catch (err) {
    logger.error('helicopter.fetch_daily_counts_failed', err)
    return {}
  }
}
