/**
 * Coupon Outreach — Performance Report API.
 *
 * Computes per-day or per-range performance metrics for the daily
 * 600-member call lists. This module is READ-ONLY across all collections
 * it touches:
 *
 *   couponOutreachBatches/{date}                — header
 *   couponOutreachBatches/{date}/items/{phone}  — per-member status
 *   bookings                                    — to attribute conversions
 *                                                  + revenue. NEVER WRITTEN.
 *
 * No edits to leads/, members/, users/, or unified-booking workflows.
 * The Report tab is purely additive — turning it off restores the
 * original History view exactly.
 */

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { ensureAnonymousAuth, initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { logger } from '../../lib/logger'
import {
  istDateString,
  type CouponOutreachBatch,
  type CouponOutreachItem,
  type CouponOutreachStatus,
} from './coupon-outreach'

// ─── Types ──────────────────────────────────────────────────────────

export interface ReportSummary {
  totalAssigned: number
  pending: number
  contacted: number
  done: number
  skipped: number
  /** done + contacted */
  callsCompleted: number
  /** Items where the customer subsequently created a paid booking. */
  convertedBookings: number
  /** Items still in "pending" status — i.e. missed calls. */
  missedCalls: number
  /** convertedBookings / totalAssigned, in [0, 1]. */
  conversionRate: number
}

export interface ReportRevenue {
  /** Sum of `finalAmount` (fallback `totalAmount`) of converted bookings. */
  totalRevenue: number
  /** totalRevenue / convertedBookings, or 0 if no conversions. */
  averageTicket: number
}

export interface ReportPerTelecaller {
  telecallerId: string
  assigned: number
  pending: number
  contacted: number
  done: number
  skipped: number
  convertedBookings: number
  revenue: number
  /** convertedBookings / assigned, in [0, 1]. */
  conversionRate: number
}

export interface CouponOutreachReport {
  fromDate: string
  toDate: string
  batches: CouponOutreachBatch[]
  summary: ReportSummary
  revenue: ReportRevenue
  perTelecaller: ReportPerTelecaller[]
}

// ─── Pure aggregator ────────────────────────────────────────────────

interface AggregatorInput {
  items: Array<Pick<CouponOutreachItem, 'phone' | 'assignedTo' | 'status' | 'createdAt'>>
  /** phone → list of converted bookings (post-batch, paid). */
  conversionsByPhone: Map<string, Array<{ amount: number; createdAt: string }>>
}

/**
 * Pure: turn the raw item + booking data into the report shape. Kept
 * dependency-free so vitest can exercise it without any Firebase mocks.
 */
export const aggregateReport = ({
  items,
  conversionsByPhone,
}: AggregatorInput): {
  summary: ReportSummary
  revenue: ReportRevenue
  perTelecaller: ReportPerTelecaller[]
} => {
  const summary: ReportSummary = {
    totalAssigned: items.length,
    pending: 0,
    contacted: 0,
    done: 0,
    skipped: 0,
    callsCompleted: 0,
    convertedBookings: 0,
    missedCalls: 0,
    conversionRate: 0,
  }

  let totalRevenue = 0
  const perTelecallerMap = new Map<string, ReportPerTelecaller>()
  const ensureRow = (id: string): ReportPerTelecaller => {
    let row = perTelecallerMap.get(id)
    if (!row) {
      row = {
        telecallerId: id,
        assigned: 0,
        pending: 0,
        contacted: 0,
        done: 0,
        skipped: 0,
        convertedBookings: 0,
        revenue: 0,
        conversionRate: 0,
      }
      perTelecallerMap.set(id, row)
    }
    return row
  }

  for (const item of items) {
    const owner = item.assignedTo || '(unassigned)'
    const row = ensureRow(owner)
    row.assigned += 1

    const status = item.status as CouponOutreachStatus
    summary[status] += 1
    row[status] += 1

    if (status === 'done' || status === 'contacted') summary.callsCompleted += 1
    if (status === 'pending') summary.missedCalls += 1

    const conversions = conversionsByPhone.get(item.phone) ?? []
    if (conversions.length > 0) {
      const itemRevenue = conversions.reduce((s, b) => s + b.amount, 0)
      summary.convertedBookings += 1
      totalRevenue += itemRevenue
      row.convertedBookings += 1
      row.revenue += itemRevenue
    }
  }

  summary.conversionRate =
    summary.totalAssigned > 0 ? summary.convertedBookings / summary.totalAssigned : 0

  for (const row of perTelecallerMap.values()) {
    row.conversionRate = row.assigned > 0 ? row.convertedBookings / row.assigned : 0
  }

  const revenue: ReportRevenue = {
    totalRevenue,
    averageTicket: summary.convertedBookings > 0 ? totalRevenue / summary.convertedBookings : 0,
  }

  const perTelecaller = Array.from(perTelecallerMap.values()).sort(
    (a, b) => b.revenue - a.revenue || b.assigned - a.assigned,
  )

  return { summary, revenue, perTelecaller }
}

// ─── Firestore helpers (read-only) ───────────────────────────────────

const requireFirestore = () => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  return fs
}

