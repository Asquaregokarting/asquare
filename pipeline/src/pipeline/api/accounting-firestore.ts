/**
 * Accounting Firestore module.
 *
 * Reads from:
 *   - billingTransactions  (written by billing-firestore.ts)
 *   - vendorLedger         (written by billing-firestore.ts on each transaction)
 *
 * Writes to:
 *   - vendorInvoices       (weekly, Saturday–Friday, per vendor)
 *   - companyInvoices      (weekly, Saturday–Friday, aggregate)
 *
 * Revenue logic:
 *   - Vendor transactions  → vendorTotal = vendorBase + vendorGst (split on baseAmount only)
 *   - Company-owned games  → companyTotal = full totalAmount (no vendorId)
 *   - Company share from vendor games → companyTotal field on transaction
 *
 * This module does NOT modify Activities or Bookings.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { nowIso, stripUndefined } from './firestore-utils'
import { mapTransactionRecord } from './billing-firestore'
import {
  CompanyInvoice,
  InvoiceAuditLogRecord,
  TransactionRecord,
  VendorInvoice,
  VendorLedgerEntry,
  VendorType,
} from './types'
import { resolveLocation } from '../../lib/locations'
import { isTerminatedBooking } from '../../lib/booking-filter'
import { toISTDateStr } from '../lib/ist-date'

const VENDOR_LEDGER_COLLECTION = 'vendorLedger'
const VENDOR_INVOICES_COLLECTION = 'vendorInvoices'
const COMPANY_INVOICES_COLLECTION = 'companyInvoices'
const BILLING_TRANSACTIONS_COLLECTION = 'bookings'
const INVOICE_AUDIT_LOGS_COLLECTION = 'invoiceAuditLogs'

const toNumber = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}
const getFs = () => initializeFirestore()

/** Normalize any location identifier (branchId, slug, displayName, firestoreDocId) to its canonical slug. */
const normalizeLocationId = (raw: string): string => resolveLocation(raw)?.slug ?? raw

// ─── Week boundary helpers (Saturday–Friday) ────────────────────────────────

/** Format year/month/day numbers as YYYY-MM-DD. Used for date arithmetic results. */
const fmtYMD = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const getPeriodStart = (date: Date = new Date()): string => {
  const safeDate = !date || isNaN(date.getTime()) ? new Date() : date
  // Determine today's date in IST (not browser-local or UTC)
  const istStr = toISTDateStr(safeDate)
  const [y, m, d] = istStr.split('-').map(Number)
  const dayOfWeek = new Date(y, m - 1, d).getDay() // 0=Sun…6=Sat
  const diff = dayOfWeek >= 6 ? 0 : dayOfWeek + 1
  return fmtYMD(new Date(y, m - 1, d - diff))
}

export const getPeriodEnd = (periodStart: string): string => {
  const [y, mo, day] = periodStart.split('-').map(Number)
  return fmtYMD(new Date(y, mo - 1, day + 6))
}

/** Returns the current accounting week (Saturday → Friday, IST) as YYYY-MM-DD strings. */
export const getCurrentAccountingWeek = (): { from: string; to: string } => {
  const from = getPeriodStart()
  return { from, to: getPeriodEnd(from) }
}

// ─── Mapper helpers ──────────────────────────────────────────────────────────

/**
 * Normalises any Firestore date-like value to an ISO string.
 * Handles plain strings, Date objects, Firestore Timestamp instances
 * (`toDate()`), and the Admin-SDK shape `{ _seconds, _nanoseconds }`.
 * Returns undefined if the value cannot be coerced.
 */
const toIsoString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value.length > 0 ? value : undefined
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  if (typeof value === 'object') {
    const v = value as { toDate?: () => Date; _seconds?: number }
    if (typeof v.toDate === 'function') {
      try {
        const d = v.toDate()
        return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
      } catch {
        return undefined
      }
    }
    if (typeof v._seconds === 'number') {
      return new Date(v._seconds * 1000).toISOString()
    }
  }
  return undefined
}

const mapLedgerEntry = (id: string, data: Record<string, unknown>): VendorLedgerEntry => {
  // Normalise date fields up-front so the UI never sees Firestore Timestamp
  // objects coerced via `String(...)`. `date` falls back to `createdAt` so a
  // row with only one of the two still shows a meaningful timestamp.
  const createdAtIso = toIsoString(data.createdAt) ?? nowIso()
  const dateIso = toIsoString(data.date) ?? createdAtIso
  const voidedAt = toIsoString(data.voidedAt)
  return {
    id,
    ...(voidedAt ? { voidedAt } : {}),
    vendorId: String(data.vendorId ?? ''),
    vendorName: data.vendorName ? String(data.vendorName) : undefined,
    vendorBase: data.vendorBase !== undefined ? toNumber(data.vendorBase) : undefined,
    vendorGst: data.vendorGst !== undefined ? toNumber(data.vendorGst) : undefined,
    amount: toNumber(data.amount),
    type: data.type === 'debit' ? 'debit' : 'credit',
    referenceId: String(data.referenceId ?? ''),
    invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : undefined,
    locationId: (() => {
      const raw = data.locationId ? String(data.locationId) : undefined
      if (!raw) return undefined
      return normalizeLocationId(raw)
    })(),
    date: dateIso,
    createdAt: createdAtIso,
    source: ['POS', 'booking', 'refund', 'cancellation'].includes(String(data.source ?? ''))
      ? (String(data.source) as VendorLedgerEntry['source'])
      : undefined,
    entryType: ['sale', 'manual_adjustment', 'discrepancy_correction', 'cancellation'].includes(
      String(data.entryType ?? ''),
    )
      ? (String(data.entryType) as VendorLedgerEntry['entryType'])
      : undefined,
    reason: data.reason ? String(data.reason) : undefined,
    linkedBookingIds: Array.isArray(data.linkedBookingIds)
      ? (data.linkedBookingIds as unknown[]).map((b) => String(b)).filter(Boolean)
      : undefined,
    createdBy: data.createdBy ? String(data.createdBy) : undefined,
    createdByName: data.createdByName ? String(data.createdByName) : undefined,
  }
}

// ─── Manual ledger adjustments (Owner/Admin) ────────────────────────────────

export interface CreateLedgerAdjustmentInput {
  vendorId: string
  vendorName?: string
  amount: number
  /** Optional split — defaults to vendorBase=amount, vendorGst=0. */
  vendorBase?: number
  vendorGst?: number
  type?: 'credit' | 'debit'
  reason: string
  linkedBookingIds?: string[]
  locationId?: string
  /** ISO date (YYYY-MM-DD) the credit should land in. Defaults to today IST. */
  date?: string
  createdBy: string
  createdByName: string
  entryType?: 'manual_adjustment' | 'discrepancy_correction'
}

/**
 * Write a manual vendor ledger entry — used by the Owner/Admin "Resolve & Credit"
 * flow when a discrepancy is fixed outside the normal sale pipeline. Idempotent
 * if you reuse the same `referenceId`; otherwise a new id is auto-generated.
 */
export const createLedgerAdjustment = async (
  input: CreateLedgerAdjustmentInput,
): Promise<VendorLedgerEntry> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  if (!input.vendorId) throw new Error('vendorId is required')
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('amount must be a positive number')
  }
  if (!input.reason?.trim()) throw new Error('reason is required for adjustments')

  const entryType: NonNullable<VendorLedgerEntry['entryType']> =
    input.entryType ?? 'manual_adjustment'
  const linkedBookingIds = (input.linkedBookingIds ?? []).map((s) => s.trim()).filter(Boolean)
  const today = toISTDateStr(new Date())
  const id = `${entryType}-${input.vendorId}-${Date.now()}`
  const docRef = doc(fs, VENDOR_LEDGER_COLLECTION, id)
  const payload = stripUndefined({
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    amount: Math.round(input.amount),
    vendorBase: input.vendorBase ?? Math.round(input.amount),
    vendorGst: input.vendorGst ?? 0,
    type: input.type ?? 'credit',
    referenceId: id,
    locationId: input.locationId,
    date: input.date ?? today,
    createdAt: nowIso(),
    entryType,
    reason: input.reason.trim(),
    linkedBookingIds: linkedBookingIds.length > 0 ? linkedBookingIds : undefined,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
  })
  await setDoc(docRef, payload)
  return mapLedgerEntry(id, payload)
}

const mapVendorInvoice = (id: string, data: Record<string, unknown>): VendorInvoice => ({
  id,
  vendorId: String(data.vendorId ?? ''),
  vendorName: data.vendorName ? String(data.vendorName) : undefined,
  vendorType:
    data.vendorType === 'SubLease'
      ? 'SubLease'
      : data.vendorType === 'ThirdParty'
        ? 'ThirdParty'
        : undefined,
  locationId: data.locationId ? normalizeLocationId(String(data.locationId)) : undefined,
  periodStart: String(data.periodStart ?? ''),
  periodEnd: String(data.periodEnd ?? ''),
  totalBase: toNumber(data.totalBase),
  totalGst: toNumber(data.totalGst),
  totalAmount: toNumber(data.totalAmount),
  transactionCount: toNumber(data.transactionCount),
  entries: Array.isArray(data.entries)
    ? (data.entries as Record<string, unknown>[]).map((e) => mapLedgerEntry(String(e.id ?? ''), e))
    : [],
  status: data.status === 'locked' ? 'locked' : data.status === 'pending' ? 'pending' : 'draft',
  generatedAt: String(data.generatedAt ?? nowIso()),
  lockedAt: data.lockedAt ? String(data.lockedAt) : undefined,
  chequeNumber: data.chequeNumber ? String(data.chequeNumber) : undefined,
  letterheadDownloadedAt: data.letterheadDownloadedAt
    ? String(data.letterheadDownloadedAt)
    : undefined,
})

const mapCompanyInvoice = (id: string, data: Record<string, unknown>): CompanyInvoice => ({
  id,
  periodStart: String(data.periodStart ?? ''),
  periodEnd: String(data.periodEnd ?? ''),
  companyOwnedBase: toNumber(data.companyOwnedBase),
  companyOwnedGst: toNumber(data.companyOwnedGst),
  companyOwnedTotal: toNumber(data.companyOwnedTotal),
  companyShareBase: toNumber(data.companyShareBase),
  companyShareGst: toNumber(data.companyShareGst),
  companyShareTotal: toNumber(data.companyShareTotal),
  totalAmount: toNumber(data.totalAmount),
  transactionCount: toNumber(data.transactionCount),
  byVendor:
    data.byVendor && typeof data.byVendor === 'object' && !Array.isArray(data.byVendor)
      ? Object.fromEntries(
          Object.entries(data.byVendor as Record<string, unknown>).map(([k, v]) => [
            k,
            toNumber(v),
          ]),
        )
      : {},
  byLocation:
    data.byLocation && typeof data.byLocation === 'object' && !Array.isArray(data.byLocation)
      ? Object.fromEntries(
          Object.entries(data.byLocation as Record<string, unknown>).map(([k, v]) => [
            normalizeLocationId(k),
            toNumber(v),
          ]),
        )
      : {},
  status: data.status === 'locked' ? 'locked' : data.status === 'pending' ? 'pending' : 'draft',
  generatedAt: String(data.generatedAt ?? nowIso()),
  lockedAt: data.lockedAt ? String(data.lockedAt) : undefined,
})

