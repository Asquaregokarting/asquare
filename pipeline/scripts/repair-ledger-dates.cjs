/**
 * One-off repair: re-stamp `vendorLedger.date` from each row's underlying
 * booking `transactionDate` whenever the ledger row currently has either:
 *
 *   - a bare YYYY-MM-DD string (legacy POS path; renders as 5:30 AM IST),
 *   - a date that drifts > 1 day from the source booking (backfill batches
 *     that fell through to nowIso()),
 *   - a date stamped before the booking's payment completed (date-only zero
 *     hour vs. afternoon transaction time).
 *
 * Skips manual_adjustment / discrepancy_correction entries — those are
 * intentionally stamped with the time the credit was issued.
 *
 * Dry-run by default. Pass `--apply` to actually write.
 *
 * Usage:
 *   node scripts/repair-ledger-dates.cjs            # dry-run
 *   node scripts/repair-ledger-dates.cjs --apply    # writes the fixes
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
const ONE_DAY_MS = 24 * 60 * 60 * 1000

const toIsoStrict = (value) => {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed}T12:00:00.000Z`
    }
    const t = new Date(trimmed)
    return Number.isNaN(t.getTime()) ? null : t.toISOString()
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try {
        const d = value.toDate()
        return Number.isNaN(d.getTime()) ? null : d.toISOString()
      } catch {
        return null
      }
    }
    if (typeof value._seconds === 'number') {
      return new Date(value._seconds * 1000).toISOString()
    }
  }
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value
    return new Date(ms).toISOString()
  }
  return null
}

;(async () => {
  console.log(`\nrepair-ledger-dates  mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`)
  const ledgerSnap = await db.collection('vendorLedger').get()
  console.log(`Loaded ${ledgerSnap.size} ledger rows.`)

  const refIds = Array.from(
    new Set(ledgerSnap.docs.map((d) => String((d.data() || {}).referenceId || '')).filter(Boolean)),
  )
  console.log(`Fetching ${refIds.length} unique bookings…`)
  const bookingDateById = new Map()
  for (let i = 0; i < refIds.length; i += 30) {
    const chunk = refIds.slice(i, i + 30)
    if (chunk.length === 0) continue
    const s = await db
      .collection('bookings')
      .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
      .get()
    for (const d of s.docs) {
      const data = d.data() || {}
      const iso =
        toIsoStrict(data.transactionDate) ||
        toIsoStrict(data.paymentCompletedAt) ||
        toIsoStrict(data.createdAt) ||
        toIsoStrict(data.visitDate) ||
        toIsoStrict(data.sessionDate)
      if (iso) bookingDateById.set(d.id, iso)
    }
  }

  const fixes = []
  for (const docSnap of ledgerSnap.docs) {
    const data = docSnap.data() || {}
    const entryType = data.entryType || 'sale'
    if (entryType === 'manual_adjustment' || entryType === 'discrepancy_correction') continue

    const refId = String(data.referenceId || '')
    if (!refId) continue
    const correct = bookingDateById.get(refId)
    if (!correct) continue
    const current = data.date
    const currentIso = toIsoStrict(current)
    if (!currentIso) {
      fixes.push({ id: docSnap.id, refId, before: String(current ?? '(missing)'), after: correct, reason: 'unparseable' })
      continue
    }
    if (currentIso === correct) continue

    // Bare YYYY-MM-DD on the ledger row.
    if (typeof current === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(current.trim())) {
      fixes.push({ id: docSnap.id, refId, before: current, after: correct, reason: 'date-only' })
      continue
    }
    const drift = Math.abs(new Date(currentIso).getTime() - new Date(correct).getTime())
    if (drift > ONE_DAY_MS) {
      fixes.push({ id: docSnap.id, refId, before: current, after: correct, reason: `drift ${(drift / ONE_DAY_MS).toFixed(1)}d` })
    }
  }

  console.log(`\nWould fix ${fixes.length} rows.`)
  fixes.slice(0, 15).forEach((f) => {
    console.log(`  ${f.id}  ref=${f.refId}  ${f.reason}\n    before: ${f.before}\n    after : ${f.after}`)
  })
  if (fixes.length > 15) console.log(`  … +${fixes.length - 15} more`)

  if (!APPLY) {
    console.log('\nDry-run — no writes performed. Re-run with --apply to commit.')
    process.exit(0)
  }

  console.log('\nApplying fixes…')
  let written = 0
  let failed = 0
  for (let i = 0; i < fixes.length; i += 400) {
    const chunk = fixes.slice(i, i + 400)
    const batch = db.batch()
    for (const f of chunk) {
      batch.update(db.collection('vendorLedger').doc(f.id), { date: f.after })
    }
    try {
      await batch.commit()
      written += chunk.length
      process.stdout.write(`  committed ${written}/${fixes.length}\r`)
    } catch (err) {
      console.error('\nbatch failed:', err.message || err)
      failed += chunk.length
    }
  }
  console.log(`\nDone. Wrote ${written}, failed ${failed}.`)
  process.exit(0)
})().catch((err) => {
  console.error('\n[FATAL]', err)
  process.exit(1)
})
