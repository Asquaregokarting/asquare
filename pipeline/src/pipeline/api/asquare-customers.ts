/**
 * Firestore API adapter for managing asquare end-users (customers).
 * Reads from the asquare-app-db database via getAsquareFirestore().
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  setDoc,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { getAsquareFirestore, toDate } from './asquare-firestore'

// Pipeline staff roles — used to exclude staff documents from the customer listing.
// Keep in sync with the same set in scripts/backfill-customer-search-and-buckets.ts.
const PIPELINE_ROLES = new Set([
  'Owner',
  'Admin',
  'Telecaller',
  'Cashier',
  'TrackMarshall',
  'Incharge',
  'Editor',
  'Developer',
  'Backend',
  'ThirdParty',
])

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export type SpendBucket = '0' | '1-5k' | '5-25k' | '25k+'
export type BookingBucket = '0' | '1' | '2-5' | '6+'

export interface AsquareCustomer {
  id: string
  displayName: string
  email: string
  phone: string
  tier: string
  isVerified: boolean
  referralCode: string
  referredBy: string
  tires: number
  walletBalance: number
  lastLoginAt: Date
  updatedAt: Date
  createdAt: Date
  /** Aggregated from bookings collection */
  bookingCount: number
  /** Aggregated sum of finalAmount from bookings collection */
  totalSpent: number
  membership?: string
  coupons150Earned: number
  coupons150Redeemed: number
  coupons150Available: number
  starStatus: string
  // Customer 360 derived fields, maintained by Cloud Function triggers.
  // Default to safe zero values when not yet backfilled on a given user.
  displayNameLower: string
  emailLower: string
  spendBucket: SpendBucket
  bookingBucket: BookingBucket
  hasWalletBalance: boolean
  hasTires: boolean
  hasUnredeemedCoupons150: boolean
  branchPreferred: string | null
  lastBookingAt: Date | null
}

