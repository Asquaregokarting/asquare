/**
 * Future Bookings — data layer for the Owner dashboard's 7-day strip.
 *
 * A booking is "future" while its `visitDate` is ahead of today and
 * graduates into past once `visitDate <= today`. The partition is by
 * stored visit date, not creation date — so a walk-in customer who
 * pre-books for next Sunday lives in the future strip until next Sunday
 * arrives.
 *
 * Cancelled, deleted, full-refunded, and not-yet-completed bookings are
 * excluded from the totals (they don't represent confirmed forward
 * demand). The slide-over still shows them inline as "Cancelled" /
 * "Refunded" rows so the Owner can spot a churned day.
 */

import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { initializeFirestore } from '../../lib/firebase'
import { addDaysIST, todayIST } from '../../lib/ist-date'

const BOOKINGS_COLLECTION = 'bookings'

export interface FutureBookingRow {
  id: string
  visitDate: string
  locationId: string
  customerName: string
  customerPhone: string
  finalAmount: number
  itemNames: string[]
  paymentStatus: string
  refundStatus: string
  cancelled: boolean
}

export interface FutureBookingDay {
  date: string
  count: number
  revenue: number
  byBranch: Map<string, { count: number; revenue: number }>
  bookings: FutureBookingRow[]
}

export interface FutureBookingsRange {
  fromDate: string
  toDate: string
  days: FutureBookingDay[]
  totalCount: number
  totalRevenue: number
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

const isExcludedForTotals = (b: FutureBookingRow): boolean => {
  if (b.cancelled) return true
  if (b.refundStatus === 'Full') return true
  if (b.paymentStatus !== 'completed') return true
  return false
}

const buildEmptyDays = (fromDate: string, toDate: string): FutureBookingDay[] => {
  const days: FutureBookingDay[] = []
  let cursor = fromDate
  while (cursor <= toDate) {
    days.push({
      date: cursor,
      count: 0,
      revenue: 0,
      byBranch: new Map(),
      bookings: [],
    })
    cursor = addDaysIST(cursor, 1)
  }
  return days
}

/**
 * Fetch bookings whose visitDate falls in [fromDate, toDate] (inclusive).
 *
 * Defaults to today + next 6 days (a 7-day inclusive window). Bookings
 * with no visitDate fall back to the date-portion of `sessionDate` so
 * legacy data still surfaces.
 */
export const fetchFutureBookings = async (
  fromDate: string = todayIST(),
  toDate: string = addDaysIST(todayIST(), 6),
): Promise<FutureBookingsRange> => {
  const firestore = initializeFirestore()
  if (!firestore) {
    return {
      fromDate,
      toDate,
      days: buildEmptyDays(fromDate, toDate),
      totalCount: 0,
      totalRevenue: 0,
    }
  }
  const bookingsRef = collection(firestore, BOOKINGS_COLLECTION)
  // The visitDate field is a YYYY-MM-DD string on every modern booking
  // (POS unified-booking, customer-app submitOrder, Razorpay capture,
  // admin booking flow). Old docs that lack it fall back to the date
  // portion of sessionDate via the in-memory filter below.
  //
  // limit(5000) is large enough for a peak weekend across all 4 branches
  // while still capping the read; the average week is well under 500.
  const snap = await getDocs(
    query(
      bookingsRef,
      where('visitDate', '>=', fromDate),
      where('visitDate', '<=', toDate),
      limit(5000),
    ),
  )

  const days = buildEmptyDays(fromDate, toDate)
  const dayByDate = new Map(days.map((d) => [d.date, d]))

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as Record<string, unknown>
    if (data.deletedAt) continue
    const visitDate = str(data.visitDate).slice(0, 10)
    if (!visitDate) continue
    const day = dayByDate.get(visitDate)
    if (!day) continue

    const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : []
    const itemNames = items
      .map((it) => str(it?.itemName ?? (it as { activity?: { name?: unknown } })?.activity?.name))
      .filter((n) => n.length > 0)

    const row: FutureBookingRow = {
      id: docSnap.id,
      visitDate,
      locationId: str(data.locationId),
      customerName: str(data.userDisplayName || data.customerName),
      customerPhone: str(data.userPhone || data.customerPhone),
      finalAmount: num(data.finalAmount ?? data.totalAmount),
      itemNames,
      paymentStatus: str(data.paymentStatus),
      refundStatus: str(data.refundStatus),
      cancelled: data.cancelled === true,
    }
    day.bookings.push(row)
    if (isExcludedForTotals(row)) continue
    day.count += 1
    day.revenue += row.finalAmount
    const branchKey = row.locationId || 'unknown'
    const acc = day.byBranch.get(branchKey) ?? { count: 0, revenue: 0 }
    acc.count += 1
    acc.revenue += row.finalAmount
    day.byBranch.set(branchKey, acc)
  }

  const totalCount = days.reduce((s, d) => s + d.count, 0)
  const totalRevenue = days.reduce((s, d) => s + d.revenue, 0)
  return { fromDate, toDate, days, totalCount, totalRevenue }
}

/**
 * Median of an array of numbers (ignores zeros so an empty day doesn't
 * drag the baseline down). Used to compute the "soft day" amber trigger
 * — a day whose count is less than `SOFT_DAY_RATIO` × median qualifies.
 */
export const medianOfCounts = (counts: number[]): number => {
  const nonZero = counts.filter((n) => n > 0).sort((a, b) => a - b)
  if (nonZero.length === 0) return 0
  const mid = Math.floor(nonZero.length / 2)
  return nonZero.length % 2 === 0 ? (nonZero[mid - 1] + nonZero[mid]) / 2 : nonZero[mid]
}

export const SOFT_DAY_RATIO = 0.5
