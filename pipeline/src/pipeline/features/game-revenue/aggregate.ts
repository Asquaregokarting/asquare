/**
 * Pure aggregation helpers for the Game-wise Revenue report.
 *
 * Inputs are already-parsed `TransactionRecord`s loaded from the `bookings`
 * collection (a.k.a. `billingTransactions` — the same Firestore collection,
 * historical alias). The aggregator never touches Firestore directly so it
 * can be unit-tested in pure isolation.
 *
 * Eligibility rules (locked from the spec):
 *
 *   • `paymentStatus === 'completed'`
 *   • NOT cancelled (`cancelled !== true`)
 *   • NOT fully refunded (`refundStatus !== 'Full'`)
 *   • Within the supplied `[fromDate, toDate]` IST date range, inclusive
 *
 * Per-item revenue is computed in this order of preference:
 *
 *   1. `item.itemBaseAmount + item.itemGstAmount` (already discount-applied)
 *   2. Proportional split of the booking's `finalAmount` (or `totalAmount`
 *      when `finalAmount` is missing) using `unitPrice × quantity` weights
 *   3. Fallback to `unitPrice × quantity` (worst case for very old docs)
 *
 * Refunded items (`item.refunded === true`) are skipped — the rest of the
 * booking still contributes its non-refunded items.
 *
 * The booking source is bucketed for the POS-vs-online split:
 *
 *   POS                                       → 'pos'        (branch checkout)
 *   APP_BOOKING                               → 'app'        (customer app)
 *   Booking (legacy/website)                  → 'website'    (web checkout)
 *   ADMIN_BOOKING + createdByRole=Telecaller  → 'telecaller'
 *   ADMIN_BOOKING (any other staff)           → 'admin'
 *   anything else / missing                   → 'other'
 */
import type { TransactionRecord } from '../../api/types'
import { normalizeLocationId } from '../../../lib/locations'

/** branchId bucket key for transactions whose `locationId` can't be resolved. */
export const UNKNOWN_BRANCH_ID = 'unknown'

export type SourceBucket = 'pos' | 'app' | 'website' | 'admin' | 'telecaller' | 'other'

export const SOURCE_BUCKETS: SourceBucket[] = [
  'pos',
  'app',
  'website',
  'admin',
  'telecaller',
  'other',
]

export const SOURCE_BUCKET_LABELS: Record<SourceBucket, string> = {
  pos: 'Branch (POS)',
  app: 'Customer App',
  website: 'Website',
  admin: 'Admin Link',
  telecaller: 'Telecaller',
  other: 'Other',
}

export interface RevenueBucket {
  revenue: number
  quantity: number
  txnCount: number
  bySource: Record<SourceBucket, number>
  /**
   * Per-branch revenue split. Keys are canonical branchIds (normalized via
   * `normalizeLocationId`). Transactions whose locationId can't be resolved
   * land under `UNKNOWN_BRANCH_ID` so the sum of the branch split always
   * equals `revenue` — no silent drop.
   */
  byBranch: Record<string, number>
}

export interface VariantRow {
  variantId: string
  variantName: string
  totals: RevenueBucket
}

export interface SubGameRow {
  subGameId: string
  subGameName: string
  variants: VariantRow[]
  totals: RevenueBucket
}

export interface GameRow {
  gameId: string
  gameName: string
  subgames: SubGameRow[]
  totals: RevenueBucket
}

export interface AggregationResult {
  /** Game-level rows, sorted by revenue desc. */
  games: GameRow[]
  /** Grand totals across every counted item. */
  totals: RevenueBucket
  /** Number of bookings that contributed at least one counted item. */
  contributingTransactions: number
  /** Number of bookings that were skipped due to eligibility filters. */
  skippedTransactions: number
  /**
   * All branchIds that contributed revenue, sorted by descending revenue.
   * Lets the UI render branch tabs/cards without re-computing the order.
   */
  branchIds: string[]
}

