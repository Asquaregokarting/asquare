/**
 * Summer Vibes vendor-ledger reconciliation.
 *
 * Why: between 2026-04-15 and 2026-05-03 the campaign config was edited
 * (vendor switches, price changes, item renames, BOGO turn-on). Every
 * sale during that window stamped its booking with the config in place
 * AT THAT MOMENT, and the vendor ledger writer (`onBookingPaid`) wrote
 * vendor credits accordingly. Once the config was corrected on the
 * 2026-05-03 edit, those historical credits no longer reflect the
 * corrected ground truth. Some vendors are over-credited; some are
 * under-credited. Net company exposure: ~₹12,883.
 *
 * What this script does:
 *   - Read all Summer Vibes bookings (matched by item-name pattern,
 *     not by activity-id, because legacy bookings use a pre-modern
 *     shape that the writer's heuristic rejects).
 *   - For each completed booking, compute per-vendor expected credit
 *     using the *current* corrected campaign config (with the explicit
 *     "Melt Down 1 time" → "Melt Down 5 min" rename alias).
 *   - Compare against actual `vendorLedger` credits referencing that
 *     booking. Compute deltas.
 *   - Write one `discrepancy_correction` ledger entry per (vendor,
 *     booking) where |delta| > ₹1. Positive deltas = credit (owed),
 *     negative deltas = debit (claw back).
 *
 * What this script does NOT do:
 *   - Edit any booking document. The bookings stay frozen.
 *   - Edit any existing ledger entry. Historical credits remain.
 *   - Touch locked invoices. Corrections are dated today and roll
 *     into the current (unlocked) week's invoice naturally.
 *
 * Usage:
 *   npx tsx scripts/reconcile-summer-vibes-vendor-ledger.ts --dry-run
 *   npx tsx scripts/reconcile-summer-vibes-vendor-ledger.ts            # apply
 *
 * Options:
 *   --dry-run            Print what would change, write nothing.
 *   --csv <path>         Also write a per-vendor reconciliation CSV.
 *   --booking <id>       Limit to a single booking (smoke test).
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const DATABASE = 'asquare-app-db'
const CAMPAIGN_ID = 'event-mnulealx-dvfe'
const VENDOR_LEDGER = 'vendorLedger'
const BOOKINGS = 'bookings'
const EVENT_CAMPAIGNS = 'eventCampaigns'
const TOLERANCE_INR = 1
const RECONCILIATION_DATE = new Date().toISOString().slice(0, 10)
const RECONCILIATION_USER = {
  id: 'system-reconcile-summer-vibes',
  name: 'Summer Vibes reconciliation',
}
const REASON_TEMPLATE = (originalDate: string) =>
  `Summer Vibes config-correction reconciliation: vendor split adjusted to match corrected campaign config (sale dated ${originalDate}). See linkedBookingIds for source.`

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const SINGLE_BOOKING = args.find((a, i) => args[i - 1] === '--booking') ?? null
const CSV_PATH = args.find((a, i) => args[i - 1] === '--csv') ?? null

const findServiceAccountKey = (): string | null => {
  const candidates = [
    path.resolve('serviceAccountKey.json'),
    path.resolve('service-account-key.json'),
    path.resolve('firebase-admin-key.json'),
    path.resolve('scripts/serviceAccountKey.json'),
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

const initAdmin = () => {
  if (getApps().length > 0) return
  const keyPath = findServiceAccountKey()
  if (keyPath) {
    console.log(`Using service account key: ${keyPath}`)
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp()
  } else {
    console.error('No service account key found.')
    process.exit(1)
  }
}

// ── Tokenization & matching ────────────────────────────────────────────────
const tokenize = (s: unknown): string[] =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
const tokenSet = (s: unknown): Set<string> => new Set(tokenize(s))
const tokenOverlap = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0
  let n = 0
  for (const t of a) if (b.has(t)) n++
  return n / Math.max(a.size, b.size)
}

// Explicit aliases for known item renames (user-confirmed):
//   "Melt Down 1 time" was renamed to "Melt Down 5 min" — same vendor activity.
const ITEM_NAME_ALIASES: Array<[RegExp, string]> = [[/melt\s*down\s*1\s*time/i, 'Melt Down 5 min']]

const decodeName = (name: string): { stripped: string; comboN: number | null } => {
  const s = String(name || '')
  const comboMatch = s.match(/Combo\s+(\d+)/i)
  const comboN = comboMatch ? Number(comboMatch[1]) : null
  let stripped = s
    .replace(/^.*?—\s*Combo\s+\d+\s*—\s*/i, '')
    .replace(/\s*\(FREE\)\s*$/i, '')
    .trim()
  for (const [re, replacement] of ITEM_NAME_ALIASES) {
    if (re.test(stripped)) stripped = replacement
  }
  return { stripped, comboN }
}

