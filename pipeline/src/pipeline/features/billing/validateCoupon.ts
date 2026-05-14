import { AsquareCoupon, asquareCouponsApi } from '../../api/asquare-coupons'
import { listAllEventNotifications } from '../../api/event-coupon-notifications'

export interface CouponValidationResult {
  valid: boolean
  coupon?: AsquareCoupon
  discountAmount: number
  errorMessage?: string
  /** Per-item discount amounts aligned with cart indices. Non-eligible items have 0. */
  itemDiscounts?: number[]
}

interface CartItem {
  itemName: string
  quantity: number
  unitPrice: number
  gameId?: string
  subGameId?: string
}

const normalizeMobile = (value: string): string => {
  const digits = value.replace(/\D+/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  return digits
}

/**
 * Validates a coupon code against the current cart and calculates the discount.
 * Checks: visibility (billing), active, not expired, start date, usage limits, min amount, game eligibility.
 *
 * Vendor coupons (createdByVendorId set) require customerPhone to match allowedMobile.
 * Coupons without 'billing' in their visibility array are rejected at POS.
 */
export const validateCouponForCart = async (
  couponCode: string,
  cart: CartItem[],
  subtotal: number,
  customerPhone?: string,
): Promise<CouponValidationResult> => {
  const fail = (errorMessage: string): CouponValidationResult => ({
    valid: false,
    discountAmount: 0,
    errorMessage,
  })

  const coupons = await asquareCouponsApi.listCoupons()
  const coupon = coupons.find((c) => c.code.toUpperCase() === couponCode.toUpperCase().trim())

  if (!coupon) return fail('Invalid coupon code.')
  if (!coupon.isActive) return fail('This coupon is inactive.')

  // Visibility check: reject coupons not marked for billing use
  if (coupon.visibility && coupon.visibility.length > 0 && !coupon.visibility.includes('billing')) {
    return fail('This coupon is not available for in-store billing.')
  }

  // Vendor coupon: validate mobile number match
  if (coupon.createdByVendorId && coupon.allowedMobile) {
    const inputMobile = normalizeMobile(customerPhone ?? '')
    const allowedMobile = normalizeMobile(coupon.allowedMobile)
    if (!inputMobile || inputMobile !== allowedMobile) {
      return fail('This coupon is not valid for this mobile number.')
    }
  }

  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date())
    return fail('This coupon has expired.')
  if (coupon.startDate && new Date(coupon.startDate) > new Date())
    return fail('This coupon is not yet valid.')
  if (coupon.isForHelicopterOnly) return fail('This coupon is for helicopter bookings only.')
  if (coupon.type !== 'discount') return fail('Only discount coupons can be applied at POS.')
  if (coupon.maxUsageCount && coupon.usedCount >= coupon.maxUsageCount)
    return fail('Coupon usage limit reached.')

  // For event coupons: filter applicableGames to only accepted vendors' games
  let effectiveGames = coupon.applicableGames
  if (coupon.category === 'event' && effectiveGames.length > 0) {
    try {
      const notifications = await listAllEventNotifications()
      const couponNotifs = notifications.filter((n) => n.couponId === coupon.id)
      // Get game IDs from rejected vendors
      const rejectedGameKeys = new Set<string>()
      const pendingGameKeys = new Set<string>()
      for (const notif of couponNotifs) {
        const keys = notif.games.map((g) => `${g.locationId}:${g.gameId}`)
        if (notif.status === 'rejected') keys.forEach((k) => rejectedGameKeys.add(k))
        if (notif.status === 'pending') keys.forEach((k) => pendingGameKeys.add(k))
      }
      // Exclude rejected AND pending vendors' games (only accepted get discount)
      effectiveGames = effectiveGames.filter(
        (g) =>
          !rejectedGameKeys.has(`${g.locationId}:${g.gameId}`) &&
          !pendingGameKeys.has(`${g.locationId}:${g.gameId}`),
      )
      if (effectiveGames.length === 0) {
        return fail('No vendors have accepted this event coupon yet.')
      }
    } catch {
      // If notification check fails, use original games as fallback
    }
  }

  // Determine eligible items and subtotal
  let eligibleSubtotal = subtotal
  let eligibleTickets = cart.reduce((sum, c) => sum + c.quantity, 0)

  if (effectiveGames.length > 0) {
    const eligibleItems = cart.filter((item) =>
      effectiveGames.some(
        (ag) => ag.gameId === item.gameId && (!ag.subGameId || ag.subGameId === item.subGameId),
      ),
    )
    if (eligibleItems.length === 0) return fail('No items in cart are eligible for this coupon.')
    eligibleSubtotal = eligibleItems.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0)
    eligibleTickets = eligibleItems.reduce((sum, c) => sum + c.quantity, 0)
  }

  if (coupon.minAmount > 0 && eligibleSubtotal < coupon.minAmount) {
    return fail(
      `Minimum amount of INR ${coupon.minAmount} required${coupon.applicableGames.length > 0 ? ' for eligible items' : ''}.`,
    )
  }

  if (coupon.minTickets > 0 && eligibleTickets < coupon.minTickets) {
    return fail(`Minimum ${coupon.minTickets} tickets required.`)
  }

  // Calculate discount
  let discountAmount: number
  if (coupon.applyPerTicket) {
    discountAmount = coupon.isPercentage
      ? Math.round((eligibleSubtotal * coupon.discount) / 100)
      : coupon.discount * eligibleTickets
  } else {
    discountAmount = coupon.isPercentage
      ? Math.round((eligibleSubtotal * coupon.discount) / 100)
      : coupon.discount
  }

  // Cap at subtotal (never discount more than total cart)
  discountAmount = Math.min(discountAmount, subtotal)

  // Build per-item discount distribution
  const itemDiscounts = cart.map((item) => {
    if (effectiveGames.length === 0) {
      // Global coupon: distribute proportionally by item subtotal
      const itemSub = item.unitPrice * item.quantity
      return subtotal > 0 ? Math.round((itemSub / subtotal) * discountAmount) : 0
    }
    // Game-targeted coupon: only eligible items get discount
    const isEligible = effectiveGames.some(
      (ag) => ag.gameId === item.gameId && (!ag.subGameId || ag.subGameId === item.subGameId),
    )
    if (!isEligible) return 0
    const itemSub = item.unitPrice * item.quantity
    return eligibleSubtotal > 0 ? Math.round((itemSub / eligibleSubtotal) * discountAmount) : 0
  })
  // Residual correction: ensure sum of itemDiscounts equals discountAmount
  const itemDiscountSum = itemDiscounts.reduce((s, d) => s + d, 0)
  if (itemDiscountSum !== discountAmount && itemDiscounts.length > 0) {
    // Find last eligible item and adjust
    for (let i = itemDiscounts.length - 1; i >= 0; i--) {
      if (itemDiscounts[i] > 0 || effectiveGames.length === 0) {
        itemDiscounts[i] += discountAmount - itemDiscountSum
        break
      }
    }
  }

  return { valid: true, coupon, discountAmount, itemDiscounts }
}

