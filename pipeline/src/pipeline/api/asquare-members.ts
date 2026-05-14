/**
 * Firestore API for looking up members from the asquare-app-db.
 * Used by POS billing to show member details and calculate available 150 coupons.
 *
 * Post-migration: reads from users collection (memberData field) via phoneToUid index,
 * with fallback to legacy members collection.
 *
 * Coupon logic:
 *   earned  = floor(totalBillAmount / 600)
 *   used    = coupons150Redeemed (field on member doc, default 0)
 *   available = earned - used
 *
 * 150 coupons are redeemable only for go-karting activities.
 */
import {
  addDoc,
  collection,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  QueryConstraint,
  QueryDocumentSnapshot,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  increment,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemberCouponCode {
  id: string
  code: string
  type: string
  discount: number
  description: string
  isUsed: boolean
  expiryDate: string | null
  source: string
}

export interface MemberRecord {
  id: string
  name: string
  mobile: string
  email: string
  membership: string
  totalVisits: number
  totalBillAmount: number
  walletBalance: number
  starStatus: string
  coupons150Redeemed: number
  /** Computed: floor(totalBillAmount / 600) */
  coupons150Earned: number
  /** Computed: earned - redeemed */
  coupons150Available: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COUPON_EARN_THRESHOLD = 600

const computeCoupons = (totalBillAmount: number, redeemed: number) => {
  const earned = Math.floor(totalBillAmount / COUPON_EARN_THRESHOLD)
  return { earned, available: Math.max(0, earned - redeemed) }
}

import { normalizePhone } from '../features/leads/lead-utils'

/** Parse a legacy members collection document into MemberRecord. */
const parseMember = (id: string, data: Record<string, unknown>): MemberRecord => {
  const totalBillAmount = Number(data.totalBillAmount ?? 0)
  const redeemed = Number(data.coupons150Redeemed ?? 0)
  const { earned, available } = computeCoupons(totalBillAmount, redeemed)

  return {
    id,
    name: String(data.name ?? ''),
    mobile: String(data.mobile ?? ''),
    email: String(data.email ?? ''),
    membership: String(data.membership ?? 'Silver'),
    totalVisits: Number(data.totalVisits ?? 0),
    totalBillAmount,
    walletBalance: Number(data.walletBalance ?? 0),
    starStatus: String(data.starStatus ?? '0'),
    coupons150Redeemed: redeemed,
    coupons150Earned: earned,
    coupons150Available: available,
  }
}

/**
 * Parse a users collection document (with memberData) into MemberRecord.
 *
 * Wallet balance comes from the root `walletBalance` field — that's the
 * authoritative mirror of `users/{id}/wallet/data.balance` maintained by
 * walletService.addBalance/deductBalance and creditCustomerWallet. Older
 * code paths populated `memberData.memberWalletBalance` as a third source
 * of truth; we ignore it here so the Members tab never disagrees with the
 * Customers tab or the customer app.
 */
const parseMemberFromUser = (id: string, data: Record<string, unknown>): MemberRecord | null => {
  const md = data.memberData as Record<string, unknown> | undefined
  if (!md) return null

  const totalBillAmount = Number(md.totalBillAmount ?? 0)
  const redeemed = Number(md.coupons150Redeemed ?? 0)
  const { earned, available } = computeCoupons(totalBillAmount, redeemed)

  return {
    id,
    name: String(data.displayName ?? data.name ?? md.mobile ?? ''),
    mobile: String(md.mobile ?? data.phone ?? ''),
    email: String(data.email ?? md.email ?? ''),
    membership: String(md.membership ?? 'Silver'),
    totalVisits: Number(md.totalVisits ?? 0),
    totalBillAmount,
    walletBalance: Number(data.walletBalance ?? 0),
    starStatus: String(md.starStatus ?? '0'),
    coupons150Redeemed: redeemed,
    coupons150Earned: earned,
    coupons150Available: available,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List members, ordered by totalBillAmount desc.
 * Reads from users collection (memberData), with fallback to legacy members collection.
 * Caps at `max` documents to avoid overloading the browser.
 */
const FIRESTORE_PAGE_SIZE = 10000

/** Which backing collection a paginated page came from. */
export type MemberPageSource = 'users' | 'members'

export interface ListMembersPageOptions {
  /** Rows per page. Defaults to 20. */
  pageSize?: number
  /** Cursor from the previous page's `nextCursor`. Omit for first page. */
  cursor?: QueryDocumentSnapshot<DocumentData>
  /**
   * Lock the query to a specific backing collection. When omitted on the
   * first call, this helper probes `members` (legacy) first for a cleaner
   * orderBy, then falls back to `users.memberData`. Callers should pass
   * the returned `source` back on subsequent page requests so pagination
   * cursors remain consistent.
   */
  source?: MemberPageSource
}

export interface ListMembersPageResult {
  items: MemberRecord[]
  nextCursor: QueryDocumentSnapshot<DocumentData> | null
  source: MemberPageSource
}

/**
 * Fetch a single page of members, cursor-paginated.
 *
 * Previously `listMembers` loop-downloaded every row in 10k chunks so the
 * admin members tab could render — ~50k rows = 1–2 minutes. This replaces
 * it with a bounded 20-row query.
 *
 * Source selection strategy:
 *   1. If `opts.source` is set, use that (so pagination stays consistent).
 *   2. Otherwise probe the legacy `members` collection first with a 1-row
 *      query — it has a clean top-level `totalBillAmount` field with a
 *      trivial single-field index, so cursor pagination is simple.
 *   3. If `members` is empty, paginate `users` where `memberData != null`.
 *      Ordering is by `memberData` (required by the `!=` filter) with
 *      document id as implicit tiebreaker — not business-meaningful, but
 *      stable for cursors.
 */
export const listMembersPage = async (
  opts?: ListMembersPageOptions,
): Promise<ListMembersPageResult> => {
  const pageSize = Math.max(1, opts?.pageSize ?? 20)
  const firestore = getAsquareFirestore()

  const source: MemberPageSource = opts?.source ?? (await detectMemberSource(firestore))

  if (source === 'members') {
    const membersCol = collection(firestore, 'members')
    const constraints: QueryConstraint[] = [
      orderBy('totalBillAmount', 'desc'),
      firestoreLimit(pageSize),
    ]
    if (opts?.cursor) constraints.push(startAfter(opts.cursor))

    const snap = await getDocs(query(membersCol, ...constraints))
    const items = snap.docs.map((d) => parseMember(d.id, d.data() as Record<string, unknown>))
    const hasMore = snap.size === pageSize

    return {
      items,
      nextCursor: hasMore && snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
      source: 'members',
    }
  }

  // users.memberData path
  const usersCol = collection(firestore, 'users')
  const constraints: QueryConstraint[] = [
    where('memberData', '!=', null),
    // `!=` filters require an orderBy on the same field; Firestore uses
    // __name__ as the implicit secondary sort, which is stable for cursor
    // pagination even though `memberData` itself is an object.
    orderBy('memberData'),
    firestoreLimit(pageSize),
  ]
  if (opts?.cursor) constraints.push(startAfter(opts.cursor))

  const snap = await getDocs(query(usersCol, ...constraints))
  const items: MemberRecord[] = []
  for (const d of snap.docs) {
    const m = parseMemberFromUser(d.id, d.data() as Record<string, unknown>)
    if (m) items.push(m)
  }
  const hasMore = snap.size === pageSize

  return {
    items,
    nextCursor: hasMore && snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
    source: 'users',
  }
}

/**
 * Probe which backing collection currently holds member data. Runs once
 * on the very first page request and is cached per-process so subsequent
 * pages don't incur the extra round-trip.
 */
let cachedMemberSource: MemberPageSource | null = null
const detectMemberSource = async (
  firestore: ReturnType<typeof getAsquareFirestore>,
): Promise<MemberPageSource> => {
  if (cachedMemberSource) return cachedMemberSource

  try {
    const probe = await getDocs(query(collection(firestore, 'members'), firestoreLimit(1)))
    if (!probe.empty) {
      cachedMemberSource = 'members'
      return 'members'
    }
  } catch {
    // fall through
  }
  cachedMemberSource = 'users'
  return 'users'
}

/**
 * Legacy full-scan helper retained for any callers that still need every
 * member row (e.g. exports). The admin UI has migrated to `listMembersPage`
 * for interactive browsing — prefer that for any new code paths.
 */
export const listMembers = async (): Promise<MemberRecord[]> => {
  const firestore = getAsquareFirestore()

  // Try users collection first (post-migration)
  try {
    const allMembers: MemberRecord[] = []
    let lastDoc: QueryDocumentSnapshot | undefined

    while (true) {
      const constraints: QueryConstraint[] = [
        where('memberData', '!=', null),
        firestoreLimit(FIRESTORE_PAGE_SIZE),
      ]
      if (lastDoc) constraints.push(startAfter(lastDoc))

      const snap = await getDocs(query(collection(firestore, 'users'), ...constraints))
      for (const d of snap.docs) {
        const m = parseMemberFromUser(d.id, d.data() as Record<string, unknown>)
        if (m) allMembers.push(m)
      }

      if (snap.size < FIRESTORE_PAGE_SIZE) break
      lastDoc = snap.docs[snap.docs.length - 1]
    }

    if (allMembers.length > 0) {
      return allMembers.sort((a, b) => b.totalBillAmount - a.totalBillAmount)
    }
  } catch {
    // Index may not exist yet — fall through to legacy
  }

  // Fallback: legacy members collection (paginated)
  const allMembers: MemberRecord[] = []
  let lastDoc: QueryDocumentSnapshot | undefined

  while (true) {
    const constraints: QueryConstraint[] = [
      orderBy('totalBillAmount', 'desc'),
      firestoreLimit(FIRESTORE_PAGE_SIZE),
    ]
    if (lastDoc) constraints.push(startAfter(lastDoc))

    const snap = await getDocs(query(collection(firestore, 'members'), ...constraints))
    for (const d of snap.docs) {
      allMembers.push(parseMember(d.id, d.data() as Record<string, unknown>))
    }

    if (snap.size < FIRESTORE_PAGE_SIZE) break
    lastDoc = snap.docs[snap.docs.length - 1]
  }

  return allMembers
}

/**
 * Look up a member by phone number.
 * Tries phoneToUid index first, then falls back to legacy members collection.
 */
export const lookupMemberByPhone = async (phone: string): Promise<MemberRecord | null> => {
  const digits = normalizePhone(phone)
  if (digits.length !== 10) return null

  const firestore = getAsquareFirestore()

  // Step 1: Try phoneToUid index → users collection
  try {
    const phoneDoc = await getDoc(doc(firestore, 'phoneToUid', digits))
    if (phoneDoc.exists()) {
      const uid = String((phoneDoc.data() as Record<string, unknown>).uid ?? '')
      if (uid) {
        const userDoc = await getDoc(doc(firestore, 'users', uid))
        if (userDoc.exists()) {
          const member = parseMemberFromUser(userDoc.id, userDoc.data() as Record<string, unknown>)
          if (member) return member
        }
      }
    }
  } catch {
    // phoneToUid may not exist yet — fall through
  }

  // Step 2: Fallback to legacy members collection
  const membersCol = collection(firestore, 'members')

  // Try common document ID patterns
  const candidateIds = [digits, `+91${digits}`, `91${digits}`]

  for (const candidateId of candidateIds) {
    const snap = await getDoc(doc(membersCol, candidateId))
    if (snap.exists()) {
      return parseMember(snap.id, snap.data() as Record<string, unknown>)
    }
  }

  // Fallback: query by mobile field (handles varied formatting)
  const q = query(
    membersCol,
    where('mobile', 'in', [digits, `+91${digits}`, `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`]),
  )
  const snapshot = await getDocs(q)
  if (!snapshot.empty) {
    const first = snapshot.docs[0]
    return parseMember(first.id, first.data() as Record<string, unknown>)
  }

  return null
}

/**
 * Ensure a member record exists for the given phone number.
 * If no member is found, creates a new one in the legacy members collection.
 * Updates totalBillAmount and totalVisits, then returns the (possibly new) member.
 */
export const ensureMember = async (
  phone: string,
  customerName?: string,
  billAmount?: number,
): Promise<MemberRecord | null> => {
  const digits = normalizePhone(phone)
  if (digits.length !== 10) return null

  const firestore = getAsquareFirestore()
  let member = await lookupMemberByPhone(digits)

  if (!member) {
    // Auto-create member in legacy members collection
    const memberRef = doc(firestore, 'members', digits)
    const newData: Record<string, unknown> = {
      name: customerName ?? '',
      mobile: digits,
      email: '',
      membership: 'Silver',
      totalVisits: 1,
      totalBillAmount: billAmount ?? 0,
      walletBalance: 0,
      starStatus: '0',
      coupons150Redeemed: 0,
      createdAt: new Date().toISOString(),
    }
    await setDoc(memberRef, newData)
    member = parseMember(digits, newData)
  } else {
    // Update existing member: increment visit + add bill amount
    const updatedVisits = member.totalVisits + 1
    const updatedBillAmount = member.totalBillAmount + (billAmount ?? 0)

    // Update legacy members collection
    const memberRef = doc(firestore, 'members', member.id)
    await setDoc(
      memberRef,
      {
        totalVisits: updatedVisits,
        totalBillAmount: updatedBillAmount,
      },
      { merge: true },
    )

    // Also update users collection if exists
    try {
      const phoneDoc = await getDoc(doc(firestore, 'phoneToUid', digits))
      if (phoneDoc.exists()) {
        const uid = String((phoneDoc.data() as Record<string, unknown>).uid ?? '')
        if (uid) {
          await setDoc(
            doc(firestore, 'users', uid),
            {
              memberData: { totalVisits: updatedVisits, totalBillAmount: updatedBillAmount },
            },
            { merge: true },
          )
        }
      }
    } catch {
      // phoneToUid may not exist — legacy-only update is fine
    }

    // Recompute coupons with updated amount
    const { earned, available } = computeCoupons(updatedBillAmount, member.coupons150Redeemed)
    member = {
      ...member,
      totalVisits: updatedVisits,
      totalBillAmount: updatedBillAmount,
      coupons150Earned: earned,
      coupons150Available: available,
    }
  }

  return member
}

/**
 * Redeem 150 coupons for a member. Increments the coupons150Redeemed counter.
 * Updates users collection (memberData) if available, plus legacy members collection.
 */
export const redeemMemberCoupons = async (memberId: string, count: number): Promise<void> => {
  const firestore = getAsquareFirestore()

  // Try updating via phoneToUid → users collection
  const digits = normalizePhone(memberId)
  if (digits.length === 10) {
    try {
      const phoneDoc = await getDoc(doc(firestore, 'phoneToUid', digits))
      if (phoneDoc.exists()) {
        const uid = String((phoneDoc.data() as Record<string, unknown>).uid ?? '')
        if (uid) {
          const userRef = doc(firestore, 'users', uid)
          const userSnap = await getDoc(userRef)
          if (userSnap.exists()) {
            // Use atomic increment to prevent race conditions on concurrent redemptions
            await setDoc(
              userRef,
              {
                memberData: { coupons150Redeemed: increment(count) },
              },
              { merge: true },
            )
          }
        }
      }
    } catch {
      // fall through to legacy
    }
  }

  // Also update legacy members collection with atomic increment
  const memberRef = doc(firestore, 'members', memberId)
  const snap = await getDoc(memberRef)
  if (!snap.exists()) return

  await setDoc(memberRef, { coupons150Redeemed: increment(count) }, { merge: true })
}

/** Resolve a phone number to a Firebase uid via the phoneToUid index. Returns null if not found. */
const resolvePhoneToUid = async (phone: string): Promise<string | null> => {
  const digits = normalizePhone(phone)
  if (digits.length !== 10) return null

  const firestore = getAsquareFirestore()
  try {
    const phoneDoc = await getDoc(doc(firestore, 'phoneToUid', digits))
    if (phoneDoc.exists()) {
      return String((phoneDoc.data() as Record<string, unknown>).uid ?? '') || null
    }
  } catch {
    // phoneToUid may not exist
  }
  return null
}

/**
 * Fetch all coupon codes from a user's `users/{uid}/coupons` subcollection.
 * Resolves the uid via phoneToUid index from the phone number.
 */
export const fetchMemberCouponCodes = async (phone: string): Promise<MemberCouponCode[]> => {
  const uid = await resolvePhoneToUid(phone)
  if (!uid) return []

  const firestore = getAsquareFirestore()
  const couponsCol = collection(firestore, 'users', uid, 'coupons')

  // Only fetch unused coupons — skip thousands of used member_150 docs
  const q = query(couponsCol, where('isUsed', '==', false), firestoreLimit(50))
  const snap = await getDocs(q)

  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>
    return {
      id: d.id,
      code: String(data.code ?? '').toUpperCase(),
      type: String(data.type ?? 'discount'),
      discount: Number(data.discount ?? data.value ?? 0),
      description: String(data.description ?? ''),
      isUsed: false,
      expiryDate: data.expiryDate ? String(data.expiryDate).slice(0, 10) : null,
      source: String(data.source ?? 'unknown'),
    }
  })
}

/**
 * Max number of ₹150 coupon code documents to keep active at a time.
 * The counter remains source of truth — we only materialise a small batch
 * of codes so users can see/copy them without creating thousands of docs.
 */
const MAX_150_CODES_BATCH = 10

/**
 * Ensure ₹150 coupon code documents exist for a member's available coupons.
 *
 * Only generates up to MAX_150_CODES_BATCH unused codes at a time.
 * When codes are used, new ones can be generated on the next lookup.
 * The counter-based system (coupons150Earned/Redeemed) remains source of truth.
 */
export const ensureMember150CouponCodes = async (phone: string): Promise<MemberCouponCode[]> => {
  const digits = normalizePhone(phone)
  if (digits.length !== 10) return []

  // Resolve uid first — if no uid, fall back to basic fetch
  const uid = await resolvePhoneToUid(digits)
  if (!uid) return []

  // Look up member to get available count
  const member = await lookupMemberByPhone(digits)

  const firestore = getAsquareFirestore()
  const couponsCol = collection(firestore, 'users', uid, 'coupons')

  // Only fetch unused member_150 codes (not ALL coupon docs)
  const unused150Query = query(
    couponsCol,
    where('source', '==', 'member_150'),
    where('isUsed', '==', false),
    firestoreLimit(MAX_150_CODES_BATCH),
  )

  // Also fetch non-member_150 coupons (reward coupons etc) — these are typically few
  const otherCouponsQuery = query(
    couponsCol,
    where('source', '!=', 'member_150'),
    firestoreLimit(50),
  )

  const [unused150Snap, otherSnap] = await Promise.all([
    getDocs(unused150Query),
    getDocs(otherCouponsQuery),
  ])

  const parseCouponDoc = (d: {
    id: string
    data: () => Record<string, unknown>
  }): MemberCouponCode => {
    const data = d.data()
    return {
      id: d.id,
      code: String(data.code ?? '').toUpperCase(),
      type: String(data.type ?? 'discount'),
      discount: Number(data.discount ?? data.value ?? 0),
      description: String(data.description ?? ''),
      isUsed: data.isUsed === true,
      expiryDate: data.expiryDate ? String(data.expiryDate).slice(0, 10) : null,
      source: String(data.source ?? 'unknown'),
    }
  }

  const allCoupons: MemberCouponCode[] = [
    ...unused150Snap.docs.map(parseCouponDoc),
    ...otherSnap.docs.map(parseCouponDoc),
  ]

  // Generate new codes if we have fewer unused codes than the batch limit
  const unused150Count = unused150Snap.size
  const available = member?.coupons150Available ?? 0
  const targetUnused = Math.min(available, MAX_150_CODES_BATCH)
  const toGenerate = Math.max(0, targetUnused - unused150Count)

  if (toGenerate > 0) {
    const writes = []
    for (let i = 0; i < toGenerate; i++) {
      const random = Math.floor(1000 + Math.random() * 9000)
      const code = `ASQ150-${random}`
      writes.push(
        addDoc(couponsCol, {
          code,
          userId: uid,
          type: 'discount',
          value: 150,
          discount: 150,
          description: '₹150 Member Reward Coupon',
          minAmount: 0,
          isUsed: false,
          isPercentage: false,
          createdAt: serverTimestamp(),
          expiryDate: null,
          source: 'member_150',
        }).then((docRef) => {
          allCoupons.push({
            id: docRef.id,
            code,
            type: 'discount',
            discount: 150,
            description: '₹150 Member Reward Coupon',
            isUsed: false,
            expiryDate: null,
            source: 'member_150',
          })
        }),
      )
    }
    await Promise.all(writes)
  }

  return allCoupons
}
