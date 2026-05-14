/**
 * Reconciliation API — surface and resolve orphan bookings.
 *
 * "Orphan" = a booking that completed payment but didn't go through the
 * full enrichment pipeline. Symptoms: items[] missing gameId/vendorId,
 * billingItems[] empty, vendorIds[] missing, no vendorLedger credits.
 *
 * The Reconciliation page reads these via `listOrphanBookings` and writes
 * resolutions via `resolveOrphanBooking`. Each resolution stamps an audit
 * trail at `reconciliationLog/{logId}` so the action is replayable.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { logger } from '../../lib/logger'

const BOOKINGS_COLLECTION = 'bookings'
const LEDGER_COLLECTION = 'vendorLedger'
const LOG_COLLECTION = 'reconciliationLog'
const GST_PERCENT = 18
const REFUND_DEBIT_SOURCES = new Set(['refund', 'refund-correction', 'refund-correction-reversal'])

export interface OrphanBooking {
  id: string
  date: string
  customerName: string
  customerPhone: string
  branchId: string
  finalAmount: number
  paymentStatus: string
  source: string
  items: Array<{
    itemName: string
    quantity: number
    unitPrice: number
    gameId?: string
    subGameId?: string
    variantId?: string
    vendorId?: string
  }>
  hasVendorIds: boolean
  hasBillingItems: boolean
  hasLedgerCredits: boolean
  enrichmentSource?: string
  /** Canonical per-line billing data when present. The Re-attribute flow
   *  pre-fills item drafts from this — billingItems are what the ledger
   *  trigger and audit pipeline already trust as truth. Same length /
   *  index correspondence as `items` is NOT guaranteed; the modal matches
   *  by variantId or itemName. */
  billingItems?: Array<{
    itemName: string
    quantity: number
    unitPrice: number
    gameId?: string
    subGameId?: string
    variantId?: string
    vendorId?: string
    vendorTotal?: number
    refunded?: boolean
  }>
  /** Sum of items[i].quantity × unitPrice before any discount. */
  subTotal?: number
  /** Total customer-facing discount applied (coupon + manual). */
  discountAmount?: number
  /** Coupon-specific portion of the discount (subset of discountAmount). */
  couponAmount?: number
  /** Coupon code applied at checkout, when present. */
  couponCode?: string
  /** Wallet/store-credit applied at checkout. */
  walletAmountUsed?: number
}

const dateOnly = (raw: unknown): string => {
  if (!raw) return ''
  if (
    typeof raw === 'object' &&
    raw &&
    typeof (raw as { toDate?: () => Date }).toDate === 'function'
  ) {
    try {
      return (raw as { toDate: () => Date }).toDate().toISOString().slice(0, 10)
    } catch {
      return ''
    }
  }
  const s = String(raw)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/**
 * Derive a true per-unit price for a booking item.
 *
 * The booking schema is messy: customer-app online stores `price` as the
 * LINE TOTAL (qty × basePrice), POS-via-unified-booking stores `unitPrice`
 * canonically per-unit, and older POS bookings store `price` sometimes
 * per-unit and sometimes as line total — there's no consistent rule
 * across all rows.
 *
 * Strategy:
 *   1. If `billingItems[]` is present and a row matches by variantId or
 *      itemName, use `billingItems[i].unitPrice` — it's the canonical
 *      per-unit price every downstream pipeline already uses.
 *   2. Else, if `unitPrice` is set on the item itself, use it.
 *   3. Else, sniff `price` against the booking's `subTotal` — if `Σ price`
 *      matches subTotal, treat `price` as line total (divide by qty);
 *      otherwise treat `price` as per-unit.
 *   4. Else fall back to `activity.basePrice`.
 */
const deriveUnitPrice = (
  it: Record<string, unknown>,
  ctx?: {
    billingItems?: Array<Record<string, unknown>>
    items?: Array<Record<string, unknown>>
    subTotal?: number
  },
): number => {
  const qty = Math.max(1, Math.floor(Number(it?.quantity) || 1))
  // 1. Match against billingItems by variantId or itemName when available.
  const billingItems = ctx?.billingItems ?? []
  if (billingItems.length > 0) {
    const variantId = typeof it?.variantId === 'string' ? it.variantId : ''
    const name = typeof it?.itemName === 'string' ? it.itemName : ''
    const match = billingItems.find((b) => {
      if (variantId && typeof b?.variantId === 'string' && b.variantId === variantId) return true
      if (name && typeof b?.itemName === 'string' && b.itemName === name) return true
      return false
    })
    if (match) {
      const u = Number(match.unitPrice)
      if (Number.isFinite(u) && u > 0) return u
    }
  }
  // 2. Item-level canonical unitPrice (POS unified-booking writes this).
  const unit = Number(it?.unitPrice)
  if (Number.isFinite(unit) && unit > 0) return unit
  // 3. Disambiguate `price` per-unit vs line-total via subTotal sanity.
  const lineTotal = Number(it?.price)
  if (Number.isFinite(lineTotal) && lineTotal > 0 && ctx?.items) {
    const sumIfLineTotals = ctx.items.reduce((s, x) => {
      const p = Number(x?.price)
      return s + (Number.isFinite(p) ? p : 0)
    }, 0)
    const sumIfPerUnit = ctx.items.reduce((s, x) => {
      const p = Number(x?.price)
      const q = Math.max(1, Math.floor(Number(x?.quantity) || 1))
      return s + (Number.isFinite(p) ? p * q : 0)
    }, 0)
    const subTotal = Number(ctx.subTotal) || 0
    if (subTotal > 0) {
      const diffLineTotals = Math.abs(sumIfLineTotals - subTotal)
      const diffPerUnit = Math.abs(sumIfPerUnit - subTotal)
      // Prefer the interpretation whose sum matches subTotal more closely.
      // `price / qty` for line-total, `price` for per-unit.
      if (diffLineTotals < diffPerUnit) return lineTotal / qty
      return lineTotal
    }
    // No subTotal to compare against — fall back to per-unit (safer for
    // qty=1 rows; both interpretations agree there).
    return qty === 1 ? lineTotal : lineTotal / qty
  }
  // 4. Catalog basePrice as last resort.
  const base = Number((it?.activity as { basePrice?: number } | undefined)?.basePrice)
  if (Number.isFinite(base) && base > 0) return base
  return 0
}

/**
 * Normalize a Firestore billingItems[] entry into the shape the resolver
 * UI consumes. Used by both listOrphanBookings and fetchBookingAsOrphan
 * so they emit the same shape; the modal's Re-attribute pre-fill logic
 * walks this list to populate drafts.
 */
const mapBillingItems = (raw: unknown): NonNullable<OrphanBooking['billingItems']> | undefined => {
  if (!Array.isArray(raw)) return undefined
  return (raw as Array<Record<string, unknown>>)
    .filter((b) => b && (typeof b.itemName === 'string' || typeof b.variantId === 'string'))
    .map((b) => ({
      itemName: typeof b.itemName === 'string' ? b.itemName : '',
      quantity: Math.max(1, Math.floor(Number(b.quantity) || 1)),
      unitPrice: Number(b.unitPrice) || 0,
      gameId: typeof b.gameId === 'string' ? b.gameId : undefined,
      subGameId: typeof b.subGameId === 'string' ? b.subGameId : undefined,
      variantId: typeof b.variantId === 'string' ? b.variantId : undefined,
      vendorId: typeof b.vendorId === 'string' && b.vendorId ? b.vendorId : undefined,
      vendorTotal: Number(b.vendorTotal) || 0,
      refunded: b.refunded === true,
    }))
}

const isItemOrphan = (item: Record<string, unknown>): boolean => {
  if (!item) return false
  const gameId = item.gameId
  if (typeof gameId === 'string' && gameId.trim() && gameId !== 'unknown') return false
  return true
}

/**
 * List bookings that have at least one item with no `gameId`. Reads the
 * full collection and filters in memory — the orphan count is small
 * enough that a full scan is fine and avoids the type-mismatch issues
 * Firestore inequality filters have on `gameId`.
 */
export const listOrphanBookings = async (): Promise<OrphanBooking[]> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const snap = await getDocs(collection(fs, BOOKINGS_COLLECTION))
  const out: OrphanBooking[] = []
  for (const d of snap.docs) {
    const data = d.data() || {}
    if (data.cancelled === true) continue
    if (data.deletedAt || data.voidedAt) continue
    if (data.paymentStatus && data.paymentStatus !== 'completed') continue
    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
    if (items.length === 0) continue
    const orphanItems = items.filter(isItemOrphan)
    if (orphanItems.length === 0) continue

    out.push({
      id: d.id,
      date: dateOnly(data.transactionDate ?? data.createdAt),
      customerName: String(data.customerName ?? data.userDisplayName ?? ''),
      customerPhone: String(data.customerPhone ?? data.userPhone ?? ''),
      branchId: String(data.locationId ?? ''),
      finalAmount: Number(data.finalAmount ?? data.totalAmount ?? 0),
      paymentStatus: String(data.paymentStatus ?? ''),
      source: String(data.source ?? ''),
      items: items.map((it) => ({
        itemName:
          (typeof it?.itemName === 'string' && it.itemName.trim()) ||
          (typeof (it?.activity as { name?: string })?.name === 'string' &&
            (it.activity as { name?: string }).name) ||
          '',
        quantity: Math.max(1, Math.floor(Number(it?.quantity) || 1)),
        unitPrice: deriveUnitPrice(it, {
          billingItems: Array.isArray(data.billingItems)
            ? (data.billingItems as Array<Record<string, unknown>>)
            : undefined,
          items,
          subTotal: Number(data.subTotal ?? data.totalAmount) || 0,
        }),
        gameId: typeof it?.gameId === 'string' ? it.gameId : undefined,
        subGameId: typeof it?.subGameId === 'string' ? it.subGameId : undefined,
        variantId: typeof it?.variantId === 'string' ? it.variantId : undefined,
        vendorId: typeof it?.vendorId === 'string' ? it.vendorId : undefined,
      })),
      hasVendorIds: Array.isArray(data.vendorIds) && (data.vendorIds as unknown[]).length > 0,
      hasBillingItems:
        Array.isArray(data.billingItems) && (data.billingItems as unknown[]).length > 0,
      hasLedgerCredits: false,
      enrichmentSource:
        typeof data.enrichmentSource === 'string' ? data.enrichmentSource : undefined,
      billingItems: mapBillingItems(data.billingItems),
      subTotal: Number(data.subTotal ?? data.totalAmount) || 0,
      discountAmount: Number(data.discountAmount) || 0,
      couponAmount: Number(data.couponAmount) || 0,
      couponCode: typeof data.couponCode === 'string' ? data.couponCode : undefined,
      walletAmountUsed: Number(data.walletAmountUsed) || 0,
    })
  }
  out.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

/**
 * Load a single booking by ID and shape it as an OrphanBooking so the
 * existing OrphanResolverModal can edit any booking — not just orphans.
 * Used by the Audit tab's "Re-attribute" action to re-pick vendors on
 * already-attributed bookings (wrong-vendor-stamp / unexplained-diff).
 */
export const fetchBookingAsOrphan = async (bookingId: string): Promise<OrphanBooking> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const ref = doc(fs, BOOKINGS_COLLECTION, bookingId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error(`Booking ${bookingId} not found.`)
  const data = snap.data() || {}
  const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
  return {
    id: snap.id,
    date: dateOnly(data.transactionDate ?? data.createdAt),
    customerName: String(data.customerName ?? data.userDisplayName ?? ''),
    customerPhone: String(data.customerPhone ?? data.userPhone ?? ''),
    branchId: String(data.locationId ?? ''),
    finalAmount: Number(data.finalAmount ?? data.totalAmount ?? 0),
    paymentStatus: String(data.paymentStatus ?? ''),
    source: String(data.source ?? ''),
    items: items.map((it) => ({
      itemName:
        (typeof it?.itemName === 'string' && it.itemName.trim()) ||
        (typeof (it?.activity as { name?: string })?.name === 'string' &&
          (it.activity as { name?: string }).name) ||
        '',
      quantity: Math.max(1, Math.floor(Number(it?.quantity) || 1)),
      unitPrice: deriveUnitPrice(it, {
        billingItems: Array.isArray(data.billingItems)
          ? (data.billingItems as Array<Record<string, unknown>>)
          : undefined,
        items,
        subTotal: Number(data.subTotal ?? data.totalAmount) || 0,
      }),
      gameId: typeof it?.gameId === 'string' ? it.gameId : undefined,
      subGameId: typeof it?.subGameId === 'string' ? it.subGameId : undefined,
      variantId: typeof it?.variantId === 'string' ? it.variantId : undefined,
      vendorId: typeof it?.vendorId === 'string' ? it.vendorId : undefined,
    })),
    hasVendorIds: Array.isArray(data.vendorIds) && (data.vendorIds as unknown[]).length > 0,
    hasBillingItems:
      Array.isArray(data.billingItems) && (data.billingItems as unknown[]).length > 0,
    hasLedgerCredits: false,
    enrichmentSource: typeof data.enrichmentSource === 'string' ? data.enrichmentSource : undefined,
    billingItems: mapBillingItems(data.billingItems),
    subTotal: Number(data.subTotal ?? data.totalAmount) || 0,
    discountAmount: Number(data.discountAmount) || 0,
    couponAmount: Number(data.couponAmount) || 0,
    couponCode: typeof data.couponCode === 'string' ? data.couponCode : undefined,
    walletAmountUsed: Number(data.walletAmountUsed) || 0,
  }
}

export interface ResolutionInput {
  bookingId: string
  branchId: string
  date: string
  items: Array<{
    itemName: string
    quantity: number
    unitPrice: number
    gameId?: string
    subGameId?: string
    variantId?: string
    /**
     * 'company'    no vendor, ledger credit not written.
     * 'thirdParty' vendor gets share% of base + share% of GST.
     * 'subLease'   vendor gets share% of base ONLY; company keeps all GST
     *              + (1-share)% of base.
     */
    type: 'company' | 'thirdParty' | 'subLease'
    vendorId?: string
    sharePercentOverride?: number
  }>
  resolvedBy: { id: string; name: string }
  notes?: string
}

export interface ResolutionResult {
  bookingId: string
  vendorIds: string[]
  ledgerEntriesWritten: number
  totalCredited: number
}

/**
 * Compute and write the resolution to Firestore. Stamps:
 *   - bookings/{id}: billingItems[], vendorIds[], items[i].gameId/...,
 *     enrichmentSource: 'admin-reconciliation', enrichmentResolvedBy,
 *     enrichmentResolvedAt
 *   - vendorLedger/le-{id}-{vendorId}: one credit row per vendor
 *   - reconciliationLog/{logId}: audit trail
 *
 * Idempotent — re-applying the same resolution is a no-op (canonical doc
 * IDs collide and `set { merge: true }` writes the same payload).
 */
export const resolveOrphanBooking = async (input: ResolutionInput): Promise<ResolutionResult> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')

  // Resolve vendor share rates for any vendor not given a sharePercentOverride.
  const vendorIdsNeedingShare = [
    ...new Set(
      input.items
        .filter(
          (i) =>
            (i.type === 'thirdParty' || i.type === 'subLease') &&
            i.vendorId &&
            i.sharePercentOverride === undefined,
        )
        .map((i) => i.vendorId as string),
    ),
  ]
  const vendorShares = new Map<string, number>()
  await Promise.all(
    vendorIdsNeedingShare.map(async (vid) => {
      try {
        const snap = await getDoc(doc(fs, 'vendorDetails', vid))
        if (snap.exists()) {
          const data = snap.data() as Record<string, unknown>
          const share = typeof data.revenueShare === 'number' ? data.revenueShare : 80
          vendorShares.set(vid, Math.min(100, Math.max(0, share)))
        } else {
          vendorShares.set(vid, 80)
        }
      } catch {
        vendorShares.set(vid, 80)
      }
    }),
  )

  // Compute billingItems with splits.
  // ThirdParty: vendor gets share% of base + share% of GST.
  // SubLease:   vendor gets share% of base ONLY; company keeps all GST.
  // Company:    no vendor; full base + gst stays with company.
  const billingItems = input.items.map((it) => {
    const qty = Math.max(1, Math.floor(it.quantity))
    const unitPrice = Math.max(0, it.unitPrice)
    const itemTotal = qty * unitPrice
    const itemBaseAmount = Math.round((itemTotal * 100) / (100 + GST_PERCENT))
    const itemGstAmount = itemTotal - itemBaseAmount
    if (it.type === 'company' || !it.vendorId) {
      return {
        itemName: it.itemName,
        gameId: it.gameId ?? '',
        subGameId: it.subGameId ?? '',
        variantId: it.variantId ?? '',
        quantity: qty,
        unitPrice,
        itemBaseAmount,
        itemGstAmount,
        vendorBase: 0,
        vendorGst: 0,
        vendorTotal: 0,
        companyBase: itemBaseAmount,
        companyGst: itemGstAmount,
        companyTotal: itemBaseAmount + itemGstAmount,
      }
    }
    const share =
      it.sharePercentOverride !== undefined
        ? Math.min(100, Math.max(0, it.sharePercentOverride))
        : (vendorShares.get(it.vendorId) ?? 80)
    const vendorBase = Math.round((itemBaseAmount * share) / 100)
    const vendorGst = it.type === 'subLease' ? 0 : Math.round((itemGstAmount * share) / 100)
    const vendorTotal = vendorBase + vendorGst
    const companyBase = itemBaseAmount - vendorBase
    const companyGst = itemGstAmount - vendorGst
    return {
      itemName: it.itemName,
      gameId: it.gameId ?? '',
      subGameId: it.subGameId ?? '',
      variantId: it.variantId ?? '',
      vendorId: it.vendorId,
      vendorType: it.type === 'subLease' ? 'SubLease' : 'ThirdParty',
      quantity: qty,
      unitPrice,
      itemBaseAmount,
      itemGstAmount,
      vendorSharePercent: share,
      vendorBase,
      vendorGst,
      vendorTotal,
      companyBase,
      companyGst,
      companyTotal: companyBase + companyGst,
    }
  })

  // Aggregate per vendor for ledger.
  const ledgerByVendor = new Map<
    string,
    { vendorBase: number; vendorGst: number; vendorTotal: number }
  >()
  for (const bi of billingItems) {
    if (!('vendorId' in bi) || !bi.vendorId || (bi.vendorTotal ?? 0) <= 0) continue
    const acc = ledgerByVendor.get(bi.vendorId) ?? { vendorBase: 0, vendorGst: 0, vendorTotal: 0 }
    acc.vendorBase += bi.vendorBase
    acc.vendorGst += bi.vendorGst
    acc.vendorTotal += bi.vendorTotal
    ledgerByVendor.set(bi.vendorId, acc)
  }

  const vendorIds = [...ledgerByVendor.keys()].sort()
  const totalCredited = [...ledgerByVendor.values()].reduce((s, v) => s + v.vendorTotal, 0)

  // Write booking patch.
  const itemsPatch = input.items.map((it) => ({
    itemName: it.itemName,
    quantity: Math.max(1, Math.floor(it.quantity)),
    unitPrice: Math.max(0, it.unitPrice),
    price: Math.max(1, Math.floor(it.quantity)) * Math.max(0, it.unitPrice),
    gameId: it.gameId ?? '',
    subGameId: it.subGameId ?? '',
    variantId: it.variantId ?? '',
    vendorId: it.type === 'company' ? '' : (it.vendorId ?? ''),
  }))

  const nowIso = new Date().toISOString()
  // Soft-mode pre-flight validation: log drift but don't block the
  // resolver. Admin needs to be able to apply fixes even when the
  // cart-total or vendor-sync invariants are slightly off — those
  // sub-failures often coexist with the orphan they're trying to fix.
  try {
    const { validateBooking } = await import('../../lib/booking-validator')
    const validation = validateBooking({
      id: input.bookingId,
      items: itemsPatch,
      billingItems,
      vendorIds,
    })
    if (!validation.ok) {
      logger.warn('reconciliation.invariants_drift', {
        bookingId: input.bookingId,
        failures: validation.failures.map((f) => f.code),
      })
    }
  } catch {
    /* validator import failure is non-fatal — write proceeds */
  }
  await setDoc(
    doc(fs, BOOKINGS_COLLECTION, input.bookingId),
    {
      items: itemsPatch,
      billingItems,
      vendorIds,
      enrichmentSource: 'admin-reconciliation',
      enrichmentResolvedBy: input.resolvedBy.id,
      enrichmentResolvedByName: input.resolvedBy.name,
      enrichmentResolvedAt: nowIso,
      ...(input.notes ? { reconciliationNotes: input.notes } : {}),
    },
    { merge: true },
  )

  // Write ledger credits.
  //
  // Before writing the canonical `le-{bid}-{vid}` row, delete any
  // pre-existing `lc-manual-{bid}-{vid}` for the same pair. Otherwise,
  // when an admin first clicks "Write credit" (which writes lc-manual)
  // and THEN re-attributes via the orphan resolver (which writes le),
  // both rows survive and stack — double-crediting the vendor. The
  // canonical le-row IS the source of truth; the manual fix that
  // preceded it is now redundant. Reconciliation `lc-reconcile-…` rows
  // are NOT deleted because they're meant to additively stack.
  let ledgerEntriesWritten = 0
  for (const [vid, acc] of ledgerByVendor.entries()) {
    if (acc.vendorTotal <= 0) continue
    const ledgerId = `le-${input.bookingId}-${vid}`
    try {
      // Best-effort cleanup of stale manual fix for the same (booking, vendor)
      const staleManualId = `lc-manual-${input.bookingId}-${vid}`
      try {
        const staleSnap = await getDoc(doc(fs, LEDGER_COLLECTION, staleManualId))
        if (staleSnap.exists()) {
          await deleteDoc(doc(fs, LEDGER_COLLECTION, staleManualId))
        }
      } catch {
        /* cleanup is best-effort — proceed with the canonical write */
      }
      await setDoc(
        doc(fs, LEDGER_COLLECTION, ledgerId),
        {
          id: ledgerId,
          vendorId: vid,
          vendorBase: acc.vendorBase,
          vendorGst: acc.vendorGst,
          amount: acc.vendorTotal,
          type: 'credit',
          referenceId: input.bookingId,
          invoiceNumber: input.bookingId,
          locationId: input.branchId,
          date: input.date ? `${input.date}T12:00:00.000Z` : nowIso,
          createdAt: nowIso,
          source: 'admin-reconciliation',
        },
        { merge: true },
      )
      ledgerEntriesWritten++
    } catch (err) {
      // Silent half-write here used to permanently lose vendor credits — the
      // booking was marked enrichmentSource='admin-reconciliation' so it no
      // longer appeared in the orphan scan, but the vendor never got their
      // ledger entry. Surface to Sentry / Crashlytics via the structured
      // logger so the gap can be retried.
      logger.error('reconciliation.ledger_write_failed', err, {
        ledgerId,
        bookingId: input.bookingId,
      })
    }
  }

  // Audit log. Firestore rejects `undefined` anywhere in the payload, so
  // strip it from the items[] array before writing — each item may have
  // optional gameId/subGameId/variantId/vendorId/sharePercentOverride that
  // are undefined when the admin didn't pick one.
  const stripUndef = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue
      out[k] = v
    }
    return out
  }
  const logId = `${input.bookingId}_${Date.now()}`
  await setDoc(doc(fs, LOG_COLLECTION, logId), {
    id: logId,
    bookingId: input.bookingId,
    resolvedBy: input.resolvedBy.id,
    resolvedByName: input.resolvedBy.name,
    resolvedAt: nowIso,
    notes: input.notes ?? null,
    vendorIds,
    totalCredited,
    items: input.items.map((it) => stripUndef(it as unknown as Record<string, unknown>)),
  })

  return {
    bookingId: input.bookingId,
    vendorIds,
    ledgerEntriesWritten,
    totalCredited,
  }
}

