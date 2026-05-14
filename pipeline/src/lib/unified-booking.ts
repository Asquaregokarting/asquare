/**
 * Unified Booking Creator
 *
 * ONE creation path for all transaction types:
 *   APP_BOOKING  — Customer App bookings
 *   ADMIN_BOOKING — Pipeline Admin bookings
 *   POS          — Point-of-Sale transactions
 *
 * Every document is billing-complete from the moment it's written.
 * No background sync — GST, vendor splits, serials, and ledger are computed inline.
 *
 * Lives in src/lib/ (shared) — importable by both customer app and pipeline.
 */
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  addDoc,
  query,
  where,
  limit,
  runTransaction,
  type Firestore,
} from 'firebase/firestore'
import { db } from './firebase'
import type { BillingItem, BookingSource } from '../types'
import { normalizeLocationSlug, slugToBranchId } from './locations'
import { logger } from './logger'
import { resolveBookingItemIds } from './booking-items-validator'
import { deriveVendorIds } from '../pipeline/api/firestore-utils'

// ── Constants ────────────────────────────────────────────────────────────────
const GST_PERCENT = 18
const VENDOR_SHARE_DEFAULT = 80

// ── Helpers ──────────────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString()

// Recursively strip undefined values from an object/array tree so Firestore's
// setDoc doesn't reject writes containing nested `undefined` (e.g. a user-form
// `activity` object with a missing field). Date instances, primitives, and
// null are passed through as-is.
const stripUndefined = <T>(value: T): T => {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value
  if (Array.isArray(value)) {
    return value.filter((v) => v !== undefined).map((v) => stripUndefined(v)) as unknown as T
  }
  if (typeof value === 'object') {
    // Class instances (Firestore SDK sentinels like serverTimestamp(),
    // arrayUnion(), increment(), deleteField(), Timestamp objects, etc.)
    // must pass through untouched — stripping their prototype turns them
    // into plain `{_methodName: 'serverTimestamp'}` data, which Firestore
    // then stores as literal map data. Read-side, that surfaces as
    // `createdAt: 1970-01-01`. Only descend into plain `{}` objects.
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return value
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      next[k] = stripUndefined(v)
    }
    return next as unknown as T
  }
  return value
}

const toBranchId = (locationId: string): string => slugToBranchId(locationId)

// ── GST ──────────────────────────────────────────────────────────────────────
export function computeGst(totalAmount: number, gstPercent = GST_PERCENT) {
  const baseAmount = Math.round((totalAmount * 100) / (100 + gstPercent))
  return { baseAmount, gstAmount: totalAmount - baseAmount, gstPercent }
}

// ── Revenue Split ────────────────────────────────────────────────────────────
type VendorType = 'ThirdParty' | 'SubLease'

export function computeRevenueSplit(
  baseAmount: number,
  gstAmount: number,
  sharePercent: number,
  vendorType: VendorType = 'ThirdParty',
) {
  if (vendorType === 'SubLease') {
    const vendorBase = Math.round((baseAmount * sharePercent) / 100)
    const companyBase = baseAmount - vendorBase
    return {
      vendorBase,
      vendorGst: 0,
      vendorTotal: vendorBase,
      companyBase,
      companyGst: gstAmount,
      companyTotal: companyBase + gstAmount,
    }
  }
  const vendorBase = Math.round((baseAmount * sharePercent) / 100)
  const vendorGst = Math.round((gstAmount * sharePercent) / 100)
  const companyBase = baseAmount - vendorBase
  const companyGst = gstAmount - vendorGst
  return {
    vendorBase,
    vendorGst,
    vendorTotal: vendorBase + vendorGst,
    companyBase,
    companyGst,
    companyTotal: companyBase + companyGst,
  }
}

// ── Vendor config ────────────────────────────────────────────────────────────
async function getVendorConfig(
  firestore: Firestore,
  vendorId: string,
): Promise<{ sharePercent: number; vendorType: VendorType }> {
  try {
    const snap = await getDoc(doc(firestore, 'vendorDetails', vendorId))
    if (!snap.exists()) return { sharePercent: VENDOR_SHARE_DEFAULT, vendorType: 'ThirdParty' }
    const data = snap.data() as Record<string, unknown>
    const share = Math.max(0, Math.min(100, Number(data.revenueShare) || VENDOR_SHARE_DEFAULT))
    const vendorType: VendorType = data.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty'
    return { sharePercent: share, vendorType }
  } catch {
    return { sharePercent: VENDOR_SHARE_DEFAULT, vendorType: 'ThirdParty' }
  }
}

// ── Serial numbers ───────────────────────────────────────────────────────────

/**
 * Extract Go Karting category from item name.
 * "Gokarting — Adult — Adult 8 Laps"             → "adult"
 * "Gokarting — Child — Child 5 Laps"             → "child"
 * "Gokarting — Double — Double Kart"             → "double"
 *
 * Event-package items have a different name shape because the campaign and
 * package wrap the variant — e.g. "Halloween — Family Pack — Adult 8 Laps".
 * Without special-casing, that would land in a "family-pack" bucket and the
 * adult go-kart slot inside the package would no longer share the running
 * serial sequence with regular adult go-kart bookings of the day. So when
 * the item name signals go-kart anywhere (including inside the variant),
 * we re-derive the category from the adult/child/double keyword and merge
 * back into the canonical bucket.
 */
const extractSerialCategory = (itemName: string): string => {
  const lower = itemName.toLowerCase()
  // Go-kart items: collapse to the canonical subcategory regardless of the
  // wrapping campaign / package title so serial sequences stay in order.
  if (
    lower.includes('gokart') ||
    lower.includes('go-kart') ||
    lower.includes('go kart') ||
    lower.includes('karting')
  ) {
    if (/\bdouble\b/.test(lower)) return 'double'
    if (/\bchild\b|\bkid(s)?\b/.test(lower)) return 'child'
    if (/\badult\b/.test(lower)) return 'adult'
  }

  const parts = itemName.split(' — ')
  // Combo items have 4+ parts: "ComboName — Category — Subcategory — Variant"
  // Regular items have 3 parts: "Category — Subcategory — Variant"
  if (parts.length >= 4) return parts[2].trim().toLowerCase().replace(/\s+/g, '-')
  if (parts.length >= 2) return parts[1].trim().toLowerCase().replace(/\s+/g, '-')
  return 'default'
}

async function reserveSerials(
  firestore: Firestore,
  locationId: string,
  date: string,
  category: string,
  count: number,
): Promise<number> {
  const docId = `${locationId}_${date}_${category}`
  const counterRef = doc(firestore, 'serialCounters', docId)
  return runTransaction(firestore, async (txn) => {
    const snap = await txn.get(counterRef)
    const lastSerial = snap.exists() ? ((snap.data() as { lastSerial: number }).lastSerial ?? 0) : 0
    const nextStart = lastSerial + 1
    txn.set(
      counterRef,
      { lastSerial: lastSerial + count, locationId, date, category },
      { merge: true },
    )
    return nextStart
  })
}

async function reserveSerialsForItems(
  firestore: Firestore,
  locationId: string,
  date: string,
  items: Array<{ itemName: string; quantity: number }>,
  documentId?: string,
): Promise<number[]> {
  const starts: number[] = new Array(items.length).fill(0)

  // Group items by category, preserving original indices
  const categoryGroups = new Map<string, Array<{ idx: number; quantity: number }>>()
  for (let i = 0; i < items.length; i++) {
    const cat = extractSerialCategory(items[i].itemName)
    if (!categoryGroups.has(cat)) categoryGroups.set(cat, [])
    categoryGroups.get(cat)!.push({ idx: i, quantity: items[i].quantity })
  }

  // Reserve one batch per category, distribute serialStarts back to items
  for (const [cat, group] of categoryGroups) {
    const totalQty = group.reduce((s, g) => s + g.quantity, 0)
    const batchStart = await reserveSerials(firestore, locationId, date, cat, totalQty)
    let offset = 0
    for (const { idx, quantity } of group) {
      starts[idx] = batchStart + offset
      offset += quantity
    }
  }

  // Write ledger entries
  if (documentId) {
    try {
      const ledgerRef = collection(firestore, 'serialLedger')
      for (let i = 0; i < items.length; i++) {
        const category = extractSerialCategory(items[i].itemName)
        await addDoc(ledgerRef, {
          documentId,
          locationId,
          date,
          category,
          itemName: items[i].itemName,
          serialStart: starts[i],
          serialEnd: starts[i] + items[i].quantity - 1,
          quantity: items[i].quantity,
          assignedAt: new Date(),
        })
      }
    } catch {
      /* non-critical */
    }
  }
  return starts
}

