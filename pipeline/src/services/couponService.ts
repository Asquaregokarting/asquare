import { db } from '../lib/firebase'
import {
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  collectionGroup,
  documentId,
  updateDoc,
  increment,
} from 'firebase/firestore'
import { logger } from '../lib/logger'

export interface Coupon {
  code: string
  minAmount: number
  discount: number
  description: string
  isNewUserOnly?: boolean
  isPercentage?: boolean
  startDate?: string
  expiryDate?: string
  validDates?: string[]
  excludeCategories?: string[]
  isActive?: boolean
  userId?: string
  isUsed?: boolean
  type?: 'discount' | 'addon' | 'session' | 'cashback'
  category?: 'individual' | 'event'
  isForHelicopterOnly?: boolean
  applyPerTicket?: boolean
  minTickets?: number
  maxUsageCount?: number
  usedCount?: number
  applicableGames?: Array<{ locationId: string; gameId: string; subGameId?: string }>
}

export interface UserCouponRow {
  id: string
  userId: string
  userPhone?: string
  code: string
  type: string
  value: number
  discount: number
  description: string
  isUsed: boolean
  expiryDate: string | null
  createdAt: Date | null
  source?: string
}

// ─── Settings helpers ───────────────────────────────────────────────
const SETTINGS_DOC = doc(db, 'settings', 'coupons')

export async function getUserCouponsEnabled(): Promise<boolean> {
  try {
    const snap = await getDoc(SETTINGS_DOC)
    if (snap.exists()) {
      return snap.data().userCouponsEnabled !== false
    }
    return true // default: enabled
  } catch (err) {
    logger.error('coupon.read_settings_failed', err)
    return true
  }
}

export async function setUserCouponsEnabled(enabled: boolean): Promise<void> {
  await setDoc(SETTINGS_DOC, { userCouponsEnabled: enabled }, { merge: true })
}

// ─── Admin: fetch ALL user coupons across all users ─────────────────
// ─── Admin: Fetch recent user coupons (Optimized) ───────────────────
export async function getRecentUserCoupons(limitCount = 50): Promise<UserCouponRow[]> {
  try {
    const q = query(
      collectionGroup(db, 'coupons'),
      where('userId', '!=', null),
      orderBy('createdAt', 'desc'),
      limit(limitCount),
    )
    const snap = await getDocs(q)
    return await mapCouponsToRows(snap.docs)
  } catch (err) {
    logger.error('coupon.fetch_recent_user_failed', err)
    return []
  }
}

// ─── Admin: Search user coupons ─────────────────────────────────────
export async function searchUserCoupons(term: string): Promise<UserCouponRow[]> {
  const searchTerm = term.trim().toUpperCase()
  if (!searchTerm) return []

  try {
    let results: UserCouponRow[] = []

    // Strategy 1: Search by Coupon Code
    if (searchTerm.length > 3) {
      const codeQuery = query(
        collectionGroup(db, 'coupons'),
        where('code', '>=', searchTerm),
        where('code', '<=', searchTerm + '\uf8ff'),
        limit(20),
      )
      const codeSnap = await getDocs(codeQuery)
      const codeResults = await mapCouponsToRows(codeSnap.docs)
      results = [...results, ...codeResults]
    }

    // Strategy 2: Search by User Phone
    if (results.length < 20) {
      const usersRef = collection(db, 'users')
      // Try searching by phone (assuming 'phone' field exists and is indexed or small enough)
      // Note: If 'phone' is not consistent, this might miss some.
      const userQ = query(
        usersRef,
        where('phone', '>=', searchTerm),
        where('phone', '<=', searchTerm + '\uf8ff'),
        limit(5),
      )
      const userSnap = await getDocs(userQ)

      const userIds = userSnap.docs.map((d) => d.id)
      if (userIds.length > 0) {
        // Fetch each matched user's coupons subcollection in parallel.
        // The previous serial loop caused one Firestore round-trip per
        // matched user (~77 ms each) on the customer-facing search path;
        // a 5-user match added ~385 ms for no reason.
        const userDataById = new Map(userSnap.docs.map((u) => [u.id, u.data()]))
        const couponSnaps = await Promise.all(
          userIds.map((uid) => getDocs(collection(db, 'users', uid, 'coupons'))),
        )
        const mappedByUser = await Promise.all(
          couponSnaps.map((snap, i) => mapCouponsToRows(snap.docs, userDataById.get(userIds[i]))),
        )
        for (const rows of mappedByUser) {
          results = [...results, ...rows]
        }
      }
    }

    // Deduplicate and ensure only user coupons (userId exists) are returned
    const unique = new Map<string, UserCouponRow>()
    results.forEach((r) => {
      if (r.userId) unique.set(r.id, r)
    })
    return Array.from(unique.values())
  } catch (err) {
    logger.error('coupon.search_user_failed', err)
    return []
  }
}

type CouponDocLike = { id: string; data(): Record<string, unknown> }
type UserDocData = Record<string, unknown>

