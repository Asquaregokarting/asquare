import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import type { UpdateData, DocumentData } from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { deriveVendorIds, nowIso, stripUndefined, toOptionalString } from './firestore-utils'
import { reserveSerialsForItems } from './serial-counters'
import { reverseCashierIncentives } from './incentives-firestore'
import {
  HelicopterActivityRecord,
  HelicopterPaymentRecord,
  Role,
  TransactionRecord,
  VendorLedgerEntry,
  VendorType,
} from './types'
import { resolveLocation } from '../../lib/locations'
import { istDateTimeParts, toISTDateStr } from '../lib/ist-date'
import { logger } from '../../lib/logger'
import { computeRevenueSplit } from '../../lib/unified-booking'
import { assertNoZeroOutHack } from '../../lib/booking-validator'
import { isTerminatedBooking } from '../../lib/booking-filter'
import { decrementHelicopterCountForCancellation } from '../../services/helicopterEarlyBird'

const BILLING_TRANSACTIONS_COLLECTION = 'bookings'
const VENDOR_LEDGER_COLLECTION = 'vendorLedger'
const USE_FIRESTORE_BILLING = import.meta.env.VITE_USE_FIRESTORE_BILLING !== 'false'

export const GST_PERCENT_DEFAULT = 18
export const VENDOR_SHARE_PERCENT_DEFAULT = 80

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const getBillingCollection = () => {
  if (!USE_FIRESTORE_BILLING) return null
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, BILLING_TRANSACTIONS_COLLECTION)
}

const getLedgerCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, VENDOR_LEDGER_COLLECTION)
}

/**
 * Reads the vendor's revenue share percentage from their profile.
 * This is the single source of truth — never overridden at billing time.
 * Returns VENDOR_SHARE_PERCENT_DEFAULT if the profile doesn't exist (safety fallback).
 */
