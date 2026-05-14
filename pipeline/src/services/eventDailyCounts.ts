import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { logger } from '../lib/logger'

/**
 * Count confirmed/pending bookings per date for an event. A booking is
 * attributed to the event when any of its items has an id starting with
 * `event-${eventId}` OR its cart-attachment carries `campaignId === eventId`.
 */
export async function getEventDailyCounts(
  eventId: string,
  dates: string[],
): Promise<Record<string, number>> {
  if (dates.length === 0 || !eventId) return {}
  try {
    const sorted = [...dates].sort()
    const start = new Date(`${sorted[0]}T00:00:00`)
    const end = new Date(`${sorted[sorted.length - 1]}T23:59:59.999`)

    const snap = await getDocs(
      query(
        collection(db, 'bookings'),
        where('sessionDate', '>=', start),
        where('sessionDate', '<=', end),
      ),
    )

    const counts: Record<string, number> = Object.fromEntries(dates.map((d) => [d, 0]))
    const prefix = `event-${eventId}`

    snap.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>
      const status = String(data.bookingStatus ?? '')
      const payment = String(data.paymentStatus ?? '')
      if (status === 'cancelled' || payment === 'failed') return

      const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
      let seats = 0
      for (const item of items) {
        const activity = (item.activity as Record<string, unknown> | undefined) ?? {}
        const id = String(activity.id ?? '')
        const attachment = item.__eventPackage as { campaignId?: string } | undefined
        const matches = id.startsWith(prefix) || attachment?.campaignId === eventId
        if (matches) seats += Number(item.quantity ?? 1)
      }
      if (seats === 0) return

      const raw = data.sessionDate
      let dateStr = ''
      if (raw && typeof raw === 'object' && 'toDate' in (raw as object)) {
        dateStr = (raw as { toDate: () => Date }).toDate().toISOString().slice(0, 10)
      } else if (typeof raw === 'string') {
        dateStr = raw.slice(0, 10)
      }
      if (dateStr && Object.prototype.hasOwnProperty.call(counts, dateStr)) {
        counts[dateStr] += seats
      }
    })

    return counts
  } catch (err) {
    logger.warn('event.daily_counts_failed', { err: String(err), eventId })
    return Object.fromEntries(dates.map((d) => [d, 0]))
  }
}