// ── Activity catalog lookup ──────────────────────────────────────────────────
interface CatalogEntry {
  gameId?: string
  subGameId?: string
  variantId?: string
  vendorId?: string
  vendorBranchId?: string
  name?: string
  bookingName?: string
  /** Per-sub-game Interakt booking-confirmation template snapshot. */
  interaktTemplateId?: string
  interaktTemplateLanguage?: string
}

// Branch slug ↔ numeric-id aliases. Locations are stored heterogeneously:
// `locations/0` for Visakhapatnam through `locations/2` for Rajahmundry, but
// `locations/srikakulam` for Srikakulam. Customer-app bookings carry the
// slug ('visakhapatnam'), pipeline / unified writers carry the numeric form
// ('0'). Catalog keys are emitted in BOTH forms so a lookup with either side
// of the mapping resolves cleanly. Mirror of the alias table in
// src/lib/locations.ts — kept inline here to avoid the catalog walker
// depending on a UI-bound module.
const BRANCH_KEY_ALIASES: Record<string, readonly string[]> = {
  '0': ['0', 'visakhapatnam', 'vizag'],
  '1': ['1', 'kakinada'],
  '2': ['2', 'rajahmundry'],
  '5': ['5', 'srikakulam'],
  srikakulam: ['srikakulam', '5'],
  visakhapatnam: ['visakhapatnam', '0', 'vizag'],
  vizag: ['vizag', '0', 'visakhapatnam'],
  kakinada: ['kakinada', '1'],
  rajahmundry: ['rajahmundry', '2'],
}
const branchKeyForms = (raw: string): readonly string[] => {
  const lc = String(raw || '').toLowerCase()
  return BRANCH_KEY_ALIASES[lc] || [lc]
}

async function loadActivityCatalog(firestore: Firestore): Promise<Map<string, CatalogEntry>> {
  const map = new Map<string, CatalogEntry>()
  // The legacy `activityCatalog` collection was historically populated by
  // a separate sync process and is now empty in production. Without a
  // fallback, vendor activities booked via paths that don't stamp
  // vendorId at creation (customer-app Checkout, link-flow with stale
  // toBookableCatalogActivity, etc.) lose their vendor and become
  // company-revenue. Walking the modern `locations/*/games/*/subgames/*/
  // variants/*` hierarchy with `game.metadata.vendorId` inheritance is
  // the systemic fix — every catalog consumer (createUnifiedBooking
  // fallback at line ~671, completeBillingOnPayment for online bookings)
  // now sees the canonical vendor stamp.
  try {
    const legacy = await getDocs(collection(firestore, 'activityCatalog'))
    legacy.forEach((d) => {
      const data = d.data() as CatalogEntry
      map.set(d.id, data)
      if (data.name) map.set(data.name.toLowerCase(), data)
      if (data.bookingName) map.set(data.bookingName.toLowerCase(), data)
    })
  } catch {
    /* legacy collection unavailable — proceed to modern */
  }
  try {
    const locsSnap = await getDocs(collection(firestore, 'locations'))
    await Promise.all(
      locsSnap.docs.map(async (loc) => {
        const branchId = loc.id
        const gamesSnap = await getDocs(collection(firestore, 'locations', branchId, 'games'))
        await Promise.all(
          gamesSnap.docs.map(async (g) => {
            const gameData = g.data() as { metadata?: Record<string, unknown>; name?: string }
            const meta = gameData.metadata ?? {}
            const gameVendorId =
              typeof meta.vendorId === 'string' && meta.vendorId
                ? meta.vendorId
                : typeof meta.vendorUserId === 'string' && meta.vendorUserId
                  ? meta.vendorUserId
                  : undefined
            const gameVendorBranchId =
              typeof meta.vendorBranchId === 'string' && meta.vendorBranchId
                ? meta.vendorBranchId
                : undefined
            const subgamesSnap = await getDocs(
              collection(firestore, 'locations', branchId, 'games', g.id, 'subgames'),
            )
            await Promise.all(
              subgamesSnap.docs.map(async (sg) => {
                const sgData = sg.data() as {
                  name?: string
                  interaktTemplateId?: string
                  interaktTemplateLanguage?: string
                  metadata?: Record<string, unknown>
                }
                const variantsSnap = await getDocs(
                  collection(
                    firestore,
                    'locations',
                    branchId,
                    'games',
                    g.id,
                    'subgames',
                    sg.id,
                    'variants',
                  ),
                )
                for (const v of variantsSnap.docs) {
                  const vData = v.data() as {
                    label?: string
                    metadata?: Record<string, unknown>
                  }
                  const activityId = `activity__${branchId}__${g.id}__${sg.id}__${v.id}`
                  // Per-variant or per-subgame override allowed in metadata,
                  // else fall through to game-level vendor.
                  const variantVendorId =
                    typeof vData.metadata?.vendorId === 'string' && vData.metadata.vendorId
                      ? String(vData.metadata.vendorId)
                      : typeof sgData.metadata?.vendorId === 'string' && sgData.metadata.vendorId
                        ? String(sgData.metadata.vendorId)
                        : gameVendorId
                  const entry: CatalogEntry = {
                    gameId: g.id,
                    subGameId: sg.id,
                    variantId: v.id,
                    vendorId: variantVendorId,
                    vendorBranchId: gameVendorBranchId,
                    name: vData.label ?? sgData.name ?? gameData.name,
                    interaktTemplateId: sgData.interaktTemplateId,
                    interaktTemplateLanguage: sgData.interaktTemplateLanguage,
                  }
                  // Don't overwrite a populated legacy entry with a partial
                  // one. Legacy keys win when both exist.
                  if (!map.has(activityId)) map.set(activityId, entry)
                  // Canonical 4-tuple composite key. Keying by
                  // (branchKey, gameId, subGameId, variantId) is the only
                  // form that uniquely identifies a catalog entry: 48
                  // variant labels are shared across branches ("12 laps"
                  // exists in 6 branches/games), and the lowercase-name
                  // first-write-wins map was silently stamping the wrong
                  // branch's vendor onto customer-app bookings. The same
                  // entry is emitted under every alias form of the
                  // branch ('0' / 'visakhapatnam' / 'vizag') so the
                  // lookup site doesn't have to know which form the
                  // booking carries.
                  for (const branchKey of branchKeyForms(branchId)) {
                    const compositeKey =
                      `${branchKey}::${g.id}::${sg.id}::${v.id}`.toLowerCase()
                    if (!map.has(compositeKey)) map.set(compositeKey, entry)
                    if (entry.name) {
                      const branchNameKey = `${branchKey}::${entry.name.toLowerCase()}`
                      if (!map.has(branchNameKey)) map.set(branchNameKey, entry)
                    }
                  }
                  if (entry.name) {
                    const nameKey = entry.name.toLowerCase()
                    // Unscoped name key kept as last-resort fallback for
                    // callers that don't know branchSlug. Prefer composite
                    // or branch-scoped keys at lookup time; this one is
                    // unsafe across branches and should only fire when
                    // nothing else matches.
                    if (!map.has(nameKey)) map.set(nameKey, entry)
                  }
                }
              }),
            )
          }),
        )
      }),
    )
  } catch {
    /* hierarchy walk failed — partial map is still useful */
  }
  return map
}

// ── Centralized ASG ID Generation ─────────────────────────────────────────────
// Format: ASG{YY}{MM}{DD}{HH}{mm}{SS}{CNT}{RAND}
// Example: ASG260322161509102DGKN
// Used as bookingId, transactionId, invoiceNumber, and referenceId everywhere.
const ORDER_COUNTER_KEY = 'asquare_order_counter'

/** Validates that a booking ID matches the ASG format from generateOrderNumber() */
export function isValidOrderNumber(id: string): boolean {
  return /^ASG\d{12}\d{3}[A-Z0-9]{4}$/.test(id)
}

/** Valid booking status transitions */
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled', 'rescheduled'],
  completed: ['cancelled'],
  cancelled: ['confirmed', 'pending'], // admins can reactivate cancelled bookings
  rescheduled: ['confirmed', 'cancelled'],
}

/** Check if a booking status transition is allowed */
export function isValidStatusTransition(from: string, to: string): boolean {
  if (from === to) return true
  return (VALID_STATUS_TRANSITIONS[from] ?? []).includes(to)
}