const getVendorBillingConfig = async (
  vendorId: string,
): Promise<{ sharePercent: number; vendorType: VendorType }> => {
  const firestore = initializeFirestore()
  if (!firestore) return { sharePercent: VENDOR_SHARE_PERCENT_DEFAULT, vendorType: 'ThirdParty' }
  const snap = await getDoc(doc(firestore, 'vendorDetails', vendorId))
  if (!snap.exists())
    return { sharePercent: VENDOR_SHARE_PERCENT_DEFAULT, vendorType: 'ThirdParty' }
  const data = snap.data() as Record<string, unknown>
  const share = Math.max(
    0,
    Math.min(100, toNumber(data.revenueShare, VENDOR_SHARE_PERCENT_DEFAULT)),
  )
  const vendorType = (data.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty') as VendorType
  return { sharePercent: share, vendorType }
}

const generateInvoiceNumber = (): string => {
  const p = istDateTimeParts()
  const parts = `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`
  return `INV-${parts}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

// ─── Revenue split calculation (base-first, then GST) ────────────────────────
/**
 * Correct formula:
 *   vendorBase = round(baseAmount × vendorSharePercent / 100)
 *   vendorGst  = round(gstAmount × vendorSharePercent / 100)
 *   vendorTotal = vendorBase + vendorGst
 *   companyBase = baseAmount - vendorBase
 *   companyGst  = gstAmount - vendorGst
 *   companyTotal = companyBase + companyGst
 *
 * Split is ALWAYS on baseAmount — never on totalAmount.
 * GST is then applied proportionally so vendor+company GST = original GST exactly.
 *
 * Canonical implementation now lives in src/lib/unified-booking.ts.
 */
export { computeRevenueSplit }

// ─── Mapper ───────────────────────────────────────────────────────────────────
export const mapTransactionRecord = (
  id: string,
  data: Record<string, unknown>,
): TransactionRecord => {
  // Support both old (vendorAmount/companyAmount) and new (vendorTotal/companyTotal) field names
  const vendorTotal =
    data.vendorTotal !== undefined
      ? toNumber(data.vendorTotal)
      : data.vendorAmount !== undefined
        ? toNumber(data.vendorAmount)
        : undefined
  const companyTotal =
    data.companyTotal !== undefined
      ? toNumber(data.companyTotal)
      : data.companyAmount !== undefined
        ? toNumber(data.companyAmount)
        : undefined

  // Carry the soft-delete marker through so every aggregation (dashboard
  // KPIs, revenue report, game revenue, cashier totals) can exclude
  // trashed bookings via the shared `filterPaidBookings` helper. Stored
  // as an ISO string regardless of whether Firestore wrote a Timestamp
  // or a plain string.
  const deletedAt = (() => {
    const raw = data.deletedAt
    if (!raw) return undefined
    if (typeof raw === 'object' && 'toDate' in (raw as object)) {
      try {
        return (raw as { toDate: () => Date }).toDate().toISOString()
      } catch {
        return undefined
      }
    }
    return typeof raw === 'string' ? raw : undefined
  })()

  return {
    id,
    invoiceNumber: String(data.invoiceNumber ?? data.orderNumber ?? generateInvoiceNumber()),
    ...(deletedAt ? { deletedAt } : {}),
    customerName:
      toOptionalString(data.customerName) ??
      toOptionalString(data.userDisplayName) ??
      toOptionalString(data.userName) ??
      toOptionalString(data.name),
    customerPhone:
      toOptionalString(data.customerPhone) ??
      toOptionalString(data.userPhone) ??
      toOptionalString(data.mobile) ??
      toOptionalString(data.phone),
    totalAmount: toNumber(data.finalAmount ?? data.totalAmount ?? data.amount),
    baseAmount: data.baseAmount !== undefined ? toNumber(data.baseAmount) : undefined,
    gstAmount: data.gstAmount !== undefined ? toNumber(data.gstAmount) : undefined,
    gstPercent: data.gstPercent !== undefined ? toNumber(data.gstPercent) : undefined,
    paymentMethod: (() => {
      const raw = String(data.paymentMethod ?? 'Cash')
      if (raw === 'Online') return 'UPI' as const // backward compat: old "Online" → new "UPI"
      return raw as TransactionRecord['paymentMethod']
    })(),
    refundStatus:
      (String(data.refundStatus ?? 'None') as TransactionRecord['refundStatus']) ?? 'None',
    refundAmount: data.refundAmount !== undefined ? toNumber(data.refundAmount) : undefined,
    refundMode: ((): TransactionRecord['refundMode'] => {
      const raw = String(data.refundMode ?? '')
      return raw === 'cash' || raw === 'wallet' ? raw : undefined
    })(),
    transactionDate: (() => {
      const raw = data.transactionDate
      // Handle Firestore Timestamp objects (have .toDate() method)
      if (raw && typeof raw === 'object' && 'toDate' in (raw as object)) {
        try {
          return (raw as { toDate: () => Date }).toDate().toISOString()
        } catch {
          /* fall through */
        }
      }
      const str = raw ? String(raw) : ''
      // If we already have a valid ISO datetime, use it directly
      if (str && str.includes('T') && !isNaN(new Date(str).getTime())) return str
      // Date-only string or missing — use createdAt for the full timestamp
      const ca = data.createdAt
      if (ca && typeof ca === 'object' && 'toDate' in (ca as object)) {
        try {
          return (ca as { toDate: () => Date }).toDate().toISOString()
        } catch {
          /* fall through */
        }
      }
      if (ca && typeof ca === 'string' && !isNaN(new Date(ca).getTime())) return ca
      if (str && !isNaN(new Date(str).getTime())) return str // date-only is better than nothing
      return nowIso()
    })(),
    subtotal: data.subtotal !== undefined ? toNumber(data.subtotal) : undefined,
    tax: data.tax !== undefined ? toNumber(data.tax) : undefined,
    discount: data.discount !== undefined ? toNumber(data.discount) : undefined,
    source: (data.source ? String(data.source) : undefined) as TransactionRecord['source'],
    sourceType: toOptionalString(data.sourceType),
    paymentStatus: (['pending', 'completed', 'failed'].includes(String(data.paymentStatus))
      ? String(data.paymentStatus)
      : 'pending') as TransactionRecord['paymentStatus'],
    paymentReference: toOptionalString(data.paymentReference),
    splitCash: data.splitCash !== undefined ? toNumber(data.splitCash) : undefined,
    splitUpi: data.splitUpi !== undefined ? toNumber(data.splitUpi) : undefined,
    splitCard: data.splitCard !== undefined ? toNumber(data.splitCard) : undefined,
    couponCode: toOptionalString(data.couponCode),
    couponDiscount:
      data.couponDiscount !== undefined
        ? toNumber(data.couponDiscount)
        : data.couponAmount !== undefined
          ? toNumber(data.couponAmount)
          : undefined,
    bookingId: toOptionalString(data.bookingId),
    locationId: (() => {
      const raw = toOptionalString(data.locationId)
      if (!raw) return undefined
      return resolveLocation(raw)?.slug ?? raw
    })(),
    vendorId: toOptionalString(data.vendorId),
    gameId: toOptionalString(data.gameId),
    subGameId: toOptionalString(data.subGameId),
    variantId: toOptionalString(data.variantId),
    vendorSharePercent:
      data.vendorSharePercent !== undefined ? toNumber(data.vendorSharePercent) : undefined,
    vendorBase: data.vendorBase !== undefined ? toNumber(data.vendorBase) : undefined,
    vendorGst: data.vendorGst !== undefined ? toNumber(data.vendorGst) : undefined,
    vendorTotal,
    companyBase: data.companyBase !== undefined ? toNumber(data.companyBase) : undefined,
    companyGst: data.companyGst !== undefined ? toNumber(data.companyGst) : undefined,
    companyTotal,
    createdBy: toOptionalString(data.createdBy) ?? toOptionalString(data.createdByAdminId),
    createdByName:
      toOptionalString(data.createdByName) ?? toOptionalString(data.createdByAdminName),
    createdByRole: toOptionalString(data.createdByRole),
    createdAt: (() => {
      const raw = data.createdAt
      // Firestore Timestamp → ISO string
      if (raw && typeof raw === 'object' && 'toDate' in (raw as object)) {
        try {
          return (raw as { toDate: () => Date }).toDate().toISOString()
        } catch {
          /* fall through */
        }
      }
      return toOptionalString(raw)
    })(),
    bookingStatus: toOptionalString(data.bookingStatus),
    visitDate: toOptionalString(data.visitDate),
    originalVisitDate: toOptionalString(data.originalVisitDate),
    rescheduledAt: toOptionalString(data.rescheduledAt),
    rescheduledBy: toOptionalString(data.rescheduledBy),
    rescheduledByName: toOptionalString(data.rescheduledByName),
    cancelled: data.cancelled === true,
    cancelledAt: toOptionalString(data.cancelledAt),
    cancelledBy: toOptionalString(data.cancelledBy),
    cancelledByName: toOptionalString(data.cancelledByName),
    cancellationReason: toOptionalString(data.cancellationReason),
    items: (() => {
      // The customer-app refund flow stamps `refunded:true` only on
      // `items[]`. The mapper prefers `billingItems` when present, so the
      // refunded flag would otherwise be lost. Build a lookup of refunded
      // variantIds from `items[]` so we can OR it onto the chosen source.
      const refundedVariants = new Set<string>()
      const rawItems = Array.isArray(data.items) ? (data.items as unknown[]) : []
      for (const it of rawItems) {
        if (!it || typeof it !== 'object') continue
        const row = it as Record<string, unknown>
        if (row.refunded === true) {
          const vid = String(row.variantId ?? '').trim()
          if (vid) refundedVariants.add(vid)
        }
      }
      const source = (data.billingItems as unknown[]) ?? (data.items as unknown[])
      if (!Array.isArray(source)) return []
      return source
        .map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return null
          const row = item as Record<string, unknown>
          const activity = row.activity as Record<string, unknown> | undefined
          const variantId = toOptionalString(row.variantId)
          const refundedFromItems = variantId ? refundedVariants.has(variantId) : false
          return {
            itemName:
              String(row.itemName ?? '').trim() || String(activity?.name ?? '').trim() || 'Item',
            quantity: Math.max(1, Math.floor(toNumber(row.quantity, 1))),
            unitPrice: Math.max(0, toNumber(row.unitPrice || row.price || activity?.basePrice)),
            gameId: toOptionalString(row.gameId),
            subGameId: toOptionalString(row.subGameId),
            variantId,
            vendorId: toOptionalString(row.vendorId),
            itemBaseAmount:
              row.itemBaseAmount !== undefined ? toNumber(row.itemBaseAmount) : undefined,
            itemGstAmount:
              row.itemGstAmount !== undefined ? toNumber(row.itemGstAmount) : undefined,
            vendorSharePercent:
              row.vendorSharePercent !== undefined ? toNumber(row.vendorSharePercent) : undefined,
            vendorBase: row.vendorBase !== undefined ? toNumber(row.vendorBase) : undefined,
            vendorGst: row.vendorGst !== undefined ? toNumber(row.vendorGst) : undefined,
            vendorTotal: row.vendorTotal !== undefined ? toNumber(row.vendorTotal) : undefined,
            companyBase: row.companyBase !== undefined ? toNumber(row.companyBase) : undefined,
            companyGst: row.companyGst !== undefined ? toNumber(row.companyGst) : undefined,
            companyTotal: row.companyTotal !== undefined ? toNumber(row.companyTotal) : undefined,
            serialStart: row.serialStart !== undefined ? toNumber(row.serialStart) : undefined,
            refunded: row.refunded === true || refundedFromItems ? true : undefined,
            printIndividualTokens: row.printIndividualTokens === true ? true : undefined,
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    })(),
  }
}

// ─── Public read helpers ──────────────────────────────────────────────────────
export const isFirestoreBillingActive = (): boolean => Boolean(getBillingCollection())

export const listFirestoreBillingTransactions = async (): Promise<TransactionRecord[]> => {
  const billingCollection = getBillingCollection()
  if (!billingCollection) throw new Error('Firestore billing is not configured.')
  // No orderBy — fetches ALL bookings including App bookings without transactionDate.
  // mapTransactionRecord fills in transactionDate from createdAt for old docs.
  const snapshot = await getDocs(billingCollection)
  const records = snapshot.docs
    .map((item) => mapTransactionRecord(item.id, item.data() as Record<string, unknown>))
    // Soft-deleted bookings (in Trash) are hidden from every consumer of
    // this list — dashboard KPIs, daily reports, cashier totals, vendor
    // ledger sweeps. Trash UI reads them via a dedicated path.
    .filter((record) => !record.deletedAt)
  records.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
  return records
}

/**
 * Scope descriptor for narrowing `listAllBookings` results to just what
 * the calling user is allowed to see. Built by the caller from the
 * authenticated session — never derived inside listAllBookings itself.
 */
export interface BookingScope {
  role: Role
  /** Canonical branch identifier (slug, branchId, or firestoreDocId). */
  branchId?: string
  /** Required when role === 'ThirdParty' — filters bookings to this vendor. */
  vendorId?: string
}

/**
 * Returns every stored form of a branch identifier (slug, branchId,
 * firestoreDocId). Raw booking docs write `locationId` in any of these
 * three forms depending on the write path, so a Firestore
 * `where('locationId', 'in', variants)` query needs all of them to match
 * every document for the branch.
 */
export const branchLocationVariants = (branchId: string): string[] => {
  const resolved = resolveLocation(branchId)
  if (!resolved) return [branchId]
  const variants = new Set<string>()
  variants.add(resolved.slug)
  variants.add(resolved.branchId)
  if (resolved.firestoreDocId) variants.add(resolved.firestoreDocId)
  variants.add(branchId)
  return Array.from(variants).filter(Boolean)
}

/** True when the given role is allowed to read bookings across all branches. */
const isUnrestrictedBookingRole = (role: Role): boolean =>
  isPrivilegedRole(role) || role === 'Developer' || role === 'Backend'

/**
 * Canonical listing function — single source of truth for ALL modules.
 * Returns every matching booking mapped to TransactionRecord.
 *
 * Optionally accepts `fromCreatedAt` (ISO-ish string) to push a server-side
 * `where('createdAt', '>=', ...)` filter. Callers building date-range
 * reports should pass a small buffer (e.g. `from - 1 day`) so that
 * bookings whose `createdAt` slightly precedes the report range but whose
 * `transactionDate` falls inside it are still included — the
 * transactionDate semantic check is kept in the existing in-memory filter
 * at the call sites. This keeps semantics identical to the old full scan
 * while cutting reads by ~99% for a one-week report on a large collection.
 *
 * `createdAt` is used (not `transactionDate`) because the mapping layer
 * intentionally falls back to `createdAt` for old App bookings that never
 * stored `transactionDate` — filtering on `transactionDate` server-side
 * would silently drop those rows.
 *
 * When `scope` is passed, the server-side query is narrowed based on the
 * caller's role: privileged roles (Owner/Admin/Developer/Backend) see
 * everything; location-restricted roles get a `where('locationId','in',
 * variants)` filter; ThirdParty vendors get a `where('vendorId','==',
 * vendorId)` filter. Omitting `scope` preserves the legacy unrestricted
 * behaviour — callers that render financial data MUST pass it.
 */
export const listAllBookings = async (opts?: {
  fromCreatedAt?: string
  scope?: BookingScope
}): Promise<TransactionRecord[]> => {
  const billingCollection = getBillingCollection()
  if (!billingCollection) throw new Error('Firestore billing is not configured.')

  const scope = opts?.scope
  const unrestricted = !scope || isUnrestrictedBookingRole(scope.role)

  // Build the query. Privileged / unscoped callers keep the original
  // behaviour (optional createdAt range filter only). Scoped callers push
  // their narrowing filter server-side so the client never receives
  // other-branch / other-vendor rows over the wire.
  //
  // Note: combining a `where('locationId','in',...)` filter with a
  // `where('createdAt','>=',...)` range filter requires a composite
  // index. To avoid runtime index errors for scoped callers we drop the
  // createdAt filter when scoping is active — the resulting branch-only
  // read is still far smaller than the full-collection scan it replaces.
  let snapshot
  if (unrestricted) {
    snapshot = opts?.fromCreatedAt
      ? await getDocs(
          query(
            billingCollection,
            where('createdAt', '>=', Timestamp.fromDate(new Date(opts.fromCreatedAt))),
          ),
        )
      : await getDocs(billingCollection)
  } else if (scope?.role === 'ThirdParty' && scope.vendorId) {
    // Multi-vendor bookings used to be invisible to non-primary vendors:
    // the old `where('vendorId','==',X)` filter only matched the booking's
    // top-level field (set to whichever item was primary at sale time).
    // The fix maintains a `vendorIds: string[]` array on each booking
    // (see `deriveVendorIds` and the writers in this file +
    // `unified-booking.ts`) and queries that with `array-contains`.
    //
    // We union the new query with the legacy top-level equality query so
    // bookings written before the backfill — and any future docs that
    // escape the write path — still appear. The union is cheap (each side
    // is a single indexed query) and keeps the migration zero-risk.
    const [byArray, byTop] = await Promise.all([
      getDocs(query(billingCollection, where('vendorIds', 'array-contains', scope.vendorId))),
      getDocs(query(billingCollection, where('vendorId', '==', scope.vendorId))),
    ])
    const merged = new Map<string, (typeof byArray.docs)[number]>()
    for (const d of byArray.docs) merged.set(d.id, d)
    for (const d of byTop.docs) if (!merged.has(d.id)) merged.set(d.id, d)
    snapshot = { docs: Array.from(merged.values()) } as typeof byArray
  } else if (scope?.branchId) {
    const variants = branchLocationVariants(scope.branchId)
    snapshot = await getDocs(
      query(billingCollection, where('locationId', 'in', variants.slice(0, 10))),
    )
  } else {
    // Location-restricted role with no branch resolved — nothing to return.
    // Failing closed keeps us from accidentally leaking the full collection
    // if the caller forgets to populate branchId.
    return []
  }

  const records = snapshot.docs.map((item) =>
    mapTransactionRecord(item.id, item.data() as Record<string, unknown>),
  )
  records.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
  return records
}

/** Real-time subscription for recent refunded transactions. Returns unsubscribe fn. */
export const subscribeRecentRefunds = (
  onData: (rows: TransactionRecord[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const billingCollection = getBillingCollection()
  if (!billingCollection) {
    onData([])
    return () => {}
  }
  // IST-aware 4-day cutoff (today + 3 prior days)
  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() + 330)
  cutoff.setDate(cutoff.getDate() - 3)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setMinutes(cutoff.getMinutes() - 330)
  const cutoffISO = cutoff.toISOString()
  return onSnapshot(
    query(
      billingCollection,
      where('refundStatus', 'in', ['Partial', 'Full']),
      where('transactionDate', '>=', cutoffISO),
      orderBy('transactionDate', 'desc'),
      limit(20),
    ),
    (snapshot) => {
      const rows = snapshot.docs.map((item) =>
        mapTransactionRecord(item.id, item.data() as Record<string, unknown>),
      )
      onData(rows)
    },
    onError,
  )
}

export const getFirestoreBillingTransactionById = async (
  transactionId: string,
): Promise<TransactionRecord> => {
  const billingCollection = getBillingCollection()
  if (!billingCollection) throw new Error('Firestore billing is not configured.')
  const snapshot = await getDoc(doc(billingCollection, transactionId))
  if (!snapshot.exists()) throw new Error('Transaction not found.')
  return mapTransactionRecord(snapshot.id, snapshot.data() as Record<string, unknown>)
}

export const getFirestoreBillingInvoice = async (
  invoiceNumber: string,
): Promise<TransactionRecord> => {
  // invoiceNumber is the booking doc id (both produced by the same
  // ensureUniqueOrderNumber() generator at create time), so a direct
  // getDoc is both cheaper and correct. Falls back to a field scan only
  // if the direct lookup misses — defends against legacy docs where the
  // id and invoiceNumber drifted.
  const billingCollection = getBillingCollection()
  if (!billingCollection) throw new Error('Firestore billing is not configured.')

  const directSnap = await getDoc(doc(billingCollection, invoiceNumber))
  if (directSnap.exists()) {
    return mapTransactionRecord(directSnap.id, directSnap.data() as Record<string, unknown>)
  }

  const fallbackSnap = await getDocs(
    query(billingCollection, where('invoiceNumber', '==', invoiceNumber), limit(1)),
  )
  if (fallbackSnap.empty) throw new Error('Invoice not found.')
  const match = fallbackSnap.docs[0]
  return mapTransactionRecord(match.id, match.data() as Record<string, unknown>)
}

export const getLocationDayTotals = async (
  locationId: string, // accepts slug, branchId, or display name — resolved internally
  date: string, // YYYY-MM-DD
  shiftStartTime?: string, // ISO string — only count transactions created after this time
): Promise<{ Cash: number; Card: number; UPI: number; count: number }> => {
  const billingCollection = getBillingCollection()
  if (!billingCollection) throw new Error('Firestore billing is not configured.')

  // Callers pass any identifier form: BillingModule's settlement flow
  // forwards `shiftRecord.locationId`, which `shifts-firestore` stores as
  // a branchId ("0", "1", "2", "5") via `normalizeLocationId`. Resolve to
  // canonical slug here so the in-memory comparison below uses the same
  // form `resolveLocation(...).slug` produces for each row. Without this,
  // every cashier saw ₹0 across Cash/Card/UPI in the shift checkout
  // dialog because slug ("visakhapatnam") never equals branchId ("0").
  const targetSlug = resolveLocation(locationId)?.slug ?? locationId

  // Raw Firestore docs may store locationId as slug ("vizag"),
  // firestoreDocId ("visakhapatnam"), or branchId ("0"). Push all three
  // variants into a single `where('locationId', 'in', variants)` query so
  // the server returns only this branch's rows instead of the full
  // collection — closing a previously-open leak where any user with read
  // access would receive every branch's bookings over the wire.
  const variants = branchLocationVariants(locationId)
  const snapshot = await getDocs(
    query(billingCollection, where('locationId', 'in', variants.slice(0, 10))),
  )

  const totals = { Cash: 0, Card: 0, UPI: 0, count: 0 }
  for (const item of snapshot.docs) {
    const data = item.data() as Record<string, unknown>

    // Filter: only completed payments
    if (String(data.paymentStatus ?? '') !== 'completed') continue

    // Filter: exclude cancelled bookings — both the legacy `cancelled:true`
    // flag (set by BillingModule "Cancel Transaction") and the newer
    // `bookingStatus:'cancelled'` (set by AllBookingsView "Cancel"). Without
    // this, deleted/cancelled bookings still inflate the cashier's expected
    // till totals at settlement time.
    if (data.cancelled === true) continue
    if (String(data.bookingStatus ?? '') === 'cancelled') continue
    // Filter: exclude soft-deleted (Trash) bookings. This loop reads raw
    // Firestore docs — it does NOT go through `mapTransactionRecord`, so
    // the deletedAt filter at the list-helper layer never reaches here.
    // Without this guard the cashier saw their till "expected" totals
    // inflated by trashed duplicates (5 × ₹1800 instead of ₹1800), and
    // shift-end checkout couldn't reconcile because the entered cash
    // never matched the system total.
    if (data.deletedAt) continue

    // Filter: POS-created transactions only. Online customer-app bookings
    // are paid via Razorpay directly to the company merchant — they never
    // touch the cashier's till, so including them inflates the "expected"
    // UPI total at shift settlement (Razorpay rolls into the UPI bucket
    // below) and blocks reconciliation. `sourceType === 'BILLING'` is
    // set explicitly by POS checkout; matches the canonical filter used
    // by BillingModule's transaction list. Previously hidden because
    // online writes used a different locationId slug form, but post-
    // 2026-05-11 normalization both forms now match the same query.
    if (String(data.sourceType ?? '') !== 'BILLING') continue

    // Filter: transaction date must match the requested day.
    // Fall back to createdAt for old bookings missing transactionDate.
    let txnDate = String(data.transactionDate ?? '')
    if (!txnDate) {
      const ca = data.createdAt
      if (ca && typeof ca === 'object' && 'toDate' in (ca as object)) {
        txnDate = (ca as { toDate: () => Date }).toDate().toISOString()
      } else if (ca) {
        txnDate = String(ca)
      }
    }
    if (!txnDate.startsWith(date)) continue

    // Filter: normalize raw locationId to slug, then match
    const rawLoc = String(data.locationId ?? '')
    const normalizedLoc = resolveLocation(rawLoc)?.slug ?? rawLoc
    if (normalizedLoc !== targetSlug) continue

    // Filter: must be after shift start time (if specified)
    if (shiftStartTime) {
      const createdAt = data.createdAt
      let createdIso: string
      if (createdAt && typeof createdAt === 'object' && 'toDate' in (createdAt as object)) {
        createdIso = (createdAt as { toDate: () => Date }).toDate().toISOString()
      } else {
        createdIso = String(createdAt ?? '')
      }
      if (createdIso < shiftStartTime) continue
    }

    const method = String(data.paymentMethod ?? '')
    const amount = toNumber(data.finalAmount, toNumber(data.totalAmount, 0))
    if (method === 'Split') {
      totals.Cash += toNumber(data.splitCash, 0)
      totals.UPI += toNumber(data.splitUpi, 0)
      totals.Card += toNumber(data.splitCard, 0)
    } else if (method === 'Cash' || method === 'Card' || method === 'UPI') {
      totals[method] += amount
    } else if (method === 'Razorpay') {
      totals.UPI += amount
    }

    // Refunds: subtract from the bucket of the original payment method
    // regardless of refund mode. A refunded sale is no longer revenue
    // for the day, so it shouldn't inflate the cashier's expected till.
    const refundAmount = toNumber(data.refundAmount, 0)
    if (refundAmount > 0) {
      if (method === 'Split') {
        const splitCash = toNumber(data.splitCash, 0)
        const splitUpi = toNumber(data.splitUpi, 0)
        const splitCard = toNumber(data.splitCard, 0)
        const splitTotal = splitCash + splitUpi + splitCard
        if (splitTotal > 0) {
          totals.Cash -= refundAmount * (splitCash / splitTotal)
          totals.UPI -= refundAmount * (splitUpi / splitTotal)
          totals.Card -= refundAmount * (splitCard / splitTotal)
        } else {
          totals.Cash -= refundAmount
        }
      } else if (method === 'Razorpay') {
        totals.UPI -= refundAmount
      } else if (method === 'Card' || method === 'UPI') {
        totals[method] -= refundAmount
      } else {
        totals.Cash -= refundAmount
      }
    }
    totals.count++
  }
  return totals
}

// ─── Create transaction ───────────────────────────────────────────────────────
export const createFirestoreBillingTransaction = async (
  token: string,
  payload: {
    customerName: string
    customerPhone: string
    customerEmail?: string
    leadId?: string
    items: Array<{
      itemName: string
      quantity: number
      unitPrice: number
      gameId?: string
      subGameId?: string
      variantId?: string
      vendorId?: string
      vendorBranchId?: string
      /**
       * Optional per-item override for vendor revenue-share %. When set, replaces
       * the value read from `vendorDetails.revenueShare` at sale time for this item only.
       * Used by event package items with `revenueShare: false` → pass 100 to route the
       * full gross to the third-party vendor.
       */
      vendorSharePercentOverride?: number
    }>
    discount?: number
    gstPercent?: number
    tax?: number
    paymentMethod: 'Cash' | 'Card' | 'UPI' | 'Razorpay' | 'Split'
    paymentStatus?: 'pending' | 'completed' | 'failed'
    splitCash?: number
    splitUpi?: number
    splitCard?: number
    locationId?: string
    vendorId?: string
    gameId?: string
    subGameId?: string
    variantId?: string
    couponCode?: string
    couponDiscount?: number
    transactionDate?: string
    visitDate?: string
    itemDiscounts?: number[]
  },
): Promise<TransactionRecord> => {
  const billingCollection = getBillingCollection()
  if (!billingCollection) throw new Error('Firestore billing is not configured.')

  const sessionUser = await getFirestoreSessionUser(token)
  const createdAt = nowIso()
  const transactionDate = payload.transactionDate || createdAt

  // ── Transaction-level totals (GST-inclusive pricing) ────────────────────────
  // Item prices already include GST. Subtotal is GST-inclusive.
  // After discount, we extract GST from the discounted total.
  const gstPercent = toNumber(payload.gstPercent, GST_PERCENT_DEFAULT)
  const subtotal = payload.items.reduce(
    (sum, item) => sum + Math.max(1, Math.floor(item.quantity)) * Math.max(0, item.unitPrice),
    0,
  )
  const discount = Math.max(0, toNumber(payload.discount))
  const totalAmount = Math.max(0, subtotal - discount)
  const baseAmount = Math.round((totalAmount * 100) / (100 + gstPercent))
  const gstAmount = totalAmount - baseAmount

  // ── Fetch vendor shares for all unique vendorIds in parallel (source of truth) ──
  const uniqueVendorIds = [
    ...new Set(payload.items.map((i) => i.vendorId).filter((v): v is string => Boolean(v))),
  ]
  const vendorConfigMap = new Map<string, { sharePercent: number; vendorType: VendorType }>()
  await Promise.all(
    uniqueVendorIds.map(async (vid) => {
      vendorConfigMap.set(vid, await getVendorBillingConfig(vid))
    }),
  )

  // ── Validate vendor-branch alignment (last-resort safety net) ──
  const txnBranch = resolveLocation(payload.locationId ?? '')?.branchId
  if (txnBranch) {
    for (const item of payload.items) {
      if (item.vendorId && item.vendorBranchId && item.vendorBranchId !== txnBranch) {
        logger.error('billing.cross_branch_vendor_stripped', undefined, {
          itemName: item.itemName,
          vendorId: item.vendorId,
          vendorBranchId: item.vendorBranchId,
          txnBranch,
        })
        vendorConfigMap.delete(item.vendorId)
        item.vendorId = undefined
        item.vendorBranchId = undefined
      }
    }
  }

  // primaryVendorId: first item with a vendorId (backward-compat Firestore query field)
  const primaryVendorId = payload.items.find((i) => i.vendorId)?.vendorId ?? undefined

  // ── Compute per-item splits ────────────────────────────────────────────────
  // Use the items type from TransactionRecord so both branches share one shape.
  type TxnItem = NonNullable<TransactionRecord['items']>[number]

  // Pre-compute per-item discounts, bases, and GSTs (GST-inclusive pricing).
  // Item prices include GST. After item-level discount, each item's discounted amount
  // is still GST-inclusive. We extract base and GST from each item's total.
  const payloadItemDiscounts = payload.itemDiscounts ?? []
  const itemSubtotals = payload.items.map(
    (item) => Math.max(1, Math.floor(item.quantity)) * Math.max(0, item.unitPrice),
  )
  const itemRawDiscounts = itemSubtotals.map((st, idx) => {
    const d = payloadItemDiscounts[idx] ?? 0
    return Math.min(Math.max(0, d), st) // clamp: 0 ≤ discount ≤ item subtotal
  })
  // Each item's GST-inclusive total after discount
  const itemTotals = itemSubtotals.map((st, idx) => Math.max(0, st - itemRawDiscounts[idx]))
  // Extract base from each item's inclusive total: base = round(total × 100 / 118)
  const itemRawBases = itemTotals.map((t) => Math.round((t * 100) / (100 + gstPercent)))
  // Residual correction: ensure sum(itemRawBases) === baseAmount
  if (itemRawBases.length > 0) {
    const baseSum = itemRawBases.reduce((s, a) => s + a, 0)
    itemRawBases[itemRawBases.length - 1] += baseAmount - baseSum
  }
  // GST per item = item total - item base
  const itemRawGsts = itemTotals.map((t, idx) => t - itemRawBases[idx])
  if (itemRawGsts.length > 0) {
    const gstSum = itemRawGsts.reduce((s, a) => s + a, 0)
    itemRawGsts[itemRawGsts.length - 1] += gstAmount - gstSum
  }

  const itemsWithSplits = payload.items.map((item, idx): TxnItem => {
    const itemDiscount = itemRawDiscounts[idx] ?? 0
    const itemBaseAmount = itemRawBases[idx] ?? 0
    const itemGstAmount = itemRawGsts[idx] ?? 0

    if (item.vendorId) {
      const config = vendorConfigMap.get(item.vendorId) ?? {
        sharePercent: VENDOR_SHARE_PERCENT_DEFAULT,
        vendorType: 'ThirdParty' as VendorType,
      }
      const effectiveShare =
        item.vendorSharePercentOverride != null
          ? Math.min(100, Math.max(0, item.vendorSharePercentOverride))
          : config.sharePercent
      const split = computeRevenueSplit(
        itemBaseAmount,
        itemGstAmount,
        effectiveShare,
        config.vendorType,
      )
      return {
        itemName: String(item.itemName ?? 'Item').trim() || 'Item',
        quantity: Math.max(1, Math.floor(item.quantity)),
        unitPrice: Math.max(0, item.unitPrice),
        gameId: item.gameId,
        subGameId: item.subGameId,
        variantId: item.variantId,
        vendorId: item.vendorId,
        itemDiscount: itemDiscount || undefined,
        itemBaseAmount,
        itemGstAmount,
        vendorSharePercent: effectiveShare,
        vendorBase: split.vendorBase,
        vendorGst: split.vendorGst,
        vendorTotal: split.vendorTotal,
        companyBase: split.companyBase,
        companyGst: split.companyGst,
        companyTotal: split.companyTotal,
      }
    }
    // Company-owned item: 100% to company
    return {
      itemName: String(item.itemName ?? 'Item').trim() || 'Item',
      quantity: Math.max(1, Math.floor(item.quantity)),
      unitPrice: Math.max(0, item.unitPrice),
      gameId: item.gameId,
      subGameId: item.subGameId,
      variantId: item.variantId,
      itemDiscount: itemDiscount || undefined,
      itemBaseAmount,
      itemGstAmount,
      vendorBase: 0,
      vendorGst: 0,
      vendorTotal: 0,
      companyBase: itemBaseAmount,
      companyGst: itemGstAmount,
      companyTotal: itemBaseAmount + itemGstAmount,
    }
  })

  // ── Assign daily serial numbers per game type ────────────────────────────
  const txnDate = (transactionDate ?? createdAt).slice(0, 10)
  const txnLocationId = payload.locationId ?? ''
  const invoiceNumber = generateInvoiceNumber()
  try {
    const serialStarts = await reserveSerialsForItems(
      txnLocationId,
      txnDate,
      itemsWithSplits,
      invoiceNumber,
    )
    for (let i = 0; i < itemsWithSplits.length; i++) {
      itemsWithSplits[i].serialStart = serialStarts[i]
    }
  } catch {
    /* non-critical — receipt prints without serials if counter fails */
  }

  // ── Aggregate item splits to transaction level ────────────────────────────
  const txnVendorBase = itemsWithSplits.reduce((s, i) => s + (i.vendorBase ?? 0), 0)
  const txnVendorGst = itemsWithSplits.reduce((s, i) => s + (i.vendorGst ?? 0), 0)
  const txnVendorTotal = txnVendorBase + txnVendorGst
  const txnCompanyBase = itemsWithSplits.reduce((s, i) => s + (i.companyBase ?? 0), 0)
  const txnCompanyGst = itemsWithSplits.reduce((s, i) => s + (i.companyGst ?? 0), 0)
  const txnCompanyTotal = txnCompanyBase + txnCompanyGst

  const nextId = `POS-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const nextRecord: TransactionRecord = {
    id: nextId,
    invoiceNumber,
    customerName: payload.customerName.trim() || 'Customer',
    customerPhone: payload.customerPhone.trim(),
    totalAmount,
    baseAmount,
    gstAmount,
    gstPercent,
    paymentMethod: payload.paymentMethod,
    ...(payload.paymentMethod === 'Split'
      ? {
          splitCash: payload.splitCash ?? 0,
          splitUpi: payload.splitUpi ?? 0,
          splitCard: payload.splitCard ?? 0,
        }
      : {}),
    refundStatus: 'None',
    transactionDate,
    visitDate: payload.visitDate || transactionDate,
    subtotal,
    tax: gstAmount,
    discount,
    source: 'POS',
    sourceType: 'BILLING',
    bookingStatus: 'confirmed',
    paymentStatus: payload.paymentStatus ?? 'completed',
    couponCode: payload.couponCode,
    couponDiscount: payload.couponDiscount,
    locationId: payload.locationId,
    vendorId: primaryVendorId,
    gameId: payload.gameId,
    subGameId: payload.subGameId,
    variantId: payload.variantId,
    // Transaction-level split = aggregated from all item splits
    vendorBase: txnVendorTotal > 0 ? txnVendorBase : undefined,
    vendorGst: txnVendorTotal > 0 ? txnVendorGst : undefined,
    vendorTotal: txnVendorTotal > 0 ? txnVendorTotal : undefined,
    companyBase: txnCompanyBase,
    companyGst: txnCompanyGst,
    companyTotal: txnCompanyTotal,
    createdBy: sessionUser.id,
    createdByName: sessionUser.name,
    createdAt,
    items: itemsWithSplits,
  }

  // Strip undefined at top level AND recursively strip item-level undefineds for Firestore
  const firestoreRecord = {
    ...stripUndefined(nextRecord as unknown as Record<string, unknown>),
    // Persist createdAt as a Firestore Timestamp so server-side range
    // queries (e.g. listAllBookings({ fromCreatedAt })) can filter POS
    // bookings alongside customer-app bookings without cross-type
    // ordering dropping either family.
    createdAt: Timestamp.fromDate(new Date(createdAt)),
    items: itemsWithSplits.map((item) =>
      stripUndefined(item as unknown as Record<string, unknown>),
    ),
    // Multi-vendor scope index. Top-level `vendorId` only holds the first
    // vendor on combo invoices; `vendorIds` mirrors every distinct vendor
    // on items so vendor-scoped reads can use `array-contains`.
    vendorIds: deriveVendorIds(itemsWithSplits),
  }
  // Hard-block the subtract-to-zero hack at the write boundary. Pattern:
  // finalAmount=0 + negative itemBaseAmount/itemGstAmount on items[] on
  // a non-cancelled, non-refunded booking. Closes the path that produced
  // ASG260411235153111CP7L and ASG260502190314957WKJS — both written via
  // this createBilling flow.
  assertNoZeroOutHack(firestoreRecord as unknown as Record<string, unknown>, 'createBilling')
  await setDoc(doc(billingCollection, nextId), firestoreRecord)

  // ── Write ledger entries — one per unique vendorId ────────────────────────
  const ledgerCollection = getLedgerCollection()
  if (ledgerCollection && uniqueVendorIds.length > 0) {
    // Aggregate per-vendor totals from item splits
    const ledgerByVendor = new Map<
      string,
      { vendorBase: number; vendorGst: number; vendorTotal: number }
    >()
    for (const item of itemsWithSplits) {
      if (!item.vendorId || !(item.vendorTotal ?? 0)) continue
      const acc = ledgerByVendor.get(item.vendorId) ?? {
        vendorBase: 0,
        vendorGst: 0,
        vendorTotal: 0,
      }
      acc.vendorBase += item.vendorBase ?? 0
      acc.vendorGst += item.vendorGst ?? 0
      acc.vendorTotal += item.vendorTotal ?? 0
      ledgerByVendor.set(item.vendorId, acc)
    }
    for (const [vid, totals] of ledgerByVendor.entries()) {
      if (totals.vendorTotal <= 0) continue
      const ledgerEntry: VendorLedgerEntry = {
        id: `le-${nextId}-${vid}`, // unique per vendor per transaction
        vendorId: vid,
        vendorBase: totals.vendorBase,
        vendorGst: totals.vendorGst,
        amount: totals.vendorTotal,
        type: 'credit',
        referenceId: nextId,
        invoiceNumber,
        locationId: payload.locationId,
        date: transactionDate,
        createdAt,
      }
      await setDoc(
        doc(ledgerCollection, ledgerEntry.id),
        stripUndefined(ledgerEntry as unknown as Record<string, unknown>),
      )
    }
  }

  // Debug assertion: log integrity warnings (non-blocking)
  const integrityErrors = validateTransactionIntegrity(nextRecord)
  if (integrityErrors.length > 0) {
    logger.warn('billing.transaction_integrity_warning', { transactionId: nextId, integrityErrors })
  }

  return nextRecord
}

// ─── Phone-based transaction search ─────────────────────────────────────────

import { normalizePhone } from '../features/leads/lead-utils'

/**
 * Fetches the last N refundable transactions for a given customer phone number.
 * Excludes fully-refunded, non-completed, and cancelled transactions.
 *
 * Uses the same client-side filtering pattern as the Transactions module
 * (loads all via listFirestoreBillingTransactions, filters in memory) to avoid
 * requiring a Firestore composite index on customerPhone + transactionDate.
 */
export const queryTransactionsByPhone = async (
  phone: string,
  maxResults = 50,
): Promise<TransactionRecord[]> => {
  const normalized = normalizePhone(phone)
  if (normalized.length < 10) return []

  const allTransactions = await listFirestoreBillingTransactions()

  // Also search raw Firestore docs — the mapped customerPhone may pick a
  // corrupted field (e.g. customerPhone with a typo) while the correct value
  // sits in userPhone/mobile/phone.  Fall back to a raw scan so refund
  // search is resilient to data-entry mistakes.
  const billingCollection = getBillingCollection()
  let rawPhoneDocIds: Set<string> | null = null

  const mapped = allTransactions.filter((txn) => {
    const storedPhone = normalizePhone(txn.customerPhone ?? '')
    if (storedPhone !== normalized) return false
    if (txn.refundStatus === 'Full') return false
    if (txn.paymentStatus !== 'completed') return false
    if (txn.cancelled) return false
    return true
  })

  if (mapped.length === 0 && billingCollection) {
    // Mapped phone didn't match — scan raw docs for phone in any field
    const rawSnap = await getDocs(billingCollection)
    rawPhoneDocIds = new Set<string>()
    for (const d of rawSnap.docs) {
      const data = d.data()
      const phoneCandidates = [data.customerPhone, data.userPhone, data.mobile, data.phone]
        .filter(Boolean)
        .map((v) => normalizePhone(String(v)))
      if (phoneCandidates.includes(normalized)) {
        rawPhoneDocIds.add(d.id)
      }
    }
  }

  if (rawPhoneDocIds && rawPhoneDocIds.size > 0) {
    return allTransactions
      .filter((txn) => {
        if (!rawPhoneDocIds!.has(txn.id)) return false
        if (txn.refundStatus === 'Full') return false
        if (txn.paymentStatus !== 'completed') return false
        if (txn.cancelled) return false
        return true
      })
      .slice(0, maxResults)
  }

  return mapped.slice(0, maxResults)
}

// ─── Item-level refund ──────────────────────────────────────────────────────

/**
 * Refunds specific items from a transaction. Marks items as refunded,
 * updates the transaction's cumulative refundAmount/refundStatus,
 * and creates vendor ledger debit entries for each item's vendor share.
 */
export const refundSelectedItems = async (
  transactionId: string,
  itemIndices: number[],
  reason: string,
): Promise<TransactionRecord> => {
  const billingCollection = getBillingCollection()
  if (!billingCollection) throw new Error('Firestore billing is not configured.')
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore is not configured.')

  // Read-modify-write of the transaction document (refundAmount, items array,
  // refundStatus) inside an atomic Firestore transaction. Without this, two
  // partial refunds approved in the same second would each read the same
  // existing.refundAmount, compute identical totalRefund values, and the
  // second updateDoc would silently overwrite the first instead of stacking;
  // the items array marks would also collide. CLAUDE.md mandates
  // runTransaction for all money-affecting writes.
  const fetchExisting = await getFirestoreBillingTransactionById(transactionId)
  if (!fetchExisting) throw new Error('Transaction not found.')

  const txnDocRef = doc(billingCollection, transactionId)

  const result = await runTransaction(firestore, async (txn) => {
    const snap = await txn.get(txnDocRef)
    if (!snap.exists()) throw new Error('Transaction not found.')
    const data = snap.data() as Record<string, unknown>

    if (data.refundStatus === 'Full') throw new Error('Transaction is already fully refunded.')

    const items = Array.isArray(data.items)
      ? (data.items as NonNullable<TransactionRecord['items']>)
      : []
    if (items.length === 0) throw new Error('Transaction has no items to refund.')

    // Validate item indices and calculate refund amount on FRESH data.
    let newRefundAmount = 0
    const updatedItems = [...items]
    const refundedVendors = new Map<
      string,
      { vendorBase: number; vendorGst: number; vendorTotal: number }
    >()

    for (const idx of itemIndices) {
      if (idx < 0 || idx >= updatedItems.length) throw new Error(`Invalid item index: ${idx}`)
      const item = updatedItems[idx]
      if (item.refunded) throw new Error(`Item "${item.itemName}" has already been refunded.`)

      const itemTotal =
        (item.itemBaseAmount ?? item.unitPrice * item.quantity) + (item.itemGstAmount ?? 0)
      newRefundAmount += itemTotal

      updatedItems[idx] = { ...item, refunded: true }

      if (item.vendorId && (item.vendorTotal ?? 0) > 0) {
        const acc = refundedVendors.get(item.vendorId) ?? {
          vendorBase: 0,
          vendorGst: 0,
          vendorTotal: 0,
        }
        acc.vendorBase += item.vendorBase ?? 0
        acc.vendorGst += item.vendorGst ?? 0
        acc.vendorTotal += item.vendorTotal ?? 0
        refundedVendors.set(item.vendorId, acc)
      }
    }

    const existingRefund = Number(data.refundAmount ?? 0)
    const totalAmount = Number(data.totalAmount ?? fetchExisting.totalAmount ?? 0)
    const totalRefund = existingRefund + newRefundAmount
    const allItemsRefunded = updatedItems.every((item) => item.refunded)
    const refundStatus: TransactionRecord['refundStatus'] =
      allItemsRefunded || totalRefund >= totalAmount ? 'Full' : 'Partial'

    const cleanItems = updatedItems.map((item) =>
      stripUndefined(item as unknown as Record<string, unknown>),
    )
    txn.update(txnDocRef, {
      refundAmount: totalRefund,
      refundStatus,
      refundReason: reason.trim(),
      items: cleanItems,
      updatedAt: nowIso(),
    })

    return { updatedItems, totalRefund, refundStatus, refundedVendors, newRefundAmount }
  })

  const { updatedItems, totalRefund, refundStatus, refundedVendors, newRefundAmount } = result
  const existing = fetchExisting

  // Create vendor ledger debit entries for refunded items.
  // If items lack vendorId/vendorTotal (older booking format), fall back to
  // existing ledger credit entries for this transaction and debit proportionally.
  const ledgerCollection = getLedgerCollection()
  if (ledgerCollection) {
    try {
      const timestamp = Date.now()

      // Fallback: derive vendor debits from existing ledger credits when items
      // don't carry vendor attribution fields.
      if (refundedVendors.size === 0 && newRefundAmount > 0) {
        const existingCredits = await getDocs(
          query(
            ledgerCollection,
            where('referenceId', '==', transactionId),
            where('type', '==', 'credit'),
          ),
        )
        const refundRatio = newRefundAmount / existing.totalAmount
        existingCredits.forEach((d) => {
          const data = d.data() as Record<string, unknown>
          const vid = String(data.vendorId ?? '')
          if (!vid) return
          const vendorBase = Math.round(Number(data.vendorBase ?? 0) * refundRatio)
          const vendorGst = Math.round(Number(data.vendorGst ?? 0) * refundRatio)
          const vendorTotal = Math.round(Number(data.amount ?? 0) * refundRatio)
          if (vendorTotal <= 0) return
          const acc = refundedVendors.get(vid) ?? { vendorBase: 0, vendorGst: 0, vendorTotal: 0 }
          acc.vendorBase += vendorBase
          acc.vendorGst += vendorGst
          acc.vendorTotal += vendorTotal
          refundedVendors.set(vid, acc)
        })
      }

      for (const [vid, totals] of refundedVendors) {
        if (totals.vendorTotal <= 0) continue
        const ledgerId = `le-refund-${transactionId}-${vid}-${timestamp}`
        await setDoc(doc(ledgerCollection, ledgerId), {
          id: ledgerId,
          vendorId: vid,
          vendorBase: totals.vendorBase,
          vendorGst: totals.vendorGst,
          amount: totals.vendorTotal,
          type: 'debit',
          referenceId: transactionId,
          invoiceNumber: existing.invoiceNumber,
          locationId: existing.locationId,
          date: existing.transactionDate,
          createdAt: nowIso(),
          source: 'refund' as const,
        })
      }
    } catch (err) {
      logger.error('billing.vendor_ledger_debit_failed', err, { transactionId })
    }
  }

  // Reverse any active cashier incentives accrued from this booking — fire-
  // and-forget. Previously dead code; bug-finder swarm 2026-05-13 found that
  // refunds were leaving cashierIncentives.status='active', inflating payouts.
  reverseCashierIncentives(transactionId, `Refund: ${reason}`).catch((err) =>
    logger.error('billing.reverse_incentives_failed', err, { transactionId, kind: 'refund' }),
  )

  return { ...existing, items: updatedItems, refundAmount: totalRefund, refundStatus }
}

// ─── Wallet credit for refund ───────────────────────────────────────────────

/**
 * Credits the customer's wallet with the refund amount.
 * Finds the user by phone number, then atomically updates their wallet balance.
 * Per CLAUDE.md: wallet balance changes MUST use Firestore transactions (atomic).
 */
export const creditCustomerWallet = async (
  phone: string,
  amount: number,
  description: string,
): Promise<{ userId: string; newBalance: number }> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured.')
  if (amount <= 0) throw new Error('Refund amount must be positive.')

  const normalized = normalizePhone(phone)
  const variants = [normalized, `+91${normalized}`, `91${normalized}`]

  // Find the customer's canonical uid. Route through `phoneToUid/{phone}` first
  // — that index is the single source of truth maintained by the dedup script
  // and by the client-side `resolveOrCreateUserDoc` helper. Falling straight
  // back to a `users.phone == X` field scan (as this code used to do) is how
  // ₹750 once landed in the staff account `samar`: Firestore's `limit(1)` has
  // no ordering guarantee, so whichever doc happened to index first won,
  // regardless of whether it was a customer or an admin whose profile also
  // carried the same phone number. We keep the field scan as a safety net for
  // phones that haven't been indexed yet, but explicitly skip any doc with a
  // `role` field so a staff account can never be credited again.
  let userId: string | null = null
  try {
    const indexSnap = await getDoc(doc(firestore, 'phoneToUid', normalized))
    if (indexSnap.exists()) {
      const mapped = (indexSnap.data() as Record<string, unknown>).uid
      if (typeof mapped === 'string' && mapped.length > 0) userId = mapped
    }
  } catch {
    /* fall through to field scan */
  }

  if (!userId) {
    for (const variant of variants) {
      if (userId) break
      try {
        const q = query(collection(firestore, 'users'), where('phone', '==', variant))
        const snap = await getDocs(q)
        for (const candidate of snap.docs) {
          const data = candidate.data() as Record<string, unknown>
          // Skip staff docs — refunds must never credit a staff wallet.
          if (data.role) continue
          userId = candidate.id
          break
        }
      } catch {
        /* try next variant */
      }
    }
  }

  if (!userId)
    throw new Error('Customer account not found for this phone number. Wallet credit skipped.')

  // Atomic wallet update.
  //
  // Writes the subcollection balance, the audit tx log, AND the root mirror
  // `users/{id}.walletBalance` in a single transaction so the admin view
  // (which reads the root field) stays in lock-step with the customer app
  // (which reads the subcollection). The root mirror was previously never
  // touched from this path and drifted silently over the life of the app.
  const walletRef = doc(firestore, 'users', userId, 'wallet', 'data')
  const rootUserRef = doc(firestore, 'users', userId)
  const newBalance = await runTransaction(firestore, async (txn) => {
    const walletSnap = await txn.get(walletRef)
    const currentBalance = walletSnap.exists()
      ? toNumber((walletSnap.data() as Record<string, unknown>).balance)
      : 0
    const updatedBalance = currentBalance + amount
    txn.set(walletRef, { balance: updatedBalance, lastUpdated: serverTimestamp() }, { merge: true })
    txn.set(rootUserRef, { walletBalance: updatedBalance }, { merge: true })

    // Log wallet transaction.
    // Using auto-ID — two refunds in the same millisecond used to collide on
    // `String(Date.now())` and silently overwrite each other, making the abuse
    // detector blind to the second entry. Firestore auto-IDs are collision-safe.
    const logRef = doc(collection(firestore, 'users', userId!, 'wallet_transactions'))
    txn.set(logRef, {
      type: 'credit',
      amount,
      description,
      timestamp: serverTimestamp(),
    })

    return updatedBalance
  })

  // ── Sync legacy `members/{phone}` collection (non-blocking) ───────────
  //
  // The root-level `users/{id}.walletBalance` mirror is already written
  // atomically inside the runTransaction above; that's the field the
  // pipeline admin's parseMemberFromUser now reads for members sourced from
  // the users collection. But when the admin is in `source === 'members'`
  // mode (determined dynamically by asquare-members.ts:determineMemberSource
  // based on whether the legacy `members` collection is non-empty), reads
  // go directly to `members/{phone}.walletBalance`. Keep this mirror write
  // alive so the members tab stays consistent for legacy member records.
  //
  // The previous `users.memberData.memberWalletBalance` nested write that
  // lived here was removed in the legacy-cleanup pass — nothing reads that
  // nested field anymore (parseMemberFromUser reads the root walletBalance
  // instead).
  try {
    const membersCol = collection(firestore, 'members')
    const candidateIds = [normalized, `+91${normalized}`, `91${normalized}`]
    for (const candidateId of candidateIds) {
      const memberSnap = await getDoc(doc(membersCol, candidateId))
      if (memberSnap.exists()) {
        // Use atomic increment instead of read-then-write to prevent
        // last-write-wins corruption under concurrent refunds.
        await setDoc(
          doc(membersCol, candidateId),
          { walletBalance: increment(amount) },
          { merge: true },
        )
        break
      }
    }
  } catch {
    // Non-critical — primary wallet already credited
  }

  return { userId, newBalance }
}

