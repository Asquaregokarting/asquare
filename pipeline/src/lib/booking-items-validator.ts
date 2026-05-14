/**
 * Last-line guardrail for booking line items.
 *
 * Every booking write (APP_BOOKING, ADMIN_BOOKING, POS) flows through
 * `createUnifiedBooking`, which calls `normalizeBookingItemIds` on each item
 * right before the Firestore write. This guarantees `gameId` and
 * `subGameId` are always populated and consistently lowercase, which keeps
 * the Game Revenue report clean — nothing can land under "unknown" again.
 *
 * Resolution order (best-first, same as the backfill script):
 *   1. The item's existing gameId/subGameId (respected, never overwritten —
 *      only normalized to lowercase)
 *   2. Parse `activity.id` matching `activity__{branch}__{game}__{cat}__{var}`
 *   3. Use `activity.gameTypeId` + `activity.category` directly
 *   4. Parse structured itemName  "GAME • SUBGAME • VARIANT"  (POS format)
 *   5. Parse structured itemName  "PACK — COMBO — ACTIVITY"   (combo format)
 *   6. Miscellaneous fallback — the explicit escape hatch for custom/ad-hoc
 *      items. Never leaves anything "unknown".
 *
 * Consumers that build a line item manually (e.g. "add custom charge" in a
 * UI) should stamp MISC_BOOKING_IDS so their items are picked up as
 * Miscellaneous at resolution time without warning.
 */

const norm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .trim()

export const MISC_BOOKING_IDS = {
  gameId: 'miscellaneous',
  subGameId: 'custom',
  variantId: 'misc',
} as const

/** True for a string that looks like a branch id rather than a real gameTypeId. */
function looksLikeBranchId(value: string): boolean {
  if (!value) return true
  if (/^\d+$/.test(value)) return true
  // Every known branch docId: '0', '1', '2', 'srikakulam'
  return value === 'srikakulam'
}

/** Parse `activity__{branchId}__{gameTypeId}__{category}__{variantApiId}`. */
function parseActivityId(
  raw: unknown,
): { gameTypeId: string; category: string; variantApiId: string } | null {
  if (typeof raw !== 'string') return null
  const m = raw.match(/^activity__([^_]+)__([^_]+)__([^_]+)__(.+)$/)
  if (!m) return null
  const [, , gameTypeId, category, variantApiId] = m
  return { gameTypeId, category, variantApiId }
}

/** Extract IDs from a rich `activity` object, if it carries them. */
function resolveFromActivity(
  activity: unknown,
): { gameId: string; subGameId: string; variantId: string | null } | null {
  if (!activity || typeof activity !== 'object') return null
  const a = activity as Record<string, unknown>

  const parsed = parseActivityId(a.id) ?? parseActivityId(a.apiId)
  if (parsed && !looksLikeBranchId(parsed.gameTypeId)) {
    return {
      gameId: norm(parsed.gameTypeId),
      subGameId: norm(parsed.category),
      variantId: norm(parsed.variantApiId) || null,
    }
  }

  const gameTypeId = typeof a.gameTypeId === 'string' ? a.gameTypeId.trim() : ''
  const category = typeof a.category === 'string' ? a.category.trim() : ''
  if (gameTypeId && category && !looksLikeBranchId(gameTypeId)) {
    return {
      gameId: norm(gameTypeId),
      subGameId: norm(category),
      variantId: typeof a.apiId === 'string' && a.apiId.trim() ? norm(a.apiId) : null,
    }
  }

  return null
}

/** Convert "8 Laps" / "12 LAPS" → "lap_8" / "lap_12"; otherwise slugify. */
function slugifyVariant(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  const lap = s.match(/(\d+)\s*laps?/)
  if (lap) return `lap_${lap[1]}`
  const slug = s.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  return slug || null
}

