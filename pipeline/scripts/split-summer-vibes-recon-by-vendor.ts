/**
 * Split the combined Summer Vibes reconciliation CSV into one file per
 * vendor, plus a top-level index listing every vendor and their totals.
 *
 * Reads the CSV produced by:
 *   npx tsx scripts/reconcile-summer-vibes-vendor-ledger.ts --dry-run --csv ./summer-vibes-recon.csv
 *
 * Output layout (default --out-dir ./vendor-recon/):
 *   vendor-recon/
 *     INDEX.txt                          ← summary table, vendors sorted by |delta|
 *     recon-8712234222-{slug}.csv        ← one per vendor with that vendor's rows only
 *     recon-7013328453-{slug}.csv
 *     ...
 *
 * Each per-vendor CSV preserves the same column header as the source so
 * you can attach it directly to a vendor message and they see line items
 * + rollup row(s) without further editing.
 *
 * Pure file-IO. No Firestore, no auth.
 *
 * Usage:
 *   npx tsx scripts/split-summer-vibes-recon-by-vendor.ts
 *   npx tsx scripts/split-summer-vibes-recon-by-vendor.ts --input ./summer-vibes-recon.csv --out-dir ./vendor-recon
 */

import * as fs from 'fs'
import * as path from 'path'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}

const INPUT = path.resolve(flag('--input', './summer-vibes-recon.csv'))
const OUT_DIR = path.resolve(flag('--out-dir', './vendor-recon'))

if (!fs.existsSync(INPUT)) {
  console.error(`Input CSV not found: ${INPUT}`)
  console.error('Run the reconciliation script first with --csv to produce it.')
  process.exit(1)
}

// ── Minimal CSV parser handling quoted fields with commas/quotes ──────────
const parseCsvRow = (line: string): string[] => {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else if (ch === '"' && cur === '') {
      inQuotes = true
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

const slugify = (s: string): string =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'unnamed'

const raw = fs.readFileSync(INPUT, 'utf-8')
const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
if (lines.length === 0) {
  console.error('Input CSV is empty.')
  process.exit(1)
}

const header = lines[0]
const headerCols = parseCsvRow(header)
const idx = (name: string): number => {
  const i = headerCols.indexOf(name)
  if (i < 0) {
    console.error(`Expected column "${name}" not found in header: ${header}`)
    process.exit(1)
  }
  return i
}
const colVendorId = idx('vendorId')
const colVendorName = idx('vendorName')
const colScope = idx('scope')
const colDelta = idx('vendorDelta')
const colBookingId = idx('bookingId')

interface VendorBucket {
  vendorId: string
  vendorName: string
  rows: string[]
  rollupCount: number
  lineCount: number
  totalDelta: number
  bookingIds: Set<string>
}

const byVendor = new Map<string, VendorBucket>()

for (let i = 1; i < lines.length; i++) {
  const cols = parseCsvRow(lines[i])
  const vid = cols[colVendorId]
  if (!vid) continue
  if (!byVendor.has(vid)) {
    byVendor.set(vid, {
      vendorId: vid,
      vendorName: cols[colVendorName] || '',
      rows: [],
      rollupCount: 0,
      lineCount: 0,
      totalDelta: 0,
      bookingIds: new Set<string>(),
    })
  }
  const bucket = byVendor.get(vid)!
  bucket.rows.push(lines[i])
  bucket.bookingIds.add(cols[colBookingId])
  if (cols[colScope] === 'rollup') {
    bucket.rollupCount += 1
    const d = Number(cols[colDelta])
    if (Number.isFinite(d)) bucket.totalDelta += d
  } else if (cols[colScope] === 'line') {
    bucket.lineCount += 1
  }
  // Latch the longest-seen vendor name (some rows may have it blank)
  if (cols[colVendorName] && !bucket.vendorName) bucket.vendorName = cols[colVendorName]
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

// Sort vendors by |delta| desc so the biggest deltas surface first in INDEX.txt
const sortedVendors = [...byVendor.values()].sort(
  (a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta),
)

let totalCredit = 0
let totalDebit = 0

const indexLines: string[] = [
  `Summer Vibes vendor reconciliation — split by vendor`,
  `Source: ${INPUT}`,
  `Generated: ${new Date().toISOString()}`,
  ``,
  `Vendor count: ${sortedVendors.length}`,
  ``,
  `vendorId      | vendorName                       | bookings | lines | rollups |    delta | direction | file`,
  `--------------|----------------------------------|----------|-------|---------|----------|-----------|-----`,
]

for (const v of sortedVendors) {
  const slug = slugify(v.vendorName || v.vendorId)
  const fileName = `recon-${v.vendorId}-${slug}.csv`
  const filePath = path.join(OUT_DIR, fileName)
  fs.writeFileSync(filePath, header + '\n' + v.rows.join('\n') + '\n')

  if (v.totalDelta > 0) totalCredit += v.totalDelta
  else totalDebit += -v.totalDelta

  const direction = v.totalDelta > 0 ? 'CREDIT (owed)' : v.totalDelta < 0 ? 'DEBIT (claw)' : '~zero'
  const namePadded = (v.vendorName || '?').padEnd(32).slice(0, 32)
  indexLines.push(
    `${v.vendorId.padEnd(13)} | ${namePadded} | ${String(v.bookingIds.size).padStart(8)} | ${String(v.lineCount).padStart(5)} | ${String(v.rollupCount).padStart(7)} | ${String(v.totalDelta).padStart(8)} | ${direction.padEnd(9)} | ${fileName}`,
  )
}

indexLines.push(``)
indexLines.push(`TOTAL credit (we owe vendors): ₹${totalCredit}`)
indexLines.push(`TOTAL debit (claw back from vendors): ₹${totalDebit}`)
indexLines.push(`NET (vendors collectively under-credited): ₹${totalCredit - totalDebit}`)

const indexPath = path.join(OUT_DIR, 'INDEX.txt')
fs.writeFileSync(indexPath, indexLines.join('\n') + '\n')

console.log(`Wrote ${sortedVendors.length} per-vendor CSVs to ${OUT_DIR}/`)
console.log(`Index: ${indexPath}`)
console.log(
  `Total credit: ₹${totalCredit}  Total debit: ₹${totalDebit}  Net: ₹${totalCredit - totalDebit}`,
)