// ─── Wallet debit for POS redemption ─────────────────────────────────────────

/**
 * Debits the customer's wallet as part of a POS billing transaction, used
 * when the cashier ticks the "Redeem wallet balance" checkbox. Mirror of
 * `creditCustomerWallet` above: resolves the customer uid via the
 * phoneToUid index first (skipping staff docs), then atomically updates
 * `users/{id}/wallet/data.balance`, the root `users/{id}.walletBalance`
 * mirror, and writes a debit entry to `users/{id}/wallet_transactions`
 * so the redemption is auditable and refund-reversible. Throws if the
 * customer doesn't exist or the wallet has insufficient balance.
 */
export const deductCustomerWallet = async (
  phone: string,
  amount: number,
  description: string,
  relatedBookingId?: string,
): Promise<{ userId: string; newBalance: number }> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured.')
  if (amount <= 0) throw new Error('Redeem amount must be positive.')

  const normalized = normalizePhone(phone)
  const variants = [normalized, `+91${normalized}`, `91${normalized}`]

  // Resolve canonical uid — same phoneToUid-first pattern as creditCustomerWallet.
  let userId: string | null = null
  try {
    const indexSnap = await getDoc(doc(firestore, 'phoneToUid', normalized))
    if (indexSnap.exists()) {
      const mapped = (indexSnap.data() as Record<string, unknown>).uid
      if (typeof mapped === 'string' && mapped.length > 0) userId = mapped
    }
  } catch {
    /* fall through */
  }

  if (!userId) {
    for (const variant of variants) {
      if (userId) break
      try {
        const q = query(collection(firestore, 'users'), where('phone', '==', variant))
        const snap = await getDocs(q)
        for (const candidate of snap.docs) {
          const data = candidate.data() as Record<string, unknown>
          if (data.role) continue // never debit a staff wallet
          userId = candidate.id
          break
        }
      } catch {
        /* try next */
      }
    }
  }

  if (!userId)
    throw new Error('Customer account not found for this phone number. Wallet redemption skipped.')

  const walletRef = doc(firestore, 'users', userId, 'wallet', 'data')
  const rootUserRef = doc(firestore, 'users', userId)

  const newBalance = await runTransaction(firestore, async (txn) => {
    const walletSnap = await txn.get(walletRef)
    const currentBalance = walletSnap.exists()
      ? toNumber((walletSnap.data() as Record<string, unknown>).balance)
      : 0
    if (currentBalance < amount) {
      throw new Error(
        `Insufficient wallet balance. Have ₹${currentBalance}, tried to redeem ₹${amount}.`,
      )
    }
    const updatedBalance = currentBalance - amount

    txn.set(walletRef, { balance: updatedBalance, lastUpdated: serverTimestamp() }, { merge: true })
    txn.set(rootUserRef, { walletBalance: updatedBalance }, { merge: true })

    // Auto-ID — matches the credit path above. Two debits in the same
    // millisecond would collide on String(Date.now()) and silently overwrite
    // each other, blinding the abuse detector and refund-reversal logic.
    const logRef = doc(collection(firestore, 'users', userId!, 'wallet_transactions'))
    txn.set(logRef, {
      type: 'debit',
      amount: -amount,
      description,
      booking: relatedBookingId ?? null,
      timestamp: serverTimestamp(),
    })

    return updatedBalance
  })

  return { userId, newBalance }
}

