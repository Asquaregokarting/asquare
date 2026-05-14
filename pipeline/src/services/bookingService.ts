import type { Booking, BookingItem, LocationId } from '../types'
import { ApplicationError, APIError, ValidationError } from '../types/errors'
import { auth, db } from '../lib/firebase'
import {
  doc,
  setDoc,
  updateDoc,
  query,
  collection,
  getDocs,
  orderBy,
  limit,
  deleteDoc,
  getDoc,
  where,
  Timestamp,
  startAfter,
} from 'firebase/firestore'
import { incrementHelicopterBookingCount } from './helicopterEarlyBird'
import { getBranchIdToSlugMap, getAllLocations } from '../lib/locations'
import { logger } from '../lib/logger'
import { resolveBookingItemIds } from '../lib/booking-items-validator'

// Safety ceiling for the legacy offset-style getUserBookings pagination.
// The cursor-based `getUserBookingsPage` below is the preferred API; this
// ceiling only bounds the old method while remaining callers migrate.
const MAX_BOOKINGS_FETCH = 500

/**
 * Opaque cursor for `getUserBookingsPage`. Callers should treat this as a
 * black box — the shape is an internal contract between the service and the
 * underlying Firestore `startAfter` call. We use primitive fields rather
 * than a QueryDocumentSnapshot so the cursor is trivially serializable
 * (React Query cache, URL state, etc.).
 */
export interface BookingsCursor {
  createdAtMs: number
  id: string
}

export interface BookingsPage {
  bookings: Booking[]
  nextCursor: BookingsCursor | null
  hasMore: boolean
}

/** Shared Firestore → Booking mapper used by both pagination code paths. */
function normalizeBookingDoc(data: unknown): Booking {
  const d = data as Record<string, unknown>
  const createdAtRaw = d.createdAt as { toDate?: () => Date } | string | number | Date | undefined
  const sessionDateRaw = d.sessionDate as
    | { toDate?: () => Date }
    | string
    | number
    | Date
    | undefined
  return {
    ...(d as object),
    createdAt:
      createdAtRaw &&
      typeof createdAtRaw === 'object' &&
      'toDate' in createdAtRaw &&
      typeof createdAtRaw.toDate === 'function'
        ? createdAtRaw.toDate()
        : new Date(createdAtRaw as string | number | Date),
    sessionDate:
      sessionDateRaw &&
      typeof sessionDateRaw === 'object' &&
      'toDate' in sessionDateRaw &&
      typeof sessionDateRaw.toDate === 'function'
        ? sessionDateRaw.toDate()
        : new Date(sessionDateRaw as string | number | Date),
  } as Booking
}

const INTERAKT_CONFIRM_FUNCTION_URL =
  'https://asia-south1-a-square-6720c.cloudfunctions.net/sendBookingConfirmationForUserBooking'
const INTERAKT_PAYMENT_LINK_FUNCTION_URL =
  'https://asia-south1-a-square-6720c.cloudfunctions.net/sendRazorpayPaymentLink'
const CREATE_ONLINE_ORDER_URL =
  'https://asia-south1-a-square-6720c.cloudfunctions.net/createOnlineOrder'

/**
 * Create a Razorpay order via Cloud Function.
 * Must be called with the exact amount that will be charged via Razorpay checkout.
 */
export async function createRazorpayOrder(params: {
  amount: number // Amount in rupees (NOT paise — the Cloud Function converts)
  orderNumber: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
}): Promise<string> {
  // Send Firebase ID token — the Cloud Function now requires auth.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const token = await auth.currentUser?.getIdToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  } catch {
    // Proceed without token — function will 401 if it requires auth
  }
  const res = await fetch(CREATE_ONLINE_ORDER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  })
  const result = await res.json()
  if (result.ok && result.orderId) {
    return result.orderId
  }
  throw new APIError(result.message || 'Failed to create payment order', 'RAZORPAY_ORDER_FAILED')
}

export interface CreateBookingParams {
  userId: string
  locationId: LocationId | string
  branchId: string // Numeric branch ID for API
  items: BookingItem[]
  totalAmount: number
  discountAmount: number
  finalAmount: number
  paymentMethod: string
  // User details for API
  mobile: string
  name: string
  email: string
  // Optional fields
  couponCode?: string
  couponAmount?: number
  walletAmountUsed?: number
  discountPercent?: number
  cashbackAmount?: number
  scheduleDate?: string // Booking/visit date (YYYY-MM-DD)
  adminId?: string
  adminName?: string
  adminRole?: string
  /**
   * Optional idempotency token. The unified-booking writer short-circuits if
   * a booking with the same token already exists. Defends against
   * double-clicks, retries, and tab reloads. Generate via
   * `newClientRequestId()` from `hooks/useSubmitGuard`.
   */
  clientRequestId?: string
}

export const BRANCH_MAP: Record<string, string> = getBranchIdToSlugMap()

// Centralized ID generation — imported from shared module
import { generateOrderNumber, ensureUniqueOrderNumber } from '../lib/unified-booking'
export { generateOrderNumber, ensureUniqueOrderNumber }

// Generate billing ID for API submission (legacy)
function generateBillingId(): string {
  const now = new Date()
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds()) +
    pad(now.getMilliseconds(), 3) +
    rand
  )
}

// Generate a unique QR code value
function generateQRCode(bookingId: string, userId: string): string {
  return `ASQUARE-${bookingId.toUpperCase()}-${userId.slice(-4).toUpperCase()}`
}

// Calculate tires earned (1 tire per ₹10 spent)
function calculateTires(amount: number): number {
  return Math.floor(amount / 10)
}

// Strip undefined values recursively — Firestore rejects undefined.
//
// CRITICAL: this helper must NOT recurse into Firestore SDK class
// instances. Things like `serverTimestamp()` and `Timestamp` are
// FieldValueImpl objects whose internal state lives on their
// prototype; recursing into them strips the prototype and produces a
// plain `{ "_methodName": "serverTimestamp" }` literal that Firestore
// then writes to disk as JSON instead of resolving as a sentinel. On
// reload that literal parses to epoch zero, which is exactly the
// 24-bookings-stamped-1970 incident on 2026-05-06.
//
// The Date check existed already; the prototype guard generalises it
// to every non-plain-object (Timestamp, GeoPoint, DocumentReference,
// any FieldValue subclass).
const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return false
  if (v instanceof Date) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripUndefined(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [
        k,
        isPlainObject(v)
          ? stripUndefined(v)
          : Array.isArray(v)
            ? v.map((item) => (isPlainObject(item) ? stripUndefined(item) : item))
            : v,
      ]),
  )
}

