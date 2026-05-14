/**
 * Diagnose the gap between "Vendor Ledger total credits" and "Pending Settlement
 * invoice sum" for a date window. Prints a per-vendor breakdown of every reason
 * a ledger credit might NOT be reflected in a pending/draft invoice for the
 * window:
 *
 *   - underlying booking is paymentStatus != 'completed'
 *   - underlying booking has refundStatus = 'Full'
 *   - underlying booking has cancelled = true
 *   - underlying booking has bookingStatus = 'cancelled' (the newly-fixed case)
 *   - the matching invoice for (vendor, location, period) is LOCKED
 *   - the credit's `date` falls outside [periodStart, periodEnd]
 *   - the credit row is orphaned (referenceId points to a booking that doesn't exist)
 *
 * Read-only.
 *
 * Usage:
 *   node scripts/audit-ledger-invoice-gap.cjs <fromYYYY-MM-DD> <toYYYY-MM-DD> [branchFilter]
 *
 * Example:
 *   node scripts/audit-ledger-invoice-gap.cjs 2026-04-25 2026-05-01
 *   node scripts/audit-ledger-invoice-gap.cjs 2026-04-25 2026-05-01 kakinada
 */

const admin = require('firebase-admin')
const path = require('path')
const fs = require('fs')

const [, , FROM, TO, BRANCH] = process.argv
if (!FROM || !TO) {
  console.error('Usage: node scripts/audit-ledger-invoice-gap.cjs <from> <to> [branch]')
  process.exit(1)
}

