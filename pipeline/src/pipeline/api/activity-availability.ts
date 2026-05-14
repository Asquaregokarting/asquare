/**
 * Single source of truth for "is this activity currently unavailable?".
 *
 * Encapsulates the auto-expire logic so every booking surface reaches the
 * same conclusion. A flag with no `until` is open-ended; with `until` set,
 * it auto-restores after that ISO datetime.
 *
 * Both the variant-hierarchy `ActivityCatalogRecord` and the legacy
 * `Activity` interface expose the same 6 fields, so this helper accepts
 * either via a structural subset.
 */
export interface SoftAvailabilityFields {
  temporarilyUnavailable?: boolean
  /** Free-text reason captured when the toggle was turned on. */
  temporarilyUnavailableReason?: string
  /** ISO timestamp when the flag was set. */
  temporarilyUnavailableSince?: string
  /** Pipeline user who flipped the flag — for audit. */
  temporarilyUnavailableMarkedById?: string
  /** Display name of `temporarilyUnavailableMarkedById`. */
  temporarilyUnavailableMarkedByName?: string
  /** ISO timestamp at which the flag should auto-clear. Open-ended if missing. */
  temporarilyUnavailableUntil?: string
}

export const isCurrentlyUnavailable = (
  record: SoftAvailabilityFields | null | undefined,
): boolean => {
  if (!record) return false
  if (record.temporarilyUnavailable !== true) return false
  if (!record.temporarilyUnavailableUntil) return true
  const until = new Date(record.temporarilyUnavailableUntil).getTime()
  if (!Number.isFinite(until)) return true
  return Date.now() <= until
}

/**
 * Surfaces a game can be exposed on. Mirrors the `platforms` field on
 * `ActivityCatalogRecord` and the legacy `Activity`. Kept here next to
 * `SoftAvailabilityFields` so every read site uses the same shared helpers
 * for "should I show this game?".
 */
export type AppPlatform = 'web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings'

/**
 * Should this record be visible on the given surface?
 *
 * Backwards-compatible by design: legacy documents with no `platforms`
 * field (most existing games) are treated as visible everywhere. Only
 * documents whose operator has explicitly set the array start filtering.
 * That way, turning on platform filtering at read sites doesn't blank
 * out every screen until everyone re-saves their game configurations.
 *
 * Combine with `isCurrentlyUnavailable` for a complete visibility check.
 */
export const isOnSurface = (
  record: { platforms?: readonly AppPlatform[] } | null | undefined,
  surface: AppPlatform,
): boolean => {
  if (!record) return false
  if (!Array.isArray(record.platforms)) return true // legacy: no field set → visible everywhere
  return record.platforms.includes(surface)
}