// Uses the canonical mapTransactionRecord from billing-firestore.ts (imported above)
// to ensure all modules map raw Firestore data to TransactionRecord identically.

// ─── Ledger ──────────────────────────────────────────────────────────────────

export const listFirestoreLedgerEntries = async (
  vendorId?: string,
): Promise<VendorLedgerEntry[]> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  const col = collection(fs, VENDOR_LEDGER_COLLECTION)
  const q = vendorId
    ? query(col, where('vendorId', '==', vendorId), orderBy('date', 'desc'))
    : query(col, orderBy('date', 'desc'))
  const snap = await getDocs(q)
  // Filter out voided rows here so every consumer (vendor portal,
  // accounting tabs, settlement totals, weekly invoice generation, the
  // monthly P&L) gets a single consistent view. A soft-deleted booking
  // cascades a `voidedAt` stamp onto its ledger entries via
  // `softDeleteBooking`; restoring the booking clears the stamp.
  return snap.docs
    .map((d) => mapLedgerEntry(d.id, d.data() as Record<string, unknown>))
    .filter((entry) => !entry.voidedAt)
}

// ─── Billing Transactions (read-only for accounting) ─────────────────────────

export const listAccountingTransactions = async (
  vendorId?: string,
): Promise<TransactionRecord[]> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  const col = collection(fs, BILLING_TRANSACTIONS_COLLECTION)

  if (!vendorId) {
    const snap = await getDocs(query(col, orderBy('transactionDate', 'desc')))
    return snap.docs
      .map((d) => mapTransactionRecord(d.id, d.data() as Record<string, unknown>))
      .filter((t) => !t.deletedAt)
  }

  // Step 1: Primary vendor transactions (top-level vendorId matches)
  const primarySnap = await getDocs(
    query(col, where('vendorId', '==', vendorId), orderBy('transactionDate', 'desc')),
  )
  const results = new Map<string, TransactionRecord>()
  for (const d of primarySnap.docs) {
    const record = mapTransactionRecord(d.id, d.data() as Record<string, unknown>)
    if (record.deletedAt) continue
    results.set(d.id, record)
  }

  // Step 2: Find additional transaction IDs from vendor ledger
  // (catches transactions where this vendor has items but isn't the primary vendor)
  const ledgerCol = collection(fs, VENDOR_LEDGER_COLLECTION)
  const ledgerSnap = await getDocs(query(ledgerCol, where('vendorId', '==', vendorId)))
  const missingIds: string[] = []
  for (const d of ledgerSnap.docs) {
    const refId = String(d.data().referenceId ?? '')
    if (refId && !results.has(refId)) missingIds.push(refId)
  }

  // Step 3: Fetch missing transactions individually
  for (const id of missingIds) {
    try {
      const docSnap = await getDoc(doc(col, id))
      if (!docSnap.exists()) continue
      const record = mapTransactionRecord(id, docSnap.data() as Record<string, unknown>)
      if (record.deletedAt) continue
      results.set(id, record)
    } catch {
      /* skip missing docs */
    }
  }

  return Array.from(results.values()).sort((a, b) =>
    b.transactionDate.localeCompare(a.transactionDate),
  )
}

// ─── Vendor Invoices ──────────────────────────────────────────────────────────

/**
 * Read vendor invoices, optionally bounded to a `periodStart` window.
 *
 * The unbounded form (`range` omitted) is preserved for back-compat with
 * the internal stale-check call at line ~1269 and any caller that needs
 * the full history. **The page-level UI must always pass a `range`** so
 * the read stays bounded as accounting weeks accumulate over years —
 * otherwise the per-visit payload grows linearly forever.
 */
export const listFirestoreVendorInvoices = async (
  vendorId?: string,
  range?: { from?: string; to?: string },
): Promise<VendorInvoice[]> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  const col = collection(fs, VENDOR_INVOICES_COLLECTION)
  const constraints = []
  if (vendorId) constraints.push(where('vendorId', '==', vendorId))
  if (range?.from) constraints.push(where('periodStart', '>=', range.from))
  if (range?.to) constraints.push(where('periodStart', '<=', range.to))
  constraints.push(orderBy('periodStart', 'desc'))
  const snap = await getDocs(query(col, ...constraints))
  return snap.docs.map((d) => mapVendorInvoice(d.id, d.data() as Record<string, unknown>))
}

export const lockFirestoreVendorInvoice = async (invoiceId: string): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  // Pre-lock validation
  const validation = await validateInvoiceBeforeLock(invoiceId, 'vendor')
  if (!validation.valid) {
    throw new Error(`Cannot lock vendor invoice: ${validation.errors.join('; ')}`)
  }
  await updateDoc(doc(fs, VENDOR_INVOICES_COLLECTION, invoiceId), {
    status: 'locked',
    lockedAt: nowIso(),
  })
}

// ─── Company Invoices ─────────────────────────────────────────────────────────

/** See `listFirestoreVendorInvoices`. Same range-bound contract — the
 *  page-level UI must pass a `range` for bounded reads. */
export const listFirestoreCompanyInvoices = async (range?: {
  from?: string
  to?: string
}): Promise<CompanyInvoice[]> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  const constraints = []
  if (range?.from) constraints.push(where('periodStart', '>=', range.from))
  if (range?.to) constraints.push(where('periodStart', '<=', range.to))
  constraints.push(orderBy('periodStart', 'desc'))
  const snap = await getDocs(query(collection(fs, COMPANY_INVOICES_COLLECTION), ...constraints))
  return snap.docs.map((d) => mapCompanyInvoice(d.id, d.data() as Record<string, unknown>))
}

export const lockFirestoreCompanyInvoice = async (invoiceId: string): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  // Pre-lock validation
  const validation = await validateInvoiceBeforeLock(invoiceId, 'company')
  if (!validation.valid) {
    throw new Error(`Cannot lock company invoice: ${validation.errors.join('; ')}`)
  }
  await updateDoc(doc(fs, COMPANY_INVOICES_COLLECTION, invoiceId), {
    status: 'locked',
    lockedAt: nowIso(),
  })
}

// ─── Pre-lock validation ────────────────────────────────────────────────────

/**
 * Validates invoice totals against ledger data before allowing lock.
 * For vendor invoices: compares stored totals with ledger net (credits - debits).
 * For company invoices: verifies internal consistency of base + GST = total.
 */
export const validateInvoiceBeforeLock = async (
  invoiceId: string,
  type: 'vendor' | 'company',
): Promise<{ valid: boolean; errors: string[] }> => {
  const fs = getFs()
  if (!fs) return { valid: true, errors: [] }
  const errors: string[] = []
  const TOLERANCE = 1 // rounding tolerance in rupees

  if (type === 'vendor') {
    const snap = await getDoc(doc(fs, VENDOR_INVOICES_COLLECTION, invoiceId))
    if (!snap.exists()) return { valid: false, errors: ['Invoice not found'] }
    const inv = mapVendorInvoice(snap.id, snap.data() as Record<string, unknown>)

    // Internal consistency: totalBase + totalGst === totalAmount
    if (Math.abs(inv.totalBase + inv.totalGst - inv.totalAmount) > TOLERANCE) {
      errors.push(
        `totalBase(${inv.totalBase}) + totalGst(${inv.totalGst}) !== totalAmount(${inv.totalAmount})`,
      )
    }

    // Cross-check against ledger entries for this vendor and period.
    // Query without locationId filter and filter client-side after normalization,
    // because Firestore stores raw locationIds (e.g. "Vizag", "0", "visakhapatnam")
    // which won't match the normalized slug used in the invoice.
    const ledgerRef = collection(fs, VENDOR_LEDGER_COLLECTION)
    const ledgerQ = query(
      ledgerRef,
      where('vendorId', '==', inv.vendorId),
      where('date', '>=', inv.periodStart),
      where('date', '<=', `${inv.periodEnd}\uf8ff`),
    )
    const ledgerSnap = await getDocs(ledgerQ)
    let ledgerNet = 0
    for (const d of ledgerSnap.docs) {
      const data = d.data()
      // Normalize locationId to match invoice generation logic
      const rawLoc = data.locationId ? String(data.locationId) : undefined
      const entryLoc = rawLoc ? normalizeLocationId(rawLoc) : undefined
      if (inv.locationId && entryLoc !== inv.locationId) continue
      if (!inv.locationId && entryLoc) continue
      const sign = data.type === 'debit' ? -1 : 1
      ledgerNet += sign * toNumber(data.amount)
    }
    if (Math.abs(ledgerNet - inv.totalAmount) > TOLERANCE) {
      errors.push(`Invoice total(${inv.totalAmount}) does not match ledger net(${ledgerNet})`)
    }
  } else {
    const snap = await getDoc(doc(fs, COMPANY_INVOICES_COLLECTION, invoiceId))
    if (!snap.exists()) return { valid: false, errors: ['Invoice not found'] }
    const inv = mapCompanyInvoice(snap.id, snap.data() as Record<string, unknown>)

    if (Math.abs(inv.companyOwnedBase + inv.companyOwnedGst - inv.companyOwnedTotal) > TOLERANCE) {
      errors.push(`companyOwnedBase + companyOwnedGst !== companyOwnedTotal`)
    }
    if (Math.abs(inv.companyShareBase + inv.companyShareGst - inv.companyShareTotal) > TOLERANCE) {
      errors.push(`companyShareBase + companyShareGst !== companyShareTotal`)
    }
    if (Math.abs(inv.companyOwnedTotal + inv.companyShareTotal - inv.totalAmount) > TOLERANCE) {
      errors.push(`companyOwnedTotal + companyShareTotal !== totalAmount`)
    }
  }

  return { valid: errors.length === 0, errors }
}

// ─── Unlock ──────────────────────────────────────────────────────────────────

export const unlockFirestoreVendorInvoice = async (invoiceId: string): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  await updateDoc(doc(fs, VENDOR_INVOICES_COLLECTION, invoiceId), {
    status: 'draft',
    lockedAt: null,
    unlockedAt: nowIso(),
  })
}

export const unlockFirestoreCompanyInvoice = async (invoiceId: string): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  await updateDoc(doc(fs, COMPANY_INVOICES_COLLECTION, invoiceId), {
    status: 'draft',
    lockedAt: null,
    unlockedAt: nowIso(),
  })
}

// ─── Invoice Audit Logs ──────────────────────────────────────────────────────

export const createFirestoreInvoiceAuditLog = async (
  action: InvoiceAuditLogRecord['action'],
  entityType: InvoiceAuditLogRecord['entityType'],
  entityId: string,
  userId: string,
  userName: string,
): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  const logId = `ial-${Date.now()}-${entityId}`
  await setDoc(doc(fs, INVOICE_AUDIT_LOGS_COLLECTION, logId), {
    id: logId,
    action,
    entityType,
    entityId,
    userId,
    userName,
    createdAt: nowIso(),
  })
}

