/**
 * One-off repair: write paired `cancellation` debit rows for any
 * `vendorLedger` credit whose underlying booking has
 * `bookingStatus === 'cancelled'` (the AllBookingsView "Cancel" path) and
 * has not yet been refunded or hard-deleted.
 *
 * Background
 * ----------
 * AllBookingsView's Cancel only sets `bookingStatus = 'cancelled'` and
 * leaves `paymentStatus = 'completed'` and `cancelled = false` (legacy
 * flag). The Cloud Function trigger `syncVendorLedger` only deletes /
 * reverses ledger rows when `cancelled === true`, so credits for these
 * cancelled-but-paid bookings live in `vendorLedger` indefinitely. They
 * keep inflating the Vendor Ledger "TOTAL CREDITS" KPI even after our
 * invoice generator filter excludes them.
 *
 * Going forward, `useBookingsData.cancelBooking` calls
 * `asquareBookingsApi.reverseVendorCreditsForBooking` which writes the
 * paired debit at cancel-time. This script catches the historical
 * backlog.
 *
 * What this script does
 * ---------------------
 *   1. Loads every doc in `billingTransactions` and indexes those with
 *      `bookingStatus === 'cancelled'`.
 *   2. Streams every credit row in `vendorLedger`.
 *   3. Per credit row whose `referenceId` matches a cancelled booking
 *      AND has no paired `le-cancel-{bookingId}-{vendorId}` debit yet:
 *        - aggregates per-vendor totals (booking may have many credits per vendor)
 *        - writes one debit per vendor with deterministic id
 *          `le-cancel-{bookingId}-{vendorId}` (idempotent)
 *
 * Skips
 * -----
 *   - Bookings that already have a refund debit (`source === 'refund'`)
 *     covering the credit — those are reversed via the refund path.
 *   - Bookings flagged `cancelled === true` (the legacy hard-cancel; the
 *     trigger already cleaned those up).
 *   - Locked vendor invoices that already include the credit — repairing
 *     after a lock would silently change the "what was paid" total, so we
 *     leave those for a manual `discrepancy_correction` flow.
 *
 * Read-only by default. Pass `--apply` to write.
 *
 * Usage:
 *   node scripts/repair-cancelled-booking-credits.cjs           # dry-run
 *   node scripts/repair-cancelled-booking-credits.cjs --apply   # writes the fixes
 */

const admin = require('firebase-admin')
const path = require('path')
const fs = require('fs')

const DATABASE_ID = 'asquare-app-db'
const keyPath = path.resolve('serviceAccountKey.json')
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found in project root.')
  process.exit(1)
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
})
const db = admin.firestore()
db.settings({ databaseId: DATABASE_ID })

const APPLY = process.argv.includes('--apply')
const toNumber = (v) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const dayOf = (raw) => {
  if (!raw) return ''
  if (typeof raw === 'object' && typeof raw.toDate === 'function') {
    try {
      return raw.toDate().toISOString().slice(0, 10)
    } catch {
      return ''
    }
  }
  return String(raw).slice(0, 10)
}

