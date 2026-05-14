/**
 * Pre-write invariant validator for booking documents.
 *
 * Every booking writer (POS unified-booking, customer-app submitOrder,
 * Razorpay webhook capture, orphan resolver Apply) calls this before
 * persisting. Failures throw `ValidationError` so the broken booking
 * never reaches Firestore. Single choke point — adding a new writer in
 * the future inherits all guards for free.
 *
 * The checks codify the "single canonical shape" that every read-side
 * pipeline (vendor-ledger-sync trigger, audit, Game Revenue, cheque
 * generator) already assumes. Drift between writers is the root cause
 * of every orphan / audit issue we've fixed in this codebase, so this
 * file is the durable fix.
 *
 * NOTE: Validation is pure. It does no Firestore reads. Caller passes
 * the in-memory booking object; we return a list of failures. Caller
 * decides whether to throw, log, or surface them in UI.
 */
import { ValidationError } from '../types/errors'

const TOLERANCE_INR = 2

export interface ValidatableBookingItem {
  itemName?: string
  quantity?: number
  unitPrice?: number
  price?: number
  gameId?: string
  subGameId?: string
  variantId?: string
  vendorId?: string
  itemBaseAmount?: number
  itemGstAmount?: number
  _isMisc?: boolean
}

export interface ValidatableBillingItem {
  itemName?: string
  quantity?: number
  unitPrice?: number
  gameId?: string
  subGameId?: string
  variantId?: string
  vendorId?: string
  vendorTotal?: number
  itemBaseAmount?: number
  itemGstAmount?: number
}

export interface ValidatableBooking {
  id?: string
  items?: ValidatableBookingItem[]
  billingItems?: ValidatableBillingItem[]
  vendorIds?: string[]
  finalAmount?: number
  subTotal?: number
  totalAmount?: number
  discountAmount?: number
  couponAmount?: number
  walletAmountUsed?: number
  cancelled?: boolean
  refundStatus?: string
}

export type ValidationCode =
  | 'item-missing-catalog-ids'
  | 'item-name-blank'
  | 'cart-total-mismatch'
  | 'vendor-ids-out-of-sync'
  | 'billing-vs-items-vendor-mismatch'
  | 'billing-vs-items-catalog-mismatch'
  | 'billing-vs-items-price-mismatch'
  | 'billing-zero-out-via-negative-lines'

export interface ValidationFailure {
  code: ValidationCode
  /** One-line, admin-readable. */
  message: string
  /** Optional details for the logger / UI (per-item indices etc.). */
  detail?: Record<string, unknown>
}

export interface ValidationResult {
  ok: boolean
  failures: ValidationFailure[]
}

/**
 * Run all invariants against a booking. Returns the full list of
 * failures (does NOT throw) so callers can decide policy. The most
 * common policy is `throwIfInvalid` below — call that from writers.
 */
