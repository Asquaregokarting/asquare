/**
 * Customer 360 — Bookings tab data fetcher.
 *
 * Reads `users/{uid}/bookings` ordered by `sessionDate desc`, cursor-
 * paginated. Optional equality filters for branch, bookingStatus,
 * paymentStatus and a single date range on `sessionDate`. When
 * `includeDeleted` is set, also fetches the customer's rows from the
 * top-level `deleted_bookings` collection (soft-delete archive) and
 * merges them in client-side.
 *
 * Why cursor (not offset): list of bookings can be hundreds of rows for
 * loyal customers; offset pagination would re-scan from the start every
 * page. Cursor stays O(page) regardless of position.
 */
import {
  collection,
  collectionGroup,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { getAsquareFirestore } from '../asquare-firestore'
import {
  parseBooking,
  type AsquareBooking,
  type BookingStatus,
  type PaymentStatus,
} from '../asquare-bookings'

export interface CustomerBookingsFilters {
  locationId?: string
  bookingStatus?: BookingStatus
  paymentStatus?: PaymentStatus
  /** YYYY-MM-DD in IST (matches the `visitDate` field on every booking). */
  visitDateAfter?: string
  /** YYYY-MM-DD in IST (matches the `visitDate` field on every booking). */
  visitDateBefore?: string
}

export interface CustomerBookingsOptions {
  pageSize?: number
  cursor?: QueryDocumentSnapshot<DocumentData>
  filters?: CustomerBookingsFilters
  /** Include soft-deleted bookings from the `deleted_bookings` archive. */
  includeDeleted?: boolean
}

export interface CustomerBookingRow extends AsquareBooking {
  /** True when this row came from the deleted_bookings archive. */
  deleted: boolean
  /** Who deleted it (only set when deleted === true). */
  deletedBy?: { id: string; name: string; role: string }
  /** When it was deleted (only set when deleted === true). */
  deletedAt?: Date
}

export interface CustomerBookingsPage {
  items: CustomerBookingRow[]
  nextCursor: QueryDocumentSnapshot<DocumentData> | null
}

const buildConstraints = (filters?: CustomerBookingsFilters): QueryConstraint[] => {
  const c: QueryConstraint[] = []
  if (filters?.locationId) c.push(where('locationId', '==', filters.locationId))
  if (filters?.bookingStatus) c.push(where('bookingStatus', '==', filters.bookingStatus))
  if (filters?.paymentStatus) c.push(where('paymentStatus', '==', filters.paymentStatus))
  // Filter on the stamped `visitDate` (IST YYYY-MM-DD) so the date range
  // matches what the dashboard / scanner / feedback-calls see — and so
  // it's browser-timezone-independent. The previous `sessionDate` range
  // on a Date field shifted by a day for any admin not in IST.
  if (filters?.visitDateAfter) c.push(where('visitDate', '>=', filters.visitDateAfter))
  if (filters?.visitDateBefore) c.push(where('visitDate', '<=', filters.visitDateBefore))
  return c
}

const toDateOrNull = (raw: unknown): Date | null => {
  if (!raw) return null
  if (raw instanceof Date) return raw
  const anyRaw = raw as { toDate?: () => Date }
  if (typeof anyRaw.toDate === 'function') return anyRaw.toDate()
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw)
    return Number.isFinite(d.getTime()) ? d : null
  }
  return null
}

export const customerBookingsApi = {
  /**
   * Fetch a single page of this customer's bookings.
   *
   * The active subcollection (`users/{uid}/bookings`) is paginated by
   * sessionDate desc. When `includeDeleted` is true, deleted rows are
   * fetched separately from `deleted_bookings` (filtered by `userId`)
   * and merged into the result, then re-sorted. The merge is bounded by
   * `pageSize` so the page count stays predictable.
   */
  async listBookings(
    customerId: string,
    opts?: CustomerBookingsOptions,
  ): Promise<CustomerBookingsPage> {
    const pageSize = Math.max(1, opts?.pageSize ?? 50)
    const firestore = getAsquareFirestore()
    const userBookingsCol = collection(firestore, 'users', customerId, 'bookings')

    const constraints = buildConstraints(opts?.filters)
    // When visitDate range filter is active, Firestore requires the first
    // orderBy to match the inequality field. Use visitDate as primary sort
    // (descending YYYY-MM-DD = newest first) and sessionDate as secondary
    // to keep intra-day ordering by time.
    const hasVisitDateFilter = Boolean(
      opts?.filters?.visitDateAfter || opts?.filters?.visitDateBefore,
    )
    if (hasVisitDateFilter) {
      constraints.push(orderBy('visitDate', 'desc'))
    }
    constraints.push(orderBy('sessionDate', 'desc'))
    constraints.push(firestoreLimit(pageSize))
    if (opts?.cursor) constraints.push(startAfter(opts.cursor))

    const snap = await getDocs(query(userBookingsCol, ...constraints))
    const allRows: CustomerBookingRow[] = snap.docs.map((d) => {
      const raw = d.data() as Record<string, unknown>
      const deletedBy = raw.deletedBy as
        | { id?: unknown; name?: unknown; role?: unknown }
        | undefined
      const deletedAt = toDateOrNull(raw.deletedAt)
      return {
        ...parseBooking({ ...raw, id: d.id }),
        deleted: !!deletedAt,
        ...(deletedAt ? { deletedAt } : {}),
        ...(deletedBy
          ? {
              deletedBy: {
                id: String(deletedBy.id ?? ''),
                name: String(deletedBy.name ?? ''),
                role: String(deletedBy.role ?? ''),
              },
            }
          : {}),
      }
    })
    // Soft-deleted bookings are excluded from the default view; they
    // surface only when the caller opts in via `includeDeleted`.
    const active = opts?.includeDeleted ? allRows : allRows.filter((r) => !r.deleted)

    let merged = active
    if (opts?.includeDeleted) {
      const deletedConstraints: QueryConstraint[] = [where('userId', '==', customerId)]
      if (opts.filters?.locationId)
        deletedConstraints.push(where('locationId', '==', opts.filters.locationId))
      // Cap the archive read; deleted rows are typically << active rows.
      deletedConstraints.push(firestoreLimit(pageSize))

      // deleted_bookings is a top-level collection, not a collection group.
      // Use a direct collection query.
      const deletedSnap = await getDocs(
        query(collection(firestore, 'deleted_bookings'), ...deletedConstraints),
      )
      const deleted: CustomerBookingRow[] = deletedSnap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>
        const deletedBy = raw.deletedBy as
          | { id?: unknown; name?: unknown; role?: unknown }
          | undefined
        return {
          ...parseBooking({ ...raw, id: d.id }),
          deleted: true,
          deletedAt: toDateOrNull(raw.deletedAt) ?? undefined,
          deletedBy: deletedBy
            ? {
                id: String(deletedBy.id ?? ''),
                name: String(deletedBy.name ?? ''),
                role: String(deletedBy.role ?? ''),
              }
            : undefined,
        }
      })
      merged = [...active, ...deleted]
        .sort((a, b) => b.sessionDate.getTime() - a.sessionDate.getTime())
        .slice(0, pageSize)
    }

    const nextCursor = snap.size === pageSize ? snap.docs[snap.docs.length - 1] : null
    return { items: merged, nextCursor }
  },
}

// Re-export so callers don't have to import the collectionGroup utility
// from firebase/firestore directly when they only need it for tests.
export { collectionGroup }