export interface CatalogLookupEntry {
  gameId?: string
  gameName?: string
  subGameId?: string
  subGameName?: string
  variantId?: string
  variantLabel?: string
}

export type CatalogLookup = Map<string, CatalogLookupEntry>

export interface AggregateOptions {
  /** Inclusive IST date `YYYY-MM-DD` lower bound. */
  fromDate: string
  /** Inclusive IST date `YYYY-MM-DD` upper bound. */
  toDate: string
  /**
   * Function that turns a raw transaction date string into the IST calendar
   * date `YYYY-MM-DD`. Injected so the aggregator stays pure (no `Date`
   * timezone surprises in tests).
   */
  toIstDate: (iso: string) => string
  /**
   * Optional vendor scope. When supplied, only items whose `vendorId`
   * matches are counted (mirrors the legacy ThirdParty-only view).
   */
  vendorId?: string
  /**
   * Optional catalog lookup keyed by `${gameId}::${subGameId}::${variantId}`.
   * Used to upgrade the bare item IDs to display labels.
   */
  catalog?: CatalogLookup
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const emptyBySource = (): Record<SourceBucket, number> => ({
  pos: 0,
  app: 0,
  website: 0,
  admin: 0,
  telecaller: 0,
  other: 0,
})

const emptyBucket = (): RevenueBucket => ({
  revenue: 0,
  quantity: 0,
  txnCount: 0,
  bySource: emptyBySource(),
  byBranch: {},
})

const safeNumber = (value: unknown): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Map a booking's `source` (and createdByRole for ADMIN_BOOKING) to a bucket. */
export const bucketSource = (
  source: string | undefined | null,
  createdByRole?: string | undefined | null,
): SourceBucket => {
  const s = String(source ?? '').toUpperCase()
  if (s === 'POS') return 'pos'
  if (s === 'APP_BOOKING' || s === 'APP') return 'app'
  if (s === 'BOOKING' || s === 'WEBSITE' || s === 'WEB') return 'website'
  if (s === 'ADMIN_BOOKING' || s === 'ADMIN') {
    const role = String(createdByRole ?? '').toLowerCase()
    if (role === 'telecaller') return 'telecaller'
    return 'admin'
  }
  return 'other'
}

/** Returns true if the booking is revenue-eligible per the spec. */
export const isEligibleTransaction = (txn: TransactionRecord): boolean => {
  if (txn.paymentStatus !== 'completed') return false
  if (txn.cancelled === true) return false
  if (txn.refundStatus === 'Full') return false
  return true
}

/**
 * Sum the per-item revenue for one booking using the preference order
 * documented at the top of the file. Returns the array of computed item
 * revenues in the same order as the input items, with refunded items set
 * to 0 so the indices line up.
 */
export const computeItemRevenues = (txn: TransactionRecord): number[] => {
  const items = txn.items ?? []
  if (items.length === 0) return []

  // Pass 1: try the canonical itemBaseAmount + itemGstAmount route.
  // If at least one item carries item-level fields, trust them for the
  // entire booking — POS bookings have these for every item, App bookings
  // historically didn't. Avoid mixing the two routes within one booking.
  const hasItemLevelBreakdown = items.some(
    (i) => i.itemBaseAmount != null || i.itemGstAmount != null,
  )

  if (hasItemLevelBreakdown) {
    return items.map((i) => {
      if (i.refunded === true) return 0
      return safeNumber(i.itemBaseAmount) + safeNumber(i.itemGstAmount)
    })
  }

  // Pass 2: proportional split of the booking's final amount.
  const finalAmount = safeNumber(txn.totalAmount) // post-discount, GST inclusive
  const lineSubtotals = items.map((i) => safeNumber(i.unitPrice) * safeNumber(i.quantity))
  const subtotalSum = lineSubtotals.reduce((a, b) => a + b, 0)

  if (finalAmount > 0 && subtotalSum > 0) {
    return items.map((i, idx) => {
      if (i.refunded === true) return 0
      return (lineSubtotals[idx] / subtotalSum) * finalAmount
    })
  }

  // Pass 3: worst case — just use the line subtotals directly.
  return items.map((i, idx) => (i.refunded === true ? 0 : lineSubtotals[idx]))
}

interface MutableVariant extends VariantRow {
  variants?: never
}

interface MutableSubGame extends SubGameRow {
  variantsMap: Map<string, MutableVariant>
}

interface MutableGame extends GameRow {
  subgamesMap: Map<string, MutableSubGame>
}

const ensureGame = (
  map: Map<string, MutableGame>,
  gameId: string,
  gameName: string,
): MutableGame => {
  let row = map.get(gameId)
  if (!row) {
    row = {
      gameId,
      gameName,
      subgames: [],
      subgamesMap: new Map(),
      totals: emptyBucket(),
    }
    map.set(gameId, row)
  } else if (gameName && row.gameName === gameId) {
    // Upgrade the placeholder name once we see a real label.
    row.gameName = gameName
  }
  return row
}

const ensureSubGame = (
  game: MutableGame,
  subGameId: string,
  subGameName: string,
): MutableSubGame => {
  let row = game.subgamesMap.get(subGameId)
  if (!row) {
    row = {
      subGameId,
      subGameName,
      variants: [],
      variantsMap: new Map(),
      totals: emptyBucket(),
    }
    game.subgamesMap.set(subGameId, row)
  } else if (subGameName && row.subGameName === subGameId) {
    row.subGameName = subGameName
  }
  return row
}

const ensureVariant = (
  subGame: MutableSubGame,
  variantId: string,
  variantName: string,
): MutableVariant => {
  let row = subGame.variantsMap.get(variantId)
  if (!row) {
    row = {
      variantId,
      variantName,
      totals: emptyBucket(),
    }
    subGame.variantsMap.set(variantId, row)
  } else if (variantName && row.variantName === variantId) {
    row.variantName = variantName
  }
  return row
}

const addRevenue = (
  bucket: RevenueBucket,
  source: SourceBucket,
  branchId: string,
  revenue: number,
  qty: number,
) => {
  bucket.revenue += revenue
  bucket.quantity += qty
  bucket.bySource[source] += revenue
  bucket.byBranch[branchId] = (bucket.byBranch[branchId] ?? 0) + revenue
}

// ─── Main entry point ──────────────────────────────────────────────────────

export const aggregateGameRevenue = (
  transactions: TransactionRecord[],
  options: AggregateOptions,
): AggregationResult => {
  const { fromDate, toDate, toIstDate, vendorId, catalog } = options

  const games = new Map<string, MutableGame>()
  const totals = emptyBucket()
  let contributingTransactions = 0
  let skippedTransactions = 0

  for (const txn of transactions) {
    if (!isEligibleTransaction(txn)) {
      skippedTransactions++
      continue
    }

    // IST-correct date filter — never trust raw `slice(0, 10)` on a UTC ISO.
    const istDate = txn.transactionDate ? toIstDate(txn.transactionDate) : ''
    if (!istDate || istDate < fromDate || istDate > toDate) {
      skippedTransactions++
      continue
    }

    const itemRevenues = computeItemRevenues(txn)
    const items = txn.items ?? []
    if (items.length === 0) {
      skippedTransactions++
      continue
    }

    const source = bucketSource(txn.source, txn.createdByRole)
    const rawLocation = String(txn.locationId ?? '').trim()
    const branchId = rawLocation ? normalizeLocationId(rawLocation) : UNKNOWN_BRANCH_ID
    let txnContributed = false

    items.forEach((item, idx) => {
      if (item.refunded === true) return

      // Vendor-scope filter — used by the legacy ThirdParty view.
      if (vendorId && item.vendorId !== vendorId) return

      const revenue = itemRevenues[idx] ?? 0
      const quantity = safeNumber(item.quantity) || 1
      if (revenue <= 0) return

      const rawGameId = item.gameId || 'unknown'
      const rawSubGameId = item.subGameId || 'unknown'
      const rawVariantId = item.variantId || item.itemName || 'unknown'

      const lookup = catalog?.get(`${rawGameId}::${rawSubGameId}::${rawVariantId}`)
      const gameName = lookup?.gameName?.trim() || rawGameId
      const subGameName = lookup?.subGameName?.trim() || rawSubGameId
      const variantName = lookup?.variantLabel?.trim() || item.itemName?.trim() || rawVariantId

      const game = ensureGame(games, rawGameId, gameName)
      const subGame = ensureSubGame(game, rawSubGameId, subGameName)
      const variant = ensureVariant(subGame, rawVariantId, variantName)

      addRevenue(variant.totals, source, branchId, revenue, quantity)
      addRevenue(subGame.totals, source, branchId, revenue, quantity)
      addRevenue(game.totals, source, branchId, revenue, quantity)
      addRevenue(totals, source, branchId, revenue, quantity)
      txnContributed = true
    })

    if (txnContributed) {
      contributingTransactions++
      // Bump the txnCount on every level the booking touched. We do this
      // after the items loop so each level is incremented at most once
      // per booking.
      const touchedGames = new Set<string>()
      const touchedSubGames = new Set<string>()
      const touchedVariants = new Set<string>()
      items.forEach((item, idx) => {
        if (item.refunded === true) return
        if (vendorId && item.vendorId !== vendorId) return
        const revenue = itemRevenues[idx] ?? 0
        if (revenue <= 0) return
        const gid = item.gameId || 'unknown'
        const sgid = item.subGameId || 'unknown'
        const vid = item.variantId || item.itemName || 'unknown'
        const sgKey = `${gid}::${sgid}`
        const vKey = `${gid}::${sgid}::${vid}`
        const gameRow = games.get(gid)
        if (!gameRow) return
        if (!touchedGames.has(gid)) {
          touchedGames.add(gid)
          gameRow.totals.txnCount++
        }
        const sgRow = gameRow.subgamesMap.get(sgid)
        if (!sgRow) return
        if (!touchedSubGames.has(sgKey)) {
          touchedSubGames.add(sgKey)
          sgRow.totals.txnCount++
        }
        const vRow = sgRow.variantsMap.get(vid)
        if (!vRow) return
        if (!touchedVariants.has(vKey)) {
          touchedVariants.add(vKey)
          vRow.totals.txnCount++
        }
      })
      totals.txnCount++
    } else {
      skippedTransactions++
    }
  }

  // Materialize the maps into sorted arrays (descending by revenue).
  const finalGames: GameRow[] = []
  for (const game of games.values()) {
    const subgameArray: SubGameRow[] = []
    for (const sg of game.subgamesMap.values()) {
      const variantArray: VariantRow[] = Array.from(sg.variantsMap.values()).sort(
        (a, b) => b.totals.revenue - a.totals.revenue,
      )
      subgameArray.push({
        subGameId: sg.subGameId,
        subGameName: sg.subGameName,
        totals: sg.totals,
        variants: variantArray,
      })
    }
    subgameArray.sort((a, b) => b.totals.revenue - a.totals.revenue)
    finalGames.push({
      gameId: game.gameId,
      gameName: game.gameName,
      totals: game.totals,
      subgames: subgameArray,
    })
  }
  finalGames.sort((a, b) => b.totals.revenue - a.totals.revenue)

  const branchIds = Object.entries(totals.byBranch)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)

  return {
    games: finalGames,
    totals,
    contributingTransactions,
    skippedTransactions,
    branchIds,
  }
}

/** Build a `${gameId}::${subGameId}::${variantId}` keyed lookup from a flat catalog. */
export const buildCatalogLookup = (rows: CatalogLookupEntry[]): CatalogLookup => {
  const map: CatalogLookup = new Map()
  for (const row of rows) {
    const key = `${row.gameId ?? 'unknown'}::${row.subGameId ?? 'unknown'}::${row.variantId ?? 'unknown'}`
    if (!map.has(key)) map.set(key, row)
  }
  return map
}
