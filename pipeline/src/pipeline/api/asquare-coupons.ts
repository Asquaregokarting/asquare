import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import { logger } from '../../lib/logger'

/** Strip keys whose value is `undefined` — Firestore rejects undefined fields. */
const stripUndefined = <T extends Record<string, unknown>>(obj: T): T => {
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}

export interface CouponGameAssociation {
  locationId: string
  gameId: string
  gameLabel: string
  subGameId?: string
  subGameLabel?: string
}

export interface AsquareCoupon {
  id: string
  code: string
  description: string
  type: 'discount' | 'addon' | 'session' | 'cashback'
  category: 'individual' | 'event'
  minAmount: number
  discount: number
  isPercentage: boolean
  isActive: boolean
  isNewUserOnly: boolean
  isForHelicopterOnly: boolean
  applyPerTicket: boolean
  minTickets: number
  startDate: string
  expiryDate: string
  maxUsageCount?: number
  usedCount: number
  /** Games/sub-games this coupon applies to. Empty array = all games (global coupon). */
  applicableGames: CouponGameAssociation[]
  /** If set, this coupon was created by a third-party vendor and applies only to their games. */
  createdByVendorId?: string
  createdByVendorName?: string
  /** If set, coupon is valid only when the billing mobile number matches this value (10-digit). */
  allowedMobile?: string
  /** Where this coupon is visible/usable. Vendor coupons always ['billing']. */
  visibility: Array<'customerApp' | 'billing'>
  createdAt: Timestamp
  updatedAt: Timestamp
}

interface UserCouponDoc {
  id: string
  userId: string
  couponId: string
  couponCode: string
  assignedAt: Timestamp
  [key: string]: unknown
}

const parseCoupon = (id: string, data: Record<string, unknown>): AsquareCoupon => ({
  id,
  code: String(data.code ?? ''),
  description: String(data.description ?? ''),
  type: (['discount', 'addon', 'session', 'cashback'].includes(String(data.type))
    ? String(data.type)
    : 'discount') as AsquareCoupon['type'],
  category: (data.category === 'event' ? 'event' : 'individual') as AsquareCoupon['category'],
  minAmount: Number(data.minAmount ?? 0),
  discount: Number(data.discount ?? 0),
  isPercentage: Boolean(data.isPercentage),
  isActive: data.isActive !== false,
  isNewUserOnly: Boolean(data.isNewUserOnly),
  isForHelicopterOnly: Boolean(data.isForHelicopterOnly),
  applyPerTicket: Boolean(data.applyPerTicket),
  minTickets: Number(data.minTickets ?? 0),
  startDate: String(data.startDate ?? ''),
  expiryDate: String(data.expiryDate ?? ''),
  maxUsageCount: data.maxUsageCount != null ? Number(data.maxUsageCount) : undefined,
  usedCount: Number(data.usedCount ?? 0),
  applicableGames: Array.isArray(data.applicableGames)
    ? (data.applicableGames as CouponGameAssociation[])
    : [],
  createdByVendorId: data.createdByVendorId ? String(data.createdByVendorId) : undefined,
  createdByVendorName: data.createdByVendorName ? String(data.createdByVendorName) : undefined,
  allowedMobile: data.allowedMobile ? String(data.allowedMobile) : undefined,
  visibility: Array.isArray(data.visibility)
    ? (data.visibility as Array<'customerApp' | 'billing'>)
    : data.createdByVendorId
      ? ['billing']
      : ['customerApp', 'billing'],
  createdAt: (data.createdAt as Timestamp) ?? Timestamp.now(),
  updatedAt: (data.updatedAt as Timestamp) ?? Timestamp.now(),
})