/**
 * Batch a list of user IDs into Firestore `where(documentId(), 'in', ...)`
 * queries. Firestore caps `in` at 30 values per query, so we chunk and run
 * the chunks in parallel. This replaces the previous N+1 pattern of one
 * `getDoc` per user id and is the dominant cost reduction in
 * `mapCouponsToRows` when search results land on many distinct users.
 *
 * Returns a Map keyed by user document id.
 */
async function fetchUsersByIdBatched(uids: string[]): Promise<Map<string, UserDocData>> {
  const userMap = new Map<string, UserDocData>()
  if (uids.length === 0) return userMap

  // Firestore `in` operator supports up to 30 values as of late 2023.
  const CHUNK_SIZE = 30
  const chunks: string[][] = []
  for (let i = 0; i < uids.length; i += CHUNK_SIZE) {
    chunks.push(uids.slice(i, i + CHUNK_SIZE))
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const usersRef = collection(db, 'users')
        const q = query(usersRef, where(documentId(), 'in', chunk))
        const snap = await getDocs(q)
        snap.docs.forEach((d) => userMap.set(d.id, d.data()))
      } catch (e) {
        logger.warn('coupon.batch_fetch_users_failed', {
          chunkSize: chunk.length,
          error: e,
        })
      }
    }),
  )

  return userMap
}

async function mapCouponsToRows(
  docs: CouponDocLike[],
  preloadedUserData?: UserDocData,
): Promise<UserCouponRow[]> {
  if (docs.length === 0) return []

  const userIdsToFetch = new Set<string>()
  docs.forEach((d) => {
    const data = d.data()
    if (data.userId && !preloadedUserData) userIdsToFetch.add(String(data.userId))
  })

  // One batched `documentId() in [...]` query per chunk of 30, instead of
  // the previous one-getDoc-per-user fanout.
  const userMap = preloadedUserData
    ? new Map<string, UserDocData>()
    : await fetchUsersByIdBatched(Array.from(userIdsToFetch))

  return docs.map((couponDoc) => {
    const d = couponDoc.data()
    const userId = String(d.userId ?? '')
    const userData = preloadedUserData || userMap.get(userId) || {}
    const userPhone = String(userData.phone ?? userData.phoneNumber ?? userId ?? 'Unknown')

    let createdAt: Date | null = null
    const rawCreatedAt = d.createdAt
    if (
      rawCreatedAt &&
      typeof rawCreatedAt === 'object' &&
      'toDate' in rawCreatedAt &&
      typeof (rawCreatedAt as { toDate: unknown }).toDate === 'function'
    ) {
      createdAt = (rawCreatedAt as { toDate: () => Date }).toDate()
    } else if (typeof rawCreatedAt === 'string' || typeof rawCreatedAt === 'number') {
      createdAt = new Date(rawCreatedAt)
    }

    return {
      id: couponDoc.id,
      userId,
      userPhone,
      code: String(d.code ?? '').toUpperCase(),
      type: String(d.type ?? 'discount'),
      value: Number(d.value) || Number(d.discount) || 0,
      discount: Number(d.discount) || 0,
      description: String(d.description ?? ''),
      isUsed: d.isUsed === true,
      expiryDate: d.expiryDate ? String(d.expiryDate).slice(0, 10) : null,
      createdAt,
      source: String(d.source ?? 'unknown'),
    }
  })
}

// ─── Admin: delete a single user coupon ─────────────────────────────
export async function deleteUserCoupon(userId: string, couponDocId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', userId, 'coupons', couponDocId))
}

// ─── Admin: delete ALL coupons for a specific user ──────────────────
export async function deleteAllUserCoupons(userId: string): Promise<number> {
  const snap = await getDocs(collection(db, 'users', userId, 'coupons'))
  let count = 0
  for (const d of snap.docs) {
    await deleteDoc(d.ref)
    count++
  }
  return count
}

// ─── Fetch coupons assigned to a specific user ────────────────────
export async function fetchUserCoupons(userId: string): Promise<Coupon[]> {
  if (!userId) return []
  try {
    const userCouponsCol = collection(db, 'users', userId, 'coupons')
    // Only fetch unused coupons — skip thousands of used member_150 docs
    const q = query(userCouponsCol, where('isUsed', '==', false), limit(50))
    const snapshot = await getDocs(q)
    const now = new Date()

    return snapshot.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>
        return {
          code: String(data.code || '').toUpperCase(),
          minAmount: Number(data.minAmount) || 0,
          discount: Number(data.discount) || Number(data.value) || 0,
          description: data.description || '',
          isPercentage: false,
          expiryDate: data.expiryDate,
          isActive: true,
          isUsed: false,
          type: data.type || 'discount',
          userId: data.userId,
          isNewUserOnly: false,
          isForHelicopterOnly: false,
          applyPerTicket: false,
          minTickets: 0,
        } as Coupon
      })
      .filter((c) => !c.expiryDate || new Date(c.expiryDate) > now)
  } catch (error) {
    logger.error('coupon.fetch_user_coupons_failed', error)
    return []
  }
}

