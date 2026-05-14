/**
 * Pure helpers for applying ₹150 member coupons against a Create-Booking-Link cart.
 *
 * Coupon rules (locked decisions on plan):
 *   • Coupons apply only to line items whose `activity.category === 'gokarting'`.
 *   • One coupon discounts ONE Go-Karting unit (per-unit, not per-line). A line
 *     with qty=2 may consume up to 2 coupons.
 *   • Distribution is greedy in cart order — fill the first eligible line first,
 *     spill into the next once exhausted, until coupons run out.
 *   • One coupon = ₹150 off (`COUPON_FACE_VALUE`).
 *   • Capped at the customer's available coupon count.
 *
 * No React, no Firebase, no I/O — pure functions only so they can be unit-tested
 * trivially and pulled into the BookingsModule via a `useMemo`.
 */

export const COUPON_FACE_VALUE = 150
export const COUPON_EARN_THRESHOLD = 600
export const COUPON_ELIGIBLE_CATEGORY = 'gokarting'

export interface CouponApplicationLineInput {
  /** Activity category — only `'gokarting'` lines are eligible. */
  category: string
  /** Per-unit price for this line. */
  price: number
  /** Quantity of units for this line. */
  qty: number
}

export interface CouponApplicationResult {
  /** Per-line count of units that received a coupon discount, in input order. */
  perLineUnitsApplied: number[]
  /** Per-line rupee value of the coupon discount on that line. */
  perLineDiscount: number[]
  /** Total coupons consumed across all lines. */
  couponsApplied: number
  /** Total rupee value of the coupon discount = couponsApplied × COUPON_FACE_VALUE. */
  couponDiscount: number
}

export interface CouponApplicationParams {
  items: CouponApplicationLineInput[]
  couponsAvailable: number
}

/**
 * Greedy per-unit fill of available coupons against eligible cart lines.
 * Lines are visited in their original order; each line consumes
 * `min(remainingCoupons, line.qty)` units before moving to the next.
 */
export const applyMemberCoupons = ({
  items,
  couponsAvailable,
}: CouponApplicationParams): CouponApplicationResult => {
  const perLineUnitsApplied: number[] = items.map(() => 0)
  const perLineDiscount: number[] = items.map(() => 0)

  if (couponsAvailable <= 0 || items.length === 0) {
    return {
      perLineUnitsApplied,
      perLineDiscount,
      couponsApplied: 0,
      couponDiscount: 0,
    }
  }

  let remaining = Math.max(0, Math.floor(couponsAvailable))
  let total = 0

  for (let i = 0; i < items.length; i++) {
    if (remaining <= 0) break
    const line = items[i]
    if (line.category !== COUPON_ELIGIBLE_CATEGORY) continue
    const qty = Math.max(0, Math.floor(line.qty))
    if (qty === 0) continue
    const take = Math.min(qty, remaining)
    perLineUnitsApplied[i] = take
    perLineDiscount[i] = take * COUPON_FACE_VALUE
    remaining -= take
    total += take
  }

  return {
    perLineUnitsApplied,
    perLineDiscount,
    couponsApplied: total,
    couponDiscount: total * COUPON_FACE_VALUE,
  }
}

/**
 * Project how many new ₹150 coupons the customer will earn on their NEXT visit
 * after this booking completes. Mirrors the existing earning rule in
 * `asquare-members.ts` and `unified-booking.ts`:
 *
 *     coupons150Earned = floor(totalBillAmount / 600)
 *
 * Returns the difference between the post-booking earned count and the current
 * earned count. The reward is purely a UI projection — it does NOT mutate any
 * Firestore field; the increment happens automatically on the next member
 * upsert when `totalBillAmount` rises.
 */
export const projectEarnedCoupons = (
  currentTotalBillAmount: number,
  finalAmount: number,
): number => {
  const safeCurrent = Math.max(0, Math.floor(currentTotalBillAmount))
  const safeFinal = Math.max(0, Math.floor(finalAmount))
  const prev = Math.floor(safeCurrent / COUPON_EARN_THRESHOLD)
  const next = Math.floor((safeCurrent + safeFinal) / COUPON_EARN_THRESHOLD)
  return Math.max(0, next - prev)
}

/**
 * Build the sentinel `couponCode` string used to communicate the redemption
 * count from the booking link creator to `completeBillingOnPayment()` in the
 * unified booking kernel. The kernel parses this on payment success and calls
 * `redeemMemberCoupons(phone, count)`.
 *
 * Format: `MEMBER150x{count}` (e.g. `MEMBER150x2` = 2 coupons consumed).
 */
export const buildMemberCouponSentinel = (count: number): string =>
  `MEMBER150x${Math.max(0, Math.floor(count))}`

/** Inverse of `buildMemberCouponSentinel`. Returns 0 if the code is not a sentinel. */
export const parseMemberCouponSentinel = (code: string | null | undefined): number => {
  if (!code) return 0
  const m = /^MEMBER150x(\d+)$/.exec(code.trim())
  if (!m) return 0
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