export const asquareCouponsApi = {
  async listCoupons(): Promise<AsquareCoupon[]> {
    const firestore = getAsquareFirestore()
    const couponsRef = collection(firestore, 'coupons')
    const snapshot = await getDocs(couponsRef)
    return snapshot.docs.map((record) =>
      parseCoupon(record.id, record.data() as Record<string, unknown>),
    )
  },

  async createCoupon(
    data: Omit<AsquareCoupon, 'id' | 'createdAt' | 'updatedAt' | 'usedCount'>,
  ): Promise<string> {
    const firestore = getAsquareFirestore()
    const couponsRef = collection(firestore, 'coupons')
    const newDocRef = doc(couponsRef)

    await setDoc(
      newDocRef,
      stripUndefined({
        ...data,
        code: String(data.code).toUpperCase(),
        usedCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )

    return newDocRef.id
  },

  async updateCoupon(
    id: string,
    data: Partial<Omit<AsquareCoupon, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<void> {
    const firestore = getAsquareFirestore()
    const couponRef = doc(firestore, 'coupons', id)

    const updates: Record<string, unknown> = stripUndefined({
      ...data,
      updatedAt: serverTimestamp(),
    })
    if (typeof data.code === 'string') {
      updates.code = data.code.toUpperCase()
    }

    await setDoc(couponRef, updates, { merge: true })
  },

  async deleteCoupon(id: string): Promise<void> {
    const firestore = getAsquareFirestore()
    await deleteDoc(doc(firestore, 'coupons', id))
  },

  async getUserCouponsEnabled(): Promise<boolean> {
    const firestore = getAsquareFirestore()
    const settingsRef = doc(firestore, 'settings', 'userCoupons')
    const snapshot = await getDoc(settingsRef)

    if (!snapshot.exists()) {
      return false
    }

    const data = snapshot.data() as Record<string, unknown>
    return Boolean(data.enabled)
  },

  async setUserCouponsEnabled(enabled: boolean): Promise<void> {
    const firestore = getAsquareFirestore()
    const settingsRef = doc(firestore, 'settings', 'userCoupons')
    await setDoc(settingsRef, { enabled, updatedAt: serverTimestamp() }, { merge: true })
  },

  /**
   * List the most recent user-assigned coupons across all users.
   *
   * PREVIOUS IMPLEMENTATION:
   *   1. Read up to 500 user docs filtered by `memberData != null`
   *   2. For each user, run a separate `getDocs(users/{uid}/coupons)`
   *   That meant up to 500 parallel Firestore reads — a textbook N+1
   *   fanout that was the dominant cost on the pipeline coupons module.
   *
   * NEW IMPLEMENTATION:
   *   A single `collectionGroup('coupons')` query, ordered by `createdAt
   *   DESC`, limited to `limitCount`. This collapses the entire fanout
   *   into one Firestore round-trip and lets the server do the sort.
   *
   *   Requires a single-field collection-group index on
   *   `coupons.createdAt DESC` — Firestore auto-creates the prompt for
   *   this on first run, but we add it to firestore.indexes.json so the
   *   first user doesn't hit a stall.
   *
   * The userId is recovered from `couponDoc.ref.parent.parent.id` —
   * each `coupons` subcollection is owned by `users/{uid}`.
   */
  async listRecentUserCoupons(limitCount: number = 200): Promise<UserCouponDoc[]> {
    const firestore = getAsquareFirestore()

    try {
      const couponsCg = collectionGroup(firestore, 'coupons')
      // Over-fetch to account for top-level `coupons` docs that the
      // collectionGroup query also matches but which we filter out below.
      const q = query(couponsCg, orderBy('createdAt', 'desc'), firestoreLimit(limitCount * 2))
      const snap = await getDocs(q)

      return (
        snap.docs
          // `collectionGroup('coupons')` also matches the top-level `coupons`
          // collection (coupon templates). Those have `parent.parent === null`
          // and no owning user — skip them so we don't surface them as
          // user-assigned coupons with an empty userId.
          .filter((couponDoc) => couponDoc.ref.parent.parent !== null)
          .slice(0, limitCount)
          .map((couponDoc) => {
            const data = couponDoc.data() as Record<string, unknown>
            const ownerId = couponDoc.ref.parent.parent?.id ?? ''
            return {
              id: couponDoc.id,
              userId: String(data.userId ?? ownerId),
              couponId: couponDoc.id,
              couponCode: String(data.code ?? '').toUpperCase(),
              assignedAt: (data.createdAt as Timestamp) ?? Timestamp.now(),
              ...data,
            } satisfies UserCouponDoc
          })
      )
    } catch (err) {
      // Common cause on first deploy: missing collection-group index. Fall
      // back to the legacy fanout so the page keeps working until the
      // index is built.
      const fallbackUsersSnap = await getDocs(
        query(collection(firestore, 'users'), where('memberData', '!=', null), firestoreLimit(500)),
      )

      const allCoupons: UserCouponDoc[] = []
      const fetchPromises = fallbackUsersSnap.docs.map(async (userDoc) => {
        const couponsSnap = await getDocs(collection(firestore, 'users', userDoc.id, 'coupons'))
        for (const couponDoc of couponsSnap.docs) {
          const data = couponDoc.data() as Record<string, unknown>
          allCoupons.push({
            id: couponDoc.id,
            userId: String(data.userId ?? userDoc.id),
            couponId: couponDoc.id,
            couponCode: String(data.code ?? '').toUpperCase(),
            assignedAt: (data.createdAt as Timestamp) ?? Timestamp.now(),
            ...data,
          } satisfies UserCouponDoc)
        }
      })

      await Promise.all(fetchPromises)

      allCoupons.sort((a, b) => {
        const ta = a.assignedAt instanceof Timestamp ? a.assignedAt.toMillis() : 0
        const tb = b.assignedAt instanceof Timestamp ? b.assignedAt.toMillis() : 0
        return tb - ta
      })

      logger.warn('asquare_coupons.collection_group_failed_using_fanout', { error: err })

      return allCoupons.slice(0, limitCount)
    }
  },

  async deleteUserCoupon(userId: string, docId: string): Promise<void> {
    if (!userId || !docId) {
      throw new Error(
        `deleteUserCoupon requires both userId and docId (got userId="${userId}", docId="${docId}")`,
      )
    }
    const firestore = getAsquareFirestore()
    await deleteDoc(doc(firestore, 'users', userId, 'coupons', docId))
  },

  async deleteAllUserCouponsForUser(userId: string): Promise<void> {
    const firestore = getAsquareFirestore()
    const userCouponsRef = collection(firestore, 'users', userId, 'coupons')
    const snapshot = await getDocs(userCouponsRef)

    const deletePromises = snapshot.docs.map((record) => deleteDoc(record.ref))
    await Promise.all(deletePromises)
  },
}
