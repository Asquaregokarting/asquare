/**
 * Customer 360 — Referrals tab fetcher.
 *
 * Two narrow APIs:
 *   - getReferrer(uid)              → minimal info about the customer who
 *                                      referred this user. Single getDoc.
 *   - listReferredCustomers(uid)    → paginates users/{uid}/referredCustomers
 *                                      (forward-edge index maintained by the
 *                                      onUserCreateReferralIndex Cloud Function).
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore'
import { getAsquareFirestore } from '../asquare-firestore'

export interface ReferrerInfo {
  id: string
  displayName: string
  phone: string
}

export interface ReferredCustomerRow {
  id: string
  displayName: string
  phone: string
  joinedAt: Date | null
  totalSpent: number
}

export interface ReferredCustomersOptions {
  pageSize?: number
  cursor?: QueryDocumentSnapshot<DocumentData>
}

export interface ReferredCustomersPage {
  items: ReferredCustomerRow[]
  nextCursor: QueryDocumentSnapshot<DocumentData> | null
}

const toDateOrNull = (raw: unknown): Date | null => {
  if (!raw) return null
  if (raw instanceof Date) return raw
  const ts = raw as Timestamp
  if (typeof ts.toDate === 'function') return ts.toDate()
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw)
    return Number.isFinite(d.getTime()) ? d : null
  }
  return null
}

export const customerReferralsApi = {
  async getReferrer(referrerUid: string): Promise<ReferrerInfo | null> {
    if (!referrerUid) return null
    const firestore = getAsquareFirestore()
    const snap = await getDoc(doc(firestore, 'users', referrerUid))
    if (!snap.exists()) return null
    const data = snap.data() as Record<string, unknown>
    return {
      id: snap.id,
      displayName: String(data.displayName ?? ''),
      phone: String(data.phone ?? ''),
    }
  },

  async listReferredCustomers(
    customerId: string,
    opts?: ReferredCustomersOptions,
  ): Promise<ReferredCustomersPage> {
    const pageSize = Math.max(1, opts?.pageSize ?? 50)
    const firestore = getAsquareFirestore()

    const constraints: QueryConstraint[] = [orderBy('joinedAt', 'desc'), firestoreLimit(pageSize)]
    if (opts?.cursor) constraints.push(startAfter(opts.cursor))

    const snap = await getDocs(
      query(collection(firestore, 'users', customerId, 'referredCustomers'), ...constraints),
    )
    const items: ReferredCustomerRow[] = snap.docs.map((d) => {
      const raw = d.data() as Record<string, unknown>
      return {
        id: String(raw.referredUid ?? d.id),
        displayName: String(raw.displayName ?? ''),
        phone: String(raw.phone ?? ''),
        joinedAt: toDateOrNull(raw.joinedAt),
        totalSpent: Number(raw.totalSpent ?? 0),
      }
    })
    const nextCursor = snap.size === pageSize ? snap.docs[snap.docs.length - 1] : null
    return { items, nextCursor }
  },
}