/** Iterate ISO calendar days inclusive [from..to]. */
const eachDayInclusive = (fromIso: string, toIso: string): string[] => {
  const dates: string[] = []
  const fromMs = new Date(`${fromIso}T00:00:00Z`).getTime()
  const toMs = new Date(`${toIso}T00:00:00Z`).getTime()
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    return dates
  }
  for (let ms = fromMs; ms <= toMs; ms += 24 * 60 * 60 * 1000) {
    const d = new Date(ms)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    dates.push(`${y}-${m}-${day}`)
  }
  return dates
}

const parseBatchHeader = (id: string, raw: Record<string, unknown>): CouponOutreachBatch => ({
  date: String(raw.date ?? id),
  createdAt: String(raw.createdAt ?? ''),
  createdBy: String(raw.createdBy ?? ''),
  totalCount: Number(raw.totalCount ?? 0),
  eligibleScanned: Number(raw.eligibleScanned ?? 0),
  skippedByCooldown: Number(raw.skippedByCooldown ?? 0),
  telecallerIds: Array.isArray(raw.telecallerIds)
    ? (raw.telecallerIds as unknown[]).map((v) => String(v))
    : [],
  distribution: (raw.distribution as Record<string, number>) ?? {},
  status: (() => {
    const s = String(raw.status ?? 'active')
    return s === 'no_telecallers' || s === 'archived' ? s : 'active'
  })(),
  lastRedistributedAt: raw.lastRedistributedAt ? String(raw.lastRedistributedAt) : undefined,
  lastRedistributedFrom: raw.lastRedistributedFrom ? String(raw.lastRedistributedFrom) : undefined,
})

const parseItemRow = (
  id: string,
  raw: Record<string, unknown>,
): {
  phone: string
  assignedTo: string
  status: CouponOutreachStatus
  createdAt: string
} => {
  const statusRaw = String(raw.status ?? 'pending')
  const status: CouponOutreachStatus =
    statusRaw === 'contacted' || statusRaw === 'done' || statusRaw === 'skipped'
      ? statusRaw
      : 'pending'
  return {
    phone: String(raw.phone ?? id),
    assignedTo: String(raw.assignedTo ?? ''),
    status,
    createdAt: String(raw.createdAt ?? ''),
  }
}

/**
 * Pull all converted bookings for the given phones AFTER the earliest
 * batch creation timestamp. Uses chunked `in` queries against both
 * `customerPhone` and `userPhone` (because the schema accepts both).
 */
const fetchConversionsForPhones = async (
  fs: ReturnType<typeof initializeFirestore>,
  phones: string[],
  attributionStart: Map<string, number>,
): Promise<Map<string, Array<{ amount: number; createdAt: string }>>> => {
  const out = new Map<string, Array<{ amount: number; createdAt: string }>>()
  if (!fs || phones.length === 0) return out

  const bookingsCol = collection(fs, 'bookings')
  const seenBookingIds = new Set<string>()

  const handleBooking = (id: string, data: Record<string, unknown>) => {
    if (seenBookingIds.has(id)) return
    seenBookingIds.add(id)

    const paymentStatus = String(data.paymentStatus ?? '')
    if (paymentStatus !== 'completed') return
    // Soft-deleted bookings should not count toward coupon attribution
    // — the sale was reversed, the credit shouldn't follow.
    if (data.deletedAt) return

    const phoneRaw = String(data.customerPhone ?? data.userPhone ?? '')
    const phone = phoneRaw.replace(/\D/g, '').slice(-10)
    if (phone.length !== 10) return

    const earliest = attributionStart.get(phone)
    if (earliest == null) return

    const createdAtRaw = data.createdAt as { toDate?: () => Date } | string | undefined
    let createdMs = 0
    let createdAtIso = ''
    if (createdAtRaw && typeof createdAtRaw === 'object' && createdAtRaw.toDate) {
      const d = createdAtRaw.toDate()
      createdMs = d.getTime()
      createdAtIso = d.toISOString()
    } else if (typeof createdAtRaw === 'string') {
      createdMs = new Date(createdAtRaw).getTime()
      createdAtIso = createdAtRaw
    }
    if (!Number.isFinite(createdMs) || createdMs < earliest) return

    const amount = Number(data.finalAmount ?? data.totalAmount ?? 0)
    if (!(amount > 0)) return

    const list = out.get(phone) ?? []
    list.push({ amount, createdAt: createdAtIso })
    out.set(phone, list)
  }

  // Firestore web SDK supports up to 30 values per `in` clause.
  for (let i = 0; i < phones.length; i += 30) {
    const chunk = phones.slice(i, i + 30)

    // 1. by customerPhone
    const cpSnap = await getDocs(query(bookingsCol, where('customerPhone', 'in', chunk)))
    cpSnap.docs.forEach((d) => handleBooking(d.id, d.data() as Record<string, unknown>))

    // 2. by userPhone (some legacy bookings only set this)
    const upSnap = await getDocs(query(bookingsCol, where('userPhone', 'in', chunk)))
    upSnap.docs.forEach((d) => handleBooking(d.id, d.data() as Record<string, unknown>))
  }

  return out
}

