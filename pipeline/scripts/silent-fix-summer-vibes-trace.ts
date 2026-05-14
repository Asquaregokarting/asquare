/**
 * Silent-fix the Summer Vibes config-correction trace so each booking's
 * vendor ledger looks like the canonical writer (writeVendorLedger /
 * onBookingPaid) ran once with the CORRECTED campaign config:
 *
 *   For every booking that has at least one `recon-summer-vibes-*`
 *   correction entry:
 *     1. Aggregate signed amounts per vendor across ALL ledger entries
 *        for this booking (original `le-*` credit + each correction).
 *        That sum is the post-correction "expected" total.
 *     2. For every vendor with expected > 0:
 *          - Write the canonical `le-{bookingId}-{vendorId}` doc with
 *            the 10 fields writeVendorLedger emits (no entryType, no
 *            source, no reason, no createdBy).
 *          - vendorBase / vendorGst split via 18% GST extraction so it
 *            round-trips like the live writer's output.
 *     3. For every vendor with expected == 0 (e.g. original credit
 *        cancelled by debit): delete its `le-*` entry.
 *     4. Delete every `recon-summer-vibes-{bookingId}-*` entry.
 *
 * The booking document is NOT mutated. Items[]/billingItems[] remain as
 * they were stamped at sale time (the customer-paid-X-for-Y record is
 * intentionally immutable). Only the ledger is rewritten — that's where
 * the trace markers lived.
 *
 * Idempotent. Re-running on a clean booking is a no-op.
 *
 * Usage:
 *   npx tsx scripts/silent-fix-summer-vibes-trace.ts --dry-run
 *   npx tsx scripts/silent-fix-summer-vibes-trace.ts --booking ASG260502... # single booking
 *   npx tsx scripts/silent-fix-summer-vibes-trace.ts                       # apply all
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const SINGLE_BOOKING = args.find((a, i) => args[i - 1] === '--booking') ?? null

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

const dateOnly = (raw: unknown): string => {
  if (typeof raw === 'string' && raw.length >= 10) return raw.slice(0, 10)
  return toIso(raw).slice(0, 10)
}

interface CanonicalEntry {
  id: string
  vendorId: string
  vendorBase: number
  vendorGst: number
  amount: number
  type: 'credit'
  referenceId: string
  invoiceNumber: string
  locationId: string
  date: string
  createdAt: string
}

interface BookingPlan {
  bookingId: string
  invoiceNumber: string
  locationId: string
  date: string
  createdAt: string
  perVendor: Map<string, number> // signed sum of all current ledger entries
  reconDocIds: string[] // recon-summer-vibes-* docs to delete
  existingLeIds: string[] // existing le-{bookingId}-{vid} docs (canonical IDs)
}

;(async () => {
  if (DRY_RUN) console.log('=== DRY RUN — no writes ===')

  console.log('Loading vendorLedger…')
  const ledgerSnap = await db.collection('vendorLedger').get()
  console.log(`Total ledger entries: ${ledgerSnap.size}`)

  // 1. Collect all bookings that have at least one recon-summer-vibes-* entry.
  const targetBookings = new Set<string>()
  for (const d of ledgerSnap.docs) {
    if (d.id.startsWith('recon-summer-vibes-')) {
      const data = d.data() as Record<string, unknown>
      const bId = String(data.referenceId ?? '')
      if (bId) targetBookings.add(bId)
    }
  }
  console.log(`Bookings with summer-vibes trace: ${targetBookings.size}`)

  if (SINGLE_BOOKING) {
    if (!targetBookings.has(SINGLE_BOOKING)) {
      console.log(`Booking ${SINGLE_BOOKING} has no summer-vibes trace. Nothing to do.`)
      return
    }
    targetBookings.clear()
    targetBookings.add(SINGLE_BOOKING)
  }

  // 2. For each target booking: load ledger entries, aggregate per vendor.
  const plans: BookingPlan[] = []
  for (const bookingId of targetBookings) {
    const bSnap = await db.collection('bookings').doc(bookingId).get()
    if (!bSnap.exists) {
      console.warn(`Booking ${bookingId} not found — skipping`)
      continue
    }
    const b = bSnap.data() as Record<string, unknown>

    const perVendor = new Map<string, number>()
    const reconDocIds: string[] = []
    const existingLeIds: string[] = []

    // Pull every ledger entry that references this booking. referenceId is
    // canonical; bookingId is the legacy alias seen on a few old docs.
    const refSnap = await db.collection('vendorLedger').where('referenceId', '==', bookingId).get()
    for (const d of refSnap.docs) {
      const data = d.data() as Record<string, unknown>
      const vid = String(data.vendorId ?? '')
      if (!vid) continue
      const amt = Number(data.amount ?? 0) || 0
      const signed = data.type === 'debit' ? -amt : amt
      perVendor.set(vid, (perVendor.get(vid) ?? 0) + signed)
      if (d.id.startsWith('recon-summer-vibes-')) reconDocIds.push(d.id)
      else if (d.id === `le-${bookingId}-${vid}`) existingLeIds.push(d.id)
    }

    plans.push({
      bookingId,
      invoiceNumber: String(b.invoiceNumber ?? bookingId),
      locationId:
        typeof b.branchId === 'string'
          ? b.branchId
          : typeof b.locationId === 'string'
            ? String(b.locationId)
            : '',
      date: dateOnly(b.transactionDate ?? b.createdAt),
      createdAt: toIso(b.createdAt ?? b.transactionDate),
      perVendor,
      reconDocIds,
      existingLeIds,
    })
  }

  console.log(`\nPlans: ${plans.length}`)

  // 3. Build write/delete operations per plan.
  let totalCanonicalWrites = 0
  let totalLeDeletes = 0
  let totalReconDeletes = 0
  let netDelta = 0
  for (const p of plans) {
    let bookingDelta = 0
    const writes: CanonicalEntry[] = []
    const deletes: string[] = []
    for (const [vid, sum] of p.perVendor.entries()) {
      const corrected = Math.round(sum)
      const canonicalId = `le-${p.bookingId}-${vid}`
      if (corrected > 0) {
        const vendorBase = Math.round(corrected / 1.18)
        const vendorGst = corrected - vendorBase
        writes.push({
          id: canonicalId,
          vendorId: vid,
          vendorBase,
          vendorGst,
          amount: corrected,
          type: 'credit',
          referenceId: p.bookingId,
          invoiceNumber: p.invoiceNumber,
          locationId: p.locationId,
          date: p.date,
          createdAt: p.createdAt,
        })
        bookingDelta += corrected
      } else if (corrected === 0 && p.existingLeIds.includes(canonicalId)) {
        deletes.push(canonicalId)
      }
      // corrected < 0 → can't represent as a credit; delete any existing le-*.
      // No corrected canonical entry should exist.
      if (corrected < 0 && p.existingLeIds.includes(canonicalId)) {
        deletes.push(canonicalId)
        console.warn(
          `  ${p.bookingId} vendor ${vid}: net is negative ₹${corrected} — deleting le-* (no canonical entry written)`,
        )
      }
    }
    deletes.push(...p.reconDocIds)

    totalCanonicalWrites += writes.length
    totalReconDeletes += p.reconDocIds.length
    totalLeDeletes += deletes.length - p.reconDocIds.length
    netDelta += bookingDelta

    if (DRY_RUN) {
      console.log(
        `\n${p.bookingId}  date=${p.date} branch=${p.locationId}  invoice=${p.invoiceNumber}`,
      )
      for (const w of writes) {
        console.log(
          `  WRITE   ${w.id}  vendor=${w.vendorId}  base=₹${w.vendorBase}  gst=₹${w.vendorGst}  amount=₹${w.amount}`,
        )
      }
      for (const d of deletes) console.log(`  DELETE  ${d}`)
    } else {
      const batch = db.batch()
      for (const w of writes) batch.set(db.collection('vendorLedger').doc(w.id), w)
      for (const d of deletes) batch.delete(db.collection('vendorLedger').doc(d))
      await batch.commit()
      console.log(
        `${p.bookingId}: wrote ${writes.length} canonical le-*, deleted ${deletes.length} (${p.reconDocIds.length} recon + ${deletes.length - p.reconDocIds.length} obsolete le-*)`,
      )
    }
  }

  console.log(`\n══ Summary ══`)
  console.log(`Bookings:                 ${plans.length}`)
  console.log(
    `Canonical le-* ${DRY_RUN ? 'would write' : 'writes:    '}    ${totalCanonicalWrites}`,
  )
  console.log(`Obsolete le-* ${DRY_RUN ? 'would delete' : 'deletes:    '}   ${totalLeDeletes}`)
  console.log(`Recon ${DRY_RUN ? 'would delete' : 'deletes:           '}    ${totalReconDeletes}`)
  console.log(`Net canonical credit total: ₹${Math.round(netDelta)}`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
