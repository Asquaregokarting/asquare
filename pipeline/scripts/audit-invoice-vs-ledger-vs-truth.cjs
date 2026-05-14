/**
 * Three-way reconciliation: for every (vendorId, periodStart) with a vendor
 * invoice, print
 *
 *   invoiceTotal   — what the invoice doc says  (vendorInvoices.totalAmount)
 *   ledgerTotal    — sum(vendorLedger credits − debits) in the period for that vendor+location
 *   trueTotal      — re-derived from the SOURCE of truth: billingItems[].vendorTotal
 *                    across paid + non-cancelled + non-refunded bookings,
 *                    with SubLease vendors' GST forced to 0.
 *
 * Then prints `drift = trueTotal − invoiceTotal` so you can see exactly which
 * vendors / weeks are over- or under-stated and by how much.
 *
 * Read-only — no writes. Safe to run any time.
 *
 * Usage:
 *   node scripts/audit-invoice-vs-ledger-vs-truth.cjs                       # all periods, all vendors
 *   node scripts/audit-invoice-vs-ledger-vs-truth.cjs 2026-04-19            # one period
 *   node scripts/audit-invoice-vs-ledger-vs-truth.cjs 2026-04-19 7777997226 # one period, one vendor
 */

const admin = require('firebase-admin')
const path = require('path')
const fs = require('fs')

