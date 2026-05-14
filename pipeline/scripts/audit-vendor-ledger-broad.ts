/**
 * Broad vendor-ledger audit — every booking in a date range, every vendor.
 *
 * Outputs an Excel workbook (default) AND/OR a CSV. Excel adds:
 *   - AutoFilter on the header row
 *   - Frozen header
 *   - Light-blue fill on `line` rows, light-yellow fill on `rollup` rows
 *     (rollup rows also bold)
 *   - Booking-status cell color: green (confirmed/completed), red
 *     (cancelled), amber (pending), grey (other)
 *   - Conditional formatting on `vendorDelta`: green if positive, red if
 *     negative, no fill near zero
 *   - INR (₹) accounting format on currency columns
 *   - A second "Vendor Summary" sheet aggregating expected/actual/delta
 *     per vendor, sorted by |delta| desc
 *
 * Two ground-truth sources, picked per item:
 *   - Event-package items (category='Event' / activity.id starts with
 *     `evt-`): looked up against the corresponding event campaign's
 *     current corrected config (with the Melt Down alias).
 *   - Regular items: ground truth is the booking's own stamped
 *     `activity.vendorId × activity.basePrice × quantity` — so this
 *     path catches WRITER bugs (booking stamped X, ledger wrote Y).
 *
 * Read-only. No Firestore writes.
 *
 * Usage:
 *   npx tsx scripts/audit-vendor-ledger-broad.ts                          # default 28-Mar → today, writes ./vendor-audit.xlsx
 *   npx tsx scripts/audit-vendor-ledger-broad.ts --from 2026-03-28 --to 2026-05-05
 *   npx tsx scripts/audit-vendor-ledger-broad.ts --xlsx ./out.xlsx --csv ./out.csv
 *   npx tsx scripts/audit-vendor-ledger-broad.ts --vendor 7777997226      # filter to one vendor
 *   npx tsx scripts/audit-vendor-ledger-broad.ts --only-deltas            # only include rollups with non-zero delta + their lines
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import ExcelJS from 'exceljs'
import * as path from 'path'
import * as fs from 'fs'

const DATABASE = 'asquare-app-db'
const VENDOR_LEDGER = 'vendorLedger'
const BOOKINGS = 'bookings'
const EVENT_CAMPAIGNS = 'eventCampaigns'
const VENDOR_DETAILS = 'vendorDetails'
const _TOLERANCE_INR = 1
const _GST_PERCENT = 18
const VENDOR_SHARE_DEFAULT = 80 // matches onBookingPaid default

const args = process.argv.slice(2)
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const FROM = flag('--from', '2026-03-28') // inclusive
const TO = flag('--to', new Date().toISOString().slice(0, 10)) // inclusive
const CSV_PATH = args.find((a, i) => args[i - 1] === '--csv') ?? null
const XLSX_PATH = args.find((a, i) => args[i - 1] === '--xlsx') ?? './vendor-audit.xlsx'
const VENDOR_FILTER = flag('--vendor', '') || null
const ONLY_DELTAS = args.includes('--only-deltas')
// When set, instead of (or in addition to) the combined xlsx, emit one
// styled .xlsx per vendor into the given directory. Defaults to
// `./vendor-audit-split/` when the flag is present without a value.
const PER_VENDOR_DIR = (() => {
  const i = args.indexOf('--per-vendor')
  if (i < 0) return null
  const next = args[i + 1]
  if (!next || next.startsWith('--')) return './vendor-audit-split'
  return next
})()
const SKIP_COMBINED = args.includes('--skip-combined')

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

// ── Date helpers ────────────────────────────────────────────────────────
const fromDate = new Date(`${FROM}T00:00:00+05:30`)
const toDate = new Date(`${TO}T23:59:59+05:30`)

const toDateValue = (raw: unknown): Date | null => {
  if (!raw) return null
  if (raw instanceof Date) return raw
  if (typeof raw === 'string') {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof raw === 'object') {
    const o = raw as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof o.toDate === 'function') {
      try {
        return o.toDate()
      } catch {
        /* fall through */
      }
    }
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000)
    if (typeof o._seconds === 'number') return new Date(o._seconds * 1000)
  }
  return null
}

const inWindow = (d: Date): boolean =>
  d.getTime() >= fromDate.getTime() && d.getTime() <= toDate.getTime()

// ── Tokenization & event-package matcher (same as reconcile script) ─────
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

const ITEM_NAME_ALIASES: Array<[RegExp, string]> = [[/melt\s*down\s*1\s*time/i, 'Melt Down 5 min']]

const decodeEventName = (name: string): { stripped: string; comboN: number | null } => {
  const s = String(name || '')
  const cm = s.match(/Combo\s+(\d+)/i)
  const comboN = cm ? Number(cm[1]) : null
  let stripped = s
    .replace(/^.*?—\s*Combo\s+\d+\s*—\s*/i, '')
    .replace(/\s*\(FREE\)\s*$/i, '')
    .trim()
  for (const [re, repl] of ITEM_NAME_ALIASES) if (re.test(stripped)) stripped = repl
  return { stripped, comboN }
}

interface EventCatalogItem {
  campaignId: string
  packageOrdinal: number
  packageId: string
  itemId: string
  name: string
  tokens: Set<string>
  normName: string
  price: number
  type: string
  vendorId: string | null
  revenueShare: boolean
}