/** Check if booking can be confirmed/completed given its payment state */
export function canConfirmBooking(
  paymentStatus: string,
  paymentMethod?: string,
  finalAmount?: number,
): boolean {
  return paymentStatus === 'completed' || paymentMethod === 'cash' || finalAmount === 0
}

export function generateOrderNumber(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const yy = now.getFullYear().toString().slice(-2)
  const mm = p(now.getMonth() + 1)
  const dd = p(now.getDate())
  const hh = p(now.getHours())
  const min = p(now.getMinutes())
  const ss = p(now.getSeconds())

  let counter = parseInt(localStorage.getItem(ORDER_COUNTER_KEY) || '100', 10)
  counter = (counter + 1) % 1000
  if (counter < 100) counter = 100
  localStorage.setItem(ORDER_COUNTER_KEY, counter.toString())

  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `ASG${yy}${mm}${dd}${hh}${min}${ss}${counter}${rand}`
}

async function checkOrderExists(orderNumber: string): Promise<boolean> {
  try {
    const firestore = db
    if (!firestore) return false
    const bookingSnap = await getDoc(doc(firestore, 'bookings', orderNumber))
    return bookingSnap.exists()
  } catch {
    return false
  }
}

export async function ensureUniqueOrderNumber(): Promise<string> {
  let orderNumber = generateOrderNumber()
  let attempts = 0
  while (attempts < 5) {
    const exists = await checkOrderExists(orderNumber)
    if (!exists) return orderNumber
    orderNumber = generateOrderNumber()
    attempts++
  }
  return orderNumber
}

// ── Go-Karting detection ─────────────────────────────────────────────────────
const isGoKarting = (name: string): boolean => {
  const n = name.toLowerCase()
  return (
    n.includes('gokarting') ||
    n.includes('go-karting') ||
    n.includes('go karting') ||
    n.includes('gokart') ||
    n.includes('go-kart') ||
    n.includes('go kart')
  )
}

// ── Payment method mapping ───────────────────────────────────────────────────
function mapPaymentMethod(method?: string): 'Cash' | 'Card' | 'UPI' | 'Razorpay' | 'Split' {
  const m = String(method || '').toLowerCase()
  if (m === 'cash') return 'Cash'
  if (m === 'card') return 'Card'
  if (m.includes('upi')) return 'UPI'
  if (m === 'razorpay' || m === 'online') return 'Razorpay'
  if (m === 'split') return 'Split'
  return 'Cash'
}