const DATABASE_ID = 'asquare-app-db'
const keyPath = path.resolve('serviceAccountKey.json')
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found.')
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
  console.log(`\n┌─ ledger vs invoice gap diagnostic ─────────────────────────┐`)
  console.log(`│ window: ${FROM}..${TO}    branch: ${BRANCH || '(all)'}`)
  console.log(`└────────────────────────────────────────────────────────────┘\n`)

  // ── 1. Load all ledger rows whose `date` day is in window ─────────────────
  const ledgerSnap = await db.collection('vendorLedger').get()
  const ledgerInWindow = ledgerSnap.docs.filter((d) => {
    const data = d.data() || {}
    const day = dayOf(data.date || data.createdAt)
    return day >= FROM && day <= TO
  })
  console.log(`Ledger rows in window: ${ledgerInWindow.length}`)

  // ── 2. Load all invoices whose periodStart-periodEnd overlaps window ──────
  const invSnap = await db.collection('vendorInvoices').get()
  const invInWindow = invSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((i) => {
      const ps = String(i.periodStart || '')
      const pe = String(i.periodEnd || '')
      // overlap if invoice window intersects [FROM, TO]
      return ps <= TO && pe >= FROM
    })
  console.log(`Invoices overlapping window: ${invInWindow.length}`)

  // ── 3. Index booking statuses ─────────────────────────────────────────────
  const bookingIds = new Set()
  ledgerInWindow.forEach((d) => {
    const ref = String((d.data() || {}).referenceId || '')
    if (ref) bookingIds.add(ref)
  })
  const bookingMeta = new Map() // id -> { paymentStatus, cancelled, bookingStatus, refundStatus, locationId }
  const ids = [...bookingIds]
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200)
    const docs = await db.getAll(...slice.map((id) => db.collection('billingTransactions').doc(id)))
    docs.forEach((d) => {
      if (!d.exists) return
      const data = d.data() || {}
      bookingMeta.set(d.id, {
        paymentStatus: String(data.paymentStatus ?? ''),
        cancelled: data.cancelled === true,
        bookingStatus: String(data.bookingStatus ?? ''),
        refundStatus: String(data.refundStatus ?? ''),
        locationId: String(data.locationId ?? ''),
      })
    })
  }

  // ── 4. Build invoice index by (vendorId, periodStart) ─────────────────────
  const invByKey = new Map() // `${vid}::${periodStart}` -> [invoices]
  for (const inv of invInWindow) {
    const k = `${inv.vendorId}::${inv.periodStart}`
    const arr = invByKey.get(k) || []
    arr.push(inv)
    invByKey.set(k, arr)
  }

  // Helper: find invoice covering this credit row (matches vendorId + the row's
  // date falls within periodStart..periodEnd).
  const findInvoiceFor = (vid, dateDay) => {
    return invInWindow.find(
      (i) => String(i.vendorId) === vid && i.periodStart <= dateDay && i.periodEnd >= dateDay,
    )
  }

  // ── 5. Walk ledger rows, classify each ────────────────────────────────────
  const buckets = {
    counted: { count: 0, amount: 0 },
    booking_payment_pending: { count: 0, amount: 0 },
    booking_full_refund: { count: 0, amount: 0 },
    booking_cancelled_flag: { count: 0, amount: 0 },
    booking_status_cancelled: { count: 0, amount: 0 },
    invoice_locked: { count: 0, amount: 0 },
    invoice_missing: { count: 0, amount: 0 },
    orphan_no_booking: { count: 0, amount: 0 },
    branch_filtered_out: { count: 0, amount: 0 },
    debit_offset: { count: 0, amount: 0 },
  }

  let totalCredits = 0
  let totalDebits = 0
  const reasonByVendor = new Map() // vid -> { name, gaps: { reason: amount }, total }

  for (const d of ledgerInWindow) {
    const data = d.data() || {}
    const vid = String(data.vendorId || '')
    if (!vid) continue
    const amount = toNumber(data.amount)
    const isCredit = data.type !== 'debit'
    const dateDay = dayOf(data.date || data.createdAt)
    const refId = String(data.referenceId || '')
    const rowLoc = String(data.locationId || '').toLowerCase()

    if (!isCredit) {
      totalDebits += amount
      buckets.debit_offset.count++
      buckets.debit_offset.amount += amount
      continue
    }
    totalCredits += amount

    // Branch filter
    if (BRANCH) {
      const branchLow = BRANCH.toLowerCase()
      if (rowLoc && rowLoc !== branchLow) {
        buckets.branch_filtered_out.count++
        buckets.branch_filtered_out.amount += amount
        continue
      }
    }

    // Reason classification — first match wins
    let reason = null
    if (refId) {
      const meta = bookingMeta.get(refId)
      if (!meta) {
        reason = 'orphan_no_booking'
      } else if (meta.paymentStatus !== 'completed') {
        reason = 'booking_payment_pending'
      } else if (meta.refundStatus === 'Full') {
        reason = 'booking_full_refund'
      } else if (meta.cancelled) {
        reason = 'booking_cancelled_flag'
      } else if (meta.bookingStatus === 'cancelled') {
        reason = 'booking_status_cancelled'
      }
    }

    if (!reason) {
      const inv = findInvoiceFor(vid, dateDay)
      if (!inv) {
        reason = 'invoice_missing'
      } else if (inv.status === 'locked') {
        reason = 'invoice_locked'
      } else {
        reason = 'counted'
      }
    }

    buckets[reason].count++
    buckets[reason].amount += amount

    if (reason !== 'counted') {
      const v = reasonByVendor.get(vid) || { name: data.vendorName || vid, gaps: {}, total: 0 }
      v.gaps[reason] = (v.gaps[reason] || 0) + amount
      v.total += amount
      reasonByVendor.set(vid, v)
    }
  }

  // ── 6. Print summary ──────────────────────────────────────────────────────
  console.log(`\nTotal credits in window: ${inr(totalCredits)}`)
  console.log(`Total debits  in window: ${inr(totalDebits)}`)
  console.log(`Net (credits − debits) : ${inr(totalCredits - totalDebits)}\n`)

  console.log('Reason a credit may not appear in pending invoices:')
  console.log('─'.repeat(70))
  console.log(pad('reason', 38) + padR('rows', 8) + padR('amount', 16))
  console.log('─'.repeat(70))
  const order = [
    'counted',
    'booking_payment_pending',
    'booking_full_refund',
    'booking_cancelled_flag',
    'booking_status_cancelled',
    'invoice_locked',
    'invoice_missing',
    'orphan_no_booking',
    'branch_filtered_out',
  ]
  for (const k of order) {
    const b = buckets[k]
    console.log(pad(k, 38) + padR(b.count, 8) + padR(inr(b.amount), 16))
  }
  console.log('─'.repeat(70))

  // ── 7. Per-vendor gaps ────────────────────────────────────────────────────
  if (reasonByVendor.size > 0) {
    console.log('\nPer-vendor gap (credits NOT in pending invoices):')
    console.log('─'.repeat(80))
    const rows = [...reasonByVendor.entries()]
      .map(([vid, v]) => ({ vid, ...v }))
      .sort((a, b) => b.total - a.total)
    for (const r of rows) {
      console.log(`${pad(r.vid, 14)} ${pad(String(r.name).slice(0, 30), 32)} ${padR(inr(r.total), 14)}`)
      for (const [reason, amt] of Object.entries(r.gaps)) {
        console.log(`    ${pad(reason, 30)} ${padR(inr(amt), 14)}`)
      }
    }
  }

  // ── 8. Bottom-line reconciliation ─────────────────────────────────────────
  const expectedInvoiceSum =
    buckets.counted.amount // credits routed to a non-locked invoice
  console.log(`\nReconciliation:`)
  console.log(`  Vendor Ledger 'Total Credits' KPI : ${inr(totalCredits)}`)
  console.log(`  → minus excluded credits          : ${inr(totalCredits - expectedInvoiceSum)}`)
  console.log(`  Expected pending-invoice sum      : ${inr(expectedInvoiceSum)}`)
  console.log(`\n  If Pending Settlement card shows a smaller number, regenerate the period.`)
})().catch((err) => {
  console.error('audit-ledger-invoice-gap failed:', err)
  process.exit(1)
})