// Submit order to Firestore
export async function submitOrderToAPI(
  params: CreateBookingParams,
  billingId: string,
  orderNumber: string,
): Promise<Record<string, unknown>> {
  try {
    // Fail Fast Validation
    if (!params.mobile) throw new ValidationError('Mobile number is required')
    if (params.finalAmount < 0) throw new ValidationError('Invalid order amount')

    // Map cart items to games array
    const games = params.items.map((item) => ({
      id: parseInt(item.activity.apiId || (item.activity.id as string)) || 0,
      quantity: item.quantity,
    }))

    // Stamp gameId / subGameId / variantId on every item so the booking
    // doesn't land in Reconciliation > Orphans. Coupon discounts are
    // applied at order level (subTotal − discountAmount = finalAmount);
    // per-item unitPrice stays at retail so the company bears the coupon
    // hit and vendor splits compute against full retail downstream.
    const enrichedItems = params.items.map((item) => {
      const ids = resolveBookingItemIds({
        itemName:
          (item as { itemName?: string }).itemName || (item.activity?.name as string | undefined),
        gameId: (item as { gameId?: string }).gameId,
        subGameId: (item as { subGameId?: string }).subGameId,
        variantId: (item as { variantId?: string }).variantId,
        activity: item.activity,
      })
      return {
        ...item,
        gameId: ids.gameId,
        subGameId: ids.subGameId,
        variantId: ids.variantId ?? undefined,
      }
    })

    const normalizedPhone = params.mobile.replace(/\D/g, '').slice(-10)
    const locationId = BRANCH_MAP[params.branchId] ?? params.locationId ?? params.branchId
    const sessionDateStr = params.scheduleDate || params.items[0]?.date || ''

    const orderData = {
      // ── Standard fields (new format) ──
      id: orderNumber,
      userId: params.userId,
      locationId,
      userDisplayName: params.name,
      userPhone: normalizedPhone,
      totalAmount: params.totalAmount,
      discountAmount: params.discountAmount,
      finalAmount: params.finalAmount,
      // NOTE: paymentStatus / bookingStatus are deliberately NOT written here.
      // submitOrderToAPI runs both pre-Razorpay AND inside confirmDraftBooking;
      // writing 'pending' here would race with the Razorpay webhook (which
      // sets 'confirmed' / 'completed' server-side) and revert it on every
      // post-webhook merge. Status is owned by createDraftBooking (for the
      // initial pending value) and the webhook / updateBookingStatus path.
      paymentMethod: params.paymentMethod === 'upi' ? 'razorpay' : params.paymentMethod,
      qrCode: generateQRCode(orderNumber, params.userId),
      sessionDate: sessionDateStr ? new Date(sessionDateStr + 'T00:00:00Z') : new Date(),
      tires: calculateTires(params.finalAmount),
      cashbackAmount: params.cashbackAmount || 0,
      couponCode: params.couponCode || '',
      items: enrichedItems,
      createdAt: new Date(),
      // ── Legacy fields (backward compatibility) ──
      billing_id: billingId,
      mobile: normalizedPhone,
      name: params.name,
      email: params.email,
      amount: params.finalAmount,
      couponAmount: params.couponAmount || 0,
      billingType: 'online',
      walletAmountUsed: params.walletAmountUsed || 0,
      branchId: params.branchId,
      subTotal: params.totalAmount,
      discountPercent: params.discountPercent || 0,
      paymentGateway: params.paymentMethod === 'upi' ? 'razorpay' : params.paymentMethod,
      orderNumber: orderNumber,
      scheduleDate: sessionDateStr,
      games: games,
      status: 'pending',
    }

    // Soft-mode pre-flight validation: log invariant drift but never
    // block the customer's checkout. Reconciliation tools surface the
    // drift later; the cashier never sees a wall.
    const { validateBooking } = await import('../lib/booking-validator')
    const validation = validateBooking({
      id: orderNumber,
      items: enrichedItems as unknown as Array<Record<string, unknown>>,
      finalAmount: params.finalAmount,
      discountAmount: params.discountAmount,
      couponAmount: params.couponAmount,
      walletAmountUsed: params.walletAmountUsed,
    })
    if (!validation.ok) {
      logger.error('booking.validation_failed', new Error('Booking invariants failed'), {
        bookingId: orderNumber,
        writer: 'submitOrderToAPI',
        failures: validation.failures.map((f) => ({
          code: f.code,
          message: f.message,
          detail: f.detail,
        })),
      })
    }

    // Write to Firestore bookings collection (merge to preserve draft fields)
    const bookingRef = doc(db, 'bookings', orderNumber)
    await setDoc(bookingRef, stripUndefined(orderData), { merge: true })

    return { ...orderData, status: 'yes', orderNumber, billing_id: billingId }
  } catch (error) {
    if (error instanceof ApplicationError) throw error
    logger.error('booking.order_submission_failed', error)
    throw new APIError('Failed to save order', 'SUBMIT_ORDER_FAILED')
  }
}

export async function triggerInteraktBookingConfirmation(
  orderNumber: string,
  forceResend: boolean = true,
): Promise<{ success: boolean; message?: string; interaktResponse?: unknown }> {
  try {
    if (!orderNumber) return { success: false, message: 'Invalid Order Number' }

    const currentUser = auth.currentUser
    if (!currentUser) {
      logger.warn('booking.interakt_skip_no_auth')
      return { success: false, message: 'Not authenticated' }
    }

    const token = await currentUser.getIdToken()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(INTERAKT_CONFIRM_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        orderNumber,
        forceResend,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)
    const result = await response.json()

    if (!response.ok) {
      logger.warn('booking.interakt_trigger_failed', { status: response.status, result })
      return {
        success: false,
        message: result.message || 'Failed to send confirmation',
        interaktResponse: result.interaktResponse,
      }
    }

    return { success: true, interaktResponse: result.interaktResponse }
  } catch (error) {
    logger.warn('booking.interakt_trigger_error', { error })
    return { success: false, message: error instanceof Error ? error.message : 'Network error' }
  }
}

export async function sendPaymentLink(
  orderNumber: string,
  templateName?: string,
): Promise<{ success: boolean; message?: string; link?: string }> {
  try {
    if (!orderNumber) return { success: false, message: 'Invalid Order Number' }

    const currentUser = auth.currentUser
    if (!currentUser) {
      return { success: false, message: 'Not authenticated (Login required)' }
    }

    const token = await currentUser.getIdToken()

    const response = await fetch(INTERAKT_PAYMENT_LINK_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        orderNumber,
        templateName,
      }),
    })

    const result = await response.json()

    if (!response.ok) {
      return { success: false, message: result.message || 'Failed to send link' }
    }

    return { success: true, link: result.paymentLink }
  } catch (error) {
    logger.error('booking.send_payment_link_failed', error)
    return { success: false, message: 'Network error occurred' }
  }
}

/**
 * Validate that none of the activities the customer is about to book have
 * been flagged temporarily unavailable since the picker loaded. Returns a
 * list of activity names that are now down (empty when all clear).
 *
 * Checks BOTH the legacy `activities/{id}` collection AND the variant
 * hierarchy catalog because customer-app bookings can come from either
 * source (helicopter via legacy, regular activities via hierarchy).
 *
 * Non-throwing — on read failure, returns empty list (treat as "all clear")
 * so a transient Firestore hiccup doesn't block a paying customer.
 */
