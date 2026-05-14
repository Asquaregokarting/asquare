import { getAuth } from 'firebase/auth'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { ensureFirebaseAuthForStorage } from '../lib/firebase-auth'
import { initializeFirebaseApp } from '../lib/firebase'
import { ensureUniqueOrderNumber } from '../../lib/unified-booking'
import { logger } from '../../lib/logger'

const INTERAKT_CONFIRM_FUNCTION_URL =
  'https://asia-south1-a-square-6720c.cloudfunctions.net/sendBookingConfirmationForUserBooking'
const INTERAKT_PAYMENT_LINK_FUNCTION_URL =
  'https://asia-south1-a-square-6720c.cloudfunctions.net/sendRazorpayPaymentLink'
const RESCHEDULE_NOTIFICATION_URL =
  'https://asia-south1-a-square-6720c.cloudfunctions.net/sendRescheduleNotification'
const PAYMENT_FAILED_NOTIFICATION_URL =
  'https://asia-south1-a-square-6720c.cloudfunctions.net/sendPaymentFailedNotification'
const DEFAULT_FIRESTORE_DATABASE_ID = 'asquare-app-db'
const FIRESTORE_DATABASE_ID =
  (import.meta.env.VITE_ASQUARE_BOOKINGS_FIRESTORE_DATABASE_ID as string | undefined)?.trim() ||
  DEFAULT_FIRESTORE_DATABASE_ID

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no-show'
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded'
export type CheckInStatus = 'pending' | 'completed' | 'boarded'

export interface AsquareBookingActivity {
  id: string
  apiId?: string
  /** Catalog game identifier (e.g. "gokarting", "trampolinepark"). */
  gameTypeId?: string
  name: string
  description?: string
  basePrice?: number
  category?: string
  image?: string
  duration?: number
  available?: boolean
  locationIds?: string[]
  availableDates?: string[]
  startDate?: string
  endDate?: string
  schedule?: Array<{
    locationId: string
    startDate: string
    endDate: string
  }>
  /**
   * Third-party vendor that supplies this item (event packages, helicopter,
   * etc.). Read by onBookingPaid / writeEventPackageVendorLedger to credit
   * the vendor at payment completion.
   */
  vendorId?: string
  /**
   * When `false`, overrides the vendor's default revenueShare to 100%.
   * Used by event-package items that pay the vendor the full gross while
   * the company keeps nothing on that line.
   */
  revenueShare?: boolean
  /**
   * Snapshot of the activity's Interakt booking-confirmation template at
   * the time the booking was created. Stored on the booking so a later
   * config change doesn't retroactively alter resends. Falls back to
   * BookingConfirmationConfig.defaultTemplateId when missing.
   */
  interaktTemplateId?: string
  /** Snapshot of the template language at booking time. */
  interaktTemplateLanguage?: string
  /**
   * When true, the bill printer prints one token per quantity instead of a
   * single token with a "Quantity: Nx" line. Snapshotted from the activity
   * catalog at booking creation time so it survives into resends and
   * matches POS behavior.
   */
  printIndividualTokens?: boolean
}

export interface AsquareBookingItem {
  /**
   * Optional: items written by the orphan resolver / unified-booking carry
   * `itemName` instead of an `activity` object. Display code should prefer
   * itemName, fall back to activity.name.
   */
  itemName?: string
  activity?: AsquareBookingActivity
  quantity: number
  duration: number
  date: string
  timeSlot: string
  price: number
  unitPrice?: number
  gameId?: string
  subGameId?: string
  variantId?: string
  vendorId?: string
}

export interface AsquareBooking {
  id: string
  userId: string
  locationId: string
  items: AsquareBookingItem[]
  totalAmount: number
  discountAmount: number
  finalAmount: number
  paymentStatus: PaymentStatus
  bookingStatus: BookingStatus
  qrCode: string
  createdAt: Date
  sessionDate: Date
  paymentCompletedAt?: Date
  tires: number
  paymentMethod?: string
  paymentId?: string
  razorpayOrderId?: string
  razorpaySignature?: string
  checkInStatus?: CheckInStatus
  passengers?: Array<{
    name: string
    weight: number
    age?: number
    gender?: 'male' | 'female' | 'other'
  }>
  createdByAdminId?: string
  createdByAdminName?: string
  createdByRole?: string
  userDisplayName?: string
  userPhone?: string
  paymentLinkStatus?: string
  source?: string
  sourceType?: string
  /** Audit trail of in-store activity swaps (customer arrived, original game unavailable, swapped to another). */
  swapHistory?: BookingSwapEvent[]
  /**
   * Soft-delete marker. When set, the booking is in Trash: hidden from
   * the live `listAdminBookings` result, kept on disk so it can be
   * restored. Permanent delete (from Trash UI) clears the doc entirely
   * and writes a frozen copy to `deleted_bookings/`.
   */
  deletedAt?: Date
  /** Actor who soft-deleted the booking. Set together with `deletedAt`. */
  deletedBy?: AdminActor
  /** Optional human reason captured at soft-delete time. */
  deletionReason?: string
  [key: string]: unknown
}

/**
 * Records one in-store activity swap. Written when a customer arrives and the
 * originally booked game is unavailable (equipment down, fully booked, etc.)
 * and staff substitute another activity, settling the price difference via
 * wallet, cash, or "no adjustment".
 */
export interface BookingSwapEvent {
  /** Stable id — used as the wallet idempotency key so retries don't double-credit. */
  eventId: string
  /** Index in booking.items[] that was replaced. */
  itemIndex: number
  from: {
    activityId: string
    activityName: string
    vendorId?: string
    unitPrice: number
    quantity: number
  }
  to: {
    activityId: string
    activityName: string
    vendorId?: string
    unitPrice: number
    quantity: number
  }
  /** newLineTotal - oldLineTotal. Positive = customer owes extra, negative = refund due. */
  priceDelta: number
  /** How the delta was settled. */
  settlement: 'wallet_credit' | 'wallet_debit' | 'external_cash' | 'no_adjustment'
  /** Wallet amount actually moved (always positive when settlement involves wallet). */
  walletAmount?: number
  reason: string
  by: AdminActor
  at: Date
}

export interface AdminActor {
  id: string
  name: string
  role: string
}

export interface CreatePendingBookingParams {
  userId: string
  locationId: string
  items: AsquareBookingItem[]
  totalAmount: number
  discountAmount: number
  finalAmount: number
  paymentMethod: 'link'
  mobile: string
  name: string
  email?: string
  scheduleDate?: string
  adminId?: string
  adminName?: string
  adminRole?: string
  /**
   * Optional coupon metadata persisted on the booking doc.
   * For ₹150 member coupon redemptions, pass `couponCode = 'MEMBER150x{count}'`
   * (see `buildMemberCouponSentinel`) and `couponAmount = count × 150`.
   * `completeBillingOnPayment()` parses the sentinel on payment success and
   * increments `coupons150Redeemed` on the member doc.
   */
  couponCode?: string
  couponAmount?: number
  /**
   * Optional idempotency token. Pass a stable UUID per submit-attempt; the
   * unified-booking writer will short-circuit if a booking with the same
   * token already exists. Defends against double-clicks, retries, and
   * cross-tab races. See `useSubmitGuard` / `newClientRequestId`.
   */
  clientRequestId?: string
}

import { getAllLocations, slugToBranchId, resolveLocation } from '../../lib/locations'

export const ADMIN_LOCATIONS = getAllLocations().map((l) => ({ id: l.slug, name: l.displayName }))

export const LOCATION_TO_BRANCH_ID: Record<string, string> = Object.fromEntries(
  getAllLocations().map((l) => [l.slug, l.branchId]),
)

const getAsquareFirestore = () => {
  const app = initializeFirebaseApp()
  if (!app) {
    throw new Error('Firebase app is not configured.')
  }
  return getFirestore(app, FIRESTORE_DATABASE_ID)
}

const toDate = (value: unknown): Date => {
  // Handle Firestore Timestamp objects
  if (value && typeof value === 'object' && 'toDate' in value) {
    const candidate = value as { toDate?: () => Date }
    if (typeof candidate.toDate === 'function') {
      return candidate.toDate()
    }
  }
  if (value instanceof Date) {
    return value
  }
  // Handle numeric timestamps (seconds or milliseconds)
  if (typeof value === 'number') {
    // Firestore seconds-based timestamps are < 1e12; JS milliseconds are >= 1e12
    return value < 1e12 ? new Date(value * 1000) : new Date(value)
  }
  // Handle ISO string or other string date formats
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  // Fallback: return epoch 0 so broken dates sort to the bottom, not the top
  // This makes missing/corrupt dates visible rather than silently hiding them
  return new Date(0)
}

const toOptionalDate = (value: unknown): Date | undefined => {
  if (value === null || value === undefined || value === '') {
    return undefined
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    const candidate = value as { toDate?: () => Date }
    if (typeof candidate.toDate === 'function') {
      return candidate.toDate()
    }
  }
  if (value instanceof Date) {
    return value
  }
  const parsed = new Date(String(value ?? ''))
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

const resolveLocationId = (raw: Record<string, unknown>): string => {
  const locationId = String(raw.locationId ?? '')
  if (locationId) {
    // resolveLocation checks slug, branchId, AND displayName maps,
    // so it normalizes all variants (e.g. "visakhapatnam", "0", "vizag") to the canonical slug.
    const resolved = resolveLocation(locationId)
    if (resolved) return resolved.slug
    return locationId
  }
  // Fall back to branchId field
  const branchId = String(raw.branchId ?? '')
  if (branchId) {
    const resolved = resolveLocation(branchId)
    if (resolved) return resolved.slug
    return branchId
  }
  return ''
}

export const parseBooking = (raw: Record<string, unknown>): AsquareBooking => {
  // Resolve sessionDate from multiple possible sources:
  // 1. sessionDate (standard) — can be Timestamp, Date, or string
  // 2. scheduleDate (legacy) — always a string like "2026-03-22"
  let sessionDate = toDate(raw.sessionDate)
  if (sessionDate.getTime() === 0 && raw.scheduleDate) {
    const sd = String(raw.scheduleDate)
    sessionDate = new Date(`${sd}T00:00:00Z`)
    if (isNaN(sessionDate.getTime())) sessionDate = new Date(0)
  }

  return {
    ...(raw as unknown as AsquareBooking),
    id: String(raw.id ?? ''),
    userId: String(raw.userId ?? ''),
    locationId: resolveLocationId(raw),
    userDisplayName: String(raw.userDisplayName ?? raw.name ?? ''),
    userPhone: String(raw.userPhone ?? raw.mobile ?? ''),
    totalAmount: Number(raw.totalAmount ?? raw.subTotal ?? 0),
    finalAmount: Number(raw.finalAmount ?? raw.amount ?? 0),
    discountAmount: Number(raw.discountAmount ?? raw.couponAmount ?? 0),
    paymentMethod: String(raw.paymentMethod ?? raw.paymentGateway ?? ''),
    createdAt: toDate(raw.createdAt),
    sessionDate,
    paymentCompletedAt: toOptionalDate(raw.paymentCompletedAt),
  }
}

import { normalizePhone } from '../features/leads/lead-utils'

const calculateTires = (amount: number): number => Math.floor(amount / 10)

const compactFirestoreValue = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (value instanceof Date) {
    return value
  }
  if ('toDate' in value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(compactFirestoreValue).filter((entry) => entry !== undefined)
  }
  // Class instances (Firestore SDK FieldValue sentinels — serverTimestamp,
  // arrayUnion, increment, deleteField, etc.) must pass through unchanged.
  // Recursing into them strips their prototype, turning the sentinel into
  // plain `{_methodName: 'serverTimestamp'}` data, which Firestore stores
  // as literal map data — surfacing on read as `createdAt: 1970-01-01`.
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    return value
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, compactFirestoreValue(entry)] as const)
    .filter(([, entry]) => entry !== undefined)
  return Object.fromEntries(entries)
}

const compactFirestoreDoc = <T extends Record<string, unknown>>(value: T): T =>
  compactFirestoreValue(value) as T