export const validateBooking = (booking: ValidatableBooking): ValidationResult => {
  const failures: ValidationFailure[] = []
  const items = booking.items ?? []
  const billingItems = booking.billingItems ?? []

  // ── Check 1: every items[i] has gameId AND subGameId (or _isMisc=true).
  // Catches: combo fan-out regressions, customer-app drift, any new
  // writer that forgets to stamp catalog IDs on items[].
  const orphanIdxs: number[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i] ?? {}
    if (it._isMisc === true) continue
    const g = (it.gameId ?? '').trim()
    const s = (it.subGameId ?? '').trim()
    if (!g || !s) orphanIdxs.push(i)
  }
  if (orphanIdxs.length > 0) {
    failures.push({
      code: 'item-missing-catalog-ids',
      message: `Items at indices [${orphanIdxs.join(', ')}] are missing gameId or subGameId. Either stamp catalog IDs from the catalog/combo/event-package source, or set _isMisc:true if the item is genuinely miscellaneous.`,
      detail: { itemIndices: orphanIdxs },
    })
  }

  // ── Check 2: every items[i] has a non-blank itemName.
  // Catches: misc items written without a name, downstream rendering
  // gets "Unnamed activity".
  const blankNameIdxs: number[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i] ?? {}
    const name = (it.itemName ?? '').trim()
    if (!name) blankNameIdxs.push(i)
  }
  if (blankNameIdxs.length > 0) {
    failures.push({
      code: 'item-name-blank',
      message: `Items at indices [${blankNameIdxs.join(', ')}] have a blank itemName.`,
      detail: { itemIndices: blankNameIdxs },
    })
  }

  // ── Check 3: cart total math sanity.
  // Σ (qty × unitPrice) ≈ finalAmount + discount + wallet.
  // Catches: phantom duplicate combo lines (one paid, two in items[]).
  const finalAmount = Number(booking.finalAmount) || 0
  const discountAmount = Number(booking.discountAmount) || Number(booking.couponAmount) || 0
  const walletAmountUsed = Number(booking.walletAmountUsed) || 0
  const expectedItemsSum = finalAmount + discountAmount + walletAmountUsed
  if (expectedItemsSum > 0 && items.length > 0) {
    let actualItemsSum = 0
    for (const it of items) {
      const qty = Math.max(1, Math.floor(Number(it?.quantity) || 1))
      const unit = Number(it?.unitPrice ?? it?.price) || 0
      actualItemsSum += qty * unit
    }
    if (Math.abs(actualItemsSum - expectedItemsSum) > TOLERANCE_INR) {
      failures.push({
        code: 'cart-total-mismatch',
        message: `Items sum (${actualItemsSum}) does not match finalAmount + discounts + wallet (${expectedItemsSum}). Cart and bill disagree by ${Math.round(actualItemsSum - expectedItemsSum)}.`,
        detail: {
          actualItemsSum,
          expectedItemsSum,
          finalAmount,
          discountAmount,
          walletAmountUsed,
        },
      })
    }
  }

  // ── Check 4: vendorIds[] = unique(non-empty items[].vendorId).
  // Catches: stale array drift (Jagadish rjy on bookings he doesn't own).
  const itemVendorIds = new Set<string>()
  for (const it of items) {
    const v = (it?.vendorId ?? '').trim()
    if (v) itemVendorIds.add(v)
  }
  const declared = new Set((booking.vendorIds ?? []).filter(Boolean))
  const onlyInDeclared: string[] = []
  const onlyInItems: string[] = []
  for (const v of declared) if (!itemVendorIds.has(v)) onlyInDeclared.push(v)
  for (const v of itemVendorIds) if (!declared.has(v)) onlyInItems.push(v)
  if (onlyInDeclared.length > 0 || onlyInItems.length > 0) {
    failures.push({
      code: 'vendor-ids-out-of-sync',
      message: `vendorIds[] is out of sync with items[].vendorId. Tagged but not on items: [${onlyInDeclared.join(', ') || 'none'}]. On items but not tagged: [${onlyInItems.join(', ') || 'none'}].`,
      detail: { tagsWithoutItems: onlyInDeclared, itemsWithoutTags: onlyInItems },
    })
  }

  // ── Check 5: each items[i].vendorId matches the billingItems row for the
  // same item. We match by variantId first, then itemName.
  // Catches: vendor-stamp drift between the two arrays.
  if (billingItems.length > 0) {
    const vendorMismatchIdxs: Array<{
      itemIndex: number
      itemsVendorId: string
      billingVendorId: string
    }> = []
    const catalogMismatchIdxs: Array<{
      itemIndex: number
      itemsCatalog: string
      billingCatalog: string
    }> = []
    const priceMismatchIdxs: Array<{
      itemIndex: number
      itemsUnit: number
      itemsQty: number
      billingUnit: number
      billingQty: number
    }> = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i] ?? {}
      const variantId = (it.variantId ?? '').trim()
      const itemName = (it.itemName ?? '').trim()
      const bMatch = billingItems.find((b) => {
        if (variantId && (b?.variantId ?? '') === variantId) return true
        if (itemName && (b?.itemName ?? '') === itemName) return true
        return false
      })
      if (!bMatch) continue
      const itemsVendor = (it.vendorId ?? '').trim()
      const billingVendor = (bMatch.vendorId ?? '').trim()
      if (itemsVendor !== billingVendor) {
        vendorMismatchIdxs.push({
          itemIndex: i,
          itemsVendorId: itemsVendor || '(empty)',
          billingVendorId: billingVendor || '(empty)',
        })
      }
      const itemsCatalog = `${it.gameId ?? ''}/${it.subGameId ?? ''}/${it.variantId ?? ''}`
      const billingCatalog = `${bMatch.gameId ?? ''}/${bMatch.subGameId ?? ''}/${bMatch.variantId ?? ''}`
      if (
        itemsCatalog !== billingCatalog &&
        // Allow billing to be empty when items has the IDs (the trigger
        // sometimes runs in two phases). Mismatch is only when BOTH have
        // values and they differ.
        billingCatalog !== '//' &&
        itemsCatalog !== '//'
      ) {
        catalogMismatchIdxs.push({
          itemIndex: i,
          itemsCatalog,
          billingCatalog,
        })
      }
      // Price / quantity sync check. Catches the audit headline A vs B
      // gap (e.g., items[].unitPrice = 520 while billingItems[].unitPrice
      // = 130 for the same combo line). Both arrays must agree on what
      // was sold for the same item.
      const itemsUnit = Number(it.unitPrice ?? it.price) || 0
      const itemsQty = Math.max(1, Math.floor(Number(it.quantity) || 1))
      const billingUnit = Number(bMatch.unitPrice) || 0
      const billingQty = Math.max(1, Math.floor(Number(bMatch.quantity) || 1))
      if (
        billingUnit > 0 &&
        itemsUnit > 0 &&
        // Allow ±₹2 rounding on per-item price.
        (Math.abs(itemsUnit - billingUnit) > 2 || itemsQty !== billingQty)
      ) {
        priceMismatchIdxs.push({
          itemIndex: i,
          itemsUnit,
          itemsQty,
          billingUnit,
          billingQty,
        })
      }
    }
    if (vendorMismatchIdxs.length > 0) {
      failures.push({
        code: 'billing-vs-items-vendor-mismatch',
        message: `${vendorMismatchIdxs.length} item(s) have items[].vendorId different from billingItems[].vendorId.`,
        detail: { mismatches: vendorMismatchIdxs },
      })
    }
    if (catalogMismatchIdxs.length > 0) {
      failures.push({
        code: 'billing-vs-items-catalog-mismatch',
        message: `${catalogMismatchIdxs.length} item(s) have items[] catalog IDs different from billingItems[] catalog IDs.`,
        detail: { mismatches: catalogMismatchIdxs },
      })
    }
    if (priceMismatchIdxs.length > 0) {
      failures.push({
        code: 'billing-vs-items-price-mismatch',
        message: `${priceMismatchIdxs.length} item(s) have items[].unitPrice or quantity different from billingItems[]. Both arrays must agree on what was sold for the same item.`,
        detail: { mismatches: priceMismatchIdxs },
      })
    }
  }

  // ── Check 6: zero-out via negative billingItems[].
  // Forbidden state: finalAmount ≈ 0 on a billed (totalAmount > 0) booking
  // that carries any negative itemBaseAmount or itemGstAmount and is NOT
  // cancelled / refunded. This is the "subtract-to-zero" hack — cashiers
  // flip the second item's base/gst negative to cancel the first item's
  // positive base/gst, which makes the bill look free while leaving the
  // booking confirmed and the line items pointed at real vendors. The
  // side effect is wrong-vendor-stamp audit rows and broken vendor
  // accounting (the negative line debits a vendor's per-item split).
  //
  // Legitimate "free booking" paths: set cancelled=true (cancellation)
  // OR refundStatus='full'/'refunded'/'partial' (refund flow). Both keep
  // the original positive line items intact so vendor totals remain
  // correct.
  //
  // Legitimate "discount" paths: model the discount via `discountAmount`
  // / `couponAmount` on the booking, NOT by flipping a line item negative.
  if (billingItems.length > 0) {
    const finalNearZero = Math.abs(Number(booking.finalAmount) || 0) <= TOLERANCE_INR
    const totalGtZero = (Number(booking.totalAmount) || 0) > TOLERANCE_INR
    const hasNegativeLine = billingItems.some(
      (b) =>
        (Number(b?.itemBaseAmount) || 0) < -TOLERANCE_INR ||
        (Number(b?.itemGstAmount) || 0) < -TOLERANCE_INR,
    )
    const isCancelled = booking.cancelled === true
    const refundStatus = (booking.refundStatus ?? '').toLowerCase()
    const isRefunded = ['full', 'refunded', 'partial'].includes(refundStatus)
    if (finalNearZero && totalGtZero && hasNegativeLine && !isCancelled && !isRefunded) {
      failures.push({
        code: 'billing-zero-out-via-negative-lines',
        message:
          'Booking has finalAmount=0 with negative billingItems[] amounts but is not cancelled or refunded. ' +
          'Do not zero out a bill by flipping line items negative — it breaks vendor accounting. ' +
          'To make a booking free, set cancelled=true or use the refund flow.',
        detail: {
          finalAmount: booking.finalAmount,
          totalAmount: booking.totalAmount,
          cancelled: booking.cancelled,
          refundStatus: booking.refundStatus,
          negativeLines: billingItems
            .map((b, i) => ({
              index: i,
              itemName: b?.itemName,
              itemBaseAmount: b?.itemBaseAmount,
              itemGstAmount: b?.itemGstAmount,
            }))
            .filter(
              (b) =>
                (Number(b.itemBaseAmount) || 0) < -TOLERANCE_INR ||
                (Number(b.itemGstAmount) || 0) < -TOLERANCE_INR,
            ),
        },
      })
    }
  }

  return { ok: failures.length === 0, failures }
}

