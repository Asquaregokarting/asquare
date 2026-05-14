/**
 * Inventory of vendorLedger entries that still carry "correction trace"
 * markers — the things that betray a booking was patched after the fact:
 *
 *   - doc id starts with `recon-`
 *   - entryType === 'discrepancy_correction'
 *   - source === 'backfill-from-billingitems'
 *   - reason starts with 'Backfill:' or 'Summer Vibes config-correction'
 *     or 'Stale-vendor reconciliation'
 *   - createdBy startsWith 'system-reconcile-' / 'system-backfill-' / 'system-correction-'
 *
 * Goal: silent-fix every booking that still shows these markers so the
 * ledger ends up looking like the canonical writer (writeVendorLedger /
 * onBookingPaid) had handled it correctly the first time. This script
 * doesn't mutate anything — it groups and reports the scope.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

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
const db = getFirestore('asquare-app-db')

type Category = 'summer-vibes' | 'billing-backfill' | 'stale-vendor' | 'game-vendor' | 'other-trace'

interface TraceRow {
  ledgerId: string
  bookingId: string
  vendorId: string
  amount: number
  type: 'credit' | 'debit' | string
  category: Category
  date: string
  createdBy: string
  reason: string
  entryType: string
  docIdMatchesCanonical: boolean
}

const classify = (row: {
  id: string
  entryType?: unknown
  source?: unknown
  reason?: unknown
  createdBy?: unknown
}): Category | null => {
  const id = String(row.id ?? '')
  const reason = String(row.reason ?? '')
  const source = String(row.source ?? '')
  const createdBy = String(row.createdBy ?? '')
  const entryType = String(row.entryType ?? '')

  if (id.startsWith('recon-summer-vibes-')) return 'summer-vibes'
  if (id.startsWith('recon-stale-vendor-')) return 'stale-vendor'
  if (id.startsWith('recon-game-vendor-')) return 'game-vendor'
  if (createdBy === 'system-reconcile-summer-vibes') return 'summer-vibes'
  if (createdBy === 'system-reconcile-stale-vendor') return 'stale-vendor'
  if (createdBy === 'system-backfill-game-level-vendor') return 'game-vendor'

  // Backfill from billingitems writes canonical le-* doc ids but stamps
  // source/reason/entryType differently from writeVendorLedger.
  if (source === 'backfill-from-billingitems') return 'billing-backfill'
  if (reason.startsWith('Backfill:')) return 'billing-backfill'

  // Catch-all for anything else with a discrepancy_correction marker we
  // didn't recognize (so the user can see it before silent-fix).
  if (entryType === 'discrepancy_correction') return 'other-trace'
  if (id.startsWith('recon-')) return 'other-trace'
  if (createdBy.startsWith('system-reconcile-')) return 'other-trace'
  if (createdBy.startsWith('system-backfill-')) return 'other-trace'
  if (createdBy.startsWith('system-correction-')) return 'other-trace'

  return null
}

;(async () => {
  console.log('Loading vendorLedger…')
  const snap = await db.collection('vendorLedger').get()
  console.log(`Total ledger entries: ${snap.size}`)

  const traces: TraceRow[] = []
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    const cat = classify({ id: d.id, ...data })
    if (!cat) continue
    const bookingId = String(data.referenceId ?? '')
    const vendorId = String(data.vendorId ?? '')
    const amount = Number(data.amount ?? 0) || 0
    const canonicalId = `le-${bookingId}-${vendorId}`
    traces.push({
      ledgerId: d.id,
      bookingId,
      vendorId,
      amount,
      type: String(data.type ?? ''),
      category: cat,
      date: String(data.date ?? ''),
      createdBy: String(data.createdBy ?? ''),
      reason: String(data.reason ?? ''),
      entryType: String(data.entryType ?? ''),
      docIdMatchesCanonical: d.id === canonicalId,
    })
  }

  console.log(`\nTrace entries found: ${traces.length}`)
  if (traces.length === 0) {
    console.log('Nothing to silent-fix. Ledger is clean.')
    return
  }

  // ── Per-category summary ──
  const byCat = new Map<
    Category,
    { count: number; net: number; bookings: Set<string>; vendors: Set<string> }
  >()
  for (const t of traces) {
    const slot = byCat.get(t.category) ?? {
      count: 0,
      net: 0,
      bookings: new Set(),
      vendors: new Set(),
    }
    slot.count += 1
    slot.net += t.type === 'debit' ? -t.amount : t.amount
    slot.bookings.add(t.bookingId)
    slot.vendors.add(t.vendorId)
    byCat.set(t.category, slot)
  }
  console.log(`\n── By category ──`)
  console.log(`category          | entries | bookings | vendors |   net ₹`)
  console.log(`------------------|---------|----------|---------|---------`)
  for (const [cat, s] of byCat.entries()) {
    console.log(
      `${cat.padEnd(17)} | ${String(s.count).padStart(7)} | ${String(s.bookings.size).padStart(8)} | ${String(s.vendors.size).padStart(7)} | ${('₹' + Math.round(s.net)).padStart(8)}`,
    )
  }

  // ── Per-booking rollup (so the user sees "X distinct bookings need silent-fix") ──
  const byBooking = new Map<string, { entries: TraceRow[]; net: number }>()
  for (const t of traces) {
    const slot = byBooking.get(t.bookingId) ?? { entries: [], net: 0 }
    slot.entries.push(t)
    slot.net += t.type === 'debit' ? -t.amount : t.amount
    byBooking.set(t.bookingId, slot)
  }
  console.log(`\nDistinct bookings to silent-fix: ${byBooking.size}`)

  // Sample top 20 bookings by absolute net delta
  const ranked = [...byBooking.entries()]
    .map(([bId, s]) => ({ bId, ...s, abs: Math.abs(s.net) }))
    .sort((a, b) => b.abs - a.abs)

  console.log(`\nTop 20 bookings (by |net delta|):`)
  for (const r of ranked.slice(0, 20)) {
    const cats = new Set(r.entries.map((e) => e.category))
    console.log(
      `  ${r.bId.padEnd(24)} | entries=${String(r.entries.length).padStart(2)} | net=${(r.net >= 0 ? '+' : '') + '₹' + Math.round(r.net)} | ${[...cats].join(',')}`,
    )
  }

  // Write CSV with the full list so the user can audit
  const csvPath = path.resolve('scripts/trace-entries.csv')
  const header =
    'category,ledgerId,bookingId,vendorId,type,amount,date,entryType,createdBy,docIdMatchesCanonical,reason\n'
  const csvEsc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const rows = traces.map((t) =>
    [
      t.category,
      t.ledgerId,
      t.bookingId,
      t.vendorId,
      t.type,
      t.amount,
      t.date,
      t.entryType,
      t.createdBy,
      String(t.docIdMatchesCanonical),
      csvEsc(t.reason),
    ].join(','),
  )
  fs.writeFileSync(csvPath, header + rows.join('\n') + '\n')
  console.log(`\nDetail CSV: ${csvPath}`)
  console.log(`Distinct booking IDs (newline-separated):`)
  console.log([...byBooking.keys()].sort().join('\n'))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