const generateQRCode = (bookingId: string, userId: string): string => {
  return `ASQUARE-${bookingId.toUpperCase()}-${userId.slice(-4).toUpperCase()}`
}

const isHelicopterItem = (item: AsquareBookingItem): boolean => {
  const name = String(item.activity?.name ?? '').toLowerCase()
  const category = String(item.activity?.category ?? '').toLowerCase()
  return name.includes('helicopter') || category.includes('helicopter')
}

const getIdTokenForCloudFunction = async (): Promise<string> => {
  const app = initializeFirebaseApp()
  if (!app) {
    throw new Error('Firebase app is not configured.')
  }

  const auth = getAuth(app)
  if (!auth.currentUser) {
    await ensureFirebaseAuthForStorage()
  }

  if (!auth.currentUser) {
    throw new Error('Not authenticated in Firebase.')
  }

  return auth.currentUser.getIdToken()
}

const matchesLocation = (activity: AsquareBookingActivity, locationId: string): boolean => {
  const branchId = slugToBranchId(locationId)
  if (Array.isArray(activity.locationIds) && activity.locationIds.length > 0) {
    const normalized = activity.locationIds.map((item) => String(item))
    return normalized.includes(branchId) || normalized.includes(locationId)
  }
  return true
}

const matchesDate = (
  activity: AsquareBookingActivity,
  locationId: string,
  sessionDate: string,
): boolean => {
  const branchId = LOCATION_TO_BRANCH_ID[locationId] ?? slugToBranchId(locationId)

  if (Array.isArray(activity.schedule) && activity.schedule.length > 0) {
    return activity.schedule.some((entry) => {
      if (String(entry.locationId) !== branchId) {
        return false
      }
      const start = String(entry.startDate).split('T')[0]
      const end = String(entry.endDate).split('T')[0]
      return sessionDate >= start && sessionDate <= end
    })
  }

  if (Array.isArray(activity.availableDates) && activity.availableDates.length > 0) {
    return activity.availableDates.includes(sessionDate)
  }

  if (activity.startDate && sessionDate < activity.startDate) {
    return false
  }
  if (activity.endDate && sessionDate > activity.endDate) {
    return false
  }

  return true
}

// Short-lived cache for the `activities` collection. `listBookableActivities`
// is hit repeatedly as admins switch dates/locations; without this every
// switch ran a full collection scan. 2-minute TTL matches how often the
// catalog realistically changes.
let _readActivitiesCache: { data: AsquareBookingActivity[]; timestamp: number } | null = null
let _readActivitiesInflight: Promise<AsquareBookingActivity[]> | null = null
const READ_ACTIVITIES_TTL = 2 * 60 * 1000

const readActivities = async (): Promise<AsquareBookingActivity[]> => {
  if (_readActivitiesCache && Date.now() - _readActivitiesCache.timestamp < READ_ACTIVITIES_TTL) {
    return _readActivitiesCache.data
  }
  if (_readActivitiesInflight) return _readActivitiesInflight

  _readActivitiesInflight = (async () => {
    const firestore = getAsquareFirestore()
    const snapshot = await getDocs(collection(firestore, 'activities'))
    const data = snapshot.docs
      .map((record) => {
        const data = record.data() as Record<string, unknown>
        return {
          id: String(data.id ?? record.id),
          apiId: typeof data.apiId === 'string' ? data.apiId : undefined,
          name: String(data.name ?? 'Activity'),
          description: typeof data.description === 'string' ? data.description : undefined,
          basePrice: Number(data.basePrice ?? data.offerPrice ?? 0),
          category: typeof data.category === 'string' ? data.category : undefined,
          image: typeof data.image === 'string' ? data.image : undefined,
          duration: Number(data.duration ?? 15),
          available: data.available !== false,
          locationIds: Array.isArray(data.locationIds)
            ? data.locationIds.map((item) => String(item))
            : undefined,
          availableDates: Array.isArray(data.availableDates)
            ? data.availableDates.map((item) => String(item))
            : undefined,
          startDate: typeof data.startDate === 'string' ? data.startDate : undefined,
          endDate: typeof data.endDate === 'string' ? data.endDate : undefined,
          schedule: Array.isArray(data.schedule)
            ? data.schedule
                .map((entry) => {
                  if (!entry || typeof entry !== 'object') {
                    return null
                  }
                  const row = entry as Record<string, unknown>
                  return {
                    locationId: String(row.locationId ?? ''),
                    startDate: String(row.startDate ?? ''),
                    endDate: String(row.endDate ?? ''),
                  }
                })
                .filter(
                  (entry): entry is { locationId: string; startDate: string; endDate: string } =>
                    Boolean(entry),
                )
            : undefined,
        } satisfies AsquareBookingActivity
      })
      .filter((item) => Boolean(item.name))
    _readActivitiesCache = { data, timestamp: Date.now() }
    return data
  })().finally(() => {
    _readActivitiesInflight = null
  })
  return _readActivitiesInflight
}