/**
 * Strict mode: throws if invalid. Use this from writer call sites
 * before `setDoc`.
 */
export const throwIfInvalid = (booking: ValidatableBooking, context?: string): void => {
  const r = validateBooking(booking)
  if (r.ok) return
  const summary = r.failures.map((f) => `[${f.code}] ${f.message}`).join('  •  ')
  throw new ValidationError(
    `Booking invariants failed${context ? ` (${context})` : ''}: ${summary}`,
  )
}

/**
 * Surgical guard for the "subtract-to-zero" hack — call this at every
 * billing-write boundary even if the full validator isn't wired yet.
 * Throws ValidationError if the booking is the specific pathological
 * shape (finalAmount=0, totalAmount>0, has negative billingItems, not
 * cancelled/refunded). Other invariants are not checked.
 *
 * The wider `throwIfInvalid` was not historically called by the POS
 * writers, so legacy data may not satisfy the full check set. This
 * function lets us close the zero-out hole without risking regressions
 * from the broader validator.
 */
export const assertNoZeroOutHack = (booking: ValidatableBooking, context?: string): void => {
  // Check both arrays — writers disagree on which one carries the
  // itemBaseAmount/itemGstAmount fields. `billingItems[]` is the
  // canonical shape (createUnifiedBooking writes here). `items[]`
  // sometimes carries the same fields when createBilling in
  // billing-firestore.ts is the writer. Treat them as one set.
  const candidates = [
    ...(booking.billingItems ?? []),
    ...((booking.items ?? []).filter(
      (it) => it?.itemBaseAmount !== undefined || it?.itemGstAmount !== undefined,
    ) as Array<{ itemBaseAmount?: number; itemGstAmount?: number }>),
  ]
  if (candidates.length === 0) return

  const finalNearZero = Math.abs(Number(booking.finalAmount) || 0) <= TOLERANCE_INR
  const totalGtZero = (Number(booking.totalAmount) || 0) > TOLERANCE_INR
  if (!finalNearZero || !totalGtZero) return
  const hasNegativeLine = candidates.some(
    (b) =>
      (Number(b?.itemBaseAmount) || 0) < -TOLERANCE_INR ||
      (Number(b?.itemGstAmount) || 0) < -TOLERANCE_INR,
  )
  if (!hasNegativeLine) return
  if (booking.cancelled === true) return
  const refundStatus = (booking.refundStatus ?? '').toLowerCase()
  if (['full', 'refunded', 'partial'].includes(refundStatus)) return

  throw new ValidationError(
    `Booking has finalAmount=0 with negative line-item amounts (itemBaseAmount/itemGstAmount) but is not cancelled or refunded${
      context ? ` (${context})` : ''
    }. Do not zero out a bill by flipping line items negative — it breaks vendor accounting. To make a booking free, set cancelled=true or use the refund flow.`,
  )
}
