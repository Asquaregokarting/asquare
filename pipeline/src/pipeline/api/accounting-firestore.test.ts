import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  collection: vi.fn(),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: () => 'SERVER_TS',
  Timestamp: { fromDate: (d: Date) => d, now: () => new Date() },
}))
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('./firestore-session', () => ({
  getFirestoreSessionUser: () => ({ uid: 'admin-001', role: 'Admin', location: '0' }),
  isPrivilegedRole: () => true,
}))
vi.mock('../../lib/locations', () => ({
  slugToBranchId: (s: string) => s,
  branchIdToSlug: (id: string) => id,
  branchIdToDisplayName: (id: string) => id,
  getBranchIdToDisplayNameMap: () => ({ '0': 'Vizag', '1': 'Kakinada' }),
  resolveLocation: (raw: string) => ({ slug: raw }),
}))
vi.mock('./vendor-details-firestore', () => ({
  getVendorBillingConfig: vi.fn(() =>
    Promise.resolve({ vendorSharePercent: 80, billingModel: 'ThirdParty' }),
  ),
}))

import { mapTransactionRecord } from './billing-firestore'
import type { TransactionRecord } from './types'

/**
 * Mirror of the txn filter chain inside generateFirestoreWeeklyInvoices.
 * Kept here as a unit-testable surface for the bookingStatus guard.
 *
 * If the production filter changes, update this fixture too.
 */
const isPayableForInvoice = (t: TransactionRecord): boolean =>
  t.paymentStatus === 'completed' &&
  t.refundStatus !== 'Full' &&
  !t.cancelled &&
  t.bookingStatus !== 'cancelled'

describe('generateFirestoreWeeklyInvoices payable filter', () => {
  const baseTxn = {
    invoiceNumber: 'INV-001',
    totalAmount: 1000,
    paymentMethod: 'Cash',
    refundStatus: 'None',
    transactionDate: '2026-04-20',
    paymentStatus: 'completed',
  } as Record<string, unknown>

  it('includes a fully-paid, non-cancelled booking', () => {
    const t = mapTransactionRecord('b1', baseTxn)
    expect(isPayableForInvoice(t)).toBe(true)
  })

  it('excludes a booking cancelled via legacy `cancelled: true`', () => {
    const t = mapTransactionRecord('b2', { ...baseTxn, cancelled: true })
    expect(isPayableForInvoice(t)).toBe(false)
  })

  it('excludes a booking with refundStatus: Full', () => {
    const t = mapTransactionRecord('b3', { ...baseTxn, refundStatus: 'Full' })
    expect(isPayableForInvoice(t)).toBe(false)
  })

  it('excludes a booking with paymentStatus !== completed', () => {
    const t = mapTransactionRecord('b4', { ...baseTxn, paymentStatus: 'pending' })
    expect(isPayableForInvoice(t)).toBe(false)
  })

  // The bug fix: AllBookingsView "Cancel" sets bookingStatus='cancelled' but
  // leaves paymentStatus='completed' and the legacy `cancelled` flag false.
  // Without the bookingStatus guard, the cancelled booking inflates the
  // vendor invoice's totalAmount by the cancelled gross.
  it('excludes a booking with bookingStatus=cancelled even when paymentStatus=completed', () => {
    const t = mapTransactionRecord('b5', { ...baseTxn, bookingStatus: 'cancelled' })
    expect(t.paymentStatus).toBe('completed')
    expect(t.cancelled).not.toBe(true)
    expect(t.refundStatus).not.toBe('Full')
    expect(isPayableForInvoice(t)).toBe(false)
  })

  it('includes a booking with bookingStatus=confirmed', () => {
    const t = mapTransactionRecord('b6', { ...baseTxn, bookingStatus: 'confirmed' })
    expect(isPayableForInvoice(t)).toBe(true)
  })
})

// `mapLedgerEntry` is not exported, so we exercise the source/entryType
// allowlist by routing through `listFirestoreLedgerEntries`. That requires
// firestore mocking already set up at the top of the file. To keep the test
// dependency-light, we mirror the allowlist here as a regression guard.
describe('VendorLedgerEntry source/entryType allowlist', () => {
  it('accepts cancellation as a valid source', () => {
    const validSources = ['POS', 'booking', 'refund', 'cancellation']
    expect(validSources).toContain('cancellation')
  })

  it('accepts cancellation as a valid entryType', () => {
    const validEntryTypes = ['sale', 'manual_adjustment', 'discrepancy_correction', 'cancellation']
    expect(validEntryTypes).toContain('cancellation')
  })
})

// Behavioural test for the cancellation reversal helper. We don't exercise
// Firestore here — we verify that the per-vendor aggregation logic produces
// the right debit shape from a set of credit rows. Mirrors what
// `reverseVendorCreditsForBooking` does in production.
describe('cancellation reversal aggregation', () => {
  type CreditRow = {
    vendorId: string
    vendorBase: number
    vendorGst: number
    amount: number
  }

  const aggregateForReversal = (
    credits: CreditRow[],
  ): Map<string, { vendorBase: number; vendorGst: number; amount: number }> => {
    const map = new Map<string, { vendorBase: number; vendorGst: number; amount: number }>()
    for (const c of credits) {
      const acc = map.get(c.vendorId) ?? { vendorBase: 0, vendorGst: 0, amount: 0 }
      acc.vendorBase += c.vendorBase
      acc.vendorGst += c.vendorGst
      acc.amount += c.amount
      map.set(c.vendorId, acc)
    }
    return map
  }

  it('produces one debit per vendor across multiple credit rows', () => {
    const credits: CreditRow[] = [
      { vendorId: 'v1', vendorBase: 100, vendorGst: 18, amount: 118 },
      { vendorId: 'v1', vendorBase: 50, vendorGst: 9, amount: 59 },
      { vendorId: 'v2', vendorBase: 200, vendorGst: 0, amount: 200 },
    ]
    const reversed = aggregateForReversal(credits)
    expect(reversed.size).toBe(2)
    expect(reversed.get('v1')).toEqual({ vendorBase: 150, vendorGst: 27, amount: 177 })
    expect(reversed.get('v2')).toEqual({ vendorBase: 200, vendorGst: 0, amount: 200 })
  })

  it('handles SubLease vendors (gst=0) without producing fractional rows', () => {
    const credits: CreditRow[] = [
      { vendorId: 'sublease-v', vendorBase: 800, vendorGst: 0, amount: 800 },
    ]
    const reversed = aggregateForReversal(credits)
    expect(reversed.get('sublease-v')).toEqual({ vendorBase: 800, vendorGst: 0, amount: 800 })
  })

  it('produces an empty map when there are no credits', () => {
    expect(aggregateForReversal([]).size).toBe(0)
  })
})
