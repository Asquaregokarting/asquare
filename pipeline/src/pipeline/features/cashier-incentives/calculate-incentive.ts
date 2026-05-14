/**
 * Pure incentive evaluation functions — zero Firestore dependency.
 *
 * Evaluates whether billing items qualify for cashier incentives under two rules:
 *   1. Non-performing game (weekly revenue < threshold) → 2% incentive
 *   2. Go-Karting with ≥ N laps (default 12) → 2% incentive
 *
 * If both rules qualify simultaneously, the reason is 'both' and incentive is
 * applied once (not doubled).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IncentiveEvaluationContext {
  weekKey: string
  /** Set of composite keys ("gameId_subGameId_variantId") for non-performing variants. */
  nonPerformingVariants: Set<string>
  /** Map of composite key → laps for GoKart variants. */
  goKartVariantLaps: Map<string, number>
  incentivePercent: number
  goKartLapThreshold: number
}

export interface IncentiveItemInput {
  itemName: string
  quantity: number
  unitPrice: number
  gameId?: string
  subGameId?: string
  variantId?: string
  /** Item-level base + GST amounts (from enriched billing). */
  itemBaseAmount?: number
  itemGstAmount?: number
}

export interface IncentiveItemResult {
  qualifies: boolean
  reason: 'non_performing' | 'gokart_laps' | 'both' | null
  itemAmount: number
  incentiveAmount: number
  laps: number | null
  isGoKart: boolean
  /** Composite key used to look up this variant. */
  variantKey: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a composite key for variant lookup. */
export function variantKey(gameId?: string, subGameId?: string, variantId?: string): string {
  return `${gameId ?? ''}_${subGameId ?? ''}_${variantId ?? ''}`
}

/** Detect GoKart by item name — same heuristic as activityService.ts. */
function isGoKartItem(itemName: string): boolean {
  return /kart/i.test(itemName)
}

/**
 * Extract lap count from item name.
 * Matches patterns like "8 Laps", "12 Laps", "15 laps".
 */
function extractLapsFromName(itemName: string): number | null {
  const match = itemName.match(/(\d+)\s*laps?/i)
  return match ? Number(match[1]) : null
}

/**
 * Resolve the effective lap count for an item:
 *   1. Catalog laps (from goKartVariantLaps map)
 *   2. Parsed from item name
 */
function resolveLaps(item: IncentiveItemInput, ctx: IncentiveEvaluationContext): number | null {
  const key = variantKey(item.gameId, item.subGameId, item.variantId)
  const catalogLaps = ctx.goKartVariantLaps.get(key)
  if (catalogLaps != null) return catalogLaps
  return extractLapsFromName(item.itemName)
}

// ─── Evaluation ─────────────────────────────────────────────────────────────

/**
 * Evaluate a single billing item for incentive qualification.
 * The item amount used for the 2% calculation is (itemBaseAmount + itemGstAmount)
 * if available, otherwise (unitPrice × quantity).
 */
export function evaluateItemIncentive(
  item: IncentiveItemInput,
  ctx: IncentiveEvaluationContext,
): IncentiveItemResult {
  const key = variantKey(item.gameId, item.subGameId, item.variantId)
  const itemAmount =
    item.itemBaseAmount != null && item.itemGstAmount != null
      ? item.itemBaseAmount + item.itemGstAmount
      : item.unitPrice * item.quantity

  const goKart = isGoKartItem(item.itemName)
  const laps = goKart ? resolveLaps(item, ctx) : null

  // Go-Kart items qualify only via the laps rule, never via non-performing
  const isNonPerforming = !goKart && ctx.nonPerformingVariants.has(key)
  const isGoKartQualified = goKart && laps != null && laps >= ctx.goKartLapThreshold

  if (!isNonPerforming && !isGoKartQualified) {
    return {
      qualifies: false,
      reason: null,
      itemAmount,
      incentiveAmount: 0,
      laps,
      isGoKart: goKart,
      variantKey: key,
    }
  }

  const reason: 'non_performing' | 'gokart_laps' | 'both' =
    isNonPerforming && isGoKartQualified
      ? 'both'
      : isNonPerforming
        ? 'non_performing'
        : 'gokart_laps'

  const incentiveAmount = Math.round((itemAmount * ctx.incentivePercent) / 100)

  return {
    qualifies: true,
    reason,
    itemAmount,
    incentiveAmount,
    laps,
    isGoKart: goKart,
    variantKey: key,
  }
}

/**
 * Evaluate all billing items in a booking.
 * Combo items are already expanded before reaching this function
 * (see BillingModule.tsx — combos are flatMapped into individual items).
 */
export function evaluateBookingIncentives(
  billingItems: IncentiveItemInput[],
  ctx: IncentiveEvaluationContext,
): IncentiveItemResult[] {
  return billingItems.map((item) => evaluateItemIncentive(item, ctx))
}

/**
 * Build a composite key for a per-game override lookup.
 * Same format as used in IncentiveConfig.perGameOverrides.
 */
export function perGameOverrideKey(
  locationId: string,
  gameId: string,
  subGameId: string,
  variantId: string,
): string {
  return `${locationId}_${gameId}_${subGameId}_${variantId}`
}

/**
 * Compute the effective threshold for a variant.
 * Priority: per-game override → global multiplier → default (40 × price).
 */
export function computeEffectiveThreshold(
  variantPrice: number,
  overrideKey: string,
  config: {
    defaultMultiplier: number
    globalMultiplier: number | null
    perGameOverrides: Record<string, { customThreshold: number | null; excluded: boolean }>
  },
): { threshold: number; thresholdType: 'auto' | 'manual-global' | 'manual-game' } {
  const override = config.perGameOverrides[overrideKey]
  if (override?.customThreshold != null) {
    return { threshold: override.customThreshold, thresholdType: 'manual-game' }
  }
  if (config.globalMultiplier != null) {
    return {
      threshold: variantPrice * config.globalMultiplier,
      thresholdType: 'manual-global',
    }
  }
  return {
    threshold: variantPrice * config.defaultMultiplier,
    thresholdType: 'auto',
  }
}
