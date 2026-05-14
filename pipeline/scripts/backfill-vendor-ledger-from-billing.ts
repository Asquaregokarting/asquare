/**
 * Backfill vendorLedger entries for paid bookings that have a non-zero
 * billingItems[].vendorTotal but no corresponding vendorLedger entries.
 *
 * Why this exists: the live writer in createUnifiedBooking wraps the
 * `writeVendorLedger` call in a try/catch and only logs on failure.
 * Network glitches, transient Firestore errors, or admin reconciliation
 * paths that wrote billingItems without writing the ledger can leave a
 * paid booking with vendor money owed but never credited. This script
 * is the deterministic recovery: it computes the canonical credits
 * straight from each booking's billingItems and writes them with the
 * same `le-{bookingId}-{vendorId}` doc id the live writer uses, so
 * re-running is idempotent.
 *
 * Skipped bookings:
 *   - paymentStatus != 'completed'             (no money moved)
 *   - billingItems empty or vendorTotal=0      (no vendor exposure)
 *   - already has at least one ledger entry    (assume the live writer
 *                                                handled it; this script
 *                                                doesn't second-guess
 *                                                deltas — that's the
 *                                                Summer Vibes
 *                                                reconciliation script)
 *
 * Usage:
 *   npx tsx scripts/backfill-vendor-ledger-from-billing.ts --dry-run
 *   npx tsx scripts/backfill-vendor-ledger-from-billing.ts             # apply
 *   npx tsx scripts/backfill-vendor-ledger-from-billing.ts --since 2026-01-01
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const DATABASE = 'asquare-app-db'
const VENDOR_LEDGER = 'vendorLedger'
const BOOKINGS = 'bookings'
const _TOLERANCE_INR = 1

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const SINCE = args.find((a, i) => args[i - 1] === '--since') ?? '2026-01-01'
const sinceMs = new Date(`${SINCE}T00:00:00+05:30`).getTime()

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

const toDate = (raw: unknown): Date | null => {
  if (!raw) return null
  if (raw instanceof Date) return raw
  if (typeof raw === 'string') {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof raw === 'object') {
    const o = raw as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof o.toDate === 'function') {
      try {
        return o.toDate()
      } catch {
        /* */
      }
    }
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000)
    if (typeof o._seconds === 'number') return new Date(o._seconds * 1000)
  }
  return null
}

