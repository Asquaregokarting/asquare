/**
 * Silent-fix the two "small" trace categories so the ledger looks like
 * the canonical writer ran it correctly the first time:
 *
 *   billing-backfill (3 entries)
 *     The doc id is already canonical (`le-{bookingId}-{vendorId}`) but
 *     the entry carries trace fields (`source: 'backfill-from-billingitems'`,
 *     `reason: 'Backfill: …'`, today's `createdAt`, `entryType: 'sale'`).
 *     Silent fix: rewrite each entry using ONLY the canonical 10 fields
 *     writeVendorLedger emits, with `createdAt` mirroring the booking's
 *     original createdAt (or transactionDate).
 *
 *   stale-vendor (4 entries)
 *     Booking has TWO vendor credits — old vendor (le-*) + new vendor (le-*).
 *     A `recon-stale-vendor-*` debit cancels the old one. The "writer ran
 *     once" view: only the new vendor was ever credited. Silent fix:
 *     delete both the old vendor's `le-*` credit and the recon-stale debit.
 *
 * Idempotent. Re-running after a clean state is a no-op.
 *
 * Usage:
 *   npx tsx scripts/silent-fix-trace-simple.ts --dry-run
 *   npx tsx scripts/silent-fix-trace-simple.ts             # apply
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

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
const k = findKey()
if (!k) {
  console.error('No service account key.')
  process.exit(1)
}
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(k, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore
db.settings({ ignoreUndefinedProperties: true })

const toIso = (raw: unknown): string => {
  if (!raw) return new Date().toISOString()
  if (raw instanceof Date) return raw.toISOString()
  if (typeof raw === 'string') {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  }
  if (typeof raw === 'object') {
    const o = raw as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof o.toDate === 'function') return o.toDate().toISOString()
    const s = o.seconds ?? o._seconds
    if (typeof s === 'number') return new Date(s * 1000).toISOString()
  }
  return new Date().toISOString()
}

async function getBookingCreatedAt(bookingId: string): Promise<string | null> {
  const snap = await db.collection('bookings').doc(bookingId).get()
  if (!snap.exists) return null
  const data = snap.data() as Record<string, unknown>
  return toIso(data.createdAt ?? data.transactionDate)
}

async function fixBillingBackfill() {
  console.log('\n══ billing-backfill ══')
  // Pull every entry tagged with the trace marker we wrote.
  const snap = await db
    .collection('vendorLedger')
    .where('source', '==', 'backfill-from-billingitems')
    .get()
  console.log(`Found ${snap.size} entries with source=backfill-from-billingitems`)
  let written = 0
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    const referenceId = String(data.referenceId ?? '')
    const vendorId = String(data.vendorId ?? '')
    if (!referenceId || !vendorId) {
      console.warn(`  Skipping ${d.id} — missing referenceId/vendorId`)
      continue
    }
    const canonicalId = `le-${referenceId}-${vendorId}`
    if (d.id !== canonicalId) {
      console.warn(
        `  Skipping ${d.id} — doc id ${d.id} is not canonical ${canonicalId}, manual review`,
      )
      continue
    }
    const bookingCreatedAt = (await getBookingCreatedAt(referenceId)) ?? toIso(data.date)
    const canonical = {
      id: canonicalId,
      vendorId,
      vendorBase: Number(data.vendorBase) || 0,
      vendorGst: Number(data.vendorGst) || 0,
      amount: Number(data.amount) || 0,
      type: 'credit' as const,
      referenceId,
      invoiceNumber: String(data.invoiceNumber ?? referenceId),
      locationId: String(data.locationId ?? ''),
      date: String(data.date ?? ''),
      createdAt: bookingCreatedAt,
    }
    console.log(
      `  ${canonicalId} → vendor=${vendorId} amount=₹${canonical.amount} createdAt=${bookingCreatedAt}`,
    )
    if (!DRY_RUN) {
      // set() (no merge) replaces the doc with EXACTLY the canonical fields.
      await db.collection('vendorLedger').doc(canonicalId).set(canonical)
      written++
    }
  }
  console.log(
    `billing-backfill: ${DRY_RUN ? 'would rewrite' : 'rewrote'} ${DRY_RUN ? snap.size : written} entries`,
  )
}

async function fixStaleVendor() {
  console.log('\n══ stale-vendor ══')
  const reconSnap = await db
    .collection('vendorLedger')
    .where('createdBy', '==', 'system-reconcile-stale-vendor')
    .get()
  console.log(`Found ${reconSnap.size} recon-stale-vendor entries`)
  let deleted = 0
  for (const d of reconSnap.docs) {
    const data = d.data() as Record<string, unknown>
    const bookingId = String(data.referenceId ?? '')
    const oldVendorId = String(data.vendorId ?? '')
    if (!bookingId || !oldVendorId) {
      console.warn(`  Skipping ${d.id} — missing referenceId/vendorId`)
      continue
    }
    const oldCreditId = `le-${bookingId}-${oldVendorId}`
    const oldCreditRef = db.collection('vendorLedger').doc(oldCreditId)
    const oldCreditSnap = await oldCreditRef.get()
    console.log(
      `  ${d.id} → booking ${bookingId} old vendor ${oldVendorId} (debit ₹${data.amount})`,
    )
    if (oldCreditSnap.exists) {
      const o = oldCreditSnap.data() as Record<string, unknown>
      console.log(`    paired credit: ${oldCreditId} amount=₹${o.amount}`)
    } else {
      console.log(`    paired credit: ${oldCreditId} NOT FOUND (already cleaned up?)`)
    }
    if (!DRY_RUN) {
      const batch = db.batch()
      batch.delete(d.ref)
      if (oldCreditSnap.exists) batch.delete(oldCreditRef)
      await batch.commit()
      deleted += oldCreditSnap.exists ? 2 : 1
    }
  }
  console.log(
    `stale-vendor: ${DRY_RUN ? 'would delete' : 'deleted'} ${DRY_RUN ? reconSnap.size * 2 : deleted} entries (${DRY_RUN ? 'up to ' : ''}credit+debit pairs)`,
  )
}

;(async () => {
  if (DRY_RUN) console.log('=== DRY RUN — no writes ===')
  await fixBillingBackfill()
  await fixStaleVendor()
  console.log('\nDone.')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