const validateActivitiesAvailable = async (
  items: CreateBookingParams['items'],
): Promise<string[]> => {
  try {
    const activityIds = items.map((i) => String(i.activity?.id ?? '')).filter(Boolean)
    if (activityIds.length === 0) return []

    const [{ listFirestoreActivityCatalog }, { listLegacyActivities }, { isCurrentlyUnavailable }] =
      await Promise.all([
        import('../pipeline/api/activity-catalog-firestore'),
        import('./activityService'),
        import('../pipeline/api/activity-availability'),
      ])
    const [hierarchy, legacy] = await Promise.all([
      listFirestoreActivityCatalog(),
      listLegacyActivities(),
    ])

    const downNames: string[] = []
    for (const item of items) {
      const id = String(item.activity?.id ?? '')
      if (!id) continue
      const fromHierarchy = hierarchy.find((h) => h.id === id)
      const fromLegacy = legacy.find((l) => l.id === id)
      if (isCurrentlyUnavailable(fromHierarchy) || isCurrentlyUnavailable(fromLegacy)) {
        downNames.push(item.activity?.name ?? id)
      }
    }
    return downNames
  } catch (error) {
    logger.error('booking.availability_recheck_failed', error)
    return []
  }
}

export const bookingService = {
  // Generate a billing ID
  generateBillingId() {
    return generateBillingId()
  },

  // Create a draft booking (pending payment).
  //
  // Used for the customer-app Razorpay flow: Draft created → Payment opens →
  // Webhook captures → success callback confirms.
  //
  // Internally delegates to createUnifiedBooking with paymentStatus='pending'
  // so the draft is BILLING-COMPLETE from the moment it's written: it carries
  // vendorId, vendorIds[], billingItems[] with GST splits, baseAmount, and
  // gstAmount. Previously this path wrote a raw doc missing all of those,
  // which produced ~65% orphan paid bookings whenever the Razorpay webhook
  // beat the client-side confirmDraftBooking (the webhook then short-circuits
  // confirmDraftBooking's already-confirmed early-return at line ~616 and
  // billing enrichment never runs).
  //
  // The vendor ledger and serial reservation are still gated on
  // paymentStatus='completed', so abandoned drafts stay invisible to the
  // ledger — only billingItems[] (internal accounting structure) is stamped
  // at draft time. Downstream readers all filter by paymentStatus.
  async createDraftBooking(
    params: CreateBookingParams,
    preGeneratedOrderNumber?: string,
  ): Promise<string> {
    try {
      const orderNumber = preGeneratedOrderNumber || (await ensureUniqueOrderNumber())
      const { createUnifiedBooking } = await import('../lib/unified-booking')

      const result = await createUnifiedBooking({
        id: orderNumber,
        source: 'APP_BOOKING',
        clientRequestId: params.clientRequestId,
        userId: params.userId,
        customerName: params.name || '',
        customerPhone: params.mobile || '',
        customerEmail: params.email,
        items: params.items.map((i) => ({
          itemName: i.activity?.name || 'Activity',
          quantity: i.quantity,
          unitPrice: i.price / (i.quantity || 1),
          activity: i.activity,
          duration: i.duration,
          date: i.date,
          timeSlot: i.timeSlot,
        })),
        totalAmount: params.totalAmount,
        discountAmount: params.discountAmount,
        finalAmount: params.finalAmount,
        paymentMethod: params.paymentMethod,
        paymentStatus: 'pending',
        bookingStatus: 'pending',
        locationId: params.locationId,
        sessionDate: new Date(params.items[0]?.date || new Date()),
        qrCode: generateQRCode(orderNumber, params.userId),
        tires: calculateTires(params.finalAmount),
        cashbackAmount: params.cashbackAmount || 0,
        couponCode: params.couponCode,
        couponAmount: params.couponAmount,
        createdByAdminId: params.adminId,
        createdByAdminName: params.adminName,
        createdByRole: params.adminRole,
      })

      // The Razorpay webhook reads `walletAmountUsed` for amount verification
      // (functions/api/razorpay.js). createUnifiedBooking writes the newer
      // `walletRedeemed` field but not the legacy mirror; merge it in here
      // so the verification path keeps working. We do NOT pass walletRedeemed
      // to createUnifiedBooking because that triggers an immediate wallet
      // debit — Checkout debits the wallet itself after this call.
      if (params.walletAmountUsed && params.walletAmountUsed > 0) {
        try {
          await setDoc(
            doc(db, 'bookings', result.id),
            { walletAmountUsed: params.walletAmountUsed },
            { merge: true },
          )
        } catch (err) {
          logger.error('booking.draft_wallet_amount_mirror_failed', err, {
            orderNumber: result.id,
          })
        }
      }

      return result.id
    } catch (error) {
      logger.error('booking.create_draft_failed', error)
      throw error
    }
  },

  // Confirm a draft booking (move from pending -> declared paid -> process API/PDF).
  //
  // CRITICAL: this function MUST be idempotent on enrichment, not on status.
  // The Razorpay webhook (functions/api/razorpay.js) frequently fires BEFORE
  // the customer's browser reaches the success page, so by the time this
  // runs the booking is already `bookingStatus='confirmed'` /
  // `paymentStatus='completed'`. The previous early-return on already-confirmed
  // skipped the entire post-confirm pipeline — including
  // completeBillingOnPayment — which is what stranded 65% of paid online
  // bookings with no serials / no vendor ledger. Now we only skip the parts
  // that are genuinely redundant (re-setting status, re-submitting to the
  // legacy API). Helicopter counter, Interakt confirmation, and billing
  // finalization all carry their own idempotency guards and run on every
  // invocation.
  async confirmDraftBooking(
    orderNumber: string,
    paymentId: string,
    skipApi = false,
    razorpaySignature?: string,
  ): Promise<boolean> {
    try {
      // 1. Fetch Draft
      const bookingRef = doc(db, 'bookings', orderNumber)
      const snap = await getDoc(bookingRef)
      if (!snap.exists()) throw new Error('Booking not found')
      const booking = snap.data() as Booking

      const alreadyConfirmed =
        booking.bookingStatus === 'confirmed' ||
        booking.bookingStatus === 'completed' ||
        booking.paymentStatus === 'completed'

      if (alreadyConfirmed) {
        logger.info('booking.already_confirmed_post_payment_flow_continues', {
          orderNumber,
          bookingStatus: booking.bookingStatus,
          paymentStatus: booking.paymentStatus,
        })
      } else {
        // 2. Update Status — only when we're the first to confirm
        const statusUpdated = await this.updateBookingStatus(
          orderNumber,
          'confirmed',
          'completed',
          paymentId,
          booking.razorpayOrderId ?? undefined,
          razorpaySignature,
        )
        if (!statusUpdated) {
          throw new Error(`Failed to update booking status to confirmed for ${orderNumber}`)
        }
      }

      // 4. Submit to API.
      // Runs regardless of who confirmed first: if the webhook beat us, we
      // still need the legacy `billing_id` / `name` / `mobile` / `games[]`
      // fields the PHP API expects. submitOrderToAPI no longer writes
      // `bookingStatus` / `paymentStatus`, so this can't revert a confirmed
      // booking back to pending.
      if (!skipApi) {
        const params: CreateBookingParams = {
          userId: booking.userId,
          locationId: booking.locationId,
          branchId:
            Object.keys(BRANCH_MAP).find((k) => BRANCH_MAP[k] === booking.locationId) || '0',
          items: booking.items,
          totalAmount: booking.totalAmount,
          discountAmount: booking.discountAmount,
          finalAmount: booking.finalAmount,
          paymentMethod: booking.paymentMethod || 'razorpay',
          mobile: booking.userPhone || '',
          name: booking.userDisplayName || '',
          email: '', // Email might not be in flat object, fallback
          scheduleDate:
            booking.sessionDate instanceof Date
              ? booking.sessionDate.toISOString().split('T')[0]
              : booking.sessionDate,
          adminId: booking.createdByAdminId,
          adminName: booking.createdByAdminName,
          adminRole: booking.createdByRole,
        }

        const billingId = generateBillingId()
        try {
          // Submit to PHP API
          // API requires payment breakdown.
          // We assume payment is already successful via Razorpay.
          // The API call usually happens in createBooking inside.
          // We should reuse submitOrderToAPI.
          const apiResult = await submitOrderToAPI(params, billingId, orderNumber)
          if (apiResult.status !== 'yes' && apiResult.status !== 'success') {
            logger.warn('booking.draft_api_submission_failed')
          }
        } catch (e) {
          logger.error('booking.draft_api_sync_failed', e)
        }
      }

      // 5. Boarding pass is now a printable page at /boarding-pass/{orderNumber}

      // 6. Helicopter Counter — guarded by `helicopterCountIncremented` to prevent
      // double-counting when both the client-side confirmation and the Razorpay
      // webhook race to process the same booking.
      if (!booking.helicopterCountIncremented) {
        try {
          const heliSeats = booking.items.reduce((sum: number, item: BookingItem) => {
            // legacy `game_name` field on older activity records
            const name = (
              item.activity.name ||
              (item.activity as { game_name?: string }).game_name ||
              ''
            ).toLowerCase()
            const cat = (item.activity.category || '').toLowerCase()
            if (name.includes('helicopter') || cat.includes('helicopter')) {
              return sum + item.quantity
            }
            return sum
          }, 0)
          if (heliSeats > 0) {
            await incrementHelicopterBookingCount(heliSeats)
            await updateDoc(bookingRef, { helicopterCountIncremented: true })
          }
        } catch (heliErr) {
          logger.error('booking.increment_helicopter_counter_failed', heliErr)
        }
      }

      // 7. Trigger Interakt Confirmation — guarded by interakt.outboundRequestedAt
      // so we don't double-send when the Razorpay webhook already pushed the
      // confirmation. Re-read the booking doc to pick up any state the webhook
      // wrote between step 1 and here.
      try {
        const freshSnap = await getDoc(bookingRef)
        const fresh = (freshSnap.exists() ? freshSnap.data() : booking) as Booking & {
          interakt?: { outboundRequestedAt?: unknown }
        }
        if (!fresh.interakt?.outboundRequestedAt) {
          const result = await triggerInteraktBookingConfirmation(orderNumber)
          if (!result.success) {
            logger.warn('booking.interakt_confirmation_failed', { message: result.message })
          }
        } else {
          logger.info('booking.interakt_already_sent_skipping', { orderNumber })
        }
      } catch (interaktErr) {
        logger.error('booking.trigger_interakt_confirmation_failed', interaktErr)
      }

      // 8. Finalize billing (assign serials, write vendor ledger).
      // This is the call that closes the 65%-orphan-paid-bookings bug: when
      // the webhook beats the success page, the old early-return at step 2
      // skipped this entirely, leaving the booking without serials or vendor
      // ledger. It runs unconditionally now; completeBillingOnPayment is
      // internally idempotent — it short-circuits when serials are already
      // assigned and merge-writes when they aren't.
      try {
        const { completeBillingOnPayment } = await import('../lib/unified-booking')
        await completeBillingOnPayment(orderNumber)
      } catch (billingErr) {
        logger.error('booking.finalize_billing_failed', billingErr, { orderNumber })
      }

      return true
    } catch (error) {
      logger.error('booking.confirm_draft_failed', error)
      throw error
    }
  },

  // Create a pending booking (Firestore only — no PDF, no helicopter counter, no API)
  // Used for "Send Link" flow where payment hasn't happened yet
  async createPendingBooking(params: CreateBookingParams): Promise<string> {
    try {
      // Block customers whose form was open when an admin flagged the game
      // unavailable. Throw a ValidationError naming the affected items so
      // the Checkout UI can surface a clear message and let them re-pick.
      const downNames = await validateActivitiesAvailable(params.items)
      if (downNames.length > 0) {
        throw new ValidationError(
          `The following activity(ies) are no longer available: ${downNames.join(', ')}. Please refresh and pick a different game.`,
        )
      }
      const orderNumber = await ensureUniqueOrderNumber()
      const { createUnifiedBooking } = await import('../lib/unified-booking')
      const result = await createUnifiedBooking({
        id: orderNumber,
        source: 'APP_BOOKING',
        clientRequestId: params.clientRequestId,
        userId: params.userId,
        customerName: params.name || '',
        customerPhone: params.mobile || '',
        items: params.items.map((i) => ({
          itemName: i.activity?.name || 'Activity',
          quantity: i.quantity,
          unitPrice: i.price / (i.quantity || 1),
          activity: i.activity,
          duration: i.duration,
          date: i.date,
          timeSlot: i.timeSlot,
        })),
        totalAmount: params.totalAmount,
        discountAmount: params.discountAmount,
        finalAmount: params.finalAmount,
        paymentMethod: 'link',
        paymentStatus: 'pending',
        bookingStatus: 'pending',
        locationId: params.locationId,
        sessionDate: new Date(params.items[0]?.date || new Date()),
        qrCode: generateQRCode(orderNumber, params.userId),
        tires: calculateTires(params.finalAmount),
        cashbackAmount: params.cashbackAmount || 0,
        createdByAdminId: params.adminId,
        createdByAdminName: params.adminName,
        createdByRole: params.adminRole,
      })
      return result.id
    } catch (error) {
      logger.error('booking.create_pending_failed', error)
      throw error
    }
  },

  // Create a new booking (full flow — API, helicopter counter, Interakt)
  async createBooking(
    params: CreateBookingParams,
    preGeneratedOrderNumber?: string,
    skipApi = false,
    isPaid = false,
  ): Promise<string> {
    try {
      // Skip the availability re-check if the customer has already paid.
      // Pre-paid bookings should always reach Firestore so the swap flow
      // can take over in-store; refusing here would leave the customer
      // charged with no booking record. Defensive check applies only to
      // unpaid bookings (the dominant flow).
      if (!isPaid) {
        const downNames = await validateActivitiesAvailable(params.items)
        if (downNames.length > 0) {
          throw new ValidationError(
            `The following activity(ies) are no longer available: ${downNames.join(', ')}. Please refresh and pick a different game.`,
          )
        }
      }
      const billingId = generateBillingId()
      const orderNumber = preGeneratedOrderNumber || (await ensureUniqueOrderNumber())

      // Submit to API if not skipped
      if (!skipApi) {
        try {
          const apiResult = await submitOrderToAPI(params, billingId, orderNumber)
          if (apiResult.status !== 'yes' && apiResult.status !== 'success') {
            logger.warn('booking.api_submission_local_only')
          }
        } catch (apiErr) {
          logger.error('booking.api_submission_failed_create', apiErr)
        }
      }

      const paymentStatus =
        isPaid || params.finalAmount === 0 || params.paymentMethod === 'cash'
          ? 'completed'
          : 'pending'

      // Create booking with full billing fields via unified function
      const { createUnifiedBooking } = await import('../lib/unified-booking')
      await createUnifiedBooking({
        id: orderNumber,
        source: 'APP_BOOKING',
        clientRequestId: params.clientRequestId,
        userId: params.userId,
        customerName: params.name || '',
        customerPhone: params.mobile || '',
        items: params.items.map((i) => ({
          itemName: i.activity?.name || 'Activity',
          quantity: i.quantity,
          unitPrice: i.price / (i.quantity || 1),
          activity: i.activity,
          duration: i.duration,
          date: i.date,
          timeSlot: i.timeSlot,
        })),
        totalAmount: params.totalAmount,
        discountAmount: params.discountAmount,
        finalAmount: params.finalAmount,
        paymentMethod: params.paymentMethod,
        paymentStatus: paymentStatus as 'pending' | 'completed' | 'failed',
        bookingStatus: paymentStatus === 'completed' ? 'confirmed' : 'pending',
        locationId: params.locationId,
        sessionDate: new Date(params.items[0]?.date || new Date()),
        qrCode: generateQRCode(orderNumber, params.userId),
        tires: calculateTires(params.finalAmount),
        cashbackAmount: params.cashbackAmount || 0,
        couponCode: params.couponCode,
        couponAmount: params.couponAmount,
        createdByAdminId: params.adminId,
        createdByAdminName: params.adminName,
        createdByRole: params.adminRole,
      })

      // Trigger Interakt confirmation if the booking is fully paid/cash
      if (paymentStatus === 'completed') {
        try {
          const result = await triggerInteraktBookingConfirmation(orderNumber)
          if (!result.success) {
            logger.warn('booking.interakt_confirmation_complete_failed', {
              message: result.message,
            })
          }
        } catch (interaktErr) {
          logger.error('booking.trigger_interakt_confirmation_failed', interaktErr)
        }
      }

      // Increment helicopter early bird counter (with idempotency guard)
      try {
        const heliSeats = params.items.reduce((sum: number, item: BookingItem) => {
          const name = (item.activity.name || '').toLowerCase()
          const cat = (item.activity.category || '').toLowerCase()
          if (name.includes('helicopter') || cat.includes('helicopter')) {
            return sum + item.quantity
          }
          return sum
        }, 0)
        if (heliSeats > 0) {
          await incrementHelicopterBookingCount(heliSeats)
          await updateDoc(doc(db, 'bookings', orderNumber), { helicopterCountIncremented: true })
        }
      } catch (heliErr) {
        logger.error('booking.increment_helicopter_counter_failed', heliErr)
      }

      return orderNumber
    } catch (error) {
      logger.error('booking.create_failed', error)
      throw error
    }
  },

  /**
   * Fetch a single page of a user's bookings using true cursor pagination.
   *
   * Uses Firestore `startAfter` on the `createdAt` timestamp, so the read
   * cost is O(pageLimit) regardless of how deep into the history the caller
   * scrolls. This replaces the old offset-style `getUserBookings(..., page)`
   * which read `pageLimit * page` docs per call and grew linearly with page
   * depth.
   *
   * MERGE SEMANTICS:
   *   There are two booking sources (main `users/{uid}/bookings` and the
   *   offline fallback `users/offline_{phone}/bookings`). Both are sorted by
   *   `createdAt DESC`. We fetch `pageLimit` from each source past the
   *   cursor, merge + dedupe against `deleted_bookings`, sort, and slice to
   *   `pageLimit`. The next cursor is the `createdAt` of the last booking
   *   returned to the caller.
   *
   *   This over-reads by at most `pageLimit` docs per source on each page,
   *   which is dramatically cheaper than the old `pageLimit * page` growth.
   *
   * Caller wiring is in `src/pages/MyBookings.tsx`.
   */
  async getUserBookingsPage(
    userId: string,
    mobile?: string,
    options?: {
      pageLimit?: number
      cursor?: BookingsCursor | null
    },
  ): Promise<BookingsPage> {
    const pageLimit = Math.max(1, Math.min(options?.pageLimit ?? 20, 100))
    const cursor = options?.cursor ?? null
    if (!userId) {
      return { bookings: [], nextCursor: null, hasMore: false }
    }

    const offlineMobile = mobile ? mobile.replace(/\D/g, '').slice(-10) : ''
    const offlineUserId = offlineMobile ? `offline_${offlineMobile}` : ''

    const cursorTimestamp = cursor ? Timestamp.fromMillis(cursor.createdAtMs) : null

    const buildPagedQuery = (collectionPath: string[]) => {
      const base = collection(db, collectionPath[0], collectionPath[1], collectionPath[2])
      const constraints = [
        orderBy('createdAt', 'desc'),
        ...(cursorTimestamp ? [startAfter(cursorTimestamp)] : []),
        // Fetch one extra to detect "has more" cheaply.
        limit(pageLimit + 1),
      ]
      return query(base, ...constraints)
    }

    const mainUserPromise = (async () => {
      try {
        const snapshot = await getDocs(buildPagedQuery(['users', userId, 'bookings']))
        return snapshot.docs.map((d) => normalizeBookingDoc(d.data()))
      } catch (fsError) {
        logger.error('booking.page_main_failed', fsError)
        return []
      }
    })()

    const offlineUserPromise = (async () => {
      if (!offlineUserId) return []
      try {
        const snapshot = await getDocs(buildPagedQuery(['users', offlineUserId, 'bookings']))
        return snapshot.docs.map((d) => normalizeBookingDoc(d.data()))
      } catch (fsError) {
        logger.error('booking.page_offline_failed', fsError)
        return []
      }
    })()

    const deletedPromise = (async () => {
      try {
        const deletedRef = collection(db, 'deleted_bookings')
        const queries = [query(deletedRef, where('userId', '==', userId))]
        if (offlineUserId) {
          queries.push(query(deletedRef, where('userId', '==', offlineUserId)))
        }
        const snapshots = await Promise.all(queries.map((q) => getDocs(q)))
        const deletedIds = new Set<string>()
        snapshots.forEach((snap) => {
          snap.docs.forEach((docSnap) => deletedIds.add(docSnap.id))
        })
        return deletedIds
      } catch (error) {
        logger.error('booking.page_fetch_deleted_failed', error)
        return new Set<string>()
      }
    })()

    const [mainBookings, offlineBookings, deletedIds] = await Promise.all([
      mainUserPromise,
      offlineUserPromise,
      deletedPromise,
    ])

    // Merge + dedupe + sort desc + cap to pageLimit.
    const uniqueMap = new Map<string, Booking>()
    for (const b of [...mainBookings, ...offlineBookings]) {
      if (!deletedIds.has(b.id) && !uniqueMap.has(b.id)) {
        uniqueMap.set(b.id, b)
      }
    }
    const merged = Array.from(uniqueMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )

    // "has more" is true if either source returned its full limit+1
    // bucket (meaning we definitely over-read) OR if the merged result
    // exceeds pageLimit.
    const eitherSourceHasMore =
      mainBookings.length > pageLimit || offlineBookings.length > pageLimit
    const page = merged.slice(0, pageLimit)
    const hasMore = eitherSourceHasMore || merged.length > pageLimit

    const last = page[page.length - 1]
    const nextCursor: BookingsCursor | null =
      hasMore && last
        ? {
            createdAtMs: new Date(last.createdAt).getTime(),
            id: last.id,
          }
        : null

    return { bookings: page, nextCursor, hasMore }
  },

  // Get bookings for a specific user
  async getUserBookings(
    userId: string,
    mobile?: string,
    page: number = 1,
    pageLimit: number = 20,
  ): Promise<Booking[]> {
    try {
      if (!userId) return []

      const offlineMobile = mobile ? mobile.replace(/\D/g, '').slice(-10) : ''
      const offlineUserId = offlineMobile ? `offline_${offlineMobile}` : ''

      // 1. Fetch from Main User Firestore
      const mainUserPromise = (async () => {
        try {
          const bookingsRef = collection(db, 'users', userId, 'bookings')
          // Cap the worst-case read at MAX_BOOKINGS_FETCH so a runaway page
          // param can't cause a 10k-doc scan. Proper cursor pagination is a
          // follow-up; this is a safety ceiling.
          const q = query(
            bookingsRef,
            orderBy('createdAt', 'desc'),
            limit(Math.min(pageLimit * page, MAX_BOOKINGS_FETCH)),
          )
          const snapshot = await getDocs(q)
          return snapshot.docs.map((doc) => {
            const data = doc.data()
            return {
              ...data,
              createdAt: data.createdAt?.toDate
                ? data.createdAt.toDate()
                : new Date(data.createdAt),
              sessionDate: data.sessionDate?.toDate
                ? data.sessionDate.toDate()
                : new Date(data.sessionDate),
            } as Booking
          })
        } catch (fsError) {
          logger.error('booking.fetch_main_user_firestore_failed', fsError)
          return []
        }
      })()

      // 2. Fetch from Offline User Firestore (Parallel)
      const offlineUserPromise = (async () => {
        if (!offlineUserId) return []
        try {
          const bookingsRef = collection(db, 'users', offlineUserId, 'bookings')
          // Cap the worst-case read at MAX_BOOKINGS_FETCH so a runaway page
          // param can't cause a 10k-doc scan. Proper cursor pagination is a
          // follow-up; this is a safety ceiling.
          const q = query(
            bookingsRef,
            orderBy('createdAt', 'desc'),
            limit(Math.min(pageLimit * page, MAX_BOOKINGS_FETCH)),
          )
          const snapshot = await getDocs(q)
          return snapshot.docs.map((doc) => {
            const data = doc.data()
            return {
              ...data,
              createdAt: data.createdAt?.toDate
                ? data.createdAt.toDate()
                : new Date(data.createdAt),
              sessionDate: data.sessionDate?.toDate
                ? data.sessionDate.toDate()
                : new Date(data.sessionDate),
            } as Booking
          })
        } catch (fsError) {
          logger.error('booking.fetch_offline_firestore_failed', fsError)
          return []
        }
      })()

      // 3. API fetch removed — Firestore is the single source of truth
      const apiPromise = Promise.resolve([] as Booking[])

      // 4. Fetch Deleted Bookings IDs (Parallel)
      const deletedPromise = (async () => {
        try {
          const deletedRef = collection(db, 'deleted_bookings')
          // Query for both authenticated user and offline user (phone based)
          const queries = []
          queries.push(query(deletedRef, where('userId', '==', userId)))

          if (offlineUserId) {
            queries.push(query(deletedRef, where('userId', '==', offlineUserId)))
          }

          const snapshots = await Promise.all(queries.map((q) => getDocs(q)))
          const deletedIds = new Set<string>()
          snapshots.forEach((snap) => {
            snap.docs.forEach((doc) => deletedIds.add(doc.id))
          })

          return deletedIds
        } catch (error) {
          logger.error('booking.fetch_deleted_failed', error)
          return new Set<string>()
        }
      })()

      const [mainBookings, offlineBookings, apiBookings, deletedIds] = await Promise.all([
        mainUserPromise,
        offlineUserPromise,
        apiPromise,
        deletedPromise,
      ])

      // Merge & Deduplicate
      const uniqueMap = new Map<string, Booking>()
      const allRaw = [...mainBookings, ...offlineBookings, ...apiBookings]

      allRaw.forEach((b) => {
        // Only add if not deleted and not already added
        if (!deletedIds.has(b.id) && !uniqueMap.has(b.id)) {
          uniqueMap.set(b.id, b)
        }
      })

      const finalBookings = Array.from(uniqueMap.values())
      finalBookings.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )

      return finalBookings
    } catch (error) {
      logger.error('booking.get_user_bookings_failed', error)
      throw error
    }
  },

  // Mark a booking as used (scanned at venue)
  async markAsUsed(_bookingId: string): Promise<boolean> {
    // API handles status internally when scanned at venue
    return true
  },

  /**
   * Fetch a single booking by id with light normalization (Firestore
   * Timestamps → JS Dates, fallback fields). Returns null if not found.
   *
   * Pages should call this instead of `getDoc(doc(db, 'bookings', id))`
   * directly so the dual-app rule "no raw Firestore in components" holds.
   */
  async getBookingById(bookingId: string): Promise<Booking | null> {
    if (!bookingId) return null
    try {
      const snap = await getDoc(doc(db, 'bookings', bookingId))
      if (!snap.exists()) return null
      const d = snap.data() as Record<string, unknown> & Partial<Booking>
      // Normalize timestamps — Firestore returns Timestamp objects, but
      // some legacy docs store ISO strings.
      const sd = d.sessionDate as { toDate?: () => Date } | string | undefined
      const sessionDate =
        sd && typeof sd === 'object' && typeof sd.toDate === 'function'
          ? sd.toDate()
          : sd
            ? new Date(sd as string)
            : (d as { scheduleDate?: string }).scheduleDate
              ? new Date(`${(d as { scheduleDate: string }).scheduleDate}T00:00:00Z`)
              : new Date()
      const ca = d.createdAt as { toDate?: () => Date } | string | undefined
      const createdAt =
        ca && typeof ca === 'object' && typeof ca.toDate === 'function'
          ? ca.toDate()
          : ca
            ? new Date(ca as string)
            : new Date()

      return {
        ...(d as object),
        id: snap.id,
        sessionDate,
        createdAt,
        userDisplayName:
          (d as { userDisplayName?: string; name?: string }).userDisplayName ||
          (d as { name?: string }).name ||
          'Guest',
        userPhone:
          (d as { userPhone?: string; mobile?: string }).userPhone ||
          (d as { mobile?: string }).mobile ||
          '',
        finalAmount: Number(
          (d as { finalAmount?: number; amount?: number }).finalAmount ??
            (d as { amount?: number }).amount ??
            0,
        ),
        totalAmount: Number(
          (d as { totalAmount?: number; subTotal?: number }).totalAmount ??
            (d as { subTotal?: number }).subTotal ??
            0,
        ),
        locationId:
          (d as { locationId?: string; branchId?: string }).locationId ||
          (d as { branchId?: string }).branchId ||
          '',
      } as Booking
    } catch (error) {
      logger.error('booking.fetch_by_id_failed', error)
      return null
    }
  },

  // Delete a booking (Soft delete/Move to Trash)
  async deleteBooking(
    orderNumber: string,
    userId: string,
    deletedBy?: { id: string; name: string; role: string },
  ): Promise<boolean> {
    try {
      // 1. Fetch the booking first
      const bookingRef = doc(db, 'bookings', orderNumber)
      const bookingSnap = await getDoc(bookingRef)

      if (bookingSnap.exists()) {
        const bookingData = bookingSnap.data() as Booking

        // 2. Archive to 'deleted_bookings'
        const deletedRef = doc(db, 'deleted_bookings', orderNumber)
        await setDoc(deletedRef, {
          ...bookingData,
          deletedAt: new Date(),
          deletedBy: deletedBy || { id: 'unknown', name: 'Unknown', role: 'unknown' },
        })

        // 3. Calculate helicopter seats to restore
        // ONLY restore if the counter was actually incremented for this booking.
        if (bookingData.helicopterCountIncremented) {
          const heliSeats = bookingData.items.reduce((sum: number, item: BookingItem) => {
            const name = (item.activity.name || '').toLowerCase()
            const cat = (item.activity.category || '').toLowerCase()
            if (name.includes('helicopter') || cat.includes('helicopter')) {
              return sum + item.quantity
            }
            return sum
          }, 0)

          // 4. Decrement the counter if needed
          if (heliSeats > 0) {
            await incrementHelicopterBookingCount(-heliSeats)
          }
        }
      }

      // 5. Delete from flat bookings collection
      await deleteDoc(bookingRef)

      // 6. Delete from user's subcollection
      if (userId && !userId.startsWith('offline_')) {
        await deleteDoc(doc(db, 'users', userId, 'bookings', orderNumber))
      }

      return true
    } catch (error) {
      logger.error('booking.delete_failed', error)
      return false
    }
  },

  // Update a booking
  async updateBooking(
    orderNumber: string,
    userId: string,
    updates: Partial<Booking>,
  ): Promise<boolean> {
    try {
      const bookingRef = doc(db, 'bookings', orderNumber)

      // Update flat bookings collection
      await setDoc(bookingRef, updates, { merge: true })

      // Update user's subcollection
      if (userId && !userId.startsWith('offline_')) {
        const userBookingRef = doc(db, 'users', userId, 'bookings', orderNumber)
        await setDoc(userBookingRef, updates, { merge: true })
      }

      return true
    } catch (error) {
      logger.error('booking.update_failed', error)
      return false
    }
  },

  // Reset check-in status for multiple bookings
  async resetCheckInStatus(bookings: { id: string; userId: string }[]): Promise<number> {
    try {
      let count = 0

      // Process in batches of 10
      const batchSize = 10
      for (let i = 0; i < bookings.length; i += batchSize) {
        const batch = bookings.slice(i, i + batchSize)
        await Promise.all(
          batch.map(async (b) => {
            const success = await this.updateBooking(b.id, b.userId, {
              checkInStatus: 'pending',
            } as Partial<Booking>)
            if (success) count++
          }),
        )
      }

      return count
    } catch (error) {
      logger.error('booking.reset_checkin_failed', error)
      return 0
    }
  },

  // Update booking status (used by frontend after successful payment)
  async updateBookingStatus(
    orderNumber: string,
    status: 'confirmed' | 'completed' | 'cancelled',
    paymentStatus: 'completed' | 'pending' | 'failed',
    paymentId?: string,
    razorpayOrderId?: string,
    razorpaySignature?: string,
  ): Promise<boolean> {
    try {
      // 1. Get current booking to update user subcollection too
      const bookingRef = doc(db, 'bookings', orderNumber)
      const snap = await getDoc(bookingRef)
      if (!snap.exists()) return false
      const data = snap.data() as Booking

      const updates: Partial<Booking> = {
        bookingStatus: status,
        paymentStatus: paymentStatus,
        ...(paymentId ? { paymentId } : {}),
        ...(razorpayOrderId ? { razorpayOrderId } : {}),
        ...(razorpaySignature ? { razorpaySignature } : {}),
      }

      // 2. Update Flat
      await setDoc(bookingRef, updates, { merge: true })

      // 3. Update User Subcollection
      if (data.userId && !data.userId.startsWith('offline_')) {
        const userBookingRef = doc(db, 'users', data.userId, 'bookings', orderNumber)
        await setDoc(userBookingRef, updates, { merge: true })
      }

      // 4. If confirmed/completed, trigger post-booking actions (PDF, API, etc.)
      // Note: In the robust flow, we might want to trigger these explicitly.
      // For now, we assume the frontend or webhook handles the critical API submission/PDF generation
      // BUT if we want true robustness, we should trigger them here or via cloud function.
      // Let's rely on the frontend to call `confirmRazorpayOrder` which calls API.
      // PDF generation might be skipped if we don't call createBooking.
      // Ideally, we move `createBooking` logic to a `confirmDraftBooking` method.

      return true
    } catch (error) {
      logger.error('booking.update_status_failed', error)
      return false
    }
  },

  // Confirm Razorpay order — store payment reference in Firestore.
  // NOTE: paymentStatus is NOT set to 'completed' here. The server-side
  // webhook (razorpayWebhook) verifies the paid amount against the booking
  // and only then marks it as completed. This prevents client-side tampering.
  async confirmRazorpayOrder(params: {
    paymentId: string
    razorpayOrderId: string
    razorpaySignature: string
    orderNumber: string
  }): Promise<boolean> {
    try {
      const bookingRef = doc(db, 'bookings', params.orderNumber)
      await setDoc(
        bookingRef,
        {
          paymentId: params.paymentId,
          razorpayOrderId: params.razorpayOrderId,
          razorpaySignature: params.razorpaySignature,
          confirmedAt: new Date().toISOString(),
        },
        { merge: true },
      )

      return true
    } catch (error) {
      logger.error('booking.confirm_razorpay_order_failed', error)
      throw error
    }
  },

  // Send Payment Link
  async sendPaymentLink(orderNumber: string, templateName?: string) {
    return sendPaymentLink(orderNumber, templateName)
  },

  // Trigger Reschedule Notification
  async triggerRescheduleNotification(
    orderNumber: string,
    oldDate: string,
    newDate: string,
    locationName: string,
    phoneNumber: string,
    customerName: string,
  ): Promise<boolean> {
    try {
      const response = await fetch(
        'https://asia-south1-a-square-6720c.cloudfunctions.net/sendRescheduleNotification',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderNumber,
            oldDate,
            newDate,
            locationName,
            phoneNumber,
            customerName,
          }),
        },
      )
      const data = await response.json()
      if (data.success) {
        return true
      }
      logger.warn('booking.reschedule_notification_failed', { data })
      return false
    } catch (error) {
      logger.error('booking.trigger_reschedule_notification_failed', error)
      return false
    }
  },

  // Trigger Payment Failed Notification
  async triggerPaymentFailedNotification(
    orderNumber: string,
    phoneNumber: string,
    customerName: string,
  ): Promise<boolean> {
    try {
      const response = await fetch(
        'https://asia-south1-a-square-6720c.cloudfunctions.net/sendPaymentFailedNotification',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderNumber, phoneNumber, customerName }),
        },
      )
      const data = await response.json()
      if (data.success) {
        return true
      }
      logger.warn('booking.payment_failed_notification_failed', { data })
      return false
    } catch (error) {
      logger.error('booking.trigger_payment_failed_notification_failed', error)
      return false
    }
  },

  // Log Reschedule Event to Firestore
  async logRescheduleEvent(
    orderNumber: string,
    previousDetails: Record<string, unknown>,
    newDetails: Record<string, unknown>,
    adminUser: { uid?: string; email?: string | null; displayName?: string | null },
  ): Promise<boolean> {
    try {
      const logRef = doc(collection(db, 'reschedule_logs'))
      await setDoc(logRef, {
        orderNumber,
        previousDetails,
        newDetails,
        rescheduledBy: adminUser || { id: 'unknown', name: 'Unknown', role: 'unknown' },
        rescheduledAt: new Date(),
      })
      return true
    } catch (error) {
      logger.error('booking.log_reschedule_event_failed', error)
      return false
    }
  },

  // Get user details from Firestore
  async getUserData(mobile: string): Promise<{ tier: string | null; walletBalance: number }> {
    try {
      // Try to find user by phone in Firestore
      const usersRef = collection(db, 'users')
      const cleanPhone = mobile.replace(/\D/g, '').slice(-10)
      const q = query(usersRef, where('phone', '==', cleanPhone), limit(1))
      const snapshot = await getDocs(q)

      if (!snapshot.empty) {
        const data = snapshot.docs[0].data()
        return {
          tier: data.tier || null,
          walletBalance: data.walletBalance || 0,
        }
      }
      return { tier: null, walletBalance: 0 }
    } catch (error) {
      logger.error('booking.fetch_user_data_failed', error)
      return { tier: null, walletBalance: 0 }
    }
  },

  // Get total booking count from Firestore
  async getBookingCount(mobile: string): Promise<number> {
    try {
      const cleanPhone = mobile.replace(/\D/g, '').slice(-10)
      // Count bookings from Firestore for this user
      const usersRef = collection(db, 'users')
      const q = query(usersRef, where('phone', '==', cleanPhone), limit(1))
      const userSnap = await getDocs(q)

      if (!userSnap.empty) {
        const userId = userSnap.docs[0].id
        const bookingsRef = collection(db, 'users', userId, 'bookings')
        const bookingsSnap = await getDocs(bookingsRef)
        return bookingsSnap.size
      }
      return 0
    } catch (error) {
      logger.error('booking.fetch_count_failed', error)
      return 0
    }
  },

  // Get all bookings for admin with optional location filtering.
  //
  // Previously this loaded `limit(10000)` of *all* bookings on every call and
  // filtered client-side, which scales linearly with the bookings collection
  // and reads tens of thousands of docs per dashboard load. We now:
  //   1. Constrain to the last 90 days by default via `where('createdAt', ...)`
  //   2. Push location filtering down to Firestore as a `where` clause
  //   3. Cap the page at 1000 docs (admins paginate UI-side beyond that)
  // Composite index `bookings(locationId ASC, createdAt DESC)` is required
  // when locationId is provided — see firestore.indexes.json.
  async getAdminBookings(locationId?: string, sinceDays = 90): Promise<Booking[]> {
    try {
      const bookingsRef = collection(db, 'bookings')
      const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)

      const constraints = [
        where('createdAt', '>=', sinceDate),
        ...(locationId ? [where('locationId', '==', locationId)] : []),
        orderBy('createdAt', 'desc'),
        limit(1000),
      ]
      const q = query(bookingsRef, ...constraints)

      const snapshot = await getDocs(q)
      return snapshot.docs.map((doc) => {
        const data = doc.data()
        return {
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
          sessionDate: data.sessionDate?.toDate
            ? data.sessionDate.toDate()
            : new Date(data.sessionDate),
        } as Booking
      })
    } catch (error) {
      logger.error('booking.fetch_admin_failed', error)
      return []
    }
  },

  async getLastBookingLocation(userId: string): Promise<string | null> {
    if (!userId) return null
    try {
      const q = query(
        collection(db, 'users', userId, 'bookings'),
        orderBy('createdAt', 'desc'),
        limit(1),
      )
      const snap = await getDocs(q)
      if (snap.empty) return null
      const data = snap.docs[0].data()
      return (data.locationId as string) || (data.branchId as string) || null
    } catch (err) {
      logger.error('booking.last_location_failed', err)
      return null
    }
  },
}

export const ADMIN_LOCATIONS = getAllLocations().map((l) => ({ id: l.slug, name: l.displayName }))
