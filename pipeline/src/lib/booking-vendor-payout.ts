/**
 * Unified vendor-ledger writer for event-package bookings.
 *
 * Called at payment completion from every booking source (admin-link, admin
 * protocol, customer-online, Razorpay verify). Computes per-vendor credits
 * from the FULL gross `quantity × unitPrice` of each event-package item —
 * so Buy-2-Get-1-Free free units are still credited to the vendor at full
 * price, with the company absorbing the BxGy discount on the customer side.
 *
 * Idempotent: writes use deterministic doc id `le-{bookingId}-{vendorId}`
 * with merge semantics, so re-runs produce the same entry. Safe to call
 * twice (e.g. once from the admin Verify button and again from a Razorpay
 * webhook) without double-crediting.
 *
 * Unlike the generic `writeVendorLedger` in unified-booking.ts — which
 * pro-rates `finalAmount` across items and therefore shortchanges the
 * vendor on BxGy free units — this module works off each item's original
 * unit price and ignores the booking-level discount. The tradeoff is that
 * event-package items must carry their `vendorId` on `activity.vendorId`
 * and their original unit price on `item.price`; both are already stamped
 * by `useCreateBooking` / `EventPage` / `BillingModule` builders.
 */
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { logger } from './logger'
import type { AsquareBooking, AsquareBookingItem } from '../pipeline/api/asquare-bookings'

const GST_PERCENT = 18
const VENDOR_SHARE_DEFAULT = 80
const VENDOR_LEDGER_COLLECTION = 'vendorLedger'

interface EventPackageCartItem {
  vendorId?: string
  price?: number | string
  type?: string
  revenueShare?: boolean
}

interface EventItemActivity {
  id?: string
  apiId?: string
  category?: string
  vendorId?: string
  revenueShare?: boolean
  basePrice?: number
  /**
   * Customer-online cart attachment. Present on `EventPage.tsx`-generated
   * Activity objects; carries the per-item vendor/price breakdown for the
   * package. When present, takes precedence over the activity's own
   * vendorId/basePrice (which are a rollup of the package).
   */
  __eventPackage?: {
    items?: EventPackageCartItem[]
  }
}

const isEventPackageItem = (item: { activity?: EventItemActivity | null }): boolean => {
  const cat = String(item.activity?.category ?? '').toLowerCase()
  const id = String(item.activity?.id ?? '')
  const apiId = String(item.activity?.apiId ?? '')
  if (cat === 'event' || id.startsWith('evt-') || apiId.startsWith('evt-')) return true
  if (id.startsWith('event-') || apiId.startsWith('event-')) return true
  return !!item.activity?.__eventPackage
}

interface VendorRow {
  vendorId: string
  base: number
  gst: number
  shareOverride: number | null
}

/**
 * Writes (or upserts) one `vendorLedger` credit per vendor referenced by the
 * booking's event-package items. Returns the number of entries written.
 * Non-throwing: individual write failures are logged but do not reject.
 */