/**
 * Walk the canonical catalog (`locations/{branch}/games/.../variants`)
 * and return a flat list usable for the resolver dropdown.
 */
export interface CatalogOption {
  branchId: string
  gameId: string
  gameName: string
  subGameId: string
  subGameName: string
  variantId: string
  variantLabel: string
  vendorId?: string
  composedLabel: string
}

export const listCatalogOptions = async (): Promise<CatalogOption[]> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')

  // Parallelise the hierarchy walk. The previous sequential version did
  // ~ branches × games × subgames serial round-trips and was the slowest
  // call on the page. Now we fan out at every level via Promise.all so
  // the whole catalog loads in roughly one round-trip per level.
  const locsSnap = await getDocs(collection(fs, 'locations'))
  const branchResults = await Promise.all(
    locsSnap.docs.map(async (locDoc) => {
      const branchId = locDoc.id
      const gamesSnap = await getDocs(collection(fs, 'locations', branchId, 'games'))
      const gameResults = await Promise.all(
        gamesSnap.docs.map(async (gameDoc) => {
          const gameData = gameDoc.data() as Record<string, unknown>
          const gameName = String(gameData.name || gameData.gameName || gameDoc.id)
          const subgamesSnap = await getDocs(
            collection(fs, 'locations', branchId, 'games', gameDoc.id, 'subgames'),
          )
          const subResults = await Promise.all(
            subgamesSnap.docs.map(async (subDoc) => {
              const subData = subDoc.data() as Record<string, unknown>
              const subGameName = String(subData.name || subData.subGameName || subDoc.id)
              const variantsSnap = await getDocs(
                collection(
                  fs,
                  'locations',
                  branchId,
                  'games',
                  gameDoc.id,
                  'subgames',
                  subDoc.id,
                  'variants',
                ),
              )
              return variantsSnap.docs.map((varDoc) => {
                const varData = varDoc.data() as Record<string, unknown>
                // Variant docs in this codebase use `label` (canonical). Older
                // ones use `name` or `variantLabel`. Final fallback to the
                // variant ID prevents an empty composedLabel; always prefer
                // the human label so catalog name lookups land.
                const variantLabel = String(
                  varData.label || varData.name || varData.variantLabel || varDoc.id,
                )
                const vendorId =
                  (typeof varData.vendorId === 'string' && varData.vendorId) ||
                  (typeof subData.vendorId === 'string' && subData.vendorId) ||
                  (typeof gameData.vendorId === 'string' && gameData.vendorId) ||
                  ''
                return {
                  branchId,
                  gameId: gameDoc.id,
                  gameName,
                  subGameId: subDoc.id,
                  subGameName,
                  variantId: varDoc.id,
                  variantLabel,
                  vendorId: vendorId || undefined,
                  composedLabel: `${gameName} • ${subGameName} • ${variantLabel}`,
                } as CatalogOption
              })
            }),
          )
          return subResults.flat()
        }),
      )
      return gameResults.flat()
    }),
  )
  return branchResults.flat()
}

export interface VendorOption {
  id: string
  name: string
  branch: string
  branchId: string
  vendorType: string
  preferredActivity: string
  revenueShare: number
}

export interface EventPackageOption {
  /** Distinguishes event-campaign packages from POS combos in the picker. */
  kind: 'event-package' | 'combo'
  campaignId: string
  campaignSlug: string
  campaignName: string
  packageId: string
  packageName: string
  /** Branch the package is configured for (e.g. "0", "1", "kakinada"). */
  locationKey: string
  /** Provenance — which Firestore collection the truth was loaded from
   *  and the doc ID. Surfaced in the Fan-out picker so admin can verify
   *  exactly which combo/campaign doc supplied the data. */
  truthCollection: 'combos' | 'eventCampaigns'
  truthDocId: string
  /** For event packages, the package ID inside the campaign doc. Empty
   *  for combos (the doc itself is the package). */
  truthPackageId: string
  items: Array<{
    name: string
    vendorId: string
    type: 'thirdParty' | 'company'
    revenueShare: boolean
    configPrice: number
    /** Catalog identifiers — propagated to fanned-out item drafts so they
     *  don't get written back as orphans. Only populated for combos today;
     *  event packages don't carry these on their items. */
    gameId?: string
    subGameId?: string
    variantId?: string
    activityId?: string
    /** Where the catalog IDs (gameId/subGameId/variantId) on this row
     *  originated. `combo-doc` = stored on the combos doc itself.
     *  `synthesized-slug` = synthesized from the campaign + package + item
     *  names because eventCampaigns doesn't carry catalog IDs.
     *  `none` = no IDs supplied (rare). */
    truthSource: 'combo-doc' | 'synthesized-slug' | 'none'
  }>
}

/**
 * List every EventCampaign package with its items, vendor IDs, revenue
 * share flag, and configured prices. Used by the resolver's "Fan out
 * from package" action so an admin can expand a single combo line into
 * one row per package item.
 */
export const listEventPackageOptions = async (): Promise<EventPackageOption[]> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const [campaignSnap, combosSnap] = await Promise.all([
    getDocs(collection(fs, 'eventCampaigns')),
    getDocs(collection(fs, 'combos')),
  ])
  const out: EventPackageOption[] = []
  // Event-campaign packages
  campaignSnap.forEach((d) => {
    const c = d.data() as Record<string, unknown>
    const packages = Array.isArray(c.packages) ? (c.packages as Array<Record<string, unknown>>) : []
    for (const pkg of packages) {
      const items = Array.isArray(pkg.items) ? (pkg.items as Array<Record<string, unknown>>) : []
      // Schema check: packages use `title` for the human-facing name and
      // `locationKey` for the branch they apply to. Campaigns also use
      // `title`. Fall back to the legacy `name` field defensively in case
      // any old docs still have it.
      out.push({
        kind: 'event-package',
        campaignId: d.id,
        campaignSlug: String(c.slug ?? d.id),
        campaignName: String(c.title ?? c.name ?? c.slug ?? d.id),
        packageId: String(pkg.id ?? ''),
        packageName: String(pkg.title ?? pkg.name ?? pkg.id ?? '(unnamed package)'),
        locationKey: String(pkg.locationKey ?? ''),
        truthCollection: 'eventCampaigns',
        truthDocId: d.id,
        truthPackageId: String(pkg.id ?? ''),
        items: items
          .filter((i) => i && typeof i.name === 'string' && i.name)
          .map((i) => ({
            name: String(i.name),
            vendorId: typeof i.vendorId === 'string' ? i.vendorId.trim() : '',
            type: i.type === 'company' ? 'company' : 'thirdParty',
            revenueShare: typeof i.revenueShare === 'boolean' ? i.revenueShare : true,
            configPrice: Number(i.price) || 0,
            // eventCampaigns docs don't carry catalog IDs on items — the
            // resolver synthesizes them from slugged campaign+pkg+item.
            truthSource: 'synthesized-slug' as const,
          })),
      })
    }
  })
  // POS combos — stored in the `combos` collection, one doc per combo.
  // Items already carry the company-bundle-discount-adjusted `adjustedPrice`
  // which we use as `configPrice` so per-item splits run against the price
  // the customer actually paid for that line.
  combosSnap.forEach((d) => {
    const c = d.data() as Record<string, unknown>
    if (c.status && c.status !== 'Active') return
    const items = Array.isArray(c.items) ? (c.items as Array<Record<string, unknown>>) : []
    if (items.length === 0) return
    const name = String(c.name ?? d.id)
    out.push({
      kind: 'combo',
      campaignId: `combo:${d.id}`,
      campaignSlug: `combo:${d.id}`,
      campaignName: 'Combos',
      packageId: d.id,
      packageName: name,
      locationKey: String(c.locationKey ?? ''),
      truthCollection: 'combos',
      truthDocId: d.id,
      truthPackageId: '',
      items: items
        .filter((i) => i && typeof i.itemName === 'string' && i.itemName)
        .map((i) => {
          const vid = typeof i.vendorId === 'string' ? i.vendorId.trim() : ''
          const gameId = typeof i.gameId === 'string' ? i.gameId : undefined
          const subGameId = typeof i.subGameId === 'string' ? i.subGameId : undefined
          return {
            name: String(i.itemName),
            vendorId: vid,
            type: vid ? ('thirdParty' as const) : ('company' as const),
            revenueShare: true,
            configPrice:
              Number(i.adjustedPrice) > 0 ? Number(i.adjustedPrice) : Number(i.originalPrice) || 0,
            gameId,
            subGameId,
            variantId: typeof i.variantId === 'string' ? i.variantId : undefined,
            activityId: typeof i.activityId === 'string' ? i.activityId : undefined,
            // Combos store catalog IDs directly on the doc — when present.
            truthSource: gameId && subGameId ? ('combo-doc' as const) : ('none' as const),
          }
        }),
    })
  })
  return out
}

export interface RefundCorrection {
  bookingId: string
  vendorId: string
  vendorName?: string
  bookingDate: string
  invoiceNumber: string
  locationId: string
  expected: number
  actual: number
  delta: number
  direction: 'add-debit' | 'reverse-debit'
}

