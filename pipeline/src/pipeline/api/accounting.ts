/**
 * Accounting API facade.
 * Always uses Firestore — there is no HTTP/mock fallback for accounting data.
 */

import {
  autoGenerateIfDue,
  backfillVendorLedgerForRange,
  backfillVendorTypeOnInvoices,
  checkInvoicesStale,
  createFirestoreInvoiceAuditLog,
  createLedgerAdjustment,
  CreateLedgerAdjustmentInput,
  finalizePayoutForLocation,
  finalizePayoutWithCheque,
  updateChequeForLocation,
  generateFirestoreWeeklyInvoices,
  getCurrentAccountingWeek,
  getFirestoreVendorSettlements,
  getFirestoreWeeklyReport,
  listAccountingTransactions,
  listFirestoreCompanyInvoices,
  listFirestoreLedgerEntries,
  listFirestoreVendorInvoices,
  lockFirestoreCompanyInvoice,
  lockFirestoreVendorInvoice,
  markFirestoreInvoiceLetterheadDownloaded,
  markPeriodLetterheadDownloaded,
  setFirestoreInvoiceChequeNumber,
  unlockFirestoreCompanyInvoice,
  unlockFirestoreVendorInvoice,
  validateInvoiceBeforeLock,
  VendorLedgerBackfillResult,
  VendorSettlementSummary,
  WeeklyReport,
} from './accounting-firestore'
import { CompanyInvoice, TransactionRecord, VendorInvoice, VendorLedgerEntry } from './types'