/**
 * Validates a vendor coupon for use in the ThirdParty invoice section.
 * Checks: coupon belongs to vendor, mobile number matches, active, not expired, game eligibility.
 */
export const validateVendorCoupon = async (
  couponCode: string,
  vendorId: string,
  customerMobile: string,
  cart: CartItem[],
  subtotal: number,
): Promise<CouponValidationResult> => {
  const fail = (errorMessage: string): CouponValidationResult => ({
    valid: false,
    discountAmount: 0,
    errorMessage,
  })

  const coupons = await asquareCouponsApi.listCoupons()
  const coupon = coupons.find((c) => c.code.toUpperCase() === couponCode.toUpperCase().trim())

  if (!coupon) return fail('Invalid coupon code.')
  if (!coupon.isActive) return fail('This coupon is inactive.')

  // Must be a vendor coupon belonging to this vendor
  if (coupon.createdByVendorId !== vendorId) {
    return fail('This coupon does not belong to your account.')
  }

  // Mobile number validation
  if (coupon.allowedMobile) {
    const normalizedInput = normalizeMobile(customerMobile)
    const normalizedAllowed = normalizeMobile(coupon.allowedMobile)
    if (normalizedInput !== normalizedAllowed) {
      return fail('Coupon is not valid for this mobile number.')
    }
  }

  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date())
    return fail('This coupon has expired.')
  if (coupon.startDate && new Date(coupon.startDate) > new Date())
    return fail('This coupon is not yet valid.')
  if (coupon.maxUsageCount && coupon.usedCount >= coupon.maxUsageCount)
    return fail('Coupon usage limit reached.')

  // Game eligibility — vendor coupons always have applicableGames
  if (coupon.applicableGames.length > 0) {
    const eligibleItems = cart.filter((item) =>
      coupon.applicableGames.some(
        (ag) => ag.gameId === item.gameId && (!ag.subGameId || ag.subGameId === item.subGameId),
      ),
    )
    if (eligibleItems.length === 0) return fail('No items are eligible for this coupon.')
    const eligibleSubtotal = eligibleItems.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0)

    let discountAmount = coupon.isPercentage
      ? Math.round((eligibleSubtotal * coupon.discount) / 100)
      : coupon.discount
    discountAmount = Math.min(discountAmount, subtotal)

    return { valid: true, coupon, discountAmount }
  }

  // Global vendor coupon (rare but possible)
  let discountAmount = coupon.isPercentage
    ? Math.round((subtotal * coupon.discount) / 100)
    : coupon.discount
  discountAmount = Math.min(discountAmount, subtotal)

  return { valid: true, coupon, discountAmount }
}