// ─── Public API ─────────────────────────────────────────────────────

export const couponOutreachReportApi = {
  /**
   * Compute the report for a date range. `fromDate` and `toDate` are
   * inclusive YYYY-MM-DD strings (in IST). Default range is today.
   * Admin-only — telecallers cannot pull pipeline-wide reports.
   */
  async computeReport(
    token: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<CouponOutreachReport> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role)) {
      throw new Error('Only admins can view coupon outreach reports.')
    }
    await ensureAnonymousAuth()
    const fs = requireFirestore()

    const today = istDateString()
    const from = fromDate || today
    const to = toDate || from

    const dates = eachDayInclusive(from, to)
    if (dates.length === 0) {
      throw new Error('Invalid date range.')
    }

    // 1. Read every batch in the range, plus its items
    const batches: CouponOutreachBatch[] = []
    const items: Array<{
      phone: string
      assignedTo: string
      status: CouponOutreachStatus
      createdAt: string
    }> = []
    const attributionStart = new Map<string, number>()

    for (const date of dates) {
      const headerRef = doc(fs, 'couponOutreachBatches', date)
      const headerSnap = await getDoc(headerRef)
      if (!headerSnap.exists()) continue

      const header = parseBatchHeader(headerSnap.id, headerSnap.data() as Record<string, unknown>)
      batches.push(header)

      const itemsSnap = await getDocs(collection(headerRef, 'items'))
      const headerCreatedMs = new Date(header.createdAt).getTime() || 0

      itemsSnap.docs.forEach((d) => {
        const row = parseItemRow(d.id, d.data() as Record<string, unknown>)
        items.push(row)
        // Earliest attribution timestamp wins (for items present in
        // multiple batches across the range, e.g. cooldown grace period)
        const existing = attributionStart.get(row.phone)
        if (existing == null || headerCreatedMs < existing) {
          attributionStart.set(row.phone, headerCreatedMs)
        }
      })
    }

    if (items.length === 0) {
      logger.info('coupon_outreach.report_empty', { from, to })
      return {
        fromDate: from,
        toDate: to,
        batches,
        summary: {
          totalAssigned: 0,
          pending: 0,
          contacted: 0,
          done: 0,
          skipped: 0,
          callsCompleted: 0,
          convertedBookings: 0,
          missedCalls: 0,
          conversionRate: 0,
        },
        revenue: { totalRevenue: 0, averageTicket: 0 },
        perTelecaller: [],
      }
    }

    // 2. Fetch matching bookings (read-only)
    const phones = Array.from(new Set(items.map((it) => it.phone)))
    const conversionsByPhone = await fetchConversionsForPhones(fs, phones, attributionStart)

    // 3. Aggregate (pure)
    const aggregated = aggregateReport({ items, conversionsByPhone })

    logger.info('coupon_outreach.report_computed', {
      from,
      to,
      batches: batches.length,
      items: items.length,
      conversions: aggregated.summary.convertedBookings,
      revenue: aggregated.revenue.totalRevenue,
    })

    return {
      fromDate: from,
      toDate: to,
      batches,
      summary: aggregated.summary,
      revenue: aggregated.revenue,
      perTelecaller: aggregated.perTelecaller,
    }
  },
}

// Re-export pure helpers for tests (kept at module bottom so they don't
// pollute the main API surface).
export const __test__ = {
  aggregateReport,
  eachDayInclusive,
}