const [, , PERIOD_FILTER, VENDOR_FILTER] = process.argv

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

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`
const pad = (s, w) => String(s ?? '').padEnd(w)
const padR = (s, w) => String(s ?? '').padStart(w)
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
  console.log(
    `\n┌─ invoice vs ledger vs truth reconciliation ─────────────────────┐`,
  )
  console.log(
    `│ period filter: ${PERIOD_FILTER || '(all)'}    vendor filter: ${VENDOR_FILTER || '(all)'}`,
  )
  console.log(
    `└─────────────────────────────────────────────────────────────────┘\n`,
  )

  // ── Load vendor types (for SubLease GST rule) ─────────────────────────────
  const vendorSnap = await db.collection('vendorDetails').get()
  const vendorMeta = new Map() // vid -> { type, name }
  vendorSnap.docs.forEach((d) => {
    const data = d.data() || {}
    vendorMeta.set(d.id, {
      type: data.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty',
      name: String(data.vendorName ?? data.particular ?? d.id),
    })
  })

  // ── Load invoices (filtered) ──────────────────────────────────────────────
  let invQ = db.collection('vendorInvoices')
  if (PERIOD_FILTER) invQ = invQ.where('periodStart', '==', PERIOD_FILTER)
  const invSnap = await invQ.get()

  const invoices = invSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((i) => !VENDOR_FILTER || String(i.vendorId) === VENDOR_FILTER)
  console.log(`Invoices to audit: ${invoices.length}`)

  if (invoices.length === 0) {
    console.log('Nothing to audit.')
    process.exit(0)
  }

  // Collect distinct (periodStart, periodEnd) windows we need to reconcile.
  const windowKeys = new Set(invoices.map((i) => `${i.periodStart}::${i.periodEnd}`))

  // ── For each window: load bookings + ledger once ──────────────────────────
  const results = []

  for (const key of windowKeys) {
    const [periodStart, periodEnd] = key.split('::')

    // Bookings in window — use transactionDate prefix match.
    const txnSnap = await db
      .collection('billingTransactions')
      .where('transactionDate', '>=', periodStart)
      .where('transactionDate', '<=', `${periodEnd}`)
      .get()

    // Ledger in window — date prefix match.
    const ledgerSnap = await db
      .collection('vendorLedger')
      .where('date', '>=', periodStart)
      .where('date', '<=', `${periodEnd}`)
      .get()

    // Build per-vendor truth from billingItems.
    // Filters mirror generateFirestoreWeeklyInvoices AFTER the
    // bookingStatus !== 'cancelled' fix landed.
    const truthByVendor = new Map() // vid -> { base, gst, total }
    const ledgerByVendor = new Map() // vid -> { credits, debits, net }

    for (const d of txnSnap.docs) {
      const t = d.data() || {}
      if (t.cancelled === true) continue
      if (String(t.bookingStatus ?? '') === 'cancelled') continue
      if (String(t.paymentStatus ?? '') !== 'completed') continue
      if (String(t.refundStatus ?? '') === 'Full') continue

      const items = Array.isArray(t.items) ? t.items : []
      for (const item of items) {
        if (item.refunded === true) continue
        const vid = String(item.vendorId ?? '')
        if (!vid) continue
        const meta = vendorMeta.get(vid) || { type: 'ThirdParty' }
        const base = toNumber(item.vendorBase)
        // SubLease canonical: vendor keeps base only.
        const gst = meta.type === 'SubLease' ? 0 : toNumber(item.vendorGst)
        const total = base + gst
        if (total <= 0) continue
        const acc = truthByVendor.get(vid) || { base: 0, gst: 0, total: 0 }
        acc.base += base
        acc.gst += gst
        acc.total += total
        truthByVendor.set(vid, acc)
      }
    }

    for (const d of ledgerSnap.docs) {
      const data = d.data() || {}
      const vid = String(data.vendorId ?? '')
      if (!vid) continue
      const sign = data.type === 'debit' ? -1 : 1
      const acc = ledgerByVendor.get(vid) || { credits: 0, debits: 0, net: 0 }
      const amt = toNumber(data.amount)
      if (sign > 0) acc.credits += amt
      else acc.debits += amt
      acc.net += sign * amt
      ledgerByVendor.set(vid, acc)
    }

    // Match invoices in this window to their truth + ledger.
    const winInvoices = invoices.filter(
      (i) => i.periodStart === periodStart && i.periodEnd === periodEnd,
    )
    for (const inv of winInvoices) {
      const vid = String(inv.vendorId)
      const meta = vendorMeta.get(vid) || { type: '?', name: vid }
      const truth = truthByVendor.get(vid) || { base: 0, gst: 0, total: 0 }
      const ledger = ledgerByVendor.get(vid) || { credits: 0, debits: 0, net: 0 }
      const invoiceTotal = toNumber(inv.totalAmount)
      const drift = truth.total - invoiceTotal
      results.push({
        period: periodStart,
        vendorId: vid,
        name: meta.name,
        type: meta.type,
        status: String(inv.status || 'draft'),
        invoiceTotal,
        ledgerNet: ledger.net,
        truthTotal: truth.total,
        drift,
        invoiceVsLedger: ledger.net - invoiceTotal,
      })
    }
  }

  // ── Sort by abs(drift) desc ───────────────────────────────────────────────
  results.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))

  console.log()
  console.log(
    pad('period', 12) +
      pad('vendorId', 13) +
      pad('name', 26) +
      pad('type', 11) +
      pad('status', 9) +
      padR('invoice', 12) +
      padR('ledger', 12) +
      padR('truth', 12) +
      padR('drift', 12) +
      padR('inv↔led', 12),
  )
  console.log('─'.repeat(132))
  let totalDrift = 0
  let totalAbsDrift = 0
  for (const r of results) {
    totalDrift += r.drift
    totalAbsDrift += Math.abs(r.drift)
    console.log(
      pad(r.period, 12) +
        pad(r.vendorId, 13) +
        pad(String(r.name).slice(0, 24), 26) +
        pad(r.type, 11) +
        pad(r.status, 9) +
        padR(inr(r.invoiceTotal), 12) +
        padR(inr(r.ledgerNet), 12) +
        padR(inr(r.truthTotal), 12) +
        padR(inr(r.drift), 12) +
        padR(inr(r.invoiceVsLedger), 12),
    )
  }
  console.log('─'.repeat(132))
  console.log(`net drift (truth−invoice): ${inr(totalDrift)}`)
  console.log(`abs drift (sum of |drift|): ${inr(totalAbsDrift)}`)
  console.log()
  console.log('Legend:')
  console.log('  invoice  = vendorInvoices.totalAmount as-stored')
  console.log('  ledger   = vendorLedger net (credits − debits) for vendor in period')
  console.log('  truth    = sum(billingItems[].vendorTotal) — paid, non-cancelled, non-refunded;')
  console.log('             SubLease GST forced to 0')
  console.log('  drift    = truth − invoice  (positive = invoice under-states; negative = over-states)')
  console.log('  inv↔led  = ledger − invoice  (should be 0 after a clean regen)')
})().catch((err) => {
  console.error('audit-invoice-vs-ledger-vs-truth failed:', err)
  process.exit(1)
})