// ─── Item-level split extraction ─────────────────────────────────────────────

interface ItemSplit {
  vendorId?: string
  vendorBase: number
  vendorGst: number
  vendorTotal: number
  companyBase: number
  companyGst: number
  companyTotal: number
}

/**
 * Extracts per-item revenue splits from a transaction.
 * New records (items[0].vendorBase is defined): reads directly from item-level split data.
 * Old records (no item-level splits): synthesizes from transaction-level fields for backward compat.
 */
const extractItemSplits = (txn: TransactionRecord): ItemSplit[] => {
  // New format: items have per-item split data.
  //
  // Refunded items (`item.refunded === true`) contribute zero on the
  // vendor side — the customer was refunded for that line, the vendor
  // earned nothing. Including the original vendorTotal here would
  // inflate Settlements totalEarned and produce phantom drift against
  // the ledger (which correctly debits via `source: 'refund'` rows).
  if (Array.isArray(txn.items) && txn.items.length > 0 && txn.items[0].vendorBase !== undefined) {
    return txn.items.map((item) => {
      if (item.refunded === true) {
        return {
          vendorId: item.vendorId,
          vendorBase: 0,
          vendorGst: 0,
          vendorTotal: 0,
          // Company side keeps zero too — refunded amount left the system.
          companyBase: 0,
          companyGst: 0,
          companyTotal: 0,
        }
      }
      return {
        vendorId: item.vendorId,
        vendorBase: item.vendorBase ?? 0,
        vendorGst: item.vendorGst ?? 0,
        vendorTotal: item.vendorTotal ?? 0,
        companyBase: item.companyBase ?? 0,
        companyGst: item.companyGst ?? 0,
        companyTotal: item.companyTotal ?? 0,
      }
    })
  }

  // Old format: synthesize from transaction-level fields
  if (txn.vendorId && txn.vendorTotal !== undefined) {
    return [
      {
        vendorId: txn.vendorId,
        vendorBase: txn.vendorBase ?? 0,
        vendorGst: txn.vendorGst ?? 0,
        vendorTotal: txn.vendorTotal ?? 0,
        companyBase: txn.companyBase ?? 0,
        companyGst: txn.companyGst ?? 0,
        companyTotal: txn.companyTotal ?? 0,
      },
    ]
  }

  // Pure company transaction
  return [
    {
      vendorId: undefined,
      vendorBase: 0,
      vendorGst: 0,
      vendorTotal: 0,
      companyBase: txn.baseAmount ?? 0,
      companyGst: txn.gstAmount ?? 0,
      companyTotal: txn.companyTotal ?? txn.totalAmount,
    },
  ]
}

// ─── Weekly Invoice Generation ────────────────────────────────────────────────

/**
 * Generates (or refreshes) vendor + company invoices for the given week.
 * Vendor amounts are computed directly from billingTransactions (vendorTotal field),
 * NOT from the ledger — so backfilled/corrected records are always reflected.
 * Locked invoices are never overwritten.
 */
/** Composite key used throughout invoice generation: vendorId + location */
const invoiceCompositeKey = (vendorId: string, locationId: string | undefined): string =>
  `${vendorId}::${locationId ?? 'all'}`

