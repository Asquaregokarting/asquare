import type {
  EventGameConfig,
  EventOfferConfig,
  EventCampaignRecord,
  EventPackage,
  EventPackageDiscount,
  EventPackageItem,
} from './event-campaign-types'
import { resolveLocation } from '../../../lib/locations'

/** Reduce a key (slug, branchId, displayName) to its canonical slug for equality checks. */
const canonicalLocation = (key: string): string => resolveLocation(key)?.slug ?? key.toLowerCase()

/** Backward-compatible "is this package enabled?" check. Missing/undefined = enabled. */
export const isPackageEnabled = (pkg: { enabled?: boolean } | null | undefined): boolean =>
  !!pkg && pkg.enabled !== false

/** Backward-compatible "is this item enabled?" check. Missing/undefined = enabled. */
export const isItemEnabled = (item: { enabled?: boolean } | null | undefined): boolean =>
  !!item && item.enabled !== false

/** Items inside a package that should appear in POS / booking / receipts. */
export const getEnabledItems = (pkg: EventPackage): EventPackageItem[] =>
  pkg.items.filter(isItemEnabled)

/**
 * Whether a campaign location key is currently usable. A campaign may list a
 * location but pause it via `disabledLocationKeys`; those locations are skipped
 * by POS / booking / public listings.
 *
 * Canonical-slug aware so legacy campaigns that store both branchIds and slugs
 * for the same branch still resolve correctly.
 */
export const isLocationActive = (
  campaign: Pick<EventCampaignRecord, 'disabledLocationKeys'>,
  locationKey: string,
): boolean => {
  const disabled = campaign.disabledLocationKeys ?? []
  if (disabled.length === 0) return true
  const target = canonicalLocation(locationKey)
  return !disabled.some((k) => canonicalLocation(k) === target)
}

/** Calculate the effective price for a game within an event */
export function getEventGamePrice(game: EventGameConfig, offer: EventOfferConfig | null): number {
  if (game.overridePrice != null) return game.overridePrice
  if (game.discountPercent != null) {
    return Math.round(game.originalPrice * (1 - game.discountPercent / 100))
  }
  if (offer?.type === 'flat_discount' && offer.discountPercent != null) {
    return Math.round(game.originalPrice * (1 - offer.discountPercent / 100))
  }
  return game.originalPrice
}

export interface BxgyItem {
  activityId: string
  unitPrice: number
  quantity: number
  freeQty: number
}

export interface BxgyResult {
  items: BxgyItem[]
  totalBeforeDiscount: number
  freeItemsValue: number
  finalTotal: number
}

/** Calculate Buy X Get Y Free pricing */
export function calculateBuyXGetYFree(
  selections: Array<{ activityId: string; unitPrice: number; quantity: number }>,
  buyCount: number,
  freeCount: number,
  mixedGames: boolean,
): BxgyResult {
  const freeByGame = new Map<string, number>()

  if (!mixedGames) {
    for (const sel of selections) {
      const groupSize = buyCount + freeCount
      const freeUnits = Math.floor(sel.quantity / groupSize) * freeCount
      if (freeUnits > 0) freeByGame.set(sel.activityId, freeUnits)
    }
  } else {
    const units: Array<{ activityId: string; price: number }> = []
    for (const sel of selections) {
      for (let i = 0; i < sel.quantity; i++) {
        units.push({ activityId: sel.activityId, price: sel.unitPrice })
      }
    }

    const totalQty = units.length
    const groupSize = buyCount + freeCount
    const freeItemCount = Math.floor(totalQty / groupSize) * freeCount

    units.sort((a, b) => a.price - b.price)

    for (let i = 0; i < freeItemCount && i < units.length; i++) {
      const id = units[i].activityId
      freeByGame.set(id, (freeByGame.get(id) ?? 0) + 1)
    }
  }

  let totalBeforeDiscount = 0
  let freeItemsValue = 0
  const items: BxgyItem[] = selections.map((sel) => {
    const freeQty = freeByGame.get(sel.activityId) ?? 0
    totalBeforeDiscount += sel.unitPrice * sel.quantity
    freeItemsValue += sel.unitPrice * freeQty
    return { ...sel, freeQty }
  })

  return {
    items,
    totalBeforeDiscount,
    freeItemsValue,
    finalTotal: totalBeforeDiscount - freeItemsValue,
  }
}

/** Calculate cart summary for an event with all pricing applied */
export function calculateEventCartSummary(
  selections: Map<string, number>,
  campaign: EventCampaignRecord,
): { subtotal: number; savings: number; total: number; freeByGame: Map<string, number> } {
  const legacyGames = campaign.games ?? []
  const legacyOffer = campaign.offer ?? null
  const gameMap = new Map(legacyGames.map((g) => [g.activityId, g]))
  let subtotal = 0
  const priced: Array<{ activityId: string; unitPrice: number; quantity: number }> = []

  for (const [activityId, qty] of selections) {
    if (qty <= 0) continue
    const game = gameMap.get(activityId)
    if (!game) continue
    const price = getEventGamePrice(game, legacyOffer)
    subtotal += price * qty
    priced.push({ activityId, unitPrice: price, quantity: qty })
  }

  if (
    legacyOffer?.type === 'buy_x_get_y' &&
    legacyOffer.buyCount != null &&
    legacyOffer.freeCount != null &&
    legacyOffer.enabled !== false
  ) {
    const bxgy = calculateBuyXGetYFree(
      priced,
      legacyOffer.buyCount,
      legacyOffer.freeCount,
      legacyOffer.mixedGames ?? false,
    )
    return {
      subtotal: bxgy.totalBeforeDiscount,
      savings: bxgy.freeItemsValue,
      total: bxgy.finalTotal,
      freeByGame: new Map(
        bxgy.items.filter((i) => i.freeQty > 0).map((i) => [i.activityId, i.freeQty]),
      ),
    }
  }

  return { subtotal, savings: 0, total: subtotal, freeByGame: new Map() }
}

