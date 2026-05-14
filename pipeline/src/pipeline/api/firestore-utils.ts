/** Shared Firestore utilities used across all *-firestore.ts API modules. */

/** Returns current timestamp as ISO string. */
export const nowIso = (): string => new Date().toISOString()

/** Converts unknown value to trimmed string, or undefined if empty. */
export const toOptionalString = (value: unknown): string | undefined => {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : undefined
}

/** Strips undefined values from an object so Firestore doesn't reject them. */
export const stripUndefined = <T extends Record<string, unknown>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T

/**
 * Derive the set of vendor ids present on a booking's items.
 *
 * Stamped onto every booking write so vendor-scoped reads can use
 * `where('vendorIds', 'array-contains', vendorId)` instead of matching
 * against the single top-level `vendorId` (which only holds the first
 * vendor on multi-vendor combos and is undefined on event-package
 * bookings). Without this field, a vendor whose item is not the primary
 * line silently never sees the booking in their list.
 */
export const deriveVendorIds = (
  items: ReadonlyArray<{ vendorId?: string | null } | null | undefined> | null | undefined,
): string[] => {
  if (!Array.isArray(items)) return []
  const ids = new Set<string>()
  for (const item of items) {
    const vid = item?.vendorId
    if (typeof vid === 'string' && vid.trim().length > 0) ids.add(vid.trim())
  }
  return Array.from(ids)
}
