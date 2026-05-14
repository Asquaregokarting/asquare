import { listFirestoreActivityCatalog } from './activity-catalog-firestore'
import { BookingScope, isFirestoreBillingActive, listAllBookings } from './billing-firestore'
import { ShiftRecord } from './shifts'
import { isFirestoreShiftsActive, listFirestoreShifts } from './shifts-firestore'
import {
  buildFirestoreCallHistory,
  buildFirestoreStaffInsights,
  isFirestoreSuperfoneActive,
  listFirestoreSuperfoneEvents,
} from './superfone-firestore'
import { listTrackMarshallShifts } from './track-marshall-shifts-firestore'
import {
  BranchGameRevenueBreakdown,
  GameRevenueReportRecord,
  GameRevenueRow,
  GameTransactionDetail,
  LocationRevenueRow,
  OperationsReportRecord,
  RevenueReportRecord,
  ShiftSummaryReportRecord,
  TrackMarshallShiftRecord,
  TransactionRecord,
} from './types'
import { listFirestoreUsers } from './users-firestore'
import { nowIso } from './firestore-utils'
import { getLocationDisplayName } from '../../lib/locations'
import { isTerminatedBooking } from '../../lib/booking-filter'
import { todayIST } from '../lib/ist-date'

const matchesIsoDateRange = (
  value: string | undefined,
  query?: { from?: string; to?: string },
): boolean => {
  const iso = String(value ?? '').trim()
  if (!iso) {
    return false
  }
  const dateOnly = iso.slice(0, 10)
  if (query?.from && dateOnly < query.from) {
    return false
  }
  if (query?.to && dateOnly > query.to) {
    return false
  }
  return true
}

const paymentMethodKey = (value: unknown): string => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!normalized) {
    return 'Unknown'
  }
  if (normalized === 'upi') return 'UPI'
  if (normalized === 'cash') return 'Cash'
  if (normalized === 'card') return 'Card'
  if (normalized === 'razorpay' || normalized === 'online' || normalized === 'link')
    return 'Razorpay'
  if (normalized === 'split') return 'Split'
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

const toShiftHours = (shift: ShiftRecord): number => {
  if (typeof shift.totalActiveHours === 'number' && Number.isFinite(shift.totalActiveHours)) {
    return shift.totalActiveHours
  }
  if (!shift.endTime) {
    return Math.max(
      0,
      Number(((Date.now() - new Date(shift.startTime).getTime()) / (1000 * 60 * 60)).toFixed(2)),
    )
  }
  return Math.max(
    0,
    Number(
      (
        (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) /
        (1000 * 60 * 60)
      ).toFixed(2),
    ),
  )
}

const toTrackMarshallHours = (shift: TrackMarshallShiftRecord): number => {
  if (typeof shift.totalActiveHours === 'number' && Number.isFinite(shift.totalActiveHours)) {
    return shift.totalActiveHours
  }
  const endMs = shift.logoutTime ? new Date(shift.logoutTime).getTime() : Date.now()
  return Math.max(
    0,
    Number(((endMs - new Date(shift.loginTime).getTime()) / (1000 * 60 * 60)).toFixed(2)),
  )
}

/**
 * Canonical booking reader — single source of truth.
 * Returns all bookings from billing-firestore as TransactionRecord[].
 *
 * When a date range is provided, pushes a `createdAt >= (from - 1 day)`
 * filter into the Firestore query so large bookings collections don't
 * have to be fully downloaded on every report render. The 1-day buffer
 * absorbs any drift between `createdAt` and `transactionDate`, and the
 * existing in-memory `transactionDate` filter in `filterPaidBookings`
 * then enforces exact semantics — so behaviour is unchanged.
 */
const readAllBookings = async (opts?: {
  fromCreatedAt?: string
  scope?: BookingScope
}): Promise<TransactionRecord[]> => {
  try {
    return await listAllBookings(opts)
  } catch {
    return []
  }
}