const postCloudFunction = async (
  url: string,
  payload: Record<string, unknown>,
  requireAuth: boolean,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> => {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (requireAuth) {
      const token = await getIdTokenForCloudFunction()
      headers.Authorization = `Bearer ${token}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

    if (!response.ok) {
      return {
        ok: false,
        data,
        error: String(data.message ?? `HTTP ${response.status}`),
      }
    }

    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Network error',
    }
  }
}

export const asquareBookingsApi = {
  async listAdminBookings(locationId?: string): Promise<AsquareBooking[]> {
    const firestore = getAsquareFirestore()
    const bookingsRef = collection(firestore, 'bookings')
    // When a locationId is supplied, push the filter into the query itself
    // instead of fetching up to 10k docs and discarding most in memory.
    // Auto-single-field index on locationId handles this with no composite
    // index required.
    // Fetch without orderBy to avoid Firestore silently excluding documents
    // where createdAt has a different type (string vs Timestamp).
    // Sort in memory after parsing to handle both types correctly.
    const bookingQuery = locationId
      ? query(bookingsRef, where('locationId', '==', locationId), limit(10000))
      : query(bookingsRef, limit(10000))
    const snapshot = await getDocs(bookingQuery)

    const bookings = snapshot.docs
      .map((record) =>
        parseBooking({ ...(record.data() as Record<string, unknown>), id: record.id }),
      )
      // Hide soft-deleted (in-Trash) bookings from the live admin list.
      // Trash UI reads them via `listDeletedBookings`.
      .filter((b) => !b.deletedAt)
    // Sort by createdAt descending (newest first) in memory
    bookings.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return bookings
  },

  async listBookingsByUserPhone(phone: string): Promise<AsquareBooking[]> {
    const normalized = phone.replace(/\D/g, '').slice(-10)
    if (!normalized || normalized.length < 10) return []

    const firestore = getAsquareFirestore()
    const bookingsRef = collection(firestore, 'bookings')

    // Try the common stored formats in parallel. The canonical write path
    // (customer app bookingService) stores last-10-digit form, but legacy
    // and pipeline-authored bookings may carry +91/91 prefixes.
    const candidates = [normalized, `+91${normalized}`, `91${normalized}`]

    const snapshots = await Promise.all(
      candidates.map((value) => getDocs(query(bookingsRef, where('userPhone', '==', value)))),
    )

    const seen = new Set<string>()
    const bookings: AsquareBooking[] = []
    for (const snap of snapshots) {
      for (const record of snap.docs) {
        if (seen.has(record.id)) continue
        seen.add(record.id)
        bookings.push(
          parseBooking({ ...(record.data() as Record<string, unknown>), id: record.id }),
        )
      }
    }

    bookings.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    // Hide soft-deleted bookings from the customer profile / billing
    // search-by-phone lookups. Trash UI uses `listDeletedBookings`.
    return bookings.filter((b) => !b.deletedAt)
  },

  async listBookableActivities(
    locationId: string,
    sessionDate: string,
  ): Promise<AsquareBookingActivity[]> {
    const activities = await readActivities()
    return activities
      .filter((activity) => activity.available !== false)
      .filter((activity) =>
        isHelicopterItem({
          activity,
          quantity: 1,
          duration: activity.duration ?? 15,
          date: sessionDate,
          timeSlot: 'Flexible',
          price: Number(activity.basePrice ?? 0),
        }),
      )
      .filter((activity) => matchesLocation(activity, locationId))
      .filter((activity) => matchesDate(activity, locationId, sessionDate))
      .sort((left, right) => left.name.localeCompare(right.name))
  },

  async createPendingBooking(params: CreatePendingBookingParams): Promise<string> {
    const orderNumber = await ensureUniqueOrderNumber()
    const sessionDate =
      params.scheduleDate || params.items[0]?.date || new Date().toISOString().split('T')[0]

    const { createUnifiedBooking } = await import('../../lib/unified-booking')
    const result = await createUnifiedBooking({
      id: orderNumber,
      source: 'ADMIN_BOOKING',
      clientRequestId: params.clientRequestId,
      userId: params.userId,
      customerName: params.name || '',
      customerPhone: params.mobile || '',
      customerEmail: params.email,
      items: params.items.map((i) => {
        const activity = (i as { activity?: unknown }).activity
        // Bubble printIndividualTokens up to the item top-level so the
        // unified-booking writer persists it (the printer reads
        // `item.printIndividualTokens`, not `item.activity.*`). Snapshotted
        // onto the activity object by toBookableCatalogActivity at booking
        // construction time.
        const printIndividualTokens =
          (activity as { printIndividualTokens?: unknown } | undefined)?.printIndividualTokens ===
          true
            ? true
            : undefined
        return {
          itemName: String((activity as { name?: string } | undefined)?.name || 'Activity'),
          quantity: Number(i.quantity) || 1,
          unitPrice: (Number(i.price) || 0) / (Number(i.quantity) || 1),
          activity,
          duration: Number((i as { duration?: number }).duration) || 0,
          date: String((i as { date?: string }).date || ''),
          timeSlot: String((i as { timeSlot?: string }).timeSlot || ''),
          printIndividualTokens,
        }
      }),
      totalAmount: params.totalAmount,
      discountAmount: params.discountAmount,
      finalAmount: params.finalAmount,
      paymentMethod: params.paymentMethod || 'link',
      paymentStatus: 'pending',
      bookingStatus: 'pending',
      locationId: params.locationId,
      sessionDate: new Date(`${sessionDate}T00:00:00Z`),
      qrCode: generateQRCode(orderNumber, params.userId),
      tires: calculateTires(params.finalAmount),
      couponCode: params.couponCode,
      couponAmount: params.couponAmount,
      createdByAdminId: params.adminId,
      createdByAdminName: params.adminName,
      createdByRole: params.adminRole,
    })

    return result.id
  },

  async updateBooking(
    orderNumber: string,
    userId: string,
    updates: Partial<AsquareBooking>,
  ): Promise<boolean> {
    try {
      const { isValidStatusTransition, canConfirmBooking } =
        await import('../../lib/unified-booking')
      const firestore = getAsquareFirestore()
      const bookingRef = doc(firestore, 'bookings', orderNumber)
      const existingSnapshot = await getDoc(bookingRef)
      const existingBooking = existingSnapshot.exists()
        ? parseBooking(existingSnapshot.data() as Record<string, unknown>)
        : null

      // Validate status transition
      if (updates.bookingStatus && existingBooking) {
        if (!isValidStatusTransition(existingBooking.bookingStatus, updates.bookingStatus)) {
          logger.error('asquare_bookings.invalid_status_transition', undefined, {
            from: existingBooking.bookingStatus,
            to: updates.bookingStatus,
          })
          return false
        }
        // Cannot confirm/complete without payment
        if (updates.bookingStatus === 'confirmed' || updates.bookingStatus === 'completed') {
          const effectivePaymentStatus = updates.paymentStatus ?? existingBooking.paymentStatus
          const effectivePaymentMethod = updates.paymentMethod ?? existingBooking.paymentMethod
          const effectiveFinalAmount = existingBooking.finalAmount
          if (
            !canConfirmBooking(effectivePaymentStatus, effectivePaymentMethod, effectiveFinalAmount)
          ) {
            logger.error('asquare_bookings.cannot_confirm_payment_unsettled', undefined, {
              orderNumber,
              paymentStatus: effectivePaymentStatus,
              paymentMethod: effectivePaymentMethod,
            })
            return false
          }
        }
      }

      const nextUpdates: Partial<AsquareBooking> = { ...updates }
      if (
        String(updates.paymentStatus ?? '').toLowerCase() === 'completed' &&
        !existingBooking?.paymentCompletedAt &&
        !nextUpdates.paymentCompletedAt
      ) {
        nextUpdates.paymentCompletedAt = new Date()
      }

      const mergedUpdates = compactFirestoreDoc(nextUpdates as Record<string, unknown>)
      await setDoc(bookingRef, mergedUpdates, { merge: true })

      if (userId && !userId.startsWith('offline_')) {
        await setDoc(doc(firestore, 'users', userId, 'bookings', orderNumber), mergedUpdates, {
          merge: true,
        })
      }

      // Finalize billing (assign serials, write vendor ledger) when payment completes
      if (String(updates.paymentStatus ?? '').toLowerCase() === 'completed') {
        try {
          const { completeBillingOnPayment } = await import('../../lib/unified-booking')
          await completeBillingOnPayment(orderNumber)
        } catch (billingErr) {
          logger.error('asquare_bookings.finalize_billing_failed', {
            error: billingErr,
            orderNumber,
            context: 'Vendor ledger entries may be missing — requires manual reconciliation',
          })
        }
      }

      return true
    } catch (error) {
      logger.error('asquare_bookings.update_failed', error)
      return false
    }
  },

  async deleteBooking(
    orderNumber: string,
    userId: string,
    deletedBy?: AdminActor,
    transactionDate?: Date,
    options?: { skipInvoiceRegen?: boolean },
  ): Promise<boolean> {
    try {
      const firestore = getAsquareFirestore()

      // 1. Read the booking first so we can copy it to deleted_bookings for audit
      const bookingRef = doc(firestore, 'bookings', orderNumber)
      const bookingSnap = await getDoc(bookingRef)
      const bookingData = bookingSnap.exists()
        ? (bookingSnap.data() as Record<string, unknown>)
        : {}

      // 2. Delete vendor ledger entries linked to this booking
      try {
        // Read items from both field names (customer-app stores as billingItems, POS stores as items)
        const rawItems = bookingData.billingItems ?? bookingData.items
        const items = Array.isArray(rawItems) ? (rawItems as Array<Record<string, unknown>>) : []
        const vendorIds = new Set(
          items.map((i) => i.vendorId).filter((v): v is string => typeof v === 'string'),
        )
        // Also check transaction-level vendorId (older single-vendor bookings)
        if (typeof bookingData.vendorId === 'string') vendorIds.add(bookingData.vendorId)

        // Delete known ledger entries by composite ID
        const deletePromises: Promise<unknown>[] = []
        for (const vid of vendorIds) {
          deletePromises.push(
            deleteDoc(doc(firestore, 'vendorLedger', `le-${orderNumber}-${vid}`)).catch(
              () => undefined,
            ),
          )
          deletePromises.push(
            deleteDoc(doc(firestore, 'vendorLedger', `le-refund-${orderNumber}-${vid}`)).catch(
              () => undefined,
            ),
          )
          deletePromises.push(
            deleteDoc(doc(firestore, 'vendorLedger', `le-cancel-${orderNumber}-${vid}`)).catch(
              () => undefined,
            ),
          )
        }
        await Promise.allSettled(deletePromises)

        // Fallback: query for any remaining ledger entries referencing this booking
        try {
          const ledgerQuery = query(
            collection(firestore, 'vendorLedger'),
            where('referenceId', '==', orderNumber),
          )
          const orphaned = await getDocs(ledgerQuery)
          if (!orphaned.empty) {
            await Promise.allSettled(orphaned.docs.map((d) => deleteDoc(d.ref)))
          }
        } catch {
          /* query fallback non-critical */
        }
      } catch (ledgerErr) {
        logger.error('asquare_bookings.delete_vendor_ledger_failed', ledgerErr, { orderNumber })
      }

      // 3. Permanently delete the booking document
      await deleteDoc(bookingRef)

      // 4. Try to delete from user sub-collection (non-critical)
      if (userId) {
        await deleteDoc(doc(firestore, 'users', userId, 'bookings', orderNumber)).catch(
          () => undefined,
        )
      }

      // 5. Write audit record to deleted_bookings
      await setDoc(doc(firestore, 'deleted_bookings', orderNumber), {
        ...bookingData,
        deletedAt: new Date().toISOString(),
        deletedBy: deletedBy ?? { id: 'unknown', name: 'Unknown', role: 'unknown' },
      })

      // 6. Regenerate invoices for the affected period so stored docs reflect the deletion.
      //    Bulk callers pass skipInvoiceRegen and run a single regen per unique week at the end.
      if (transactionDate && !options?.skipInvoiceRegen) {
        try {
          const { generateFirestoreWeeklyInvoices } = await import('./accounting-firestore')
          await generateFirestoreWeeklyInvoices(transactionDate)
        } catch (invoiceErr) {
          logger.error('asquare_bookings.regenerate_invoices_failed', invoiceErr, { orderNumber })
        }
      }
      return true
    } catch (error) {
      logger.error('asquare_bookings.delete_failed', error)
      return false
    }
  },

  /**
   * Soft-delete: stamps `deletedAt`/`deletedBy`/`deletionReason` on the
   * booking doc so it's hidden from the live `listAdminBookings` result.
   * Also cascades a `voidedAt` stamp onto every vendorLedger entry whose
   * `referenceId` is this booking — so the vendor's portal, settlement
   * totals, weekly invoice generation, accounting tabs, and dashboard
   * KPIs all stop counting the trashed sale immediately. The ledger
   * docs are preserved on disk so `restoreBooking` can revive them.
   *
   * Always allowed (no lock or vendor-paid guards): this is reversible
   * via `restoreBooking`. The hard-delete path enforces the strict
   * guards once the user confirms permanent removal in the Trash UI.
   */
  async softDeleteBooking(
    orderNumber: string,
    userId: string | undefined,
    deletedBy: AdminActor,
    reason?: string,
  ): Promise<boolean> {
    try {
      const firestore = getAsquareFirestore()
      const updates: Record<string, unknown> = {
        deletedAt: new Date(),
        deletedBy: { id: deletedBy.id, name: deletedBy.name, role: deletedBy.role },
        ...(reason?.trim() ? { deletionReason: reason.trim() } : {}),
      }
      await setDoc(doc(firestore, 'bookings', orderNumber), updates, { merge: true })
      if (userId && !String(userId).startsWith('offline_')) {
        await setDoc(doc(firestore, 'users', userId, 'bookings', orderNumber), updates, {
          merge: true,
        }).catch((err) =>
          logger.error('asquare_bookings.user_mirror_write_failed', err, {
            orderNumber,
            userId,
            op: 'soft_delete',
          }),
        )
      }
      // Cascade: void every ledger entry that points at this booking.
      // Done after the booking write so a partial failure leaves the
      // booking trashed (the visible state) even if the cascade can't
      // complete — that's the safer half-way state. The cascade is
      // idempotent so a manual retry works.
      try {
        const ledgerSnap = await getDocs(
          query(collection(firestore, 'vendorLedger'), where('referenceId', '==', orderNumber)),
        )
        const voidedAt = new Date().toISOString()
        await Promise.all(
          ledgerSnap.docs.map((entry) =>
            setDoc(entry.ref, { voidedAt }, { merge: true }).catch((cascadeErr) => {
              logger.error('asquare_bookings.soft_delete_cascade_failed', cascadeErr, {
                orderNumber,
                ledgerEntryId: entry.id,
              })
            }),
          ),
        )
      } catch (cascadeErr) {
        logger.error('asquare_bookings.soft_delete_ledger_query_failed', cascadeErr, {
          orderNumber,
        })
      }
      return true
    } catch (error) {
      logger.error('asquare_bookings.soft_delete_failed', error, { orderNumber })
      return false
    }
  },

  /** Reverse a soft-delete: clears the deletion fields so the booking
   * reappears in the live admin list. Also clears the `voidedAt` stamp
   * on every vendorLedger entry pointing at it, so the vendor's
   * panel / settlements / invoices reflect the credit again. */
  async restoreBooking(orderNumber: string, userId: string | undefined): Promise<boolean> {
    try {
      const firestore = getAsquareFirestore()
      const clearFields = {
        deletedAt: deleteField(),
        deletedBy: deleteField(),
        deletionReason: deleteField(),
      }
      await setDoc(doc(firestore, 'bookings', orderNumber), clearFields, { merge: true })
      if (userId && !String(userId).startsWith('offline_')) {
        await setDoc(doc(firestore, 'users', userId, 'bookings', orderNumber), clearFields, {
          merge: true,
        }).catch((err) =>
          logger.error('asquare_bookings.user_mirror_write_failed', err, {
            orderNumber,
            userId,
            op: 'restore',
          }),
        )
      }
      try {
        const ledgerSnap = await getDocs(
          query(collection(firestore, 'vendorLedger'), where('referenceId', '==', orderNumber)),
        )
        await Promise.all(
          ledgerSnap.docs.map((entry) =>
            setDoc(entry.ref, { voidedAt: deleteField() }, { merge: true }).catch((cascadeErr) => {
              logger.error('asquare_bookings.restore_cascade_failed', cascadeErr, {
                orderNumber,
                ledgerEntryId: entry.id,
              })
            }),
          ),
        )
      } catch (cascadeErr) {
        logger.error('asquare_bookings.restore_ledger_query_failed', cascadeErr, {
          orderNumber,
        })
      }
      return true
    } catch (error) {
      logger.error('asquare_bookings.restore_failed', error, { orderNumber })
      return false
    }
  },

  async canDeleteBooking(booking: AsquareBooking): Promise<{ allowed: boolean; reason?: string }> {
    if (booking.bookingStatus === 'completed') {
      return { allowed: false, reason: 'Booking is already completed/used and cannot be deleted.' }
    }
    if (booking.checkInStatus === 'completed') {
      return {
        allowed: false,
        reason: 'Customer has already checked in; the booking cannot be deleted.',
      }
    }
    // Triage for the period-lock bypass.
    //   'allow'        — payment never completed → ledger never wrote → bypass.
    //   'check_payout' — refunded → bypass IFF no vendor was paid for it.
    //   'deny'         — strict guard runs (current behavior).
    const { classifyForLockBypass } = await import('../../lib/booking-lock-bypass')
    const decision = classifyForLockBypass(booking)
    if (decision === 'allow') return { allowed: true }
    if (decision === 'check_payout') {
      try {
        const { wasVendorPaidForBooking } = await import('./accounting-firestore')
        const paid = await wasVendorPaidForBooking(booking.id, booking.createdAt)
        if (paid) {
          return {
            allowed: false,
            reason:
              'Vendor has already been paid for this booking. Cannot delete (reversing a vendor cheque is out-of-system).',
          }
        }
        return { allowed: true }
      } catch {
        // Fail closed: if we cannot confirm the vendor wasn't paid, deny.
        return {
          allowed: false,
          reason:
            'Could not confirm vendor payout status. Try again or contact accounting before deleting.',
        }
      }
    }
    try {
      const { hasLockedInvoiceForDate } = await import('./accounting-firestore')
      const locked = await hasLockedInvoiceForDate(booking.createdAt)
      if (locked) {
        return {
          allowed: false,
          reason:
            "A locked invoice covers this booking's period. Unlock the invoice before deleting.",
        }
      }
    } catch {
      /* treat as allowed if check fails */
    }
    return { allowed: true }
  },

  /**
   * Regenerate weekly invoices for the unique periods covered by `dates`.
   * Used after a bulk delete so we run the heavy aggregation once per week
   * instead of once per booking.
   */
  async regenerateInvoicesForDates(dates: Date[]): Promise<void> {
    if (!dates.length) return
    try {
      const { generateFirestoreWeeklyInvoices, getPeriodStart } =
        await import('./accounting-firestore')
      const seen = new Set<string>()
      const reps: Date[] = []
      for (const d of dates) {
        if (!d) continue
        const key = getPeriodStart(d)
        if (seen.has(key)) continue
        seen.add(key)
        reps.push(d)
      }
      for (const d of reps) {
        try {
          await generateFirestoreWeeklyInvoices(d)
        } catch (err) {
          logger.error('asquare_bookings.regenerate_invoices_failed', err)
        }
      }
    } catch (err) {
      logger.error('asquare_bookings.regenerate_invoices_failed', err)
    }
  },

  async sendPaymentLink(
    orderNumber: string,
    templateName?: string,
    headerImage?: string,
  ): Promise<{
    success: boolean
    message?: string
    link?: string
    interaktSuccess?: boolean
    interaktStatus?: number
    interaktResponse?: Record<string, unknown>
  }> {
    const result = await postCloudFunction(
      INTERAKT_PAYMENT_LINK_FUNCTION_URL,
      {
        orderNumber,
        templateName,
        ...(typeof headerImage === 'string' && headerImage.trim()
          ? { headerImage: headerImage.trim() }
          : {}),
      },
      true,
    )

    if (!result.ok) {
      return { success: false, message: result.error }
    }

    const link = typeof result.data?.paymentLink === 'string' ? result.data.paymentLink : undefined
    const interaktStatus =
      typeof result.data?.interaktStatus === 'number' ? result.data.interaktStatus : undefined
    const interaktResponse =
      (result.data?.interaktResponse as Record<string, unknown> | undefined) ?? undefined
    const interaktSuccess =
      interaktStatus === undefined ? true : interaktStatus >= 200 && interaktStatus < 300

    return { success: true, link, interaktSuccess, interaktStatus, interaktResponse }
  },

  async triggerInteraktBookingConfirmation(
    orderNumber: string,
    forceResend = true,
    callerUserId?: string,
  ): Promise<{ success: boolean; message?: string; interaktResponse?: Record<string, unknown> }> {
    const result = await postCloudFunction(
      INTERAKT_CONFIRM_FUNCTION_URL,
      { orderNumber, forceResend, callerUserId },
      true,
    )

    if (!result.ok) {
      return {
        success: false,
        message: result.error,
        interaktResponse:
          (result.data?.interaktResponse as Record<string, unknown> | undefined) ?? undefined,
      }
    }

    return {
      success: true,
      interaktResponse:
        (result.data?.interaktResponse as Record<string, unknown> | undefined) ?? undefined,
    }
  },

  async triggerInteraktPaymentRequest(params: {
    orderNumber: string
    customerName: string
    activityName: string
    bookingDate: string
    locationName: string
    paymentAmount: string
    paymentLink: string
    forceResend?: boolean
  }): Promise<{ success: boolean; message?: string; interaktResponse?: Record<string, unknown> }> {
    const bodyValues = [
      String(params.customerName ?? '').trim(),
      String(params.orderNumber ?? '').trim(),
      String(params.activityName ?? '').trim(),
      String(params.bookingDate ?? '').trim(),
      String(params.locationName ?? '').trim(),
      String(params.paymentAmount ?? '').trim(),
      String(params.paymentLink ?? '').trim(),
    ]

    const result = await postCloudFunction(
      INTERAKT_CONFIRM_FUNCTION_URL,
      {
        orderNumber: params.orderNumber,
        templateName: 'a_sqaure_payment_request',
        bodyValues,
        forceResend: params.forceResend === true,
      },
      true,
    )

    if (!result.ok) {
      return {
        success: false,
        message: result.error,
        interaktResponse:
          (result.data?.interaktResponse as Record<string, unknown> | undefined) ?? undefined,
      }
    }

    return {
      success: true,
      interaktResponse:
        (result.data?.interaktResponse as Record<string, unknown> | undefined) ?? undefined,
    }
  },

  async triggerRescheduleNotification(
    orderNumber: string,
    oldDate: string,
    newDate: string,
    locationName: string,
    phoneNumber: string,
    customerName: string,
  ): Promise<boolean> {
    const result = await postCloudFunction(
      RESCHEDULE_NOTIFICATION_URL,
      { orderNumber, oldDate, newDate, locationName, phoneNumber, customerName },
      false,
    )
    return result.ok
  },

  async triggerPaymentFailedNotification(
    orderNumber: string,
    phoneNumber: string,
    customerName: string,
  ): Promise<boolean> {
    const result = await postCloudFunction(
      PAYMENT_FAILED_NOTIFICATION_URL,
      { orderNumber, phoneNumber, customerName },
      false,
    )
    return result.ok
  },

  /**
   * Notify the customer that their activity has been swapped in-store.
   *
   * No dedicated cloud function exists yet, so this re-fires the existing
   * booking-confirmation template — at this point the booking record already
   * reflects the new activity name and final amount, so the customer receives
   * a confirmation that matches what they actually played. When a backend
   * adds a swap-specific template, only this method needs to change.
   */
  async triggerSwapNotification(
    orderNumber: string,
    callerUserId?: string,
  ): Promise<{ success: boolean; message?: string }> {
    return this.triggerInteraktBookingConfirmation(orderNumber, true, callerUserId)
  },

  /**
   * Fetch swap_logs for an owner/admin digest.
   * `since` defaults to start of today IST when omitted.
   */
  async getSwapLogs(filter?: {
    since?: Date
    until?: Date
    locationId?: string
  }): Promise<Array<BookingSwapEvent & { orderNumber: string; logId: string }>> {
    try {
      const firestore = getAsquareFirestore()
      const { getDocs, query, collection: col, orderBy } = await import('firebase/firestore')
      const q = query(col(firestore, 'swap_logs'), orderBy('at', 'desc'))
      const snap = await getDocs(q)
      const since = filter?.since
      const until = filter?.until
      const rows: Array<BookingSwapEvent & { orderNumber: string; logId: string }> = []
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>
        const rawAt = data.at as unknown
        const at =
          rawAt instanceof Date
            ? rawAt
            : rawAt && typeof (rawAt as { toDate?: () => Date }).toDate === 'function'
              ? (rawAt as { toDate: () => Date }).toDate()
              : new Date(String(rawAt))
        if (since && at < since) return
        if (until && at > until) return
        rows.push({
          ...(data as unknown as BookingSwapEvent),
          at,
          orderNumber: String(data.orderNumber ?? ''),
          logId: d.id,
        })
      })
      // Optional location filter is post-query because swap_logs doesn't store
      // locationId directly; we filter via the prefix of orderNumber if needed.
      if (filter?.locationId) {
        return rows.filter((r) => String(r.orderNumber).includes(filter.locationId!))
      }
      return rows
    } catch (error) {
      logger.error('asquare_bookings.get_swap_logs_failed', error)
      return []
    }
  },

  async logRescheduleEvent(
    orderNumber: string,
    previousDetails: Record<string, unknown>,
    newDetails: Record<string, unknown>,
    actor: AdminActor,
  ): Promise<boolean> {
    try {
      const firestore = getAsquareFirestore()
      const logRef = doc(collection(firestore, 'reschedule_logs'))
      await setDoc(
        logRef,
        compactFirestoreDoc({
          orderNumber,
          previousDetails,
          newDetails,
          rescheduledBy: actor,
          rescheduledAt: new Date(),
        }),
      )
      return true
    } catch (error) {
      logger.error('asquare_bookings.log_reschedule_event_failed', error)
      return false
    }
  },

  /**
   * Replace an item's activity on a booking when the original game is
   * unavailable in-store. Atomic from the caller's perspective:
   *   1. Settles price delta via wallet (idempotent — see eventId)
   *   2. Updates booking.items[idx] with the new activity + recomputed price
   *   3. Recomputes totalAmount/finalAmount (preserves absolute discountAmount)
   *   4. Appends BookingSwapEvent to booking.swapHistory[]
   *   5. Writes a separate `swap_logs` audit document
   *   6. Re-runs vendor-ledger writes if booking is paid (so the new vendor
   *      gets credited and the old one's stale credit is overshadowed)
   *
   * Returns the updated booking on success, null on failure.
   */
  async replaceActivity(
    booking: AsquareBooking,
    params: {
      itemIndex: number
      newActivity: AsquareBookingActivity
      newUnitPrice: number
      reason: string
      settlement: 'wallet_credit' | 'wallet_debit' | 'external_cash' | 'no_adjustment'
    },
    actor: AdminActor,
  ): Promise<{ updated: AsquareBooking; event: BookingSwapEvent } | null> {
    try {
      const original = booking.items[params.itemIndex]
      if (!original) {
        logger.error('asquare_bookings.replace_activity_invalid_index', undefined, {
          orderNumber: booking.id,
          itemIndex: params.itemIndex,
        })
        return null
      }

      // Defensive re-check: between when the swap modal loaded its catalog
      // and the staff clicked Confirm, an admin may have flipped the
      // replacement activity to "temporarily unavailable". Re-read the
      // current catalog and abort the swap before any wallet movement if
      // the destination game is now down.
      try {
        const [{ listFirestoreActivityCatalog }, { isCurrentlyUnavailable, isOnSurface }] =
          await Promise.all([
            import('./activity-catalog-firestore'),
            import('./activity-availability'),
          ])
        const catalog = await listFirestoreActivityCatalog()
        const replacement = catalog.find((c) => c.id === params.newActivity.id)
        if (isCurrentlyUnavailable(replacement) || !isOnSurface(replacement, 'bookings')) {
          logger.error('asquare_bookings.replace_activity_target_unavailable', undefined, {
            orderNumber: booking.id,
            targetActivityId: params.newActivity.id,
            reason: replacement?.temporarilyUnavailableReason,
            offBookingsSurface: replacement ? !isOnSurface(replacement, 'bookings') : undefined,
          })
          return null
        }
      } catch (catalogErr) {
        // Catalog re-fetch failure is non-fatal — better to proceed with the
        // swap than to block staff who already have a paying customer in
        // front of them. Log loud so we can spot if it's becoming common.
        logger.error('asquare_bookings.replace_activity_catalog_recheck_failed', catalogErr, {
          orderNumber: booking.id,
        })
      }

      const quantity = Math.max(1, Math.floor(original.quantity || 1))
      const oldUnitPrice = Number(original.price ?? 0) / Math.max(1, quantity)
      const oldLineTotal = oldUnitPrice * quantity
      const newLineTotal = params.newUnitPrice * quantity
      const priceDelta = Math.round(newLineTotal - oldLineTotal)

      const eventId = `swap_${booking.id}_${Date.now()}`
      const now = new Date()

      // Settle the wallet side first. If wallet write fails, abort before
      // touching the booking — partial state is the worst outcome here.
      let walletAmount: number | undefined
      if (params.settlement === 'wallet_credit' && priceDelta < 0) {
        // Customer overpaid (cheaper game) — refund excess to wallet.
        walletAmount = Math.abs(priceDelta)
        const { walletService } = await import('../../services/walletService')
        const ok = await walletService.addBalance(
          booking.userId,
          walletAmount,
          `Activity swap refund (${booking.id}): ${original.activity?.name ?? '?'} → ${params.newActivity.name}`,
          eventId,
        )
        if (!ok) {
          logger.error('asquare_bookings.replace_activity_wallet_credit_failed', undefined, {
            orderNumber: booking.id,
            walletAmount,
          })
          return null
        }
      } else if (params.settlement === 'wallet_debit' && priceDelta > 0) {
        // Customer owes extra — debit from wallet.
        walletAmount = priceDelta
        const { walletService } = await import('../../services/walletService')
        const ok = await walletService.deductBalance(
          booking.userId,
          walletAmount,
          `Activity swap charge (${booking.id}): ${original.activity?.name ?? '?'} → ${params.newActivity.name}`,
        )
        if (!ok) {
          logger.error('asquare_bookings.replace_activity_wallet_debit_failed', undefined, {
            orderNumber: booking.id,
            walletAmount,
          })
          return null
        }
      }
      // 'external_cash' and 'no_adjustment' don't touch the wallet — staff
      // collected/refunded out-of-band; we just record the audit event.

      const event: BookingSwapEvent = {
        eventId,
        itemIndex: params.itemIndex,
        from: {
          activityId: String(original.activity?.id ?? ''),
          activityName: String(original.activity?.name ?? ''),
          vendorId: original.activity?.vendorId,
          unitPrice: oldUnitPrice,
          quantity,
        },
        to: {
          activityId: params.newActivity.id,
          activityName: params.newActivity.name,
          vendorId: params.newActivity.vendorId,
          unitPrice: params.newUnitPrice,
          quantity,
        },
        priceDelta,
        settlement: params.settlement,
        walletAmount,
        reason: params.reason,
        by: actor,
        at: now,
      }

      const updatedItems = booking.items.map((it, idx) =>
        idx === params.itemIndex
          ? {
              ...it,
              // Replace activity wholesale — don't inherit old fields like
              // interaktTemplateId, printIndividualTokens, vendorId from the
              // previous game (they belong to that game, not this one).
              activity: params.newActivity,
              price: newLineTotal,
            }
          : it,
      )

      // Recompute totals across all items, preserving the absolute discount.
      // Floor finalAmount at 0 — if the swap made the booking cheaper than the
      // discount, the customer effectively pays nothing for it, no negative bill.
      const newTotalAmount = updatedItems.reduce((sum, it) => sum + Number(it.price ?? 0), 0)
      const preservedDiscount = Math.min(Number(booking.discountAmount ?? 0), newTotalAmount)
      const newFinalAmount = Math.max(0, newTotalAmount - preservedDiscount)

      const swapHistory = [...(booking.swapHistory ?? []), event]

      const updates: Partial<AsquareBooking> = {
        items: updatedItems,
        totalAmount: newTotalAmount,
        discountAmount: preservedDiscount,
        finalAmount: newFinalAmount,
        swapHistory,
      }

      const ok = await this.updateBooking(booking.id, booking.userId, updates)
      if (!ok) {
        // Wallet was already moved. Surface this loudly so staff can
        // reconcile manually — silent failure here is the worst outcome.
        logger.error('asquare_bookings.replace_activity_booking_update_failed', undefined, {
          orderNumber: booking.id,
          eventId,
          walletAmount,
          context: 'Wallet adjusted but booking update failed — manual reconciliation required.',
        })
        return null
      }

      // Separate audit collection for owner reports / fraud detection.
      try {
        const firestore = getAsquareFirestore()
        const logRef = doc(collection(firestore, 'swap_logs'))
        await setDoc(logRef, compactFirestoreDoc({ ...event, orderNumber: booking.id }))
      } catch (logErr) {
        logger.error('asquare_bookings.swap_log_failed', logErr, { orderNumber: booking.id })
      }

      // If booking is already paid and the vendor changed, re-run the
      // vendor-ledger writes so the new vendor is credited. Idempotent.
      if (booking.paymentStatus === 'completed' && event.from.vendorId !== event.to.vendorId) {
        try {
          const { onBookingPaidById } = await import('../../lib/booking-vendor-payout')
          await onBookingPaidById(booking.id)
        } catch (vendorErr) {
          logger.error('asquare_bookings.replace_activity_vendor_payout_failed', vendorErr, {
            orderNumber: booking.id,
          })
        }
      }

      // Fire-and-forget customer notification of the change. Only resend when
      // we actually have a phone number — Interakt rejects empty E.164 anyway.
      if (booking.userPhone) {
        void this.triggerSwapNotification(booking.id, actor.id).catch((notifyErr) =>
          logger.error('asquare_bookings.replace_activity_notify_failed', notifyErr, {
            orderNumber: booking.id,
          }),
        )
      }

      const updated: AsquareBooking = { ...booking, ...updates }
      return { updated, event }
    } catch (error) {
      logger.error('asquare_bookings.replace_activity_failed', error)
      return null
    }
  },

  async confirmRazorpayOrder(params: {
    orderNumber: string
    razorpayPaymentId: string
    razorpayOrderId: string
  }): Promise<boolean> {
    try {
      const url = new URL('https://asquaregokarting.com/Api/api.php')
      url.searchParams.set(
        'key',
        (import.meta.env.VITE_ASQUARE_CUSTOMER_LOOKUP_KEY as string | undefined)?.trim() || '',
      )
      url.searchParams.set(
        'pswd',
        (import.meta.env.VITE_ASQUARE_CUSTOMER_LOOKUP_PASSWORD as string | undefined)?.trim() || '',
      )
      url.searchParams.set('transac', 'confirm_order_by_razorpay')
      url.searchParams.set('razorpay_payment_id', params.razorpayPaymentId)
      url.searchParams.set('razorpay_order_id', params.razorpayOrderId)
      url.searchParams.set('order_number', params.orderNumber)
      url.searchParams.set('payment_status', '1')
      await fetch(url.toString())
      return true
    } catch (error) {
      logger.error('asquare_bookings.confirm_razorpay_failed', error)
      return false
    }
  },

  locationToBranchId(locationId: string): string {
    return slugToBranchId(locationId)
  },

  normalizePhone,

  /**
   * Returns the contents of Trash. Two sources are merged:
   *
   *   1. Soft-deleted rows live in `bookings/` with `deletedAt` set —
   *      these are the recoverable ones. `restoreBooking` clears the
   *      flag and they reappear in the live list.
   *   2. Permanently-deleted rows from before the soft-delete model
   *      existed live in `deleted_bookings/`. These are forensic only
   *      (the original doc is gone) and cannot be restored.
   *
   * Each row carries a `permanentlyDeleted: boolean` flag so the Trash
   * UI can hide Restore for forensic rows.
   */
  async listDeletedBookings(): Promise<
    (AsquareBooking & {
      deletedAt: Date
      deletedBy: { id: string; name: string; role: string }
      permanentlyDeleted: boolean
    })[]
  > {
    const firestore = getAsquareFirestore()

    // 1. Soft-deleted, still in `bookings/` — recoverable.
    const softQuery = query(
      collection(firestore, 'bookings'),
      where('deletedAt', '!=', null),
      limit(500),
    )
    const softSnap = await getDocs(softQuery)
    const soft = softSnap.docs.map((record) => {
      const raw = record.data() as Record<string, unknown>
      const data = { ...raw, id: record.id }
      const deletedBy = (raw.deletedBy as Record<string, unknown>) ?? {}
      return {
        ...parseBooking(data),
        deletedAt: toDate(raw.deletedAt),
        deletedBy: {
          id: String(deletedBy.id ?? 'unknown'),
          name: String(deletedBy.name ?? 'Unknown'),
          role: String(deletedBy.role ?? 'unknown'),
        },
        permanentlyDeleted: false,
      }
    })

    // 2. Forensic archive of pre-soft-delete hard-deletes.
    const archiveQuery = query(
      collection(firestore, 'deleted_bookings'),
      orderBy('deletedAt', 'desc'),
      limit(500),
    )
    const archiveSnap = await getDocs(archiveQuery)
    const archive = archiveSnap.docs.map((record) => {
      const raw = record.data() as Record<string, unknown>
      const data = { ...raw, id: record.id }
      const deletedBy = (raw.deletedBy as Record<string, unknown>) ?? {}
      return {
        ...parseBooking(data),
        deletedAt: toDate(raw.deletedAt),
        deletedBy: {
          id: String(deletedBy.id ?? 'unknown'),
          name: String(deletedBy.name ?? 'Unknown'),
          role: String(deletedBy.role ?? 'unknown'),
        },
        permanentlyDeleted: true,
      }
    })

    // De-dupe — a booking could exist in both if it was soft-deleted then
    // hard-deleted from Trash; the soft-delete row is gone after the hard
    // delete, but defensively prefer `archive` (which is the post-hard
    // truth) when ids collide.
    const archiveIds = new Set(archive.map((r) => r.id))
    const merged = [...archive, ...soft.filter((r) => !archiveIds.has(r.id))]
    merged.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime())
    return merged
  },

  /**
   * One-time restore: find bookings from a specific date that were incorrectly
   * auto-cancelled due to the createdAt type mismatch bug, and restore them to pending.
   */
  async restoreAutoCancelledBookings(targetDateIST: string): Promise<{
    restored: string[]
    details: Array<{ id: string; name: string; phone: string; amount: number; createdAt: string }>
  }> {
    const firestore = getAsquareFirestore()
    const bookingsRef = collection(firestore, 'bookings')

    // Query all failed/cancelled bookings
    const snapshot = await getDocs(
      query(
        bookingsRef,
        where('paymentStatus', '==', 'failed'),
        where('bookingStatus', '==', 'cancelled'),
      ),
    )

    const restored: string[] = []
    const details: Array<{
      id: string
      name: string
      phone: string
      amount: number
      createdAt: string
    }> = []

    for (const record of snapshot.docs) {
      const raw = record.data() as Record<string, unknown>

      // Parse createdAt regardless of type
      const createdAt = toDate(raw.createdAt)
      if (createdAt.getTime() === 0) continue // skip unparseable

      // Check if booking was created on the target date (IST = UTC+5:30)
      const istOffset = 5.5 * 60 * 60 * 1000
      const istDate = new Date(createdAt.getTime() + istOffset)
      const dateStr = istDate.toISOString().split('T')[0]
      if (dateStr !== targetDateIST) continue

      const userId = String(raw.userId ?? '')
      const updates = { paymentStatus: 'pending' as const, bookingStatus: 'pending' as const }

      // Update flat bookings collection
      await setDoc(doc(firestore, 'bookings', record.id), updates, { merge: true })

      // Update user subcollection
      if (userId && !userId.startsWith('offline_')) {
        try {
          const userBookingRef = doc(firestore, 'users', userId, 'bookings', record.id)
          const userBookingSnap = await getDoc(userBookingRef)
          if (userBookingSnap.exists()) {
            await setDoc(userBookingRef, updates, { merge: true })
          }
        } catch {
          // user subcollection may not exist for all bookings
        }
      }

      // Fix createdAt if stored as string — convert to proper Date/Timestamp
      if (typeof raw.createdAt === 'string') {
        const fixedCreatedAt = new Date(raw.createdAt)
        if (!isNaN(fixedCreatedAt.getTime())) {
          await setDoc(
            doc(firestore, 'bookings', record.id),
            { createdAt: fixedCreatedAt },
            { merge: true },
          )
          if (userId && !userId.startsWith('offline_')) {
            try {
              const userBookingRef = doc(firestore, 'users', userId, 'bookings', record.id)
              const userBookingSnap = await getDoc(userBookingRef)
              if (userBookingSnap.exists()) {
                await setDoc(userBookingRef, { createdAt: fixedCreatedAt }, { merge: true })
              }
            } catch {
              // ignore
            }
          }
        }
      }

      restored.push(record.id)
      details.push({
        id: record.id,
        name: String(raw.userDisplayName ?? raw.name ?? 'Unknown'),
        phone: String(raw.userPhone ?? raw.mobile ?? ''),
        amount: Number(raw.finalAmount ?? raw.amount ?? 0),
        createdAt: createdAt.toISOString(),
      })
    }

    return { restored, details }
  },

  /** Fetch all protocol bookings/requests awaiting approval. */
  async listProtocolBookings(): Promise<AsquareBooking[]> {
    const firestore = getAsquareFirestore()
    const bookingsRef = collection(firestore, 'bookings')
    const q = query(bookingsRef, where('isProtocol', '==', true), limit(500))
    const snapshot = await getDocs(q)
    const bookings = snapshot.docs
      .map((record) =>
        parseBooking({ ...(record.data() as Record<string, unknown>), id: record.id }),
      )
      .filter((b) => !b.deletedAt)
    bookings.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return bookings
  },

  /**
   * Owner approves a protocol request — creates the REAL booking via createUnifiedBooking,
   * which overwrites the draft document with full billing data (GST, serials, vendor splits).
   */
  async approveProtocol(
    orderNumber: string,
    approvedBy: { id: string; name: string },
  ): Promise<void> {
    const firestore = getAsquareFirestore()
    const bookingRef = doc(firestore, 'bookings', orderNumber)
    const snap = await getDoc(bookingRef)
    if (!snap.exists()) throw new Error(`Protocol request ${orderNumber} not found.`)
    const data = snap.data() as Record<string, unknown>
    if (!data.isProtocol) throw new Error('This is not a protocol request.')
    if (data.protocolStatus === 'approved') throw new Error('Already approved.')

    // For draft protocol requests, create the full booking now
    if (data.isDraft) {
      const { createUnifiedBooking } = await import('../../lib/unified-booking')
      const items = (data.items as Array<Record<string, unknown>> | undefined) ?? []
      await createUnifiedBooking({
        id: orderNumber,
        source: String(data.source ?? 'POS') as 'POS' | 'APP_BOOKING' | 'ADMIN_BOOKING',
        sourceType: String(data.sourceType ?? 'BILLING'),
        customerName: String(data.customerName ?? ''),
        customerPhone: String(data.customerPhone ?? ''),
        items: items.map((i) => ({
          itemName: String(i.itemName ?? ''),
          quantity: Number(i.quantity ?? 1),
          unitPrice: 0,
          gameId: i.gameId ? String(i.gameId) : undefined,
          subGameId: i.subGameId ? String(i.subGameId) : undefined,
          variantId: i.variantId ? String(i.variantId) : undefined,
          vendorId: i.vendorId ? String(i.vendorId) : undefined,
        })),
        totalAmount: 0,
        discountAmount: 0,
        finalAmount: 0,
        paymentMethod: 'Protocol',
        paymentStatus: 'completed',
        locationId: String(data.locationId ?? ''),
        transactionDate: data.transactionDate
          ? String(data.transactionDate)
          : new Date().toISOString(),
        createdByAdminId: String(data.createdByAdminId ?? approvedBy.id),
        createdByAdminName: String(data.createdByAdminName ?? approvedBy.name),
        createdByRole: String(data.createdByRole ?? ''),
        isProtocol: true,
        protocolStatus: 'approved',
        protocolReason: String(data.protocolReason ?? ''),
      })
      // Stamp approval metadata on the now-complete booking
      await updateDoc(bookingRef, {
        isDraft: false,
        protocolApprovedBy: approvedBy.name,
        protocolApprovedById: approvedBy.id,
        protocolApprovedAt: new Date(),
      })
    } else {
      // Legacy: non-draft protocol booking — just update status fields
      await updateDoc(bookingRef, {
        protocolStatus: 'approved',
        protocolApprovedBy: approvedBy.name,
        protocolApprovedById: approvedBy.id,
        protocolApprovedAt: new Date(),
        bookingStatus: 'confirmed',
        paymentStatus: 'completed',
      })
      const userId = String(data.userId ?? '')
      if (userId && !userId.startsWith('offline_')) {
        try {
          const userRef = doc(firestore, 'users', userId, 'bookings', orderNumber)
          const userSnap = await getDoc(userRef)
          if (userSnap.exists()) {
            await updateDoc(userRef, {
              protocolStatus: 'approved',
              protocolApprovedBy: approvedBy.name,
              protocolApprovedById: approvedBy.id,
              protocolApprovedAt: new Date(),
              bookingStatus: 'confirmed',
              paymentStatus: 'completed',
            })
          }
        } catch {
          /* non-critical */
        }
      }
      // Finalize billing (assign serials, write vendor ledger). Same
      // silent-fail trap as approveOffer above — every protocol approval
      // that hit this path with a non-isDraft booking was creating an
      // orphan. Surface failures so they don't accumulate.
      try {
        const { completeBillingOnPayment } = await import('../../lib/unified-booking')
        await completeBillingOnPayment(orderNumber)
      } catch (err) {
        logger.error('approve_protocol.complete_billing_failed', err, {
          orderNumber,
          approvedBy: approvedBy.id,
        })
        throw new Error(
          `Protocol approved but billing finalization failed for ${orderNumber}: ${err instanceof Error ? err.message : String(err)}. The booking is marked completed but vendor credits and serials were NOT written. Re-run completeBillingOnPayment manually or contact the developer team.`,
        )
      }
    }
  },

  /** Owner rejects a protocol request — deletes the draft for zero footprint. */
  async rejectProtocol(
    orderNumber: string,
    _rejectedBy: { id: string; name: string },
    _reason?: string,
  ): Promise<void> {
    const firestore = getAsquareFirestore()
    const bookingRef = doc(firestore, 'bookings', orderNumber)
    const snap = await getDoc(bookingRef)
    if (!snap.exists()) throw new Error(`Protocol request ${orderNumber} not found.`)
    const data = snap.data() as Record<string, unknown>
    if (!data.isProtocol) throw new Error('This is not a protocol request.')
    if (data.protocolStatus === 'approved')
      throw new Error('Cannot reject an already approved protocol.')

    // Delete the draft — zero footprint in bookings
    await deleteDoc(bookingRef)

    // Also clean up user subcollection if it exists
    const userId = String(data.userId ?? '')
    if (userId && !userId.startsWith('offline_')) {
      try {
        const userRef = doc(firestore, 'users', userId, 'bookings', orderNumber)
        const userSnap = await getDoc(userRef)
        if (userSnap.exists()) await deleteDoc(userRef)
      } catch {
        /* non-critical */
      }
    }
  },

  // ── Offer Bookings ──────────────────────────────────────────────────────

  async listOfferBookings(): Promise<AsquareBooking[]> {
    const firestore = getAsquareFirestore()
    const bookingsRef = collection(firestore, 'bookings')
    const q = query(bookingsRef, where('isOffer', '==', true), limit(500))
    const snapshot = await getDocs(q)
    const bookings = snapshot.docs
      .map((record) =>
        parseBooking({ ...(record.data() as Record<string, unknown>), id: record.id }),
      )
      .filter((b) => !b.deletedAt)
    bookings.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return bookings
  },

  async approveOffer(orderNumber: string, approvedBy: { id: string; name: string }): Promise<void> {
    const firestore = getAsquareFirestore()
    const bookingRef = doc(firestore, 'bookings', orderNumber)
    const snap = await getDoc(bookingRef)
    if (!snap.exists()) throw new Error(`Offer request ${orderNumber} not found.`)
    const data = snap.data() as Record<string, unknown>
    if (!data.isOffer) throw new Error('This is not an offer request.')
    if (data.offerStatus === 'approved') throw new Error('Already approved.')

    if (data.isDraft) {
      const { createUnifiedBooking } = await import('../../lib/unified-booking')
      const items = (data.items as Array<Record<string, unknown>> | undefined) ?? []
      await createUnifiedBooking({
        id: orderNumber,
        source: String(data.source ?? 'POS') as 'POS' | 'APP_BOOKING' | 'ADMIN_BOOKING',
        sourceType: String(data.sourceType ?? 'BILLING'),
        customerName: String(data.customerName ?? ''),
        customerPhone: String(data.customerPhone ?? ''),
        items: items.map((i) => ({
          itemName: String(i.itemName ?? ''),
          quantity: Number(i.quantity ?? 1),
          unitPrice: Number(i.unitPrice ?? 0),
          gameId: i.gameId ? String(i.gameId) : undefined,
          subGameId: i.subGameId ? String(i.subGameId) : undefined,
          variantId: i.variantId ? String(i.variantId) : undefined,
          vendorId: i.vendorId ? String(i.vendorId) : undefined,
        })),
        totalAmount: Number(data.totalAmount ?? 0),
        discountAmount: Number(data.discountAmount ?? 0),
        finalAmount: Number(data.finalAmount ?? 0),
        paymentMethod: String(data.paymentMethod ?? 'Cash') as
          | 'Cash'
          | 'Card'
          | 'UPI'
          | 'Razorpay'
          | 'Split'
          | 'Protocol',
        paymentStatus: 'completed',
        locationId: String(data.locationId ?? ''),
        transactionDate: data.transactionDate
          ? String(data.transactionDate)
          : new Date().toISOString(),
        createdByAdminId: String(data.createdByAdminId ?? approvedBy.id),
        createdByAdminName: String(data.createdByAdminName ?? approvedBy.name),
        createdByRole: String(data.createdByRole ?? ''),
        isOffer: true,
        offerStatus: 'approved',
        offerReason: String(data.offerReason ?? ''),
        ...(data.splitCash ? { splitCash: Number(data.splitCash) } : {}),
        ...(data.splitUpi ? { splitUpi: Number(data.splitUpi) } : {}),
        ...(data.splitCard ? { splitCard: Number(data.splitCard) } : {}),
      })
      await updateDoc(bookingRef, {
        isDraft: false,
        offerApprovedBy: approvedBy.name,
        offerApprovedById: approvedBy.id,
        offerApprovedAt: new Date(),
      })
    } else {
      await updateDoc(bookingRef, {
        offerStatus: 'approved',
        offerApprovedBy: approvedBy.name,
        offerApprovedById: approvedBy.id,
        offerApprovedAt: new Date(),
        bookingStatus: 'confirmed',
        paymentStatus: 'completed',
      })
      // Finalize billing (assign serials, write vendor ledger). A failure
      // here was previously swallowed silently — that left orphan bookings
      // with paymentStatus='completed' but no billingItems, no vendorIds,
      // no ledger credits. Vendors lost revenue silently. Surface every
      // failure so the cashier / on-call sees it immediately.
      try {
        const { completeBillingOnPayment } = await import('../../lib/unified-booking')
        await completeBillingOnPayment(orderNumber)
      } catch (err) {
        logger.error('approve_offer.complete_billing_failed', err, {
          orderNumber,
          approvedBy: approvedBy.id,
        })
        throw new Error(
          `Offer approved but billing finalization failed for ${orderNumber}: ${err instanceof Error ? err.message : String(err)}. The booking is marked completed but vendor credits and serials were NOT written. Re-run completeBillingOnPayment manually or contact the developer team.`,
        )
      }
    }
  },

  async rejectOffer(
    orderNumber: string,
    _rejectedBy: { id: string; name: string },
    _reason?: string,
  ): Promise<void> {
    const firestore = getAsquareFirestore()
    const bookingRef = doc(firestore, 'bookings', orderNumber)
    const snap = await getDoc(bookingRef)
    if (!snap.exists()) throw new Error(`Offer request ${orderNumber} not found.`)
    const data = snap.data() as Record<string, unknown>
    if (!data.isOffer) throw new Error('This is not an offer request.')
    if (data.offerStatus === 'approved') throw new Error('Cannot reject an already approved offer.')

    await deleteDoc(bookingRef)

    const userId = String(data.userId ?? '')
    if (userId && !userId.startsWith('offline_')) {
      try {
        const userRef = doc(firestore, 'users', userId, 'bookings', orderNumber)
        const userSnap = await getDoc(userRef)
        if (userSnap.exists()) await deleteDoc(userRef)
      } catch {
        /* non-critical */
      }
    }
  },

  // ── Cashier-initiated cancellation (deletes draft, zero footprint) ──

  async cancelProtocolRequest(orderNumber: string): Promise<void> {
    const firestore = getAsquareFirestore()
    const bookingRef = doc(firestore, 'bookings', orderNumber)
    const snap = await getDoc(bookingRef)
    if (!snap.exists()) return // already gone
    const data = snap.data() as Record<string, unknown>
    if (!data.isProtocol) throw new Error('This is not a protocol request.')
    if (data.protocolStatus === 'approved')
      throw new Error('Cannot cancel an already approved protocol.')
    await deleteDoc(bookingRef)
    const userId = String(data.userId ?? '')
    if (userId && !userId.startsWith('offline_')) {
      try {
        const userRef = doc(firestore, 'users', userId, 'bookings', orderNumber)
        const userSnap = await getDoc(userRef)
        if (userSnap.exists()) await deleteDoc(userRef)
      } catch {
        /* non-critical */
      }
    }
  },

  /**
   * Refund a booking — partial or full — and settle the vendor ledger.
   *
   *   1. Updates booking.refundStatus / refundAmount / refundReason / items[].refunded
   *   2. Writes a `refund-debit` per affected vendor (sourced from existing
   *      ledger credits referenced by this booking) so vendor cheques shrink
   *      proportionally to the refund amount.
   *   3. Cash mode: caller is responsible for the till handover; we just log
   *      the audit event so the cashier reconciliation has a record.
   *      Wallet mode: credits the customer wallet via an atomic transaction.
   *   4. Regenerates pending invoices for the booking's period.
   *
   * Idempotent on the booking-update side. The vendor-ledger debit ID is
   * timestamped so multiple partial refunds each get their own row, but a
   * caller passing the same `idempotencyKey` for a wallet credit will not
   * double-credit the customer.
   */
  async refundBooking(
    booking: AsquareBooking,
    params: {
      mode: 'cash' | 'wallet'
      amount: number
      itemIndices: number[]
      reason: string
      actor: AdminActor
    },
  ): Promise<{
    success: boolean
    walletCredited?: boolean
    walletError?: string
    message?: string
  }> {
    if (!booking?.id) return { success: false, message: 'Invalid booking.' }
    const refundAmt = Math.round(Number(params.amount || 0))
    if (!Number.isFinite(refundAmt) || refundAmt <= 0) {
      return { success: false, message: 'Refund amount must be a positive number.' }
    }

    const finalAmount = Math.round(Number(booking.finalAmount || 0))
    const alreadyRefunded = Math.round(
      Number((booking as Record<string, unknown>).refundAmount ?? 0),
    )
    const remaining = Math.max(0, finalAmount - alreadyRefunded)
    if (remaining <= 0) {
      return { success: false, message: 'This booking is already fully refunded.' }
    }
    if (refundAmt > remaining) {
      return {
        success: false,
        message: `Refund amount ₹${refundAmt} exceeds remaining ₹${remaining}.`,
      }
    }
    if (!params.reason?.trim()) {
      return { success: false, message: 'Refund reason is required.' }
    }

    const firestore = getAsquareFirestore()

    // Block when this period's invoice is already locked. An admin can still
    // unlock the week, refund, and re-lock — but a silent ledger drift after
    // a locked period is the worst possible outcome.
    try {
      const { hasLockedInvoiceForDate } = await import('./accounting-firestore')
      if (await hasLockedInvoiceForDate(booking.createdAt)) {
        return {
          success: false,
          message: "A locked invoice covers this booking's period. Unlock it before refunding.",
        }
      }
    } catch {
      /* non-critical — proceed */
    }

    // 1. Mark items as refunded (item-level when indices supplied,
    //    full-refund flag otherwise).
    const rawItems = (booking as Record<string, unknown>).billingItems ?? booking.items
    const items = Array.isArray(rawItems) ? [...(rawItems as Array<Record<string, unknown>>)] : []
    if (params.itemIndices.length > 0) {
      for (const idx of params.itemIndices) {
        if (idx >= 0 && idx < items.length) {
          items[idx] = { ...items[idx], refunded: true }
        }
      }
    }
    const allRefunded =
      items.length > 0 &&
      items.every((it) => it.refunded === true) &&
      params.itemIndices.length === items.length
    const totalRefund = alreadyRefunded + refundAmt
    const refundStatus: 'None' | 'Partial' | 'Full' =
      allRefunded || totalRefund >= finalAmount ? 'Full' : 'Partial'

    const fieldName = (booking as Record<string, unknown>).billingItems ? 'billingItems' : 'items'
    const updates: Record<string, unknown> = {
      refundStatus,
      refundAmount: totalRefund,
      refundReason: params.reason.trim(),
      refundMode: params.mode,
      refundedBy: params.actor,
      refundedAt: new Date(),
      [fieldName]: items,
    }
    // When fully refunded, also flip paymentStatus per the canonical type.
    if (refundStatus === 'Full') {
      updates.paymentStatus = 'refunded'
    }

    try {
      await setDoc(doc(firestore, 'bookings', booking.id), compactFirestoreDoc(updates), {
        merge: true,
      })
      if (booking.userId && !String(booking.userId).startsWith('offline_')) {
        await setDoc(
          doc(firestore, 'users', booking.userId, 'bookings', booking.id),
          compactFirestoreDoc(updates),
          { merge: true },
        ).catch((err) =>
          logger.error('asquare_bookings.user_mirror_write_failed', err, {
            orderNumber: booking.id,
            userId: booking.userId,
            op: 'payment_update',
          }),
        )
      }
    } catch (error) {
      logger.error('asquare_bookings.refund_booking_update_failed', error, {
        orderNumber: booking.id,
      })
      return { success: false, message: 'Failed to update booking. Please try again.' }
    }

    // 2. Vendor ledger debit — derive from existing credits so we always
    //    debit the actual vendors who got credited (not whoever happens to
    //    be on items[] today, which can drift after re-attribute fixes).
    try {
      const ledgerSnap = await getDocs(
        query(
          collection(firestore, 'vendorLedger'),
          where('referenceId', '==', booking.id),
          where('type', '==', 'credit'),
        ),
      )
      const creditsByVendor = new Map<
        string,
        { vendorBase: number; vendorGst: number; amount: number }
      >()
      ledgerSnap.forEach((d) => {
        const data = d.data() as Record<string, unknown>
        const vid = String(data.vendorId ?? '')
        if (!vid) return
        const acc = creditsByVendor.get(vid) ?? { vendorBase: 0, vendorGst: 0, amount: 0 }
        acc.vendorBase += Number(data.vendorBase ?? 0)
        acc.vendorGst += Number(data.vendorGst ?? 0)
        acc.amount += Number(data.amount ?? 0)
        creditsByVendor.set(vid, acc)
      })

      const refundRatio = refundAmt / Math.max(1, finalAmount)
      const timestamp = Date.now()
      for (const [vid, totals] of creditsByVendor) {
        const vendorBase = Math.round(totals.vendorBase * refundRatio)
        const vendorGst = Math.round(totals.vendorGst * refundRatio)
        const amount = Math.round(totals.amount * refundRatio)
        if (amount <= 0) continue
        const ledgerId = `le-refund-${booking.id}-${vid}-${timestamp}`
        await setDoc(doc(firestore, 'vendorLedger', ledgerId), {
          id: ledgerId,
          vendorId: vid,
          vendorBase,
          vendorGst,
          amount,
          type: 'debit',
          referenceId: booking.id,
          invoiceNumber: booking.id,
          locationId: booking.locationId,
          date:
            booking.createdAt instanceof Date
              ? booking.createdAt.toISOString()
              : new Date().toISOString(),
          createdAt: new Date().toISOString(),
          source: 'refund' as const,
          refundedBy: params.actor,
        })
      }
    } catch (ledgerErr) {
      // Don't fail the refund if ledger write fails — surface loudly so an
      // admin can re-run a backfill, but the customer-facing refund stands.
      logger.error('asquare_bookings.refund_vendor_ledger_failed', ledgerErr, {
        orderNumber: booking.id,
      })
    }

    // 3. Wallet credit (only when mode === 'wallet').
    let walletCredited = false
    let walletError: string | undefined
    if (params.mode === 'wallet') {
      const phone = String(booking.userPhone ?? '').trim()
      if (!phone) {
        walletError = 'No phone number on booking — cannot credit wallet.'
        logger.error('asquare_bookings.refund_wallet_no_phone', undefined, {
          orderNumber: booking.id,
        })
      } else {
        try {
          const { creditCustomerWallet } = await import('./billing-firestore')
          await creditCustomerWallet(
            phone,
            refundAmt,
            `Refund for ${booking.id} — ${params.reason.trim()}`,
          )
          walletCredited = true
        } catch (err) {
          walletError = err instanceof Error ? err.message : 'Wallet credit failed.'
          logger.error('asquare_bookings.refund_wallet_credit_failed', err, {
            orderNumber: booking.id,
          })
        }
      }
    }

    // 4. Audit log entry.
    try {
      const logRef = doc(collection(firestore, 'booking_refund_logs'))
      await setDoc(
        logRef,
        compactFirestoreDoc({
          orderNumber: booking.id,
          userId: booking.userId,
          userPhone: booking.userPhone ?? '',
          userDisplayName: booking.userDisplayName ?? '',
          locationId: booking.locationId,
          mode: params.mode,
          amount: refundAmt,
          itemIndices: params.itemIndices,
          reason: params.reason.trim(),
          finalAmount,
          totalRefund,
          refundStatus,
          walletCredited,
          ...(walletError ? { walletError } : {}),
          refundedBy: params.actor,
          refundedAt: new Date(),
        }),
      )
    } catch (logErr) {
      logger.error('asquare_bookings.refund_log_failed', logErr, { orderNumber: booking.id })
    }

    // 5. Regenerate pending invoices so the new debit is reflected.
    try {
      const { generateFirestoreWeeklyInvoices } = await import('./accounting-firestore')
      await generateFirestoreWeeklyInvoices(booking.createdAt)
    } catch (invoiceErr) {
      logger.error('asquare_bookings.refund_invoice_regen_failed', invoiceErr, {
        orderNumber: booking.id,
      })
    }

    return { success: true, walletCredited, walletError }
  },

  /**
   * Reverse all sale credits for a paid booking by writing paired
   * `cancellation` debit rows. Idempotent — re-running on the same booking
   * is a no-op (deterministic doc IDs + same-amount writes).
   *
   * Why a debit row, not a delete: preserves audit trail. Owner sees the
   * original credit AND the cancellation debit in the ledger timeline.
   * Mirrors how refunds already work in `refundBooking` above.
   *
   * Triggered by AllBookingsView "Cancel" on bookings with
   * `paymentStatus === 'completed'`. Without this, the trigger
   * `syncVendorLedger` does NOT run (it gates on `cancelled === true`),
   * leaving stale credit rows in `vendorLedger` indefinitely.
   *
   * Returns the number of debit rows written.
   */
  async reverseVendorCreditsForBooking(
    bookingId: string,
    actor: { id: string; name: string },
  ): Promise<number> {
    const firestore = getAsquareFirestore()
    const ledgerSnap = await getDocs(
      query(
        collection(firestore, 'vendorLedger'),
        where('referenceId', '==', bookingId),
        where('type', '==', 'credit'),
      ),
    )
    if (ledgerSnap.empty) return 0

    // Aggregate per vendor (booking may have multiple credit rows for the
    // same vendor across different items — we collapse to one debit per vendor).
    const creditsByVendor = new Map<
      string,
      {
        vendorBase: number
        vendorGst: number
        amount: number
        invoiceNumber?: string
        locationId?: string
        date: string
      }
    >()
    ledgerSnap.forEach((d) => {
      const data = d.data() as Record<string, unknown>
      const vid = String(data.vendorId ?? '')
      if (!vid) return
      const acc = creditsByVendor.get(vid) ?? {
        vendorBase: 0,
        vendorGst: 0,
        amount: 0,
        invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : undefined,
        locationId: data.locationId ? String(data.locationId) : undefined,
        date: data.date ? String(data.date) : new Date().toISOString(),
      }
      acc.vendorBase += Number(data.vendorBase ?? 0)
      acc.vendorGst += Number(data.vendorGst ?? 0)
      acc.amount += Number(data.amount ?? 0)
      creditsByVendor.set(vid, acc)
    })

    let written = 0
    const nowIso = new Date().toISOString()
    for (const [vid, totals] of creditsByVendor) {
      if (totals.amount <= 0) continue
      const ledgerId = `le-cancel-${bookingId}-${vid}`
      await setDoc(
        doc(firestore, 'vendorLedger', ledgerId),
        compactFirestoreDoc({
          id: ledgerId,
          vendorId: vid,
          vendorBase: totals.vendorBase,
          vendorGst: totals.vendorGst,
          amount: totals.amount,
          type: 'debit' as const,
          referenceId: bookingId,
          invoiceNumber: totals.invoiceNumber ?? bookingId,
          locationId: totals.locationId,
          date: nowIso,
          createdAt: nowIso,
          source: 'cancellation' as const,
          entryType: 'cancellation' as const,
          cancelledBy: actor.id,
          cancelledByName: actor.name,
        }),
        { merge: true },
      )
      written++
    }

    // Refresh the period's invoice so the new debits are reflected immediately.
    if (written > 0) {
      try {
        const { generateFirestoreWeeklyInvoices } = await import('./accounting-firestore')
        const sample = creditsByVendor.values().next().value
        const periodSeed = sample?.date ? new Date(sample.date) : new Date()
        await generateFirestoreWeeklyInvoices(periodSeed)
      } catch (invoiceErr) {
        logger.error('asquare_bookings.cancel_invoice_regen_failed', invoiceErr, {
          orderNumber: bookingId,
        })
      }
    }

    return written
  },

  async cancelOfferRequest(orderNumber: string): Promise<void> {
    const firestore = getAsquareFirestore()
    const bookingRef = doc(firestore, 'bookings', orderNumber)
    const snap = await getDoc(bookingRef)
    if (!snap.exists()) return // already gone
    const data = snap.data() as Record<string, unknown>
    if (!data.isOffer) throw new Error('This is not an offer request.')
    if (data.offerStatus === 'approved') throw new Error('Cannot cancel an already approved offer.')
    await deleteDoc(bookingRef)
    const userId = String(data.userId ?? '')
    if (userId && !userId.startsWith('offline_')) {
      try {
        const userRef = doc(firestore, 'users', userId, 'bookings', orderNumber)
        const userSnap = await getDoc(userRef)
        if (userSnap.exists()) await deleteDoc(userRef)
      } catch {
        /* non-critical */
      }
    }
  },
}

/** Real-time subscription for recent protocol bookings. Returns unsubscribe fn. */
export const subscribeRecentProtocolBookings = (
  onData: (rows: AsquareBooking[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  let firestore: ReturnType<typeof getAsquareFirestore>
  try {
    firestore = getAsquareFirestore()
  } catch {
    onData([])
    return () => {}
  }
  const bookingsRef = collection(firestore, 'bookings')
  // IST-aware 4-day cutoff (today + 3 prior days)
  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() + 330)
  cutoff.setDate(cutoff.getDate() - 3)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setMinutes(cutoff.getMinutes() - 330)
  return onSnapshot(
    query(
      bookingsRef,
      where('isProtocol', '==', true),
      where('createdAt', '>=', cutoff),
      orderBy('createdAt', 'desc'),
      limit(20),
    ),
    (snapshot) => {
      const rows = snapshot.docs
        .map((record) =>
          parseBooking({ ...(record.data() as Record<string, unknown>), id: record.id }),
        )
        .filter((b) => !b.deletedAt)
      onData(rows)
    },
    onError,
  )
}

/** Real-time subscription for a single protocol booking's approval status. Returns unsubscribe fn. */
export const subscribeProtocolBookingStatus = (
  bookingId: string,
  onUpdate: (status: {
    protocolStatus: string
    protocolRejectReason?: string
    protocolApprovedBy?: string
    protocolApprovedAt?: Date
  }) => void,
  onError: (err: Error) => void,
): (() => void) => {
  let firestore: ReturnType<typeof getAsquareFirestore>
  try {
    firestore = getAsquareFirestore()
  } catch {
    return () => {}
  }
  const bookingRef = doc(firestore, 'bookings', bookingId)
  return onSnapshot(
    bookingRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        // Document deleted — treat as rejection (zero-footprint rejection)
        onUpdate({
          protocolStatus: 'rejected',
          protocolRejectReason: 'Request was rejected by Owner.',
        })
        return
      }
      const data = snapshot.data() as Record<string, unknown>
      onUpdate({
        protocolStatus: String(data.protocolStatus ?? 'pending_approval'),
        protocolRejectReason: data.protocolRejectReason
          ? String(data.protocolRejectReason)
          : undefined,
        protocolApprovedBy: data.protocolApprovedBy ? String(data.protocolApprovedBy) : undefined,
        protocolApprovedAt:
          data.protocolApprovedAt instanceof Date ? data.protocolApprovedAt : undefined,
      })
    },
    onError,
  )
}

/**
 * Creates a minimal draft protocol request in the bookings collection.
 * No billing enrichment, serial numbers, vendor ledger, or member updates.
 * The draft has paymentStatus: "pending" so it's excluded from transaction lists and reports.
 * On approval, createUnifiedBooking() overwrites this with a full booking.
 * On rejection, the draft is deleted entirely.
 */
export async function createProtocolRequest(params: {
  customerName: string
  customerPhone: string
  reason: string
  items: Array<{
    itemName: string
    quantity: number
    unitPrice: number
    gameId?: string
    subGameId?: string
    variantId?: string
    vendorId?: string
    vendorBranchId?: string
  }>
  locationId: string
  requestedById: string
  requestedByName: string
  requestedByRole: string
}): Promise<{ id: string }> {
  const firestore = getAsquareFirestore()
  const id = await ensureUniqueOrderNumber()
  const now = new Date()

  const draft: Record<string, unknown> = {
    id,
    invoiceNumber: id,
    isDraft: true,
    isProtocol: true,
    protocolStatus: 'pending_approval',
    protocolReason: params.reason,
    protocolRequestedBy: params.requestedByName,
    protocolRequestedAt: now,

    source: 'POS',
    sourceType: 'BILLING',
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    userDisplayName: params.customerName,
    userPhone: params.customerPhone,
    userId: `offline_${params.customerPhone}`,

    items: params.items.map((i) => ({
      itemName: i.itemName,
      quantity: i.quantity,
      unitPrice: 0,
      price: 0,
      gameId: i.gameId || undefined,
      subGameId: i.subGameId || undefined,
      variantId: i.variantId || undefined,
      vendorId: i.vendorId || undefined,
      vendorBranchId: i.vendorBranchId || undefined,
    })),

    locationId: params.locationId,
    paymentMethod: 'Protocol',
    paymentStatus: 'pending',
    bookingStatus: 'pending',
    totalAmount: 0,
    finalAmount: 0,
    discountAmount: 0,
    subtotal: 0,
    refundStatus: 'None',

    createdAt: now,
    transactionDate: now.toISOString(),
    createdByAdminId: params.requestedById,
    createdByAdminName: params.requestedByName,
    createdByRole: params.requestedByRole,
    createdBy: params.requestedById,
    createdByName: params.requestedByName,
    handledBy: params.requestedByName,
    handledByRole: params.requestedByRole,
  }

  // Remove undefined values
  for (const key of Object.keys(draft)) {
    if (draft[key] === undefined) delete draft[key]
  }
  for (const item of draft.items as Array<Record<string, unknown>>) {
    for (const key of Object.keys(item)) {
      if (item[key] === undefined) delete item[key]
    }
  }

  await setDoc(doc(firestore, 'bookings', id), draft)
  return { id }
}

// ── Offer Booking Subscriptions & Draft Creation ───────────────────────────

/** Real-time subscription for recent offer bookings. Returns unsubscribe fn. */
export const subscribeRecentOfferBookings = (
  onData: (rows: AsquareBooking[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  let firestore: ReturnType<typeof getAsquareFirestore>
  try {
    firestore = getAsquareFirestore()
  } catch {
    onData([])
    return () => {}
  }
  const bookingsRef = collection(firestore, 'bookings')
  // IST-aware 4-day cutoff (today + 3 prior days)
  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() + 330)
  cutoff.setDate(cutoff.getDate() - 3)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setMinutes(cutoff.getMinutes() - 330)
  return onSnapshot(
    query(
      bookingsRef,
      where('isOffer', '==', true),
      where('createdAt', '>=', cutoff),
      orderBy('createdAt', 'desc'),
      limit(20),
    ),
    (snapshot) => {
      const rows = snapshot.docs
        .map((record) =>
          parseBooking({ ...(record.data() as Record<string, unknown>), id: record.id }),
        )
        .filter((b) => !b.deletedAt)
      onData(rows)
    },
    onError,
  )
}

/** Real-time subscription for a single offer booking's approval status. Returns unsubscribe fn. */
export const subscribeOfferBookingStatus = (
  bookingId: string,
  onUpdate: (status: {
    offerStatus: string
    offerRejectReason?: string
    offerApprovedBy?: string
    offerApprovedAt?: Date
  }) => void,
  onError: (err: Error) => void,
): (() => void) => {
  let firestore: ReturnType<typeof getAsquareFirestore>
  try {
    firestore = getAsquareFirestore()
  } catch {
    return () => {}
  }
  const bookingRef = doc(firestore, 'bookings', bookingId)
  return onSnapshot(
    bookingRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onUpdate({ offerStatus: 'rejected', offerRejectReason: 'Request was rejected by Owner.' })
        return
      }
      const data = snapshot.data() as Record<string, unknown>
      onUpdate({
        offerStatus: String(data.offerStatus ?? 'pending_approval'),
        offerRejectReason: data.offerRejectReason ? String(data.offerRejectReason) : undefined,
        offerApprovedBy: data.offerApprovedBy ? String(data.offerApprovedBy) : undefined,
        offerApprovedAt: data.offerApprovedAt instanceof Date ? data.offerApprovedAt : undefined,
      })
    },
    onError,
  )
}

/**
 * Creates a minimal draft offer request in the bookings collection.
 * Unlike protocol (free), offer drafts store real pricing so approval creates
 * a full transaction with the correct amounts.
 */
export async function createOfferRequest(params: {
  customerName: string
  customerPhone: string
  reason: string
  items: Array<{
    itemName: string
    quantity: number
    unitPrice: number
    gameId?: string
    subGameId?: string
    variantId?: string
    vendorId?: string
    vendorBranchId?: string
  }>
  totalAmount: number
  finalAmount: number
  discountAmount: number
  paymentMethod: string
  splitCash?: number
  splitUpi?: number
  splitCard?: number
  locationId: string
  requestedById: string
  requestedByName: string
  requestedByRole: string
}): Promise<{ id: string }> {
  const firestore = getAsquareFirestore()
  const id = await ensureUniqueOrderNumber()
  const now = new Date()

  const draft: Record<string, unknown> = {
    id,
    invoiceNumber: id,
    isDraft: true,
    isOffer: true,
    offerStatus: 'pending_approval',
    offerReason: params.reason,
    offerRequestedBy: params.requestedByName,
    offerRequestedAt: now,

    source: 'POS',
    sourceType: 'BILLING',
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    userDisplayName: params.customerName,
    userPhone: params.customerPhone,
    userId: `offline_${params.customerPhone}`,

    items: params.items.map((i) => ({
      itemName: i.itemName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      price: i.unitPrice * i.quantity,
      gameId: i.gameId || undefined,
      subGameId: i.subGameId || undefined,
      variantId: i.variantId || undefined,
      vendorId: i.vendorId || undefined,
      vendorBranchId: i.vendorBranchId || undefined,
    })),

    locationId: params.locationId,
    paymentMethod: params.paymentMethod,
    paymentStatus: 'pending',
    bookingStatus: 'pending',
    totalAmount: params.totalAmount,
    finalAmount: params.finalAmount,
    subtotal: params.totalAmount,
    discountAmount: params.discountAmount,
    refundStatus: 'None',

    ...(params.splitCash ? { splitCash: params.splitCash } : {}),
    ...(params.splitUpi ? { splitUpi: params.splitUpi } : {}),
    ...(params.splitCard ? { splitCard: params.splitCard } : {}),

    createdAt: now,
    transactionDate: now.toISOString(),
    createdByAdminId: params.requestedById,
    createdByAdminName: params.requestedByName,
    createdByRole: params.requestedByRole,
    createdBy: params.requestedById,
    createdByName: params.requestedByName,
    handledBy: params.requestedByName,
    handledByRole: params.requestedByRole,
  }

  // Remove undefined values
  for (const key of Object.keys(draft)) {
    if (draft[key] === undefined) delete draft[key]
  }
  for (const item of draft.items as Array<Record<string, unknown>>) {
    for (const key of Object.keys(item)) {
      if (item[key] === undefined) delete item[key]
    }
  }

  await setDoc(doc(firestore, 'bookings', id), draft)
  return { id }
}