export const generateFirestoreWeeklyInvoices = async (
  forDate: Date = new Date(),
): Promise<{ vendorInvoices: VendorInvoice[]; companyInvoice: CompanyInvoice }> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')

  const periodStart = getPeriodStart(forDate)
  const periodEnd = getPeriodEnd(periodStart)

  // Load all billing transactions for this period.
  // Supports both date-only (YYYY-MM-DD) and full ISO datetime formats.
  //
  // Defense-in-depth: also query by `createdAt` and merge. Some booking
  // writers (offer drafts, certain customer-app paths) create bookings
  // WITHOUT a `transactionDate` field \u2014 they only set `createdAt`. Those
  // bookings would be invisible to a `transactionDate`-only query, and
  // any ledger row written for them (manual_adjustment, admin-reconciliation,
  // refund debit) would get orphan-deleted on the next regen because the
  // booking ID isn't in `allBookingIdsInPeriod`. Querying `createdAt` as a
  // fallback catches those without affecting normal POS bookings, since
  // the merge dedupes by doc ID.
  const col = collection(fs, BILLING_TRANSACTIONS_COLLECTION)
  const txnDateSnap = await getDocs(
    query(
      col,
      where('transactionDate', '>=', periodStart),
      where('transactionDate', '<=', `${periodEnd}\uf8ff`),
    ),
  )
  type DocLike = (typeof txnDateSnap.docs)[number]
  let createdAtDocs: DocLike[] = []
  try {
    const createdAtSnap = await getDocs(
      query(
        col,
        where('createdAt', '>=', new Date(`${periodStart}T00:00:00.000Z`)),
        where('createdAt', '<=', new Date(`${periodEnd}T23:59:59.999Z`)),
      ),
    )
    createdAtDocs = createdAtSnap.docs
  } catch {
    /* createdAt query can fail if the field is mixed-type across docs;
       fall through to the transactionDate-only set in that case */
  }
  const dedupedDocs = new Map<string, DocLike>()
  for (const d of txnDateSnap.docs) dedupedDocs.set(d.id, d)
  for (const d of createdAtDocs) {
    if (!dedupedDocs.has(d.id)) dedupedDocs.set(d.id, d)
  }
  const txnsSnap = { docs: [...dedupedDocs.values()] }
  // Two distinct sets of booking IDs:
  //   `txns` — payable bookings that contribute to invoice totals.
  //   `allBookingIdsInPeriod` — every booking doc that EXISTS for the period,
  //     regardless of paymentStatus/refundStatus/cancelled. Used by the
  //     orphan-cleanup below so a manual ledger row written by the
  //     OrphanResolver / Re-attribute path on a pending/refunded booking
  //     isn't silently nuked just because the booking is filtered out of
  //     the invoice math.
  const allBookingIdsInPeriod = new Set(txnsSnap.docs.map((d) => d.id))
  // Bookings that EXIST in the period but are NOT payable for invoicing.
  // These bookings' stale sale-credit rows in `vendorLedger` must be excluded
  // from `validLedgerDocs` so the ledger-net total used to compute invoices
  // matches the txn-side accumulator. Manual-adjustment / discrepancy-correction
  // / settlement-correction rows on these same bookings are still preserved
  // (the source-based exemption below).
  const nonPayableBookingIds = new Set<string>()
  const txns = txnsSnap.docs
    .map((d) => mapTransactionRecord(d.id, d.data() as Record<string, unknown>))
    .filter((t) => {
      // Inclusive payability gate. Mirrors billing-firestore.ts:555-559 / 1531.
      // AllBookingsView "Cancel" sets bookingStatus='cancelled' but leaves
      // paymentStatus='completed' and `cancelled` false — so this branch
      // actively classifies non-payable, not just rejects.
      //
      // Trashed bookings (`deletedAt` set) are non-payable too. Without
      // this guard a soft-deleted sale still rolled into the vendor's
      // weekly invoice — and weekly invoices produce real cheques, so
      // the vendor would be paid for a sale that the operator
      // explicitly reversed. The booking still goes into
      // `allBookingIdsInPeriod` (raw query above) so the orphan-cleanup
      // doesn't nuke its voided ledger rows on regen.
      const payable =
        !t.deletedAt &&
        t.paymentStatus === 'completed' &&
        t.refundStatus !== 'Full' &&
        !t.cancelled &&
        t.bookingStatus !== 'cancelled'
      if (!payable) nonPayableBookingIds.add(t.id)
      return payable
    })

  const now = nowIso()

  // Check which vendor invoices are already locked for this period
  const existingVendorSnap = await getDocs(
    query(collection(fs, VENDOR_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  const lockedKeys = new Set<string>() // composite key `vendorId::locationId`
  const existingDraftIds = new Map<string, string>() // composite key → existing draft/pending doc ID
  existingVendorSnap.docs.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    const vid = String(data.vendorId ?? '')
    // Normalise the locationId on the existing invoice so the composite
    // key collides with the same vendor+location pair derived from
    // `txn.locationId` below (which `mapTransactionRecord` already
    // normalises via `resolveLocation(...).slug`). Without this step, an
    // existing LOCKED invoice with locationId="1" would not match a
    // generator pass whose composite key uses locationId="kakinada",
    // producing a duplicate pending invoice on every regen. That was
    // the source of the 28-invoice duplicate cluster on 18/04 and the
    // 76-invoice cluster on 02/05.
    const locId = data.locationId ? normalizeLocationId(String(data.locationId)) : 'all'
    const ck = invoiceCompositeKey(vid, locId)
    if (data.status === 'locked') {
      lockedKeys.add(ck)
    } else if (vid && !existingDraftIds.has(ck)) {
      existingDraftIds.set(ck, d.id) // reuse existing draft doc to prevent duplicates
    }
  })

  // ── Aggregate item splits across all transactions ─────────────────────────
  // vendorAccumulator: keyed by `vendorId::locationId` — one entry per vendor per location
  const vendorAccumulator = new Map<
    string,
    {
      vendorId: string
      locationId: string // "all" when transaction has no locationId
      totalBase: number
      totalGst: number
      totalAmount: number
      txnIds: Set<string>
      entriesByTxn: Map<string, VendorLedgerEntry> // one entry per (txnId, vendorId+location)
    }
  >()

  let companyOwnedBase = 0,
    companyOwnedGst = 0
  let companyShareBase = 0,
    companyShareGst = 0
  const byVendor: Record<string, number> = {}
  const byLocation: Record<string, number> = {}
  const allTxnIds = new Set<string>()

  for (const txn of txns) {
    allTxnIds.add(txn.id)
    const splits = extractItemSplits(txn)

    // Per-transaction vendor+location totals (for building one ledger entry per txn per vendor+location)
    const txnVendorMap = new Map<string, { vBase: number; vGst: number; vTotal: number }>() // key = compositeKey

    for (const split of splits) {
      if (split.vendorId && split.vendorTotal > 0) {
        // Vendor item — accumulate to vendor+location totals
        const ck = invoiceCompositeKey(split.vendorId, txn.locationId)
        if (!vendorAccumulator.has(ck)) {
          vendorAccumulator.set(ck, {
            vendorId: split.vendorId,
            locationId: txn.locationId ?? 'all',
            totalBase: 0,
            totalGst: 0,
            totalAmount: 0,
            txnIds: new Set(),
            entriesByTxn: new Map(),
          })
        }
        const acc = vendorAccumulator.get(ck)!
        acc.totalBase += split.vendorBase
        acc.totalGst += split.vendorGst
        acc.totalAmount += split.vendorTotal
        acc.txnIds.add(txn.id)

        // Accumulate per-txn totals for this vendor+location (for single ledger entry per txn)
        const txnTotals = txnVendorMap.get(ck) ?? { vBase: 0, vGst: 0, vTotal: 0 }
        txnTotals.vBase += split.vendorBase
        txnTotals.vGst += split.vendorGst
        txnTotals.vTotal += split.vendorTotal
        txnVendorMap.set(ck, txnTotals)

        // Company's share from this vendor item
        companyShareBase += split.companyBase
        companyShareGst += split.companyGst
        byVendor[split.vendorId] = (byVendor[split.vendorId] ?? 0) + split.companyTotal
      } else {
        // Company-owned item
        companyOwnedBase += split.companyBase
        companyOwnedGst += split.companyGst
      }
    }

    // Build one ledger entry per (txnId, vendorId+location) and attach to the accumulator
    for (const [ck, totals] of txnVendorMap.entries()) {
      const acc = vendorAccumulator.get(ck)
      if (!acc) continue
      acc.entriesByTxn.set(txn.id, {
        id: `le-${txn.id}-${acc.vendorId}`,
        vendorId: acc.vendorId,
        vendorBase: totals.vBase,
        vendorGst: totals.vGst,
        amount: totals.vTotal,
        type: 'credit' as const,
        referenceId: txn.id,
        invoiceNumber: txn.invoiceNumber,
        locationId: txn.locationId,
        date: txn.transactionDate,
        createdAt: txn.createdAt ?? txn.transactionDate,
      })
    }

    // byLocation: company earnings per location
    if (txn.locationId) {
      const locCompany = splits.reduce((s, sp) => s + sp.companyTotal, 0)
      byLocation[txn.locationId] = (byLocation[txn.locationId] ?? 0) + locCompany
    }
  }

  // ── Fetch vendorType + vendorName for each vendor from vendorDetails ─────
  const vendorTypeMap = new Map<string, VendorType>()
  const vendorNameMap = new Map<string, string>()
  const vendorCompanyNameMap = new Map<string, string>()
  // Extract plain vendorIds from composite keys (vendorId::locationId)
  const allVendorIds = new Set([
    ...[...vendorAccumulator.keys()].map((k) => k.split('::')[0]),
    ...[...existingDraftIds.keys()].map((k) => k.split('::')[0]),
  ])
  await Promise.all(
    [...allVendorIds].map(async (vid) => {
      try {
        const snap = await getDoc(doc(fs, 'vendorDetails', vid))
        if (snap.exists()) {
          const d = snap.data() as Record<string, unknown>
          vendorTypeMap.set(vid, d.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty')
          if (d.vendorName) vendorNameMap.set(vid, String(d.vendorName))
          if (d.particular) vendorCompanyNameMap.set(vid, String(d.particular))
        }
      } catch {
        /* skip — will use fallback below */
      }
    }),
  )

  // Fallback: infer vendorType from transaction GST pattern for vendors not found in vendorDetails.
  // SubLease vendors have vendorGst === 0 (they get base only, company keeps all GST).
  for (const [, acc] of vendorAccumulator.entries()) {
    if (!vendorTypeMap.has(acc.vendorId)) {
      const isSubLease = acc.totalAmount > 0 && acc.totalGst === 0
      vendorTypeMap.set(acc.vendorId, isSubLease ? 'SubLease' : 'ThirdParty')
    }
  }

  // ── Self-heal: persist any missing vendorLedger credits ─────────────────
  // For every (transaction, vendor) pair we just built in memory, upsert the
  // corresponding ledger row. Idempotent: deterministic doc id `le-{txnId}-{vendorId}`
  // matches the writers in:
  //   - functions/triggers/on-booking-write.js   (canonical writer)
  //   - src/lib/unified-booking.ts:304-342       (POS client write)
  //   - src/pipeline/api/billing-firestore.ts    (legacy billing write)
  // Re-runs are no-ops because content is identical and writes use merge.
  // This closes the gap for bookings whose original write path bypassed
  // the ledger (Razorpay webhook, customer-app draft → completion, etc.).
  await Promise.allSettled(
    [...vendorAccumulator.values()].flatMap((acc) =>
      [...acc.entriesByTxn.values()].map((entry) =>
        setDoc(
          doc(fs, VENDOR_LEDGER_COLLECTION, entry.id),
          stripUndefined({
            ...(entry as unknown as Record<string, unknown>),
            createdAt: entry.createdAt ?? now,
            source: 'booking',
          }),
          { merge: true },
        ).catch(() => {
          /* best-effort self-heal */
        }),
      ),
    ),
  )

  // ── Ledger-based total reconciliation ─────────────────────────────────────
  // Query vendor ledger for the period to derive authoritative net totals
  // (credits - debits). This ensures cancellations and refunds reduce invoice amounts.
  const ledgerSnap = await getDocs(
    query(
      collection(fs, VENDOR_LEDGER_COLLECTION),
      where('date', '>=', periodStart),
      where('date', '<=', `${periodEnd}\uf8ff`),
    ),
  )

  // Clean up orphaned ledger entries whose referenced booking GENUINELY
  // doesn't exist (was deleted, never created, etc.).
  //
  // Critical: use `allBookingIdsInPeriod` (existence-based) NOT `allTxnIds`
  // (status-filtered). If a booking exists but is filtered from invoice
  // math (paymentStatus !== 'completed', refundStatus === 'Full',
  // cancelled), its ledger rows are still legitimate — they may carry a
  // manual_adjustment or admin-reconciliation credit written by
  // OrphanResolver / Re-attribute. Deleting those silently undoes the
  // human's correction. Existence is the only safe predicate here.
  //
  // Settlement-correction rows are EXEMPT from the orphan cleanup. By
  // design, those rows are carry-forwards from prior locked periods —
  // their `referenceId` is often a synthetic period identifier
  // (e.g. "period-recovery-2026-04-02-to-2026-05-02") rather than a real
  // booking ID. The previous cleanup would happily delete them on the
  // next regen, silently reversing the carry-forward and leaving the
  // vendor over- or under-paid again. Source-based skip preserves them.
  const orphanedDocs = ledgerSnap.docs.filter((d) => {
    const data = d.data()
    if (data.source === 'settlement-correction') return false
    const refId = data.referenceId
    return typeof refId === 'string' && refId.length > 0 && !allBookingIdsInPeriod.has(refId)
  })
  if (orphanedDocs.length > 0) {
    try {
      await Promise.allSettled(orphanedDocs.map((d) => deleteDoc(d.ref)))
    } catch {
      /* cleanup is best-effort */
    }
  }

  const ledgerNetByVendor = new Map<
    string,
    {
      netBase: number
      netGst: number
      netAmount: number
      entries: VendorLedgerEntry[]
    }
  >()

  // Only process ledger rows that reference an existing booking. Same
  // existence-based predicate as above — preserves manual-adjustment
  // credits/debits on filtered-out bookings. Settlement-correction rows
  // are always valid (they reference periods, not bookings).
  //
  // Additional gate: SALE rows whose source booking is non-payable
  // (cancelled, refunded-in-full, payment-not-completed, bookingStatus
  // cancelled) are EXCLUDED from invoice math. Without this, a sale credit
  // written when the booking was paid keeps inflating the invoice forever
  // after the booking is cancelled — the symptom Daisy saw on the Vendor
  // Ledger card (₹1,80,254) vs Pending Settlement (₹1,74,953). Manual
  // adjustments and discrepancy corrections on the same booking ARE kept,
  // so admin-issued credits / debits survive a cancellation.
  const isManualSource = (src: unknown, entryType: unknown): boolean => {
    const s = String(src ?? '')
    const e = String(entryType ?? '')
    return (
      s === 'manual_adjustment' ||
      s === 'discrepancy_correction' ||
      s === 'settlement-correction' ||
      e === 'manual_adjustment' ||
      e === 'discrepancy_correction'
    )
  }
  const validLedgerDocs = ledgerSnap.docs.filter((d) => {
    const data = d.data()
    // Voided ledger entries (cascaded from softDeleteBooking) must not
    // be invoiced. The booking-level deletedAt filter above already
    // strips trashed bookings from the payable set, but ledger entries
    // can also be voided by the cascade independently — defense in
    // depth means filtering at both layers so a partial cascade or a
    // standalone manual void doesn't leak into the cheque.
    if (data.voidedAt) return false
    if (data.source === 'settlement-correction') return true
    const refId = data.referenceId
    if (refId && !allBookingIdsInPeriod.has(String(refId))) return false
    if (
      refId &&
      nonPayableBookingIds.has(String(refId)) &&
      !isManualSource(data.source, data.entryType)
    ) {
      return false
    }
    return true
  })

  for (const d of validLedgerDocs) {
    const entry = mapLedgerEntry(d.id, d.data() as Record<string, unknown>)
    const ck = invoiceCompositeKey(entry.vendorId, entry.locationId)
    const sign = entry.type === 'credit' ? 1 : -1
    const acc = ledgerNetByVendor.get(ck) ?? { netBase: 0, netGst: 0, netAmount: 0, entries: [] }
    acc.netBase += sign * (entry.vendorBase ?? 0)
    acc.netGst += sign * (entry.vendorGst ?? 0)
    acc.netAmount += sign * entry.amount
    acc.entries.push(entry)
    ledgerNetByVendor.set(ck, acc)
  }

  // ── Generate vendor invoices ───────────────────────────────────────────────
  const generatedVendorInvoices: VendorInvoice[] = []

  for (const [ck, acc] of vendorAccumulator.entries()) {
    if (lockedKeys.has(ck)) continue

    const { vendorId, locationId } = acc
    const locSuffix = locationId !== 'all' ? `-${locationId}` : ''
    const invoiceId = existingDraftIds.get(ck) || `vi-${periodStart}-${vendorId}${locSuffix}`
    // Use ledger-derived net totals when available (accounts for cancellations/refunds).
    // Fallback to transaction-based totals for backward compat (old data without ledger entries).
    const ledgerData = ledgerNetByVendor.get(ck)
    const invoice: VendorInvoice = {
      id: invoiceId,
      vendorId,
      vendorName: vendorNameMap.get(vendorId),
      vendorCompanyName: vendorCompanyNameMap.get(vendorId),
      vendorType: vendorTypeMap.get(vendorId) ?? 'ThirdParty',
      locationId: locationId !== 'all' ? locationId : undefined,
      periodStart,
      periodEnd,
      totalBase: ledgerData ? ledgerData.netBase : acc.totalBase,
      totalGst: ledgerData ? ledgerData.netGst : acc.totalGst,
      totalAmount: ledgerData ? ledgerData.netAmount : acc.totalAmount,
      transactionCount: acc.txnIds.size,
      entries: ledgerData ? ledgerData.entries : [...acc.entriesByTxn.values()],
      status: 'pending',
      generatedAt: now,
    }
    const cleanEntries = invoice.entries.map((e) =>
      stripUndefined(e as unknown as Record<string, unknown>),
    )
    await setDoc(doc(fs, VENDOR_INVOICES_COLLECTION, invoiceId), {
      ...stripUndefined(invoice as unknown as Record<string, unknown>),
      entries: cleanEntries,
    })
    generatedVendorInvoices.push(invoice)
  }

  // ── Update stale vendor invoices (vendors with all transactions cancelled/refunded) ──
  // If a vendor had an existing unlocked invoice but no remaining valid transactions,
  // the loop above skipped it. Use ledger data to zero-out or update the invoice.
  for (const [ck, existingDocId] of existingDraftIds.entries()) {
    if (vendorAccumulator.has(ck)) continue // already handled above
    if (lockedKeys.has(ck)) continue

    const [vendorId, locId] = ck.split('::')
    const ledgerData = ledgerNetByVendor.get(ck)
    const invoice: VendorInvoice = {
      id: existingDocId,
      vendorId,
      vendorName: vendorNameMap.get(vendorId),
      vendorCompanyName: vendorCompanyNameMap.get(vendorId),
      vendorType: vendorTypeMap.get(vendorId) ?? 'ThirdParty',
      locationId: locId !== 'all' ? locId : undefined,
      periodStart,
      periodEnd,
      totalBase: ledgerData ? ledgerData.netBase : 0,
      totalGst: ledgerData ? ledgerData.netGst : 0,
      totalAmount: ledgerData ? ledgerData.netAmount : 0,
      transactionCount: 0,
      entries: ledgerData ? ledgerData.entries : [],
      status: 'pending',
      generatedAt: now,
    }
    const cleanEntries = invoice.entries.map((e) =>
      stripUndefined(e as unknown as Record<string, unknown>),
    )
    await setDoc(doc(fs, VENDOR_INVOICES_COLLECTION, existingDocId), {
      ...stripUndefined(invoice as unknown as Record<string, unknown>),
      entries: cleanEntries,
    })
    generatedVendorInvoices.push(invoice)
  }

  // ── Ledger-only (vendor, location) pairs ──────────────────────────────
  // Create invoices for any (vendor, location) composite key that has
  // ledger activity in this period but no current-period booking with
  // the vendor in billingItems AND no pre-existing draft invoice.
  //
  // Why this matters: when a vendor receives credits at a location only
  // via POS / ADMIN_BOOKING / settlement-correction sources (i.e. their
  // vendorId isn't in any billingItems split for that location's
  // bookings), they don't appear in `vendorAccumulator` for that
  // (vendor, location) pair. The first loop creates invoices only for
  // accumulator entries; the second loop only updates existing drafts.
  // Without this third loop, those credits live in vendorLedger but
  // belong to no invoice — causing a permanent gap between Settlements'
  // live-ledger total and the Pending Settlement card's invoice sum.
  // Discovered via V L N Varma 2026-04-25 case (kakinada bookings
  // generated her invoice, but vizag POS credits and srinagar
  // settlement-correction had no invoice).
  for (const [ck, ledgerData] of ledgerNetByVendor.entries()) {
    if (vendorAccumulator.has(ck)) continue // handled by loop 1
    if (existingDraftIds.has(ck)) continue // handled by loop 2
    if (lockedKeys.has(ck)) continue
    if (Math.abs(ledgerData.netAmount) <= 0) continue
    const [vendorId, locId] = ck.split('::')
    const locSuffix = locId !== 'all' ? `-${locId}` : ''
    const invoiceId = `vi-${periodStart}-${vendorId}${locSuffix}`
    const invoice: VendorInvoice = {
      id: invoiceId,
      vendorId,
      vendorName: vendorNameMap.get(vendorId),
      vendorCompanyName: vendorCompanyNameMap.get(vendorId),
      vendorType: vendorTypeMap.get(vendorId) ?? 'ThirdParty',
      locationId: locId !== 'all' ? locId : undefined,
      periodStart,
      periodEnd,
      totalBase: ledgerData.netBase,
      totalGst: ledgerData.netGst,
      totalAmount: ledgerData.netAmount,
      transactionCount: 0,
      entries: ledgerData.entries,
      status: 'pending',
      generatedAt: now,
    }
    const cleanEntries = invoice.entries.map((e) =>
      stripUndefined(e as unknown as Record<string, unknown>),
    )
    await setDoc(doc(fs, VENDOR_INVOICES_COLLECTION, invoiceId), {
      ...stripUndefined(invoice as unknown as Record<string, unknown>),
      entries: cleanEntries,
    })
    generatedVendorInvoices.push(invoice)
  }

  // ── Company invoice ────────────────────────────────────────────────────────
  const companyInvoiceId = `ci-${periodStart}`
  const existingCompanySnap = await getDocs(
    query(collection(fs, COMPANY_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  const companyLocked = existingCompanySnap.docs.some(
    (d) => (d.data() as Record<string, unknown>).status === 'locked',
  )

  let companyInvoice: CompanyInvoice
  if (companyLocked) {
    companyInvoice = mapCompanyInvoice(
      companyInvoiceId,
      existingCompanySnap.docs[0].data() as Record<string, unknown>,
    )
  } else {
    const companyOwnedTotal = companyOwnedBase + companyOwnedGst
    const companyShareTotal = companyShareBase + companyShareGst
    companyInvoice = {
      id: companyInvoiceId,
      periodStart,
      periodEnd,
      companyOwnedBase,
      companyOwnedGst,
      companyOwnedTotal,
      companyShareBase,
      companyShareGst,
      companyShareTotal,
      totalAmount: companyOwnedTotal + companyShareTotal,
      transactionCount: allTxnIds.size,
      byVendor,
      byLocation,
      status: 'pending',
      generatedAt: now,
    }
    await setDoc(
      doc(fs, COMPANY_INVOICES_COLLECTION, companyInvoiceId),
      stripUndefined(companyInvoice as unknown as Record<string, unknown>),
    )
  }

  return { vendorInvoices: generatedVendorInvoices, companyInvoice }
}

// ─── Vendor Ledger Backfill ──────────────────────────────────────────────────

export interface VendorLedgerBackfillResult {
  weeksProcessed: number
  vendorInvoicesTouched: number
  errors: { periodStart: string; message: string }[]
  fromPeriodStart: string
  toPeriodStart: string
}

/**
 * Walks each Saturday-aligned week from `from` to `to` (inclusive) and runs
 * generateFirestoreWeeklyInvoices() against it. Because invoice generation
 * was made self-healing in Step 4, this also re-syncs the vendorLedger
 * collection for every booking in those periods — closing any gap left by
 * sources that bypassed the runtime trigger.
 *
 * Locked invoices are skipped by the existing generation safeguards.
 *
 * Use the AccountingModule "Backfill Vendor Ledger" button (Owner-only)
 * or call from the standalone script at functions/scripts/backfill-vendor-ledger.js.
 */
export const backfillVendorLedgerForRange = async (
  from: string,
  to: string,
): Promise<VendorLedgerBackfillResult> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')

  // Snap both bounds to their containing Saturday-week start.
  const fromPeriodStart = getPeriodStart(new Date(from))
  const toPeriodStart = getPeriodStart(new Date(to))

  if (fromPeriodStart > toPeriodStart) {
    throw new Error("'from' must be on or before 'to'.")
  }

  const result: VendorLedgerBackfillResult = {
    weeksProcessed: 0,
    vendorInvoicesTouched: 0,
    errors: [],
    fromPeriodStart,
    toPeriodStart,
  }

  // Walk Saturday-by-Saturday.
  let cursorPeriodStart = fromPeriodStart
  while (cursorPeriodStart <= toPeriodStart) {
    const [y, mo, day] = cursorPeriodStart.split('-').map(Number)
    const cursorDate = new Date(y, mo - 1, day)
    try {
      const generated = await generateFirestoreWeeklyInvoices(cursorDate)
      result.vendorInvoicesTouched += generated.vendorInvoices.length
    } catch (err) {
      result.errors.push({
        periodStart: cursorPeriodStart,
        message: err instanceof Error ? err.message : String(err),
      })
    }
    result.weeksProcessed += 1

    // Advance 7 days.
    const next = new Date(y, mo - 1, day + 7)
    cursorPeriodStart = fmtYMD(next)
  }

  return result
}

// ─── Settlement Summary ───────────────────────────────────────────────────────

export interface VendorSettlementSummary {
  vendorId: string
  vendorName?: string
  vendorCompanyName?: string
  totalBase: number
  totalGst: number
  totalEarned: number
  totalTransactions: number
  pendingInvoices: number
  lockedInvoices: number
}

/**
 * Derives settlement data from the SAME source vendor invoices use:
 * `vendorLedger` net (credits − debits) per vendor in the date range.
 *
 * Why ledger and not billingItems:
 *   - `generateFirestoreWeeklyInvoices` writes invoice.totalAmount from
 *     `vendorLedger` net (line ~898). So the Pending Settlement card is
 *     ledger-derived.
 *   - The previous implementation here summed `billingItems[].vendorTotal`
 *     and skipped any in-period `manual_adjustment` whose referenceId was
 *     a counted transaction — assuming such adjustments matched the gap
 *     between billing truth and ledger exactly.
 *   - When an admin writes a corrective `lc-reconcile-…` row to reflect a
 *     real-world correction, that assumption breaks. Result: Settlements
 *     and Invoices show two different totals for the same week.
 *
 * Now both views read `vendorLedger` net for the period, so they always
 * agree — and any corrective row visibly moves both totals together.
 *
 * Transaction count and pending/locked invoice counts are still derived
 * separately so the summary card retains its at-a-glance metadata.
 */
export const getFirestoreVendorSettlements = async (range?: {
  from: string
  to: string
}): Promise<VendorSettlementSummary[]> => {
  const [txns, invoices, ledgerEntries] = await Promise.all([
    listAccountingTransactions(), // for transaction count + name fallback
    listFirestoreVendorInvoices(), // invoice status overlay
    listFirestoreLedgerEntries(), // SOURCE OF TRUTH — same as invoice generation
  ])

  // Filter transactions for the count metric (keep payable filter so the
  // count matches what would be invoiced). Uses the canonical
  // `isTerminatedBooking` helper so soft-delete + voided are excluded
  // alongside the legacy `cancelled` flag — matches the
  // generateFirestoreWeeklyInvoices payable predicate above.
  const isPayableTxn = (t: TransactionRecord): boolean => {
    if (isTerminatedBooking(t as unknown as Record<string, unknown>)) return false
    if (t.paymentStatus && t.paymentStatus !== 'completed') return false
    const refundStatus = (t as unknown as { refundStatus?: string }).refundStatus
    if (refundStatus === 'Full') return false
    return true
  }
  const filteredTxns = (
    range
      ? txns.filter((t) => {
          const day = (t.transactionDate ?? '').slice(0, 10)
          return day >= range.from && day <= range.to
        })
      : txns
  ).filter(isPayableTxn)
  const filteredInvoices = range
    ? invoices.filter((inv) => inv.periodStart >= range.from && inv.periodStart <= range.to)
    : invoices

  const byVendor: Record<string, VendorSettlementSummary> = {}
  // Track unique transaction IDs per vendor to count distinct billing invoices
  const txnSetByVendor: Record<string, Set<string>> = {}

  // Pass 1: walk transactions to build per-vendor transaction count only.
  // We DO NOT add to totalEarned here — that comes from the ledger below.
  for (const txn of filteredTxns) {
    // Defense in depth — `filteredTxns` already excludes terminated, but
    // the rest of the loop trusts this check so keep it explicit.
    if (isTerminatedBooking(txn as unknown as Record<string, unknown>)) continue
    const splits = extractItemSplits(txn)
    const vendorIdsOnTxn = new Set<string>()
    for (const split of splits) {
      if (split.vendorId && split.vendorTotal > 0) vendorIdsOnTxn.add(split.vendorId)
    }
    for (const vid of vendorIdsOnTxn) {
      if (!byVendor[vid]) {
        byVendor[vid] = {
          vendorId: vid,
          totalBase: 0,
          totalGst: 0,
          totalEarned: 0,
          totalTransactions: 0,
          pendingInvoices: 0,
          lockedInvoices: 0,
        }
        txnSetByVendor[vid] = new Set()
      }
      txnSetByVendor[vid].add(txn.id)
    }
  }
  for (const vid of Object.keys(byVendor)) {
    byVendor[vid].totalTransactions = txnSetByVendor[vid]?.size ?? 0
  }

  // Pass 2: walk vendorLedger in window to compute totalBase/totalGst/totalEarned.
  // This mirrors `generateFirestoreWeeklyInvoices` line ~865-900 — credits add,
  // debits subtract, EVERY entryType counted (sale, manual_adjustment,
  // discrepancy_correction, refund, cancel, manual_adjustment from drift
  // reconciliation). The result is exactly what the vendor invoice for the
  // period sums to.
  const filteredLedger = range
    ? ledgerEntries.filter((e) => {
        const day = (e.date || e.createdAt || '').slice(0, 10)
        return day >= range.from && day <= range.to
      })
    : ledgerEntries
  for (const entry of filteredLedger) {
    const vid = entry.vendorId
    if (!vid) continue
    if (!byVendor[vid]) {
      byVendor[vid] = {
        vendorId: vid,
        vendorName: entry.vendorName,
        totalBase: 0,
        totalGst: 0,
        totalEarned: 0,
        totalTransactions: 0,
        pendingInvoices: 0,
        lockedInvoices: 0,
      }
    }
    const sign = entry.type === 'debit' ? -1 : 1
    byVendor[vid].totalBase += sign * (entry.vendorBase ?? 0)
    byVendor[vid].totalGst += sign * (entry.vendorGst ?? 0)
    byVendor[vid].totalEarned += sign * entry.amount
  }

  // Name lookup uses the full (unfiltered) invoice list so vendors with
  // txns in the selected range but no invoice yet still get a display name.
  invoices.forEach((inv) => {
    const row = byVendor[inv.vendorId]
    if (!row) return
    if (inv.vendorName && !row.vendorName) row.vendorName = inv.vendorName
    if (inv.vendorCompanyName && !row.vendorCompanyName)
      row.vendorCompanyName = inv.vendorCompanyName
  })

  // Overlay invoice statuses (only invoices whose period falls in the range).
  filteredInvoices.forEach((inv) => {
    if (!byVendor[inv.vendorId]) {
      byVendor[inv.vendorId] = {
        vendorId: inv.vendorId,
        vendorName: inv.vendorName,
        vendorCompanyName: inv.vendorCompanyName,
        totalBase: 0,
        totalGst: 0,
        totalEarned: 0,
        totalTransactions: 0,
        pendingInvoices: 0,
        lockedInvoices: 0,
      }
    }
    if (inv.vendorName) byVendor[inv.vendorId].vendorName = inv.vendorName
    if (inv.vendorCompanyName) byVendor[inv.vendorId].vendorCompanyName = inv.vendorCompanyName
    if (inv.status === 'locked') byVendor[inv.vendorId].lockedInvoices += 1
    else byVendor[inv.vendorId].pendingInvoices += 1
  })

  return Object.values(byVendor).sort((a, b) => b.totalEarned - a.totalEarned)
}

// ─── Auto-generation check ──────────────────────────────────────────────────

/**
 * Checks if invoices should be auto-generated for the current period.
 * Runs on Accounting module load. Generates if:
 *   - No invoices exist for the current Saturday–Friday period
 *   - There are transactions in the period
 * Returns true if invoices were generated.
 */
const MAX_WEEKS_PER_AUTOGEN = 8

/**
 * Returns the YYYY-MM-DD `periodStart` (Saturday) of every accounting week
 * whose Saturday lies in [from, to]. Capped to the most recent
 * `MAX_WEEKS_PER_AUTOGEN` weeks to bound regen cost.
 */
const periodStartsInRange = (from: string, to: string): string[] => {
  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T23:59:59.999Z`)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return []
  const cursor = new Date(getPeriodStart(fromDate) + 'T00:00:00.000Z')
  const ends = new Date(getPeriodStart(toDate) + 'T00:00:00.000Z')
  const out: string[] = []
  while (cursor <= ends) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  }
  return out.slice(-MAX_WEEKS_PER_AUTOGEN).reverse()
}

/**
 * Cooldown window (ms) for the auto-generation lease. Until this elapses
 * since the last successful run, every page visit is a single doc read
 * and a no-op return — the 8-week walk doesn't fire. Tuned at 5 minutes
 * because: (a) it's longer than typical refresh-mash cycles, (b) it's
 * shorter than the time it takes to make a fresh booking + immediately
 * audit it. If a cashier creates a booking right now and an Owner
 * refreshes invoices within 5 min, the regen is delayed by at most 5 min.
 */
const AUTO_GENERATE_COOLDOWN_MS = 5 * 60 * 1000
const ACCOUNTING_META_COLLECTION = 'accountingMeta'
const AUTO_GENERATION_LEASE_DOC = 'autoGenerationLease'

/**
 * Try to acquire the auto-generation lease via a Firestore transaction.
 *
 * Returns true and stamps `lastRunAt = now` if the previous run is older
 * than the cooldown window — caller may proceed with the walk.
 *
 * Returns false if a recent run is still within cooldown — caller must
 * skip. Multiple concurrent Owners refreshing the page will see the
 * same cooldown; only the first crosses the boundary.
 *
 * The lease key incorporates the `range` so the cooldown is
 * range-scoped — a different settlements range still gets to run.
 */
const tryAcquireGenerationLease = async (
  fs: NonNullable<ReturnType<typeof getFs>>,
  range: { from: string; to: string } | null,
): Promise<boolean> => {
  const rangeKey = range ? `${range.from}__${range.to}` : 'currentPeriodOnly'
  const leaseRef = doc(fs, ACCOUNTING_META_COLLECTION, AUTO_GENERATION_LEASE_DOC)
  try {
    return await runTransaction(fs, async (tx) => {
      const snap = await tx.get(leaseRef)
      const all = (snap.exists() ? (snap.data() as Record<string, unknown>) : {}) as Record<
        string,
        unknown
      >
      const byRange = (all.byRange as Record<string, string> | undefined) ?? {}
      const lastRunIso = byRange[rangeKey]
      const nowMs = Date.now()
      if (lastRunIso) {
        const lastMs = Date.parse(lastRunIso)
        if (Number.isFinite(lastMs) && nowMs - lastMs < AUTO_GENERATE_COOLDOWN_MS) {
          return false
        }
      }
      // Stamp our claim atomically — the next concurrent reader sees this
      // and bails. We update only the per-range slot to avoid clobbering
      // other ranges' timestamps.
      tx.set(
        leaseRef,
        { byRange: { ...byRange, [rangeKey]: new Date(nowMs).toISOString() } },
        { merge: true },
      )
      return true
    })
  } catch {
    // Transaction can fail under contention (rare). Fall back to letting
    // the walk run — correctness preserved, perf degraded for that one
    // call. No swallowed silent break.
    return true
  }
}

export const autoGenerateIfDue = async (range?: { from: string; to: string }): Promise<boolean> => {
  const fs = getFs()
  if (!fs) return false

  // ── Lease gate: O(1) read-and-set replaces the 8-week walk on the
  // hot path. Without this, every page refresh ran 8 × (full vendor-
  // invoice query + full transactions query) — linear in accounting
  // weeks present. With the lease, that work happens at most once per
  // AUTO_GENERATE_COOLDOWN_MS regardless of how many years of
  // accounting history accumulate.
  const acquired = await tryAcquireGenerationLease(fs, range ?? null)
  if (!acquired) return false

  // Without `range`: current period only.
  // With `range`: walk every accounting week within the window, capped
  // to MAX_WEEKS_PER_AUTOGEN. Locked weeks are skipped automatically by
  // generateFirestoreWeeklyInvoices.
  const periodStartsToCheck = range
    ? periodStartsInRange(range.from, range.to)
    : [getPeriodStart(new Date())]
  let any = false
  for (const periodStart of periodStartsToCheck) {
    const did = await tryAutoGenerateForPeriod(fs, periodStart)
    if (did) any = true
  }
  return any
}

const tryAutoGenerateForPeriod = async (
  fs: NonNullable<ReturnType<typeof getFs>>,
  periodStart: string,
): Promise<boolean> => {
  // Check if invoices already exist for this period
  const existingSnap = await getDocs(
    query(collection(fs, VENDOR_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  if (!existingSnap.empty) {
    // Invoices exist — check if they're stale (deleted/refunded transactions)
    const staleResult = await checkInvoicesStale(periodStart)
    if (!staleResult.stale) return false
    // Stale — regenerate (generateFirestoreWeeklyInvoices already skips locked invoices)
    await generateFirestoreWeeklyInvoices(new Date(`${periodStart}T12:00:00.000Z`))
    return true
  }

  // Check if any transactions exist in the period
  const periodEnd = getPeriodEnd(periodStart)
  const txnSnap = await getDocs(
    query(
      collection(fs, BILLING_TRANSACTIONS_COLLECTION),
      where('transactionDate', '>=', periodStart),
      where('transactionDate', '<=', `${periodEnd}\uf8ff`),
    ),
  )
  if (txnSnap.empty) return false

  await generateFirestoreWeeklyInvoices(new Date(`${periodStart}T12:00:00.000Z`))
  return true
}

// ─── Batch finalize payout with cheque ──────────────────────────────────────

/**
 * Locks all vendor + company invoices for a period, recording the cheque number.
 * Called when Owner downloads the letterhead PDF.
 */
export const finalizePayoutWithCheque = async (
  periodStart: string,
  chequeNumber: string,
  userId: string,
  userName: string,
): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')

  const now = nowIso()

  // Lock all vendor invoices for this period
  const vendorSnap = await getDocs(
    query(collection(fs, VENDOR_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of vendorSnap.docs) {
    if (d.data().status === 'locked') continue
    await updateDoc(doc(fs, VENDOR_INVOICES_COLLECTION, d.id), {
      status: 'locked',
      lockedAt: now,
      chequeNumber,
      payoutInitiatedAt: now,
      payoutInitiatedBy: userName,
    })
    await createFirestoreInvoiceAuditLog('lock', 'vendorInvoice', d.id, userId, userName)
  }

  // Lock company invoice for this period
  const companySnap = await getDocs(
    query(collection(fs, COMPANY_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of companySnap.docs) {
    if (d.data().status === 'locked') continue
    await updateDoc(doc(fs, COMPANY_INVOICES_COLLECTION, d.id), {
      status: 'locked',
      lockedAt: now,
      chequeNumber,
      payoutInitiatedAt: now,
      payoutInitiatedBy: userName,
    })
    await createFirestoreInvoiceAuditLog('lock', 'companyInvoice', d.id, userId, userName)
  }
}

// ─── Stale invoice detection ────────────────────────────────────────────────

/**
 * Checks if invoices for a period are stale (new transactions since last generation).
 * Returns the count of new transactions if stale.
 */
export const checkInvoicesStale = async (
  periodStart: string,
): Promise<{ stale: boolean; newTxnCount: number }> => {
  const fs = getFs()
  if (!fs) return { stale: false, newTxnCount: 0 }

  // Find the latest generatedAt among vendor invoices for this period
  const vendorSnap = await getDocs(
    query(collection(fs, VENDOR_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  if (vendorSnap.empty) return { stale: false, newTxnCount: 0 }

  // If all are locked, not stale (immutable)
  const allLocked = vendorSnap.docs.every((d) => d.data().status === 'locked')
  if (allLocked) return { stale: false, newTxnCount: 0 }

  let latestGeneratedAt = ''
  vendorSnap.docs.forEach((d) => {
    const gen = String(d.data().generatedAt ?? '')
    if (gen > latestGeneratedAt) latestGeneratedAt = gen
  })

  if (!latestGeneratedAt) return { stale: false, newTxnCount: 0 }

  // Count transactions created after the last generation
  const periodEnd = getPeriodEnd(periodStart)
  const txnSnap = await getDocs(
    query(
      collection(fs, BILLING_TRANSACTIONS_COLLECTION),
      where('transactionDate', '>=', periodStart),
      where('transactionDate', '<=', `${periodEnd}\uf8ff`),
    ),
  )

  let newTxnCount = 0
  txnSnap.docs.forEach((d) => {
    const data = d.data()
    // createdAt may be a Firestore Timestamp object or an ISO string — normalise to ISO
    const rawCreatedAt = data.createdAt
    let createdAtIso = ''
    if (
      rawCreatedAt &&
      typeof rawCreatedAt === 'object' &&
      typeof rawCreatedAt.toDate === 'function'
    ) {
      createdAtIso = (rawCreatedAt.toDate() as Date).toISOString()
    } else if (typeof rawCreatedAt === 'string' && rawCreatedAt) {
      createdAtIso = rawCreatedAt
    }
    const paymentStatus = String(data.paymentStatus ?? '')
    // Only count completed transactions as stale indicators
    if (createdAtIso && createdAtIso > latestGeneratedAt && paymentStatus === 'completed')
      newTxnCount++
  })

  if (newTxnCount > 0) return { stale: true, newTxnCount }

  // Check for deleted/refunded transactions: compare invoiced transaction IDs
  // against currently valid transactions
  const invoicedTxnIds = new Set<string>()
  vendorSnap.docs.forEach((d) => {
    const data = d.data()
    if (data.status !== 'locked' && Array.isArray(data.entries)) {
      for (const entry of data.entries as Array<Record<string, unknown>>) {
        if (entry && typeof entry === 'object' && entry.referenceId) {
          invoicedTxnIds.add(String(entry.referenceId))
        }
      }
    }
  })

  const currentValidTxnIds = new Set<string>()
  txnSnap.docs.forEach((d) => {
    const data = d.data()
    if (
      String(data.paymentStatus ?? '') === 'completed' &&
      String(data.refundStatus ?? 'None') !== 'Full' &&
      data.cancelled !== true
    ) {
      currentValidTxnIds.add(d.id)
    }
  })

  const removedCount = [...invoicedTxnIds].filter((id) => !currentValidTxnIds.has(id)).length
  if (removedCount > 0) return { stale: true, newTxnCount: removedCount }

  // Check for ledger debit entries (partial refunds) added after last generation.
  // Partial refunds don't remove the transaction, so the checks above miss them.
  const ledgerSnap = await getDocs(
    query(
      collection(fs, VENDOR_LEDGER_COLLECTION),
      where('date', '>=', periodStart),
      where('date', '<=', `${periodEnd}\uf8ff`),
    ),
  )
  const hasNewDebit = ledgerSnap.docs.some((d) => {
    const data = d.data()
    if (data.type !== 'debit') return false
    const raw = data.createdAt
    let iso = ''
    if (raw && typeof raw === 'object' && typeof raw.toDate === 'function') {
      iso = (raw.toDate() as Date).toISOString()
    } else if (typeof raw === 'string') {
      iso = raw
    }
    return iso > latestGeneratedAt
  })
  if (hasNewDebit) return { stale: true, newTxnCount: 1 }

  return { stale: false, newTxnCount: 0 }
}

// ─── Weekly report (full P&L + per-vendor) ──────────────────────────────────

export interface WeeklyReportLocationRow {
  locationId: string
  gross: number
  baseAmount: number
  gstAmount: number
  refundAmount: number
  vendorShare: number
  companyShare: number
  transactionCount: number
}

export interface WeeklyReportPaymentRow {
  method: string
  amount: number
  count: number
}

export interface WeeklyReportVendorRow {
  vendorId: string
  locationId: string
  grossGenerated: number
  vendorShare: number
  companyShareFromThem: number
  gstContribution: number
  refundDebit: number
  netVendorShare: number
  entryCount: number
  debitCount: number
}

export interface WeeklyReport {
  periodStart: string
  periodEnd: string
  gross: number
  baseAmount: number
  gstAmount: number
  refundAmount: number
  vendorShare: number
  companyShare: number
  netCompanyPL: number
  transactionCount: number
  cancelledCount: number
  fullyRefundedCount: number
  byLocation: WeeklyReportLocationRow[]
  byPaymentMethod: WeeklyReportPaymentRow[]
  byVendor: WeeklyReportVendorRow[]
}

export const getFirestoreWeeklyReport = async (periodStart: string): Promise<WeeklyReport> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  const periodEnd = getPeriodEnd(periodStart)

  // 1. Bookings for the period (by transactionDate).
  const bookingsSnap = await getDocs(
    query(
      collection(fs, BILLING_TRANSACTIONS_COLLECTION),
      where('transactionDate', '>=', periodStart),
      where('transactionDate', '<=', `${periodEnd}\uf8ff`),
    ),
  )

  const report: WeeklyReport = {
    periodStart,
    periodEnd,
    gross: 0,
    baseAmount: 0,
    gstAmount: 0,
    refundAmount: 0,
    vendorShare: 0,
    companyShare: 0,
    netCompanyPL: 0,
    transactionCount: 0,
    cancelledCount: 0,
    fullyRefundedCount: 0,
    byLocation: [],
    byPaymentMethod: [],
    byVendor: [],
  }

  const locMap = new Map<string, WeeklyReportLocationRow>()
  const payMap = new Map<string, WeeklyReportPaymentRow>()

  for (const d of bookingsSnap.docs) {
    const t = mapTransactionRecord(d.id, d.data() as Record<string, unknown>)
    // Trashed bookings must not contribute to the weekly P&L — gross,
    // base, GST, vendor share, company share, transactionCount all
    // skip them. Mirrors the deletedAt guard added to
    // generateFirestoreWeeklyInvoices so the report and the invoices
    // agree on what counts as a real sale for the period.
    if (t.deletedAt) continue
    if (t.cancelled) {
      report.cancelledCount++
      continue
    }
    if (t.paymentStatus && t.paymentStatus !== 'completed') continue
    if (t.refundStatus === 'Full') report.fullyRefundedCount++

    const gross = toNumber(t.totalAmount)
    const base = toNumber(t.baseAmount, gross)
    const gst = toNumber(t.gstAmount)
    const refund = toNumber(t.refundAmount)
    const vShare = toNumber(t.vendorTotal)
    const cShare = toNumber(t.companyTotal, gross - vShare)

    report.gross += gross
    report.baseAmount += base
    report.gstAmount += gst
    report.refundAmount += refund
    report.vendorShare += vShare
    report.companyShare += cShare
    report.transactionCount++

    const locId = normalizeLocationId(String(t.locationId ?? 'unknown'))
    const locRow = locMap.get(locId) ?? {
      locationId: locId,
      gross: 0,
      baseAmount: 0,
      gstAmount: 0,
      refundAmount: 0,
      vendorShare: 0,
      companyShare: 0,
      transactionCount: 0,
    }
    locRow.gross += gross
    locRow.baseAmount += base
    locRow.gstAmount += gst
    locRow.refundAmount += refund
    locRow.vendorShare += vShare
    locRow.companyShare += cShare
    locRow.transactionCount++
    locMap.set(locId, locRow)

    const method = String(t.paymentMethod ?? 'Unknown')
    const payRow = payMap.get(method) ?? { method, amount: 0, count: 0 }
    payRow.amount += gross - refund
    payRow.count++
    payMap.set(method, payRow)
  }

  // Company P&L = company share of net-of-refund revenue (proportional).
  const netRevenue = report.gross - report.refundAmount
  const vendorRatio = report.gross > 0 ? report.vendorShare / report.gross : 0
  report.netCompanyPL = Math.round(netRevenue * (1 - vendorRatio))

  // 2. Vendor ledger for the period — authoritative per-vendor share.
  const ledgerSnap = await getDocs(
    query(
      collection(fs, VENDOR_LEDGER_COLLECTION),
      where('date', '>=', periodStart),
      where('date', '<=', `${periodEnd}\uf8ff`),
    ),
  )

  const vendorMap = new Map<string, WeeklyReportVendorRow>()
  for (const d of ledgerSnap.docs) {
    const data = d.data() as Record<string, unknown>
    // Voided entries (cascaded from softDeleteBooking) must not
    // contribute to the per-vendor row in the weekly report. Without
    // this guard the report and the actual invoiced amount diverge
    // whenever a booking gets trashed.
    if (data.voidedAt) continue
    const vid = String(data.vendorId ?? '')
    if (!vid) continue
    const locId = normalizeLocationId(String(data.locationId ?? 'unknown'))
    const key = `${vid}::${locId}`
    const row = vendorMap.get(key) ?? {
      vendorId: vid,
      locationId: locId,
      grossGenerated: 0,
      vendorShare: 0,
      companyShareFromThem: 0,
      gstContribution: 0,
      refundDebit: 0,
      netVendorShare: 0,
      entryCount: 0,
      debitCount: 0,
    }
    const amount = toNumber(data.amount)
    const gst = toNumber(data.vendorGst)
    if (data.type === 'credit') {
      row.vendorShare += amount
      row.gstContribution += gst
      row.entryCount++
    } else if (data.type === 'debit') {
      row.refundDebit += amount
      row.debitCount++
    }
    vendorMap.set(key, row)
  }

  // 3. Enrich per-vendor with gross/company share from billing transactions.
  for (const d of bookingsSnap.docs) {
    const t = mapTransactionRecord(d.id, d.data() as Record<string, unknown>)
    if (t.deletedAt) continue
    if (t.cancelled || !t.vendorId) continue
    if (t.paymentStatus && t.paymentStatus !== 'completed') continue
    const vid = String(t.vendorId)
    const locId = normalizeLocationId(String(t.locationId ?? 'unknown'))
    const key = `${vid}::${locId}`
    const row = vendorMap.get(key)
    if (!row) continue
    row.grossGenerated += toNumber(t.totalAmount)
    row.companyShareFromThem += toNumber(t.companyTotal)
  }

  for (const row of vendorMap.values()) {
    row.netVendorShare = row.vendorShare - row.refundDebit
  }

  report.byLocation = Array.from(locMap.values()).sort((a, b) => b.gross - a.gross)
  report.byPaymentMethod = Array.from(payMap.values()).sort((a, b) => b.amount - a.amount)
  report.byVendor = Array.from(vendorMap.values()).sort(
    (a, b) => b.netVendorShare - a.netVendorShare,
  )

  return report
}

// ─── Per-invoice cheque & letterhead tracking ────────────────────────────────

/**
 * Save a cheque number on a single invoice (vendor or company).
 */
export const setFirestoreInvoiceChequeNumber = async (
  invoiceId: string,
  chequeNumber: string,
  type: 'vendor' | 'company' = 'vendor',
): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  const col = type === 'company' ? COMPANY_INVOICES_COLLECTION : VENDOR_INVOICES_COLLECTION
  await updateDoc(doc(fs, col, invoiceId), { chequeNumber })
}

/**
 * Record letterhead download timestamp on a single invoice.
 */
export const markFirestoreInvoiceLetterheadDownloaded = async (
  invoiceId: string,
  type: 'vendor' | 'company' = 'vendor',
): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  const col = type === 'company' ? COMPANY_INVOICES_COLLECTION : VENDOR_INVOICES_COLLECTION
  await updateDoc(doc(fs, col, invoiceId), { letterheadDownloadedAt: nowIso() })
}

// ─── Backfill vendorType on historical invoices ─────────────────────────────

/**
 * Backfill: iterates all vendorInvoices missing vendorType.
 * Strategy 1: look up vendorDetails by vendorId (document ID = userId).
 * Strategy 2: match vendorDetails by mobileNumber if vendorId looks like a phone.
 * Strategy 3: infer from the invoice's GST pattern — SubLease vendors have totalGst === 0.
 */
export const backfillVendorTypeOnInvoices = async (): Promise<number> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')

  // Build vendorDetails lookup maps: by doc ID (userId) and by mobileNumber
  const detailsSnap = await getDocs(collection(fs, 'vendorDetails'))
  const typeByUserId = new Map<string, VendorType>()
  const typeByMobile = new Map<string, VendorType>()
  detailsSnap.docs.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    const vt: VendorType = data.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty'
    typeByUserId.set(d.id, vt)
    if (data.mobileNumber) typeByMobile.set(String(data.mobileNumber), vt)
  })

  const invoicesSnap = await getDocs(collection(fs, VENDOR_INVOICES_COLLECTION))
  let updated = 0
  for (const d of invoicesSnap.docs) {
    const data = d.data() as Record<string, unknown>
    if (!data.vendorType && data.vendorId) {
      const vid = String(data.vendorId)
      // Strategy 1: direct lookup by userId
      let vt = typeByUserId.get(vid)
      // Strategy 2: lookup by mobile number
      if (!vt) vt = typeByMobile.get(vid)
      // Strategy 3: infer from GST pattern (SubLease = base only, no GST share)
      if (!vt) {
        const totalGst = typeof data.totalGst === 'number' ? data.totalGst : 0
        const totalAmount = typeof data.totalAmount === 'number' ? data.totalAmount : 0
        vt = totalAmount > 0 && totalGst === 0 ? 'SubLease' : 'ThirdParty'
      }
      await updateDoc(doc(fs, VENDOR_INVOICES_COLLECTION, d.id), { vendorType: vt })
      updated++
    }
  }
  return updated
}

// ─── Locked invoice check (used for pre-delete validation) ───────────────────

/**
 * Returns true if any locked vendor or company invoice covers the given date's
 * weekly period. Used to block booking deletion when accounting has already
 * been locked for that period.
 */
export const hasLockedInvoiceForDate = async (date: Date): Promise<boolean> => {
  const fs = getFs()
  if (!fs) return false
  const ps = getPeriodStart(date)
  try {
    const [vendorSnap, companySnap] = await Promise.all([
      getDocs(
        query(
          collection(fs, VENDOR_INVOICES_COLLECTION),
          where('periodStart', '==', ps),
          where('status', '==', 'locked'),
        ),
      ),
      getDocs(
        query(
          collection(fs, COMPANY_INVOICES_COLLECTION),
          where('periodStart', '==', ps),
          where('status', '==', 'locked'),
        ),
      ),
    ])
    return !vendorSnap.empty || !companySnap.empty
  } catch {
    return false
  }
}

/**
 * Returns true if any vendor invoice covering the booking's accounting
 * period has already been paid out — i.e., it carries a `chequeNumber`
 * or `payoutInitiatedAt` AND contains a ledger entry referencing this
 * booking. Used by the delete-validation guard to permit deletion of
 * refunded bookings ONLY when no money has actually moved to a vendor
 * for them yet.
 *
 * Strict interpretation of "paid": `chequeNumber` or `payoutInitiatedAt`
 * set, not just `status === 'locked'`. A locked-but-not-paid invoice can
 * still be unlocked + edited; a paid-out invoice cannot, since reversing
 * a vendor cheque is an external (banking) action and a delete here
 * would silently desync the books from the bank.
 *
 * Fails closed on Firestore errors — if we can't confirm the vendor
 * wasn't paid, we assume they were.
 */
export const wasVendorPaidForBooking = async (
  bookingId: string,
  bookingDate: Date,
): Promise<boolean> => {
  if (!bookingId) return false
  const fs = getFs()
  if (!fs) return true // fail closed
  const ps = getPeriodStart(bookingDate)
  try {
    const snap = await getDocs(
      query(collection(fs, VENDOR_INVOICES_COLLECTION), where('periodStart', '==', ps)),
    )
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>
      const paidOut = Boolean(data.chequeNumber) || Boolean(data.payoutInitiatedAt)
      if (!paidOut) continue
      const entries = Array.isArray(data.entries) ? (data.entries as Record<string, unknown>[]) : []
      if (entries.some((e) => String(e.referenceId ?? '') === bookingId)) {
        return true
      }
    }
    return false
  } catch {
    return true // fail closed
  }
}

// ─── Location-scoped batch finalize ────────────────────────────────────────

/**
 * Locks all vendor + company invoices for a period AND location, recording the cheque number.
 * Unlike `finalizePayoutWithCheque`, this scopes the lock to a single location.
 * Vendor invoices whose vendorId is in `excludeVendorIds` are left pending.
 */
export const finalizePayoutForLocation = async (
  periodStart: string,
  chequeNumber: string,
  locationId: string,
  userId: string,
  userName: string,
  excludeVendorIds: string[] = [],
): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')

  const now = nowIso()
  const normLoc = normalizeLocationId(locationId)
  const skipSet = new Set(excludeVendorIds)

  // Lock vendor invoices for this period + location
  const vendorSnap = await getDocs(
    query(collection(fs, VENDOR_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of vendorSnap.docs) {
    const data = d.data()
    if (data.status === 'locked') continue
    const invLoc = data.locationId ? normalizeLocationId(String(data.locationId)) : undefined
    if (invLoc !== normLoc) continue
    const vid = String(data.vendorId ?? '')
    if (vid && skipSet.has(vid)) continue
    await updateDoc(doc(fs, VENDOR_INVOICES_COLLECTION, d.id), {
      status: 'locked',
      lockedAt: now,
      chequeNumber,
      payoutInitiatedAt: now,
      payoutInitiatedBy: userName,
    })
    await createFirestoreInvoiceAuditLog('lock', 'vendorInvoice', d.id, userId, userName)
  }

  // Lock company invoices for this period (if location has revenue)
  // Company invoices are the house's cut — never skipped by vendor exclusion list.
  const companySnap = await getDocs(
    query(collection(fs, COMPANY_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of companySnap.docs) {
    const data = d.data()
    if (data.status === 'locked') continue
    const byLoc = data.byLocation as Record<string, number> | undefined
    if (!byLoc || !(normLoc in byLoc) || byLoc[normLoc] <= 0) continue
    await updateDoc(doc(fs, COMPANY_INVOICES_COLLECTION, d.id), {
      status: 'locked',
      lockedAt: now,
      chequeNumber,
      payoutInitiatedAt: now,
      payoutInitiatedBy: userName,
    })
    await createFirestoreInvoiceAuditLog('lock', 'companyInvoice', d.id, userId, userName)
  }
}

// ─── Batch mark letterhead downloaded for a period ─────────────────────────

/**
 * Sets `letterheadDownloadedAt` on all invoices for a period + location.
 * Vendor invoices whose vendorId is in `excludeVendorIds` are left untouched
 * (they stay pending, so they get picked up by the next letterhead run).
 */
export const markPeriodLetterheadDownloaded = async (
  periodStart: string,
  locationId: string,
  excludeVendorIds: string[] = [],
): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')

  const now = nowIso()
  const normLoc = normalizeLocationId(locationId)
  const skipSet = new Set(excludeVendorIds)

  const vendorSnap = await getDocs(
    query(collection(fs, VENDOR_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of vendorSnap.docs) {
    const data = d.data()
    const invLoc = data.locationId ? normalizeLocationId(String(data.locationId)) : undefined
    if (invLoc !== normLoc) continue
    const vid = String(data.vendorId ?? '')
    if (vid && skipSet.has(vid)) continue
    await updateDoc(doc(fs, VENDOR_INVOICES_COLLECTION, d.id), { letterheadDownloadedAt: now })
  }

  const companySnap = await getDocs(
    query(collection(fs, COMPANY_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of companySnap.docs) {
    const data = d.data()
    const byLoc = data.byLocation as Record<string, number> | undefined
    if (!byLoc || !(normLoc in byLoc) || byLoc[normLoc] <= 0) continue
    await updateDoc(doc(fs, COMPANY_INVOICES_COLLECTION, d.id), { letterheadDownloadedAt: now })
  }
}

// ─── Batch update cheque number for a completed period ─────────────────────

/**
 * Updates `chequeNumber` on all invoices for a period + location without
 * changing lock status. Used when re-downloading letterheads for completed periods.
 */
export const updateChequeForLocation = async (
  periodStart: string,
  chequeNumber: string,
  locationId: string,
): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')

  const normLoc = normalizeLocationId(locationId)

  const vendorSnap = await getDocs(
    query(collection(fs, VENDOR_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of vendorSnap.docs) {
    const data = d.data()
    const invLoc = data.locationId ? normalizeLocationId(String(data.locationId)) : undefined
    if (invLoc !== normLoc) continue
    await updateDoc(doc(fs, VENDOR_INVOICES_COLLECTION, d.id), { chequeNumber })
  }

  const companySnap = await getDocs(
    query(collection(fs, COMPANY_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of companySnap.docs) {
    const data = d.data()
    const byLoc = data.byLocation as Record<string, number> | undefined
    if (!byLoc || !(normLoc in byLoc) || byLoc[normLoc] <= 0) continue
    await updateDoc(doc(fs, COMPANY_INVOICES_COLLECTION, d.id), { chequeNumber })
  }
}