// ─── Reschedule (change visit date) ──────────────────────────────────────────
export const rescheduleFirestoreBillingTransaction = async (
  token: string,
  transactionId: string,
  newVisitDate: string,
): Promise<TransactionRecord> => {
  const billingCollection = getBillingCollection()
  if (!billingCollection) throw new Error('Firestore billing is not configured.')

  const sessionUser = await getFirestoreSessionUser(token)
  const existing = await getFirestoreBillingTransactionById(transactionId)

  if (existing.refundStatus === 'Full') {
    throw new Error('Cannot reschedule a fully refunded transaction.')
  }

  const originalVisitDate =
    existing.originalVisitDate || existing.visitDate || existing.transactionDate

  await updateDoc(doc(billingCollection, transactionId), {
    visitDate: newVisitDate,
    originalVisitDate: originalVisitDate,
    rescheduledAt: nowIso(),
    rescheduledBy: sessionUser.id,
    rescheduledByName: sessionUser.name,
    updatedAt: nowIso(),
  })

  return {
    ...existing,
    visitDate: newVisitDate,
    originalVisitDate,
    rescheduledAt: nowIso(),
    rescheduledBy: sessionUser.id,
    rescheduledByName: sessionUser.name,
  }
}

// ─── Cancel (soft-delete with reverse ledger) ────────────────────────────────
export const cancelFirestoreBillingTransaction = async (
  transactionId: string,
  payload: { reason: string; cancelledBy: string; cancelledByName: string },
): Promise<TransactionRecord> => {
  const billingCollection = getBillingCollection()
  if (!billingCollection) throw new Error('Firestore billing is not configured.')

  const existing = await getFirestoreBillingTransactionById(transactionId)
  if (existing.cancelled) throw new Error('Transaction is already cancelled.')
  if (existing.refundStatus === 'Full')
    throw new Error('Cannot cancel a fully refunded transaction.')

  await updateDoc(doc(billingCollection, transactionId), {
    cancelled: true,
    cancelledAt: nowIso(),
    cancelledBy: payload.cancelledBy,
    cancelledByName: payload.cancelledByName,
    cancellationReason: payload.reason.trim(),
    updatedAt: nowIso(),
  })

  // Delete all vendor ledger entries for this transaction (credits, refund debits, cancel debits)
  const ledgerCollection = getLedgerCollection()
  if (ledgerCollection) {
    try {
      const vendorIds = new Set<string>()
      if (existing.items) {
        for (const i of existing.items) {
          if (i.vendorId) vendorIds.add(i.vendorId)
        }
      }
      if (existing.vendorId) vendorIds.add(existing.vendorId)

      const deletePromises: Promise<unknown>[] = []
      for (const vid of vendorIds) {
        deletePromises.push(
          deleteDoc(doc(ledgerCollection, `le-${transactionId}-${vid}`)).catch((err) =>
            logger.error('billing.ledger_delete_failed', err, {
              transactionId,
              vid,
              kind: 'le',
            }),
          ),
        )
        deletePromises.push(
          deleteDoc(doc(ledgerCollection, `le-refund-${transactionId}-${vid}`)).catch((err) =>
            logger.error('billing.ledger_delete_failed', err, {
              transactionId,
              vid,
              kind: 'le-refund',
            }),
          ),
        )
        deletePromises.push(
          deleteDoc(doc(ledgerCollection, `le-cancel-${transactionId}-${vid}`)).catch(
            () => undefined,
          ),
        )
      }
      await Promise.allSettled(deletePromises)

      // Fallback: query for any remaining ledger entries referencing this transaction
      const orphanQuery = query(ledgerCollection, where('referenceId', '==', transactionId))
      const orphaned = await getDocs(orphanQuery)
      if (!orphaned.empty) {
        await Promise.allSettled(orphaned.docs.map((d) => deleteDoc(d.ref)))
      }
    } catch (ledgerErr) {
      logger.error('billing.delete_vendor_ledger_failed', ledgerErr, { transactionId })
    }
  }

  // Helicopter early-bird decrement (fire-and-forget). Pre-fix only the
  // delete-booking Cloud Function did this — the POS Cancel path left
  // the counter inflated so early-bird "sold out" appeared earlier than
  // real ticket sales. Idempotent (refuses to double-decrement via
  // the `helicopterCountDecremented` marker on the booking).
  decrementHelicopterCountForCancellation(
    transactionId,
    existing as unknown as Record<string, unknown>,
  ).catch((err) =>
    logger.error('billing.cancel_helicopter_decrement_failed', err, { transactionId }),
  )

  // Reverse any active cashier incentives accrued from this booking — fire-
  // and-forget. Previously dead code; bug-finder swarm 2026-05-13 found that
  // cancellations were leaving cashierIncentives.status='active', inflating payouts.
  reverseCashierIncentives(transactionId, `Cancelled: ${payload.reason.trim()}`).catch((err) =>
    logger.error('billing.reverse_incentives_failed', err, { transactionId, kind: 'cancel' }),
  )

  return {
    ...existing,
    cancelled: true,
    cancelledAt: nowIso(),
    cancelledBy: payload.cancelledBy,
    cancelledByName: payload.cancelledByName,
    cancellationReason: payload.reason.trim(),
  }
}

