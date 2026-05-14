/**
 * Read-only audit of `vendorLedger.date` vs the underlying booking's
 * `transactionDate`. Flags four bug shapes:
 *
 *   A. ledger.date diverges from booking.transactionDate by > 1 day
 *      (typically because a backfill wrote nowIso() instead of the
 *      booking's real timestamp).
 *
 *   B. multiple ledger rows from different bookings carrying the
 *      *exact* same `date` string — a backfill-batch signature.
 *
 *   C. ledger.date in the future (> now + 1 day).
 *
 *   D. ledger.date stamped before the booking was paid
 *      (transactionDate > ledger.date by > 5 min).
 *
 * Default scope: every row in vendorLedger. Limit with --limit N.
 *
 * Usage:
 *   node scripts/audit-ledger-date-errors.cjs
 *   node scripts/audit-ledger-date-errors.cjs --limit 1000
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
const limit = argMap.has('--limit') ? Number(argMap.get('--limit')) : null

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const FIVE_MIN_MS = 5 * 60 * 1000

const toIsoString = (value) => {
  if (value == null) return undefined
  if (typeof value === 'string') return value || undefined
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try {
        const d = value.toDate()
        return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
      } catch {
        return undefined
      }
    }
    if (typeof value._seconds === 'number') return new Date(value._seconds * 1000).toISOString()
  }
  return undefined
}

;(async () => {
  console.log('\nScanning vendorLedger for date errors…')

  const snap = await db.collection('vendorLedger').get()
  let entries = snap.docs.map((d) => {
    const data = d.data() || {}
    return {
      id: d.id,
      vendorId: String(data.vendorId || ''),
      vendorName: String(data.vendorName || ''),
      referenceId: String(data.referenceId || ''),
      amount: Number(data.amount) || 0,
      type: data.type === 'debit' ? 'debit' : 'credit',
      entryType: data.entryType || 'sale',
      date: toIsoString(data.date),
      createdAt: toIsoString(data.createdAt),
    }
  })
  if (limit) entries = entries.slice(0, limit)
  console.log(`Loaded ${entries.length} ledger rows.\n`)

  // ── B: same `date` string used for multiple bookings (backfill smell) ──
  const byDateString = new Map()
  for (const e of entries) {
    if (!e.date) continue
    const arr = byDateString.get(e.date) || []
    arr.push(e)
    byDateString.set(e.date, arr)
  }

  // ── A & D need booking lookup ──
  const refIdSet = new Set(entries.map((e) => e.referenceId).filter(Boolean))
  const bookingsById = new Map()
  const refIds = Array.from(refIdSet)
  console.log(`Fetching ${refIds.length} bookings…`)
  for (let i = 0; i < refIds.length; i += 30) {
    const chunk = refIds.slice(i, i + 30)
    if (chunk.length === 0) continue
    const s = await db
      .collection('bookings')
      .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
      .get()
    for (const d of s.docs) bookingsById.set(d.id, d.data() || {})
  }

  // Pull each booking's authoritative transactionDate.
  const bookingDateById = new Map()
  for (const [id, b] of bookingsById.entries()) {
    const td = toIsoString(b.transactionDate) || toIsoString(b.paymentCompletedAt)
    if (td) bookingDateById.set(id, td)
  }

  const now = Date.now()

  const driftRows = []
  const futureRows = []
  const beforeBookingRows = []
  const noBookingRows = []
  const noLedgerDateRows = []

  for (const e of entries) {
    if (e.entryType === 'manual_adjustment' || e.entryType === 'discrepancy_correction') {
      // Manual adjustments are intentionally stamped with nowIso() — skip.
      continue
    }
    if (!e.date) {
      noLedgerDateRows.push(e)
      continue
    }
    const ledgerMs = new Date(e.date).getTime()
    if (Number.isNaN(ledgerMs)) {
      noLedgerDateRows.push(e)
      continue
    }
    if (ledgerMs - now > ONE_DAY_MS) futureRows.push(e)

    if (!bookingDateById.has(e.referenceId)) {
      // Could be POS / non-booking sources; only report if the id starts with
      // ASG (booking convention) — those should always have a matching doc.
      if (/^ASG/i.test(e.referenceId)) noBookingRows.push(e)
      continue
    }
    const txnIso = bookingDateById.get(e.referenceId)
    const txnMs = new Date(txnIso).getTime()
    if (Number.isNaN(txnMs)) continue
    const drift = ledgerMs - txnMs
    if (Math.abs(drift) > ONE_DAY_MS) {
      driftRows.push({ entry: e, txnIso, driftMs: drift })
    } else if (drift < -FIVE_MIN_MS) {
      beforeBookingRows.push({ entry: e, txnIso, driftMs: drift })
    }
  }

  // Filter the same-date map down to rows where >1 booking share a date.
  const batchClusters = []
  for (const [date, arr] of byDateString.entries()) {
    if (arr.length < 2) continue
    const distinctRefs = new Set(arr.map((e) => e.referenceId).filter(Boolean))
    if (distinctRefs.size < 2) continue // same booking with multiple vendors is fine
    batchClusters.push({ date, count: arr.length, refs: Array.from(distinctRefs) })
  }
  batchClusters.sort((a, b) => b.count - a.count)

  // ── Report ──
  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(`A. Ledger date drift > 1 day from booking.transactionDate: ${driftRows.length}`)
  console.log('══════════════════════════════════════════════════════════════')
  driftRows
    .sort((a, b) => Math.abs(b.driftMs) - Math.abs(a.driftMs))
    .slice(0, 20)
    .forEach((r) => {
      const days = (r.driftMs / ONE_DAY_MS).toFixed(1)
      console.log(
        `  ${r.entry.id} ref=${r.entry.referenceId} vendor=${r.entry.vendorId}` +
          ` ledger=${r.entry.date} txn=${r.txnIso} drift=${days}d`,
      )
    })
  if (driftRows.length > 20) console.log(`  … +${driftRows.length - 20} more`)

  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(`B. Same ledger.date used across multiple bookings (backfill batch): ${batchClusters.length} clusters`)
  console.log('══════════════════════════════════════════════════════════════')
  batchClusters.slice(0, 10).forEach((c) => {
    console.log(`  ${c.date}  ${c.count} rows across ${c.refs.length} bookings`)
    console.log(`    sample refs: ${c.refs.slice(0, 5).join(', ')}${c.refs.length > 5 ? ' …' : ''}`)
  })
  if (batchClusters.length > 10) console.log(`  … +${batchClusters.length - 10} more clusters`)

  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(`C. Ledger date in the future: ${futureRows.length}`)
  console.log('══════════════════════════════════════════════════════════════')
  futureRows.slice(0, 10).forEach((e) => {
    console.log(`  ${e.id} ref=${e.referenceId} ledger=${e.date}`)
  })

  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(`D. Ledger date stamped before booking was paid: ${beforeBookingRows.length}`)
  console.log('══════════════════════════════════════════════════════════════')
  beforeBookingRows.slice(0, 10).forEach((r) => {
    console.log(`  ${r.entry.id} ref=${r.entry.referenceId} ledger=${r.entry.date} txn=${r.txnIso}`)
  })

  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(`E. Ledger row missing date entirely: ${noLedgerDateRows.length}`)
  console.log('══════════════════════════════════════════════════════════════')
  noLedgerDateRows.slice(0, 10).forEach((e) => {
    console.log(`  ${e.id} ref=${e.referenceId}`)
  })

  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(`F. Ledger ref points at a booking that no longer exists: ${noBookingRows.length}`)
  console.log('══════════════════════════════════════════════════════════════')
  noBookingRows.slice(0, 10).forEach((e) => {
    console.log(`  ${e.id} ref=${e.referenceId} vendor=${e.vendorId} amount=${e.amount}`)
  })

  console.log('\nDone.')
  process.exit(0)
})().catch((err) => {
  console.error('\n[FATAL]', err)
  process.exit(1)
})