/** Generate a URL-safe slug from a title */
export function generateEventSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/** Sum of enabled item prices in a package (live total shown in the form UI). */
export function calculatePackageTotal(pkg: EventPackage): number {
  return pkg.items.reduce((sum, item) => {
    if (!isItemEnabled(item)) return sum
    const price = Number(item.price)
    return sum + (Number.isFinite(price) && price > 0 ? price : 0)
  }, 0)
}

/** One cart line for the package-discount computation */
export interface PackageDiscountLine {
  packageId: string
  unitPrice: number
  quantity: number
}

/** Result of applying a campaign's discount config to a set of selected packages */
export interface PackageDiscountResult {
  /** Sum of all units at full price */
  subtotal: number
  /** Total savings (flat OR BxGy-free-value) */
  discountAmount: number
  /** subtotal - discountAmount */
  total: number
  /** packageId → free unit count (BxGy only) */
  freeByPackage: Map<string, number>
  /** free value when BxGy (0 otherwise) */
  bxgyFreeValue: number
  /** flat discount amount (0 otherwise) */
  flatValue: number
}

/**
 * Apply a campaign's `packageDiscount` config to the selected cart lines.
 * - `'none'` / missing   → no-op; returns subtotal as total.
 * - `'flat'`             → reduces total by the computed flat amount (percent or fixed).
 * - `'buy_x_get_y'`      → reuses `calculateBuyXGetYFree` with `mixedGames=false`,
 *   which requires the "buy N + get M" group to be the SAME package. Mixing
 *   different packages does not unlock a free item.
 */
export function computePackageDiscount(
  lines: PackageDiscountLine[],
  discount: EventPackageDiscount | null | undefined,
): PackageDiscountResult {
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  const empty: PackageDiscountResult = {
    subtotal,
    discountAmount: 0,
    total: subtotal,
    freeByPackage: new Map(),
    bxgyFreeValue: 0,
    flatValue: 0,
  }
  if (!discount || discount.type === 'none' || discount.enabled === false) return empty

  if (discount.type === 'flat') {
    const value = Number(discount.flatValue) || 0
    const flatValue =
      discount.flatMode === 'fixed'
        ? Math.min(subtotal, Math.max(0, Math.round(value)))
        : Math.round((subtotal * Math.min(100, Math.max(0, value))) / 100)
    return {
      subtotal,
      discountAmount: flatValue,
      total: Math.max(0, subtotal - flatValue),
      freeByPackage: new Map(),
      bxgyFreeValue: 0,
      flatValue,
    }
  }

  if (discount.type === 'buy_x_get_y') {
    const buyCount = Math.max(1, Math.floor(Number(discount.buyCount) || 0))
    const getCount = Math.max(0, Math.floor(Number(discount.getCount) || 0))
    if (getCount === 0 || lines.length === 0) return empty
    const bxgy = calculateBuyXGetYFree(
      lines.map((l) => ({
        activityId: l.packageId,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
      })),
      buyCount,
      getCount,
      false, // same package only — 3 of the same combo gets 1 free; mixed combos don't qualify
    )
    const freeByPackage = new Map<string, number>()
    for (const it of bxgy.items) {
      if (it.freeQty > 0) freeByPackage.set(it.activityId, it.freeQty)
    }
    return {
      subtotal: bxgy.totalBeforeDiscount,
      discountAmount: bxgy.freeItemsValue,
      total: bxgy.finalTotal,
      freeByPackage,
      bxgyFreeValue: bxgy.freeItemsValue,
      flatValue: 0,
    }
  }

  return empty
}

/** Validate event campaign form data, returning error messages */
export function validateEventCampaign(data: {
  title?: string
  locationKeys?: string[]
  packages?: EventPackage[]
  startDate?: string
  endDate?: string
}): string[] {
  const errors: string[] = []
  if (!data.title?.trim()) errors.push('Title is required.')
  if (!data.locationKeys?.length) errors.push('At least one location must be selected.')
  if (!data.packages?.length) {
    errors.push('At least one package is required.')
  } else {
    data.packages.forEach((pkg, pi) => {
      const label = `Package ${pi + 1}`
      if (!pkg.locationKey) {
        errors.push(`${label}: location is required.`)
      }
      if (!pkg.items.length) {
        errors.push(`${label}: add at least one item.`)
      }
      pkg.items.forEach((it, ii) => {
        const itemLabel = `${label}, item ${ii + 1}`
        if (!it.name.trim()) {
          errors.push(`${itemLabel}: name is required.`)
        }
        const price = Number(it.price)
        if (!Number.isFinite(price) || price <= 0) {
          errors.push(`${itemLabel}: price must be greater than 0.`)
        }
      })
    })
  }
  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    errors.push('End date must be on or after start date.')
  }
  return errors
}