// ── Vendor ledger ────────────────────────────────────────────────────────────
async function writeVendorLedger(
  firestore: Firestore,
  enrichedItems: BillingItem[],
  referenceId: string,
  invoiceNumber: string,
  locationId: string,
  date: string,
): Promise<void> {
  const ledgerByVendor = new Map<
    string,
    { vendorBase: number; vendorGst: number; vendorTotal: number }
  >()
  for (const item of enrichedItems) {
    if (!item.vendorId || !(item.vendorTotal ?? 0)) continue
    const acc = ledgerByVendor.get(item.vendorId) ?? { vendorBase: 0, vendorGst: 0, vendorTotal: 0 }
    acc.vendorBase += item.vendorBase ?? 0
    acc.vendorGst += item.vendorGst ?? 0
    acc.vendorTotal += item.vendorTotal ?? 0
    ledgerByVendor.set(item.vendorId, acc)
  }
  const ledgerCol = collection(firestore, 'vendorLedger')
  for (const [vid, totals] of ledgerByVendor.entries()) {
    if (totals.vendorTotal <= 0) continue
    const ledgerId = `le-${referenceId}-${vid}`
    await setDoc(
      doc(ledgerCol, ledgerId),
      stripUndefined({
        id: ledgerId,
        vendorId: vid,
        vendorBase: totals.vendorBase,
        vendorGst: totals.vendorGst,
        amount: totals.vendorTotal,
        type: 'credit',
        referenceId,
        invoiceNumber,
        locationId,
        date,
        createdAt: nowIso(),
      } as Record<string, unknown>),
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Unified item enrichment — GST + vendor splits per item
// ═══════════════════════════════════════════════════════════════════════════════
interface ItemInput {
  itemName: string
  quantity: number
  unitPrice: number
  gameId?: string
  subGameId?: string
  variantId?: string
  vendorId?: string
  /**
   * Optional per-item override for vendor revenue-share %. When set, replaces
   * the value read from `vendorDetails.revenueShare` at sale time for this item only.
   * Used by event package items with `revenueShare: false` → pass 100 to route the
   * full gross to the third-party vendor.
   */
  vendorSharePercentOverride?: number
  /** When true, the bill printer prints one token per quantity instead of a single aggregated token. */
  printIndividualTokens?: boolean
  activity?: unknown
  duration?: number
  date?: string
  timeSlot?: string
}

async function enrichItemsWithBilling(
  firestore: Firestore,
  items: ItemInput[],
  finalAmount: number,
  _discountAmount: number,
  itemDiscounts?: number[],
): Promise<{
  billingItems: BillingItem[]
  baseAmount: number
  gstAmount: number
  vendorId?: string
  vendorBase: number
  vendorGst: number
  vendorTotal: number
  companyBase: number
  companyGst: number
  companyTotal: number
}> {
  const gstPercent = GST_PERCENT
  const totalAmount = Math.max(0, finalAmount)
  const { baseAmount, gstAmount } = computeGst(totalAmount, gstPercent)

  // Fetch vendor configs
  const uniqueVendorIds = [...new Set(items.map((i) => i.vendorId).filter(Boolean))] as string[]
  const vendorConfigMap = new Map<string, { sharePercent: number; vendorType: VendorType }>()
  await Promise.all(
    uniqueVendorIds.map(async (vid) => {
      vendorConfigMap.set(vid, await getVendorConfig(firestore, vid))
    }),
  )

  // Per-item GST extraction with proportional distribution
  const payloadItemDiscounts = itemDiscounts ?? []
  const itemSubtotals = items.map(
    (i) => Math.max(1, Math.floor(i.quantity)) * Math.max(0, i.unitPrice),
  )
  const itemRawDiscounts = itemSubtotals.map((st, idx) => {
    const d = payloadItemDiscounts[idx] ?? 0
    return Math.min(Math.max(0, d), st)
  })
  const itemTotals = itemSubtotals.map((st, idx) => Math.max(0, st - itemRawDiscounts[idx]))
  const itemRawBases = itemTotals.map((t) => Math.round((t * 100) / (100 + gstPercent)))
  if (itemRawBases.length > 0) {
    const baseSum = itemRawBases.reduce((s, a) => s + a, 0)
    itemRawBases[itemRawBases.length - 1] += baseAmount - baseSum
  }
  const itemRawGsts = itemTotals.map((t, idx) => t - itemRawBases[idx])
  if (itemRawGsts.length > 0) {
    const gstSum = itemRawGsts.reduce((s, a) => s + a, 0)
    itemRawGsts[itemRawGsts.length - 1] += gstAmount - gstSum
  }

  const billingItems: BillingItem[] = items.map((item, idx) => {
    const itemBase = itemRawBases[idx] ?? 0
    const itemGst = itemRawGsts[idx] ?? 0
    const itemDiscount = itemRawDiscounts[idx] || undefined

    if (item.vendorId) {
      const config = vendorConfigMap.get(item.vendorId) ?? {
        sharePercent: VENDOR_SHARE_DEFAULT,
        vendorType: 'ThirdParty' as VendorType,
      }
      const effectiveShare =
        item.vendorSharePercentOverride != null
          ? Math.min(100, Math.max(0, item.vendorSharePercentOverride))
          : config.sharePercent
      const split = computeRevenueSplit(itemBase, itemGst, effectiveShare, config.vendorType)
      return {
        itemName: item.itemName,
        quantity: Math.max(1, Math.floor(item.quantity)),
        unitPrice: Math.max(0, item.unitPrice),
        gameId: item.gameId,
        subGameId: item.subGameId,
        variantId: item.variantId,
        vendorId: item.vendorId,
        itemDiscount,
        itemBaseAmount: itemBase,
        itemGstAmount: itemGst,
        vendorSharePercent: effectiveShare,
        printIndividualTokens: item.printIndividualTokens === true ? true : undefined,
        ...split,
      }
    }
    return {
      itemName: item.itemName,
      quantity: Math.max(1, Math.floor(item.quantity)),
      unitPrice: Math.max(0, item.unitPrice),
      gameId: item.gameId,
      subGameId: item.subGameId,
      variantId: item.variantId,
      itemDiscount,
      itemBaseAmount: itemBase,
      itemGstAmount: itemGst,
      vendorBase: 0,
      vendorGst: 0,
      vendorTotal: 0,
      companyBase: itemBase,
      companyGst: itemGst,
      companyTotal: itemBase + itemGst,
      printIndividualTokens: item.printIndividualTokens === true ? true : undefined,
    }
  })

  // Aggregate
  const txnVendorBase = billingItems.reduce((s, i) => s + (i.vendorBase ?? 0), 0)
  const txnVendorGst = billingItems.reduce((s, i) => s + (i.vendorGst ?? 0), 0)
  const txnVendorTotal = txnVendorBase + txnVendorGst
  const txnCompanyBase = billingItems.reduce((s, i) => s + (i.companyBase ?? 0), 0)
  const txnCompanyGst = billingItems.reduce((s, i) => s + (i.companyGst ?? 0), 0)
  const txnCompanyTotal = txnCompanyBase + txnCompanyGst
  const primaryVendorId = billingItems.find((i) => i.vendorId)?.vendorId

  return {
    billingItems,
    baseAmount,
    gstAmount,
    vendorId: primaryVendorId,
    vendorBase: txnVendorBase,
    vendorGst: txnVendorGst,
    vendorTotal: txnVendorTotal,
    companyBase: txnCompanyBase,
    companyGst: txnCompanyGst,
    companyTotal: txnCompanyTotal,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create Unified Booking Params
// ═══════════════════════════════════════════════════════════════════════════════
export interface CreateUnifiedBookingParams {
  id?: string
  source: BookingSource
  sourceType?: string

  // Customer
  userId?: string
  customerName: string
  customerPhone: string
  customerEmail?: string

  // Items
  items: ItemInput[]

  // Amounts
  totalAmount: number
  discountAmount?: number
  finalAmount: number
  gstPercent?: number
  /**
   * Amount to deduct from the customer's wallet as part of this booking.
   * When > 0, `createUnifiedBooking` debits `users/{uid}/wallet/data.balance`
   * (via deductCustomerWallet) atomically and stamps `walletRedeemed` on
   * the booking doc so refund-reversal can credit it back later. The POS
   * caller is responsible for reducing `finalAmount` by the same number
   * before passing it in — we do NOT re-deduct here.
   */
  walletRedeemed?: number

  // Payment
  paymentMethod: string
  paymentStatus: 'pending' | 'completed' | 'failed'
  paymentId?: string
  paymentReference?: string
  splitCash?: number
  splitUpi?: number
  splitCard?: number

  // Location
  locationId: string

  // Booking-specific
  sessionDate?: Date | string
  bookingStatus?: string
  qrCode?: string
  tires?: number
  cashbackAmount?: number
  couponCode?: string
  couponAmount?: number
  passengers?: unknown[]
  flightNumber?: string
  razorpayOrderId?: string
  razorpaySignature?: string

  // Staff
  createdByAdminId?: string
  createdByAdminName?: string
  createdByRole?: string

  // POS-specific
  itemDiscounts?: number[]
  visitDate?: string
  transactionDate?: string
  leadId?: string

  // Pre-set interakt state (to suppress auto-trigger when notification is sent separately)
  interakt?: Record<string, unknown>

  // Protocol — free Go-Karting entry (5 laps), requires Owner approval
  isProtocol?: boolean
  protocolStatus?: 'pending_approval' | 'approved' | 'rejected'
  protocolReason?: string

  // Offer — discounted Go-Karting entry, requires Owner approval
  isOffer?: boolean
  offerStatus?: 'pending_approval' | 'approved' | 'rejected'
  offerReason?: string

  // Idempotency — caller-generated UUID stamped onto the booking. If a write
  // with the same clientRequestId already exists, createUnifiedBooking
  // returns the existing booking instead of creating a second one. Defends
  // against double-clicks, retries, and concurrent-tab races even when state
  // is not shared between submitters.
  clientRequestId?: string
}

export interface UnifiedBookingResult {
  id: string
  invoiceNumber: string
  document: Record<string, unknown>
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main: createUnifiedBooking
// ═══════════════════════════════════════════════════════════════════════════════
export async function createUnifiedBooking(
  params: CreateUnifiedBookingParams,
): Promise<UnifiedBookingResult> {
  const firestore = db
  if (!firestore) throw new Error('Firestore not initialized')

  // 0. Idempotency check — if the caller passed a clientRequestId and a booking
  // with that token already exists, return it without writing again. This
  // makes double-clicks, retries, and cross-tab races safe by construction.
  if (params.clientRequestId) {
    const existingSnap = await getDocs(
      query(
        collection(firestore, 'bookings'),
        where('clientRequestId', '==', params.clientRequestId),
        limit(1),
      ),
    )
    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0]
      const existingData = existing.data() as Record<string, unknown>
      logger.info('unified_booking.idempotent_replay', {
        bookingId: existing.id,
        clientRequestId: params.clientRequestId,
      })
      return {
        id: existing.id,
        invoiceNumber: String(existingData.invoiceNumber ?? existing.id),
        document: existingData,
      }
    }
  }

  const createdAt = nowIso()
  const transactionDate = params.transactionDate || createdAt
  const txnDate = transactionDate.slice(0, 10)
  const branchId = toBranchId(params.locationId)

  // 1. Generate IDs — single ASG format for ALL sources
  const id = params.id || (await ensureUniqueOrderNumber())
  const invoiceNumber = id // Same ASG ID used as invoice number

  // 2. Resolve vendor IDs from activity catalog (if items don't already have vendorId)
  const needsCatalogLookup = params.items.some((i) => !i.vendorId && !i.gameId)
  let resolvedItems = params.items
  if (needsCatalogLookup) {
    const catalog = await loadActivityCatalog(firestore)
    const branchSlug = String(params.locationId || '').toLowerCase()
    resolvedItems = params.items.map((item) => {
      if (item.vendorId) return item // already resolved
      const activity = item.activity as Record<string, unknown> | undefined
      const activityId = activity ? String(activity.id || '') : ''
      const activityName = item.itemName
      // Customer-app activity.id is `${gameId}-${subGameId}-${variantId}`;
      // parse it so we can build the canonical composite key even when
      // gameId / subGameId / variantId aren't set on the item yet.
      const idParts = activityId.includes('-') ? activityId.split('-') : []
      const compositeFromIds =
        item.gameId && item.subGameId && item.variantId
          ? `${branchSlug}::${item.gameId}::${item.subGameId}::${item.variantId}`.toLowerCase()
          : ''
      const compositeFromActivityId =
        !compositeFromIds && idParts.length >= 3
          ? `${branchSlug}::${idParts.slice(0, -2).join('-')}::${idParts[idParts.length - 2]}::${idParts[idParts.length - 1]}`.toLowerCase()
          : ''
      const branchScopedNameKey = activityName
        ? `${branchSlug}::${activityName.toLowerCase()}`
        : ''
      const entry =
        catalog.get(activityId) ||
        (compositeFromIds ? catalog.get(compositeFromIds) : undefined) ||
        (compositeFromActivityId ? catalog.get(compositeFromActivityId) : undefined) ||
        (branchScopedNameKey ? catalog.get(branchScopedNameKey) : undefined) ||
        catalog.get(activityName.toLowerCase())
      // Snapshot the per-activity Interakt template onto the booking item if
      // it isn't already set. Items created via toBookableCatalogActivity
      // already carry it; POS / billing flows that build items directly
      // pick it up here from the catalog entry.
      const enrichedActivity =
        entry?.interaktTemplateId &&
        !(activity as { interaktTemplateId?: unknown } | undefined)?.interaktTemplateId
          ? {
              ...(activity ?? {}),
              interaktTemplateId: entry.interaktTemplateId,
              ...(entry.interaktTemplateLanguage
                ? { interaktTemplateLanguage: entry.interaktTemplateLanguage }
                : {}),
            }
          : activity
      return {
        ...item,
        activity: enrichedActivity ?? item.activity,
        gameId: item.gameId || entry?.gameId,
        subGameId: item.subGameId || entry?.subGameId,
        variantId: item.variantId || entry?.variantId,
        vendorId: entry?.vendorId,
      }
    })
  }

  // 2b. Validate vendor-branch alignment — strip vendorId if it belongs to a different branch
  if (branchId) {
    resolvedItems = resolvedItems.map((item) => {
      const vBranch = (item as unknown as { vendorBranchId?: string }).vendorBranchId
      if (item.vendorId && vBranch && vBranch !== branchId) {
        logger.error('unified_booking.cross_branch_vendor_stripped', undefined, {
          itemName: item.itemName,
          vendorId: item.vendorId,
          vendorBranchId: vBranch,
          bookingBranchId: branchId,
        })
        return { ...item, vendorId: undefined }
      }
      return item
    })
  }

  // 2c. Final guardrail: normalize gameId/subGameId/variantId across every
  // item using the activity metadata that's already on the item. This is
  // the single choke point that prevents "unknown" from accumulating in the
  // Game Revenue report. The resolver preserves any IDs already set,
  // lowercases for consistent aggregation, and falls back to Miscellaneous
  // so nothing can reach Firestore as unknown.
  let fellBackToMisc = 0
  const miscFallbackItemNames: string[] = []
  resolvedItems = resolvedItems.map((item) => {
    const resolved = resolveBookingItemIds({
      itemName: item.itemName,
      gameId: item.gameId,
      subGameId: item.subGameId,
      variantId: item.variantId,
      activity: item.activity,
    })
    if (resolved.strategy === 'misc-fallback') {
      fellBackToMisc++
      miscFallbackItemNames.push(item.itemName)
    }
    return {
      ...item,
      gameId: resolved.gameId,
      subGameId: resolved.subGameId,
      // Use undefined (not null) so it matches ItemInput's optional shape
      // and gets stripped by stripUndefined at write time when absent.
      variantId: resolved.variantId ?? undefined,
    }
  })
  if (fellBackToMisc > 0) {
    // Hard-fail when EVERY item misses the catalog AND no item carries an
    // explicit vendorId. That state produces a fully-orphan booking — no
    // gameId, no vendorId, no vendorIds[], no ledger credits — the exact
    // shape that bled ₹21,509 across 11 bookings before this guard.
    // Partial misc (some items resolved, some didn't) still gets through
    // with an error log so legitimate "Misc charge" / "Adjustment" line
    // items keep working without a regression.
    const anyItemHasVendor = resolvedItems.some((i) => Boolean(i.vendorId))
    const allFellBack = fellBackToMisc === resolvedItems.length
    if (allFellBack && !anyItemHasVendor) {
      logger.error('unified_booking.all_items_unresolved', undefined, {
        bookingId: id,
        source: params.source,
        itemNames: miscFallbackItemNames,
      })
      throw new Error(
        `Cannot create booking ${id}: none of the ${resolvedItems.length} item(s) match the activity catalog and no item carries a vendorId. This would create an orphan booking with no game/vendor attribution. Item names: ${miscFallbackItemNames.join(', ')}. Pick items from the catalog dropdown instead of typing free text, or contact the developer team to add the catalog entry.`,
      )
    }
    // Otherwise log loudly (not warn) so partial mismatches surface in
    // monitoring and aren't lost in the noise.
    logger.error('unified_booking.items_fell_back_to_misc', undefined, {
      bookingId: id,
      source: params.source,
      count: fellBackToMisc,
      total: resolvedItems.length,
      itemNames: miscFallbackItemNames,
    })
  }

  // 3. Compute billing fields (GST, vendor splits)
  const billing = await enrichItemsWithBilling(
    firestore,
    resolvedItems,
    params.finalAmount,
    params.discountAmount ?? 0,
    params.itemDiscounts,
  )

  // 4. Reserve serial numbers (only for completed payments, Go-Karting items only)
  if (params.paymentStatus === 'completed') {
    try {
      const goKartItems = billing.billingItems
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => isGoKarting(item.itemName))
      if (goKartItems.length > 0) {
        const serialStarts = await reserveSerialsForItems(
          firestore,
          branchId,
          txnDate,
          goKartItems.map(({ item }) => item),
          invoiceNumber,
        )
        for (let j = 0; j < goKartItems.length; j++) {
          billing.billingItems[goKartItems[j].idx].serialStart = serialStarts[j]
        }
      }
    } catch (err) {
      logger.error('booking.serial_reservation_failed', err, {
        bookingId: id,
        context: 'Go-kart tokens may be missing — requires manual serial assignment',
      })
    }
  }

  // 5. Build complete document
  const subtotal = params.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const sessionDate =
    params.sessionDate instanceof Date
      ? params.sessionDate
      : params.sessionDate
        ? new Date(params.sessionDate)
        : new Date()

  const completeDoc = stripUndefined({
    // Identity
    id,
    source: params.source,
    sourceType: params.sourceType,
    invoiceNumber,

    // Customer
    userId: params.userId || '',
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    customerEmail: params.customerEmail,
    userDisplayName: params.customerName,
    userPhone: params.customerPhone,

    // Items (original booking items preserved for backward compat)
    items: resolvedItems.map((i) =>
      stripUndefined({
        activity: i.activity,
        itemName: i.itemName,
        gameId: i.gameId,
        subGameId: i.subGameId,
        variantId: i.variantId,
        vendorId: i.vendorId,
        quantity: i.quantity,
        duration: i.duration,
        date: i.date,
        timeSlot: i.timeSlot,
        price: i.quantity * i.unitPrice,
        // Persist the per-token-printing flag at item top-level so the
        // ticket printer (which reads `item.printIndividualTokens`) gets
        // it whether the booking is printed immediately or later via
        // resend/reprint. Pulled from the source activity at booking
        // creation via toBookableCatalogActivity.
        printIndividualTokens: i.printIndividualTokens,
      } as Record<string, unknown>),
    ),

    // Amounts
    totalAmount: params.totalAmount,
    discountAmount: params.discountAmount ?? 0,
    finalAmount: params.finalAmount,

    // GST
    baseAmount: billing.baseAmount,
    gstAmount: billing.gstAmount,
    gstPercent: GST_PERCENT,
    subtotal,
    tax: billing.gstAmount,
    discount: params.discountAmount ?? 0,

    // Payment
    paymentMethod:
      params.source === 'POS' ? mapPaymentMethod(params.paymentMethod) : params.paymentMethod,
    paymentStatus: params.paymentStatus,
    paymentId: params.paymentId,
    paymentReference: params.paymentReference,
    ...(params.splitCash != null || params.splitUpi != null || params.splitCard != null
      ? {
          splitCash: params.splitCash ?? 0,
          splitUpi: params.splitUpi ?? 0,
          splitCard: params.splitCard ?? 0,
        }
      : {}),
    refundStatus: 'None' as const,

    // Location — always store the canonical slug form so dashboards and
    // group-by queries don't fragment by branchId variant ("0" vs
    // "visakhapatnam" vs "vizag"). The 2026-05-11 backfill normalized
    // 1700 historical rows; this stops any new write from re-introducing
    // the drift even if a caller still passes numeric branchId or an
    // informal alias.
    locationId: normalizeLocationSlug(params.locationId),

    // Idempotency token (when caller supplied one) — stamped on the doc so
    // the next call with the same token can short-circuit at line ~660.
    clientRequestId: params.clientRequestId,

    // Use a real Date here, not serverTimestamp(). The downstream
    // sendRazorpayPaymentLink Cloud Function reads the booking doc to
    // attach paymentLink fields, and during the brief window where the
    // server-timestamp sentinel reads as null on the client cache, that
    // function ends up writing the doc back with `createdAt = null`,
    // surfacing as 1970-01-01. The original epoch-zero corruption came
    // from legacy importers that never wrote `createdAt` at all — fixed
    // by the one-shot backfill, not by switching this writer.
    createdAt: new Date(),
    transactionDate,
    // visitDate is the YYYY-MM-DD bucket the booking shows under in the admin
    // dashboard (FutureBookingsStrip, AllBookingsView day filter, etc.). It
    // MUST reflect the session day in IST — not the day the booking was
    // written. Falling back to `txnDate` (transactionDate.slice(0,10)) was
    // dropping admin-created future bookings into "Today" instead of the
    // picked session date, so 73EH (sessionDate Sat 17 May, created Sun
    // 11 May) wouldn't show on its actual day. Prefer the caller's
    // explicit visitDate, then the IST day of sessionDate, only fall back
    // to txnDate when neither is available (e.g. legacy callers).
    visitDate:
      params.visitDate ||
      (() => {
        try {
          return sessionDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        } catch {
          return ''
        }
      })() ||
      txnDate,
    sessionDate,

    // Booking status — protocol/offer bookings: pending unless already approved (Owner-created)
    bookingStatus: params.isProtocol
      ? params.protocolStatus === 'approved'
        ? 'confirmed'
        : 'pending'
      : params.isOffer
        ? params.offerStatus === 'approved'
          ? 'confirmed'
          : 'pending'
        : params.bookingStatus || (params.paymentStatus === 'completed' ? 'confirmed' : 'pending'),
    qrCode: params.qrCode || '',
    tires: params.tires ?? 0,
    cashbackAmount: params.cashbackAmount ?? 0,

    // Coupon
    couponCode: params.couponCode,
    couponAmount: params.couponAmount,
    couponDiscount: params.couponAmount,

    // Wallet redemption — amount debited from the customer's wallet as part
    // of this booking. The actual wallet debit happens below (after the
    // booking doc write) via deductCustomerWallet; stamping the amount here
    // lets refund-reversal and reporting attribute the redemption back to
    // this specific booking.
    walletRedeemed:
      params.walletRedeemed && params.walletRedeemed > 0 ? params.walletRedeemed : undefined,

    // Vendor splits (transaction-level)
    vendorId: billing.vendorId,
    vendorBase: billing.vendorTotal > 0 ? billing.vendorBase : undefined,
    vendorGst: billing.vendorTotal > 0 ? billing.vendorGst : undefined,
    vendorTotal: billing.vendorTotal > 0 ? billing.vendorTotal : undefined,
    companyBase: billing.companyBase,
    companyGst: billing.companyGst,
    companyTotal: billing.companyTotal,

    // Staff attribution
    createdByAdminId: params.createdByAdminId,
    createdByAdminName: params.createdByAdminName,
    createdByRole: params.createdByRole,
    handledBy: params.createdByAdminName || params.customerName || 'Customer',
    handledByRole: params.createdByRole || 'customer',
    createdBy: params.createdByAdminId || '',
    createdByName: params.createdByAdminName || '',

    // Per-item billing breakdown
    billingItems: billing.billingItems.map((i) =>
      stripUndefined(i as unknown as Record<string, unknown>),
    ),

    // Multi-vendor scope index. Top-level `vendorId` only holds the first
    // vendor on combo invoices and is undefined for event-package bookings,
    // so `where('vendorId','==', X)` lookups silently miss every non-primary
    // vendor. `vendorIds` mirrors the distinct vendors on the items so
    // vendor-scoped reads can use `array-contains`.
    vendorIds: deriveVendorIds(billing.billingItems),

    // Booking-specific
    passengers: params.passengers,
    flightNumber: params.flightNumber,
    razorpayOrderId: params.razorpayOrderId,
    razorpaySignature: params.razorpaySignature,
    leadId: params.leadId,

    billingSyncedAt: new Date(),
    ...(params.interakt ? { interakt: params.interakt } : {}),

    // Protocol booking fields
    ...(params.isProtocol
      ? {
          isProtocol: true,
          protocolStatus: params.protocolStatus || 'pending_approval',
          protocolReason: params.protocolReason,
          protocolRequestedBy: params.createdByAdminName,
          protocolRequestedAt: new Date(),
        }
      : {}),

    // Offer booking fields
    ...(params.isOffer
      ? {
          isOffer: true,
          offerStatus: params.offerStatus || 'pending_approval',
          offerReason: params.offerReason,
          offerRequestedBy: params.createdByAdminName,
          offerRequestedAt: new Date(),
        }
      : {}),
  } as Record<string, unknown>)

  // 5b. Debit the customer wallet BEFORE writing the booking document.
  //
  // We deduct first so a race-condition/insufficient-balance error fails
  // fast with no booking artifact to clean up. If the debit fails, the
  // caller gets a plain error; we never end up with a booking that claims
  // a wallet redemption that didn't actually happen.
  //
  // deductCustomerWallet uses its own atomic Firestore transaction that
  // updates the subcollection balance, the root mirror, and the wallet_tx
  // log in one shot — see src/pipeline/api/billing-firestore.ts.
  if (params.walletRedeemed && params.walletRedeemed > 0) {
    if (!params.customerPhone || params.customerPhone.trim() === '') {
      throw new Error('Wallet redemption requires a customer phone number.')
    }
    const { deductCustomerWallet } = await import('../pipeline/api/billing-firestore')
    await deductCustomerWallet(
      params.customerPhone,
      params.walletRedeemed,
      `POS wallet redemption for booking ${invoiceNumber}`,
      invoiceNumber,
    )
  }

  // 6. Write booking document
  // Pre-flight validation in soft mode: log drift to the structured
  // logger so admin can spot it via Reconciliation tools, but DO NOT
  // block the write. POS billing can't be held hostage by a drift bug;
  // sales must continue while we trace the upstream cause.
  const { validateBooking, assertNoZeroOutHack } = await import('./booking-validator')
  const validation = validateBooking(completeDoc as unknown as Record<string, unknown>)
  if (!validation.ok) {
    logger.error('booking.validation_failed', new Error('Booking invariants failed'), {
      bookingId: id,
      writer: 'createUnifiedBooking',
      failures: validation.failures.map((f) => ({
        code: f.code,
        message: f.message,
        detail: f.detail,
      })),
    })
  }
  // Hard-block the subtract-to-zero hack regardless of the soft-mode
  // policy above. Pattern: finalAmount=0 + negative billingItems[] on a
  // non-cancelled, non-refunded booking. Closes the path that produced
  // ASG260411235153111CP7L and ASG260502190314957WKJS.
  assertNoZeroOutHack(completeDoc as unknown as Record<string, unknown>, 'createUnifiedBooking')
  // Transactional idempotency claim. The earlier read-only check at the
  // top of this function catches retries that happen seconds apart (the
  // common case), but it has a TOCTOU race for retries that fire within
  // the same few milliseconds — both reads return empty, both proceed to
  // setDoc, and both writes land as separate bookings under different
  // ASG ids. Phone 9502617044 hit this on 2026-05-07: a slow first
  // submit with the catalog re-check still pending let four extra
  // "Pay & Print" taps slip past the caller's re-entry guard, all
  // sharing the same clientRequestId, all writing distinct bookings.
  //
  // The transaction below claims `bookingDedup/{clientRequestId}` and
  // writes the booking doc atomically. Concurrent invocations on the
  // same token serialize on the dedup pointer — one wins and writes the
  // booking; the others see the pointer, abort their write, and return
  // the winner's booking unchanged. No clientRequestId means no claim
  // (legacy callers stay on the plain setDoc path).
  if (params.clientRequestId) {
    const dedupRef = doc(firestore, 'bookingDedup', params.clientRequestId)
    const bookingRef = doc(firestore, 'bookings', id)
    const claim = await runTransaction(firestore, async (txn) => {
      const dedupSnap = await txn.get(dedupRef)
      if (dedupSnap.exists()) {
        return {
          won: false,
          existingBookingId: String((dedupSnap.data() as Record<string, unknown>).bookingId ?? ''),
        }
      }
      txn.set(dedupRef, {
        bookingId: id,
        clientRequestId: params.clientRequestId,
        createdAt: nowIso(),
      })
      txn.set(bookingRef, completeDoc)
      return { won: true, existingBookingId: id }
    })
    if (!claim.won && claim.existingBookingId && claim.existingBookingId !== id) {
      logger.info('unified_booking.idempotent_replay_via_dedup_pointer', {
        bookingId: claim.existingBookingId,
        clientRequestId: params.clientRequestId,
        wouldHaveWrittenAs: id,
      })
      const existing = await getDoc(doc(firestore, 'bookings', claim.existingBookingId))
      const existingData = (existing.data() ?? {}) as Record<string, unknown>
      return {
        id: claim.existingBookingId,
        invoiceNumber: String(existingData.invoiceNumber ?? claim.existingBookingId),
        document: existingData,
      }
    }
    // We won the race — booking has already been written inside the
    // transaction. Continue with the post-write side effects below.
  } else {
    await setDoc(doc(firestore, 'bookings', id), completeDoc)
  }

  // 7. Write user subcollection (if applicable)
  if (params.userId && !params.userId.startsWith('offline_')) {
    try {
      await setDoc(doc(firestore, 'users', params.userId, 'bookings', id), completeDoc)
    } catch {
      /* non-critical */
    }
  }

  // 8. Write vendor ledger (only for completed payments)
  if (params.paymentStatus === 'completed' && billing.vendorTotal > 0) {
    try {
      await writeVendorLedger(firestore, billing.billingItems, id, invoiceNumber, branchId, txnDate)
    } catch (err) {
      logger.error('booking.vendor_ledger_failed', err, { bookingId: id, invoiceNumber })
    }
  }

  // 8b. Calculate and write cashier incentives (POS + completed payments only)
  if (params.source === 'POS' && params.paymentStatus === 'completed' && params.createdByAdminId) {
    try {
      const { writeCashierIncentives } =
        await import('../pipeline/features/cashier-incentives/write-incentives')
      await writeCashierIncentives(firestore, {
        bookingId: id,
        invoiceNumber,
        locationId: branchId,
        cashierId: params.createdByAdminId,
        cashierName: params.createdByAdminName || '',
        billingItems: billing.billingItems,
        transactionDate: txnDate,
      })
    } catch {
      /* non-critical — incentive write is supplementary */
    }
  }

  // 9. Create or update member record (non-critical)
  if (params.customerPhone) {
    try {
      const memberDigits = params.customerPhone.replace(/\D/g, '').slice(-10)
      if (memberDigits.length === 10) {
        const memberRef = doc(firestore, 'members', memberDigits)
        const memberSnap = await getDoc(memberRef)
        const existing = memberSnap.exists() ? (memberSnap.data() as Record<string, unknown>) : null

        const prevVisits = Number(existing?.totalVisits ?? 0)
        const prevBillAmount = Number(existing?.totalBillAmount ?? 0)
        const txnAmount = params.finalAmount ?? 0

        await setDoc(
          memberRef,
          {
            id: memberDigits,
            name: params.customerName || String(existing?.name ?? ''),
            mobile: memberDigits,
            email: params.customerEmail || String(existing?.email ?? ''),
            membership: String(existing?.membership ?? 'Silver'),
            totalVisits: prevVisits + 1,
            totalBillAmount: prevBillAmount + txnAmount,
            walletBalance: Number(existing?.walletBalance ?? 0),
            starStatus: String(existing?.starStatus ?? '0'),
            coupons150Redeemed: Number(existing?.coupons150Redeemed ?? 0),
            lastVisitDate: txnDate,
            lastVisitLocation: params.locationId ?? '',
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        )

        // 9b. Ensure users collection + phoneToUid entry for this customer (non-critical)
        try {
          const phoneIdxRef = doc(firestore, 'phoneToUid', memberDigits)
          const phoneIdxSnap = await getDoc(phoneIdxRef)
          let userUid: string | null = null

          if (phoneIdxSnap.exists()) {
            userUid = String((phoneIdxSnap.data() as Record<string, unknown>).uid ?? '') || null
          }

          if (userUid) {
            // User exists — update displayName + memberData
            await setDoc(
              doc(firestore, 'users', userUid),
              {
                ...(params.customerName ? { displayName: params.customerName } : {}),
                memberData: {
                  mobile: memberDigits,
                  totalVisits: prevVisits + 1,
                  totalBillAmount: prevBillAmount + txnAmount,
                  membership: String(existing?.membership ?? 'Silver'),
                  starStatus: String(existing?.starStatus ?? '0'),
                  coupons150Redeemed: Number(existing?.coupons150Redeemed ?? 0),
                },
                updatedAt: new Date(),
              },
              { merge: true },
            )
          } else {
            // No phoneToUid entry yet — this is the customer's first visit.
            // Use the clean 10-digit phone as the canonical id. Previously
            // this path created `users/offline_${phone}`, which became one of
            // the duplicate-creation sources the dedup sweep had to clean up
            // (see scripts/dedup-users.ts). Writing at `users/${phone}` lands
            // in the tier-2 canonical slot so a future OTP login that carries
            // a Firebase UID will find the existing phoneToUid mapping and
            // reuse this doc instead of creating a parallel one.
            const canonicalUid = memberDigits
            await setDoc(
              doc(firestore, 'users', canonicalUid),
              {
                displayName: params.customerName || '',
                phone: memberDigits,
                email: params.customerEmail || '',
                tier: 'bronze',
                isVerified: false,
                walletBalance: 0,
                tires: 0,
                referralCode: '',
                referredBy: '',
                memberData: {
                  mobile: memberDigits,
                  totalVisits: prevVisits + 1,
                  totalBillAmount: prevBillAmount + txnAmount,
                  membership: String(existing?.membership ?? 'Silver'),
                  starStatus: String(existing?.starStatus ?? '0'),
                  coupons150Redeemed: Number(existing?.coupons150Redeemed ?? 0),
                },
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              { merge: true },
            )

            await setDoc(phoneIdxRef, { uid: canonicalUid, source: 'pos-first-visit' })
          }
        } catch (err) {
          logger.error('booking.phone_index_failed', err, { bookingId: id, memberDigits })
        }
      }
    } catch (err) {
      logger.error('booking.user_creation_failed', err, { bookingId: id })
    }
  }

  return { id, invoiceNumber, document: completeDoc }
}

// ═══════════════════════════════════════════════════════════════════════════════
// completeBillingOnPayment — finalize serials + ledger when pending → completed
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sentinel emitted by the Pipeline "Create Booking Link" flow when a member
 * applies their ₹150 coupons. Format: `MEMBER150x{count}` — see
 * `src/pipeline/pages/modules/bookings/coupon-application.ts`.
 *
 * The redemption is performed inline (rather than importing the pipeline
 * `redeemMemberCoupons` helper) so the customer-app bundle does not pull in
 * pipeline-only code.
 */
const MEMBER_COUPON_SENTINEL = /^MEMBER150x(\d+)$/

async function redeemMember150CouponsFromBooking(
  firestore: Firestore,
  orderNumber: string,
  booking: Record<string, unknown>,
): Promise<void> {
  const code = String(booking.couponCode ?? '').trim()
  if (!code) return
  const match = MEMBER_COUPON_SENTINEL.exec(code)
  if (!match) return
  const count = Number(match[1])
  if (!Number.isFinite(count) || count <= 0) return

  // Idempotency guard — once stamped, never redeem again on webhook retries.
  if (booking.member150RedeemedAt) return

  const phoneRaw = String(booking.customerPhone ?? booking.userPhone ?? '')
  const phone = phoneRaw.replace(/\D/g, '').slice(-10)
  if (phone.length !== 10) return

  try {
    // Step 1: increment users/{uid}/memberData.coupons150Redeemed via phoneToUid index
    try {
      const phoneDoc = await getDoc(doc(firestore, 'phoneToUid', phone))
      if (phoneDoc.exists()) {
        const uid = String((phoneDoc.data() as Record<string, unknown>).uid ?? '')
        if (uid) {
          const userRef = doc(firestore, 'users', uid)
          const userSnap = await getDoc(userRef)
          if (userSnap.exists()) {
            const md = (userSnap.data() as Record<string, unknown>).memberData as
              | Record<string, unknown>
              | undefined
            const currentRedeemed = Number(md?.coupons150Redeemed ?? 0)
            await setDoc(
              userRef,
              { memberData: { coupons150Redeemed: currentRedeemed + count } },
              { merge: true },
            )
          }
        }
      }
    } catch {
      /* phoneToUid may not exist — fall through to legacy update */
    }

    // Step 2: also increment legacy members/{phone}.coupons150Redeemed
    try {
      const memberRef = doc(firestore, 'members', phone)
      const memberSnap = await getDoc(memberRef)
      if (memberSnap.exists()) {
        const data = memberSnap.data() as Record<string, unknown>
        const currentRedeemed = Number(data.coupons150Redeemed ?? 0)
        await setDoc(memberRef, { coupons150Redeemed: currentRedeemed + count }, { merge: true })
      }
    } catch {
      /* legacy member may not exist */
    }

    // Step 3: stamp the booking so retries are no-ops
    await setDoc(
      doc(firestore, 'bookings', orderNumber),
      { member150RedeemedAt: new Date(), member150RedeemedCount: count },
      { merge: true },
    )
  } catch (err) {
    logger.error('member.coupon_redeem_failed', err, { phone, count })
  }
}

export async function completeBillingOnPayment(orderNumber: string): Promise<void> {
  const firestore = db
  if (!firestore) return

  try {
    const bookingRef = doc(firestore, 'bookings', orderNumber)
    const snap = await getDoc(bookingRef)
    if (!snap.exists()) return
    const booking = snap.data() as Record<string, unknown>

    // Member ₹150 coupon redemption hook (gated on the MEMBER150xN sentinel
    // couponCode emitted by the Pipeline "Create Booking Link" flow). Runs
    // independently of the billing/serials path so a failure here never
    // blocks payment completion. Idempotent via `member150RedeemedAt`.
    await redeemMember150CouponsFromBooking(firestore, orderNumber, booking)

    // Already has serials → skip
    const existingItems = (booking.billingItems as BillingItem[]) || []
    const hasSerials = existingItems.some((i) => i.serialStart != null)
    if (hasSerials) {
      // Serials assigned, ensure vendor ledger exists
      if (existingItems.some((i) => (i.vendorTotal ?? 0) > 0)) {
        await writeVendorLedger(
          firestore,
          existingItems,
          orderNumber,
          String(booking.invoiceNumber || ''),
          toBranchId(String(booking.locationId || '')),
          nowIso().slice(0, 10),
        )
      }
      return
    }

    // No billing items yet → compute from scratch
    if (!booking.invoiceNumber) {
      const items = (booking.items as Array<Record<string, unknown>>) || []
      const finalAmount = Number(booking.finalAmount) || Number(booking.totalAmount) || 0
      if (finalAmount <= 0 || items.length === 0) return

      // Load catalog and resolve — uses branch-scoped composite keys so
      // shared variant labels across branches ("12 laps" exists in 6
      // branches/games, etc.) can't pick the wrong vendor.
      const catalog = await loadActivityCatalog(firestore)
      const branchSlug = String(booking.locationId || '').toLowerCase()
      const resolvedItems: ItemInput[] = items.map((item) => {
        const activity = (item.activity as Record<string, unknown>) || {}
        const activityId = String(activity.id || '')
        const activityName = String(activity.name || 'Activity')
        const itemGameId = (item as { gameId?: string }).gameId
        const itemSubGameId = (item as { subGameId?: string }).subGameId
        const itemVariantId = (item as { variantId?: string }).variantId
        const idParts = activityId.includes('-') ? activityId.split('-') : []
        const compositeFromIds =
          itemGameId && itemSubGameId && itemVariantId
            ? `${branchSlug}::${itemGameId}::${itemSubGameId}::${itemVariantId}`.toLowerCase()
            : ''
        const compositeFromActivityId =
          !compositeFromIds && idParts.length >= 3
            ? `${branchSlug}::${idParts.slice(0, -2).join('-')}::${idParts[idParts.length - 2]}::${idParts[idParts.length - 1]}`.toLowerCase()
            : ''
        const branchScopedNameKey = activityName
          ? `${branchSlug}::${activityName.toLowerCase()}`
          : ''
        const entry =
          catalog.get(activityId) ||
          (compositeFromIds ? catalog.get(compositeFromIds) : undefined) ||
          (compositeFromActivityId ? catalog.get(compositeFromActivityId) : undefined) ||
          (branchScopedNameKey ? catalog.get(branchScopedNameKey) : undefined) ||
          catalog.get(activityName.toLowerCase())
        return {
          itemName: activityName,
          quantity: Math.max(1, Number(item.quantity) || 1),
          unitPrice: Number(item.price) || 0,
          gameId: itemGameId || entry?.gameId,
          subGameId: itemSubGameId || entry?.subGameId,
          variantId: itemVariantId || entry?.variantId,
          vendorId: entry?.vendorId,
        }
      })

      const billing = await enrichItemsWithBilling(
        firestore,
        resolvedItems,
        finalAmount,
        Number(booking.discountAmount) || 0,
      )
      const branchId = toBranchId(String(booking.locationId ?? ''))
      const txnDate = nowIso().slice(0, 10)
      const invoiceNumber = generateOrderNumber()

      // Reserve serials (Go-Karting items only, matching the primary writer
      // at line ~929. Pre-fix this reserved counter slots for archery /
      // paintball / cricket too, burning go-kart token numbers.)
      try {
        const goKartIndices = billing.billingItems
          .map((item, idx) => ({ item, idx }))
          .filter(({ item }) => isGoKarting(item.itemName))
        if (goKartIndices.length > 0) {
          const serialStarts = await reserveSerialsForItems(
            firestore,
            branchId,
            txnDate,
            goKartIndices.map(({ item }) => item),
            invoiceNumber,
          )
          for (let j = 0; j < goKartIndices.length; j++) {
            billing.billingItems[goKartIndices[j].idx].serialStart = serialStarts[j]
          }
        }
      } catch {
        /* non-critical */
      }

      const billingFields = stripUndefined({
        invoiceNumber,
        baseAmount: billing.baseAmount,
        gstAmount: billing.gstAmount,
        gstPercent: GST_PERCENT,
        vendorId: billing.vendorId,
        vendorBase: billing.vendorTotal > 0 ? billing.vendorBase : undefined,
        vendorGst: billing.vendorTotal > 0 ? billing.vendorGst : undefined,
        vendorTotal: billing.vendorTotal > 0 ? billing.vendorTotal : undefined,
        companyBase: billing.companyBase,
        companyGst: billing.companyGst,
        companyTotal: billing.companyTotal,
        refundStatus: 'None',
        transactionDate: (() => {
          const ca = booking.createdAt
          if (ca && typeof ca === 'object' && 'toDate' in (ca as object)) {
            try {
              return (ca as { toDate: () => Date }).toDate().toISOString()
            } catch {
              /* fall through */
            }
          }
          if (typeof ca === 'string' && ca.includes('T')) return ca
          return nowIso()
        })(),
        visitDate: txnDate,
        handledBy: String(booking.createdByAdminName || booking.userDisplayName || 'Customer'),
        handledByRole: String(booking.createdByRole || 'customer'),
        billingItems: billing.billingItems.map((i) =>
          stripUndefined(i as unknown as Record<string, unknown>),
        ),
        billingSyncedAt: new Date(),
      } as Record<string, unknown>)

      await setDoc(bookingRef, billingFields, { merge: true })

      const userId = String(booking.userId || '')
      if (userId && !userId.startsWith('offline_')) {
        try {
          await setDoc(doc(firestore, `users/${userId}/bookings`, orderNumber), billingFields, {
            merge: true,
          })
        } catch {
          /* non-critical */
        }
      }

      if (billing.vendorTotal > 0) {
        await writeVendorLedger(
          firestore,
          billing.billingItems,
          orderNumber,
          invoiceNumber,
          branchId,
          txnDate,
        )
      }
      return
    }

    // Has invoiceNumber but no serials → reserve serials only.
    // This is the branch hit by customer-app drafts that were billing-complete
    // at creation (post-createDraftBooking-via-unified fix) — they already
    // have billingItems[] but no serials assigned, so we only reserve serials
    // for the go-kart line items and write the vendor ledger.
    const branchId = toBranchId(String(booking.locationId ?? ''))
    const txnDate = nowIso().slice(0, 10)
    const invoiceNumber = String(booking.invoiceNumber)

    try {
      const goKartIndices = existingItems
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => isGoKarting(item.itemName))
      let updatedItems = existingItems
      if (goKartIndices.length > 0) {
        const serialStarts = await reserveSerialsForItems(
          firestore,
          branchId,
          txnDate,
          goKartIndices.map(({ item }) => item),
          invoiceNumber,
        )
        updatedItems = existingItems.map((item, idx) => {
          const slot = goKartIndices.findIndex((g) => g.idx === idx)
          return slot >= 0 ? { ...item, serialStart: serialStarts[slot] } : item
        })
        await setDoc(
          bookingRef,
          {
            billingItems: updatedItems.map((i) =>
              stripUndefined(i as unknown as Record<string, unknown>),
            ),
          },
          { merge: true },
        )

        const userId = String(booking.userId || '')
        if (userId && !userId.startsWith('offline_')) {
          try {
            await setDoc(
              doc(firestore, `users/${userId}/bookings`, orderNumber),
              {
                billingItems: updatedItems.map((i) =>
                  stripUndefined(i as unknown as Record<string, unknown>),
                ),
              },
              { merge: true },
            )
          } catch {
            /* non-critical */
          }
        }
      }
    } catch {
      /* non-critical */
    }

    // Write vendor ledger
    if (existingItems.some((i) => (i.vendorTotal ?? 0) > 0)) {
      await writeVendorLedger(
        firestore,
        existingItems,
        orderNumber,
        invoiceNumber,
        branchId,
        txnDate,
      )
    }
  } catch (err) {
    // Bug 5 (silent failure): surface enrichment failures as logger.error
    // and stamp a marker on the booking so reconciliation can find it
    // without re-scanning every doc. Pre-fix the catch swallowed errors
    // as `warn`, which is why 65% of orphan paid bookings sat unnoticed.
    logger.error('unified_booking.complete_billing_on_payment_failed', err, { orderNumber })
    try {
      await setDoc(
        doc(firestore, 'bookings', orderNumber),
        { billingEnrichmentFailedAt: new Date() },
        { merge: true },
      )
    } catch {
      /* nothing more we can do */
    }
  }
}