const isSummerVibesItem = (item: {
  itemName?: string
  activity?: { name?: string; id?: string }
}): boolean => {
  if (/Summer\s*Vibes/i.test(item.itemName || '')) return true
  if (/Summer\s*Vibes/i.test(item.activity?.name || '')) return true
  if (String(item.activity?.id || '').includes(CAMPAIGN_ID)) return true
  return false
}

const isCompanyGoKartLine = (stripped: string): boolean => /gokart/i.test(stripped)

interface FlatItem {
  packageId: string
  packageOrdinal: number
  itemId: string
  name: string
  tokens: Set<string>
  normName: string
  price: number
  type: string
  vendorId: string | null
  revenueShare: boolean
}

const flattenCampaign = (campaignDoc: Record<string, unknown>): FlatItem[] => {
  const flat: FlatItem[] = []
  const packages = (campaignDoc.packages as Record<string, unknown>[]) || []
  packages.forEach((p, pi) => {
    const items = (p.items as Record<string, unknown>[]) || []
    items.forEach((i) => {
      flat.push({
        packageId: String(p.id ?? ''),
        packageOrdinal: pi + 1,
        itemId: String(i.id ?? ''),
        name: String(i.name ?? ''),
        tokens: tokenSet(i.name),
        normName: tokenize(i.name).join(' '),
        price: Number(i.price) || 0,
        type: String(i.type ?? ''),
        vendorId: i.vendorId ? String(i.vendorId) : null,
        revenueShare: i.revenueShare === false ? false : true,
      })
    })
  })
  return flat
}

const findCampaignItem = (flat: FlatItem[], itemName: string): FlatItem | null => {
  const { stripped, comboN } = decodeName(itemName)
  const norm = tokenize(stripped).join(' ')
  if (!norm) return null
  const inCombo = comboN ? flat.filter((f) => f.packageOrdinal === comboN) : flat
  for (const f of inCombo) if (f.normName === norm) return f
  for (const f of inCombo) {
    if (f.normName.startsWith(norm + ' ') || norm.startsWith(f.normName + ' ')) return f
  }
  for (const f of flat) if (f.normName === norm) return f
  for (const f of flat) {
    if (f.normName.startsWith(norm + ' ') || norm.startsWith(f.normName + ' ')) return f
  }
  const tks = tokenSet(stripped)
  let best: FlatItem | null = null
  let bestScore = 0
  for (const f of inCombo.length ? inCombo : flat) {
    const s = tokenOverlap(tks, f.tokens)
    if (s > bestScore) {
      bestScore = s
      best = f
    }
  }
  return bestScore >= 0.5 ? best : null
}

interface CorrectionPlan {
  bookingId: string
  bookingDate: string
  bookingPaymentStatus: string
  vendorId: string
  expected: number
  actual: number
  delta: number
}

interface LineDetail {
  bookingId: string
  bookingDate: string
  bookingPaymentStatus: string
  vendorId: string
  itemId: string
  itemName: string
  quantity: number
  unitPrice: number
  lineExpected: number
}

interface RunSummary {
  bookingsScanned: number
  bookingsConsidered: number
  unmatchedItems: Array<{ bookingId: string; itemName: string }>
  plans: CorrectionPlan[]
  // Per-(booking, vendor, item) breakdown for CSV detail rows. Keyed by
  // `${bookingId}::${vendorId}` to align with each rollup plan above.
  linesByBookingVendor: Map<string, LineDetail[]>
  vendorNames: Map<string, string>
}

const loadVendorNames = async (db: Firestore): Promise<Map<string, string>> => {
  const snap = await db.collection('vendorDetails').get()
  const map = new Map<string, string>()
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    const name = String(
      data.vendorName ?? data.name ?? data.displayName ?? data.companyName ?? '',
    ).trim()
    if (name) map.set(d.id, name)
  }
  return map
}