// ─── Transaction integrity validation ─────────────────────────────────────────
export const validateTransactionIntegrity = (txn: TransactionRecord): string[] => {
  const errors: string[] = []
  if (txn.vendorTotal !== undefined && txn.companyTotal !== undefined) {
    const sum = (txn.vendorTotal ?? 0) + (txn.companyTotal ?? 0)
    if (Math.abs(sum - txn.totalAmount) > 1) {
      errors.push(`vendor+company (${sum}) !== total (${txn.totalAmount})`)
    }
  }
  if (txn.baseAmount !== undefined && txn.gstAmount !== undefined) {
    if (Math.abs(txn.baseAmount + txn.gstAmount - txn.totalAmount) > 1) {
      errors.push(`base+gst !== total`)
    }
  }
  return errors
}

// ─── Filtered transactions helper ────────────────────────────────────────────
export const listFilteredBillingTransactions = async (queryFilter?: {
  from?: string
  to?: string
}): Promise<TransactionRecord[]> => {
  const transactions = await listFirestoreBillingTransactions()
  return transactions.filter((item) => {
    // Canonical "is this booking alive?" check — covers `cancelled === true`,
    // `bookingStatus === 'cancelled'`, `deletedAt`, and `voidedAt` in one
    // place. Previously each of these was checked separately (and the
    // `deletedAt` + `voidedAt` arms were missing here entirely), which
    // contributed to the recurring vendor-ledger-vs-settlements drift.
    if (isTerminatedBooking(item)) return false
    if (item.paymentStatus === 'pending' || item.paymentStatus === 'failed') return false
    const parsed = new Date(item.transactionDate)
    if (isNaN(parsed.getTime())) {
      logger.warn('billing.skip_invalid_date', {
        id: item.id,
        transactionDate: item.transactionDate,
      })
      return false
    }
    const txnDate = toISTDateStr(parsed)
    if (!txnDate) return false
    if (queryFilter?.from && txnDate < queryFilter.from) return false
    if (queryFilter?.to && txnDate > queryFilter.to) return false
    return true
  })
}