export const onBookingPaid = async (booking: AsquareBooking): Promise<number> => {
  const rows: VendorRow[] = []
  for (const item of booking.items || []) {
    if (!isEventPackageItem(item)) continue
    const activity = item.activity as EventItemActivity | undefined
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1))

    // Prefer the cart attachment's per-item breakdown when present
    // (customer-online path). It carries the true vendor + price for each
    // sub-item of the package, which the rolled-up activity fields obscure.
    const attachment = activity?.__eventPackage?.items
    if (Array.isArray(attachment) && attachment.length > 0) {
      for (const sub of attachment) {
        if (sub.type && sub.type !== 'thirdParty') continue
        const vid = typeof sub.vendorId === 'string' ? sub.vendorId.trim() : ''
        if (!vid) continue
        const unitPrice = Math.max(0, Number(sub.price ?? 0))
        if (unitPrice <= 0) continue
        const gross = unitPrice * qty
        const base = Math.round((gross * 100) / (100 + GST_PERCENT))
        const gst = gross - base
        const shareOverride = sub.revenueShare === false ? 100 : null
        rows.push({ vendorId: vid, base, gst, shareOverride })
      }
      continue
    }

    // Admin / POS path: vendorId + basePrice live on the activity.
    const vendorId = typeof activity?.vendorId === 'string' ? activity.vendorId.trim() : ''
    if (!vendorId) continue
    // Prefer activity.basePrice as the authoritative unit price, since the
    // persisted `item.price` field's semantics differ by source path (POS
    // stores line-total `qty × unit`; admin stores `unit` — an artifact of
    // createPendingBooking's divide-then-multiply). basePrice is stamped
    // by every builder as the true unit price of the package item.
    const unitPrice = Math.max(0, Number(activity?.basePrice ?? item.price ?? 0))
    if (unitPrice <= 0) continue
    const gross = unitPrice * qty
    const base = Math.round((gross * 100) / (100 + GST_PERCENT))
    const gst = gross - base
    const shareOverride = activity?.revenueShare === false ? 100 : null
    rows.push({ vendorId, base, gst, shareOverride })
  }
  if (rows.length === 0) return 0

  const uniqueVendorIds = [...new Set(rows.map((r) => r.vendorId))]
  const vendorShares = new Map<string, number>()
  await Promise.all(
    uniqueVendorIds.map(async (vid) => {
      try {
        const snap = await getDoc(doc(db, 'vendorDetails', vid))
        if (!snap.exists()) {
          vendorShares.set(vid, VENDOR_SHARE_DEFAULT)
          return
        }
        const data = snap.data() as Record<string, unknown>
        const stored =
          typeof data.revenueShare === 'number' ? data.revenueShare : VENDOR_SHARE_DEFAULT
        vendorShares.set(vid, Math.min(100, Math.max(0, stored)))
      } catch {
        vendorShares.set(vid, VENDOR_SHARE_DEFAULT)
      }
    }),
  )

  const ledgerByVendor = new Map<string, { vendorBase: number; vendorGst: number }>()
  for (const row of rows) {
    const share = row.shareOverride ?? vendorShares.get(row.vendorId) ?? VENDOR_SHARE_DEFAULT
    const vBase = Math.round((row.base * share) / 100)
    const vGst = Math.round((row.gst * share) / 100)
    const acc = ledgerByVendor.get(row.vendorId) ?? { vendorBase: 0, vendorGst: 0 }
    acc.vendorBase += vBase
    acc.vendorGst += vGst
    ledgerByVendor.set(row.vendorId, acc)
  }

  // Anchor on the booking's transactionDate first (the actual sale moment).
  // Two failure modes used to slip through here:
  //   (1) bare `YYYY-MM-DD` strings parsed as UTC midnight ⇒ rendered as
  //       "5:30 AM IST" everywhere they were displayed.
  //   (2) when the parse failed we silently used `new Date()` — every booking
  //       processed in the same call got the same "now" timestamp.
  // `pickBookingDate` returns null on unparseable input so we can fall back
  // explicitly and warn loudly when it happens.
  const pickBookingDate = (b: AsquareBooking): string | null => {
    const sources = [
      (b as Record<string, unknown>).transactionDate,
      (b as Record<string, unknown>).paymentCompletedAt,
      b.createdAt,
    ]
    for (const raw of sources) {
      if (raw == null) continue
      if (raw instanceof Date) {
        if (!Number.isNaN(raw.getTime())) return raw.toISOString()
        continue
      }
      if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (!trimmed) continue
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
          // Anchor at noon UTC so IST display stays on the same calendar day.
          return `${trimmed}T12:00:00.000Z`
        }
        const t = new Date(trimmed)
        if (!Number.isNaN(t.getTime())) return t.toISOString()
        continue
      }
      if (typeof raw === 'object') {
        const v = raw as { toDate?: () => Date; _seconds?: number }
        if (typeof v.toDate === 'function') {
          try {
            const d = v.toDate()
            if (!Number.isNaN(d.getTime())) return d.toISOString()
          } catch {
            /* fall through */
          }
        } else if (typeof v._seconds === 'number') {
          return new Date(v._seconds * 1000).toISOString()
        }
      }
    }
    return null
  }
  const resolvedTxnDate = pickBookingDate(booking)
  if (!resolvedTxnDate) {
    logger.warn('booking_vendor_payout.no_parseable_date', {
      bookingId: booking.id,
    })
  }
  const txnDate = resolvedTxnDate ?? new Date().toISOString()
  const now = new Date().toISOString()
  const invoiceNumber = (booking as Record<string, unknown>).invoiceNumber ?? null

  let written = 0
  for (const [vendorId, totals] of ledgerByVendor.entries()) {
    const amount = totals.vendorBase + totals.vendorGst
    if (amount <= 0) continue
    const id = `le-${booking.id}-${vendorId}`
    try {
      await setDoc(
        doc(collection(db, VENDOR_LEDGER_COLLECTION), id),
        {
          id,
          vendorId,
          vendorBase: totals.vendorBase,
          vendorGst: totals.vendorGst,
          amount,
          type: 'credit',
          referenceId: booking.id,
          invoiceNumber,
          locationId: booking.locationId ?? null,
          date: txnDate,
          createdAt: now,
          source: 'booking',
        },
        { merge: true },
      )
      written++
    } catch (err) {
      logger.error('booking_vendor_payout.write_failed', err, { bookingId: booking.id, vendorId })
    }
  }
  return written
}