interface PendingWrite {
  ledgerId: string
  bookingId: string
  vendorId: string
  vendorBase: number
  vendorGst: number
  amount: number
  invoiceNumber: string
  locationId: string
  date: string
  source: string
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE) as Firestore

  console.log('Loading vendor ledger…')
  const ledgerSnap = await db.collection(VENDOR_LEDGER).get()
  const bookingHasLedger = new Set<string>()
  for (const d of ledgerSnap.docs) {
    const data = d.data() as Record<string, unknown>
    const ref = String(data.referenceId ?? data.bookingId ?? data.invoiceNumber ?? '')
    if (ref) bookingHasLedger.add(ref)
  }
  console.log(
    `Loaded ${ledgerSnap.size} ledger entries (${bookingHasLedger.size} bookings have at least one)`,
  )

  console.log('Loading bookings…')
  const bookingsSnap = await db.collection(BOOKINGS).get()
  console.log(`Loaded ${bookingsSnap.size} bookings`)

  const pending: PendingWrite[] = []
  let scanned = 0
  let alreadyHasLedger = 0
  let noVendorExposure = 0
  let beforeSince = 0
  let notPaid = 0

  for (const bDoc of bookingsSnap.docs) {
    const b = bDoc.data() as Record<string, unknown>
    scanned++

    const ca = toDate(b.createdAt)
    if (!ca || ca.getTime() < sinceMs) {
      beforeSince++
      continue
    }

    const paymentStatus = String(b.paymentStatus ?? '')
    if (paymentStatus !== 'completed') {
      notPaid++
      continue
    }

    const billingItems = Array.isArray(b.billingItems)
      ? (b.billingItems as Array<Record<string, unknown>>)
      : []
    if (billingItems.length === 0) {
      noVendorExposure++
      continue
    }

    // Group billingItems by vendorId, summing vendorBase + vendorGst
    const byVendor: Record<string, { base: number; gst: number; total: number }> = {}
    for (const bi of billingItems) {
      const vid = String(bi.vendorId ?? '').trim()
      if (!vid) continue
      const base = Number(bi.vendorBase) || 0
      const gst = Number(bi.vendorGst) || 0
      const total = Number(bi.vendorTotal) || base + gst
      if (total <= 0) continue
      const acc = byVendor[vid] ?? { base: 0, gst: 0, total: 0 }
      acc.base += base
      acc.gst += gst
      acc.total += total
      byVendor[vid] = acc
    }
    if (Object.keys(byVendor).length === 0) {
      noVendorExposure++
      continue
    }

    if (bookingHasLedger.has(bDoc.id)) {
      alreadyHasLedger++
      continue
    }

    // Resolve a date string for the ledger entry. Prefer transactionDate
    // (canonical YYYY-MM-DD), else convert createdAt.
    const dateStr =
      typeof b.transactionDate === 'string' && b.transactionDate.length >= 10
        ? b.transactionDate
        : ca.toISOString()

    const branchIdRaw =
      typeof b.branchId === 'string'
        ? b.branchId
        : typeof b.locationId === 'string'
          ? String(b.locationId)
          : ''

    for (const [vid, acc] of Object.entries(byVendor)) {
      pending.push({
        ledgerId: `le-${bDoc.id}-${vid}`,
        bookingId: bDoc.id,
        vendorId: vid,
        vendorBase: Math.round(acc.base),
        vendorGst: Math.round(acc.gst),
        amount: Math.round(acc.total),
        invoiceNumber: String(b.invoiceNumber ?? bDoc.id),
        locationId: branchIdRaw,
        date: dateStr,
        source: 'backfill-from-billingitems',
      })
    }
  }

  console.log(`\n── Scan summary ──`)
  console.log(`Scanned                     : ${scanned}`)
  console.log(`Skipped (before --since)    : ${beforeSince}`)
  console.log(`Skipped (paymentStatus≠done): ${notPaid}`)
  console.log(`Skipped (no vendor exposure): ${noVendorExposure}`)
  console.log(`Skipped (already has ledger): ${alreadyHasLedger}`)
  console.log(`Pending writes              : ${pending.length}`)

  if (pending.length === 0) {
    console.log('\nNothing to backfill. Exiting.')
    return
  }

  // Per-vendor summary
  const byVendor: Record<string, { count: number; total: number }> = {}
  for (const p of pending) {
    const slot = byVendor[p.vendorId] ?? { count: 0, total: 0 }
    slot.count += 1
    slot.total += p.amount
    byVendor[p.vendorId] = slot
  }
  console.log(`\n── Per vendor ──`)
  console.log(`vendorId      | bookings |   amount`)
  console.log(`--------------|----------|---------`)
  for (const [vid, v] of Object.entries(byVendor).sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `${vid.padEnd(13)} | ${String(v.count).padStart(8)} | ${('₹' + Math.round(v.total)).padStart(8)}`,
    )
  }
  const grand = Object.values(byVendor).reduce((s, v) => s + v.total, 0)
  console.log(`--------------|----------|---------`)
  console.log(`TOTAL         |          | ${('₹' + Math.round(grand)).padStart(8)}`)

  console.log('\nSample first 10 entries:')
  for (const p of pending.slice(0, 10)) {
    console.log(`  ${p.ledgerId} → vendor=${p.vendorId} amount=₹${p.amount}`)
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] No writes performed. Re-run without --dry-run to apply.')
    return
  }

  console.log(`\nApplying ${pending.length} ledger entries…`)
  const nowIso = new Date().toISOString()
  const batchSize = 400
  for (let i = 0; i < pending.length; i += batchSize) {
    const slice = pending.slice(i, i + batchSize)
    const batch = db.batch()
    for (const p of slice) {
      batch.set(
        db.collection(VENDOR_LEDGER).doc(p.ledgerId),
        {
          id: p.ledgerId,
          vendorId: p.vendorId,
          vendorBase: p.vendorBase,
          vendorGst: p.vendorGst,
          amount: p.amount,
          type: 'credit',
          referenceId: p.bookingId,
          invoiceNumber: p.invoiceNumber,
          locationId: p.locationId,
          date: p.date,
          createdAt: nowIso,
          source: p.source,
          entryType: 'sale',
          reason: 'Backfill: paid booking had billingItems vendor share but no vendorLedger entry',
        },
        { merge: true },
      )
    }
    await batch.commit()
    console.log(
      `  Wrote batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(pending.length / batchSize)} (${slice.length} entries)`,
    )
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