// ─── Revenue summary ──────────────────────────────────────────────────────────
export const summarizeFirestoreBillingRevenue = async (queryFilter?: {
  from?: string
  to?: string
}): Promise<{
  totalRevenue: number
  totalTransactions: number
  averageTransactionValue: number
  paymentMethodBreakdown: Record<string, number>
  refundsCount: number
  refundsValue: number
}> => {
  const filtered = await listFilteredBillingTransactions(queryFilter)

  const totalRevenue = filtered.reduce((sum, item) => sum + item.totalAmount, 0)
  const refundsValue = filtered.reduce((sum, item) => sum + (item.refundAmount ?? 0), 0)
  const paymentMethodBreakdown = filtered.reduce<Record<string, number>>((acc, item) => {
    if (item.paymentMethod === 'Split') {
      if (item.splitCash) acc.Cash = (acc.Cash ?? 0) + item.splitCash
      if (item.splitUpi) acc.UPI = (acc.UPI ?? 0) + item.splitUpi
      if (item.splitCard) acc.Card = (acc.Card ?? 0) + item.splitCard
    } else {
      acc[item.paymentMethod] = (acc[item.paymentMethod] ?? 0) + item.totalAmount
    }
    return acc
  }, {})

  return {
    totalRevenue,
    totalTransactions: filtered.length,
    averageTransactionValue: filtered.length > 0 ? totalRevenue / filtered.length : 0,
    paymentMethodBreakdown,
    refundsCount: filtered.filter((item) => item.refundStatus !== 'None').length,
    refundsValue,
  }
}