async function plan(db: Firestore): Promise<RunSummary> {
  const campaignSnap = await db.collection(EVENT_CAMPAIGNS).doc(CAMPAIGN_ID).get()
  if (!campaignSnap.exists) throw new Error(`Campaign ${CAMPAIGN_ID} not found`)
  const flat = flattenCampaign(campaignSnap.data() as Record<string, unknown>)
  console.log(
    `Loaded campaign: ${flat.length} items across ${new Set(flat.map((f) => f.packageId)).size} packages`,
  )

  const vendorNames = await loadVendorNames(db)
  console.log(`Loaded ${vendorNames.size} vendor names from vendorDetails`)

  // Pull all bookings — we need to filter by item-name pattern, no Firestore-side index for that.
  const bookingsSnap = await db.collection(BOOKINGS).get()
  console.log(`Scanned ${bookingsSnap.size} bookings`)

  const ledgerSnap = await db.collection(VENDOR_LEDGER).get()
  console.log(`Scanned ${ledgerSnap.size} vendor ledger entries`)

  // Build (referenceId, vendorId) → sum of credit-debit
  const actualByBookingVendor = new Map<string, number>()
  for (const d of ledgerSnap.docs) {
    const data = d.data() as Record<string, unknown>
    const refId = String(data.referenceId ?? data.bookingId ?? '')
    const vid = String(data.vendorId ?? '')
    if (!refId || !vid) continue
    const amt =
      Number(
        data.amount ??
          data.vendorTotal ??
          (Number(data.vendorBase) || 0) + (Number(data.vendorGst) || 0),
      ) || 0
    const signed = data.type === 'debit' ? -amt : amt
    const k = `${refId}::${vid}`
    actualByBookingVendor.set(k, (actualByBookingVendor.get(k) || 0) + signed)
  }

  const unmatchedItems: Array<{ bookingId: string; itemName: string }> = []
  const plans: CorrectionPlan[] = []
  const linesByBookingVendor = new Map<string, LineDetail[]>()
  let considered = 0

  for (const bDoc of bookingsSnap.docs) {
    const bId = bDoc.id
    if (SINGLE_BOOKING && bId !== SINGLE_BOOKING) continue
    const b = bDoc.data() as Record<string, unknown>
    const items = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : []
    if (
      !items.some((it) =>
        isSummerVibesItem(it as { itemName?: string; activity?: { name?: string; id?: string } }),
      )
    )
      continue
    if (b.paymentStatus !== 'completed') continue
    considered++

    const bookingDateForLine =
      typeof b.transactionDate === 'string' && b.transactionDate.length >= 10
        ? b.transactionDate.slice(0, 10)
        : new Date(
            (b.createdAt as { toDate?: () => Date })?.toDate?.()?.getTime?.() ??
              (typeof b.createdAt === 'string' ? Date.parse(b.createdAt as string) : Date.now()),
          )
            .toISOString()
            .slice(0, 10)

    const expectedByVendor: Record<string, number> = {}
    for (const it of items) {
      if (
        !isSummerVibesItem(it as { itemName?: string; activity?: { name?: string; id?: string } })
      )
        continue
      const itemName = String(it.itemName ?? '')
      const { stripped } = decodeName(itemName)
      if (isCompanyGoKartLine(stripped)) continue
      const matched = findCampaignItem(flat, itemName)
      if (!matched) {
        unmatchedItems.push({ bookingId: bId, itemName })
        continue
      }
      if (matched.type !== 'thirdParty' || !matched.vendorId) continue
      const qty = Number(it.quantity) || 0
      const credit =
        matched.revenueShare === false ? matched.price * qty : Math.round(matched.price * qty * 0.8)
      expectedByVendor[matched.vendorId] = (expectedByVendor[matched.vendorId] || 0) + credit

      const lineKey = `${bId}::${matched.vendorId}`
      if (!linesByBookingVendor.has(lineKey)) linesByBookingVendor.set(lineKey, [])
      linesByBookingVendor.get(lineKey)!.push({
        bookingId: bId,
        bookingDate: bookingDateForLine,
        bookingPaymentStatus: String(b.paymentStatus),
        vendorId: matched.vendorId,
        itemId: matched.itemId,
        itemName: matched.name,
        quantity: qty,
        unitPrice: matched.price,
        lineExpected: credit,
      })
    }

    // Determine actual credits by scanning the precomputed map for this booking
    const actualByVendor: Record<string, number> = {}
    for (const [k, sum] of actualByBookingVendor.entries()) {
      const [refId, vid] = k.split('::')
      if (refId === bId) actualByVendor[vid] = sum
    }

    const allVendors = new Set<string>([
      ...Object.keys(expectedByVendor),
      ...Object.keys(actualByVendor),
    ])

    for (const vid of allVendors) {
      const exp = expectedByVendor[vid] || 0
      const act = actualByVendor[vid] || 0
      const delta = exp - act
      if (Math.abs(delta) <= TOLERANCE_INR) continue
      plans.push({
        bookingId: bId,
        bookingDate: bookingDateForLine,
        bookingPaymentStatus: String(b.paymentStatus),
        vendorId: vid,
        expected: exp,
        actual: act,
        delta,
      })
    }
  }

  return {
    bookingsScanned: bookingsSnap.size,
    bookingsConsidered: considered,
    unmatchedItems,
    plans,
    linesByBookingVendor,
    vendorNames,
  }
}