;(async () => {
  console.log(`\nrepair-cancelled-booking-credits  mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`)

  // ── 1. Index cancelled-but-not-hard-cancelled bookings ────────────────────
  const bookingSnap = await db
    .collection('billingTransactions')
    .where('bookingStatus', '==', 'cancelled')
    .get()

  const cancelledBookings = new Map() // id -> { paymentStatus, cancelled, refundStatus, locationId }
  bookingSnap.docs.forEach((d) => {
    const data = d.data() || {}
    if (data.cancelled === true) return // already-handled hard-cancel
    cancelledBookings.set(d.id, {
      paymentStatus: String(data.paymentStatus ?? ''),
      refundStatus: String(data.refundStatus ?? 'None'),
      locationId: String(data.locationId ?? ''),
      cancelledAt: dayOf(data.cancelledAt || data.updatedAt) || new Date().toISOString().slice(0, 10),
    })
  })
  console.log(`Bookings with bookingStatus='cancelled' (and not hard-cancelled): ${cancelledBookings.size}`)

  if (cancelledBookings.size === 0) {
    console.log('Nothing to repair.')
    process.exit(0)
  }

  // ── 2. Index locked vendor invoices for safety check ──────────────────────
  const lockedSnap = await db.collection('vendorInvoices').where('status', '==', 'locked').get()
  const lockedWindows = []
  lockedSnap.docs.forEach((d) => {
    const data = d.data() || {}
    lockedWindows.push({
      vendorId: String(data.vendorId ?? ''),
      start: String(data.periodStart || ''),
      end: String(data.periodEnd || ''),
    })
  })
  const isInLockedInvoice = (vendorId, dateDay) =>
    lockedWindows.some(
      (w) => w.vendorId === vendorId && dateDay >= w.start && dateDay <= w.end,
    )

  // ── 3. Scan ledger credits whose referenceId is a cancelled booking ───────
  const ledgerSnap = await db.collection('vendorLedger').where('type', '==', 'credit').get()
  console.log(`Loaded ${ledgerSnap.size} credit rows.`)

  // Group: bookingId -> vendorId -> aggregated totals + sample row info
  const reversalsByBooking = new Map()
  let scanned = 0
  let skippedLocked = 0
  let skippedAlreadyDebited = 0

  for (const d of ledgerSnap.docs) {
    scanned++
    const data = d.data() || {}
    const refId = String(data.referenceId ?? '')
    if (!refId || !cancelledBookings.has(refId)) continue
    if (data.source === 'cancellation' || data.entryType === 'cancellation') continue

    const vid = String(data.vendorId ?? '')
    if (!vid) continue
    const dateDay = dayOf(data.date || data.createdAt)

    if (isInLockedInvoice(vid, dateDay)) {
      skippedLocked++
      continue
    }

    const byVendor = reversalsByBooking.get(refId) || new Map()
    const acc = byVendor.get(vid) || {
      vendorBase: 0,
      vendorGst: 0,
      amount: 0,
      locationId: data.locationId ? String(data.locationId) : undefined,
      invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : undefined,
    }
    acc.vendorBase += toNumber(data.vendorBase)
    acc.vendorGst += toNumber(data.vendorGst)
    acc.amount += toNumber(data.amount)
    byVendor.set(vid, acc)
    reversalsByBooking.set(refId, byVendor)
  }

  // ── 4. Skip bookings that already have a paired cancellation debit ────────
  const writes = []
  let totalReversal = 0
  for (const [bookingId, byVendor] of reversalsByBooking) {
    for (const [vid, totals] of byVendor) {
      if (totals.amount <= 0) continue
      const debitId = `le-cancel-${bookingId}-${vid}`
      const existing = await db.collection('vendorLedger').doc(debitId).get()
      if (existing.exists) {
        skippedAlreadyDebited++
        continue
      }
      totalReversal += totals.amount
      writes.push({ bookingId, vid, totals, debitId })
    }
  }

  // ── 5. Per-vendor summary ─────────────────────────────────────────────────
  const perVendor = new Map()
  for (const w of writes) {
    const v = perVendor.get(w.vid) || { rows: 0, amount: 0 }
    v.rows++
    v.amount += w.totals.amount
    perVendor.set(w.vid, v)
  }
  console.log(`\nReversals to write:`)
  console.log('─'.repeat(72))
  console.log(`  bookings affected      : ${reversalsByBooking.size}`)
  console.log(`  vendor-debit rows      : ${writes.length}`)
  console.log(`  total ₹ reversal       : ${Math.round(totalReversal).toLocaleString('en-IN')}`)
  console.log(`  skipped (already done) : ${skippedAlreadyDebited}`)
  console.log(`  skipped (locked invoice): ${skippedLocked}`)
  console.log(`  ledger rows scanned    : ${scanned}`)
  console.log('─'.repeat(72))
  console.log('\nPer vendor:')
  const rows = [...perVendor.entries()].sort((a, b) => b[1].amount - a[1].amount)
  for (const [vid, v] of rows) {
    console.log(`  ${vid.padEnd(15)} rows=${String(v.rows).padStart(4)}  ₹${Math.round(v.amount).toLocaleString('en-IN').padStart(12)}`)
  }

  if (!APPLY) {
    console.log(`\nDry-run only. Re-run with --apply to write ${writes.length} debit rows.`)
    process.exit(0)
  }

  // ── 6. Write debits ───────────────────────────────────────────────────────
  let written = 0
  const BATCH = 400
  const nowIso = new Date().toISOString()
  for (let i = 0; i < writes.length; i += BATCH) {
    const slice = writes.slice(i, i + BATCH)
    const batch = db.batch()
    for (const w of slice) {
      const ref = db.collection('vendorLedger').doc(w.debitId)
      const cancelledAt = cancelledBookings.get(w.bookingId)?.cancelledAt
      const payload = {
        id: w.debitId,
        vendorId: w.vid,
        vendorBase: w.totals.vendorBase,
        vendorGst: w.totals.vendorGst,
        amount: w.totals.amount,
        type: 'debit',
        referenceId: w.bookingId,
        invoiceNumber: w.totals.invoiceNumber || w.bookingId,
        date: cancelledAt ? `${cancelledAt}T12:00:00.000Z` : nowIso,
        createdAt: nowIso,
        source: 'cancellation',
        entryType: 'cancellation',
        repairScript: 'repair-cancelled-booking-credits',
      }
      if (w.totals.locationId) payload.locationId = w.totals.locationId
      batch.set(ref, payload, { merge: true })
    }
    await batch.commit()
    written += slice.length
    process.stdout.write(`\r  written ${written} / ${writes.length}`)
  }
  process.stdout.write('\n')
  console.log(`\nApplied ${written} cancellation-debit rows.`)
  console.log('Re-run accounting/Invoices tab to refresh per-period invoices.')
})().catch((err) => {
  console.error('repair-cancelled-booking-credits failed:', err)
  process.exit(1)
})