// ─── Main service ───────────────────────────────────────────────────
export const couponService = {
  fetchUserCoupons,

  async fetchCoupons(): Promise<Coupon[]> {
    try {
      // Fetch coupons from Firestore
      const couponsCol = collection(db, 'coupons')
      const snapshot = await getDocs(couponsCol)
      const now = new Date()

      return snapshot.docs
        .filter((doc) => {
          const data = doc.data() as Record<string, unknown>
          // Never expose vendor-created coupons to the customer app
          if (data.createdByVendorId) return false
          // Respect visibility: if set, must include 'customerApp'; legacy coupons (no field) are visible
          const vis = data.visibility
          if (Array.isArray(vis) && !vis.includes('customerApp')) return false
          return true
        })
        .map((doc) => {
          const data = doc.data() as Record<string, unknown>
          return {
            code: data.code,
            minAmount: Number(data.minAmount) || 0,
            discount: Number(data.discount) || 0,
            description: data.description,
            isNewUserOnly: data.isNewUserOnly === true,
            isPercentage: data.isPercentage === true,
            expiryDate: data.expiryDate,
            validDates: Array.isArray(data.validDates) ? data.validDates : undefined,
            excludeCategories: Array.isArray(data.excludeCategories)
              ? data.excludeCategories
              : undefined,
            isActive: data.isActive !== false,
            type: data.type || 'discount',
            isForHelicopterOnly: data.isForHelicopterOnly === true,
            applyPerTicket: data.applyPerTicket === true,
            minTickets: Number(data.minTickets) || 0,
            maxUsageCount: Number(data.maxUsageCount) || 0,
            usedCount: Number(data.usedCount) || 0,
          } as Coupon
        })
        .filter((c: Coupon) => {
          const isActive = c.isActive
          const notExpired = !c.expiryDate || new Date(c.expiryDate) > now
          return isActive && notExpired
        })
    } catch (error) {
      logger.error('coupon.fetch_failed', error)
      return []
    }
  },

  // Generate and save a coupon for a user (checks toggle first)
  async generateUserCoupon(
    userId: string,
    prize: { id: string; name: string; type: string; value: number; expiresInDays: number },
  ) {
    if (!userId) throw new Error('User ID required')

    // Check if user coupons are enabled
    const enabled = await getUserCouponsEnabled()
    if (!enabled) {
      logger.info('coupon.generation_disabled')
      return null
    }

    try {
      const prefix = prize.type === 'discount' ? 'DISC' : prize.type === 'session' ? 'GO' : 'RWD'
      const random = Math.floor(1000 + Math.random() * 9000)
      const code = `${prefix}${prize.value}${prize.type === 'discount' ? 'OFF' : ''}${random}`

      // Calculate expiry
      const expiryDate = new Date()
      expiryDate.setDate(expiryDate.getDate() + prize.expiresInDays)

      const couponData = {
        code,
        userId,
        type: prize.type,
        value: prize.value,
        description: `Reward: ${prize.name}`,
        minAmount: prize.value === 150 ? 600 : 0,
        discount: prize.type === 'discount' ? prize.value : 0,
        isUsed: false,
        createdAt: serverTimestamp(),
        expiryDate: expiryDate.toISOString(),
        source: 'tires_redemption',
      }

      // Save to user's subcollection
      await addDoc(collection(db, 'users', userId, 'coupons'), couponData)

      return code
    } catch (error) {
      logger.error('coupon.generate_failed', error)
      throw error
    }
  },

  // Mark a user coupon as used
  async markCouponAsUsed(userId: string, couponCode: string): Promise<void> {
    try {
      const upperCode = couponCode.toUpperCase()

      // Mark in user's coupon subcollection (case-insensitive match)
      const couponsCol = collection(db, 'users', userId, 'coupons')
      const snapshot = await getDocs(couponsCol)
      for (const d of snapshot.docs) {
        if (String(d.data().code ?? '').toUpperCase() === upperCode) {
          await setDoc(d.ref, { isUsed: true }, { merge: true })
        }
      }

      // Increment global usedCount using atomic increment to prevent race conditions
      const globalCouponsCol = collection(db, 'coupons')
      const q = query(globalCouponsCol, where('code', '==', couponCode))
      const globalSnapshot = await getDocs(q)
      if (globalSnapshot.empty) {
        // Retry with uppercase code in case stored code differs in case
        const qUpper = query(globalCouponsCol, where('code', '==', upperCode))
        const upperSnapshot = await getDocs(qUpper)
        if (!upperSnapshot.empty) {
          await updateDoc(upperSnapshot.docs[0].ref, { usedCount: increment(1) })
        }
      } else {
        await updateDoc(globalSnapshot.docs[0].ref, { usedCount: increment(1) })
      }
    } catch (error) {
      logger.error('coupon.mark_used_failed', error)
    }
  },
}