const dateOnlyForLedger = (raw: unknown): string => {
  if (!raw) return ''
  if (
    typeof raw === 'object' &&
    raw &&
    typeof (raw as { toDate?: () => Date }).toDate === 'function'
  ) {
    try {
      return (raw as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return ''
    }
  }
  const s = String(raw)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00.000Z`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

const computeCorrectDebits = (
  booking: Record<string, unknown>,
): Map<string, { vendorBase: number; vendorGst: number; vendorTotal: number }> => {
  const items = Array.isArray(booking.items)
    ? (booking.items as Array<Record<string, unknown>>)
    : []
  const billingItems = Array.isArray(booking.billingItems)
    ? (booking.billingItems as Array<Record<string, unknown>>)
    : []
  const attribution = new Map<
    string,
    { vendorId: string; vendorBase: number; vendorGst: number; vendorTotal: number }
  >()
  for (const b of billingItems) {
    if (!b) continue
    const variantId = String(b.variantId ?? '')
    if (!variantId) continue
    attribution.set(variantId, {
      vendorId: String(b.vendorId ?? ''),
      vendorBase: Number(b.vendorBase) || 0,
      vendorGst: Number(b.vendorGst) || 0,
      vendorTotal: Number(b.vendorTotal) || 0,
    })
  }
  const debits = new Map<string, { vendorBase: number; vendorGst: number; vendorTotal: number }>()
  for (const item of items) {
    if (!item || item.refunded !== true) continue
    let vendorId = String(item.vendorId ?? '')
    let vendorBase = Number(item.vendorBase) || 0
    let vendorGst = Number(item.vendorGst) || 0
    let vendorTotal = Number(item.vendorTotal) || 0
    if (!vendorId || vendorTotal <= 0) {
      const attr = attribution.get(String(item.variantId ?? ''))
      if (attr) {
        vendorId = attr.vendorId
        vendorBase = attr.vendorBase
        vendorGst = attr.vendorGst
        vendorTotal = attr.vendorTotal
      }
    }
    if (!vendorId || vendorTotal <= 0) continue
    const acc = debits.get(vendorId) ?? { vendorBase: 0, vendorGst: 0, vendorTotal: 0 }
    acc.vendorBase += vendorBase
    acc.vendorGst += vendorGst
    acc.vendorTotal += vendorTotal
    debits.set(vendorId, acc)
  }
  return debits
}

/**
 * Compute every (booking, vendor) refund-debit correction the system
 * needs. Mirrors `scripts/reconcile-vendor-refund-debits.cjs` /
 * `apply-vendor-refund-corrections.cjs`. Each row tells us the difference
 * between what `vendorLedger` currently shows for a refund debit and what
 * `items[].refunded === true` says it should be.
 *
 * Read-only.
 */
export const listRefundCorrections = async (): Promise<RefundCorrection[]> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')

  // 1. Vendor names for the table.
  const vendorMeta = new Map<string, string>()
  const vSnap = await getDocs(collection(fs, 'vendorDetails'))
  vSnap.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    vendorMeta.set(d.id, String(data.vendorName || data.userName || d.id))
  })

  // 2. Refunded bookings (Partial + Full).
  const [partial, full] = await Promise.all([
    getDocs(query(collection(fs, BOOKINGS_COLLECTION), where('refundStatus', '==', 'Partial'))),
    getDocs(query(collection(fs, BOOKINGS_COLLECTION), where('refundStatus', '==', 'Full'))),
  ])
  const refundedDocs = [...partial.docs, ...full.docs].filter((d) => {
    const data = d.data() as Record<string, unknown>
    return Number(data.refundAmount) > 0
  })

  const corrections: RefundCorrection[] = []
  for (const snap of refundedDocs) {
    const data = snap.data() as Record<string, unknown>
    const correct = computeCorrectDebits(data)

    const ledgerSnap = await getDocs(
      query(collection(fs, LEDGER_COLLECTION), where('referenceId', '==', snap.id)),
    )
    const actual = new Map<string, number>()
    ledgerSnap.forEach((ld) => {
      const r = ld.data() as Record<string, unknown>
      const vid = String(r.vendorId ?? '')
      if (!vid) return
      const isRefundDebit = r.type === 'debit' && REFUND_DEBIT_SOURCES.has(String(r.source ?? ''))
      const isReversal =
        r.type === 'credit' && String(r.source ?? '') === 'refund-correction-reversal'
      const amt = Number(r.amount) || 0
      if (isRefundDebit) actual.set(vid, (actual.get(vid) ?? 0) + amt)
      else if (isReversal) actual.set(vid, (actual.get(vid) ?? 0) - amt)
    })

    const allVids = new Set([...correct.keys(), ...actual.keys()])
    for (const vid of allVids) {
      const expected = correct.get(vid)?.vendorTotal ?? 0
      const actualAmt = actual.get(vid) ?? 0
      const delta = expected - actualAmt
      if (delta === 0) continue
      corrections.push({
        bookingId: snap.id,
        vendorId: vid,
        vendorName: vendorMeta.get(vid),
        bookingDate: dateOnlyForLedger(data.transactionDate ?? data.createdAt ?? data.sessionDate),
        invoiceNumber:
          (typeof data.invoiceNumber === 'string' && data.invoiceNumber) ||
          (typeof data.billingId === 'string' && data.billingId) ||
          snap.id,
        locationId: String(data.locationId ?? ''),
        expected,
        actual: actualAmt,
        delta,
        direction: delta > 0 ? 'add-debit' : 'reverse-debit',
      })
    }
  }

  corrections.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return corrections
}

export interface RefundReviewContext {
  bookingId: string
  date: string
  source: string
  branchId: string
  paymentStatus: string
  refundStatus: string
  refundAmount: number
  finalAmount: number
  customerName: string
  customerPhone: string
  invoiceNumber: string
  items: Array<{
    itemName: string
    gameId: string
    subGameId: string
    variantId: string
    vendorId: string
    quantity: number
    unitPrice: number
    refunded: boolean
    vendorBase: number
    vendorGst: number
    vendorTotal: number
  }>
  billingItems: Array<{
    itemName: string
    gameId: string
    subGameId: string
    variantId: string
    vendorId: string
    quantity: number
    unitPrice: number
    refunded: boolean
    vendorBase: number
    vendorGst: number
    vendorTotal: number
  }>
  ledgerEntries: Array<{
    id: string
    vendorId: string
    type: string
    source: string
    amount: number
    date: string
  }>
}

const itemNumber = (v: unknown): number => Number(v) || 0
const itemString = (v: unknown): string => (typeof v === 'string' ? v : '')

const mapBookingItem = (raw: unknown) => {
  const it = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >
  const activity = (
    it.activity && typeof it.activity === 'object' ? (it.activity as Record<string, unknown>) : {}
  ) as Record<string, unknown>
  return {
    itemName:
      itemString(it.itemName) ||
      itemString(activity.name) ||
      itemString(activity.bookingName) ||
      '',
    gameId: itemString(it.gameId),
    subGameId: itemString(it.subGameId),
    variantId: itemString(it.variantId),
    vendorId: itemString(it.vendorId),
    quantity: Math.max(1, Math.floor(itemNumber(it.quantity) || 1)),
    unitPrice: itemNumber(it.unitPrice ?? it.price),
    refunded: it.refunded === true,
    vendorBase: itemNumber(it.vendorBase),
    vendorGst: itemNumber(it.vendorGst),
    vendorTotal: itemNumber(it.vendorTotal),
  }
}

/**
 * Pull the full review context for a booking — items, billingItems, the
 * refund header info, plus every vendorLedger entry that references the
 * booking. Used by the refund-correction review modal so the admin can
 * see exactly which items were refunded and what's currently in the
 * ledger before deciding to apply each per-vendor correction.
 */
export const fetchRefundReviewContext = async (bookingId: string): Promise<RefundReviewContext> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const snap = await getDoc(doc(fs, BOOKINGS_COLLECTION, bookingId))
  if (!snap.exists()) throw new Error(`Booking ${bookingId} not found.`)
  const data = snap.data() as Record<string, unknown>
  const items = Array.isArray(data.items) ? data.items.map(mapBookingItem) : []
  const billingItems = Array.isArray(data.billingItems) ? data.billingItems.map(mapBookingItem) : []
  const ledgerSnap = await getDocs(
    query(collection(fs, LEDGER_COLLECTION), where('referenceId', '==', bookingId)),
  )
  const ledgerEntries = ledgerSnap.docs.map((d) => {
    const r = d.data() as Record<string, unknown>
    return {
      id: d.id,
      vendorId: itemString(r.vendorId),
      type: itemString(r.type),
      source: itemString(r.source),
      amount: itemNumber(r.amount),
      date: itemString(r.date),
    }
  })
  ledgerEntries.sort((a, b) => a.vendorId.localeCompare(b.vendorId) || a.type.localeCompare(b.type))
  return {
    bookingId,
    date: itemString(data.transactionDate ?? data.createdAt),
    source: itemString(data.source),
    branchId: itemString(data.locationId),
    paymentStatus: itemString(data.paymentStatus),
    refundStatus: itemString(data.refundStatus),
    refundAmount: itemNumber(data.refundAmount),
    finalAmount: itemNumber(data.finalAmount ?? data.totalAmount),
    customerName: itemString(data.customerName ?? data.userDisplayName),
    customerPhone: itemString(data.customerPhone ?? data.userPhone),
    invoiceNumber: itemString(data.invoiceNumber ?? data.billingId) || bookingId,
    items,
    billingItems,
    ledgerEntries,
  }
}

export interface RefundFlagPatch {
  /** Index in items[] to update. */
  itemIndex: number
  /** New refunded value. */
  refunded: boolean
}

/**
 * Flip the `refunded` flag on specific items[] entries (and the matching
 * billingItems[] entries, by variantId) for a booking. Used by the
 * Refund Review modal when admin discovers the system marked the wrong
 * activity as refunded — they can correct the source-of-truth flag here
 * and the proposed correction recomputes.
 *
 * `patches` is keyed by index into the booking's items[] (the modal owns
 * that ordering). `billingItems[]` is patched by matching `variantId` so
 * the two arrays stay in sync.
 */
export const updateBookingRefundFlags = async (
  bookingId: string,
  patches: RefundFlagPatch[],
  resolvedBy: { id: string; name: string },
): Promise<void> => {
  if (patches.length === 0) return
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const ref = doc(fs, BOOKINGS_COLLECTION, bookingId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error(`Booking ${bookingId} not found.`)
  const data = snap.data() as Record<string, unknown>
  const items = Array.isArray(data.items) ? [...(data.items as Array<Record<string, unknown>>)] : []
  const billingItems = Array.isArray(data.billingItems)
    ? [...(data.billingItems as Array<Record<string, unknown>>)]
    : []

  const before = items.map((it) => ({
    itemName: typeof it?.itemName === 'string' ? it.itemName : '',
    refunded: it?.refunded === true,
  }))

  // Build a variantId → refunded map from the patches so we can sync
  // billingItems[] regardless of order.
  const variantTargets = new Map<string, boolean>()

  for (const p of patches) {
    const target = items[p.itemIndex]
    if (!target || typeof target !== 'object') continue
    items[p.itemIndex] = { ...target, refunded: p.refunded === true }
    const variantId = typeof target.variantId === 'string' ? target.variantId.trim() : ''
    if (variantId) variantTargets.set(variantId, p.refunded === true)
  }

  for (let i = 0; i < billingItems.length; i++) {
    const bi = billingItems[i]
    if (!bi || typeof bi !== 'object') continue
    const variantId = typeof bi.variantId === 'string' ? bi.variantId.trim() : ''
    if (!variantId || !variantTargets.has(variantId)) continue
    billingItems[i] = { ...bi, refunded: variantTargets.get(variantId) === true }
  }

  await setDoc(ref, { items, billingItems }, { merge: true })

  const nowIso = new Date().toISOString()
  const logId = `${bookingId}_refundflags_${Date.now()}`
  await setDoc(doc(fs, LOG_COLLECTION, logId), {
    id: logId,
    bookingId,
    kind: 'refund-flag-edit',
    resolvedBy: resolvedBy.id,
    resolvedByName: resolvedBy.name,
    resolvedAt: nowIso,
    patches: patches.map((p) => ({
      itemIndex: p.itemIndex,
      itemName:
        items[p.itemIndex] && typeof items[p.itemIndex] === 'object'
          ? String((items[p.itemIndex] as Record<string, unknown>).itemName ?? '')
          : '',
      from: before[p.itemIndex]?.refunded ?? false,
      to: p.refunded === true,
    })),
  })
}

/**
 * Recompute refund-debit corrections for a single booking. Faster than
 * `listRefundCorrections()` (which scans every refunded booking) — used
 * by the modal after editing refund flags.
 */
export const recomputeBookingRefundCorrections = async (
  bookingId: string,
): Promise<RefundCorrection[]> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')

  const vendorMeta = new Map<string, string>()
  const vSnap = await getDocs(collection(fs, 'vendorDetails'))
  vSnap.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    vendorMeta.set(d.id, String(data.vendorName || data.userName || d.id))
  })

  const snap = await getDoc(doc(fs, BOOKINGS_COLLECTION, bookingId))
  if (!snap.exists()) return []
  const data = snap.data() as Record<string, unknown>
  const correct = computeCorrectDebits(data)

  const ledgerSnap = await getDocs(
    query(collection(fs, LEDGER_COLLECTION), where('referenceId', '==', bookingId)),
  )
  const actual = new Map<string, number>()
  ledgerSnap.forEach((ld) => {
    const r = ld.data() as Record<string, unknown>
    const vid = String(r.vendorId ?? '')
    if (!vid) return
    const isRefundDebit = r.type === 'debit' && REFUND_DEBIT_SOURCES.has(String(r.source ?? ''))
    const isReversal =
      r.type === 'credit' && String(r.source ?? '') === 'refund-correction-reversal'
    const amt = Number(r.amount) || 0
    if (isRefundDebit) actual.set(vid, (actual.get(vid) ?? 0) + amt)
    else if (isReversal) actual.set(vid, (actual.get(vid) ?? 0) - amt)
  })

  const out: RefundCorrection[] = []
  const allVids = new Set([...correct.keys(), ...actual.keys()])
  for (const vid of allVids) {
    const expected = correct.get(vid)?.vendorTotal ?? 0
    const actualAmt = actual.get(vid) ?? 0
    const delta = expected - actualAmt
    if (delta === 0) continue
    out.push({
      bookingId,
      vendorId: vid,
      vendorName: vendorMeta.get(vid),
      bookingDate: dateOnlyForLedger(data.transactionDate ?? data.createdAt ?? data.sessionDate),
      invoiceNumber:
        (typeof data.invoiceNumber === 'string' && data.invoiceNumber) ||
        (typeof data.billingId === 'string' && data.billingId) ||
        bookingId,
      locationId: String(data.locationId ?? ''),
      expected,
      actual: actualAmt,
      delta,
      direction: delta > 0 ? 'add-debit' : 'reverse-debit',
    })
  }
  return out
}

export interface ApplyRefundCorrectionInput {
  bookingId: string
  vendorId: string
  delta: number
  bookingDate?: string
  invoiceNumber?: string
  locationId?: string
  resolvedBy: { id: string; name: string }
}

/**
 * Write a single refund-debit correction to `vendorLedger` at the
 * canonical `lc-{bookingId}-{vendorId}` doc id. Idempotent — re-running
 * with the same delta is a no-op (same payload). Adds an audit row to
 * `reconciliationLog`.
 *
 * delta > 0  → vendor was under-debited → write a `refund-correction`
 *              debit row of size `delta`.
 * delta < 0  → vendor was over-debited  → write a
 *              `refund-correction-reversal` credit row of size `|delta|`.
 */
export const applyRefundCorrection = async (input: ApplyRefundCorrectionInput): Promise<void> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  if (input.delta === 0) return
  const isDebit = input.delta > 0
  const docId = `lc-${input.bookingId}-${input.vendorId}`
  const nowIso = new Date().toISOString()
  const date = input.bookingDate || nowIso
  // Don't fall back to bookingId — see functions/lib/vendor-ledger-sync.js
  // Fix 2. The bookingId-as-invoiceNumber pattern polluted the downstream
  // `vendorInvoices` aggregation. Strict null fallback + the delete-below
  // means the row is written without `invoiceNumber` when there's no
  // real one, rather than with a value that looks like a real invoice.
  const realInvoice =
    typeof input.invoiceNumber === 'string' && input.invoiceNumber.trim()
      ? input.invoiceNumber.trim()
      : ''
  const payload: Record<string, unknown> = {
    id: docId,
    vendorId: input.vendorId,
    amount: Math.abs(Math.round(input.delta)),
    type: isDebit ? 'debit' : 'credit',
    source: isDebit ? 'refund-correction' : 'refund-correction-reversal',
    referenceId: input.bookingId,
    invoiceNumber: realInvoice,
    locationId: input.locationId || '',
    date,
    createdAt: nowIso,
    note: 'Item-level refund truth correction (proportional backfill drift)',
    resolvedBy: input.resolvedBy.id,
    resolvedByName: input.resolvedBy.name,
  }
  // Strip empty strings on optional fields so Firestore doesn't store junk.
  if (!payload.invoiceNumber) delete payload.invoiceNumber
  if (!payload.locationId) delete payload.locationId
  await setDoc(doc(fs, LEDGER_COLLECTION, docId), payload, { merge: true })

  // Audit row.
  const logId = `${input.bookingId}_${input.vendorId}_refund_${Date.now()}`
  await setDoc(doc(fs, LOG_COLLECTION, logId), {
    id: logId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    kind: 'refund-correction',
    delta: input.delta,
    direction: isDebit ? 'add-debit' : 'reverse-debit',
    resolvedBy: input.resolvedBy.id,
    resolvedByName: input.resolvedBy.name,
    resolvedAt: nowIso,
  })
}

// ════════════════════════════════════════════════════════════════════════
// Audit — vendor ledger vs revenue derivation, per booking
// ════════════════════════════════════════════════════════════════════════

export type AuditClassification =
  | 'trigger-correct' // ledger amount equals Σ billingItems[].vendorTotal (clean)
  | 'rounding' // |diff| ≤ ₹2
  | 'bundle-discount' // ledger > Σ vendorTotal AND source is event-package / no-source / online
  | 'refund-debit' // refund-debit row consistent with items[].refunded
  | 'refund-correction' // refund-correction* ledger row (manual fix)
  | 'missing-credit' // Σ vendorTotal > 0 but ledger = 0
  | 'wrong-vendor-stamp' // vendor in vendorIds[] but Σ vendorTotal = 0
  | 'unexplained-diff' // any other gap
  | 'acknowledged' // admin marked the diff as expected, current diff matches ack
  | 'acknowledged-stale' // ack exists but underlying diff has changed since ack — re-review

export interface AuditBookingRow {
  bookingId: string
  date: string
  source: string
  branchId: string
  refundStatus: string
  // Four numbers per booking:
  grossItems: number // sum of items[].unitPrice × qty where vendorId match
  grossBilling: number // sum of billingItems[].unitPrice × qty where vendorId match
  vendorTotalSum: number // Σ billingItems[].vendorTotal (per-item splits, what trigger writes)
  ledgerNet: number // sum of vendorLedger credits − debits referencing this booking
  // Derived:
  derivedShareItems: number // grossItems × share%
  derivedShareBilling: number // grossBilling × share%
  diffLedgerVsVendorTotal: number // ledgerNet − vendorTotalSum (positive = ledger has more)
  classification: AuditClassification
  classificationReason: string
  ledgerEntries: Array<{
    id: string
    type: string
    source: string
    amount: number
  }>
  acknowledged?: {
    by: string
    byName?: string
    at: string
    reason: string
    /**
     * The diffLedgerVsVendorTotal value at the moment of acknowledgment.
     * If the current diff drifts away from this (>₹2), the row is
     * reclassified as 'acknowledged-stale' so the human knows their
     * earlier "I know" was made under different state and the world
     * has moved.
     */
    mismatchAmountAtAck?: number
  }
}

/** Centralized tolerance — every "match" check across audit, drift, and
 *  invoice validation should call this. Default: ±₹2 to absorb GST
 *  rounding noise. */
export const AUDIT_TOLERANCE_RUPEES = 2
export const isWithinTolerance = (
  a: number,
  b: number,
  tolerance = AUDIT_TOLERANCE_RUPEES,
): boolean => Math.abs(a - b) <= tolerance

export interface AuditResult {
  vendorId: string
  vendorName: string
  vendorType: string
  branch: string
  sharePercent: number
  fromDate: string
  toDate: string
  // Headline (sums across all contributing bookings):
  totalGrossItems: number
  totalGrossBilling: number
  totalVendorTotalSum: number
  totalLedgerNet: number
  totalLedgerCredits: number
  totalLedgerDebits: number
  rows: AuditBookingRow[]
  // Ledger-source breakdown for the period:
  ledgerSourceBreakdown: Array<{ key: string; count: number; net: number }>
}

const dateOnlyForAudit = (raw: unknown): string => {
  if (!raw) return ''
  if (
    typeof raw === 'object' &&
    raw &&
    typeof (raw as { toDate?: () => Date }).toDate === 'function'
  ) {
    try {
      return (raw as { toDate: () => Date }).toDate().toISOString().slice(0, 10)
    } catch {
      return ''
    }
  }
  const s = String(raw)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

const classifyRow = (
  row: Omit<AuditBookingRow, 'classification' | 'classificationReason'>,
  hasItemsRefunded: boolean,
  vendorInVendorIds: boolean,
): { classification: AuditClassification; reason: string } => {
  if (row.acknowledged) {
    // Stale-ack detection: an ack stores the diff value at the moment of
    // acknowledgment. If the current diff is materially different, the
    // underlying state has moved and the human's "I know" no longer
    // applies — surface as stale so it gets re-reviewed.
    const ackedDiff = row.acknowledged.mismatchAmountAtAck
    const currentDiff = row.diffLedgerVsVendorTotal
    if (typeof ackedDiff === 'number' && !isWithinTolerance(currentDiff, ackedDiff)) {
      return {
        classification: 'acknowledged-stale',
        reason: `Acknowledged when diff was ${ackedDiff}, now ${currentDiff}. Underlying state changed since the ack — re-review.`,
      }
    }
    if (typeof ackedDiff !== 'number') {
      // Legacy ack written before mismatchAmountAtAck was tracked — treat as
      // stale so it gets re-reviewed once with the new persistence shape.
      return {
        classification: 'acknowledged-stale',
        reason:
          'Legacy acknowledgment without mismatch snapshot — re-acknowledge to record the current diff.',
      }
    }
    return {
      classification: 'acknowledged',
      reason: `Marked expected by admin (diff at ack: ${ackedDiff}). Current diff still matches.`,
    }
  }
  // Missing credit — vendor has per-item splits but no ledger row.
  if (row.vendorTotalSum > 1 && Math.abs(row.ledgerNet) < 1) {
    return {
      classification: 'missing-credit',
      reason:
        'Per-item vendor splits exist but ledger has no credit for this vendor on this booking.',
    }
  }
  // Wrong vendor stamping — vendor is in vendorIds[] but no per-item split for them.
  if (vendorInVendorIds && row.vendorTotalSum < 1 && Math.abs(row.ledgerNet) < 1) {
    return {
      classification: 'wrong-vendor-stamp',
      reason:
        'Vendor is in booking.vendorIds[] but has no per-item vendorTotal — vendorId likely on the wrong items[].',
    }
  }
  const diff = row.diffLedgerVsVendorTotal
  if (Math.abs(diff) <= 2) {
    if (Math.abs(diff) === 0 && row.vendorTotalSum > 0) {
      return {
        classification: 'trigger-correct',
        reason: 'Ledger amount matches per-item splits exactly.',
      }
    }
    return {
      classification: 'rounding',
      reason: '±₹2 rounding noise from per-item integer splits.',
    }
  }
  // Diff exists. Check ledger-entry sources to classify.
  const sources = row.ledgerEntries.map((e) => `${e.type}/${e.source || '(no source)'}`)
  const hasRefundCorrection = sources.some((s) => s.includes('refund-correction'))
  if (hasRefundCorrection) {
    return {
      classification: 'refund-correction',
      reason:
        'Booking has refund-correction* ledger rows from a prior manual fix, but a residual gap of ' +
        `${diff} still exists between Σ vendorTotal (${row.vendorTotalSum}) and ledger net (${row.ledgerNet}). ` +
        `Either Auto-fix to write a corrective adjustment that closes the gap, or Ack-as-is if the residual is intentional.`,
    }
  }
  const refundDebits = row.ledgerEntries.filter((e) => e.type === 'debit' && e.source === 'refund')
  const refundDebitTotal = refundDebits.reduce((s, e) => s + e.amount, 0)
  if (refundDebits.length > 0) {
    // Strong signal: refund-debit on ledger AND items[] flagged refunded.
    if (hasItemsRefunded) {
      return {
        classification: 'refund-debit',
        reason: 'Booking has refund-debit ledger row consistent with items[].refunded.',
      }
    }
    // Weak signal but mathematically conclusive: the refund-debit amount
    // exactly explains the diff (vendorTotalSum − ledgerNet ≈ debit total).
    // Happens when items[].refunded wasn't flagged but billingItems[] or
    // refundStatus indicate the refund. Treat as refund-debit since the
    // ledger entry is itself proof.
    const diffExplainedByRefund =
      Math.abs(row.vendorTotalSum - row.ledgerNet - refundDebitTotal) <= 2
    if (diffExplainedByRefund) {
      return {
        classification: 'refund-debit',
        reason: `Refund debit of ${refundDebitTotal} on ledger fully explains the diff between Σ vendorTotal (${row.vendorTotalSum}) and ledger net (${row.ledgerNet}). items[].refunded flag may be out of sync but the refund itself is correctly recorded.`,
      }
    }
  }
  // Diff > 0 (ledger > per-item sum) and credit row has no/event-package source
  // ⇒ customer-online helper credited at full retail (configPrice), per-item
  // splits use post-discount unitPrice. Expected for combo bookings.
  if (diff > 0) {
    const hasNoSourceCredit = row.ledgerEntries.some(
      (e) => e.type === 'credit' && (!e.source || e.source === 'booking'),
    )
    if (hasNoSourceCredit) {
      return {
        classification: 'bundle-discount',
        reason:
          'Ledger credit was written using campaign configPrice (full retail), but billingItems[] use customer-paid unitPrice (post-discount). Difference is the bundle discount the company absorbs on the vendor’s behalf.',
      }
    }
  }
  return {
    classification: 'unexplained-diff',
    reason: `Ledger and per-item splits disagree by ${diff > 0 ? '+' : ''}${diff}. No standard cause matched.`,
  }
}

/**
 * Compute a full audit for one vendor over a date range. Returns the
 * 4-way headline plus a per-booking row for every booking that has the
 * vendor in items / billingItems / top-level / vendorIds[].
 */
export const listVendorAudit = async (
  vendorId: string,
  fromDate: string,
  toDate: string,
): Promise<AuditResult> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')

  // Vendor metadata.
  const vSnap = await getDoc(doc(fs, 'vendorDetails', vendorId))
  const vData = vSnap.exists() ? (vSnap.data() as Record<string, unknown>) : {}
  const sharePercent =
    typeof vData.revenueShare === 'number' ? Math.min(100, Math.max(0, vData.revenueShare)) : 80

  // Pre-load all ledger entries for this vendor in window, grouped by booking.
  const ledSnap = await getDocs(
    query(collection(fs, LEDGER_COLLECTION), where('vendorId', '==', vendorId)),
  )
  const ledgerByBooking = new Map<
    string,
    Array<{ id: string; type: string; source: string; amount: number; net: number; day: string }>
  >()
  let totalLedgerCredits = 0
  let totalLedgerDebits = 0
  const ledgerSourceCounter = new Map<string, { count: number; net: number }>()
  ledSnap.forEach((d) => {
    const r = d.data() as Record<string, unknown>
    const day = dateOnlyForAudit(r.date)
    if (!day || day < fromDate || day > toDate) return
    const refId = String(r.referenceId ?? '')
    if (!refId) return
    const type = String(r.type ?? '')
    const source = String(r.source ?? '')
    const amount = Number(r.amount) || 0
    const net = type === 'credit' ? amount : type === 'debit' ? -amount : 0
    if (type === 'credit') totalLedgerCredits += amount
    if (type === 'debit') totalLedgerDebits += amount
    const key = `${type}/${source || '(no source)'}`
    const acc = ledgerSourceCounter.get(key) ?? { count: 0, net: 0 }
    acc.count++
    acc.net += net
    ledgerSourceCounter.set(key, acc)
    const list = ledgerByBooking.get(refId) ?? []
    list.push({ id: d.id, type, source, amount, net, day })
    ledgerByBooking.set(refId, list)
  })
  const totalLedgerNet = totalLedgerCredits - totalLedgerDebits

  // Walk all bookings in window — match if vendor appears in any of:
  // items[].vendorId / billingItems[].vendorId / top-level vendorId /
  // top-level vendorIds[].
  const bSnap = await getDocs(collection(fs, BOOKINGS_COLLECTION))
  const rows: AuditBookingRow[] = []
  let totalGrossItems = 0
  let totalGrossBilling = 0
  let totalVendorTotalSum = 0
  bSnap.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    if (data.cancelled === true) return
    if (data.deletedAt || data.voidedAt) return
    if (data.paymentStatus && data.paymentStatus !== 'completed') return
    if (data.refundStatus === 'Full') return
    const day = dateOnlyForAudit(data.transactionDate ?? data.createdAt)
    if (!day || day < fromDate || day > toDate) return

    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
    const billing = Array.isArray(data.billingItems)
      ? (data.billingItems as Array<Record<string, unknown>>)
      : []
    const topVendorId = String(data.vendorId ?? '')
    const vendorIds = Array.isArray(data.vendorIds) ? (data.vendorIds as unknown[]).map(String) : []
    const vendorInVendorIds = vendorIds.includes(vendorId)

    let grossItems = 0
    let hasItemsRefunded = false
    for (const it of items) {
      if (!it || it.vendorId !== vendorId) continue
      const qty = Math.max(1, Math.floor(Number(it.quantity) || 1))
      const unit = Number(it.unitPrice ?? it.price) || 0
      grossItems += qty * unit
      if (it.refunded === true) hasItemsRefunded = true
    }
    let grossBilling = 0
    let vendorTotalSum = 0
    for (const bi of billing) {
      if (!bi || bi.vendorId !== vendorId) continue
      const qty = Math.max(1, Math.floor(Number(bi.quantity) || 1))
      const unit = Number(bi.unitPrice ?? bi.price) || 0
      grossBilling += qty * unit
      // Refunded items contribute zero to the vendor truth — the customer
      // was refunded for that line, the vendor isn't owed anything.
      // Mirrors the same exclusion in detectLedgerVsBillingDrift and
      // extractItemSplits. Without this filter, the audit reports a
      // phantom "missing credit" for refunded items, and a well-meaning
      // admin clicking "Reconcile to billingItems truth" writes a real
      // ledger credit for money that should have stayed with the company —
      // exactly the silent-overpayment bug we just hit on
      // ASG260410174826320L0F1.
      if (bi.refunded === true) continue
      vendorTotalSum += Number(bi.vendorTotal) || 0
    }
    const matched =
      grossItems > 0 || grossBilling > 0 || topVendorId === vendorId || vendorInVendorIds
    if (!matched) return

    const ledgerEntries = ledgerByBooking.get(d.id) ?? []
    const ledgerNet = ledgerEntries.reduce((s, e) => s + e.net, 0)
    const acknowledged = (() => {
      const a = (
        data.auditAcknowledged && typeof data.auditAcknowledged === 'object'
          ? (data.auditAcknowledged as Record<string, unknown>)
          : null
      ) as Record<string, unknown> | null
      const v = a && a[vendorId]
      if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>
        return {
          by: String(obj.by ?? ''),
          byName: typeof obj.byName === 'string' ? obj.byName : undefined,
          at: String(obj.at ?? ''),
          reason: String(obj.reason ?? ''),
          mismatchAmountAtAck:
            typeof obj.mismatchAmountAtAck === 'number' ? obj.mismatchAmountAtAck : undefined,
        }
      }
      return undefined
    })()

    const base: Omit<AuditBookingRow, 'classification' | 'classificationReason'> = {
      bookingId: d.id,
      date: day,
      source: String(data.source ?? ''),
      branchId: String(data.locationId ?? ''),
      refundStatus: String(data.refundStatus ?? 'None'),
      grossItems,
      grossBilling,
      vendorTotalSum,
      ledgerNet,
      derivedShareItems: Math.round((grossItems * sharePercent) / 100),
      derivedShareBilling: Math.round((grossBilling * sharePercent) / 100),
      diffLedgerVsVendorTotal: ledgerNet - vendorTotalSum,
      ledgerEntries: ledgerEntries.map((e) => ({
        id: e.id,
        type: e.type,
        source: e.source,
        amount: e.amount,
      })),
      acknowledged,
    }
    const cls = classifyRow(base, hasItemsRefunded, vendorInVendorIds)
    rows.push({
      ...base,
      classification: cls.classification,
      classificationReason: cls.reason,
    })
    totalGrossItems += grossItems
    totalGrossBilling += grossBilling
    totalVendorTotalSum += vendorTotalSum
  })

  rows.sort((a, b) => {
    const order: Record<AuditClassification, number> = {
      'acknowledged-stale': 0, // loudest — ack made under different state; needs re-review
      'missing-credit': 1,
      'wrong-vendor-stamp': 2,
      'unexplained-diff': 3,
      'bundle-discount': 4,
      'refund-correction': 5,
      'refund-debit': 6,
      rounding: 7,
      'trigger-correct': 8,
      acknowledged: 9,
    }
    const oa = order[a.classification]
    const ob = order[b.classification]
    if (oa !== ob) return oa - ob
    return Math.abs(b.diffLedgerVsVendorTotal) - Math.abs(a.diffLedgerVsVendorTotal)
  })

  const ledgerSourceBreakdown = [...ledgerSourceCounter.entries()]
    .map(([key, v]) => ({ key, count: v.count, net: v.net }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

  return {
    vendorId,
    vendorName: String(vData.vendorName ?? vData.userName ?? vendorId),
    vendorType: vData.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty',
    branch: String(vData.branch ?? ''),
    sharePercent,
    fromDate,
    toDate,
    totalGrossItems,
    totalGrossBilling,
    totalVendorTotalSum,
    totalLedgerNet,
    totalLedgerCredits,
    totalLedgerDebits,
    rows,
    ledgerSourceBreakdown,
  }
}

/**
 * Mark a (booking, vendor) audit row as expected so it's classified
 * 'acknowledged' on future audits and stops cluttering the list. Writes
 * to `bookings/{id}.auditAcknowledged.{vendorId}` so it's traceable per
 * vendor per booking.
 */
export const acknowledgeAuditRow = async (
  bookingId: string,
  vendorId: string,
  reason: string,
  resolvedBy: { id: string; name: string },
  /**
   * The current `diffLedgerVsVendorTotal` value at the moment of ack.
   * Persisted on the booking and used by the classifier to detect when
   * the world has moved since this ack was made.
   *
   * Optional only for legacy callers — new code MUST pass it. Acks
   * without this field are surfaced as 'acknowledged-stale' on the
   * very next audit run so they get re-reviewed under the new shape.
   */
  mismatchAmountAtAck?: number,
): Promise<void> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  if (!reason.trim() || reason.trim().length < 5) {
    throw new Error('Acknowledgment reason must be at least 5 characters.')
  }
  const nowIso = new Date().toISOString()
  const ackPayload: Record<string, unknown> = {
    by: resolvedBy.id,
    byName: resolvedBy.name,
    at: nowIso,
    reason: reason.trim(),
  }
  if (typeof mismatchAmountAtAck === 'number' && Number.isFinite(mismatchAmountAtAck)) {
    ackPayload.mismatchAmountAtAck = Math.round(mismatchAmountAtAck)
  }
  await setDoc(
    doc(fs, BOOKINGS_COLLECTION, bookingId),
    {
      auditAcknowledged: {
        [vendorId]: ackPayload,
      },
    },
    { merge: true },
  )
  const logId = `${bookingId}_${vendorId}_audit_${Date.now()}`
  await setDoc(doc(fs, LOG_COLLECTION, logId), {
    id: logId,
    bookingId,
    vendorId,
    kind: 'audit-acknowledge',
    reason: reason.trim(),
    mismatchAmountAtAck: typeof mismatchAmountAtAck === 'number' ? mismatchAmountAtAck : null,
    resolvedBy: resolvedBy.id,
    resolvedByName: resolvedBy.name,
    resolvedAt: nowIso,
  })
}

/**
 * Revoke an existing audit acknowledgment for a (booking, vendor) pair.
 * The row will return to its underlying classification (whatever the
 * mismatch was originally — usually unexplained-diff, missing-credit, etc.)
 * and become a candidate for fix or re-acknowledgment.
 */
export const revokeAuditAck = async (
  bookingId: string,
  vendorId: string,
  resolvedBy: { id: string; name: string },
  reason?: string,
): Promise<void> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const nowIso = new Date().toISOString()
  // Use deleteField via a sentinel — Firestore client SDK requires explicit
  // FieldValue.delete(). Easiest path: write { [vendorId]: null } and let the
  // classifier treat null/undefined as no-ack. Cleaner: actually delete.
  const { deleteField } = await import('firebase/firestore')
  await setDoc(
    doc(fs, BOOKINGS_COLLECTION, bookingId),
    {
      auditAcknowledged: {
        [vendorId]: deleteField(),
      },
    },
    { merge: true },
  )
  const logId = `${bookingId}_${vendorId}_revoke_${Date.now()}`
  await setDoc(doc(fs, LOG_COLLECTION, logId), {
    id: logId,
    bookingId,
    vendorId,
    kind: 'audit-revoke',
    reason: reason?.trim() ?? '',
    resolvedBy: resolvedBy.id,
    resolvedByName: resolvedBy.name,
    resolvedAt: nowIso,
  })
}

/**
 * Write a manual_adjustment ledger credit for a vendor on a booking.
 * Used to fix 'missing-credit' classified rows. Idempotent against the
 * same docId — calling twice with same amount writes the same row.
 */
export const writeManualCreditAdjustment = async (input: {
  bookingId: string
  vendorId: string
  amount: number
  vendorBase?: number
  vendorGst?: number
  invoiceNumber?: string
  locationId?: string
  date?: string
  reason: string
  resolvedBy: { id: string; name: string }
}): Promise<void> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  if (input.amount <= 0) return
  const nowIso = new Date().toISOString()
  const docId = `lc-manual-${input.bookingId}-${input.vendorId}`
  await setDoc(
    doc(fs, LEDGER_COLLECTION, docId),
    {
      id: docId,
      vendorId: input.vendorId,
      amount: Math.round(input.amount),
      vendorBase: Math.round(input.vendorBase ?? input.amount),
      vendorGst: Math.round(input.vendorGst ?? 0),
      type: 'credit',
      source: 'manual_adjustment',
      referenceId: input.bookingId,
      invoiceNumber: input.invoiceNumber || input.bookingId,
      locationId: input.locationId || '',
      date: input.date || nowIso,
      createdAt: nowIso,
      note: input.reason,
      resolvedBy: input.resolvedBy.id,
      resolvedByName: input.resolvedBy.name,
    },
    { merge: true },
  )
  const logId = `${input.bookingId}_${input.vendorId}_manualcredit_${Date.now()}`
  await setDoc(doc(fs, LOG_COLLECTION, logId), {
    id: logId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    kind: 'manual-credit-adjustment',
    amount: input.amount,
    reason: input.reason,
    resolvedBy: input.resolvedBy.id,
    resolvedByName: input.resolvedBy.name,
    resolvedAt: nowIso,
  })
}

export interface VendorSuggestion {
  vendorId: string
  count: number
}
export type VendorSuggestionIndex = Map<string, VendorSuggestion[]>

const suggestionKey = (
  branchId: string,
  gameId: string,
  subGameId: string,
  variantId: string,
): string =>
  `${(branchId || '').trim().toLowerCase()}::${(gameId || '').trim().toLowerCase()}::${(subGameId || '').trim().toLowerCase()}::${(variantId || '').trim().toLowerCase()}`

let _vendorSuggestionCache: { at: number; index: VendorSuggestionIndex } | null = null

/**
 * Build a "which vendor has historically been credited for this
 * (branch, game, subGame, variant)" lookup by walking the bookings
 * collection once. Cached for 5 minutes so opening the resolver modal
 * many times in a row is free. Used to suggest vendors as clickable
 * chips in OrphanResolverModal — never auto-applied (admin still has
 * to click). Walks `items[]` and `billingItems[]` together so any
 * vendor stamped on either array contributes.
 */
export const listVendorSuggestions = async (): Promise<VendorSuggestionIndex> => {
  const now = Date.now()
  if (_vendorSuggestionCache && now - _vendorSuggestionCache.at < 5 * 60 * 1000) {
    return _vendorSuggestionCache.index
  }
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const snap = await getDocs(collection(fs, BOOKINGS_COLLECTION))
  // bucket: key → vendorId → count
  const buckets = new Map<string, Map<string, number>>()
  const bump = (
    branchId: string,
    gameId: string,
    subGameId: string,
    variantId: string,
    vendorId: string,
  ) => {
    if (!vendorId.trim() || !gameId.trim()) return
    const k = suggestionKey(branchId, gameId, subGameId, variantId)
    const m = buckets.get(k) ?? new Map<string, number>()
    m.set(vendorId, (m.get(vendorId) ?? 0) + 1)
    buckets.set(k, m)
  }
  for (const d of snap.docs) {
    const data = d.data() || {}
    if (data.cancelled === true) continue
    if (data.deletedAt || data.voidedAt) continue
    const branchId = String(data.locationId ?? '')
    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
    for (const it of items) {
      const vid = typeof it?.vendorId === 'string' ? it.vendorId : ''
      if (!vid) continue
      bump(
        branchId,
        typeof it?.gameId === 'string' ? it.gameId : '',
        typeof it?.subGameId === 'string' ? it.subGameId : '',
        typeof it?.variantId === 'string' ? it.variantId : '',
        vid,
      )
    }
    const billingItems = Array.isArray(data.billingItems)
      ? (data.billingItems as Array<Record<string, unknown>>)
      : []
    for (const bi of billingItems) {
      const vid = typeof bi?.vendorId === 'string' ? bi.vendorId : ''
      if (!vid) continue
      bump(
        branchId,
        typeof bi?.gameId === 'string' ? bi.gameId : '',
        typeof bi?.subGameId === 'string' ? bi.subGameId : '',
        typeof bi?.variantId === 'string' ? bi.variantId : '',
        vid,
      )
    }
  }
  const index: VendorSuggestionIndex = new Map()
  for (const [k, m] of buckets) {
    const ranked = [...m.entries()]
      .map(([vendorId, count]) => ({ vendorId, count }))
      .sort((a, b) => b.count - a.count)
    index.set(k, ranked)
  }
  _vendorSuggestionCache = { at: now, index }
  return index
}

export const lookupVendorSuggestions = (
  index: VendorSuggestionIndex,
  branchId: string,
  gameId: string,
  subGameId: string,
  variantId: string,
  limit = 3,
): VendorSuggestion[] => {
  const k = suggestionKey(branchId, gameId, subGameId, variantId)
  const exact = index.get(k) ?? []
  if (exact.length > 0) return exact.slice(0, limit)
  // Looser fallback: drop variantId, then subGameId — useful when the
  // catalog row picked is a sibling variant the vendor hasn't done yet
  // but they're known for the parent activity.
  const noVariant = index.get(suggestionKey(branchId, gameId, subGameId, '')) ?? []
  if (noVariant.length > 0) return noVariant.slice(0, limit)
  const noSub = index.get(suggestionKey(branchId, gameId, '', '')) ?? []
  return noSub.slice(0, limit)
}

export const writeManualDebitAdjustment = async (input: {
  bookingId: string
  vendorId: string
  amount: number
  invoiceNumber?: string
  locationId?: string
  date?: string
  reason: string
  resolvedBy: { id: string; name: string }
}): Promise<void> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  if (input.amount <= 0) return
  const nowIso = new Date().toISOString()
  const docId = `ld-manual-${input.bookingId}-${input.vendorId}`
  await setDoc(
    doc(fs, LEDGER_COLLECTION, docId),
    {
      id: docId,
      vendorId: input.vendorId,
      amount: Math.round(input.amount),
      vendorBase: Math.round(input.amount),
      vendorGst: 0,
      type: 'debit',
      source: 'manual_adjustment',
      referenceId: input.bookingId,
      invoiceNumber: input.invoiceNumber || input.bookingId,
      locationId: input.locationId || '',
      date: input.date || nowIso,
      createdAt: nowIso,
      note: input.reason,
      resolvedBy: input.resolvedBy.id,
      resolvedByName: input.resolvedBy.name,
    },
    { merge: true },
  )
  const logId = `${input.bookingId}_${input.vendorId}_manualdebit_${Date.now()}`
  await setDoc(doc(fs, LOG_COLLECTION, logId), {
    id: logId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    kind: 'manual-debit-adjustment',
    amount: input.amount,
    reason: input.reason,
    resolvedBy: input.resolvedBy.id,
    resolvedByName: input.resolvedBy.name,
    resolvedAt: nowIso,
  })
}

// ── Audit auto-fix ───────────────────────────────────────────────────────
//
// Bulk-fix rows in an audit run. The flow is two-stage by design:
//   1. planAutoFix(rows, options)   — pure, no writes. Computes per-row
//      action, amount, and skip reason. Returns a preview the admin sees
//      in a modal before approving.
//   2. applyAutoFix(plan, ...)      — sequenced, idempotent writes via
//      existing helpers. Loops with a progress callback so the UI can
//      render a progress bar.
//
// Safety rails:
//   - `unexplained-diff` is NEVER auto-fixed (no auto-write of money for
//     truly unexplained gaps).
//   - `refund-correction` rows are skipped (need RefundReviewModal).
//   - Per-row absolute cap (default ₹5,000) and total cap (default
//     ₹50,000) — exceeding rows are skipped, exceeding total aborts the
//     plan entirely with a single error.
//   - All writes reuse canonical doc IDs from writeManualCredit/Debit/
//     acknowledgeAuditRow, so re-running auto-fix is a no-op.

export type AutoFixAction =
  | 'write-credit'
  | 'write-debit'
  | 'acknowledge'
  | 'remove-vendor-tag'
  | 'skip'

export interface AutoFixRowPlan {
  bookingId: string
  classification: AuditClassification
  action: AutoFixAction
  /** INR — credit if write-credit, debit if write-debit, 0 otherwise. */
  amount: number
  /** Human-readable reason — used in the ledger note + recon log. */
  reason: string
  /** Why this row was skipped (only when action === 'skip'). */
  skipReason?: string
  /** Booking branch (used when writing the ledger row). */
  branchId: string
  /** Booking date (yyyy-mm-dd) — converted to ISO at apply time. */
  date: string
  /** Snapshot of `diffLedgerVsVendorTotal` for action === 'acknowledge'.
   *  Persisted on the booking so the classifier can flip the row to
   *  'acknowledged-stale' if the underlying state moves later. */
  mismatchAmountAtAck?: number
}

export interface AutoFixPlan {
  vendorId: string
  vendorName: string
  rows: AutoFixRowPlan[]
  totalCredit: number
  totalDebit: number
  netMovement: number
  perRowCap: number
  totalCap: number
  /** Set when the plan exceeds the total cap. The UI must block apply. */
  abortReason: string | null
  /** Per-action counts, useful for the confirm summary. */
  counts: {
    writeCredit: number
    writeDebit: number
    acknowledge: number
    removeVendorTag: number
    skip: number
  }
}

export interface PlanAutoFixOptions {
  perRowCap?: number
  totalCap?: number
  /** Auto-acknowledge bundle-discount rows. Default true. */
  ackBundleDiscount?: boolean
  /** Auto-acknowledge refund-debit rows that aren't yet acknowledged.
   *  Default false — these are already classified OK, no need to ack. */
  ackRefundDebit?: boolean
}

const DEFAULT_PER_ROW_CAP = 5000
const DEFAULT_TOTAL_CAP = 50000

export const planAutoFix = (result: AuditResult, options: PlanAutoFixOptions = {}): AutoFixPlan => {
  const perRowCap = Math.max(0, options.perRowCap ?? DEFAULT_PER_ROW_CAP)
  const totalCap = Math.max(0, options.totalCap ?? DEFAULT_TOTAL_CAP)
  const ackBundleDiscount = options.ackBundleDiscount ?? true
  const ackRefundDebit = options.ackRefundDebit ?? false
  const rows: AutoFixRowPlan[] = []
  for (const r of result.rows) {
    const base = {
      bookingId: r.bookingId,
      classification: r.classification,
      branchId: r.branchId,
      date: r.date,
      // Snapshot of the diff at planning time. Acknowledge actions copy
      // this onto the booking so the classifier can detect later drift.
      mismatchAmountAtAck: r.diffLedgerVsVendorTotal,
    }
    switch (r.classification) {
      case 'missing-credit': {
        const amount = Math.max(0, Math.round(r.vendorTotalSum))
        if (amount <= 0) {
          rows.push({
            ...base,
            action: 'skip',
            amount: 0,
            reason: '',
            skipReason: 'Σ vendorTotal is zero — nothing to credit.',
          })
        } else if (amount > perRowCap) {
          rows.push({
            ...base,
            action: 'skip',
            amount,
            reason: '',
            skipReason: `Amount ${amount} exceeds per-row cap ${perRowCap}.`,
          })
        } else {
          rows.push({
            ...base,
            action: 'write-credit',
            amount,
            reason: 'Auto-fix · missing credit (Σ vendorTotal from billingItems)',
          })
        }
        break
      }
      case 'wrong-vendor-stamp': {
        // Two distinct sub-cases:
        //   (a) The vendor was over-credited via the ledger but has no
        //       billingItems claim. Need a corrective debit.
        //   (b) The vendor was tagged in vendorIds[] (or items[i].vendorId)
        //       but has no claim AND no ledger movement — purely a stale
        //       stamp. Need to remove the tag, no money moves.
        const overpay = Math.max(0, Math.round(r.ledgerNet - r.vendorTotalSum))
        if (overpay > 0) {
          if (overpay > perRowCap) {
            rows.push({
              ...base,
              action: 'skip',
              amount: overpay,
              reason: '',
              skipReason: `Debit ${overpay} exceeds per-row cap ${perRowCap}.`,
            })
          } else {
            rows.push({
              ...base,
              action: 'write-debit',
              amount: overpay,
              reason: 'Auto-fix · wrong vendor stamp (overpayment vs billingItems)',
            })
          }
        } else {
          // Stale tag — vendor in vendorIds[] / items[i].vendorId but
          // billingItems doesn't claim them and ledger has no movement.
          // Remove the tag so audits stop flagging it.
          rows.push({
            ...base,
            action: 'remove-vendor-tag',
            amount: 0,
            reason: 'Auto-fix · stale vendor stamp (no billingItems claim, no ledger movement)',
          })
        }
        break
      }
      case 'bundle-discount': {
        if (!ackBundleDiscount) {
          rows.push({
            ...base,
            action: 'skip',
            amount: 0,
            reason: '',
            skipReason: 'Bundle-discount auto-ack disabled.',
          })
        } else {
          rows.push({
            ...base,
            action: 'acknowledge',
            amount: 0,
            reason: 'Auto-fix · bundle discount cost (configPrice ledger vs adjusted billing)',
          })
        }
        break
      }
      case 'refund-debit': {
        if (!ackRefundDebit) {
          rows.push({
            ...base,
            action: 'skip',
            amount: 0,
            reason: '',
            skipReason: 'Refund-debit row already classified OK.',
          })
        } else {
          rows.push({
            ...base,
            action: 'acknowledge',
            amount: 0,
            reason: 'Auto-fix · refund debit (matches refunded billingItems)',
          })
        }
        break
      }
      case 'unexplained-diff':
        rows.push({
          ...base,
          action: 'skip',
          amount: 0,
          reason: '',
          skipReason: 'Unexplained diff — auto-fix never writes for this class.',
        })
        break
      case 'refund-correction':
        rows.push({
          ...base,
          action: 'skip',
          amount: 0,
          reason: '',
          skipReason: 'Use Refund Review modal — needs per-item refund verification.',
        })
        break
      default:
        rows.push({
          ...base,
          action: 'skip',
          amount: 0,
          reason: '',
          skipReason:
            r.classification === 'acknowledged' ? 'Already acknowledged.' : 'Already clean.',
        })
    }
  }
  let totalCredit = 0
  let totalDebit = 0
  const counts = {
    writeCredit: 0,
    writeDebit: 0,
    acknowledge: 0,
    removeVendorTag: 0,
    skip: 0,
  }
  for (const r of rows) {
    if (r.action === 'write-credit') {
      totalCredit += r.amount
      counts.writeCredit++
    } else if (r.action === 'write-debit') {
      totalDebit += r.amount
      counts.writeDebit++
    } else if (r.action === 'acknowledge') {
      counts.acknowledge++
    } else if (r.action === 'remove-vendor-tag') {
      counts.removeVendorTag++
    } else {
      counts.skip++
    }
  }
  const netMovement = totalCredit - totalDebit
  const absMovement = totalCredit + totalDebit
  const abortReason =
    absMovement > totalCap
      ? `Total ledger movement ${absMovement} exceeds total cap ${totalCap}. Lower the per-row cap, narrow the audit period, or apply rows individually.`
      : null
  return {
    vendorId: result.vendorId,
    vendorName: result.vendorName,
    rows,
    totalCredit,
    totalDebit,
    netMovement,
    perRowCap,
    totalCap,
    abortReason,
    counts,
  }
}

export interface AutoFixApplyResult {
  succeeded: AutoFixRowPlan[]
  failed: Array<{ row: AutoFixRowPlan; error: string }>
  totalCreditApplied: number
  totalDebitApplied: number
}

/**
 * Remove a vendor's stale tag from a booking when audit shows they were
 * tagged in `vendorIds[]` (or items[i].vendorId) but have no billingItems
 * claim AND no ledger movement. The vendor was added by mistake — usually
 * a cashier picking the wrong vendor on items[] or a multi-vendor combo
 * fan-out leaving extra tags.
 *
 * What this writes:
 *   - For every items[i] whose `vendorId === vendorId` AND no
 *     billingItems row with the same itemName/variantId carries the same
 *     vendorId → blank items[i].vendorId. Items that legitimately should
 *     keep this vendor (because billingItems agrees) are untouched.
 *   - Recomputes vendorIds[] from the cleaned items[] and writes it back.
 *   - Logs the change to reconciliationLog with kind:
 *     `remove-stale-vendor-tag`.
 *
 * No money moves. No ledger writes. Idempotent — running it twice is a
 * no-op once items[] no longer has the stale tag.
 */
const removeStaleVendorTag = async (
  bookingId: string,
  vendorId: string,
  reason: string,
  resolvedBy: { id: string; name: string },
): Promise<void> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const ref = doc(fs, BOOKINGS_COLLECTION, bookingId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error(`Booking ${bookingId} not found.`)
  const data = snap.data() as Record<string, unknown>
  const items = Array.isArray(data.items) ? [...(data.items as Array<Record<string, unknown>>)] : []
  const billing = Array.isArray(data.billingItems)
    ? (data.billingItems as Array<Record<string, unknown>>)
    : []
  let mutated = false
  const cleared: Array<{ itemIndex: number; itemName: string }> = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!it || it.vendorId !== vendorId) continue
    // Does any billingItems row for this same item also carry this vendor?
    // If yes, the vendor stamp on items[] is correct — leave it alone.
    const variantId = typeof it.variantId === 'string' ? it.variantId : ''
    const itemName = typeof it.itemName === 'string' ? it.itemName : ''
    const matched = billing.find((b) => {
      if (variantId && typeof b?.variantId === 'string' && b.variantId === variantId) return true
      if (itemName && typeof b?.itemName === 'string' && b.itemName === itemName) return true
      return false
    })
    if (matched && matched.vendorId === vendorId) continue
    items[i] = { ...it, vendorId: '' }
    cleared.push({ itemIndex: i, itemName: itemName || '(no name)' })
    mutated = true
  }
  // Recompute vendorIds[] from the (possibly cleaned) items[].
  const nextVendorIds = Array.from(
    new Set(
      items.map((it) => (typeof it?.vendorId === 'string' ? it.vendorId : '')).filter(Boolean),
    ),
  )
  const prevVendorIds = Array.isArray(data.vendorIds)
    ? (data.vendorIds as unknown[]).map(String)
    : []
  const vendorIdsChanged =
    prevVendorIds.length !== nextVendorIds.length ||
    prevVendorIds.some((v) => !nextVendorIds.includes(v))
  if (!mutated && !vendorIdsChanged) return // already clean — idempotent
  const nowIso = new Date().toISOString()
  await setDoc(
    ref,
    {
      items,
      vendorIds: nextVendorIds,
      enrichmentSource: 'admin-remove-stale-vendor-tag',
      enrichmentResolvedBy: resolvedBy.id,
      enrichmentResolvedByName: resolvedBy.name,
      enrichmentResolvedAt: nowIso,
    },
    { merge: true },
  )
  const logId = `${bookingId}_remove-stale-vendor-tag_${vendorId}_${Date.now()}`
  await setDoc(doc(fs, LOG_COLLECTION, logId), {
    id: logId,
    bookingId,
    vendorId,
    kind: 'remove-stale-vendor-tag',
    reason,
    cleared,
    vendorIdsBefore: prevVendorIds,
    vendorIdsAfter: nextVendorIds,
    resolvedBy: resolvedBy.id,
    resolvedByName: resolvedBy.name,
    resolvedAt: nowIso,
  })
}

export const applyAutoFix = async (
  plan: AutoFixPlan,
  resolvedBy: { id: string; name: string },
  /** Called between rows so the UI can render a progress bar. */
  onProgress?: (done: number, total: number, current?: AutoFixRowPlan) => void,
): Promise<AutoFixApplyResult> => {
  if (plan.abortReason) throw new Error(plan.abortReason)
  const out: AutoFixApplyResult = {
    succeeded: [],
    failed: [],
    totalCreditApplied: 0,
    totalDebitApplied: 0,
  }
  const actionable = plan.rows.filter((r) => r.action !== 'skip')
  for (let i = 0; i < actionable.length; i++) {
    const row = actionable[i]
    try {
      const dateIso = row.date ? `${row.date}T12:00:00.000Z` : undefined
      if (row.action === 'write-credit') {
        await writeManualCreditAdjustment({
          bookingId: row.bookingId,
          vendorId: plan.vendorId,
          amount: row.amount,
          invoiceNumber: row.bookingId,
          locationId: row.branchId,
          date: dateIso,
          reason: row.reason,
          resolvedBy,
        })
        out.totalCreditApplied += row.amount
      } else if (row.action === 'write-debit') {
        await writeManualDebitAdjustment({
          bookingId: row.bookingId,
          vendorId: plan.vendorId,
          amount: row.amount,
          invoiceNumber: row.bookingId,
          locationId: row.branchId,
          date: dateIso,
          reason: row.reason,
          resolvedBy,
        })
        out.totalDebitApplied += row.amount
      } else if (row.action === 'acknowledge') {
        await acknowledgeAuditRow(
          row.bookingId,
          plan.vendorId,
          row.reason,
          resolvedBy,
          row.mismatchAmountAtAck,
        )
      } else if (row.action === 'remove-vendor-tag') {
        await removeStaleVendorTag(row.bookingId, plan.vendorId, row.reason, resolvedBy)
      }
      out.succeeded.push(row)
    } catch (err) {
      out.failed.push({
        row,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    onProgress?.(i + 1, actionable.length, row)
  }
  return out
}

/**
 * Run audits for many vendors in parallel. Fans out to listVendorAudit
 * concurrently so wall-clock time is bounded by the slowest single
 * vendor's audit, not the sum. Failures on one vendor don't poison the
 * rest — they're collected separately so the UI can display partials.
 */
export const listAllVendorAudits = async (
  vendorIds: string[],
  fromDate: string,
  toDate: string,
  onProgress?: (done: number, total: number, current?: string) => void,
): Promise<{
  results: Map<string, AuditResult>
  failures: Array<{ vendorId: string; error: string }>
}> => {
  const results = new Map<string, AuditResult>()
  const failures: Array<{ vendorId: string; error: string }> = []
  let done = 0
  await Promise.all(
    vendorIds.map(async (vid) => {
      try {
        const r = await listVendorAudit(vid, fromDate, toDate)
        results.set(vid, r)
      } catch (err) {
        failures.push({ vendorId: vid, error: err instanceof Error ? err.message : String(err) })
      } finally {
        done += 1
        onProgress?.(done, vendorIds.length, vid)
      }
    }),
  )
  return { results, failures }
}

/**
 * Bulk-fix every `refund-correction` row in an AuditResult by writing a
 * corrective ledger adjustment sized to close the residual gap, then ack'ing
 * the row with `mismatchAmountAtAck: 0` (post-fix). This is the "auto-fix"
 * action — money moves on the ledger. Use when the prior manual refund
 * correction left a residual drift you want closed automatically.
 *
 * Per-row safety cap: rows whose |diff| exceeds `perRowCap` are SKIPPED
 * with a reason — these are large enough that an admin should look at
 * them individually before any auto-write.
 *
 * Doc IDs are timestamped (`lc-reconcile-…` / `ld-reconcile-…`) so multiple
 * passes accumulate instead of overwriting prior corrections.
 */
export const reconcileRefundCorrectionRows = async (
  result: AuditResult,
  resolvedBy: { id: string; name: string },
  options: { perRowCap?: number } = {},
): Promise<{
  fixed: number
  skipped: Array<{ bookingId: string; reason: string }>
  totalCreditApplied: number
  totalDebitApplied: number
  failed: Array<{ bookingId: string; error: string }>
}> => {
  const perRowCap = Math.max(1, options.perRowCap ?? 2000)
  const targets = result.rows.filter((r) => r.classification === 'refund-correction')
  const out = {
    fixed: 0,
    skipped: [] as Array<{ bookingId: string; reason: string }>,
    totalCreditApplied: 0,
    totalDebitApplied: 0,
    failed: [] as Array<{ bookingId: string; error: string }>,
  }
  for (const r of targets) {
    const diff = r.diffLedgerVsVendorTotal
    const absDiff = Math.abs(diff)
    if (absDiff <= AUDIT_TOLERANCE_RUPEES) {
      out.skipped.push({ bookingId: r.bookingId, reason: 'within tolerance — no fix needed' })
      continue
    }
    if (absDiff > perRowCap) {
      out.skipped.push({
        bookingId: r.bookingId,
        reason: `|diff| ₹${absDiff} exceeds per-row cap ₹${perRowCap} — review individually`,
      })
      continue
    }
    try {
      const dateIso = r.date ? `${r.date}T12:00:00.000Z` : new Date().toISOString()
      const reason = `Auto-fix · refund-correction residual · ledger ${r.ledgerNet} → vendorTotalSum ${r.vendorTotalSum}`
      if (diff < 0) {
        // ledger < truth — under-credited — write credit of |diff|.
        await writeReconciliationCreditAdjustment({
          bookingId: r.bookingId,
          vendorId: result.vendorId,
          amount: absDiff,
          invoiceNumber: r.bookingId,
          locationId: r.branchId,
          date: dateIso,
          reason,
          resolvedBy,
        })
        out.totalCreditApplied += absDiff
      } else {
        // ledger > truth — over-credited — write debit of diff.
        await writeReconciliationDebitAdjustment({
          bookingId: r.bookingId,
          vendorId: result.vendorId,
          amount: absDiff,
          invoiceNumber: r.bookingId,
          locationId: r.branchId,
          date: dateIso,
          reason,
          resolvedBy,
        })
        out.totalDebitApplied += absDiff
      }
      // Ack at post-fix diff = 0. The corrective row brings ledger to truth,
      // so re-running audit will reclassify this booking as 'rounding' or
      // 'trigger-correct'. We still write an ack so the audit log captures
      // the human decision and the booking carries the trail.
      await acknowledgeAuditRow(
        r.bookingId,
        result.vendorId,
        `Auto-fixed refund-correction residual ₹${absDiff}. Original diff: ${diff}.`,
        resolvedBy,
        0, // mismatchAmountAtAck — post-fix the diff is 0
      )
      out.fixed += 1
    } catch (err) {
      out.failed.push({
        bookingId: r.bookingId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return out
}

/**
 * Bulk-acknowledge every row matching one or more "expected" classifications
 * in an AuditResult. Default: bundle-discount + refund-correction (the legacy
 * "expected" sweep). Pass `classifications` to scope the sweep — for example
 * `['refund-correction']` to ack ONLY refund-corrections without touching
 * bundle-discounts.
 */
export const acknowledgeExpectedRows = async (
  result: AuditResult,
  resolvedBy: { id: string; name: string },
  reason = 'Bulk-ack · expected (bundle discount or refund correction)',
  classifications: AuditClassification[] = ['bundle-discount', 'refund-correction'],
): Promise<{ acknowledged: number; failed: Array<{ bookingId: string; error: string }> }> => {
  const targetSet = new Set<AuditClassification>(classifications)
  const targets = result.rows.filter((r) => targetSet.has(r.classification))
  let acknowledged = 0
  const failed: Array<{ bookingId: string; error: string }> = []
  for (const r of targets) {
    try {
      await acknowledgeAuditRow(
        r.bookingId,
        result.vendorId,
        reason,
        resolvedBy,
        r.diffLedgerVsVendorTotal,
      )
      acknowledged++
    } catch (err) {
      failed.push({
        bookingId: r.bookingId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { acknowledged, failed }
}

/**
 * Read the current vendorLedger entries for a single booking. Used by
 * the Re-attribute modal to show "ledger before / after" so admin can
 * verify the swap will land correctly. Returns per-vendor net + raw
 * entries so the UI can show the breakdown.
 */
export const readBookingLedger = async (
  bookingId: string,
): Promise<{
  netByVendor: Map<string, number>
  entries: Array<{
    id: string
    vendorId: string
    type: string
    source: string
    amount: number
  }>
}> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const snap = await getDocs(
    query(collection(fs, LEDGER_COLLECTION), where('referenceId', '==', bookingId)),
  )
  const netByVendor = new Map<string, number>()
  const entries: Array<{
    id: string
    vendorId: string
    type: string
    source: string
    amount: number
  }> = []
  snap.forEach((d) => {
    const r = d.data() as Record<string, unknown>
    const vid = String(r.vendorId ?? '')
    const t = String(r.type ?? '')
    const a = Number(r.amount) || 0
    entries.push({
      id: d.id,
      vendorId: vid,
      type: t,
      source: String(r.source ?? ''),
      amount: a,
    })
    if (vid) {
      const cur = netByVendor.get(vid) ?? 0
      const delta = t === 'credit' ? a : t === 'debit' ? -a : 0
      netByVendor.set(vid, cur + delta)
    }
  })
  return { netByVendor, entries }
}

// ── Pattern detection: vendor-stamp mismatches across many bookings ──────
//
// Truth source: billingItems[]. The ledger trigger writes credits per
// billingItems[].vendorId. If the ledger has a credit for vendor A on
// booking X, but billingItems[i].vendorId on booking X says vendor B
// should have been credited, the stamp is wrong and we have a swap
// candidate.
//
// We never flag based on vendorIds[] alone — that's a hint, not truth.
// Without billingItems[] proof, no pattern. Zero false positives by
// construction.

export interface MisattributionInstance {
  bookingId: string
  branchId: string
  date: string
  /** Catalog identity of the disputed item. */
  gameId: string
  subGameId: string
  variantId: string
  itemName: string
  /** Vendor the ledger credited (wrong). */
  observedVendorId: string
  observedAmount: number
  /** Vendor billingItems says should have been credited (right). */
  expectedVendorId: string
  /** Per billingItem: vendorTotal that the trigger would have written. */
  expectedAmount: number
}

export interface MisattributionPattern {
  /** Composite key for grouping. */
  key: string
  branchId: string
  gameId: string
  subGameId: string
  variantId: string
  observedVendorId: string
  observedVendorName?: string
  expectedVendorId: string
  expectedVendorName?: string
  /** All booking instances affected by this pattern. */
  instances: MisattributionInstance[]
  totalObservedCredit: number
  totalExpectedCredit: number
}

const patternKey = (
  branchId: string,
  gameId: string,
  subGameId: string,
  variantId: string,
  observedVendorId: string,
  expectedVendorId: string,
): string =>
  `${branchId}::${gameId}::${subGameId}::${variantId}::${observedVendorId}::${expectedVendorId}`

/**
 * Scan bookings in window, detect cross-vendor stamp mismatches by
 * comparing each booking's ledger credits against its billingItems[]. A
 * mismatch means: ledger credited vendor A, billingItems shows vendor B
 * was the rightful owner of that item — and there's no compensating
 * credit on B. Returns patterns sorted by count.
 *
 * vendorMetadata is used only to enrich pattern with names; correctness
 * comes purely from billingItems vs ledger.
 */
export const detectMisattributionPatterns = async (
  fromDate: string,
  toDate: string,
  vendorMetadata?: VendorOption[],
): Promise<MisattributionPattern[]> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const vendorNameById = new Map<string, string>()
  for (const v of vendorMetadata ?? []) vendorNameById.set(v.id, v.name)

  // Pull all ledger entries in window (we'll filter and group below).
  const ledSnap = await getDocs(collection(fs, LEDGER_COLLECTION))
  // Per (bookingId, vendorId) → net credit (credits - debits).
  const ledgerNet = new Map<string, number>() // key = `${bookingId}|${vendorId}`
  ledSnap.forEach((d) => {
    const r = d.data() as Record<string, unknown>
    const day = dateOnlyForAudit(r.date)
    if (!day || day < fromDate || day > toDate) return
    const refId = String(r.referenceId ?? '')
    const vid = String(r.vendorId ?? '')
    if (!refId || !vid) return
    const type = String(r.type ?? '')
    const amount = Number(r.amount) || 0
    const k = `${refId}|${vid}`
    const cur = ledgerNet.get(k) ?? 0
    if (type === 'credit') ledgerNet.set(k, cur + amount)
    else if (type === 'debit') ledgerNet.set(k, cur - amount)
  })

  // Walk bookings in window. For each billingItem with a vendorId, check
  // whether the ledger credited that vendor for the expected amount. If
  // the credit is missing AND another vendor on the same booking has an
  // unexplained credit, that's a swap candidate.
  const bSnap = await getDocs(collection(fs, BOOKINGS_COLLECTION))
  const instances: MisattributionInstance[] = []
  bSnap.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    if (data.cancelled === true) return
    if (data.deletedAt || data.voidedAt) return
    if (data.paymentStatus && data.paymentStatus !== 'completed') return
    if (data.refundStatus === 'Full') return
    const day = dateOnlyForAudit(data.transactionDate ?? data.createdAt)
    if (!day || day < fromDate || day > toDate) return

    const billing = Array.isArray(data.billingItems)
      ? (data.billingItems as Array<Record<string, unknown>>)
      : []
    if (billing.length === 0) return // no truth — no pattern detection
    const branchId = String(data.locationId ?? '')

    // Per-vendor truth from billingItems.
    const expectedByVendor = new Map<
      string,
      Array<{
        amount: number
        gameId: string
        subGameId: string
        variantId: string
        itemName: string
      }>
    >()
    for (const bi of billing) {
      const vid = typeof bi.vendorId === 'string' ? bi.vendorId : ''
      if (!vid) continue
      const amount = Number(bi.vendorTotal) || 0
      if (amount <= 0) continue
      const list = expectedByVendor.get(vid) ?? []
      list.push({
        amount,
        gameId: typeof bi.gameId === 'string' ? bi.gameId : '',
        subGameId: typeof bi.subGameId === 'string' ? bi.subGameId : '',
        variantId: typeof bi.variantId === 'string' ? bi.variantId : '',
        itemName: typeof bi.itemName === 'string' ? bi.itemName : '',
      })
      expectedByVendor.set(vid, list)
    }
    if (expectedByVendor.size === 0) return

    // Build observed vendor → ledger credit. We only want vendors with
    // credits unexplained by their own billingItems.
    const observedByVendor = new Map<string, number>()
    const allVendorIds = new Set<string>(expectedByVendor.keys())
    if (Array.isArray(data.vendorIds)) {
      for (const v of data.vendorIds as unknown[]) {
        if (typeof v === 'string') allVendorIds.add(v)
      }
    }
    if (typeof data.vendorId === 'string') allVendorIds.add(data.vendorId)
    for (const vid of allVendorIds) {
      const k = `${d.id}|${vid}`
      const net = ledgerNet.get(k) ?? 0
      if (net !== 0) observedByVendor.set(vid, net)
    }

    // For each expected vendor with no credit, check if any other vendor
    // on the same booking has a credit that closely matches the expected
    // total. If yes → swap candidate.
    for (const [expectedVendorId, items] of expectedByVendor) {
      const expectedTotal = items.reduce((s, it) => s + it.amount, 0)
      const observedNet = observedByVendor.get(expectedVendorId) ?? 0
      // If the rightful vendor was credited within ₹2 of expected, no swap.
      if (Math.abs(observedNet - expectedTotal) <= 2) continue
      // If billingItems shows multiple items for this vendor with mixed
      // catalog identities, we can't safely group into a single pattern —
      // skip detection for this vendor on this booking. The audit/Re-attribute
      // flow handles these.
      const distinctVariants = new Set(
        items.map((it) => `${it.gameId}::${it.subGameId}::${it.variantId}`),
      )
      if (distinctVariants.size !== 1) continue

      const probeItem = items[0]
      // Find a swap counterparty: a vendor whose credit ~= expectedTotal
      // and who has no billingItems[] claim on this booking.
      const swapCandidates: Array<{ vendorId: string; amount: number }> = []
      for (const [vid, net] of observedByVendor) {
        if (vid === expectedVendorId) continue
        if (expectedByVendor.has(vid)) continue // they have their own claim
        if (Math.abs(net - expectedTotal) > Math.max(2, expectedTotal * 0.05)) continue
        swapCandidates.push({ vendorId: vid, amount: net })
      }
      if (swapCandidates.length !== 1) continue // ambiguous → skip

      const observed = swapCandidates[0]
      instances.push({
        bookingId: d.id,
        branchId,
        date: day,
        gameId: probeItem.gameId,
        subGameId: probeItem.subGameId,
        variantId: probeItem.variantId,
        itemName: probeItem.itemName,
        observedVendorId: observed.vendorId,
        observedAmount: observed.amount,
        expectedVendorId,
        expectedAmount: expectedTotal,
      })
    }
  })

  // Group instances into patterns.
  const buckets = new Map<string, MisattributionPattern>()
  for (const inst of instances) {
    const k = patternKey(
      inst.branchId,
      inst.gameId,
      inst.subGameId,
      inst.variantId,
      inst.observedVendorId,
      inst.expectedVendorId,
    )
    const existing = buckets.get(k)
    if (existing) {
      existing.instances.push(inst)
      existing.totalObservedCredit += inst.observedAmount
      existing.totalExpectedCredit += inst.expectedAmount
    } else {
      buckets.set(k, {
        key: k,
        branchId: inst.branchId,
        gameId: inst.gameId,
        subGameId: inst.subGameId,
        variantId: inst.variantId,
        observedVendorId: inst.observedVendorId,
        observedVendorName: vendorNameById.get(inst.observedVendorId),
        expectedVendorId: inst.expectedVendorId,
        expectedVendorName: vendorNameById.get(inst.expectedVendorId),
        instances: [inst],
        totalObservedCredit: inst.observedAmount,
        totalExpectedCredit: inst.expectedAmount,
      })
    }
  }
  return [...buckets.values()].sort(
    (a, b) =>
      b.instances.length - a.instances.length ||
      Math.abs(b.totalObservedCredit) - Math.abs(a.totalObservedCredit),
  )
}

/**
 * Apply a pattern swap: for every instance, write a debit on the observed
 * vendor (cancels the wrong credit) and a credit on the expected vendor.
 * Doc IDs are deterministic (`ld-pattern-...`, `lc-pattern-...`) so
 * re-running is idempotent.
 *
 * After all writes, re-reads the affected bookings' ledger entries and
 * verifies the new per-vendor net matches `billingItems[].vendorTotal`.
 * If verification fails for any booking, that booking is included in
 * `verifyFailures` so the admin can drill in.
 */
export const applyPatternSwap = async (
  pattern: MisattributionPattern,
  resolvedBy: { id: string; name: string },
  onProgress?: (done: number, total: number, current?: string) => void,
): Promise<{
  succeeded: string[]
  failed: Array<{ bookingId: string; error: string }>
  verifyFailures: Array<{ bookingId: string; vendorId: string; expected: number; actual: number }>
}> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const succeeded: string[] = []
  const failed: Array<{ bookingId: string; error: string }> = []
  const total = pattern.instances.length

  for (let i = 0; i < pattern.instances.length; i++) {
    const inst = pattern.instances[i]
    try {
      const dateIso = inst.date ? `${inst.date}T12:00:00.000Z` : new Date().toISOString()
      // Debit on observed vendor — same amount they were wrongly credited.
      await writeManualDebitAdjustment({
        bookingId: inst.bookingId,
        vendorId: inst.observedVendorId,
        amount: inst.observedAmount,
        invoiceNumber: inst.bookingId,
        locationId: inst.branchId,
        date: dateIso,
        reason: `Pattern swap · stamp was ${inst.observedVendorId}, billingItems prove ${inst.expectedVendorId}`,
        resolvedBy,
      })
      // Credit on expected vendor — the amount billingItems says they earned.
      await writeManualCreditAdjustment({
        bookingId: inst.bookingId,
        vendorId: inst.expectedVendorId,
        amount: inst.expectedAmount,
        invoiceNumber: inst.bookingId,
        locationId: inst.branchId,
        date: dateIso,
        reason: `Pattern swap · billingItems[].vendorId = ${inst.expectedVendorId}`,
        resolvedBy,
      })
      succeeded.push(inst.bookingId)
    } catch (err) {
      failed.push({
        bookingId: inst.bookingId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    onProgress?.(i + 1, total, inst.bookingId)
  }

  // Verify by re-reading the ledger and confirming the swap is reflected.
  const verifyFailures: Array<{
    bookingId: string
    vendorId: string
    expected: number
    actual: number
  }> = []
  // For each succeeded booking, re-fetch ledger entries for the two
  // affected vendors and confirm the post-swap net matches expected.
  for (const bid of succeeded) {
    for (const inst of pattern.instances.filter((x) => x.bookingId === bid)) {
      try {
        const entries = await getDocs(
          query(collection(fs, LEDGER_COLLECTION), where('referenceId', '==', bid)),
        )
        let expectedNet = 0
        let observedNet = 0
        entries.forEach((e) => {
          const r = e.data() as Record<string, unknown>
          const vid = String(r.vendorId ?? '')
          const t = String(r.type ?? '')
          const a = Number(r.amount) || 0
          if (vid === inst.expectedVendorId) {
            expectedNet += t === 'credit' ? a : t === 'debit' ? -a : 0
          } else if (vid === inst.observedVendorId) {
            observedNet += t === 'credit' ? a : t === 'debit' ? -a : 0
          }
        })
        // Expected vendor should now net to inst.expectedAmount (within ₹2).
        if (Math.abs(expectedNet - inst.expectedAmount) > 2) {
          verifyFailures.push({
            bookingId: bid,
            vendorId: inst.expectedVendorId,
            expected: inst.expectedAmount,
            actual: expectedNet,
          })
        }
        // Observed vendor should now net to ~0 (their wrong credit cancelled by debit).
        if (Math.abs(observedNet) > 2) {
          verifyFailures.push({
            bookingId: bid,
            vendorId: inst.observedVendorId,
            expected: 0,
            actual: observedNet,
          })
        }
      } catch {
        // Verification failure to read isn't a write failure — log and continue.
      }
    }
  }
  return { succeeded, failed, verifyFailures }
}

// ── Ledger-vs-billingItems drift reconciliation ──────────────────────────
//
// For event/combo bookings (and any booking with billingItems[]), the
// trigger sometimes writes a ledger amount that diverges from
// `Σ billingItems[].vendorTotal` — different GST treatment, configPrice
// vs paid-price, share override, etc. Since billingItems is the canonical
// source the cheque math uses, the right fix is to force the ledger to
// match billingItems by writing a single corrective debit or credit per
// (booking, vendor) pair.
//
// Idempotent: doc IDs `lc-truth-{bid}-{vid}` and `ld-truth-{bid}-{vid}`
// re-use canonical paths so re-running is a no-op.
// Verified: every row is re-read after write to confirm convergence.

export interface LedgerDriftRow {
  bookingId: string
  branchId: string
  date: string
  vendorId: string
  vendorName?: string
  /** Σ billingItems[].vendorTotal for this vendor on this booking (truth). */
  vendorTotalSum: number
  /** Current ledger net (credits − debits). */
  ledgerNet: number
  /** vendorTotalSum − ledgerNet. Positive = need credit. Negative = need debit. */
  drift: number
  /** True when at least one item/billingItems[].itemName looks event/combo-ish. */
  isEventOrCombo: boolean
  /** Distinct ledger sources observed for this vendor — context for admin. */
  ledgerSources: string[]
}

const isEventOrComboName = (s: string): boolean => {
  if (!s) return false
  const t = s.toLowerCase()
  return (
    t.includes('combo') ||
    t.includes(' • ') ||
    t.includes('summer') ||
    t.includes('vibes') ||
    t.includes('package')
  )
}

export const detectLedgerVsBillingDrift = async (
  fromDate: string,
  toDate: string,
  vendorMetadata?: VendorOption[],
): Promise<LedgerDriftRow[]> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const vendorNameById = new Map<string, string>()
  for (const v of vendorMetadata ?? []) vendorNameById.set(v.id, v.name)

  // Pull all ledger entries in window once; index by (bookingId, vendorId).
  const ledSnap = await getDocs(collection(fs, LEDGER_COLLECTION))
  const ledIdx = new Map<string, { net: number; sources: Set<string> }>()
  ledSnap.forEach((d) => {
    const r = d.data() as Record<string, unknown>
    const day = dateOnlyForAudit(r.date)
    if (!day || day < fromDate || day > toDate) return
    const refId = String(r.referenceId ?? '')
    const vid = String(r.vendorId ?? '')
    if (!refId || !vid) return
    const k = `${refId}|${vid}`
    const slot = ledIdx.get(k) ?? { net: 0, sources: new Set<string>() }
    const type = String(r.type ?? '')
    const amount = Number(r.amount) || 0
    if (type === 'credit') slot.net += amount
    else if (type === 'debit') slot.net -= amount
    if (r.source) slot.sources.add(String(r.source))
    ledIdx.set(k, slot)
  })

  const bSnap = await getDocs(collection(fs, BOOKINGS_COLLECTION))
  const out: LedgerDriftRow[] = []
  bSnap.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    if (data.cancelled === true) return
    if (data.deletedAt || data.voidedAt) return
    if (data.paymentStatus && data.paymentStatus !== 'completed') return
    if (data.refundStatus === 'Full') return
    const day = dateOnlyForAudit(data.transactionDate ?? data.createdAt)
    if (!day || day < fromDate || day > toDate) return

    const billing = Array.isArray(data.billingItems)
      ? (data.billingItems as Array<Record<string, unknown>>)
      : []
    if (billing.length === 0) return // no truth to compare against

    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
    const branchId = String(data.locationId ?? '')

    // Per-vendor sum of billingItems[].vendorTotal (truth).
    //
    // Refunded items are excluded — when bi.refunded === true (or the
    // matching items[i].refunded is true) the customer was refunded
    // and the vendor earned nothing for that line. Including the
    // refunded vendorTotal here would inflate the "truth" side, then
    // Apply would write a corrective credit that re-credits the
    // refunded amount — exactly the bug we hit on partially-refunded
    // bookings (ASG260410174826320L0F1 etc.). Refund debits already
    // exist in the ledger as `source: 'refund'` rows; we want
    // truth-side and ledger-side to converge to the post-refund net.
    const itemRefundedByMatch = (bi: Record<string, unknown>): boolean => {
      if (bi.refunded === true) return true
      const variantId = typeof bi.variantId === 'string' ? bi.variantId : ''
      const itemName = typeof bi.itemName === 'string' ? bi.itemName : ''
      const matched = items.find(
        (it) =>
          (variantId && typeof it.variantId === 'string' && it.variantId === variantId) ||
          (itemName && typeof it.itemName === 'string' && it.itemName === itemName),
      )
      return matched?.refunded === true
    }
    const totalByVendor = new Map<string, number>()
    for (const bi of billing) {
      const vid = typeof bi.vendorId === 'string' ? bi.vendorId : ''
      if (!vid) continue
      if (itemRefundedByMatch(bi)) continue
      const t = Number(bi.vendorTotal) || 0
      if (t <= 0) continue
      totalByVendor.set(vid, (totalByVendor.get(vid) ?? 0) + t)
    }
    if (totalByVendor.size === 0) return

    // Event/combo signal — applies to the whole booking.
    const allText = [
      ...items.map((i) => (typeof i.itemName === 'string' ? i.itemName : '')),
      ...billing.map((b) => (typeof b.itemName === 'string' ? b.itemName : '')),
    ]
      .filter(Boolean)
      .join(' | ')
    const eventCombo =
      isEventOrComboName(allText) ||
      items.some(
        (i) =>
          (typeof i.eventCampaignId === 'string' && i.eventCampaignId) ||
          (typeof i.comboId === 'string' && i.comboId),
      )

    for (const [vid, vendorTotalSum] of totalByVendor) {
      const slot = ledIdx.get(`${d.id}|${vid}`)
      const ledgerNet = slot?.net ?? 0
      const drift = vendorTotalSum - ledgerNet
      if (Math.abs(drift) <= 2) continue
      out.push({
        bookingId: d.id,
        branchId,
        date: day,
        vendorId: vid,
        vendorName: vendorNameById.get(vid),
        vendorTotalSum: Math.round(vendorTotalSum),
        ledgerNet: Math.round(ledgerNet),
        drift: Math.round(drift),
        isEventOrCombo: eventCombo,
        ledgerSources: slot ? [...slot.sources] : [],
      })
    }
  })
  // Sort by absolute drift desc — highest-impact rows first.
  out.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
  return out
}

export interface LockedPeriodDriftRow {
  vendorId: string
  bookingsTouched: string[]
  /** What the locked invoice was paid for. Read from invoice doc. */
  paidAmount: number
  /** What truth says the vendor was actually owed (Σ non-refunded vendorTotal). */
  truthAmount: number
  /** paidAmount − truthAmount. Positive = overpaid; negative = underpaid. */
  drift: number
}

/**
 * Compute per-vendor drift on a LOCKED period — for cases where the
 * cheque was already cut and the invoice can't be regenerated.
 *
 * For each LOCKED vendor invoice in `periodStart`:
 *   - paidAmount  = invoice.totalAmount (what was actually paid)
 *   - truthAmount = Σ non-refunded billingItems[].vendorTotal across all
 *                   bookings in the period for this vendor
 *   - drift       = paidAmount − truthAmount
 *
 * Drift > ₹2  → vendor was overpaid → carry-forward DEBIT next cheque
 * Drift < −₹2 → vendor was underpaid → carry-forward CREDIT next cheque
 * |drift| ≤ ₹2 → within rounding, skip
 *
 * Pure read — no writes. Pair with `applyLockedPeriodCarryForward` to
 * generate corrections in bulk.
 */
export const detectLockedPeriodDrift = async (
  periodStart: string,
): Promise<LockedPeriodDriftRow[]> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')

  // Load locked invoices for this period.
  const invSnap = await getDocs(
    query(
      collection(fs, 'vendorInvoices'),
      where('periodStart', '==', periodStart),
      where('status', '==', 'locked'),
    ),
  )
  const paidByVendor = new Map<string, number>()
  for (const d of invSnap.docs) {
    const data = d.data() as Record<string, unknown>
    const vid = String(data.vendorId ?? '')
    if (!vid) continue
    paidByVendor.set(vid, (paidByVendor.get(vid) ?? 0) + Number(data.totalAmount ?? 0))
  }
  if (paidByVendor.size === 0) return []

  // Walk all bookings whose transactionDate or createdAt falls in the period.
  const periodEnd = await (async () => {
    const { getPeriodEnd } = await import('./accounting-firestore')
    return getPeriodEnd(periodStart)
  })()
  const bSnap = await getDocs(collection(fs, BOOKINGS_COLLECTION))
  const truthByVendor = new Map<string, { amount: number; bookings: Set<string> }>()
  bSnap.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    const day = dateOnlyForAudit(data.transactionDate ?? data.createdAt)
    if (!day || day < periodStart || day > periodEnd) return
    if (data.cancelled === true) return
    if (data.deletedAt || data.voidedAt) return
    if (data.paymentStatus && data.paymentStatus !== 'completed') return
    if (data.refundStatus === 'Full') return
    const billing = Array.isArray(data.billingItems)
      ? (data.billingItems as Array<Record<string, unknown>>)
      : []
    for (const bi of billing) {
      const vid = typeof bi.vendorId === 'string' ? bi.vendorId : ''
      if (!vid) continue
      if (bi.refunded === true) continue
      const t = Number(bi.vendorTotal) || 0
      if (t <= 0) continue
      const acc = truthByVendor.get(vid) ?? { amount: 0, bookings: new Set<string>() }
      acc.amount += t
      acc.bookings.add(d.id)
      truthByVendor.set(vid, acc)
    }
  })

  // Build drift rows for every vendor that was paid.
  const out: LockedPeriodDriftRow[] = []
  for (const [vid, paidAmount] of paidByVendor) {
    const truth = truthByVendor.get(vid)
    const truthAmount = truth?.amount ?? 0
    const bookingsTouched = truth ? [...truth.bookings] : []
    const drift = Math.round(paidAmount - truthAmount)
    if (Math.abs(drift) <= 2) continue
    out.push({
      vendorId: vid,
      bookingsTouched,
      paidAmount: Math.round(paidAmount),
      truthAmount: Math.round(truthAmount),
      drift,
    })
  }
  out.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
  return out
}

/**
 * Apply a batch of locked-period drift rows as carry-forward corrections.
 * Each row writes a single ledger row in the current pending period — one
 * per vendor, summarising the entire period's drift, NOT one per booking.
 * The note carries the booking IDs for traceability.
 */
export const applyLockedPeriodCarryForward = async (
  rows: LockedPeriodDriftRow[],
  lockedPeriodStart: string,
  resolvedBy: { id: string; name: string },
): Promise<{
  applied: number
  failed: Array<{ vendorId: string; error: string }>
  totalRecovered: number
  totalToppedUp: number
}> => {
  const out = {
    applied: 0,
    failed: [] as Array<{ vendorId: string; error: string }>,
    totalRecovered: 0,
    totalToppedUp: 0,
  }
  for (const row of rows) {
    try {
      await applySettlementCorrection({
        bookingId: row.bookingsTouched[0] ?? `period-${lockedPeriodStart}`,
        vendorId: row.vendorId,
        amount: row.drift,
        lockedPeriodStart,
        reason:
          `Period sweep — paid ${row.paidAmount}, truth ${row.truthAmount}, drift ${row.drift}. ` +
          `Touches ${row.bookingsTouched.length} booking(s): ${row.bookingsTouched.slice(0, 5).join(', ')}` +
          (row.bookingsTouched.length > 5 ? `, +${row.bookingsTouched.length - 5} more` : ''),
        resolvedBy,
      })
      if (row.drift > 0) out.totalRecovered += row.drift
      else out.totalToppedUp += Math.abs(row.drift)
      out.applied += 1
    } catch (err) {
      out.failed.push({
        vendorId: row.vendorId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return out
}

/**
 * Carry-forward correction for a closed/locked period.
 *
 * Use when an admin discovers that a vendor was over- or under-paid on a
 * locked invoice that's already had its cheque cut. The locked invoice
 * itself can't be touched (period is frozen), so this writes a corrective
 * ledger row dated to TODAY's pending period — landing in the next
 * cheque cycle and netting out the prior settlement error.
 *
 * `amount` is signed:
 *   - positive: vendor was OVERPAID by `amount`. We write a DEBIT for the
 *     same amount in the current pending week, which reduces the next
 *     cheque by that much.
 *   - negative: vendor was UNDERPAID by `|amount|`. We write a CREDIT,
 *     adding `|amount|` to the next cheque.
 *
 * Surfaces in the vendor's ledger as `source: 'settlement-correction'`
 * with a note that explains the prior-period drift, the booking it relates
 * to, and the fact that the locked invoice was left untouched.
 */
export const applySettlementCorrection = async (input: {
  /** Booking the correction relates to — kept for audit traceability. */
  bookingId: string
  vendorId: string
  /** Signed: + = overpaid (debit next cheque), − = underpaid (credit). */
  amount: number
  /** Required, surfaces in PDF + ledger note. ≥10 chars. */
  reason: string
  /** Period the original wrong cheque was paid for (audit context). */
  lockedPeriodStart: string
  resolvedBy: { id: string; name: string }
}): Promise<{ docId: string; type: 'credit' | 'debit'; appliedToPeriod: string }> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const amount = Math.round(Number(input.amount))
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error('Amount must be a non-zero number.')
  }
  if (!input.reason?.trim() || input.reason.trim().length < 10) {
    throw new Error('Reason must be at least 10 characters — surfaces in vendor PDF.')
  }

  const isOverpayment = amount > 0
  const type: 'credit' | 'debit' = isOverpayment ? 'debit' : 'credit'
  const ts = Date.now()
  const nowIso = new Date().toISOString()
  // Land in the CURRENT pending period regardless of booking date so the
  // next cheque absorbs the correction. The locked period is left untouched.
  const { getPeriodStart } = await import('./accounting-firestore')
  const currentPeriodStart = getPeriodStart(new Date())
  const currentPeriodStartIso = `${currentPeriodStart}T12:00:00.000Z`

  const prefix = type === 'credit' ? 'lc-settlement' : 'ld-settlement'
  const docId = `${prefix}-${input.bookingId}-${input.vendorId}-${ts}`

  const note =
    `Carry-forward ${isOverpayment ? 'overpayment recovery' : 'underpayment top-up'} ` +
    `for locked period ${input.lockedPeriodStart} · booking ${input.bookingId} · ` +
    input.reason.trim()

  await setDoc(doc(fs, LEDGER_COLLECTION, docId), {
    id: docId,
    vendorId: input.vendorId,
    amount: Math.abs(amount),
    vendorBase: Math.abs(amount),
    vendorGst: 0,
    type,
    source: 'settlement-correction',
    referenceId: input.bookingId,
    invoiceNumber: input.bookingId,
    locationId: '',
    date: currentPeriodStartIso,
    createdAt: nowIso,
    note,
    lockedPeriodStart: input.lockedPeriodStart,
    appliedToPeriod: currentPeriodStart,
    resolvedBy: input.resolvedBy.id,
    resolvedByName: input.resolvedBy.name,
  })

  const logId = `${input.bookingId}_${input.vendorId}_settlementcorrection_${ts}`
  await setDoc(doc(fs, LOG_COLLECTION, logId), {
    id: logId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    kind: 'settlement-correction',
    direction: isOverpayment ? 'overpayment-recovered' : 'underpayment-topped-up',
    amount: Math.abs(amount),
    lockedPeriodStart: input.lockedPeriodStart,
    appliedToPeriod: currentPeriodStart,
    reason: input.reason.trim(),
    resolvedBy: input.resolvedBy.id,
    resolvedByName: input.resolvedBy.name,
    resolvedAt: nowIso,
  })

  return { docId, type, appliedToPeriod: currentPeriodStart }
}

/**
 * Reconciliation-style credit/debit — UNIQUE doc id per call so multiple
 * corrective passes ACCUMULATE in the ledger.
 *
 * Why this exists: `writeManualCreditAdjustment` writes a deterministic
 * `lc-manual-{bid}-{vid}` doc with `merge: true`. That's the right shape
 * for OrphanResolver's "Write credit" button (one canonical credit per
 * orphan resolution — clicking twice must not double-credit). But the
 * LedgerDrift "Reconcile to billingItems truth" path is fundamentally
 * different: each Apply writes a CORRECTIVE OVERLAY sized to close the
 * remaining gap. If the canonical doc already exists with amount = X,
 * a merge-write of amount = drift OVERWRITES the X — so net ledger
 * movement is (drift − X), not (drift + X), and the gap never closes.
 *
 * Fix: timestamp-suffixed doc IDs. Each Apply pass writes a fresh row,
 * `detectLedgerVsBillingDrift` sums every ledger row toward `slot.net`,
 * so multiple passes converge on vendorTotalSum.
 */
export const writeReconciliationCreditAdjustment = async (input: {
  bookingId: string
  vendorId: string
  amount: number
  invoiceNumber?: string
  locationId?: string
  date?: string
  reason: string
  resolvedBy: { id: string; name: string }
}): Promise<string> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  if (input.amount <= 0) return ''
  const nowIso = new Date().toISOString()
  const ts = Date.now()
  const docId = `lc-reconcile-${input.bookingId}-${input.vendorId}-${ts}`
  await setDoc(doc(fs, LEDGER_COLLECTION, docId), {
    id: docId,
    vendorId: input.vendorId,
    amount: Math.round(input.amount),
    vendorBase: Math.round(input.amount),
    vendorGst: 0,
    type: 'credit',
    source: 'manual_adjustment',
    referenceId: input.bookingId,
    invoiceNumber: input.invoiceNumber || input.bookingId,
    locationId: input.locationId || '',
    date: input.date || nowIso,
    createdAt: nowIso,
    note: input.reason,
    resolvedBy: input.resolvedBy.id,
    resolvedByName: input.resolvedBy.name,
  })
  const logId = `${input.bookingId}_${input.vendorId}_reconcilecredit_${ts}`
  await setDoc(doc(fs, LOG_COLLECTION, logId), {
    id: logId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    kind: 'reconciliation-credit-adjustment',
    amount: input.amount,
    reason: input.reason,
    resolvedBy: input.resolvedBy.id,
    resolvedByName: input.resolvedBy.name,
    resolvedAt: nowIso,
  })
  return docId
}

export const writeReconciliationDebitAdjustment = async (input: {
  bookingId: string
  vendorId: string
  amount: number
  invoiceNumber?: string
  locationId?: string
  date?: string
  reason: string
  resolvedBy: { id: string; name: string }
}): Promise<string> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  if (input.amount <= 0) return ''
  const nowIso = new Date().toISOString()
  const ts = Date.now()
  const docId = `ld-reconcile-${input.bookingId}-${input.vendorId}-${ts}`
  await setDoc(doc(fs, LEDGER_COLLECTION, docId), {
    id: docId,
    vendorId: input.vendorId,
    amount: Math.round(input.amount),
    vendorBase: Math.round(input.amount),
    vendorGst: 0,
    type: 'debit',
    source: 'manual_adjustment',
    referenceId: input.bookingId,
    invoiceNumber: input.invoiceNumber || input.bookingId,
    locationId: input.locationId || '',
    date: input.date || nowIso,
    createdAt: nowIso,
    note: input.reason,
    resolvedBy: input.resolvedBy.id,
    resolvedByName: input.resolvedBy.name,
  })
  const logId = `${input.bookingId}_${input.vendorId}_reconciledebit_${ts}`
  await setDoc(doc(fs, LOG_COLLECTION, logId), {
    id: logId,
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    kind: 'reconciliation-debit-adjustment',
    amount: input.amount,
    reason: input.reason,
    resolvedBy: input.resolvedBy.id,
    resolvedByName: input.resolvedBy.name,
    resolvedAt: nowIso,
  })
  return docId
}

export interface ApplyDriftResult {
  succeeded: LedgerDriftRow[]
  failed: Array<{ row: LedgerDriftRow; error: string }>
  verifyFailures: Array<{ row: LedgerDriftRow; ledgerAfter: number }>
  totalCreditApplied: number
  totalDebitApplied: number
  /**
   * Doc IDs written in this Apply pass. Pass to `rollbackReconciliationDocs`
   * to undo the entire pass when something looks wrong.
   */
  writtenDocIds: Array<{ row: LedgerDriftRow; docId: string; type: 'credit' | 'debit' }>
}

/**
 * Apply a list of drift-correction rows. Each row gets either a credit
 * (vendor was under-credited) or a debit (over-credited) sized exactly
 * to close the gap. Idempotent doc IDs.
 *
 * After every row is written, re-reads each affected booking's ledger
 * for the affected vendor and confirms the net now matches
 * vendorTotalSum within ₹2. Failures surfaced explicitly.
 */
export const applyLedgerToBillingTruth = async (
  rows: LedgerDriftRow[],
  resolvedBy: { id: string; name: string },
  onProgress?: (done: number, total: number, current?: LedgerDriftRow) => void,
): Promise<ApplyDriftResult> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const out: ApplyDriftResult = {
    succeeded: [],
    failed: [],
    verifyFailures: [],
    totalCreditApplied: 0,
    totalDebitApplied: 0,
    writtenDocIds: [],
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const dateIso = row.date ? `${row.date}T12:00:00.000Z` : new Date().toISOString()
      if (row.drift > 0) {
        // Need to credit row.drift more — UNIQUE doc per Apply pass so
        // multiple reconciliation rounds stack instead of overwriting the
        // previous corrective row's amount field.
        const docId = await writeReconciliationCreditAdjustment({
          bookingId: row.bookingId,
          vendorId: row.vendorId,
          amount: row.drift,
          invoiceNumber: row.bookingId,
          locationId: row.branchId,
          date: dateIso,
          reason: `Reconcile to billingItems truth · ledger ${row.ledgerNet} → vendorTotalSum ${row.vendorTotalSum}`,
          resolvedBy,
        })
        out.totalCreditApplied += row.drift
        if (docId) out.writtenDocIds.push({ row, docId, type: 'credit' })
      } else {
        const docId = await writeReconciliationDebitAdjustment({
          bookingId: row.bookingId,
          vendorId: row.vendorId,
          amount: Math.abs(row.drift),
          invoiceNumber: row.bookingId,
          locationId: row.branchId,
          date: dateIso,
          reason: `Reconcile to billingItems truth · ledger ${row.ledgerNet} → vendorTotalSum ${row.vendorTotalSum}`,
          resolvedBy,
        })
        out.totalDebitApplied += Math.abs(row.drift)
        if (docId) out.writtenDocIds.push({ row, docId, type: 'debit' })
      }
      out.succeeded.push(row)
    } catch (err) {
      out.failed.push({ row, error: err instanceof Error ? err.message : String(err) })
    }
    onProgress?.(i + 1, rows.length, row)
  }
  // Verify: re-read ledger per (booking, vendor) and confirm net ≈ vendorTotalSum.
  for (const row of out.succeeded) {
    try {
      const snap = await getDocs(
        query(collection(fs, LEDGER_COLLECTION), where('referenceId', '==', row.bookingId)),
      )
      let net = 0
      snap.forEach((d) => {
        const r = d.data() as Record<string, unknown>
        if (String(r.vendorId ?? '') !== row.vendorId) return
        const t = String(r.type ?? '')
        const a = Number(r.amount) || 0
        net += t === 'credit' ? a : t === 'debit' ? -a : 0
      })
      if (Math.abs(net - row.vendorTotalSum) > 2) {
        out.verifyFailures.push({ row, ledgerAfter: Math.round(net) })
      }
    } catch {
      /* read failure non-fatal */
    }
  }
  return out
}

// ── Inspector: explain WHY a (booking, vendor) row drifted ──────────────
//
// Returns the raw inputs the drift detector used:
//   - booking.billingItems[] entries that match this vendor (the "truth" side)
//   - all vendorLedger rows that match this (referenceId, vendorId) pair
//   - sums on each side and the resulting drift
//
// Used by LedgerDriftTab's "Inspect" button so admins can SEE why a row
// proposes a ₹15k credit before clicking Apply. If the truth side is wrong
// (corrupted billingItems, wrong vendor stamp), the right action is to
// fix the booking, NOT reconcile.

export interface BookingVendorInspection {
  bookingId: string
  vendorId: string
  bookingExists: boolean
  paymentStatus?: string
  refundStatus?: string
  matchingBillingItems: Array<{
    itemName: string
    quantity: number
    unitPrice: number
    vendorBase: number
    vendorGst: number
    vendorTotal: number
    refunded: boolean
    variantId?: string
  }>
  vendorTotalSum: number
  ledgerEntries: Array<{
    docId: string
    type: string
    source: string
    amount: number
    date: string
    note?: string
    isReconciliationRow: boolean
  }>
  ledgerNet: number
  drift: number
}

export const inspectBookingVendor = async (
  bookingId: string,
  vendorId: string,
): Promise<BookingVendorInspection> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')

  const bSnap = await getDoc(doc(fs, BOOKINGS_COLLECTION, bookingId))
  const bookingExists = bSnap.exists()
  const data = bookingExists ? (bSnap.data() as Record<string, unknown>) : {}
  const billing = Array.isArray(data.billingItems)
    ? (data.billingItems as Array<Record<string, unknown>>)
    : []
  const matching = billing
    .filter((bi) => String(bi.vendorId ?? '') === vendorId)
    .map((bi) => ({
      itemName: String(bi.itemName ?? ''),
      quantity: Number(bi.quantity ?? 0),
      unitPrice: Number(bi.unitPrice ?? 0),
      vendorBase: Number(bi.vendorBase ?? 0),
      vendorGst: Number(bi.vendorGst ?? 0),
      vendorTotal: Number(bi.vendorTotal ?? 0),
      refunded: bi.refunded === true,
      variantId: typeof bi.variantId === 'string' ? bi.variantId : undefined,
    }))
  const vendorTotalSum = matching.filter((m) => !m.refunded).reduce((s, m) => s + m.vendorTotal, 0)

  const ledSnap = await getDocs(
    query(collection(fs, LEDGER_COLLECTION), where('referenceId', '==', bookingId)),
  )
  const ledgerEntries = ledSnap.docs
    .map((d) => {
      const r = d.data() as Record<string, unknown>
      return {
        docId: d.id,
        vendorId: String(r.vendorId ?? ''),
        type: String(r.type ?? ''),
        source: String(r.source ?? ''),
        amount: Number(r.amount ?? 0),
        date: String(r.date ?? ''),
        note: typeof r.note === 'string' ? r.note : undefined,
        isReconciliationRow: d.id.startsWith('lc-reconcile-') || d.id.startsWith('ld-reconcile-'),
      }
    })
    .filter((e) => e.vendorId === vendorId)
  const ledgerNet = ledgerEntries.reduce((s, e) => {
    if (e.type === 'credit') return s + e.amount
    if (e.type === 'debit') return s - e.amount
    return s
  }, 0)

  return {
    bookingId,
    vendorId,
    bookingExists,
    paymentStatus: typeof data.paymentStatus === 'string' ? data.paymentStatus : undefined,
    refundStatus: typeof data.refundStatus === 'string' ? data.refundStatus : undefined,
    matchingBillingItems: matching,
    vendorTotalSum: Math.round(vendorTotalSum),
    ledgerEntries: ledgerEntries.map((e) => ({
      docId: e.docId,
      type: e.type,
      source: e.source,
      amount: Math.round(e.amount),
      date: e.date,
      note: e.note,
      isReconciliationRow: e.isReconciliationRow,
    })),
    ledgerNet: Math.round(ledgerNet),
    drift: Math.round(vendorTotalSum - ledgerNet),
  }
}

// ── Rollback: undo specific reconciliation rows by docId ─────────────────
//
// Deletes vendorLedger docs whose IDs start with `lc-reconcile-` or
// `ld-reconcile-` (the prefix the new helpers use). Refuses to delete
// anything else — we never want this to wipe an organic credit or an
// older `lc-manual-` orphan-resolution row by mistake.

export interface RollbackResult {
  deleted: string[]
  skipped: Array<{ docId: string; reason: string }>
}

export const rollbackReconciliationDocs = async (docIds: string[]): Promise<RollbackResult> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const out: RollbackResult = { deleted: [], skipped: [] }
  for (const docId of docIds) {
    if (!docId.startsWith('lc-reconcile-') && !docId.startsWith('ld-reconcile-')) {
      out.skipped.push({ docId, reason: 'Not a reconciliation row — refusing to delete.' })
      continue
    }
    try {
      await deleteDoc(doc(fs, LEDGER_COLLECTION, docId))
      out.deleted.push(docId)
    } catch (err) {
      out.skipped.push({
        docId,
        reason: err instanceof Error ? err.message : 'delete failed',
      })
    }
  }
  return out
}

// ── Mirror billingItems → items (Fix B for combo orphans) ────────────────
//
// Premise: many bookings were written with `items[i].gameId/subGameId/
// variantId/vendorId` left as empty strings (combo fan-out bug, since
// fixed) but their `billingItems[]` correctly carries the catalog IDs
// because the trigger/POS path computed splits properly. Mirroring the
// truth from billingItems → items is purely metadata propagation —
// nothing about the ledger or money moves. After this fix, the orphan
// check (which reads items[].gameId) no longer flags these.
//
// The function works at booking level so the UI can show admin exactly
// what will change before they click Apply.

export interface MirrorChange {
  /** Index in `items[]`. */
  itemIndex: number
  itemName: string
  /** What the item currently has (empty strings shown as ''). */
  before: {
    gameId: string
    subGameId: string
    variantId: string
    vendorId: string
    unitPrice: number
    quantity: number
  }
  /** What it will become — IDs sourced from one of the truth sources below. */
  after: {
    gameId: string
    subGameId: string
    variantId: string
    vendorId: string
    unitPrice: number
    quantity: number
  }
  /** Which source supplied the IDs. Tried in order:
   *   billing-variantId → billing-itemName → combo-doc →
   *   event-package-doc → catalog-exact → none. */
  matchedVia:
    | 'billing-variantId'
    | 'billing-itemName'
    | 'combo-doc'
    | 'event-package-doc'
    | 'catalog-exact'
    | 'none'
}

export interface MirrorPreview {
  bookingId: string
  branchId: string
  date: string
  /** Total items in the booking. */
  totalItems: number
  /** Items that were orphan (empty gameId) and have a billing match. */
  changes: MirrorChange[]
  /** Items that are orphan but couldn't be matched in billingItems[]. */
  unmatched: Array<{ itemIndex: number; itemName: string; reason: string }>
  /** Items that already have catalog IDs (no change). */
  alreadyClean: number
}

const isOrphanItem = (it: Record<string, unknown>): boolean => {
  const g = typeof it?.gameId === 'string' ? it.gameId.trim() : ''
  return !g || g === 'unknown'
}

/**
 * Find all combo orphan bookings that can be fixed by mirroring billing
 * IDs onto items, and compute a per-booking preview of what will change.
 * `bookingIds` lets the UI re-preview specific bookings (e.g., after
 * applying a subset). When omitted, every orphan in the DB is scanned.
 */
/**
 * Build per-item lookup indexes from the 3 secondary truth sources:
 * combos, eventCampaigns, and the catalog hierarchy. Used by the orphan
 * mirror so when billingItems[] doesn't have the catalog IDs, we can
 * cascade to combo doc → event-package doc → catalog exact-name match.
 *
 * All matching is exact (case + extra-spaces normalized). No fuzzy
 * heuristics. Each index keyed so the lookup is O(1) per orphan item.
 */
/**
 * Normalize an item label so the same words match across separator
 * conventions. Different layers in this codebase use different glyphs:
 *   - catalog `composedLabel` uses `•` (bullet)
 *   - booking item names use `—` (em-dash) or `–` (en-dash)
 *   - some legacy POS labels use `·` (middot)
 * All of these collapse to a single space here so lookup is exact on
 * words, not on punctuation. Still strict — never fuzzy / token-match.
 */
const normName = (s: string): string =>
  (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[—–•·-]/g, ' ')
    .replace(/\s+/g, ' ')

interface TruthHit {
  gameId: string
  subGameId: string
  variantId: string
  vendorId: string
  /** Per-line price from the truth source. Only populated for
   *  billing-* sources where the booking's billingItems[] is the
   *  canonical record. Other sources leave it undefined so items[]
   *  unitPrice is not modified. */
  unitPrice?: number
  /** Quantity from the truth source. Same scoping as unitPrice. */
  quantity?: number
}

const buildOrphanTruthIndexes = async (): Promise<{
  comboByName: Map<string, Map<string, TruthHit>> // comboName → childName → hit
  eventByName: Map<string, TruthHit> // "campaign — package — item" → hit
  catalogByLabel: Map<string, TruthHit> // composedLabel → hit (exact normalized)
}> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const [comboSnap, campaignSnap] = await Promise.all([
    getDocs(collection(fs, 'combos')),
    getDocs(collection(fs, 'eventCampaigns')),
  ])
  const comboByName = new Map<string, Map<string, TruthHit>>()
  comboSnap.forEach((d) => {
    const c = d.data() as Record<string, unknown>
    if (c.status && c.status !== 'Active') return
    const name = normName(String(c.name ?? ''))
    if (!name) return
    const items = Array.isArray(c.items) ? (c.items as Array<Record<string, unknown>>) : []
    const childMap = comboByName.get(name) ?? new Map<string, TruthHit>()
    for (const i of items) {
      const childName = normName(String(i?.itemName ?? ''))
      if (!childName) continue
      childMap.set(childName, {
        gameId: typeof i?.gameId === 'string' ? i.gameId : '',
        subGameId: typeof i?.subGameId === 'string' ? i.subGameId : '',
        variantId: typeof i?.variantId === 'string' ? i.variantId : '',
        vendorId: typeof i?.vendorId === 'string' ? i.vendorId : '',
      })
    }
    comboByName.set(name, childMap)
  })
  const eventByName = new Map<string, TruthHit>()
  // Slug helper — matches the convention used elsewhere in the codebase
  // (lowercase, non-alphanum → underscore). For event-package items the
  // campaign doesn't carry catalog IDs, so we synthesize them from the
  // campaign / package / item names. Same value across runs since slugs
  // are deterministic — re-running the mirror is idempotent.
  const slug = (s: string): string =>
    (s ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .join('_')
  // Extract the "head" portion of an item name — everything before the
  // first " - " or " – " separator. Example: "Paint Ball - 15 bullets"
  // → "Paint Ball". Used as an alternate match key when bookings drop
  // the descriptor suffix. Only registered when the head is unique
  // within its package so we never resolve ambiguously.
  const headOf = (s: string): string => {
    const m = s.match(/^(.+?)\s+[-–—]\s+/)
    return m ? m[1] : s
  }
  campaignSnap.forEach((d) => {
    const c = d.data() as Record<string, unknown>
    const campaignName = String(c.title ?? c.name ?? '')
    const campaignSlug = String(c.slug ?? slug(campaignName) ?? d.id)
    const packages = Array.isArray(c.packages) ? (c.packages as Array<Record<string, unknown>>) : []
    for (const p of packages) {
      const pkgName = String(p.title ?? p.name ?? '')
      const items = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : []
      // First pass: count head occurrences within this package so we can
      // tell which heads are unique.
      const headCounts = new Map<string, number>()
      for (const i of items) {
        const itemName = String(i?.name ?? '')
        if (!itemName) continue
        const h = normName(headOf(itemName))
        headCounts.set(h, (headCounts.get(h) ?? 0) + 1)
      }
      for (const i of items) {
        const itemName = String(i?.name ?? '')
        if (!itemName) continue
        const hit: TruthHit = {
          gameId:
            typeof i?.gameId === 'string' && i.gameId
              ? (i.gameId as string)
              : campaignSlug || slug(campaignName),
          subGameId:
            typeof i?.subGameId === 'string' && i.subGameId
              ? (i.subGameId as string)
              : slug(pkgName),
          variantId:
            typeof i?.variantId === 'string' && i.variantId
              ? (i.variantId as string)
              : slug(itemName),
          vendorId: typeof i?.vendorId === 'string' ? i.vendorId : '',
        }
        if (!hit.gameId || !hit.subGameId) continue
        const head = headOf(itemName)
        const headIsUnique = headCounts.get(normName(head)) === 1
        // Build candidate keys for multiple booking-item-name formats.
        const names = [itemName]
        // Only register the head form when it's unambiguous within the package.
        if (headIsUnique && head !== itemName) names.push(head)
        for (const n of names) {
          const candidates = [
            `${campaignName} — ${pkgName} — ${n}`,
            `${campaignName} • ${pkgName} • ${n}`,
            `${pkgName} • ${n}`,
            `${pkgName} — ${n}`,
            n,
          ].map(normName)
          for (const k of candidates) if (k && !eventByName.has(k)) eventByName.set(k, hit)
        }
      }
    }
  })
  // Catalog index — walks locations/{branch}/games/{gameId}/subgames/{subId}/variants/{varId}.
  const catalogByLabel = new Map<string, TruthHit>()
  const catalog = await listCatalogOptions()
  for (const c of catalog) {
    const hit: TruthHit = {
      gameId: c.gameId,
      subGameId: c.subGameId,
      variantId: c.variantId,
      vendorId: typeof c.vendorId === 'string' ? c.vendorId : '',
    }
    catalogByLabel.set(normName(c.composedLabel), hit)
    catalogByLabel.set(normName(c.variantLabel), hit)
  }
  return { comboByName, eventByName, catalogByLabel }
}

export const previewCombooOrphanMirror = async (
  bookingIds?: string[],
): Promise<MirrorPreview[]> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const truth = await buildOrphanTruthIndexes()
  let docs: Array<{ id: string; data: Record<string, unknown> }>
  if (bookingIds && bookingIds.length > 0) {
    docs = []
    for (const id of bookingIds) {
      const s = await getDoc(doc(fs, BOOKINGS_COLLECTION, id))
      if (s.exists()) docs.push({ id: s.id, data: s.data() as Record<string, unknown> })
    }
  } else {
    const snap = await getDocs(collection(fs, BOOKINGS_COLLECTION))
    docs = []
    snap.forEach((d) => docs.push({ id: d.id, data: d.data() as Record<string, unknown> }))
  }
  const out: MirrorPreview[] = []
  for (const { id, data } of docs) {
    if (data.cancelled === true) continue
    if (data.deletedAt || data.voidedAt) continue
    if (data.paymentStatus && data.paymentStatus !== 'completed') continue
    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
    if (items.length === 0) continue
    const billing = Array.isArray(data.billingItems)
      ? (data.billingItems as Array<Record<string, unknown>>)
      : []
    // Two reasons to scan a booking:
    //  (a) at least one orphan item (missing gameId) — the original
    //      Mirror behaviour, runs the full truth cascade.
    //  (b) at least one non-orphan item whose unitPrice / quantity /
    //      vendorId disagrees with billingItems[] — closes the audit
    //      headline's A vs B price-drift gap.
    // Both produce MirrorChanges; if neither holds, the booking is
    // skipped entirely.
    const orphanIdxs = items.map((it, i) => (isOrphanItem(it) ? i : -1)).filter((i) => i >= 0)
    const driftIdxs: number[] = []
    if (billing.length > 0) {
      for (let i = 0; i < items.length; i++) {
        if (isOrphanItem(items[i])) continue // already covered by orphanIdxs
        const it = items[i]
        const variantId = typeof it?.variantId === 'string' ? it.variantId : ''
        const itemName = typeof it?.itemName === 'string' ? it.itemName : ''
        const m = billing.find(
          (b) =>
            (variantId && typeof b?.variantId === 'string' && b.variantId === variantId) ||
            (itemName &&
              typeof b?.itemName === 'string' &&
              normName(b.itemName) === normName(itemName)),
        )
        if (!m) continue
        const itemUnit = Number(it?.unitPrice ?? it?.price) || 0
        const itemQty = Math.max(1, Math.floor(Number(it?.quantity) || 1))
        const itemVendor = typeof it?.vendorId === 'string' ? it.vendorId : ''
        const billingUnit = Number(m.unitPrice) || 0
        const billingQty = Math.max(1, Math.floor(Number(m.quantity) || 1))
        const billingVendor = typeof m.vendorId === 'string' ? m.vendorId : ''
        if (
          (billingUnit > 0 && itemUnit !== billingUnit) ||
          itemQty !== billingQty ||
          (billingVendor && itemVendor && billingVendor !== itemVendor)
        ) {
          driftIdxs.push(i)
        }
      }
    }
    if (orphanIdxs.length === 0 && driftIdxs.length === 0) continue

    const changes: MirrorChange[] = []
    const unmatched: Array<{ itemIndex: number; itemName: string; reason: string }> = []
    // First pass: drift items get a direct billing-row match — no cascade
    // (cascade is for missing IDs; drift items have IDs but wrong values).
    for (const idx of driftIdxs) {
      const it = items[idx]
      const itemName = typeof it?.itemName === 'string' ? it.itemName : ''
      const variantId = typeof it?.variantId === 'string' ? it.variantId : ''
      const m = billing.find(
        (b) =>
          (variantId && typeof b?.variantId === 'string' && b.variantId === variantId) ||
          (itemName &&
            typeof b?.itemName === 'string' &&
            normName(b.itemName) === normName(itemName)),
      )
      if (!m) continue
      const itemQty = Math.max(1, Math.floor(Number(it?.quantity) || 1))
      const itemUnit = Number(it?.unitPrice ?? it?.price) || 0
      const billingQty = Math.max(1, Math.floor(Number(m.quantity) || 1))
      const billingUnit = Number(m.unitPrice) || 0
      const via: MirrorChange['matchedVia'] =
        variantId && typeof m.variantId === 'string' && m.variantId === variantId
          ? 'billing-variantId'
          : 'billing-itemName'
      changes.push({
        itemIndex: idx,
        itemName: itemName || '(no name)',
        before: {
          gameId: typeof it?.gameId === 'string' ? it.gameId : '',
          subGameId: typeof it?.subGameId === 'string' ? it.subGameId : '',
          variantId: typeof it?.variantId === 'string' ? it.variantId : '',
          vendorId: typeof it?.vendorId === 'string' ? it.vendorId : '',
          unitPrice: itemUnit,
          quantity: itemQty,
        },
        after: {
          gameId:
            typeof m.gameId === 'string' && m.gameId
              ? m.gameId
              : typeof it?.gameId === 'string'
                ? it.gameId
                : '',
          subGameId:
            typeof m.subGameId === 'string' && m.subGameId
              ? m.subGameId
              : typeof it?.subGameId === 'string'
                ? it.subGameId
                : '',
          variantId:
            typeof m.variantId === 'string' && m.variantId
              ? m.variantId
              : typeof it?.variantId === 'string'
                ? it.variantId
                : '',
          vendorId:
            typeof m.vendorId === 'string' && m.vendorId
              ? m.vendorId
              : typeof it?.vendorId === 'string'
                ? it.vendorId
                : '',
          unitPrice: billingUnit > 0 ? billingUnit : itemUnit,
          quantity: billingQty,
        },
        matchedVia: via,
      })
    }
    // Second pass: orphan items go through the full cascade (existing).
    for (const idx of orphanIdxs) {
      const it = items[idx]
      const itemName =
        (typeof it?.itemName === 'string' && it.itemName) ||
        (typeof (it?.activity as { name?: string })?.name === 'string'
          ? ((it.activity as { name?: string }).name as string)
          : '') ||
        '(no name)'
      const variantId = typeof it?.variantId === 'string' ? it.variantId : ''

      // Cascade truth sources in priority order. First match wins. Each
      // source is exact match — never fuzzy.
      let after: TruthHit | null = null
      let via: MirrorChange['matchedVia'] = 'none'

      // Detect combo-pattern itemName up front; if it matches a combo
      // child in the combos collection, that's the canonical truth and
      // takes priority over billingItems (which might carry synthetic IDs
      // written by a prior Apply round). Two split strategies:
      //   a) Explicit "combo • child" (bullet separator).
      //   b) Em-dash / hyphen prefix: iterate combo names, accept only
      //      when the remaining tail matches a known child in that
      //      combo's childMap. The "tail must be a known child" rule
      //      prevents prefix ambiguity (e.g., a combo whose name is a
      //      prefix of another combo's name resolving incorrectly).
      let comboHit: TruthHit | null = null
      const bulletSplit = itemName.match(/^(.+?)\s+•\s+(.+)$/)
      if (bulletSplit) {
        const childMap = truth.comboByName.get(normName(bulletSplit[1]))
        const hit = childMap?.get(normName(bulletSplit[2]))
        if (hit && hit.gameId && hit.subGameId) comboHit = hit
      }
      if (!comboHit) {
        const normItem = normName(itemName)
        // Try every combo name as a prefix; longest-first so a child
        // belonging to "BUSINESS COMBO1" wins over "BUSINESS COMBO".
        const comboNames = [...truth.comboByName.keys()].sort((a, b) => b.length - a.length)
        for (const cname of comboNames) {
          if (!normItem.startsWith(cname + ' ')) continue
          const tail = normItem.slice(cname.length + 1)
          const childMap = truth.comboByName.get(cname)
          const hit = childMap?.get(tail)
          if (hit && hit.gameId && hit.subGameId) {
            comboHit = hit
            break
          }
        }
      }

      // 1. Combo doc — preferred when itemName matches a combo child.
      if (!after && comboHit) {
        after = comboHit
        via = 'combo-doc'
      }
      // 2. billingItems[] match by variantId — only if billingItems has
      // catalog-shaped IDs (a variantId without a colon prefix avoids the
      // `combo:...` synthetic IDs from older Apply rounds leaking back).
      if (!after && billing.length > 0 && variantId) {
        const m = billing.find((b) => typeof b?.variantId === 'string' && b.variantId === variantId)
        if (m) {
          const cand: TruthHit = {
            gameId: typeof m.gameId === 'string' ? m.gameId : '',
            subGameId: typeof m.subGameId === 'string' ? m.subGameId : '',
            variantId: typeof m.variantId === 'string' ? m.variantId : '',
            vendorId: typeof m.vendorId === 'string' ? m.vendorId : '',
            // billing-* sources also supply unitPrice/quantity so Mirror can
            // close the items[] vs billingItems[] divergence (the A vs B gap
            // in the audit headline).
            unitPrice: Number(m.unitPrice) || 0,
            quantity: Math.max(1, Math.floor(Number(m.quantity) || 1)),
          }
          if (
            cand.gameId &&
            cand.subGameId &&
            !cand.gameId.includes(':') &&
            !cand.subGameId.includes(':')
          ) {
            after = cand
            via = 'billing-variantId'
          }
        }
      }
      // 3. billingItems[] match by exact itemName — same synthetic-id guard.
      if (!after && billing.length > 0) {
        const m = billing.find(
          (b) => typeof b?.itemName === 'string' && normName(b.itemName) === normName(itemName),
        )
        if (m) {
          const cand: TruthHit = {
            gameId: typeof m.gameId === 'string' ? m.gameId : '',
            subGameId: typeof m.subGameId === 'string' ? m.subGameId : '',
            variantId: typeof m.variantId === 'string' ? m.variantId : '',
            vendorId: typeof m.vendorId === 'string' ? m.vendorId : '',
            unitPrice: Number(m.unitPrice) || 0,
            quantity: Math.max(1, Math.floor(Number(m.quantity) || 1)),
          }
          if (
            cand.gameId &&
            cand.subGameId &&
            !cand.gameId.includes(':') &&
            !cand.subGameId.includes(':')
          ) {
            after = cand
            via = 'billing-itemName'
          }
        }
      }
      // 4. Event-package doc lookup — try the full normalized itemName,
      // then strip "(FREE)" / "(free)" / "(complimentary)" suffixes (used
      // by the POS to mark free seats inside a paid combo) and retry.
      if (!after) {
        const stripped = itemName.replace(/\s*\((free|complimentary)\)\s*$/i, '')
        const candidates = [normName(itemName), normName(stripped)]
        for (const key of candidates) {
          if (!key) continue
          const hit = truth.eventByName.get(key)
          if (hit && hit.gameId && hit.subGameId) {
            after = hit
            via = 'event-package-doc'
            break
          }
        }
      }
      // 5. Catalog exact label match (composedLabel or variantLabel).
      if (!after) {
        const hit = truth.catalogByLabel.get(normName(itemName))
        if (hit && hit.gameId && hit.subGameId) {
          after = hit
          via = 'catalog-exact'
        }
      }

      if (!after) {
        unmatched.push({
          itemIndex: idx,
          itemName,
          reason:
            'No truth source found. Tried billingItems (by variantId & itemName), combo doc, event-package doc, and catalog exact name match.',
        })
        continue
      }

      const itemQty = Math.max(1, Math.floor(Number(it?.quantity) || 1))
      const itemUnit = Number(it?.unitPrice ?? it?.price) || 0
      changes.push({
        itemIndex: idx,
        itemName,
        before: {
          gameId: typeof it?.gameId === 'string' ? it.gameId : '',
          subGameId: typeof it?.subGameId === 'string' ? it.subGameId : '',
          variantId: typeof it?.variantId === 'string' ? it.variantId : '',
          vendorId: typeof it?.vendorId === 'string' ? it.vendorId : '',
          unitPrice: itemUnit,
          quantity: itemQty,
        },
        after: {
          gameId: after.gameId,
          subGameId: after.subGameId,
          variantId: after.variantId,
          vendorId: after.vendorId,
          // unitPrice/quantity only diverge for billing-* sources (the
          // canonical record of what the customer paid). For other sources
          // we leave items[] price/qty alone — combo/event/catalog don't
          // know the as-billed quantity for this specific booking.
          unitPrice: typeof after.unitPrice === 'number' ? after.unitPrice : itemUnit,
          quantity: typeof after.quantity === 'number' ? after.quantity : itemQty,
        },
        matchedVia: via,
      })
    }
    if (changes.length === 0 && unmatched.length === 0) continue
    out.push({
      bookingId: id,
      branchId: String(data.locationId ?? ''),
      date: dateOnly(data.transactionDate ?? data.createdAt),
      totalItems: items.length,
      changes,
      unmatched,
      alreadyClean: items.length - orphanIdxs.length,
    })
  }
  return out
}

export interface ApplyMirrorResult {
  succeeded: Array<{ bookingId: string; itemsChanged: number }>
  failed: Array<{ bookingId: string; error: string }>
}

/**
 * Apply a list of mirror previews to Firestore. For each booking, writes
 * a new `items[]` array where every change in the preview overwrites the
 * empty-string IDs with the values pulled from billingItems. Items that
 * weren't orphan (or weren't matched) are unchanged. Stamps
 * `enrichmentSource: 'admin-mirror-billing'` so the audit trail records
 * the source of the fix.
 */
export const applyComboOrphanMirror = async (
  previews: MirrorPreview[],
  resolvedBy: { id: string; name: string },
  onProgress?: (done: number, total: number, current?: string) => void,
): Promise<ApplyMirrorResult> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const out: ApplyMirrorResult = { succeeded: [], failed: [] }
  for (let i = 0; i < previews.length; i++) {
    const pv = previews[i]
    if (pv.changes.length === 0) {
      onProgress?.(i + 1, previews.length, pv.bookingId)
      continue
    }
    try {
      const ref = doc(fs, BOOKINGS_COLLECTION, pv.bookingId)
      const snap = await getDoc(ref)
      if (!snap.exists()) throw new Error(`Booking ${pv.bookingId} not found.`)
      const data = snap.data() as Record<string, unknown>
      const items = Array.isArray(data.items)
        ? [...(data.items as Array<Record<string, unknown>>)]
        : []
      for (const ch of pv.changes) {
        if (ch.itemIndex < 0 || ch.itemIndex >= items.length) continue
        const cur = items[ch.itemIndex]
        // Only write unitPrice/quantity when the truth side actually
        // differs from the current value (preview shows them in
        // before/after). Mirror is metadata-only; do not touch fields the
        // admin or POS deliberately set unless billing canonically
        // disagrees. Money math is unaffected — cheques compute from
        // billingItems[].vendorTotal which is unchanged here.
        const overwriteUnit = ch.before.unitPrice !== ch.after.unitPrice && ch.after.unitPrice > 0
        const overwriteQty = ch.before.quantity !== ch.after.quantity && ch.after.quantity > 0
        items[ch.itemIndex] = {
          ...cur,
          gameId: ch.after.gameId,
          subGameId: ch.after.subGameId,
          variantId: ch.after.variantId,
          // Only overwrite vendorId when it's currently empty — never clobber
          // an explicit vendor stamp the admin/POS may have set deliberately.
          vendorId:
            typeof cur.vendorId === 'string' && (cur.vendorId as string).trim()
              ? cur.vendorId
              : ch.after.vendorId,
          ...(overwriteUnit ? { unitPrice: ch.after.unitPrice } : {}),
          ...(overwriteQty ? { quantity: ch.after.quantity } : {}),
        }
      }
      await setDoc(
        ref,
        {
          items,
          enrichmentSource: 'admin-mirror-billing',
          enrichmentResolvedBy: resolvedBy.id,
          enrichmentResolvedByName: resolvedBy.name,
          enrichmentResolvedAt: new Date().toISOString(),
        },
        { merge: true },
      )
      const logId = `${pv.bookingId}_mirror-billing_${Date.now()}`
      await setDoc(doc(fs, LOG_COLLECTION, logId), {
        id: logId,
        bookingId: pv.bookingId,
        kind: 'mirror-billing-to-items',
        itemsChanged: pv.changes.length,
        details: pv.changes.map((c) => ({
          itemIndex: c.itemIndex,
          itemName: c.itemName,
          before: c.before,
          after: c.after,
          matchedVia: c.matchedVia,
        })),
        resolvedBy: resolvedBy.id,
        resolvedByName: resolvedBy.name,
        resolvedAt: new Date().toISOString(),
      })
      out.succeeded.push({ bookingId: pv.bookingId, itemsChanged: pv.changes.length })
    } catch (err) {
      out.failed.push({
        bookingId: pv.bookingId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    onProgress?.(i + 1, previews.length, pv.bookingId)
  }
  return out
}

export const listVendorOptions = async (): Promise<VendorOption[]> => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  const snap = await getDocs(collection(fs, 'vendorDetails'))
  return snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>
      return {
        id: d.id,
        name: String(data.vendorName || data.userName || d.id),
        branch: String(data.branch || ''),
        branchId: typeof data.branchId === 'string' ? data.branchId : '',
        vendorType: data.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty',
        preferredActivity: String(data.preferredActivity || ''),
        revenueShare: typeof data.revenueShare === 'number' ? data.revenueShare : 80,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