// ─── Update payment status ───────────────────────────────────────────────────
export const updateFirestoreTransactionPaymentStatus = async (
  transactionId: string,
  updates: { paymentStatus: 'pending' | 'completed' | 'failed'; paymentReference?: string },
): Promise<void> => {
  const billingCollection = getBillingCollection()
  if (!billingCollection) throw new Error('Firestore billing is not configured.')
  await updateDoc(doc(billingCollection, transactionId), {
    paymentStatus: updates.paymentStatus,
    ...(updates.paymentReference ? { paymentReference: updates.paymentReference } : {}),
    updatedAt: nowIso(),
  })
}

// ─── Backfill historical records ──────────────────────────────────────────────
/**
 * Reads all existing billing transactions and patches any that are missing the
 * new structured split fields (vendorBase/vendorGst/vendorTotal etc.).
 *
 * Safe: only writes when fields are absent; skips fully-formed records.
 * Returns { patched, skipped } counts.
 */
export const backfillFirestoreTransactions = async (): Promise<{
  patched: number
  skipped: number
}> => {
  const billingCollection = getBillingCollection()
  if (!billingCollection) throw new Error('Firestore billing is not configured.')

  const snapshot = await getDocs(
    query(billingCollection, orderBy('transactionDate', 'desc'), limit(1000)),
  )
  let patched = 0
  let skipped = 0

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as Record<string, unknown>

    // Already fully patched — has new fields
    if (data.vendorBase !== undefined && data.companyTotal !== undefined) {
      skipped++
      continue
    }

    const baseAmount = toNumber(data.baseAmount ?? data.subtotal)
    const gstAmount = toNumber(data.gstAmount ?? data.tax)
    const totalAmount = toNumber(data.totalAmount)
    const vendorId = toOptionalString(data.vendorId)
    const vendorSharePercent = toNumber(data.vendorSharePercent, VENDOR_SHARE_PERCENT_DEFAULT)

    // Derive gstPercent if missing
    const gstPercent =
      data.gstPercent !== undefined
        ? toNumber(data.gstPercent)
        : baseAmount > 0
          ? Math.round((gstAmount / baseAmount) * 100)
          : GST_PERCENT_DEFAULT

    // Correct baseAmount/gstAmount if they weren't stored properly
    const correctedBase = baseAmount || Math.round(totalAmount / (1 + gstPercent / 100))
    const correctedGst = gstAmount || totalAmount - correctedBase

    const patch: Record<string, unknown> = {
      baseAmount: correctedBase,
      gstAmount: correctedGst,
      gstPercent,
      // Always recalculate to ensure consistency
      companyBase: correctedBase,
      companyGst: correctedGst,
      companyTotal: totalAmount,
    }

    if (vendorId) {
      const split = computeRevenueSplit(correctedBase, correctedGst, vendorSharePercent)
      patch.vendorBase = split.vendorBase
      patch.vendorGst = split.vendorGst
      patch.vendorTotal = split.vendorTotal
      patch.companyBase = split.companyBase
      patch.companyGst = split.companyGst
      patch.companyTotal = split.companyTotal
    }

    await updateDoc(doc(billingCollection, docSnap.id), patch as UpdateData<DocumentData>)
    patched++
  }

  return { patched, skipped }
}