const loadEventCatalog = async (db: Firestore): Promise<EventCatalogItem[]> => {
  const snap = await db.collection(EVENT_CAMPAIGNS).get()
  const flat: EventCatalogItem[] = []
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    const packages = (data.packages as Record<string, unknown>[]) || []
    packages.forEach((p, pi) => {
      const items = (p.items as Record<string, unknown>[]) || []
      items.forEach((i) => {
        flat.push({
          campaignId: d.id,
          packageOrdinal: pi + 1,
          packageId: String(p.id ?? ''),
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
  }
  return flat
}

const findEventItem = (
  flat: EventCatalogItem[],
  itemName: string,
  campaignId: string | null,
): EventCatalogItem | null => {
  const { stripped, comboN } = decodeEventName(itemName)
  const norm = tokenize(stripped).join(' ')
  if (!norm) return null
  const scope = campaignId ? flat.filter((f) => f.campaignId === campaignId) : flat
  const inCombo = comboN ? scope.filter((f) => f.packageOrdinal === comboN) : scope
  for (const f of inCombo) if (f.normName === norm) return f
  for (const f of inCombo)
    if (f.normName.startsWith(norm + ' ') || norm.startsWith(f.normName + ' ')) return f
  for (const f of scope) if (f.normName === norm) return f
  for (const f of scope)
    if (f.normName.startsWith(norm + ' ') || norm.startsWith(f.normName + ' ')) return f
  const tks = tokenSet(stripped)
  let best: EventCatalogItem | null = null
  let bestScore = 0
  for (const f of inCombo.length ? inCombo : scope) {
    const s = tokenOverlap(tks, f.tokens)
    if (s > bestScore) {
      bestScore = s
      best = f
    }
  }
  return bestScore >= 0.5 ? best : null
}

const parseEventActivityId = (id: string | undefined): string | null => {
  if (!id || typeof id !== 'string') return null
  const m = id.match(/^evt-(?:event-)?(.+?)-pkg-([0-9a-f-]{36})-([0-9a-f-]{36})$/)
  return m ? m[1] : null
}

const isEventPackageItem = (item: {
  itemName?: string
  activity?: { name?: string; category?: string; id?: string }
}): boolean => {
  const cat = String(item.activity?.category ?? '').toLowerCase()
  const id = String(item.activity?.id ?? '')
  if (cat === 'event') return true
  if (id.startsWith('evt-')) return true
  if (/Summer\s*Vibes\s*—/i.test(item.itemName || '')) return true
  return false
}

// ── Vendor names ────────────────────────────────────────────────────────
const loadVendorNames = async (db: Firestore): Promise<Map<string, string>> => {
  const snap = await db.collection(VENDOR_DETAILS).get()
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

// ── Per-line + per-rollup row types ─────────────────────────────────────
interface LineRow {
  scope: 'line'
  bookingId: string
  bookingDate: string
  bookingStatus: string
  bookingSource: string
  paymentMethod: string
  initiatorRole: string
  vendorId: string
  vendorName: string
  activityId: string
  gameId: string
  gameName: string
  subGameId: string
  subGameName: string
  variantId: string
  variantLabel: string
  locationId: string
  quantity: number
  unitPrice: number
  lineExpected: number
  /** Pro-rata share of vendorActual based on lineExpected. Filled in after the
   *  rollup is computed so per-game/subGame/variant aggregation can sum
   *  consistently with the vendor-level actual. */
  lineActualShare: number
  lineDelta: number
  itemNameRaw: string
}

interface RollupRow {
  scope: 'rollup'
  bookingId: string
  bookingDate: string
  bookingStatus: string
  bookingSource: string
  paymentMethod: string
  initiatorRole: string
  vendorId: string
  vendorName: string
  locationId: string
  vendorExpected: number
  vendorActual: number
  vendorDelta: number
}

type AnyRow = LineRow | RollupRow

const csvEscape = (v: unknown): string => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ── Bug detection ───────────────────────────────────────────────────────
interface BugFinding {
  bookingId: string
  bookingDate: string
  bookingSource: string
  paymentStatus: string
  bookingStatus: string
  finalAmount: number
  category:
    | 'paid_no_billing_items'
    | 'paid_no_ledger_entries'
    | 'ledger_mismatch_billing'
    | 'corrupt_createdAt'
    | 'pending_with_ledger_entries'
    | 'vendor_stamp_missing_for_vendor_game'
  detail: string
}

// ── Audit ───────────────────────────────────────────────────────────────
async function audit(db: Firestore): Promise<{
  rows: AnyRow[]
  bookingsScanned: number
  bookingsInWindow: number
  bookingsConsidered: number
  bugFindings: BugFinding[]
}> {
  const eventCatalog = await loadEventCatalog(db)
  console.log(
    `Loaded ${eventCatalog.length} event-catalog items across ${new Set(eventCatalog.map((f) => f.campaignId)).size} campaigns`,
  )

  const vendorNames = await loadVendorNames(db)
  console.log(`Loaded ${vendorNames.size} vendor names`)

  const ledgerSnap = await db.collection(VENDOR_LEDGER).get()
  console.log(`Loaded ${ledgerSnap.size} vendor ledger entries`)

  // Walk locations/*/games/* once, build (branchId, gameId) -> vendorId map.
  // Used by the vendor_stamp_missing_for_vendor_game detector below to
  // flag bookings that hit a vendor_game in the catalog but stamped no
  // vendorId on items[] or billingItems[]. This catches the systemic
  // class of bug uncovered when ASG260506144416104BXLL was investigated:
  // toBookableCatalogActivity dropped vendorId before the booking write.
  const gameVendorMap = new Map<string, string>()
  const branchSlugToId: Record<string, string> = {
    visakhapatnam: '0',
    vizag: '0',
    kakinada: '1',
    rajahmundry: '2',
    srikakulam: '5',
  }
  try {
    const locsSnap = await db.collection('locations').get()
    for (const loc of locsSnap.docs) {
      const games = await loc.ref.collection('games').get()
      for (const g of games.docs) {
        const data = g.data() as { metadata?: Record<string, unknown> }
        const meta = data.metadata ?? {}
        if (meta.gameType !== 'vendor_game') continue
        const vid =
          typeof meta.vendorId === 'string' && meta.vendorId
            ? meta.vendorId
            : typeof meta.vendorUserId === 'string' && meta.vendorUserId
              ? meta.vendorUserId
              : ''
        if (vid) gameVendorMap.set(`${loc.id}::${g.id}`, vid)
      }
    }
    console.log(`Loaded ${gameVendorMap.size} (branch, game) -> vendorId mappings`)
  } catch (err) {
    console.warn(
      `Failed to walk locations hierarchy for vendor map: ${err instanceof Error ? err.message : err}`,
    )
  }

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

  const bookingsSnap = await db.collection(BOOKINGS).get()
  console.log(`Loaded ${bookingsSnap.size} bookings, filtering by createdAt window ${FROM} → ${TO}`)

  const rows: AnyRow[] = []
  const bugFindings: BugFinding[] = []
  let inWindowCount = 0
  let considered = 0

  // Pre-scan: build a per-bookingId set so the bug-hunt loop can see
  // whether a booking has any ledger entries at all without re-scanning.
  const bookingIdsWithLedger = new Set<string>()
  for (const k of actualByBookingVendor.keys()) {
    bookingIdsWithLedger.add(k.split('::')[0])
  }

  for (const bDoc of bookingsSnap.docs) {
    const b = bDoc.data() as Record<string, unknown>
    const ca = toDateValue(b.createdAt)
    if (!ca || !inWindow(ca)) continue
    inWindowCount++
    if (b.paymentStatus !== 'completed') continue
    considered++

    const items = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : []
    const billingItems = Array.isArray(b.billingItems)
      ? (b.billingItems as Array<Record<string, unknown>>)
      : []
    const locationId = String(b.locationId ?? '')
    const bookingStatus = String(b.bookingStatus ?? '')
    // Resolve a clean source label per booking. `source` is the canonical
    // field ('POS' | 'ADMIN_BOOKING' | 'APP_BOOKING'). `sourceType` adds
    // POS variants ('BILLING' for the Pipeline cashier path). When neither
    // is set, infer from createdByRole — most legacy bookings.
    const rawSource = String(b.source ?? '')
    const rawSourceType = String(b.sourceType ?? '')
    const initiatorRole = String(b.createdByRole ?? '').toLowerCase()
    const bookingSource =
      rawSourceType === 'BILLING'
        ? 'POS-Billing'
        : rawSource === 'POS'
          ? 'POS'
          : rawSource === 'ADMIN_BOOKING'
            ? initiatorRole === 'telecaller'
              ? 'Telecaller-link'
              : 'Admin-link'
            : rawSource === 'APP_BOOKING'
              ? 'Customer-app'
              : initiatorRole
                ? `Other (${initiatorRole})`
                : 'Unknown'
    const paymentMethod = String(b.paymentMethod ?? '')
    const paymentStatus = String(b.paymentStatus ?? '')
    const finalAmount = Number(b.finalAmount) || 0

    // Booking date in IST as YYYY-MM-DD. Prefer transactionDate (a clean
    // string) when present, otherwise convert createdAt (Timestamp) to IST.
    const bookingDate =
      typeof b.transactionDate === 'string' && b.transactionDate.length >= 10
        ? b.transactionDate.slice(0, 10)
        : (() => {
            const ms = ca.getTime() + 5.5 * 60 * 60 * 1000
            return new Date(ms).toISOString().slice(0, 10)
          })()

    // ── Bug-hunt checks (run once per booking before vendor-row aggregation) ──
    const isCorruptCreatedAt = ca.getTime() === 0 || (ca instanceof Date && ca.getFullYear() < 2020)
    const hasLedgerEntries = bookingIdsWithLedger.has(bDoc.id)
    const billingItemsVendorTotal = billingItems.reduce(
      (s, bi) => s + (Number((bi as Record<string, unknown>).vendorTotal) || 0),
      0,
    )
    const totalLedgerForBooking = Array.from(actualByBookingVendor.entries())
      .filter(([k]) => k.startsWith(`${bDoc.id}::`))
      .reduce((s, [, v]) => s + v, 0)

    if (isCorruptCreatedAt) {
      bugFindings.push({
        bookingId: bDoc.id,
        bookingDate: 'corrupt',
        bookingSource,
        paymentStatus,
        bookingStatus,
        finalAmount,
        category: 'corrupt_createdAt',
        detail: `createdAt is ${ca.toISOString?.() ?? 'invalid'} — backfill required`,
      })
    }

    if (paymentStatus === 'completed' && billingItems.length === 0 && finalAmount > 0) {
      bugFindings.push({
        bookingId: bDoc.id,
        bookingDate,
        bookingSource,
        paymentStatus,
        bookingStatus,
        finalAmount,
        category: 'paid_no_billing_items',
        detail:
          'Payment completed but billingItems is empty. completeBillingOnPayment likely never fired.',
      })
    }

    if (paymentStatus === 'completed' && billingItemsVendorTotal > 0 && !hasLedgerEntries) {
      bugFindings.push({
        bookingId: bDoc.id,
        bookingDate,
        bookingSource,
        paymentStatus,
        bookingStatus,
        finalAmount,
        category: 'paid_no_ledger_entries',
        detail: `Booking has billingItems vendor share ₹${billingItemsVendorTotal} but no vendorLedger entries. Vendor never paid.`,
      })
    }

    // Refunded bookings net the ledger to ~0 via credit+debit pairs while
    // billingItems stays as the original sale snapshot. They're SUPPOSED
    // to disagree post-refund, so skip the mismatch flag.
    const refundStatus = String(b.refundStatus ?? 'None')
    const isRefunded = refundStatus !== 'None' && refundStatus !== ''
    if (
      paymentStatus === 'completed' &&
      !isRefunded &&
      billingItemsVendorTotal > 0 &&
      hasLedgerEntries &&
      Math.abs(totalLedgerForBooking - billingItemsVendorTotal) > TOLERANCE_INR
    ) {
      bugFindings.push({
        bookingId: bDoc.id,
        bookingDate,
        bookingSource,
        paymentStatus,
        bookingStatus,
        finalAmount,
        category: 'ledger_mismatch_billing',
        detail: `billingItems vendorTotal=₹${Math.round(billingItemsVendorTotal)} but ledger sum=₹${Math.round(totalLedgerForBooking)} (delta ₹${Math.round(billingItemsVendorTotal - totalLedgerForBooking)})`,
      })
    }

    if (paymentStatus !== 'completed' && hasLedgerEntries) {
      bugFindings.push({
        bookingId: bDoc.id,
        bookingDate,
        bookingSource,
        paymentStatus,
        bookingStatus,
        finalAmount,
        category: 'pending_with_ledger_entries',
        detail: `Booking is ${paymentStatus} but has ledger entries summing ₹${Math.round(totalLedgerForBooking)}. Vendor was credited for an unpaid sale.`,
      })
    }

    // vendor_stamp_missing_for_vendor_game — booking has at least one item
    // whose (branchId, gameId) maps to a `vendor_game` per the modern
    // catalog (locations/*/games/*.metadata.vendorId), but neither the
    // item nor its parallel billingItem carries a vendorId stamp. The
    // vendor was silently shorted because the booking-creation flow
    // didn't propagate the catalog's vendor onto the booking item.
    if (paymentStatus === 'completed' && !isRefunded && gameVendorMap.size > 0) {
      const branchId = branchSlugToId[locationId.toLowerCase()] ?? locationId
      const missing: string[] = []
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx]
        const a = (it.activity as Record<string, unknown> | undefined) ?? {}
        const gameId = String(it.gameId ?? a.gameId ?? '').toLowerCase()
        if (!gameId) continue
        const expectedVendor = gameVendorMap.get(`${branchId}::${gameId}`)
        if (!expectedVendor) continue
        const stampedItem = String(it.vendorId ?? a.vendorId ?? '').trim()
        if (stampedItem) continue
        const bi = (billingItems[idx] as Record<string, unknown> | undefined) ?? {}
        const stampedBilling = String(bi.vendorId ?? '').trim()
        if (stampedBilling) continue
        missing.push(`${gameId} (expected vendor ${expectedVendor})`)
      }
      if (missing.length > 0) {
        bugFindings.push({
          bookingId: bDoc.id,
          bookingDate,
          bookingSource,
          paymentStatus,
          bookingStatus,
          finalAmount,
          category: 'vendor_stamp_missing_for_vendor_game',
          detail: `Item(s) hit a vendor_game in the catalog but no vendorId was stamped: ${missing.join('; ')}`,
        })
      }
    }

    // Per-vendor accumulator for THIS booking
    const expectedByVendor: Record<string, number> = {}
    const lineRowsForBooking: LineRow[] = []

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx]
      const itemName = String(it.itemName ?? '')
      const qty = Number(it.quantity) || 0
      if (qty === 0) continue
      const activity = (it.activity as Record<string, unknown> | undefined) ?? {}
      // billingItems[] is parallel to items[] (same index) and is the
      // authoritative per-line vendor split written by enrichItemsWithBilling.
      // Many bookings (especially POS) carry the vendorId/gameId/subGameId
      // ONLY on billingItems, not on item.activity — fall back to it.
      const bi = (billingItems[idx] as Record<string, unknown> | undefined) ?? {}
      const stampedVendorId =
        (activity.vendorId && String(activity.vendorId)) ||
        (it.vendorId && String(it.vendorId)) ||
        (bi.vendorId && String(bi.vendorId)) ||
        null

      let resolvedVendorId: string | null = null
      let unitPrice = 0
      let lineExpected = 0
      let variantLabel = ''
      let variantId = ''
      let gameLabel = ''
      let gameId = ''
      let subGameName = ''
      let subGameId = ''
      let activityIdOut = ''

      if (
        isEventPackageItem(
          it as { itemName?: string; activity?: { name?: string; category?: string; id?: string } },
        )
      ) {
        const campaignId = parseEventActivityId(String(activity.id ?? ''))
        const matched = findEventItem(eventCatalog, itemName, campaignId)
        if (!matched || matched.type !== 'thirdParty' || !matched.vendorId) {
          // Skip company-side event item OR unmatched item — no vendor exposure to compute.
          continue
        }
        resolvedVendorId = matched.vendorId
        unitPrice = matched.price
        lineExpected =
          matched.revenueShare === false ? unitPrice * qty : Math.round(unitPrice * qty * 0.8)
        variantLabel = matched.name
        variantId = matched.itemId
        gameLabel = 'Event'
        gameId = `event:${matched.campaignId}`
        subGameName = `Combo ${matched.packageOrdinal}`
        subGameId = matched.packageId
        activityIdOut = String(activity.id ?? matched.itemId)
      } else {
        // Regular activity item. Ground truth: booking's billingItems[idx]
        // when present (the canonical per-line vendor split written by the
        // ledger writer), falling back to item.activity stamps. If no
        // vendor anywhere, the line is company-revenue → skip.
        if (!stampedVendorId) continue
        resolvedVendorId = stampedVendorId
        // Prefer billingItem.vendorTotal as the expected (it equals what the
        // writer credited at sale-time — i.e., delta should be ~0 except
        // when the writer was buggy or the ledger was hand-edited).
        const biVendorTotal = Number(bi.vendorTotal ?? 0) || 0
        if (biVendorTotal > 0) {
          lineExpected = biVendorTotal
          unitPrice = qty > 0 ? Math.round(biVendorTotal / qty) : 0
        } else {
          const basePrice = Number(activity.basePrice ?? bi.unitPrice ?? it.price ?? 0) || 0
          unitPrice = basePrice
          const revShare = activity.revenueShare === false ? false : true
          lineExpected =
            revShare === false
              ? unitPrice * qty
              : Math.round(unitPrice * qty * (VENDOR_SHARE_DEFAULT / 100))
        }
        variantLabel = String(activity.variantLabel ?? activity.name ?? bi.itemName ?? itemName)
        variantId = String(activity.variantId ?? bi.variantId ?? '')
        gameLabel = String(activity.gameName ?? activity.category ?? bi.gameName ?? '')
        gameId = String(activity.gameId ?? bi.gameId ?? '')
        subGameName = String(activity.subGameName ?? activity.subcategory ?? bi.subGameName ?? '')
        subGameId = String(activity.subGameId ?? bi.subGameId ?? '')
        activityIdOut = String(activity.id ?? activity.apiId ?? bi.activityId ?? '')
      }

      if (VENDOR_FILTER && resolvedVendorId !== VENDOR_FILTER) continue

      expectedByVendor[resolvedVendorId] = (expectedByVendor[resolvedVendorId] || 0) + lineExpected
      lineRowsForBooking.push({
        scope: 'line',
        bookingId: bDoc.id,
        bookingDate,
        bookingStatus,
        bookingSource,
        paymentMethod,
        initiatorRole,
        vendorId: resolvedVendorId,
        vendorName: vendorNames.get(resolvedVendorId) ?? '',
        activityId: activityIdOut,
        gameId,
        gameName: gameLabel,
        subGameId,
        subGameName,
        variantId,
        variantLabel,
        locationId,
        quantity: qty,
        unitPrice,
        lineExpected,
        lineActualShare: 0, // filled in below after rollup is known
        lineDelta: 0, // ditto
        itemNameRaw: itemName,
      })
    }

    // Now compute rollups: gather actual ledger sums for vendors involved (expected ∪ actual)
    const actualByVendor: Record<string, number> = {}
    for (const [k, sum] of actualByBookingVendor.entries()) {
      const [refId, vid] = k.split('::')
      if (refId !== bDoc.id) continue
      if (VENDOR_FILTER && vid !== VENDOR_FILTER) continue
      actualByVendor[vid] = sum
    }

    const allVendors = new Set<string>([
      ...Object.keys(expectedByVendor),
      ...Object.keys(actualByVendor),
    ])

    // Sort: keep deterministic order for CSV (vendorId asc)
    const orderedVendors = [...allVendors].sort()

    for (const vid of orderedVendors) {
      const exp = expectedByVendor[vid] || 0
      const act = actualByVendor[vid] || 0
      const delta = exp - act
      const hasDelta = Math.abs(delta) > TOLERANCE_INR
      if (ONLY_DELTAS && !hasDelta) continue

      // Pro-rata split of vendorActual back to lines so dimensional
      // aggregation (By Game / By Sub-game / By Variant / By Activity)
      // can sum lineActualShare and get back to the same total. Lines for
      // a vendor with expected=0 (rare: ledger has credit but no current
      // expected) still get a synthetic line below; here we only handle
      // the lines we already emitted.
      const linesForVendor = lineRowsForBooking.filter((ln) => ln.vendorId === vid)
      if (linesForVendor.length > 0) {
        const totalLineExpected = linesForVendor.reduce((s, ln) => s + ln.lineExpected, 0)
        if (totalLineExpected > 0 && act > 0) {
          let runningActual = 0
          linesForVendor.forEach((ln, idx) => {
            const isLast = idx === linesForVendor.length - 1
            const share = isLast
              ? act - runningActual // absorb rounding into last line
              : Math.round((act * ln.lineExpected) / totalLineExpected)
            ln.lineActualShare = share
            ln.lineDelta = ln.lineExpected - share
            runningActual += share
          })
        } else if (act > 0 && totalLineExpected === 0) {
          // Vendor was credited but no current line expects them — pin
          // the entire actual onto the first synthetic line so the
          // aggregations don't lose it.
          linesForVendor[0].lineActualShare = act
          linesForVendor[0].lineDelta = -act
        } else {
          for (const ln of linesForVendor) {
            ln.lineActualShare = 0
            ln.lineDelta = ln.lineExpected
          }
        }
      } else if (act > 0) {
        // Vendor has no current lines AT ALL but the ledger credited them
        // (e.g. vendor switched out). Synthesize one line so aggregations
        // can show the orphan credit somewhere.
        rows.push({
          scope: 'line',
          bookingId: bDoc.id,
          bookingDate,
          bookingStatus,
          bookingSource,
          paymentMethod,
          initiatorRole,
          vendorId: vid,
          vendorName: vendorNames.get(vid) ?? '',
          activityId: '',
          gameId: '',
          gameName: '(orphan)',
          subGameId: '',
          subGameName: '',
          variantId: '',
          variantLabel: '(no current item — possibly switched-out vendor)',
          locationId,
          quantity: 0,
          unitPrice: 0,
          lineExpected: 0,
          lineActualShare: act,
          lineDelta: -act,
          itemNameRaw: '',
        })
      }

      // Emit per-line rows for this vendor (in the order they appeared)
      for (const ln of lineRowsForBooking) {
        if (ln.vendorId !== vid) continue
        rows.push(ln)
      }
      // Emit rollup row
      rows.push({
        scope: 'rollup',
        bookingId: bDoc.id,
        bookingDate,
        bookingStatus,
        bookingSource,
        paymentMethod,
        initiatorRole,
        vendorId: vid,
        vendorName: vendorNames.get(vid) ?? '',
        locationId,
        vendorExpected: exp,
        vendorActual: act,
        vendorDelta: delta,
      })
    }
  }

  return {
    rows,
    bookingsScanned: bookingsSnap.size,
    bookingsInWindow: inWindowCount,
    bookingsConsidered: considered,
    bugFindings,
  }
}

const writeCsv = (filePath: string, rows: AnyRow[]): void => {
  const header =
    'Count,bookingId,bookingDate,bookingStatus,scope,vendorId,vendorName,activityId,gameId,Game,subGameId,SubGame,variantId,Variant,Location,quantity,unitPrice,lineExpected,lineActual,lineDelta,vendorExpected,vendorActual,vendorDelta\n'
  const lines: string[] = []
  rows.forEach((r, i) => {
    const count = i + 1
    if (r.scope === 'line') {
      lines.push(
        [
          count,
          r.bookingId,
          csvEscape(r.bookingDate),
          csvEscape(r.bookingStatus),
          'line',
          r.vendorId,
          csvEscape(r.vendorName),
          csvEscape(r.activityId),
          csvEscape(r.gameId),
          csvEscape(r.gameName),
          csvEscape(r.subGameId),
          csvEscape(r.subGameName),
          csvEscape(r.variantId),
          csvEscape(r.variantLabel),
          csvEscape(r.locationId),
          r.quantity,
          r.unitPrice,
          r.lineExpected,
          r.lineActualShare,
          r.lineDelta,
          '',
          '',
          '',
        ].join(','),
      )
    } else {
      lines.push(
        [
          count,
          r.bookingId,
          csvEscape(r.bookingDate),
          csvEscape(r.bookingStatus),
          'rollup',
          r.vendorId,
          csvEscape(r.vendorName),
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          csvEscape(r.locationId),
          '',
          '',
          '',
          '',
          '',
          r.vendorExpected,
          r.vendorActual,
          r.vendorDelta,
        ].join(','),
      )
    }
  })
  fs.writeFileSync(filePath, header + lines.join('\n') + '\n')
  console.log(`CSV written: ${filePath}`)
}

// ── Aggregation helper for pivot sheets ─────────────────────────────────
interface PivotKey {
  id: string
  label: string
  vendorId?: string
  vendorName?: string
  game?: string
  subGame?: string
  variant?: string
  paymentMethod?: string
}
interface PivotBucket extends PivotKey {
  bookings: Set<string>
  expected: number
  actual: number
}
const aggregatePivot = (rows: AnyRow[], keyFn: (r: LineRow) => PivotKey | null): PivotBucket[] => {
  const buckets = new Map<string, PivotBucket>()
  for (const r of rows) {
    if (r.scope !== 'line') continue
    const k = keyFn(r)
    if (!k) continue
    const composite = `${k.vendorId || ''}::${k.id}`
    if (!buckets.has(composite)) {
      buckets.set(composite, { ...k, bookings: new Set<string>(), expected: 0, actual: 0 })
    }
    const b = buckets.get(composite)!
    b.bookings.add(r.bookingId)
    b.expected += r.lineExpected
    b.actual += r.lineActualShare
  }
  return [...buckets.values()].sort((a, b) => {
    const da = Math.abs(a.expected - a.actual)
    const db = Math.abs(b.expected - b.actual)
    return db - da
  })
}

// ── Excel writer with conditional colors + autofilter + pivot sheets ────
const HEADER_FILL = 'FF1F4E78'
const HEADER_FONT_COLOR = 'FFFFFFFF'
const LINE_ROW_FILL = 'FFEAF3FB'
const ROLLUP_ROW_FILL = 'FFFFF9E1'
const POSITIVE_FILL = 'FFB7E1B7'
const POSITIVE_FONT = 'FF1B5E20'
const NEGATIVE_FILL = 'FFF2A0A0'
const NEGATIVE_FONT = 'FF8B0000'
const STATUS_FILL_GREEN = 'FFD6F0D6'
const STATUS_FILL_RED = 'FFF5C6CB'
const STATUS_FILL_AMBER = 'FFFFE3B0'
const STATUS_FILL_GREY = 'FFE0E0E0'

const styleHeaderRow = (row: ExcelJS.Row): void => {
  row.font = { bold: true, color: { argb: HEADER_FONT_COLOR } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  row.alignment = { vertical: 'middle', horizontal: 'center' }
  row.height = 22
}

const formatCurrency = (cell: ExcelJS.Cell): void => {
  if (cell.value != null) cell.numFmt = '"₹"#,##0;[Red]-"₹"#,##0'
}

const colorDelta = (cell: ExcelJS.Cell): void => {
  if (typeof cell.value === 'number' && Math.abs(cell.value) > TOLERANCE_INR) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: cell.value > 0 ? POSITIVE_FILL : NEGATIVE_FILL },
    }
    cell.font = { bold: true, color: { argb: cell.value > 0 ? POSITIVE_FONT : NEGATIVE_FONT } }
  }
}