/**
 * Subtract `days` whole days from a YYYY-MM-DD string. Returns the same
 * YYYY-MM-DD shape so Firestore string comparisons stay lexicographic-safe.
 */
const subtractDaysIso = (dateStr: string, days: number): string => {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  if (!Number.isFinite(d.getTime())) return dateStr
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Filter bookings to only completed, non-terminated transactions within a
 * date range. Uses the canonical `isTerminatedBooking` helper so all four
 * terminal signals (`cancelled`, `bookingStatus: 'cancelled'`, `deletedAt`,
 * `voidedAt`) are excluded — previously this only filtered `cancelled` and
 * `deletedAt`, missing the AllBookingsView "Cancel" path and any voided
 * markers.
 */
const filterPaidBookings = (
  bookings: TransactionRecord[],
  dateRange?: { from?: string; to?: string },
): TransactionRecord[] =>
  bookings.filter((txn) => {
    if (txn.paymentStatus === 'pending' || txn.paymentStatus === 'failed') return false
    if (isTerminatedBooking(txn as unknown as Record<string, unknown>)) return false
    return matchesIsoDateRange(txn.transactionDate, dateRange)
  })

/**
 * Revenue net of refunds for a single transaction. All revenue rollups in this
 * file use this so the dashboard / reports show takings the customer actually
 * keeps, not the gross sale price. Refunded bookings stay in the result set
 * (they're still completed sales) — only the refunded amount is subtracted.
 */
const netRevenue = (txn: TransactionRecord): number =>
  Number(txn.totalAmount || 0) - Number(txn.refundAmount ?? 0)

/**
 * Game-Revenue-specific booking filter. Stricter than filterPaidBookings:
 * requires paymentStatus === 'completed' explicitly and excludes
 * fully-refunded bookings. Used only by buildFirestoreGameRevenueReport.
 *
 * Date filtering uses transactionDate, which mapTransactionRecord already
 * normalizes to an IST-aware ISO string from either Firestore Timestamp or
 * legacy ISO string sources (with createdAt fallback for old App bookings).
 * This avoids the broken server-side `where('createdAt', '>=', ...)` filter
 * that silently dropped Firestore-Timestamp documents from App bookings.
 */
const filterGameRevenueBookings = (
  bookings: TransactionRecord[],
  dateRange?: { from?: string; to?: string },
): TransactionRecord[] =>
  bookings.filter((txn) => {
    if (txn.paymentStatus !== 'completed') return false
    if (txn.refundStatus === 'Full') return false
    // Canonical terminator check — replaces inline cancelled/deletedAt
    // pair so voidedAt and bookingStatus='cancelled' get filtered too.
    if (isTerminatedBooking(txn as unknown as Record<string, unknown>)) return false
    return matchesIsoDateRange(txn.transactionDate, dateRange)
  })

export const isFirestoreReportsActive = (): boolean =>
  isFirestoreSuperfoneActive() || isFirestoreBillingActive() || isFirestoreShiftsActive()

export const buildFirestoreOperationsReport = async (
  _token: string,
  scope?: BookingScope,
): Promise<OperationsReportRecord> => {
  // Operations report only cares about today's bookings. Push a
  // server-side filter for rows created in the last 2 days (1-day buffer
  // either side of the IST boundary) so a 100k-row collection becomes a
  // tiny indexed read.
  const fromCreatedAt = subtractDaysIso(todayIST(), 1)
  const [superfoneResult, users, allBookings, trackMarshallShifts] = await Promise.all([
    isFirestoreSuperfoneActive()
      ? listFirestoreSuperfoneEvents({ limit: 500, from: todayIST() })
      : Promise.resolve({
          events: [],
          stats: { total: 0, inbound: 0, outbound: 0, answered: 0, missed: 0 },
        }),
    listFirestoreUsers({ role: 'Telecaller', status: 'Active' }).catch(() => []),
    readAllBookings({ fromCreatedAt, scope }),
    listTrackMarshallShifts().catch(() => []),
  ])

  const today = todayIST()
  const paidToday = filterPaidBookings(allBookings, { from: today, to: today })
  const posTxns = paidToday.filter((t) => classifySource(t) === 'POS')
  const bookingTxns = paidToday.filter((t) => classifySource(t) !== 'POS')
  const bookingRevenueToday = bookingTxns.reduce((sum, t) => sum + netRevenue(t), 0)
  const posRevenueToday = posTxns.reduce((sum, t) => sum + netRevenue(t), 0)
  const activeTrackMarshallToday = trackMarshallShifts.filter((shift) =>
    matchesIsoDateRange(shift.loginTime, { from: today, to: today }),
  )

  const incomingCalls = superfoneResult.events.filter((e) => e.callDirection === 'Incoming').length
  const outgoingCalls = superfoneResult.events.filter((e) => e.callDirection === 'Outgoing').length
  const missedCalls = superfoneResult.events.filter((e) =>
    e.disposition.toLowerCase().includes('miss'),
  ).length

  return {
    generatedAt: nowIso(),
    totalCalls: superfoneResult.events.length,
    incomingCalls,
    outgoingCalls,
    missedCalls,
    totalTalkSeconds: superfoneResult.events.reduce(
      (sum, event) => sum + Math.max(0, event.talkSeconds ?? event.durationSec ?? 0),
      0,
    ),
    telecallerCount: users.length,
    bookingCount: paidToday.length,
    paidBookingCount: paidToday.length,
    totalRevenue: bookingRevenueToday + posRevenueToday,
    bookingRevenue: bookingRevenueToday,
    posRevenue: posRevenueToday,
    trackMarshallShiftCount: activeTrackMarshallToday.length,
    trackMarshallActiveHours: Number(
      activeTrackMarshallToday
        .reduce((sum, shift) => sum + toTrackMarshallHours(shift), 0)
        .toFixed(2),
    ),
  }
}

export const buildFirestoreRevenueReport = async (
  query?: {
    from?: string
    to?: string
  },
  scope?: BookingScope,
): Promise<RevenueReportRecord> => {
  // Push the lower bound of the requested date range (minus 1 day of
  // buffer) into Firestore so that only rows potentially in range are
  // downloaded. The existing `filterPaidBookings` call still enforces
  // exact `transactionDate` semantics in memory, so results are identical
  // to the old full-scan path.
  const fromCreatedAt = query?.from ? subtractDaysIso(query.from, 1) : undefined
  const allBookings = await readAllBookings({
    fromCreatedAt,
    scope,
  })
  const filtered = filterPaidBookings(allBookings, query)

  const posTxns = filtered.filter((t) => classifySource(t) === 'POS')
  const bookingTxns = filtered.filter((t) => classifySource(t) !== 'POS')

  const posRevenue = posTxns.reduce((sum, t) => sum + netRevenue(t), 0)
  const bookingRevenue = bookingTxns.reduce((sum, t) => sum + netRevenue(t), 0)
  const totalRevenue = posRevenue + bookingRevenue
  const totalTransactions = filtered.length

  // Decompose Split payments into their component methods (Cash, UPI, Card).
  // For partial refunds, scale each split component by (net/gross) so the
  // Cash/UPI/Card columns add up to the same net total used in the headline.
  const paymentMethodBreakdown = filtered.reduce<Record<string, number>>((acc, t) => {
    const method = paymentMethodKey(t.paymentMethod)
    if (method === 'Split') {
      const gross = Number(t.totalAmount || 0)
      const factor = gross > 0 ? netRevenue(t) / gross : 0
      if (t.splitCash) acc.Cash = (acc.Cash ?? 0) + t.splitCash * factor
      if (t.splitUpi) acc.UPI = (acc.UPI ?? 0) + t.splitUpi * factor
      if (t.splitCard) acc.Card = (acc.Card ?? 0) + t.splitCard * factor
    } else {
      acc[method] = (acc[method] ?? 0) + netRevenue(t)
    }
    return acc
  }, {})

  const refundedTxns = filtered.filter((t) => t.refundStatus !== 'None')

  return {
    generatedAt: nowIso(),
    totalRevenue,
    bookingRevenue,
    posRevenue,
    totalTransactions,
    averageTransactionValue: totalTransactions > 0 ? totalRevenue / totalTransactions : 0,
    paymentMethodBreakdown,
    refundsCount: refundedTxns.length,
    refundsValue: refundedTxns.reduce((sum, t) => sum + (t.refundAmount ?? 0), 0),
  }
}

export const buildFirestoreShiftSummaryReport = async (
  token: string,
  query?: { from?: string; to?: string },
): Promise<ShiftSummaryReportRecord> => {
  const [standardShifts, trackMarshallShifts] = await Promise.all([
    isFirestoreShiftsActive() ? listFirestoreShifts(token, query) : Promise.resolve([]),
    listTrackMarshallShifts().catch(() => []),
  ])

  const filteredTrackMarshall = trackMarshallShifts.filter((shift) =>
    matchesIsoDateRange(shift.loginTime, query),
  )
  const byRole = standardShifts.reduce<Record<string, number>>((accumulator, shift) => {
    accumulator[shift.role] = (accumulator[shift.role] ?? 0) + 1
    return accumulator
  }, {})
  byRole.TrackMarshall = (byRole.TrackMarshall ?? 0) + filteredTrackMarshall.length

  return {
    generatedAt: nowIso(),
    totalShiftCount: standardShifts.length + filteredTrackMarshall.length,
    totalActiveHours: Number(
      (
        standardShifts.reduce((sum, shift) => sum + toShiftHours(shift), 0) +
        filteredTrackMarshall.reduce((sum, shift) => sum + toTrackMarshallHours(shift), 0)
      ).toFixed(2),
    ),
    byRole,
    trackMarshallShiftCount: filteredTrackMarshall.length,
    trackMarshallActiveHours: Number(
      filteredTrackMarshall.reduce((sum, shift) => sum + toTrackMarshallHours(shift), 0).toFixed(2),
    ),
    shifts: standardShifts.map((shift) => ({
      id: shift.id,
      userId: shift.userId,
      role: shift.role,
      locationId: shift.locationId,
      locationName: shift.locationName,
      startTime: shift.startTime,
      endTime: shift.endTime,
      totalActiveHours: toShiftHours(shift),
    })),
    trackMarshallShifts: filteredTrackMarshall,
  }
}

const normalizeGameName = (name: unknown): string => {
  const raw = String(name ?? '').trim()
  if (!raw) return 'Unknown'
  return raw
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Extract the top-level game name from a compound item name.
 * E.g. "Gokarting — Child — Child 8 Laps" → "Gokarting"
 */
const extractTopLevelName = (name: string): string => {
  const top = name.split(/\s*[—•]\s*/)[0].trim()
  return top || name.trim()
}

/**
 * Resolve game name from item data using a multi-level fallback:
 *   1. gameId → catalog lookup for gameName (most reliable)
 *   2. itemName → extract top-level game name
 *   3. activity.category (category = gameName in the catalog)
 *   4. activity.name → extract top-level game name
 *   5. "Unknown" as absolute last resort
 */
const resolveGameName = (
  item: {
    itemName?: string
    gameId?: string
    activity?: { name?: string; category?: string }
  },
  catalogByGameId: Map<string, string>,
): string => {
  // 1. gameId → catalog lookup
  if (item.gameId) {
    const name = catalogByGameId.get(item.gameId)
    if (name) return normalizeGameName(name)
  }

  // 2. itemName (non-empty) → extract top-level game name
  const itemName = String(item.itemName ?? '').trim()
  if (itemName) return normalizeGameName(extractTopLevelName(itemName))

  // 3. activity.category (this IS gameName in the catalog)
  const category = String(item.activity?.category ?? '').trim()
  if (category) return normalizeGameName(category)

  // 4. activity.name → extract top-level
  const activityName = String(item.activity?.name ?? '').trim()
  if (activityName) return normalizeGameName(extractTopLevelName(activityName))

  return 'Unknown'
}

/**
 * Classify the source of a booking document. Handles both modern documents
 * (with explicit `source` field) and legacy ones (heuristic fallback).
 */
const classifySource = (
  txn: TransactionRecord,
): 'APP_BOOKING' | 'ADMIN_BOOKING' | 'TELECALLER_BOOKING' | 'POS' => {
  const source = String(txn.source ?? '').trim()
  const role = String(txn.createdByRole ?? '').toLowerCase()

  if (source === 'POS') return 'POS'

  // Check telecaller before generic admin — telecaller bookings are a subset of admin bookings
  const isTelecaller = role === 'telecaller'
  if (source === 'ADMIN_BOOKING') return isTelecaller ? 'TELECALLER_BOOKING' : 'ADMIN_BOOKING'
  if (source === 'APP_BOOKING' || source === 'Booking') return 'APP_BOOKING'

  // Legacy heuristics for documents without an explicit source field.
  // POS transactions always have sourceType "BILLING".
  if (txn.sourceType === 'BILLING') return 'POS'
  // Admin/telecaller bookings created through the pipeline always have sourceType set.
  if (txn.createdBy && txn.sourceType) return isTelecaller ? 'TELECALLER_BOOKING' : 'ADMIN_BOOKING'
  // Payment-link bookings: createdBy exists + createdByRole set, but sourceType may be absent
  if (txn.createdBy && role) return isTelecaller ? 'TELECALLER_BOOKING' : 'ADMIN_BOOKING'
  return 'APP_BOOKING'
}

/**
 * Accumulate game-wise revenue from a list of filtered bookings.
 * Reusable for both the global aggregate and per-branch breakdowns.
 */
const sourceLabel = (
  source: 'APP_BOOKING' | 'ADMIN_BOOKING' | 'TELECALLER_BOOKING' | 'POS',
): 'POS' | 'Booking' | 'Admin' | 'Telecaller' =>
  source === 'POS'
    ? 'POS'
    : source === 'ADMIN_BOOKING'
      ? 'Admin'
      : source === 'TELECALLER_BOOKING'
        ? 'Telecaller'
        : 'Booking'

const accumulateGameRevenue = (
  txns: TransactionRecord[],
  catalogByGameId: Map<string, string>,
  collectTransactions = false,
): {
  totalRevenue: number
  transactionCount: number
  gameBreakdown: GameRevenueRow[]
  transactionsByGame: Record<string, GameTransactionDetail[]>
} => {
  // Use a Set<string> of booking IDs per game so that a booking with N items for the
  // same game is counted as exactly 1 transaction, not N.
  const acc = new Map<
    string,
    {
      totalRevenue: number
      bookingRevenue: number
      posRevenue: number
      adminBookingRevenue: number
      telecallerRevenue: number
      bookingIds: Set<string>
    }
  >()
  const txnAcc: Record<string, GameTransactionDetail[]> = {}

  const ensure = (name: string) => {
    if (!acc.has(name)) {
      acc.set(name, {
        totalRevenue: 0,
        bookingRevenue: 0,
        posRevenue: 0,
        adminBookingRevenue: 0,
        telecallerRevenue: 0,
        bookingIds: new Set<string>(),
      })
    }
    return acc.get(name)!
  }

  const addRevenue = (
    row: ReturnType<typeof ensure>,
    revenue: number,
    source: 'APP_BOOKING' | 'ADMIN_BOOKING' | 'TELECALLER_BOOKING' | 'POS',
    bookingId: string,
  ) => {
    row.totalRevenue += revenue
    row.bookingIds.add(bookingId)
    if (source === 'POS') row.posRevenue += revenue
    else if (source === 'TELECALLER_BOOKING') row.telecallerRevenue += revenue
    else if (source === 'ADMIN_BOOKING') row.adminBookingRevenue += revenue
    else row.bookingRevenue += revenue
  }

  const pushTxn = (
    gameName: string,
    txn: TransactionRecord,
    revenue: number,
    source: 'APP_BOOKING' | 'ADMIN_BOOKING' | 'TELECALLER_BOOKING' | 'POS',
    matchedItems: string[],
  ) => {
    if (!collectTransactions) return
    if (!txnAcc[gameName]) txnAcc[gameName] = []
    txnAcc[gameName].push({
      bookingId: txn.id,
      dateTime: txn.transactionDate,
      amount: revenue,
      source: sourceLabel(source),
      paymentStatus: String(txn.paymentStatus ?? 'unknown'),
      locationId: txn.locationId || '',
      locationName: txn.locationId ? getLocationDisplayName(txn.locationId) : '',
      items: matchedItems,
    })
  }

  for (const txn of txns) {
    const source = classifySource(txn)
    // Use net (gross − refundAmount) so per-game numbers add up to the
    // headline net total. Refunded items are still counted, but the
    // refund is distributed pro-rata across all items in the txn.
    const totalAmount = netRevenue(txn)

    if (txn.items && txn.items.length > 0) {
      const itemsTotal = txn.items.reduce((sum, item) => {
        return sum + (item.itemBaseAmount ?? item.quantity * item.unitPrice)
      }, 0)
      const byGame = new Map<string, { revenue: number; items: string[] }>()
      for (const item of txn.items) {
        const gameName = resolveGameName(
          { itemName: item.itemName, gameId: item.gameId },
          catalogByGameId,
        )
        const itemAmount = item.itemBaseAmount ?? item.quantity * item.unitPrice
        const revenue =
          itemsTotal > 0
            ? Math.round((itemAmount / itemsTotal) * totalAmount)
            : Math.round(totalAmount / txn.items.length)
        addRevenue(ensure(gameName), revenue, source, txn.id)
        if (collectTransactions) {
          if (!byGame.has(gameName)) byGame.set(gameName, { revenue: 0, items: [] })
          const entry = byGame.get(gameName)!
          entry.revenue += revenue
          entry.items.push(item.itemName ?? gameName)
        }
      }
      for (const [gameName, entry] of byGame) {
        pushTxn(gameName, txn, entry.revenue, source, entry.items)
      }
    } else {
      addRevenue(ensure('Other'), totalAmount, source, txn.id)
      pushTxn('Other', txn, totalAmount, source, ['Other'])
    }
  }

  const grandTotal = Array.from(acc.values()).reduce((sum, r) => sum + r.totalRevenue, 0)

  const gameBreakdown: GameRevenueRow[] = Array.from(acc.entries())
    .map(([gameName, data]) => ({
      gameName,
      totalRevenue: data.totalRevenue,
      bookingRevenue: data.bookingRevenue,
      posRevenue: data.posRevenue,
      adminBookingRevenue: data.adminBookingRevenue,
      telecallerRevenue: data.telecallerRevenue,
      transactionCount: data.bookingIds.size,
      contributionPercent:
        grandTotal > 0 ? Math.round((data.totalRevenue / grandTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue)

  for (const details of Object.values(txnAcc)) {
    details.sort((a, b) => b.dateTime.localeCompare(a.dateTime))
  }

  return {
    totalRevenue: grandTotal,
    transactionCount: txns.length,
    gameBreakdown,
    transactionsByGame: txnAcc,
  }
}

/**
 * Aggregate revenue at the location/branch level from filtered bookings.
 * Reuses the same classifySource() logic for source breakdown.
 */
const accumulateLocationRevenue = (
  txns: TransactionRecord[],
  globalTotalRevenue: number,
): LocationRevenueRow[] => {
  const acc = new Map<
    string,
    {
      totalRevenue: number
      bookingRevenue: number
      posRevenue: number
      adminBookingRevenue: number
      telecallerRevenue: number
      transactionCount: number
    }
  >()

  for (const txn of txns) {
    if (!txn.locationId) continue
    const locId = txn.locationId
    const source = classifySource(txn)
    const amount = netRevenue(txn)

    if (!acc.has(locId)) {
      acc.set(locId, {
        totalRevenue: 0,
        bookingRevenue: 0,
        posRevenue: 0,
        adminBookingRevenue: 0,
        telecallerRevenue: 0,
        transactionCount: 0,
      })
    }
    const row = acc.get(locId)!
    row.totalRevenue += amount
    row.transactionCount += 1
    if (source === 'POS') row.posRevenue += amount
    else if (source === 'TELECALLER_BOOKING') row.telecallerRevenue += amount
    else if (source === 'ADMIN_BOOKING') row.adminBookingRevenue += amount
    else row.bookingRevenue += amount
  }

  return Array.from(acc.entries())
    .map(([locationId, data]) => ({
      locationId,
      locationName: getLocationDisplayName(locationId),
      ...data,
      contributionPercent:
        globalTotalRevenue > 0
          ? Math.round((data.totalRevenue / globalTotalRevenue) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
}

export const buildFirestoreGameRevenueReport = async (
  query?: {
    from?: string
    to?: string
  },
  scope?: BookingScope,
): Promise<GameRevenueReportRecord> => {
  // Fetch the full bookings collection — NO server-side createdAt filter.
  // The `bookings` collection stores `createdAt` in mixed formats (Firestore
  // Timestamp for App bookings, ISO string for POS/Admin), and Firestore's
  // cross-type comparison silently drops Timestamp documents when compared
  // against a string, which previously zeroed out this report. The
  // transactionDate-based in-memory filter below still enforces exact
  // IST date-range semantics across both formats because mapTransactionRecord
  // normalizes transactionDate from either source.
  const [allBookings, catalogRecords] = await Promise.all([
    readAllBookings({ scope }),
    listFirestoreActivityCatalog().catch(() => []),
  ])

  // Build gameId → gameName lookup from the activity catalog
  const catalogByGameId = new Map<string, string>()
  for (const record of catalogRecords) {
    if (record.gameId && record.gameName && !catalogByGameId.has(record.gameId)) {
      catalogByGameId.set(record.gameId, record.gameName)
    }
  }

  // Game-Revenue-specific filtering: paymentStatus === 'completed', not
  // cancelled, not fully refunded, and transactionDate in IST date range.
  const filteredBookings = filterGameRevenueBookings(allBookings, query)

  // Global "All Branches" aggregate (with transaction details)
  const globalResult = accumulateGameRevenue(filteredBookings, catalogByGameId, true)

  // Location-level revenue breakdown
  const locationBreakdown = accumulateLocationRevenue(filteredBookings, globalResult.totalRevenue)

  // Group by branch for per-location breakdowns
  const byLocation = new Map<string, TransactionRecord[]>()
  for (const txn of filteredBookings) {
    if (!txn.locationId) continue
    const locId = txn.locationId
    if (!byLocation.has(locId)) byLocation.set(locId, [])
    byLocation.get(locId)!.push(txn)
  }

  const branchBreakdowns: BranchGameRevenueBreakdown[] = Array.from(byLocation.entries())
    .map(([locationId, branchTxns]) => {
      const result = accumulateGameRevenue(branchTxns, catalogByGameId)
      return {
        locationId,
        displayName: getLocationDisplayName(locationId),
        totalRevenue: result.totalRevenue,
        transactionCount: result.transactionCount,
        gameBreakdown: result.gameBreakdown,
      }
    })
    .sort((a, b) => b.totalRevenue - a.totalRevenue)

  return {
    generatedAt: nowIso(),
    totalRevenue: globalResult.totalRevenue,
    gameBreakdown: globalResult.gameBreakdown,
    locationBreakdown,
    branchBreakdowns,
    transactionsByGame: globalResult.transactionsByGame,
  }
}

export { buildFirestoreCallHistory, buildFirestoreStaffInsights }
