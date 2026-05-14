/**
 * Customer 360 — Coupons tab fetcher.
 *
 * Reads `users/{uid}/coupons` ordered by `createdAt desc`, cursor-paginated.
 * Optional equality filter on `source` (member_150 / reward / etc.) and
 * `isUsed` boolean.
 */
import {
  collection,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore'
import { getAsquareFirestore } from '../asquare-firestore'

export interface CouponRow {
  id: string
  code: string
  type: string
  discount: number
  description: string
  isUsed: boolean
  source: string
  createdAt: Date | null
  expiryDate: string | null
}

export interface CouponsFilters {
  source?: string
  isUsed?: boolean
}

export interface CouponsOptions {
  pageSize?: number
  cursor?: QueryDocumentSnapshot<DocumentData>
  filters?: CouponsFilters
}

export interface CouponsPage {
  items: CouponRow[]
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

const parseCoupon = (id: string, raw: Record<string, unknown>): CouponRow => ({
  id,
  code: String(raw.code ?? '').toUpperCase(),
  type: String(raw.type ?? 'discount'),
  discount: Number(raw.discount ?? raw.value ?? 0),
  description: String(raw.description ?? ''),
  isUsed: raw.isUsed === true,
  source: String(raw.source ?? 'unknown'),
  createdAt: toDateOrNull(raw.createdAt),
  expiryDate: raw.expiryDate ? String(raw.expiryDate).slice(0, 10) : null,
})

export const customerCouponsApi = {
  async listCoupons(customerId: string, opts?: CouponsOptions): Promise<CouponsPage> {
    const pageSize = Math.max(1, opts?.pageSize ?? 50)
    const firestore = getAsquareFirestore()

    const constraints: QueryConstraint[] = []
    if (opts?.filters?.source) constraints.push(where('source', '==', opts.filters.source))
    if (opts?.filters?.isUsed !== undefined)
      constraints.push(where('isUsed', '==', opts.filters.isUsed))
    constraints.push(orderBy('createdAt', 'desc'))
    constraints.push(firestoreLimit(pageSize))
    if (opts?.cursor) constraints.push(startAfter(opts.cursor))

    const snap = await getDocs(
      query(collection(firestore, 'users', customerId, 'coupons'), ...constraints),
    )
    const items = snap.docs.map((d) => parseCoupon(d.id, d.data() as Record<string, unknown>))
    const nextCursor = snap.size === pageSize ? snap.docs[snap.docs.length - 1] : null
    return { items, nextCursor }
  },
}