const csvEscape = (v: string): string => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const writeCsv = (
  path: string,
  plans: CorrectionPlan[],
  linesByBookingVendor: Map<string, LineDetail[]>,
  vendorNames: Map<string, string>,
): void => {
  const header =
    'bookingId,bookingDate,paymentStatus,vendorId,vendorName,scope,itemId,itemName,quantity,unitPrice,lineExpected,vendorExpected,vendorActual,vendorDelta\n'

  // Sort plans by bookingId then vendorId so the file groups naturally.
  const sortedPlans = [...plans].sort((a, b) =>
    a.bookingId === b.bookingId
      ? a.vendorId.localeCompare(b.vendorId)
      : a.bookingId.localeCompare(b.bookingId),
  )

  const rows: string[] = []
  for (const plan of sortedPlans) {
    const vName = csvEscape(vendorNames.get(plan.vendorId) ?? '')
    const lineKey = `${plan.bookingId}::${plan.vendorId}`
    const lines = linesByBookingVendor.get(lineKey) ?? []

    // Per-line rows. For pure overpaid-to-old-vendor cases the lines
    // array is empty (vendor has no items in current config) — that's
    // fine; only the rollup row will appear.
    for (const ln of lines) {
      rows.push(
        [
          plan.bookingId,
          plan.bookingDate,
          plan.bookingPaymentStatus,
          plan.vendorId,
          vName,
          'line',
          ln.itemId,
          csvEscape(ln.itemName),
          ln.quantity,
          ln.unitPrice,
          ln.lineExpected,
          '',
          '',
          '',
        ].join(','),
      )
    }
    // Rollup row carrying the actual vs expected vs delta totals — this
    // is what mirrors the ledger correction entry that will be written.
    rows.push(
      [
        plan.bookingId,
        plan.bookingDate,
        plan.bookingPaymentStatus,
        plan.vendorId,
        vName,
        'rollup',
        '',
        '',
        '',
        '',
        '',
        plan.expected,
        plan.actual,
        plan.delta,
      ].join(','),
    )
  }

  fs.writeFileSync(path, header + rows.join('\n') + '\n')
  console.log(`CSV written: ${path}`)
}