export const accountingApi = {
  /** All ledger entries. Vendors see only their own. */
  listLedger(vendorId?: string): Promise<VendorLedgerEntry[]> {
    return listFirestoreLedgerEntries(vendorId)
  },

  /** All billing transactions (read-only view). Vendors see only their own. */
  listTransactions(vendorId?: string): Promise<TransactionRecord[]> {
    return listAccountingTransactions(vendorId)
  },

  /**
   * Vendor invoices, bounded to a `periodStart` window when `range` is
   * supplied. The page-level UI must always pass a range so the read
   * stays bounded as accounting weeks accumulate over years. Vendors
   * see only their own.
   */
  listVendorInvoices(
    vendorId?: string,
    range?: { from?: string; to?: string },
  ): Promise<VendorInvoice[]> {
    return listFirestoreVendorInvoices(vendorId, range)
  },

  /** Company invoices, bounded to a window when `range` is supplied
   *  (Owner/Admin only). */
  listCompanyInvoices(range?: { from?: string; to?: string }): Promise<CompanyInvoice[]> {
    return listFirestoreCompanyInvoices(range)
  },

  /**
   * Generate (or refresh) weekly invoices for the given date (defaults to today).
   * Locked invoices are preserved automatically.
   */
  generateWeeklyInvoices(
    forDate?: Date,
  ): Promise<{ vendorInvoices: VendorInvoice[]; companyInvoice: CompanyInvoice }> {
    return generateFirestoreWeeklyInvoices(forDate)
  },

  async lockVendorInvoice(invoiceId: string, userId?: string, userName?: string): Promise<void> {
    await lockFirestoreVendorInvoice(invoiceId)
    if (userId && userName) {
      await createFirestoreInvoiceAuditLog('lock', 'vendorInvoice', invoiceId, userId, userName)
    }
  },

  async lockCompanyInvoice(invoiceId: string, userId?: string, userName?: string): Promise<void> {
    await lockFirestoreCompanyInvoice(invoiceId)
    if (userId && userName) {
      await createFirestoreInvoiceAuditLog('lock', 'companyInvoice', invoiceId, userId, userName)
    }
  },

  async unlockVendorInvoice(invoiceId: string, userId: string, userName: string): Promise<void> {
    await unlockFirestoreVendorInvoice(invoiceId)
    await createFirestoreInvoiceAuditLog('unlock', 'vendorInvoice', invoiceId, userId, userName)
  },

  async unlockCompanyInvoice(invoiceId: string, userId: string, userName: string): Promise<void> {
    await unlockFirestoreCompanyInvoice(invoiceId)
    await createFirestoreInvoiceAuditLog('unlock', 'companyInvoice', invoiceId, userId, userName)
  },

  /** Settlement summary per vendor (Owner/Admin only). Optional date range scopes the totals. */
  getSettlements(range?: { from: string; to: string }): Promise<VendorSettlementSummary[]> {
    return getFirestoreVendorSettlements(range)
  },

  /** Current accounting week (Saturday → Friday, IST) as YYYY-MM-DD strings. */
  getCurrentAccountingWeek(): { from: string; to: string } {
    return getCurrentAccountingWeek()
  },

  /**
   * Auto-generate invoices if due (client-side check on module load).
   * Without `range`, regenerates only the current accounting week.
   * With `range`, regenerates every accounting week whose Saturday falls in
   * `[range.from, range.to]`, capped to the most recent 8 weeks.
   */
  autoGenerateIfDue(range?: { from: string; to: string }): Promise<boolean> {
    return autoGenerateIfDue(range)
  },

  /** Lock all invoices for a period with cheque number (batch payout). */
  finalizePayoutWithCheque(
    periodStart: string,
    chequeNumber: string,
    userId: string,
    userName: string,
  ): Promise<void> {
    return finalizePayoutWithCheque(periodStart, chequeNumber, userId, userName)
  },

  /** Check if invoices for a period have new transactions since last generation. */
  checkInvoicesStale(periodStart: string): Promise<{ stale: boolean; newTxnCount: number }> {
    return checkInvoicesStale(periodStart)
  },

  /** Full weekly report — P&L totals, per-location, per-payment-method, per-vendor. */
  getWeeklyReport(periodStart: string): Promise<WeeklyReport> {
    return getFirestoreWeeklyReport(periodStart)
  },

  /** Save cheque number on a single invoice. */
  setInvoiceChequeNumber(
    invoiceId: string,
    chequeNumber: string,
    type: 'vendor' | 'company' = 'vendor',
  ): Promise<void> {
    return setFirestoreInvoiceChequeNumber(invoiceId, chequeNumber, type)
  },

  /** Record letterhead download timestamp on a single invoice. */
  markLetterheadDownloaded(
    invoiceId: string,
    type: 'vendor' | 'company' = 'vendor',
  ): Promise<void> {
    return markFirestoreInvoiceLetterheadDownloaded(invoiceId, type)
  },

  /** Backfill vendorType on historical invoices (admin-only, one-time). */
  backfillVendorType(): Promise<number> {
    return backfillVendorTypeOnInvoices()
  },

  /** Validate invoice totals against ledger data before locking. */
  validateBeforeLock(
    invoiceId: string,
    type: 'vendor' | 'company',
  ): Promise<{ valid: boolean; errors: string[] }> {
    return validateInvoiceBeforeLock(invoiceId, type)
  },

  /**
   * Lock all invoices for a period + location with cheque number (location-scoped batch payout).
   * Vendor invoices whose vendorId is in `excludeVendorIds` are left pending.
   */
  finalizePayoutForLocation(
    periodStart: string,
    chequeNumber: string,
    locationId: string,
    userId: string,
    userName: string,
    excludeVendorIds: string[] = [],
  ): Promise<void> {
    return finalizePayoutForLocation(
      periodStart,
      chequeNumber,
      locationId,
      userId,
      userName,
      excludeVendorIds,
    )
  },

  /**
   * Batch mark letterheadDownloadedAt on all invoices for a period + location.
   * Vendor invoices whose vendorId is in `excludeVendorIds` are left untouched.
   */
  markPeriodLetterheadDownloaded(
    periodStart: string,
    locationId: string,
    excludeVendorIds: string[] = [],
  ): Promise<void> {
    return markPeriodLetterheadDownloaded(periodStart, locationId, excludeVendorIds)
  },

  /** Update cheque number on all invoices for a completed period + location (no lock change). */
  updateChequeForLocation(
    periodStart: string,
    chequeNumber: string,
    locationId: string,
  ): Promise<void> {
    return updateChequeForLocation(periodStart, chequeNumber, locationId)
  },

  /**
   * Re-run weekly invoice generation across every Saturday-week in [from, to].
   * Because generation is now self-healing (writes missing vendorLedger rows
   * for any booking it sees), this also backfills the ledger for sources that
   * bypassed the runtime trigger. Locked invoices remain untouched.
   */
  backfillVendorLedger(params: { from: string; to: string }): Promise<VendorLedgerBackfillResult> {
    return backfillVendorLedgerForRange(params.from, params.to)
  },

  /**
   * Owner/Admin: write a manual vendor ledger credit (or debit) — used to
   * compensate vendors for attribution incidents (`discrepancy_correction`)
   * or any other off-cycle correction (`manual_adjustment`). The entry rolls
   * into the next weekly invoice for that vendor.
   */
  createLedgerAdjustment(input: CreateLedgerAdjustmentInput): Promise<VendorLedgerEntry> {
    return createLedgerAdjustment(input)
  },
}
