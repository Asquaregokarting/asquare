/** @deprecated legacy — kept for backward compat with pre-packages campaigns */
export interface EventGameConfig {
  activityId: string
  gameName: string
  variantLabel: string
  originalPrice: number
  overridePrice?: number
  discountPercent?: number
  image?: string
  vendorId?: string
  gameId?: string
  subGameId?: string
  variantId?: string
}

/** @deprecated legacy — kept for backward compat with pre-packages campaigns */
export interface EventOfferConfig {
  type: 'flat_discount' | 'price_override' | 'buy_x_get_y'
  discountPercent?: number
  buyCount?: number
  freeCount?: number
  mixedGames?: boolean
  /** When false, the offer is paused. Missing/undefined/true = active (back-compat). */
  enabled?: boolean
}

/** Status of an event campaign */
export type EventCampaignStatus = 'active' | 'inactive' | 'ended'

/** Whether an item inside a package is a company-owned game or a third-party game */
export type EventPackageItemType = 'company' | 'thirdParty'

/** A single line item within an event package */
export interface EventPackageItem {
  id: string
  type: EventPackageItemType
  name: string
  price: number
  /** Third-party only — FK into `vendorDetails` collection. Optional to allow untracked third parties. */
  vendorId?: string
  /**
   * Third-party only — when true, at sale time the revenue is split using the linked vendor's
   * stored `revenueShare` %. When false (or no vendor linked), 100% of the item amount is treated
   * as third-party revenue.
   */
  revenueShare?: boolean
  /**
   * When true, the bill printer prints one game-token per quantity instead
   * of a single token with a "Quantity: Nx" line. Snapshotted onto each
   * booking item built from this event package at booking-creation time.
   */
  printIndividualTokens?: boolean
  /** When false, the item is hidden from POS/booking and excluded from the package total. Missing/undefined/true = active. */
  enabled?: boolean
}

/** A bundle of items tied to a single branch within an event campaign */
export interface EventPackage {
  id: string
  title: string
  locationKey: string
  items: EventPackageItem[]
  /** When false, the package is hidden from POS/booking. Missing/undefined/true = active. */
  enabled?: boolean
}

/** Controls where the event campaign and its packages are visible / usable */
export interface EventCampaignApplicability {
  showOnline: boolean
  enableInBooking: boolean
  enableInBilling: boolean
}

/** Per-event ₹150 coupon policy. Both default to false (no coupon activity). */
export interface EventCampaignCouponPolicy {
  /** When true, customers may redeem ₹150 coupons against this event's packages. */
  allowCouponUsage: boolean
  /** When true, purchasing this event's packages earns ₹150 coupons toward next visit. */
  grantCoupons: boolean
}

/** Discount type applied to the packages selected in a single sale */
export type EventPackageDiscountType = 'none' | 'flat' | 'buy_x_get_y'
export type EventPackageFlatMode = 'percentage' | 'fixed'

export interface EventPackageDiscount {
  type: EventPackageDiscountType
  /** flat mode: percentage off (0..100) or fixed rupee amount */
  flatMode?: EventPackageFlatMode
  flatValue?: number
  /** buy_x_get_y: paid units required to earn `getCount` free */
  buyCount?: number
  /** buy_x_get_y: free units granted per completed group */
  getCount?: number
  /** When false, the discount is paused. Missing/undefined/true = active (back-compat). */
  enabled?: boolean
}

/** Event campaign record stored in Firestore `eventCampaigns` collection */
export interface EventCampaignRecord {
  id: string
  title: string
  slug: string
  description: string
  heroImageUrl: string
  locationKeys: string[]
  /**
   * Subset of `locationKeys` that are temporarily paused. The campaign still
   * "applies" to these locations (so re-enabling is a one-tap action), but
   * POS / booking / public listings skip them and any packages tied to a
   * disabled location are hidden. Missing/empty = nothing paused.
   */
  disabledLocationKeys?: string[]
  startDate: string
  endDate: string
  status: EventCampaignStatus

  packages: EventPackage[]
  applicability: EventCampaignApplicability
  couponPolicy: EventCampaignCouponPolicy
  /**
   * Campaign-level discount applied across the selected packages at sale time.
   * Null / undefined = no discount.
   */
  packageDiscount?: EventPackageDiscount | null

  /** @deprecated legacy flat games array — kept for backward compat with pre-packages campaigns */
  games?: EventGameConfig[]
  /** @deprecated legacy offer config — kept for backward compat with pre-packages campaigns */
  offer?: EventOfferConfig | null

  promoText: string
  endedNotificationMessage: string | null
  endedNotificationSentAt: string | null

  /**
   * Approved Interakt template name to use for booking-confirmation
   * WhatsApp messages on bookings created from this campaign. Empty =
   * inherit BookingConfirmationConfig.defaultTemplateId.
   *
   * Snapshotted onto each booking item's activity at booking-creation
   * time (see useCreateBooking event-package construction) so a later
   * config tweak doesn't retroactively alter resends.
   */
  interaktTemplateId?: string
  /** Language code for the Interakt template (e.g. "en"). */
  interaktTemplateLanguage?: string

  createdBy: string
  createdAt: string
  updatedAt: string
}
