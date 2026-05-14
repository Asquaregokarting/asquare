/**
 * One-off repair: zero out `vendorGst` (and reduce `amount` by that GST)
 * on `vendorLedger` rows that belong to SubLease vendors.
 *
 * Background
 * ----------
 * Pre-fix `aggregateEventPackageCredits` (functions/lib/vendor-ledger-sync.js)
 * credited SubLease vendors as if they were ThirdParty: vendorGst = (gst*share)/100.
 * The canonical rule is SubLease keeps NO share of GST — company keeps the full GST.
 * Fix landed at vendor-ledger-sync.js diff:
 *   const vendorGst = isSubLease ? 0 : Math.round((row.gst * share) / 100);
 *
 * That fix only patches NEW writes. Pre-fix rows live on with inflated vendorGst,
 * so every regenerate of `generateFirestoreWeeklyInvoices` re-sums them and the
 * vendor invoice's totalGst / totalAmount stay wrong until those rows are repaired.
 *
 * What this script does
 * ---------------------
 *   1. Loads every doc in `vendorDetails` and indexes vendors with vendorType === 'SubLease'.
 *   2. Streams every row in `vendorLedger`.
 *   3. For each row whose `vendorId` is SubLease AND `vendorGst > 0`:
 *        - new vendorGst   = 0
 *        - new amount      = vendorBase  (canonical: amount = vendorBase + vendorGst, GST=0)
 *        - retain other fields
 *      The repair is idempotent — re-running on a clean row writes nothing.
 *   4. Writes corrections (only with --apply) and prints a per-vendor delta.
 *
 * Skips
 * -----
 *   - manual_adjustment / discrepancy_correction rows (those are admin-issued
 *     credits, not derived from sale-time GST math; leave them alone).
 *   - settlement-correction rows (carry-forwards from prior periods).
 *   - Rows already at vendorGst === 0.
 *
 * Locked-invoice safety
 * ---------------------
 * If a SubLease vendor's invoice is already LOCKED for a period that overlaps
 * the row's date, the row is reported but NOT repaired — locked invoices must
 * be unlocked or settled-correction'd by hand. (Repairing the underlying ledger
 * after lock would silently shift the vendor's "what was already paid" total.)
 *
 * Dry-run by default. Pass `--apply` to actually write.
 *
 * Usage:
 *   node scripts/repair-sublease-ledger-gst.cjs           # dry-run
 *   node scripts/repair-sublease-ledger-gst.cjs --apply   # writes the fixes
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

;(async () => {
  console.log(`\nrepair-sublease-ledger-gst  mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`)

  // ── 1. Index SubLease vendors ─────────────────────────────────────────────
  const vendorSnap = await db.collection('vendorDetails').get()
  const subLeaseVendors = new Map() // vendorId -> vendorName
  vendorSnap.docs.forEach((d) => {
    const data = d.data() || {}
    if (data.vendorType === 'SubLease') {
      subLeaseVendors.set(d.id, String(data.vendorName ?? data.particular ?? d.id))
    }
  })
  console.log(`SubLease vendors: ${subLeaseVendors.size}`)

  if (subLeaseVendors.size === 0) {
    console.log('No SubLease vendors found — nothing to repair.')
    process.exit(0)
  }

  // ── 2. Load locked invoices, build (vendorId, periodStart, periodEnd) blocklist ──
  const invoiceSnap = await db.collection('vendorInvoices').where('status', '==', 'locked').get()
  const lockedWindows = [] // [{ vendorId, start, end }]
  invoiceSnap.docs.forEach((d) => {
    const data = d.data() || {}
    if (subLeaseVendors.has(String(data.vendorId ?? ''))) {
      lockedWindows.push({
        vendorId: String(data.vendorId),
        start: String(data.periodStart || ''),
        end: String(data.periodEnd || ''),
      })
    }
  })
  console.log(`Locked SubLease invoices in window: ${lockedWindows.length}`)

  const isLocked = (vendorId, dateIso) => {
    const day = String(dateIso || '').slice(0, 10)
    return lockedWindows.some(
      (w) => w.vendorId === vendorId && day >= w.start && day <= w.end,
    )
  }

  // ── 3. Stream ledger rows, decide repair ──────────────────────────────────
  const ledgerSnap = await db.collection('vendorLedger').get()
  console.log(`Loaded ${ledgerSnap.size} ledger rows.\n`)

  const SKIP_SOURCES = new Set(['manual_adjustment', 'discrepancy_correction', 'settlement-correction'])
  const stats = {
    scanned: 0,
    sublease: 0,
    needsRepair: 0,
    repaired: 0,
    skippedLocked: 0,
    skippedManual: 0,
  }
  const perVendor = new Map() // vendorId -> { rows, gstReduction, name }
  const writes = []

  for (const d of ledgerSnap.docs) {
    stats.scanned++
    const data = d.data() || {}
    const vendorId = String(data.vendorId ?? '')
    if (!subLeaseVendors.has(vendorId)) continue
    stats.sublease++

    const source = String(data.source ?? '')
    const entryType = String(data.entryType ?? '')
    if (SKIP_SOURCES.has(source) || SKIP_SOURCES.has(entryType)) {
      stats.skippedManual++
      continue
    }

    const vendorGst = toNumber(data.vendorGst)
    if (vendorGst <= 0) continue
    stats.needsRepair++

    const dateIso = String(data.date ?? data.createdAt ?? '')
    if (isLocked(vendorId, dateIso)) {
      stats.skippedLocked++
      const v = perVendor.get(vendorId) || {
        rows: 0,
        gstReduction: 0,
        skippedLocked: 0,
        name: subLeaseVendors.get(vendorId),
      }
      v.skippedLocked++
      perVendor.set(vendorId, v)
      continue
    }

    const vendorBase = toNumber(data.vendorBase)
    const newAmount = vendorBase // SubLease canonical: amount = base, gst = 0
    const oldAmount = toNumber(data.amount)

    const v = perVendor.get(vendorId) || {
      rows: 0,
      gstReduction: 0,
      skippedLocked: 0,
      name: subLeaseVendors.get(vendorId),
    }
    v.rows++
    v.gstReduction += oldAmount - newAmount
    perVendor.set(vendorId, v)

    if (APPLY) {
      writes.push({
        ref: d.ref,
        update: {
          vendorGst: 0,
          amount: newAmount,
          subleaseGstRepairedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      })
    }
  }

  // ── 4. Per-vendor summary ─────────────────────────────────────────────────
  const vendorRows = [...perVendor.entries()]
    .map(([vendorId, info]) => ({ vendorId, ...info }))
    .sort((a, b) => b.gstReduction - a.gstReduction)

  console.log('Per-vendor SubLease GST drift:')
  console.log('─'.repeat(96))
  console.log(
    'vendorId'.padEnd(15) +
      'name'.padEnd(38) +
      'rows'.padStart(6) +
      'reduce ₹'.padStart(14) +
      'lockedSkip'.padStart(13),
  )
  console.log('─'.repeat(96))
  for (const r of vendorRows) {
    console.log(
      r.vendorId.padEnd(15) +
        String(r.name).slice(0, 36).padEnd(38) +
        String(r.rows).padStart(6) +
        r.gstReduction.toFixed(2).padStart(14) +
        String(r.skippedLocked || 0).padStart(13),
    )
  }
  console.log('─'.repeat(96))

  console.log(`\nStats:`)
  console.log(`  ledger rows scanned : ${stats.scanned}`)
  console.log(`  rows for SubLease   : ${stats.sublease}`)
  console.log(`  rows needing repair : ${stats.needsRepair}`)
  console.log(`  skipped (locked)    : ${stats.skippedLocked}`)
  console.log(`  skipped (manual)    : ${stats.skippedManual}`)

  // ── 5. Apply ──────────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log(`\nDry-run only. Re-run with --apply to write ${stats.needsRepair - stats.skippedLocked} corrections.`)
    process.exit(0)
  }

  let written = 0
  const BATCH = 400
  for (let i = 0; i < writes.length; i += BATCH) {
    const slice = writes.slice(i, i + BATCH)
    const batch = db.batch()
    slice.forEach(({ ref, update }) => batch.update(ref, update))
    await batch.commit()
    written += slice.length
    process.stdout.write(`\r  written ${written} / ${writes.length}`)
  }
  process.stdout.write('\n')
  stats.repaired = written
  console.log(`\nApplied ${stats.repaired} repairs.`)
  console.log(`Re-run \`generateFirestoreWeeklyInvoices\` for affected periods to refresh invoices.`)
})().catch((err) => {
  console.error('repair-sublease-ledger-gst failed:', err)
  process.exit(1)
})
