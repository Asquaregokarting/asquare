/**
 * Per-vendor read-only audit comparing what the Ledger view shows (sum of
 * vendorLedger rows) against what Settlements would show (re-derived from
 * billingTransactions, skipping cancelled/refunded). Flags any vendor where
 * the two disagree — same shape of gap V L N Varma was seeing.
 *
 * Default range: last 7 days (today IST inclusive). Override with
 *   --from YYYY-MM-DD --to YYYY-MM-DD
 *
 * Usage:
 *   node scripts/audit-vendor-ledger-gap.cjs
 *   node scripts/audit-vendor-ledger-gap.cjs --from 2026-04-19 --to 2026-04-25
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

const args = process.argv.slice(2)
const argMap = new Map()
for (let i = 0; i < args.length; i += 2) argMap.set(args[i], args[i + 1])

const todayIst = () => {
  const now = new Date()
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
  return ist.toISOString().slice(0, 10)
}
const subDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

const to = argMap.get('--to') || todayIst()
const from = argMap.get('--from') || subDays(to, 6)

const within = (dateLike) => {
  const day = String(dateLike || '').slice(0, 10)
  return day >= from && day <= to
}

const num = (v, fallback = 0) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

;(async () => {
  console.log(`\nAuditing ledger vs settlements for ${from} → ${to} (inclusive)\n`)

  // ── Pull all vendorLedger rows in range ─────────────────────────────
  const ledgerSnap = await db.collection('vendorLedger').get()
  const ledgerByVendor = new Map()
  for (const doc of ledgerSnap.docs) {
    const d = doc.data()
    const date =
      typeof d.date === 'string'
        ? d.date
        : typeof d.createdAt === 'string'
          ? d.createdAt
          : (d.createdAt && d.createdAt.toDate && d.createdAt.toDate().toISOString()) || ''
    if (!within(date)) continue
    const vid = String(d.vendorId || '')
    if (!vid) continue
    const row =
      ledgerByVendor.get(vid) || {
        vendorId: vid,
        vendorName: d.vendorName || '',
        ledgerCount: 0,
        ledgerTotal: 0,
        nonSaleCount: 0,
        nonSaleTotal: 0,
        ledgerRefIds: new Set(),
      }
    if (!row.vendorName && d.vendorName) row.vendorName = d.vendorName
    row.ledgerCount += 1
    const sign = d.type === 'debit' ? -1 : 1
    row.ledgerTotal += sign * num(d.amount)
    if (d.entryType && d.entryType !== 'sale') {
      row.nonSaleCount += 1
      row.nonSaleTotal += sign * num(d.amount)
    }
    if (d.referenceId) row.ledgerRefIds.add(String(d.referenceId))
    ledgerByVendor.set(vid, row)
  }

  // ── Look up the underlying bookings to flag cancelled/refunded ──────
  const allRefIds = new Set()
  for (const r of ledgerByVendor.values()) for (const id of r.ledgerRefIds) allRefIds.add(id)

  const cancelledIds = new Set()
  const refundedIds = new Set()
  const bookingsById = new Map()
  const refIdList = Array.from(allRefIds)
  for (let i = 0; i < refIdList.length; i += 30) {
    const chunk = refIdList.slice(i, i + 30)
    if (chunk.length === 0) continue
    const snap = await db
      .collection('bookings')
      .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
      .get()
    for (const d of snap.docs) {
      const data = d.data() || {}
      bookingsById.set(d.id, data)
      if (data.cancelled === true) cancelledIds.add(d.id)
      if (data.refundStatus === 'Full') refundedIds.add(d.id)
    }
  }

  // ── Pull billingTransactions in range — same query Settlements uses ─
  const txSnap = await db
    .collection('bookings')
    .where('transactionDate', '>=', from)
    .where('transactionDate', '<=', `${to}`)
    .get()

  // Mirrors src/pipeline/api/accounting-firestore.ts `extractItemSplits`.
  const splitsForTxn = (t) => {
    const items = Array.isArray(t.items) ? t.items : []
    if (items.length > 0 && items[0] && items[0].vendorBase !== undefined) {
      return items.map((it) => ({
        vendorId: it && it.vendorId ? String(it.vendorId) : '',
        vendorTotal: num(it && it.vendorTotal),
      }))
    }
    if (t.vendorId && t.vendorTotal !== undefined) {
      return [{ vendorId: String(t.vendorId), vendorTotal: num(t.vendorTotal) }]
    }
    return []
  }

  const settlementsByVendor = new Map()
  for (const doc of txSnap.docs) {
    const t = doc.data()
    if (t.cancelled === true) continue
    if (t.paymentStatus && t.paymentStatus !== 'completed') continue
    if (t.refundStatus === 'Full') continue
    for (const s of splitsForTxn(t)) {
      if (!s.vendorId || s.vendorTotal <= 0) continue
      const row =
        settlementsByVendor.get(s.vendorId) ||
        { vendorId: s.vendorId, settlementsTotal: 0, txnIds: new Set() }
      row.settlementsTotal += s.vendorTotal
      row.txnIds.add(doc.id)
      settlementsByVendor.set(s.vendorId, row)
    }
  }

  // Ghost = ledger refIds that did not produce a vendor split for that vendor.
  const ghostByVendor = new Map()
  for (const [vid, ledger] of ledgerByVendor.entries()) {
    const seen = settlementsByVendor.get(vid)?.txnIds ?? new Set()
    const missing = []
    for (const refId of ledger.ledgerRefIds) if (!seen.has(refId)) missing.push(refId)
    if (missing.length > 0) ghostByVendor.set(vid, missing)
  }

  // ── Cross-tabulate per vendor ───────────────────────────────────────
  const allVids = new Set([...ledgerByVendor.keys(), ...settlementsByVendor.keys()])
  const rows = []
  for (const vid of allVids) {
    const l =
      ledgerByVendor.get(vid) ||
      {
        ledgerCount: 0,
        ledgerTotal: 0,
        nonSaleCount: 0,
        nonSaleTotal: 0,
        ledgerRefIds: new Set(),
        vendorName: '',
      }
    const s = settlementsByVendor.get(vid) || { settlementsTotal: 0, txnIds: new Set() }
    const ghosts = ghostByVendor.get(vid) || []
    const cancelledHits = ghosts.filter((id) => cancelledIds.has(id))
    const refundedHits = ghosts.filter((id) => refundedIds.has(id))
    const noVendorSplitHits = ghosts.filter(
      (id) => !cancelledIds.has(id) && !refundedIds.has(id),
    )
    // Fixed accounting: ledger total minus settlements minus the manual
    // (non-sale) entries we already shipped should be ~0 if everything is
    // healthy. Anything else is a stale or unattributed booking.
    const gap = Math.round(l.ledgerTotal - s.settlementsTotal - l.nonSaleTotal)
    rows.push({
      vendorId: vid,
      vendorName: l.vendorName,
      ledger: { count: l.ledgerCount, total: Math.round(l.ledgerTotal) },
      settlements: { count: s.txnIds.size, total: Math.round(s.settlementsTotal) },
      nonSale: { count: l.nonSaleCount, total: Math.round(l.nonSaleTotal) },
      gap,
      cancelled: cancelledHits,
      refunded: refundedHits,
      missingAttribution: noVendorSplitHits,
    })
  }

  rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))

  let mismatched = 0
  let totalGapPositive = 0
  let totalGapNegative = 0
  for (const r of rows) {
    if (r.gap !== 0) mismatched += 1
    if (r.gap > 0) totalGapPositive += r.gap
    if (r.gap < 0) totalGapNegative += r.gap
    const flag = r.gap !== 0 ? '⚠️ ' : '   '
    console.log(
      `${flag}${(r.vendorName || r.vendorId).padEnd(28)} ledger=${r.ledger.count} ₹${r.ledger.total}` +
        `  settlements=${r.settlements.count} ₹${r.settlements.total}` +
        `  non-sale=${r.nonSale.count} ₹${r.nonSale.total}` +
        `  gap=₹${r.gap}` +
        (r.cancelled.length > 0 ? `  cancelled=${r.cancelled.length}` : '') +
        (r.refunded.length > 0 ? `  refunded=${r.refunded.length}` : '') +
        (r.missingAttribution.length > 0 ? `  missingAttribution=${r.missingAttribution.length}` : ''),
    )
  }

  console.log(
    `\nVendors scanned: ${rows.length}.  Mismatched: ${mismatched}.\n` +
      `gap = ledgerTotal − settlementsTotal − nonSaleTotal (≈0 means healthy).\n` +
      `Σ positive gaps (ledger > settlements): ₹${totalGapPositive}\n` +
      `Σ negative gaps (settlements > ledger): ₹${totalGapNegative}\n`,
  )

  // Detailed dump for the top 5 by absolute gap.
  console.log('── Top 5 by absolute gap, ghost-booking detail ──')
  for (const r of rows.slice(0, 5)) {
    if (r.gap === 0) break
    console.log(
      `\n${r.vendorName || r.vendorId} (${r.vendorId}) gap=₹${r.gap}`,
    )
    if (r.cancelled.length > 0) console.log('  cancelled bookings:', r.cancelled.join(', '))
    if (r.refunded.length > 0) console.log('  refunded bookings:', r.refunded.join(', '))
    if (r.missingAttribution.length > 0) {
      console.log('  bookings paid but vendor not on items:', r.missingAttribution.join(', '))
      // Show the first such booking's items so we can see the shape of the bug.
      const sampleId = r.missingAttribution[0]
      const sample = bookingsById.get(sampleId)
      if (sample) {
        const sampleItems = (sample.items || []).map((it) => ({
          name: it && it.itemName,
          vendorId: it && it.vendorId,
          vendorBase: it && it.vendorBase,
          vendorTotal: it && it.vendorTotal,
        }))
        console.log(`  sample ${sampleId}.items =`, JSON.stringify(sampleItems))
      }
    }
  }

  process.exit(0)
})().catch((err) => {
  console.error('\n[FATAL]', err)
  process.exit(1)
})
