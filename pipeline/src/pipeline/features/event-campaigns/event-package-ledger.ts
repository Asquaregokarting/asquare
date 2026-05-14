/**
 * Event Package Vendor Ledger Writer — customer-online path.
 *
 * The POS path writes `vendorLedger` entries inside `createFirestoreBillingTransaction`
 * (billing-firestore.ts) automatically because POS items flow through
 * `createUnifiedBooking` → `enrichItemsWithBilling`, which feeds the vendor split
 * pipeline at sale time.
 *
 * The customer-online path (Razorpay → bookingService.confirmDraftBooking) does NOT
 * go through that pipeline, so when a customer buys an event package containing
 * third-party items, no ledger entries get written unless this helper is invoked
 * post-payment.
 *
 * Called from `src/pages/Checkout.tsx` after `bookingService.confirmDraftBooking`
 * returns successfully. Non-blocking — failures are logged but never fail the
 * booking (which is already confirmed and paid by that point).
 */
import { collection, doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { logger } from '../../../lib/logger'
import { computeRevenueSplit } from '../../../lib/unified-booking'
import type { VendorLedgerEntry } from '../../api/types'
import type { EventPackageItem } from './event-campaign-types'

const GST_PERCENT = 18
const VENDOR_SHARE_DEFAULT = 80
const VENDOR_LEDGER_COLLECTION = 'vendorLedger'

export interface EventPackageCartAttachment {
  campaignId: string
  packageId: string
  locationKey: string
  items: EventPackageItem[]
}

interface WriteParams {
  bookingId: string
  invoiceNumber?: string
  locationId?: string
  transactionDate: string
  /** One group per package cart line, each carrying the per-item breakdown and the qty bought. */
  items: Array<{
    items: EventPackageItem[]
    quantity: number
  }>
}

/**
 * Walks all package items, skips non-thirdParty ones, groups by vendorId, computes
 * per-vendor totals via computeRevenueSplit (honouring the per-item revenueShare flag),
 * and writes one credit VendorLedgerEntry per vendor to `vendorLedger`.
 *
 * Item semantics:
 * - `type !== 'thirdParty'`  → skipped (company revenue, not ledger-tracked).
 * - `type === 'thirdParty'` + no `vendorId` → skipped (untracked third party).
 * - `type === 'thirdParty'` + `revenueShare === true`  → split per vendorDetails.revenueShare.
 * - `type === 'thirdParty'` + `revenueShare === false` → 100% to vendor (override share).
 */
export const writeEventPackageVendorLedger = async (params: WriteParams): Promise<void> => {
  type Row = {
    vendorId: string
    base: number
    gst: number
    shareOverride: number | null
  }

  // 1. Flatten packages into a list of vendor rows
  const rows: Row[] = []
  for (const group of params.items) {
    const qty = Math.max(1, Math.floor(group.quantity))
    for (const it of group.items) {
      if (it.type !== 'thirdParty' || !it.vendorId) continue
      const price = Number(it.price) || 0
      if (price <= 0) continue
      const gross = price * qty
      const base = Math.round((gross * 100) / (100 + GST_PERCENT))
      const gst = gross - base
      const shareOverride = it.revenueShare === false ? 100 : null
      rows.push({ vendorId: it.vendorId, base, gst, shareOverride })
    }
  }
  if (rows.length === 0) return

  // 2. Resolve each vendor's share percent (from vendorDetails when no override)
  const uniqueVendorIds = [...new Set(rows.map((r) => r.vendorId))]
  const vendorShares = new Map<string, number>()
  await Promise.all(
    uniqueVendorIds.map(async (vid) => {
      try {
        const snap = await getDoc(doc(db, 'vendorDetails', vid))
        if (!snap.exists()) {
          vendorShares.set(vid, VENDOR_SHARE_DEFAULT)
          return
        }
        const data = snap.data() as Record<string, unknown>
        const stored =
          typeof data.revenueShare === 'number' ? data.revenueShare : VENDOR_SHARE_DEFAULT
        vendorShares.set(vid, Math.min(100, Math.max(0, stored)))
      } catch {
        vendorShares.set(vid, VENDOR_SHARE_DEFAULT)
      }
    }),
  )

  // 3. Compute splits per row, group by vendor
  const ledgerByVendor = new Map<string, { vendorBase: number; vendorGst: number }>()
  for (const row of rows) {
    const share = row.shareOverride ?? vendorShares.get(row.vendorId) ?? VENDOR_SHARE_DEFAULT
    const split = computeRevenueSplit(row.base, row.gst, share, 'ThirdParty')
    const acc = ledgerByVendor.get(row.vendorId) ?? { vendorBase: 0, vendorGst: 0 }
    acc.vendorBase += split.vendorBase
    acc.vendorGst += split.vendorGst
    ledgerByVendor.set(row.vendorId, acc)
  }

  // 4. Write one credit VendorLedgerEntry per vendor
  const createdAt = new Date().toISOString()
  for (const [vendorId, totals] of ledgerByVendor.entries()) {
    const amount = totals.vendorBase + totals.vendorGst
    if (amount <= 0) continue
    const entry: VendorLedgerEntry = {
      id: `le-${params.bookingId}-${vendorId}`,
      vendorId,
      vendorBase: totals.vendorBase,
      vendorGst: totals.vendorGst,
      amount,
      type: 'credit',
      referenceId: params.bookingId,
      invoiceNumber: params.invoiceNumber,
      locationId: params.locationId,
      date: params.transactionDate,
      createdAt,
      source: 'booking',
    }
    try {
      const entryDoc = {
        ...entry,
        // Firestore cannot serialise undefined; strip them.
        invoiceNumber: entry.invoiceNumber ?? null,
        locationId: entry.locationId ?? null,
      }
      await setDoc(doc(collection(db, VENDOR_LEDGER_COLLECTION), entry.id), entryDoc)
    } catch (err) {
      logger.error('event_package.ledger_write_failed', err, {
        bookingId: params.bookingId,
        vendorId,
      })
    }
  }
}