const statusFillFor = (status: string): string => {
  const s = status.toLowerCase()
  if (s === 'confirmed' || s === 'completed') return STATUS_FILL_GREEN
  if (s === 'cancelled') return STATUS_FILL_RED
  if (s === 'pending' || s === 'rescheduled') return STATUS_FILL_AMBER
  return STATUS_FILL_GREY
}

const writeXlsx = async (
  filePath: string,
  rows: AnyRow[],
  vendorTotals: Array<{
    vendorId: string
    name: string
    expected: number
    actual: number
    delta: number
    bookings: number
  }>,
  bugFindings: BugFinding[] = [],
): Promise<void> => {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'A Square reconciliation audit'
  wb.created = new Date()

  // ── Sheet 1: full per-line + rollup detail ──
  const ws = wb.addWorksheet('Vendor Audit', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  })
  ws.columns = [
    { header: 'Count', key: 'count', width: 7 },
    { header: 'bookingId', key: 'bookingId', width: 26 },
    { header: 'bookingDate', key: 'bookingDate', width: 12 },
    { header: 'bookingStatus', key: 'bookingStatus', width: 13 },
    { header: 'scope', key: 'scope', width: 9 },
    { header: 'vendorId', key: 'vendorId', width: 13 },
    { header: 'vendorName', key: 'vendorName', width: 28 },
    { header: 'activityId', key: 'activityId', width: 30 },
    { header: 'gameId', key: 'gameId', width: 16 },
    { header: 'Game', key: 'game', width: 18 },
    { header: 'subGameId', key: 'subGameId', width: 16 },
    { header: 'SubGame', key: 'subGame', width: 18 },
    { header: 'variantId', key: 'variantId', width: 16 },
    { header: 'Variant', key: 'variant', width: 32 },
    { header: 'Location', key: 'location', width: 14 },
    { header: 'quantity', key: 'quantity', width: 9 },
    { header: 'unitPrice', key: 'unitPrice', width: 11 },
    { header: 'lineExpected', key: 'lineExpected', width: 13 },
    { header: 'lineActual', key: 'lineActual', width: 13 },
    { header: 'lineDelta', key: 'lineDelta', width: 13 },
    { header: 'vendorExpected', key: 'vendorExpected', width: 15 },
    { header: 'vendorActual', key: 'vendorActual', width: 13 },
    { header: 'vendorDelta', key: 'vendorDelta', width: 13 },
  ]
  styleHeaderRow(ws.getRow(1))

  rows.forEach((r, i) => {
    const count = i + 1
    const row =
      r.scope === 'line'
        ? ws.addRow({
            count,
            bookingId: r.bookingId,
            bookingDate: r.bookingDate,
            bookingStatus: r.bookingStatus,
            scope: 'line',
            vendorId: r.vendorId,
            vendorName: r.vendorName,
            activityId: r.activityId,
            gameId: r.gameId,
            game: r.gameName,
            subGameId: r.subGameId,
            subGame: r.subGameName,
            variantId: r.variantId,
            variant: r.variantLabel,
            location: r.locationId,
            quantity: r.quantity || null,
            unitPrice: r.unitPrice || null,
            lineExpected: r.lineExpected || null,
            lineActual: r.lineActualShare || null,
            lineDelta: r.lineDelta,
            vendorExpected: null,
            vendorActual: null,
            vendorDelta: null,
          })
        : ws.addRow({
            count,
            bookingId: r.bookingId,
            bookingDate: r.bookingDate,
            bookingStatus: r.bookingStatus,
            scope: 'rollup',
            vendorId: r.vendorId,
            vendorName: r.vendorName,
            activityId: '',
            gameId: '',
            game: '',
            subGameId: '',
            subGame: '',
            variantId: '',
            variant: '',
            location: r.locationId,
            quantity: null,
            unitPrice: null,
            lineExpected: null,
            lineActual: null,
            lineDelta: null,
            vendorExpected: r.vendorExpected,
            vendorActual: r.vendorActual,
            vendorDelta: r.vendorDelta,
          })

    const baseFill = r.scope === 'line' ? LINE_ROW_FILL : ROLLUP_ROW_FILL
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseFill } }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E5E5' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E5E5' } },
      }
    })
    if (r.scope === 'rollup') row.font = { bold: true }

    const statusCell = row.getCell('bookingStatus')
    statusCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: statusFillFor(r.bookingStatus) },
    }
    statusCell.alignment = { horizontal: 'center' }

    for (const col of [
      'unitPrice',
      'lineExpected',
      'lineActual',
      'lineDelta',
      'vendorExpected',
      'vendorActual',
      'vendorDelta',
    ]) {
      formatCurrency(row.getCell(col))
    }
    if (r.scope === 'line') colorDelta(row.getCell('lineDelta'))
    if (r.scope === 'rollup') colorDelta(row.getCell('vendorDelta'))
  })

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: ws.rowCount, column: ws.columnCount },
  }

  // ── Sheet 2: vendor summary (already had this) ──
  const sum = wb.addWorksheet('Vendor Summary', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  })
  sum.columns = [
    { header: 'vendorId', key: 'vendorId', width: 14 },
    { header: 'vendorName', key: 'vendorName', width: 30 },
    { header: 'bookings', key: 'bookings', width: 10 },
    { header: 'expected', key: 'expected', width: 14 },
    { header: 'actual', key: 'actual', width: 14 },
    { header: 'delta', key: 'delta', width: 14 },
    { header: 'direction', key: 'direction', width: 18 },
  ]
  styleHeaderRow(sum.getRow(1))
  for (const v of vendorTotals) {
    const direction =
      v.delta > TOLERANCE_INR
        ? 'CREDIT (owed)'
        : v.delta < -TOLERANCE_INR
          ? 'DEBIT (claw)'
          : 'clean'
    const row = sum.addRow({
      vendorId: v.vendorId,
      vendorName: v.name,
      bookings: v.bookings,
      expected: v.expected,
      actual: v.actual,
      delta: v.delta,
      direction,
    })
    for (const col of ['expected', 'actual', 'delta']) formatCurrency(row.getCell(col))
    colorDelta(row.getCell('delta'))
    if (direction === 'CREDIT (owed)') {
      row.getCell('direction').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: STATUS_FILL_GREEN },
      }
    } else if (direction === 'DEBIT (claw)') {
      row.getCell('direction').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: STATUS_FILL_RED },
      }
    }
  }
  sum.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: sum.rowCount, column: sum.columnCount },
  }

  // ── Pivot sheets: By Game / By Sub-game / By Variant / By Activity ──
  const writePivotSheet = (
    sheetName: string,
    keyHeader: string,
    keyFn: (r: LineRow) => PivotKey | null,
    extraCols: Array<{
      header: string
      key: string
      width: number
      from: (b: PivotBucket) => unknown
    }> = [],
  ) => {
    const buckets = aggregatePivot(rows, keyFn)
    const sheet = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] })
    sheet.columns = [
      { header: keyHeader, key: 'label', width: 32 },
      { header: 'vendorId', key: 'vendorId', width: 14 },
      { header: 'vendorName', key: 'vendorName', width: 26 },
      ...extraCols.map((c) => ({ header: c.header, key: c.key, width: c.width })),
      { header: 'bookings', key: 'bookings', width: 10 },
      { header: 'expected', key: 'expected', width: 14 },
      { header: 'actual', key: 'actual', width: 14 },
      { header: 'delta', key: 'delta', width: 14 },
    ]
    styleHeaderRow(sheet.getRow(1))
    for (const b of buckets) {
      const delta = b.expected - b.actual
      const row = sheet.addRow({
        label: b.label,
        vendorId: b.vendorId ?? '',
        vendorName: b.vendorName ?? '',
        ...Object.fromEntries(extraCols.map((c) => [c.key, c.from(b)])),
        bookings: b.bookings.size,
        expected: Math.round(b.expected),
        actual: Math.round(b.actual),
        delta: Math.round(delta),
      })
      for (const col of ['expected', 'actual', 'delta']) formatCurrency(row.getCell(col))
      colorDelta(row.getCell('delta'))
    }
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: sheet.columnCount },
    }
  }

  writePivotSheet('By Game', 'Game', (r) =>
    r.gameName
      ? {
          id: `${r.vendorId}::${r.gameId || r.gameName}`,
          label: r.gameName,
          vendorId: r.vendorId,
          vendorName: r.vendorName,
        }
      : null,
  )
  writePivotSheet(
    'By Sub-game',
    'Sub-game',
    (r) =>
      r.subGameName || r.gameName
        ? {
            id: `${r.vendorId}::${r.gameId}::${r.subGameId || r.subGameName}`,
            label: r.subGameName || '(no sub-game)',
            vendorId: r.vendorId,
            vendorName: r.vendorName,
            game: r.gameName,
          }
        : null,
    [{ header: 'Game', key: 'game', width: 18, from: (b) => b.game ?? '' }],
  )
  writePivotSheet(
    'By Variant',
    'Variant',
    (r) =>
      r.variantLabel
        ? {
            id: `${r.vendorId}::${r.variantId || r.variantLabel}`,
            label: r.variantLabel,
            vendorId: r.vendorId,
            vendorName: r.vendorName,
            game: r.gameName,
            subGame: r.subGameName,
          }
        : null,
    [
      { header: 'Game', key: 'game', width: 18, from: (b) => b.game ?? '' },
      { header: 'Sub-game', key: 'subGame', width: 18, from: (b) => b.subGame ?? '' },
    ],
  )
  writePivotSheet(
    'By Activity',
    'activityId',
    (r) =>
      r.activityId
        ? {
            id: `${r.vendorId}::${r.activityId}`,
            label: r.activityId,
            vendorId: r.vendorId,
            vendorName: r.vendorName,
            game: r.gameName,
            subGame: r.subGameName,
            variant: r.variantLabel,
          }
        : null,
    [
      { header: 'Game', key: 'game', width: 18, from: (b) => b.game ?? '' },
      { header: 'Sub-game', key: 'subGame', width: 18, from: (b) => b.subGame ?? '' },
      { header: 'Variant', key: 'variant', width: 28, from: (b) => b.variant ?? '' },
    ],
  )

  // ── By Source pivot — vendor-share breakdown grouped by booking source ──
  // Surfaces drift unique to a single channel (e.g., online customer-app
  // bookings whose completeBillingOnPayment never fired vs POS where the
  // split happens inline at sale).
  writePivotSheet(
    'By Source',
    'Source',
    (r) =>
      r.bookingSource
        ? {
            id: `${r.vendorId}::${r.bookingSource}::${r.paymentMethod}`,
            label: r.bookingSource,
            vendorId: r.vendorId,
            vendorName: r.vendorName,
            paymentMethod: r.paymentMethod,
          }
        : null,
    [
      {
        header: 'PaymentMethod',
        key: 'paymentMethod',
        width: 14,
        from: (b) => b.paymentMethod ?? '',
      },
    ],
  )

  // ── Bug Hunt sheet — flagged bookings by failure category ──
  if (bugFindings.length > 0) {
    const bug = wb.addWorksheet('Bug Hunt', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    })
    bug.columns = [
      { header: 'Category', key: 'category', width: 28 },
      { header: 'bookingId', key: 'bookingId', width: 26 },
      { header: 'bookingDate', key: 'bookingDate', width: 12 },
      { header: 'Source', key: 'bookingSource', width: 16 },
      { header: 'paymentStatus', key: 'paymentStatus', width: 14 },
      { header: 'bookingStatus', key: 'bookingStatus', width: 14 },
      { header: 'finalAmount', key: 'finalAmount', width: 12 },
      { header: 'Detail', key: 'detail', width: 80 },
    ]
    styleHeaderRow(bug.getRow(1))

    const categoryColor: Record<BugFinding['category'], string> = {
      paid_no_billing_items: NEGATIVE_FILL,
      paid_no_ledger_entries: NEGATIVE_FILL,
      ledger_mismatch_billing: 'FFFFE3B0', // amber
      corrupt_createdAt: 'FFE0E0E0', // grey — known cosmetic drift
      pending_with_ledger_entries: NEGATIVE_FILL,
    }

    const sortedBugs = [...bugFindings].sort(
      (a, b) =>
        a.category.localeCompare(b.category) || Math.abs(b.finalAmount) - Math.abs(a.finalAmount),
    )
    for (const f of sortedBugs) {
      const row = bug.addRow({
        category: f.category,
        bookingId: f.bookingId,
        bookingDate: f.bookingDate,
        bookingSource: f.bookingSource,
        paymentStatus: f.paymentStatus,
        bookingStatus: f.bookingStatus,
        finalAmount: f.finalAmount,
        detail: f.detail,
      })
      formatCurrency(row.getCell('finalAmount'))
      row.getCell('category').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: categoryColor[f.category] },
      }
      row.getCell('category').font = { bold: true }
    }
    bug.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: bug.rowCount, column: bug.columnCount },
    }
  }

  try {
    await wb.xlsx.writeFile(filePath)
    console.log(`XLSX written: ${filePath}`)
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code === 'EBUSY' || code === 'EPERM') {
      const ext = path.extname(filePath) || '.xlsx'
      const base = filePath.slice(0, filePath.length - ext.length)
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
      const fallback = `${base}-${stamp}${ext}`
      console.warn(`File ${filePath} is locked (open in Excel?). Writing to ${fallback} instead.`)
      await wb.xlsx.writeFile(fallback)
      console.log(`XLSX written: ${fallback}`)
    } else {
      throw err
    }
  }
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE)
  const { rows, bookingsScanned, bookingsInWindow, bookingsConsidered, bugFindings } =
    await audit(db)

  console.log(`\n── Audit summary ──`)
  console.log(`Window: ${FROM} → ${TO} (IST)`)
  console.log(`Bookings scanned: ${bookingsScanned}`)
  console.log(`Bookings in window: ${bookingsInWindow}`)
  console.log(`Bookings considered (paymentStatus=completed): ${bookingsConsidered}`)
  if (VENDOR_FILTER) console.log(`Vendor filter: ${VENDOR_FILTER}`)
  if (ONLY_DELTAS) console.log(`Only-deltas mode: yes`)
  console.log(`Total CSV rows: ${rows.length}`)
  console.log(`\n── Bug findings: ${bugFindings.length} ──`)
  const byCategory: Record<string, number> = {}
  for (const f of bugFindings) byCategory[f.category] = (byCategory[f.category] || 0) + 1
  for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(28)} ${n}`)
  }
  // Per-source booking counts (drives the By Source sheet)
  const sourceCounts: Record<string, { paid: number; pending: number; cancelled: number }> = {}
  for (const r of rows) {
    if (r.scope !== 'rollup') continue
    sourceCounts[r.bookingSource] ||= { paid: 0, pending: 0, cancelled: 0 }
    // Bookings are surfaced once per (booking, vendor) here. Dedupe by Set.
  }

  // Per-vendor totals
  const vendorTotals: Record<
    string,
    { name: string; expected: number; actual: number; delta: number; bookings: Set<string> }
  > = {}
  for (const r of rows) {
    if (r.scope !== 'rollup') continue
    vendorTotals[r.vendorId] ||= {
      name: r.vendorName,
      expected: 0,
      actual: 0,
      delta: 0,
      bookings: new Set<string>(),
    }
    vendorTotals[r.vendorId].expected += r.vendorExpected
    vendorTotals[r.vendorId].actual += r.vendorActual
    vendorTotals[r.vendorId].delta += r.vendorDelta
    vendorTotals[r.vendorId].bookings.add(r.bookingId)
  }
  const sorted = Object.entries(vendorTotals).sort(
    (a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta),
  )
  if (sorted.length > 0) {
    console.log(`\n── Per-vendor totals (within window) ──`)
    const nameW = Math.min(28, Math.max(11, ...sorted.map(([, v]) => (v.name || '?').length)))
    console.log(
      `${'vendorId'.padEnd(13)} | ${'vendorName'.padEnd(nameW)} | bookings | ${' expected'.padStart(9)} | ${'  actual'.padStart(9)} | ${'   delta'.padStart(9)}`,
    )
    console.log(
      `${'-'.repeat(13)}-|-${'-'.repeat(nameW)}-|----------|-${'-'.repeat(9)}-|-${'-'.repeat(9)}-|-${'-'.repeat(9)}`,
    )
    for (const [vid, v] of sorted) {
      const nm = (v.name || '?').slice(0, nameW)
      console.log(
        `${vid.padEnd(13)} | ${nm.padEnd(nameW)} | ${String(v.bookings.size).padStart(8)} | ${String(v.expected).padStart(9)} | ${String(v.actual).padStart(9)} | ${String(v.delta).padStart(9)}`,
      )
    }
    const totalExpected = sorted.reduce((s, [, v]) => s + v.expected, 0)
    const totalActual = sorted.reduce((s, [, v]) => s + v.actual, 0)
    console.log(
      `${'-'.repeat(13)}-|-${'-'.repeat(nameW)}-|----------|-${'-'.repeat(9)}-|-${'-'.repeat(9)}-|-${'-'.repeat(9)}`,
    )
    console.log(
      `${'TOTAL'.padEnd(13)} | ${''.padEnd(nameW)} |          | ${String(totalExpected).padStart(9)} | ${String(totalActual).padStart(9)} | ${String(totalExpected - totalActual).padStart(9)}`,
    )
  }

  if (CSV_PATH) writeCsv(path.resolve(CSV_PATH), rows)

  const fullVendorTotals = sorted.map(([vid, v]) => ({
    vendorId: vid,
    name: v.name,
    expected: v.expected,
    actual: v.actual,
    delta: v.delta,
    bookings: v.bookings.size,
  }))

  if (XLSX_PATH && !SKIP_COMBINED) {
    await writeXlsx(path.resolve(XLSX_PATH), rows, fullVendorTotals, bugFindings)
  }

  if (PER_VENDOR_DIR) {
    const outDir = path.resolve(PER_VENDOR_DIR)
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
    console.log(`\nWriting per-vendor workbooks to ${outDir} …`)

    const slugify = (s: string): string =>
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'unnamed'

    // Group rows by vendor for per-file writes
    const rowsByVendor = new Map<string, AnyRow[]>()
    for (const r of rows) {
      const vid = r.vendorId
      if (!vid) continue
      if (!rowsByVendor.has(vid)) rowsByVendor.set(vid, [])
      rowsByVendor.get(vid)!.push(r)
    }

    const indexLines: string[] = [
      `Per-vendor reconciliation audit`,
      `Window: ${FROM} → ${TO} (IST)`,
      `Generated: ${new Date().toISOString()}`,
      ``,
      `vendorId      | vendorName                       | bookings | ${' expected'.padStart(9)} | ${'  actual'.padStart(9)} | ${'   delta'.padStart(9)} | direction     | file`,
      `--------------|----------------------------------|----------|-${'-'.repeat(9)}-|-${'-'.repeat(9)}-|-${'-'.repeat(9)}-|---------------|-----`,
    ]

    for (const v of fullVendorTotals) {
      const vRows = rowsByVendor.get(v.vendorId) ?? []
      if (vRows.length === 0) continue
      const slug = slugify(v.name || v.vendorId)
      const fileName = `vendor-audit-${v.vendorId}-${slug}.xlsx`
      const filePath = path.join(outDir, fileName)
      const direction =
        v.delta > TOLERANCE_INR
          ? 'CREDIT (owed)'
          : v.delta < -TOLERANCE_INR
            ? 'DEBIT (claw)'
            : 'clean'
      // Each vendor's workbook has its own (single-row) Vendor Summary sheet
      // so the aggregations on the dimensional sheets stay coherent.
      await writeXlsx(filePath, vRows, [v])
      const namePadded = (v.name || '?').padEnd(32).slice(0, 32)
      indexLines.push(
        `${v.vendorId.padEnd(13)} | ${namePadded} | ${String(v.bookings).padStart(8)} | ${String(v.expected).padStart(9)} | ${String(v.actual).padStart(9)} | ${String(v.delta).padStart(9)} | ${direction.padEnd(13)} | ${fileName}`,
      )
    }

    indexLines.push(``)
    indexLines.push(`Total vendor workbooks: ${rowsByVendor.size}`)
    fs.writeFileSync(path.join(outDir, 'INDEX.txt'), indexLines.join('\n') + '\n')
    console.log(`Wrote ${rowsByVendor.size} per-vendor workbooks + INDEX.txt to ${outDir}/`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
