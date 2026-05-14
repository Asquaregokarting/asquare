/**
 * Targeted reconciliation for paid bookings where the vendor ledger has
 * MORE credits than the booking's billingItems claims (and not because
 * of a refund). Pattern is:
 *
 *   billingItems[].vendorTotal sum = ₹X
 *   sum of vendorLedger 'credit' entries for this booking = ₹X + ₹Y
 *   refundStatus = 'None' / unset
 *
 * Cause: a vendor was reassigned on a single activity in the catalog,
 * after the booking was already stamped with the OLD vendor id. The
 * payment-completion writer then ran a second time using the new catalog
 * snapshot and wrote a credit for the NEW vendor too — leaving both old
 * and new vendor with credits for one sale.
 *
 * The fix: write a `discrepancy_correction` DEBIT for each "stale" vendor
 * (the one in the ledger but NOT in current billingItems). Net total
 * across the booking returns to billingItems-vendorTotal.
 *
 * Usage:
 *   npx tsx scripts/reconcile-stale-vendor-credits.ts --dry-run
 *   npx tsx scripts/reconcile-stale-vendor-credits.ts            # apply
 *
 * Idempotent: doc IDs are deterministic (`recon-stale-vendor-{bookingId}-{vendorId}`)
 * so re-runs overwrite the same correction.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const DATABASE = 'asquare-app-db'
const TOLERANCE_INR = 1
const TODAY_ISO = new Date().toISOString().slice(0, 10)

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

const findKey = (): string | null => {
  for (const c of [
    'serviceAccountKey.json',
    'service-account-key.json',
    'firebase-admin-key.json',
    'scripts/serviceAccountKey.json',
  ]) {
    const p = path.resolve(c)
    if (fs.existsSync(p)) return p
  }
  return null
}
const initAdmin = () => {
  if (getApps().length > 0) return
  const k = findKey()
  if (k) {
    console.log(`Using service account key: ${k}`)
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(k, 'utf-8'))) })
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) initializeApp()
  else {
    console.error('No service account key found.')
    process.exit(1)
  }
}

interface Correction {
  ledgerId: string
  bookingId: string
  vendorId: string
  amount: number
  reason: string
  bookingDate: string
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE) as Firestore

  console.log('Loading vendor ledger…')
  const ledgerSnap = await db.collection('vendorLedger').get()
  // For each booking, sum signed credits per vendor (skip
  // discrepancy_correction entries we wrote earlier so we don't double-fix).
  const byBookingVendor = new Map<string, Map<string, number>>()
  for (const d of ledgerSnap.docs) {
    const data = d.data() as Record<string, unknown>
    const ref = String(data.referenceId ?? data.bookingId ?? '')
    const vid = String(data.vendorId ?? '')
    if (!ref || !vid) continue
    if (data.entryType === 'discrepancy_correction') continue // skip our own past corrections
    const amt = Number(data.amount ?? data.vendorTotal ?? 0) || 0
    const signed = data.type === 'debit' ? -amt : amt
    let inner = byBookingVendor.get(ref)
    if (!inner) {
      inner = new Map<string, number>()
      byBookingVendor.set(ref, inner)
    }
    inner.set(vid, (inner.get(vid) ?? 0) + signed)
  }

  console.log('Loading bookings…')
  const bookingsSnap = await db.collection('bookings').get()

  const corrections: Correction[] = []
  for (const bDoc of bookingsSnap.docs) {
    const b = bDoc.data() as Record<string, unknown>
    if (b.paymentStatus !== 'completed') continue
    const refundStatus = String(b.refundStatus ?? 'None')
    if (refundStatus !== 'None' && refundStatus !== '') continue // refund accounting handles itself

    // Skip event-package bookings (Summer Vibes etc.). onBookingPaid writes
    // per-package-item vendor credits using its own logic — billingItems
    // covers only a subset of those vendors. The legitimate ledger > billing
    // gap there is by-design and is reconciled by the dedicated Summer Vibes
    // / event-package reconciliation script, not here.
    //
    // Detection: category='Event' OR activity.id starts with 'evt-' OR name
    // contains 'Summer Vibes'. The name-based check catches legacy bookings
    // whose items[] entries don't carry the modern category stamp.
    const items = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : []
    const isEventPackageBooking = items.some((it) => {
      const a = (it.activity as Record<string, unknown> | undefined) ?? {}
      const cat = String(a.category ?? '').toLowerCase()
      const id = String(a.id ?? '')
      const name = String(it.itemName ?? a.name ?? '')
      return cat === 'event' || id.startsWith('evt-') || /Summer\s*Vibes\b/i.test(name)
    })
    if (isEventPackageBooking) continue

    const billingItems = Array.isArray(b.billingItems)
      ? (b.billingItems as Array<Record<string, unknown>>)
      : []
    if (billingItems.length === 0) continue

    // Per-vendor: what billingItems CURRENTLY says
    const billingByVendor = new Map<string, number>()
    for (const bi of billingItems) {
      const vid = String(bi.vendorId ?? '').trim()
      if (!vid) continue
      const total = Number(bi.vendorTotal) || 0
      if (total <= 0) continue
      billingByVendor.set(vid, (billingByVendor.get(vid) ?? 0) + total)
    }

    const ledgerVendors = byBookingVendor.get(bDoc.id)
    if (!ledgerVendors) continue

    // Stale vendor: present in ledger with positive credit but NOT in current
    // billingItems at all. We deliberately do NOT flag the case where the
    // SAME vendor has more in ledger than billingItems — that's how BOGO
    // compensation legitimately shows up (e.g., Summer Vibes vendor owed
    // for the free unit even though billingItems only counts paid units).
    for (const [vid, ledgerAmt] of ledgerVendors.entries()) {
      if (ledgerAmt <= TOLERANCE_INR) continue
      const billingHasVendor = billingByVendor.has(vid)
      if (billingHasVendor) continue // same vendor delta → NOT a stale-vendor case
      const bookingDate =
        typeof b.transactionDate === 'string' && b.transactionDate.length >= 10
          ? b.transactionDate.slice(0, 10)
          : 'unknown'
      corrections.push({
        ledgerId: `recon-stale-vendor-${bDoc.id}-${vid}`,
        bookingId: bDoc.id,
        vendorId: vid,
        amount: Math.round(ledgerAmt),
        reason: `Stale-vendor reconciliation: ledger credited ${vid} ₹${Math.round(ledgerAmt)} on booking ${bDoc.id} but current billingItems no longer assigns this vendor any share. Debit reverses the orphan credit (vendor was reassigned mid-life).`,
        bookingDate,
      })
    }
  }

  console.log(`\n── Plan ──`)
  console.log(`Bookings scanned: ${bookingsSnap.size}`)
  console.log(`Corrections planned: ${corrections.length}`)
  if (corrections.length === 0) {
    console.log('Nothing to reconcile. Exiting.')
    return
  }
  const totalDebit = corrections.reduce((s, c) => s + c.amount, 0)
  console.log(`Total debit amount: ₹${totalDebit}`)

  console.log(`\nDetail:`)
  for (const c of corrections) {
    console.log(`  ${c.bookingId} (${c.bookingDate}) → debit vendor ${c.vendorId} ₹${c.amount}`)
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] No writes performed. Re-run without --dry-run to apply.')
    return
  }

  console.log(`\nApplying ${corrections.length} correction debits…`)
  const nowIso = new Date().toISOString()
  const batch = db.batch()
  for (const c of corrections) {
    batch.set(db.collection('vendorLedger').doc(c.ledgerId), {
      id: c.ledgerId,
      vendorId: c.vendorId,
      amount: c.amount,
      type: 'debit',
      entryType: 'discrepancy_correction',
      referenceId: c.bookingId,
      invoiceNumber: c.bookingId,
      date: TODAY_ISO,
      createdAt: nowIso,
      source: 'booking',
      reason: c.reason,
      linkedBookingIds: [c.bookingId],
      createdBy: 'system-reconcile-stale-vendor',
      createdByName: 'Stale-vendor reconciliation',
    })
  }
  await batch.commit()
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