export interface AsquareAdminUser {
  uid: string
  name: string
  email: string
  mobile: string
  username: string
  role: 'owner' | 'admin' | 'telecaller' | 'cashier' | 'thirdparty'
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface BookingAggregation {
  count: number
  totalSpent: number
}

/**
 * Extract denormalized booking stats from a user document.
 * The `users/{uid}.stats` subfield is maintained by the
 * `onBookingWriteSyncCustomerStats` Cloud Function trigger (see
 * `functions/triggers/on-booking-write-customer-stats.js`). This replaces
 * the previous full-collection scan of `bookings`, dropping the read cost
 * of `listCustomers()` from O(bookings) to O(users) — and in practice to
 * a single stream since we already iterate users to filter out staff.
 *
 * Returns zeroes if the stats subfield has not yet been populated for a
 * given user (e.g. brand-new accounts or during the rollout window).
 */
const extractBookingStats = (data: Record<string, unknown>): BookingAggregation => {
  const stats = data.stats
  if (!stats || typeof stats !== 'object') {
    return { count: 0, totalSpent: 0 }
  }
  const s = stats as Record<string, unknown>
  const rawCount = typeof s.bookingCount === 'number' ? s.bookingCount : Number(s.bookingCount)
  const rawTotal = typeof s.totalSpent === 'number' ? s.totalSpent : Number(s.totalSpent)
  return {
    count: Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0,
    totalSpent: Number.isFinite(rawTotal) ? Math.max(0, rawTotal) : 0,
  }
}

const COUPON_EARN_THRESHOLD = 600

export const parseCustomer = (
  id: string,
  data: Record<string, unknown>,
  bookingStats: BookingAggregation,
): AsquareCustomer => {
  const memberData =
    data.memberData && typeof data.memberData === 'object'
      ? (data.memberData as Record<string, unknown>)
      : undefined

  const membership = memberData?.membership
    ? String(memberData.membership)
    : data.membership
      ? String(data.membership)
      : undefined

  const memberBillAmount = memberData ? Number(memberData.totalBillAmount ?? 0) : 0
  const couponsEarnedRaw = data.coupons150Earned
  const couponsEarned = Number(
    couponsEarnedRaw ?? Math.floor(memberBillAmount / COUPON_EARN_THRESHOLD),
  )
  const couponsRedeemed = Number(memberData?.coupons150Redeemed ?? data.coupons150Redeemed ?? 0)
  const couponsAvailableRaw = data.coupons150Available
  const couponsAvailable = Number(
    couponsAvailableRaw ?? Math.max(0, couponsEarned - couponsRedeemed),
  )

  const displayName = String(data.displayName ?? '')
  const email = String(data.email ?? '')
  const tires = Number(data.tires ?? 0)
  const walletBalance = Number(data.walletBalance ?? 0)
  const lastBookingRaw = data.lastBookingAt
  const branchPreferredRaw = data.branchPreferred

  return {
    id,
    displayName,
    email,
    phone: String(data.phone ?? ''),
    tier: String(data.tier ?? 'bronze'),
    isVerified: data.isVerified === true,
    referralCode: String(data.referralCode ?? ''),
    referredBy: String(data.referredBy ?? ''),
    tires,
    walletBalance,
    lastLoginAt: toDate(data.lastLoginAt),
    updatedAt: toDate(data.updatedAt),
    createdAt: toDate(data.createdAt),
    bookingCount: bookingStats.count,
    totalSpent: bookingStats.totalSpent,
    membership,
    coupons150Earned: couponsEarned,
    coupons150Redeemed: couponsRedeemed,
    coupons150Available: couponsAvailable,
    starStatus: String(memberData?.starStatus ?? data.starStatus ?? '0'),
    // Customer 360 derived fields. Fall back to safe defaults when the
    // Cloud Function backfill has not yet run for this user.
    displayNameLower:
      typeof data.displayNameLower === 'string' ? data.displayNameLower : displayName.toLowerCase(),
    emailLower: typeof data.emailLower === 'string' ? data.emailLower : email.toLowerCase(),
    spendBucket: (typeof data.spendBucket === 'string' ? data.spendBucket : '0') as SpendBucket,
    bookingBucket: (typeof data.bookingBucket === 'string'
      ? data.bookingBucket
      : '0') as BookingBucket,
    hasWalletBalance:
      data.hasWalletBalance === true || (data.hasWalletBalance === undefined && walletBalance > 0),
    hasTires: data.hasTires === true || (data.hasTires === undefined && tires > 0),
    hasUnredeemedCoupons150:
      data.hasUnredeemedCoupons150 === true ||
      (data.hasUnredeemedCoupons150 === undefined && couponsAvailable > 0),
    branchPreferred: branchPreferredRaw ? String(branchPreferredRaw) : null,
    lastBookingAt: lastBookingRaw ? toDate(lastBookingRaw) : null,
  }
}

const parseAdminUser = (id: string, data: Record<string, unknown>): AsquareAdminUser => ({
  uid: String(data.uid ?? id),
  name: String(data.name ?? ''),
  email: String(data.email ?? ''),
  mobile: String(data.mobile ?? ''),
  username: String(data.username ?? ''),
  role: (['owner', 'admin', 'telecaller', 'cashier', 'thirdparty'].includes(String(data.role ?? ''))
    ? String(data.role)
    : 'admin') as AsquareAdminUser['role'],
})

// ---------------------------------------------------------------------------
// Standalone lookups
// ---------------------------------------------------------------------------

import { normalizePhone } from '../features/leads/lead-utils'

/**
 * Look up a customer by phone number in the users collection.
 * Uses phoneToUid index for O(1) lookup, falls back to query.
 * Excludes pipeline staff users.
 */
export const lookupCustomerByPhone = async (phone: string): Promise<AsquareCustomer | null> => {
  const digits = normalizePhone(phone)
  if (digits.length !== 10) return null

  const firestore = getAsquareFirestore()

  // Fast path: phoneToUid index
  try {
    const phoneDoc = await getDoc(doc(firestore, 'phoneToUid', digits))
    if (phoneDoc.exists()) {
      const uid = String((phoneDoc.data() as Record<string, unknown>).uid ?? '')
      if (uid) {
        const userDoc = await getDoc(doc(firestore, 'users', uid))
        if (userDoc.exists()) {
          const data = userDoc.data() as Record<string, unknown>
          const role = String(data.role ?? '')
          if (!role || !PIPELINE_ROLES.has(role)) {
            return parseCustomer(userDoc.id, data, extractBookingStats(data))
          }
        }
      }
    }
  } catch {
    /* fall through to query */
  }

  // Fallback: query by phone field
  try {
    const q = query(collection(firestore, 'users'), where('phone', '==', digits), firestoreLimit(1))
    const snap = await getDocs(q)
    if (!snap.empty) {
      const userDoc = snap.docs[0]
      const data = userDoc.data() as Record<string, unknown>
      const role = String(data.role ?? '')
      if (!role || !PIPELINE_ROLES.has(role)) {
        return parseCustomer(userDoc.id, data, extractBookingStats(data))
      }
    }
  } catch {
    /* query failed */
  }

  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ListCustomersOptions {
  /** Number of rows to return per page. Defaults to 20. */
  pageSize?: number
  /** Cursor from the previous page's `nextCursor`. Omit for the first page. */
  cursor?: QueryDocumentSnapshot<DocumentData>
  /** Equality filters. Composes with sort and one optional date range. */
  filters?: ListCustomersFilters
  /** Sort axis. Defaults to `createdAt`. */
  sortBy?: ListCustomersSortBy
  /** Sort direction. Defaults to `desc`. */
  sortDir?: 'asc' | 'desc'
  /** Search by phone (instant), name prefix, or email prefix. */
  search?: ListCustomersSearch
}

export interface ListCustomersFilters {
  tier?: string
  membership?: string
  verified?: boolean
  branchPreferred?: string
  spendBucket?: SpendBucket
  bookingBucket?: BookingBucket
  hasWalletBalance?: boolean
  hasTires?: boolean
  hasUnredeemedCoupons150?: boolean
  joinedAfter?: Date
  joinedBefore?: Date
  lastSeenAfter?: Date
  lastSeenBefore?: Date
  lastBookingAfter?: Date
  lastBookingBefore?: Date
}

export type ListCustomersSortBy =
  | 'createdAt'
  | 'lastLoginAt'
  | 'totalSpent'
  | 'bookingCount'
  | 'walletBalance'
  | 'tires'
  | 'lastBookingAt'

export interface ListCustomersSearch {
  kind: 'phone' | 'name' | 'email'
  value: string
}

const SORT_FIELD_MAP: Record<ListCustomersSortBy, string> = {
  createdAt: 'createdAt',
  lastLoginAt: 'lastLoginAt',
  totalSpent: 'stats.totalSpent',
  bookingCount: 'stats.bookingCount',
  walletBalance: 'walletBalance',
  tires: 'tires',
  lastBookingAt: 'lastBookingAt',
}

export interface ListCustomersPage {
  items: AsquareCustomer[]
  /** Pass this to the next `listCustomers` call to fetch the next page. */
  nextCursor: QueryDocumentSnapshot<DocumentData> | null
}

// Each internal Firestore fetch grabs this many docs at a time. The
// staff-filter runs in memory after the fetch, so we may need multiple
// rounds to fill a `pageSize`-sized page when the underlying ordering
// happens to cluster staff accounts. The loop below keeps fetching from
// the last consumed doc until either the page is full or Firestore is
// exhausted, so the user never sees a half-empty page followed by a
// "Next" button that yields zero rows.
const CUSTOMER_INTERNAL_FETCH_SIZE = 50

export const asquareCustomersApi = {
  /**
   * Fetch a single page of customers ordered by `createdAt` desc, cursor-
   * paginated. Booking stats come from the denormalized `stats` subfield
   * maintained by the `onBookingWriteSyncCustomerStats` trigger.
   *
   * Previously this function scanned the entire `users` collection (~50k
   * rows) on every admin page mount, taking 1–2 minutes. Now a typical
   * page is ~20 rows at <100 ms.
   *
   * @see ListCustomersOptions for pagination / filter parameters.
   */
  async listCustomers(opts?: ListCustomersOptions): Promise<ListCustomersPage> {
    const pageSize = Math.max(1, opts?.pageSize ?? 20)
    const firestore = getAsquareFirestore()
    const usersCol = collection(firestore, 'users')

    // Phone search short-circuits via the phoneToUid O(1) index.
    if (opts?.search?.kind === 'phone' && opts.search.value.trim()) {
      const digits = normalizePhone(opts.search.value)
      if (digits.length === 10) {
        const found = await lookupCustomerByPhone(digits)
        return { items: found ? [found] : [], nextCursor: null }
      }
      return { items: [], nextCursor: null }
    }

    const constraints: QueryConstraint[] = []
    const filters = opts?.filters ?? {}

    // Equality filters (each is a single composite-index slot).
    if (filters.tier) constraints.push(where('tier', '==', filters.tier))
    if (filters.membership) constraints.push(where('membership', '==', filters.membership))
    if (filters.verified !== undefined)
      constraints.push(where('isVerified', '==', filters.verified))
    if (filters.branchPreferred)
      constraints.push(where('branchPreferred', '==', filters.branchPreferred))
    if (filters.spendBucket) constraints.push(where('spendBucket', '==', filters.spendBucket))
    if (filters.bookingBucket) constraints.push(where('bookingBucket', '==', filters.bookingBucket))
    if (filters.hasWalletBalance !== undefined)
      constraints.push(where('hasWalletBalance', '==', filters.hasWalletBalance))
    if (filters.hasTires !== undefined) constraints.push(where('hasTires', '==', filters.hasTires))
    if (filters.hasUnredeemedCoupons150 !== undefined)
      constraints.push(where('hasUnredeemedCoupons150', '==', filters.hasUnredeemedCoupons150))

    // Name / email prefix search forces orderBy on the search field
    // (Firestore requires it for inequality filters), overriding sort.
    let sortField: string
    let sortDir: 'asc' | 'desc' = opts?.sortDir ?? 'desc'

    if (opts?.search?.kind === 'name' && opts.search.value.trim()) {
      const term = opts.search.value.trim().toLowerCase()
      constraints.push(where('displayNameLower', '>=', term))
      constraints.push(where('displayNameLower', '<=', term + '\uf8ff'))
      sortField = 'displayNameLower'
      sortDir = 'asc'
    } else if (opts?.search?.kind === 'email' && opts.search.value.trim()) {
      const term = opts.search.value.trim().toLowerCase()
      constraints.push(where('emailLower', '>=', term))
      constraints.push(where('emailLower', '<=', term + '\uf8ff'))
      sortField = 'emailLower'
      sortDir = 'asc'
    } else {
      // Date ranges. Firestore allows only ONE range filter per query, so
      // we pick the first defined range in priority order: joined, last
      // seen, last booking. Any others are ignored at the server layer
      // (the UI greys out competing inputs to keep this transparent).
      let rangePicked: 'joined' | 'lastSeen' | 'lastBooking' | null = null
      if (filters.joinedAfter || filters.joinedBefore) {
        if (filters.joinedAfter) constraints.push(where('createdAt', '>=', filters.joinedAfter))
        if (filters.joinedBefore) constraints.push(where('createdAt', '<=', filters.joinedBefore))
        rangePicked = 'joined'
      } else if (filters.lastSeenAfter || filters.lastSeenBefore) {
        if (filters.lastSeenAfter)
          constraints.push(where('lastLoginAt', '>=', filters.lastSeenAfter))
        if (filters.lastSeenBefore)
          constraints.push(where('lastLoginAt', '<=', filters.lastSeenBefore))
        rangePicked = 'lastSeen'
      } else if (filters.lastBookingAfter || filters.lastBookingBefore) {
        if (filters.lastBookingAfter)
          constraints.push(where('lastBookingAt', '>=', filters.lastBookingAfter))
        if (filters.lastBookingBefore)
          constraints.push(where('lastBookingAt', '<=', filters.lastBookingBefore))
        rangePicked = 'lastBooking'
      }

      const requestedSort: ListCustomersSortBy = opts?.sortBy ?? 'createdAt'
      // When a range is active, Firestore requires the orderBy primary
      // field to match the range field. Honor that by overriding sort.
      if (rangePicked === 'joined') sortField = 'createdAt'
      else if (rangePicked === 'lastSeen') sortField = 'lastLoginAt'
      else if (rangePicked === 'lastBooking') sortField = 'lastBookingAt'
      else sortField = SORT_FIELD_MAP[requestedSort]
    }

    constraints.push(orderBy(sortField, sortDir))
    // NOTE: startAfter is NOT pushed here. It's appended per-round below
    // so the internal fetch loop can advance the cursor between rounds.

    const items: AsquareCustomer[] = []
    let lastConsumedDoc: QueryDocumentSnapshot<DocumentData> | null = null
    let internalCursor: QueryDocumentSnapshot<DocumentData> | undefined = opts?.cursor
    let exhausted = false

    // Internal fetch loop: keep pulling fixed-size batches from Firestore,
    // dropping staff in memory, until we've filled `pageSize` items or the
    // underlying collection is exhausted. A safety cap of 10 rounds
    // prevents pathological data (e.g. a million contiguous staff docs)
    // from spinning forever; in practice the loop exits after 1 round for
    // normal user populations.
    let rounds = 0
    while (items.length < pageSize && !exhausted && rounds < 10) {
      const roundConstraints: QueryConstraint[] = [...constraints]
      if (internalCursor) roundConstraints.push(startAfter(internalCursor))
      roundConstraints.push(firestoreLimit(CUSTOMER_INTERNAL_FETCH_SIZE))

      const snap = await getDocs(query(usersCol, ...roundConstraints))
      if (snap.empty) {
        exhausted = true
        break
      }

      for (const record of snap.docs) {
        if (items.length >= pageSize) break
        lastConsumedDoc = record
        const data = record.data() as Record<string, unknown>
        const role = String(data.role ?? '')
        if (role && PIPELINE_ROLES.has(role)) continue
        items.push(parseCustomer(record.id, data, extractBookingStats(data)))
      }

      // If Firestore returned fewer than the batch size, there is nothing
      // more after this batch — we've reached the tail.
      if (snap.size < CUSTOMER_INTERNAL_FETCH_SIZE) {
        exhausted = true
      } else {
        internalCursor = snap.docs[snap.docs.length - 1]
      }
      rounds += 1
    }

    return { items, nextCursor: exhausted ? null : lastConsumedDoc }
  },

  /**
   * Fetch a single customer by Firestore document id (= Firebase Auth uid).
   * Returns null if the document does not exist or belongs to pipeline staff.
   */
  async getCustomer(userId: string): Promise<AsquareCustomer | null> {
    const firestore = getAsquareFirestore()
    const userRef = doc(firestore, 'users', userId)
    const snap = await getDoc(userRef)
    if (!snap.exists()) return null
    const data = snap.data() as Record<string, unknown>
    const role = String(data.role ?? '')
    if (role && PIPELINE_ROLES.has(role)) return null
    return parseCustomer(snap.id, data, extractBookingStats(data))
  },

  /**
   * Update user profile fields.
   *
   * `walletBalance` and `tires` are intentionally NOT acceptable here — those
   * are real-money fields that must always go through walletService /
   * billing-firestore (atomic transactions + freeze-flag checks + audit-log
   * writes). A bare `setDoc(..., { merge: true })` on those fields would
   * silently overwrite a live balance with a stale form value the moment a
   * concurrent booking debits the wallet. If callers need to adjust balances
   * they must use `creditCustomerWallet` / `deductCustomerWallet`.
   */
  async updateCustomer(
    userId: string,
    data: Partial<Pick<AsquareCustomer, 'displayName' | 'email' | 'phone' | 'tier' | 'isVerified'>>,
  ): Promise<void> {
    const firestore = getAsquareFirestore()
    const userRef = doc(firestore, 'users', userId)
    // Maintain the lowercase prefix-search indexes synchronously on admin
    // edits so the Customers list reflects rename/email-change immediately,
    // ahead of the Cloud Function trigger.
    const payload: Record<string, unknown> = { ...data, updatedAt: new Date() }
    if (data.displayName !== undefined) payload.displayNameLower = data.displayName.toLowerCase()
    if (data.email !== undefined) payload.emailLower = data.email.toLowerCase()
    await setDoc(userRef, payload, { merge: true })
  },

  /**
   * Delete a user document.
   */
  async deleteCustomer(userId: string): Promise<void> {
    const firestore = getAsquareFirestore()
    await deleteDoc(doc(firestore, 'users', userId))
  },

  /**
   * Get all admin users.
   */
  async listAdminUsers(): Promise<AsquareAdminUser[]> {
    const firestore = getAsquareFirestore()
    const snapshot = await getDocs(collection(firestore, 'adminUsers'))

    return snapshot.docs.map((record) => {
      const data = record.data() as Record<string, unknown>
      return parseAdminUser(record.id, data)
    })
  },

  /**
   * Update admin user fields.
   */
  async updateAdminUser(
    uid: string,
    data: Partial<Pick<AsquareAdminUser, 'name' | 'email' | 'mobile' | 'username' | 'role'>>,
  ): Promise<void> {
    const firestore = getAsquareFirestore()
    const adminRef = doc(firestore, 'adminUsers', uid)
    await setDoc(adminRef, data, { merge: true })
  },

  /**
   * Delete an admin user document.
   */
  async deleteAdminUser(uid: string): Promise<void> {
    const firestore = getAsquareFirestore()
    await deleteDoc(doc(firestore, 'adminUsers', uid))
  },
}