async function applyCorrections(
  db: Firestore,
  plans: CorrectionPlan[],
  vendorNames: Map<string, string>,
): Promise<void> {
  const batchSize = 400
  for (let i = 0; i < plans.length; i += batchSize) {
    const slice = plans.slice(i, i + batchSize)
    const batch = db.batch()
    for (const p of slice) {
      // Deterministic doc id so re-runs are idempotent.
      const docId = `recon-summer-vibes-${p.bookingId}-${p.vendorId}`
      const amount = Math.abs(p.delta)
      const vendorName = vendorNames.get(p.vendorId)
      batch.set(db.collection(VENDOR_LEDGER).doc(docId), {
        id: docId,
        vendorId: p.vendorId,
        ...(vendorName ? { vendorName } : {}),
        amount,
        type: p.delta > 0 ? 'credit' : 'debit',
        entryType: 'discrepancy_correction',
        referenceId: p.bookingId,
        invoiceNumber: p.bookingId,
        date: RECONCILIATION_DATE,
        createdAt: new Date().toISOString(),
        source: 'booking',
        reason: REASON_TEMPLATE(p.bookingDate),
        linkedBookingIds: [p.bookingId],
        createdBy: RECONCILIATION_USER.id,
        createdByName: RECONCILIATION_USER.name,
      })
    }
    await batch.commit()
    console.log(
      `Wrote batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(plans.length / batchSize)} (${slice.length} entries)`,
    )
  }
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE)
  const summary = await plan(db)

  // Per-vendor totals for the summary
  const perVendor: Record<
    string,
    { credit: number; debit: number; net: number; bookings: number }
  > = {}
  const seen = new Set<string>()
  for (const p of summary.plans) {
    const key = `${p.vendorId}::${p.bookingId}`
    perVendor[p.vendorId] ||= { credit: 0, debit: 0, net: 0, bookings: 0 }
    if (!seen.has(key)) {
      perVendor[p.vendorId].bookings += 1
      seen.add(key)
    }
    if (p.delta > 0) perVendor[p.vendorId].credit += p.delta
    else perVendor[p.vendorId].debit += -p.delta
    perVendor[p.vendorId].net += p.delta
  }

  console.log(`\n── Plan summary${DRY_RUN ? ' [dry-run]' : ''} ──`)
  console.log(`Bookings scanned: ${summary.bookingsScanned}`)
  console.log(
    `Bookings considered (Summer Vibes, paymentStatus=completed): ${summary.bookingsConsidered}`,
  )
  console.log(`Unmatched items: ${summary.unmatchedItems.length}`)
  console.log(`Correction entries to write: ${summary.plans.length}`)

  console.log(`\n── Per vendor ──`)
  const sorted = Object.entries(perVendor).sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net))
  // Pad vendor name to the longest seen, capped at 30 for table sanity.
  const nameWidth = Math.min(
    30,
    Math.max(11, ...sorted.map(([vid]) => (summary.vendorNames.get(vid) ?? '?').length)),
  )
  const truncate = (s: string): string =>
    s.length > nameWidth ? s.slice(0, nameWidth - 1) + '…' : s
  const sep = `${'-'.repeat(13)}|${'-'.repeat(nameWidth + 2)}|----------|----------|----------|---------`
  console.log(
    `${'vendorId'.padEnd(13)} | ${'vendorName'.padEnd(nameWidth)} |   credit |    debit |      net | bookings`,
  )
  console.log(sep)
  for (const [vid, v] of sorted) {
    const name = truncate(summary.vendorNames.get(vid) ?? '?')
    console.log(
      `${vid.padEnd(13)} | ${name.padEnd(nameWidth)} | ${String(v.credit).padStart(8)} | ${String(v.debit).padStart(8)} | ${String(v.net).padStart(8)} | ${String(v.bookings).padStart(7)}`,
    )
  }
  const grandCredit = sorted.reduce((s, [, v]) => s + v.credit, 0)
  const grandDebit = sorted.reduce((s, [, v]) => s + v.debit, 0)
  console.log(sep)
  console.log(
    `${'TOTAL'.padEnd(13)} | ${''.padEnd(nameWidth)} | ${String(grandCredit).padStart(8)} | ${String(grandDebit).padStart(8)} | ${String(grandCredit - grandDebit).padStart(8)} |`,
  )

  if (summary.unmatchedItems.length > 0) {
    console.log(`\n── Unmatched item lines (skipped) ──`)
    for (const u of summary.unmatchedItems) {
      console.log(`  ${u.bookingId}: ${u.itemName}`)
    }
  }

  if (CSV_PATH) writeCsv(CSV_PATH, summary.plans, summary.linesByBookingVendor, summary.vendorNames)

  if (DRY_RUN) {
    console.log('\n[dry-run] No writes performed. Re-run without --dry-run to apply.')
    return
  }
  if (summary.plans.length === 0) {
    console.log('\nNothing to write.')
    return
  }
  console.log(`\nApplying ${summary.plans.length} ledger correction entries…`)
  await applyCorrections(db, summary.plans, summary.vendorNames)
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