export interface BackfillResult {
  scanned: number
  written: number
  skipped: number
  errors: number
  bookingIds: string[]
}

/**
 * One-time backfill: walks completed bookings in [fromDateISO, toDateISO],
 * identifies those with event-package items, and invokes `onBookingPaid`
 * for each. Idempotent — safe to re-run; existing ledger entries are
 * overwritten with identical content (same deterministic doc id).
 *
 * Dates are ISO yyyy-mm-dd strings compared against the booking's
 * `transactionDate` / `createdAt` / `date` (whichever is present — stored
 * formats vary across Firestore and the legacy migration).
 */
export const backfillEventBookingVendorLedger = async (
  fromDateISO: string,
  toDateISO: string,
): Promise<BackfillResult> => {
  const result: BackfillResult = {
    scanned: 0,
    written: 0,
    skipped: 0,
    errors: 0,
    bookingIds: [],
  }
  try {
    // Narrow the scan to completed bookings. Date range is applied in-memory
    // because bookings' time fields use heterogeneous shapes (Timestamp,
    // ISO string, epoch ms) — a Firestore-side range filter would miss docs.
    const snapshot = await getDocs(
      query(collection(db, 'bookings'), where('paymentStatus', '==', 'completed')),
    )

    const fromTs = new Date(`${fromDateISO}T00:00:00.000Z`).getTime()
    const toTs = new Date(`${toDateISO}T23:59:59.999Z`).getTime()

    const extractBookingDate = (data: Record<string, unknown>): number => {
      const candidates = [data.transactionDate, data.createdAt, data.date, data.sessionDate]
      for (const raw of candidates) {
        if (!raw) continue
        if (typeof raw === 'object' && raw !== null && 'toDate' in raw) {
          const d = (raw as { toDate: () => Date }).toDate()
          if (!Number.isNaN(d.getTime())) return d.getTime()
        }
        if (raw instanceof Date) return raw.getTime()
        if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw
        if (typeof raw === 'string') {
          const t = new Date(raw).getTime()
          if (!Number.isNaN(t)) return t
        }
      }
      return 0
    }

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as Record<string, unknown>
      const ts = extractBookingDate(data)
      if (ts === 0 || ts < fromTs || ts > toTs) {
        result.skipped++
        continue
      }
      const items = (data.items ?? []) as AsquareBookingItem[]
      const hasEventItem = items.some((item) => {
        const activity = item.activity as
          | { category?: string; id?: string; apiId?: string; __eventPackage?: unknown }
          | undefined
        const cat = String(activity?.category ?? '').toLowerCase()
        const id = String(activity?.id ?? '')
        const apiId = String(activity?.apiId ?? '')
        return (
          cat === 'event' ||
          id.startsWith('evt-') ||
          id.startsWith('event-') ||
          apiId.startsWith('evt-') ||
          apiId.startsWith('event-') ||
          !!activity?.__eventPackage
        )
      })
      if (!hasEventItem) {
        result.skipped++
        continue
      }

      result.scanned++
      const booking = {
        id: docSnap.id,
        items,
        locationId: String(data.locationId ?? ''),
        createdAt: data.createdAt,
        invoiceNumber: data.invoiceNumber,
        ...data,
      } as unknown as AsquareBooking
      try {
        const wrote = await onBookingPaid(booking)
        if (wrote > 0) {
          result.written += wrote
          result.bookingIds.push(docSnap.id)
        }
      } catch (err) {
        result.errors++
        logger.error('booking_vendor_payout.backfill_booking_failed', err, {
          bookingId: docSnap.id,
        })
      }
    }
  } catch (err) {
    logger.error('booking_vendor_payout.backfill_failed', err)
    result.errors++
  }
  return result
}

/**
 * Convenience wrapper for callers that only have the booking id (e.g. a
 * Razorpay-verify handler that reloaded the list but not the specific doc).
 * Fetches from `bookings/{id}` in asquare-app-db before delegating.
 */
export const onBookingPaidById = async (bookingId: string): Promise<number> => {
  try {
    const snap = await getDoc(doc(db, 'bookings', bookingId))
    if (!snap.exists()) {
      logger.error('booking_vendor_payout.booking_not_found', undefined, { bookingId })
      return 0
    }
    const data = snap.data() as Record<string, unknown>
    const booking = {
      id: bookingId,
      items: (data.items ?? []) as AsquareBookingItem[],
      locationId: String(data.locationId ?? ''),
      createdAt: data.createdAt,
      invoiceNumber: data.invoiceNumber,
      ...data,
    } as unknown as AsquareBooking
    return await onBookingPaid(booking)
  } catch (err) {
    logger.error('booking_vendor_payout.fetch_failed', err, { bookingId })
    return 0
  }
}