/** Parse "GAME • SUBGAME • VARIANT" (POS canonical format). */
function resolveFromBulletName(
  itemName: string,
): { gameId: string; subGameId: string; variantId: string | null } | null {
  const parts = itemName.split(/\s*•\s*/)
  if (parts.length < 3) return null
  const [game, subGame, ...rest] = parts
  return {
    gameId: norm(game).replace(/\s+/g, ''),
    subGameId: norm(subGame),
    variantId: slugifyVariant(rest.join(' • ')),
  }
}

/** Parse "PACK — COMBO N — ACTIVITY" (combo/bundle format). */
function resolveFromEmdashName(
  itemName: string,
): { gameId: string; subGameId: string; variantId: string | null } | null {
  const parts = itemName.split(/\s*—\s*/)
  if (parts.length < 3) return null
  const [pack, combo, ...rest] = parts
  const activity = rest.join(' — ')
  const slug = norm(activity)
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
  return {
    gameId: norm(pack).replace(/\s+/g, '-'),
    subGameId: norm(combo).replace(/\s+/g, '-'),
    variantId: slug || null,
  }
}

export interface ResolvableItem {
  itemName?: string
  gameId?: string | null
  subGameId?: string | null
  variantId?: string | null
  activity?: unknown
}

export interface ResolvedItemIds {
  gameId: string
  subGameId: string
  variantId: string | null
  strategy: 'preserved' | 'activity' | 'name-bullet' | 'name-emdash' | 'misc-fallback'
}

/**
 * Resolve {gameId, subGameId, variantId} for a single line item. Preserves
 * already-set non-empty IDs (normalized to lowercase). Falls through to
 * Miscellaneous if nothing else matches — so a caller never has to handle
 * a null result.
 */
export function resolveBookingItemIds(item: ResolvableItem): ResolvedItemIds {
  const existingGame = norm(item.gameId)
  const existingSub = norm(item.subGameId)
  const existingVar = norm(item.variantId)

  if (existingGame && existingSub) {
    return {
      gameId: existingGame,
      subGameId: existingSub,
      variantId: existingVar || null,
      strategy: 'preserved',
    }
  }

  const fromActivity = resolveFromActivity(item.activity)
  if (fromActivity) {
    return {
      gameId: existingGame || fromActivity.gameId,
      subGameId: existingSub || fromActivity.subGameId,
      variantId: existingVar || fromActivity.variantId,
      strategy: 'activity',
    }
  }

  const itemName = typeof item.itemName === 'string' ? item.itemName.trim() : ''
  if (itemName) {
    const bullet = resolveFromBulletName(itemName)
    if (bullet) {
      return {
        gameId: existingGame || bullet.gameId,
        subGameId: existingSub || bullet.subGameId,
        variantId: existingVar || bullet.variantId,
        strategy: 'name-bullet',
      }
    }
    const emdash = resolveFromEmdashName(itemName)
    if (emdash) {
      return {
        gameId: existingGame || emdash.gameId,
        subGameId: existingSub || emdash.subGameId,
        variantId: existingVar || emdash.variantId,
        strategy: 'name-emdash',
      }
    }
  }

  return {
    gameId: existingGame || MISC_BOOKING_IDS.gameId,
    subGameId: existingSub || MISC_BOOKING_IDS.subGameId,
    variantId: existingVar || null,
    strategy: 'misc-fallback',
  }
}

/**
 * Apply `resolveBookingItemIds` across an array of items and return a new
 * array with normalized IDs filled in. The caller decides what to do with
 * the `fellBackToMisc` count — most callers log it so silent drift is
 * visible in logs even though the write succeeds.
 */
export function normalizeBookingItems<T extends ResolvableItem>(
  items: T[],
): { items: T[]; fellBackToMisc: number } {
  let fellBackToMisc = 0
  const next = items.map((item) => {
    const resolved = resolveBookingItemIds(item)
    if (resolved.strategy === 'misc-fallback') fellBackToMisc++
    return {
      ...item,
      gameId: resolved.gameId,
      subGameId: resolved.subGameId,
      variantId: resolved.variantId ?? item.variantId ?? null,
    }
  })
  return { items: next, fellBackToMisc }
}