// ─── Helicopter Activities (Firestore-backed) ────────────────────────────────
const HELICOPTER_ACTIVITIES_COLLECTION = 'helicopterActivities'
const HELICOPTER_PAYMENTS_COLLECTION = 'helicopterPayments'

const getHelicopterActivitiesCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, HELICOPTER_ACTIVITIES_COLLECTION)
}

const getHelicopterPaymentsCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, HELICOPTER_PAYMENTS_COLLECTION)
}

const generateHelicopterId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const listFirestoreHelicopterActivities = async (
  includeInactive: boolean,
): Promise<HelicopterActivityRecord[]> => {
  const col = getHelicopterActivitiesCollection()
  if (!col) return []

  const constraints = includeInactive
    ? [orderBy('createdAt', 'desc')]
    : [where('status', '==', 'Active'), orderBy('createdAt', 'desc')]

  const snapshot = await getDocs(query(col, ...constraints))
  return snapshot.docs.map((d) => {
    const data = d.data() as Record<string, unknown>
    return {
      id: d.id,
      name: String(data.name ?? ''),
      amount: Number(data.amount ?? 0),
      status: (data.status === 'Inactive' ? 'Inactive' : 'Active') as 'Active' | 'Inactive',
      createdAt: String(data.createdAt ?? ''),
      updatedAt: String(data.updatedAt ?? ''),
    }
  })
}

export const createFirestoreHelicopterActivity = async (payload: {
  name: string
  amount: number
  status?: 'Active' | 'Inactive'
}): Promise<HelicopterActivityRecord> => {
  const col = getHelicopterActivitiesCollection()
  if (!col) throw new Error('Firestore is not configured.')

  const id = generateHelicopterId('heli')
  const now = nowIso()
  const record: HelicopterActivityRecord = {
    id,
    name: payload.name.trim(),
    amount: Math.max(0, payload.amount),
    status: payload.status ?? 'Active',
    createdAt: now,
    updatedAt: now,
  }

  await setDoc(doc(col, id), record)
  return record
}

export const updateFirestoreHelicopterActivity = async (
  activityId: string,
  payload: Partial<{ name: string; amount: number; status: 'Active' | 'Inactive' }>,
): Promise<HelicopterActivityRecord> => {
  const col = getHelicopterActivitiesCollection()
  if (!col) throw new Error('Firestore is not configured.')

  const ref = doc(col, activityId)
  const snapshot = await getDoc(ref)
  if (!snapshot.exists()) throw new Error('Helicopter activity not found.')

  const existing = snapshot.data() as Record<string, unknown>
  const updates: { [key: string]: string | number } = { updatedAt: nowIso() }
  if (payload.name !== undefined) updates.name = payload.name.trim()
  if (payload.amount !== undefined) updates.amount = Math.max(0, payload.amount)
  if (payload.status !== undefined) updates.status = payload.status

  await updateDoc(ref, updates)

  return {
    id: activityId,
    name: String(updates.name ?? existing.name ?? ''),
    amount: Number(updates.amount ?? existing.amount ?? 0),
    status: (updates.status ?? existing.status ?? 'Active') as 'Active' | 'Inactive',
    createdAt: String(existing.createdAt ?? ''),
    updatedAt: String(updates.updatedAt),
  }
}

// ─── Helicopter Payments (Firestore-backed) ──────────────────────────────────
export const listFirestoreHelicopterPayments = async (queryOpts?: {
  limit?: number
}): Promise<HelicopterPaymentRecord[]> => {
  const col = getHelicopterPaymentsCollection()
  if (!col) return []

  const max = Math.min(Math.max(queryOpts?.limit ?? 100, 1), 500)
  const snapshot = await getDocs(query(col, orderBy('createdAt', 'desc'), limit(max)))

  return snapshot.docs.map((d) => {
    const data = d.data() as Record<string, unknown>
    return {
      id: d.id,
      customerName: String(data.customerName ?? ''),
      phone: String(data.phone ?? ''),
      activityId: String(data.activityId ?? ''),
      activityName: String(data.activityName ?? ''),
      baseAmount: Number(data.baseAmount ?? 0),
      discountPercentage: Number(data.discountPercentage ?? 0),
      finalAmount: Number(data.finalAmount ?? 0),
      status: (data.status ?? 'Sent') as HelicopterPaymentRecord['status'],
      sentBy: String(data.sentBy ?? ''),
      createdAt: String(data.createdAt ?? ''),
      updatedAt: String(data.updatedAt ?? ''),
    }
  })
}

export const createFirestoreHelicopterPayment = async (
  token: string,
  payload: { customerName: string; phone: string; activityId: string; discountPercentage?: number },
): Promise<HelicopterPaymentRecord> => {
  const col = getHelicopterPaymentsCollection()
  if (!col) throw new Error('Firestore is not configured.')

  // Look up the activity to get name and amount
  const actCol = getHelicopterActivitiesCollection()
  if (!actCol) throw new Error('Firestore is not configured.')

  const actSnap = await getDoc(doc(actCol, payload.activityId))
  if (!actSnap.exists()) throw new Error('Helicopter activity not found.')
  const actData = actSnap.data() as Record<string, unknown>

  const baseAmount = Number(actData.amount ?? 0)
  const discount = Math.max(0, Math.min(100, payload.discountPercentage ?? 0))
  const finalAmount = Math.round(baseAmount * (1 - discount / 100))

  const session = await getFirestoreSessionUser(token)

  const id = generateHelicopterId('pay')
  const now = nowIso()
  const record: HelicopterPaymentRecord = {
    id,
    customerName: payload.customerName.trim(),
    phone: payload.phone.trim(),
    activityId: payload.activityId,
    activityName: String(actData.name ?? ''),
    baseAmount,
    discountPercentage: discount,
    finalAmount,
    status: 'Sent',
    sentBy: session.name,
    createdAt: now,
    updatedAt: now,
  }

  await setDoc(doc(col, id), record)
  return record
}
