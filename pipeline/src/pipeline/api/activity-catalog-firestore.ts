import { ActivityCatalogRecord, ActivityRecord, BranchLocationKey } from './types'
import { listFirestoreActivities, listFirestoreActivityHierarchy } from './activities-firestore'
import { resolveLocation } from '../../lib/locations'
import { logger } from '../../lib/logger'

const normalizeBranchKey = (key: string): BranchLocationKey => {
  if (/^\d+$/.test(key)) return key
  return resolveLocation(key)?.branchId ?? key
}

const buildCatalogRecord = (
  activityId: string,
  locationKey: BranchLocationKey,
  activity: ActivityRecord,
  resolvedPlatforms?: ('web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings')[],
): ActivityCatalogRecord => {
  const durationMinutes = Math.max(0, Math.round(Number(activity.durationMinutes ?? 0) || 0))
  const price = Math.max(0, Number(activity.price ?? 0) || 0)
  const status = String(activity.status ?? 'Active') === 'Inactive' ? 'Inactive' : 'Active'
  const gameName = String(activity.gameName ?? activity.activityName ?? activity.type ?? 'Game')
  const subGameName = String(activity.subGameName ?? activity.subTypeName ?? 'Sub Game')
  const variantLabel = String(
    activity.variantLabel ?? activity.variantName ?? activity.name ?? 'Variant',
  )
  const bookingName = String(
    activity.bookingName ?? [gameName, subGameName, variantLabel].filter(Boolean).join(' • '),
  )

  return {
    id: activityId,
    name: variantLabel,
    bookingName,
    description: undefined,
    category: gameName,
    subcategory: subGameName,
    branchPrices: {
      [locationKey]: price,
    },
    locationKeys: [locationKey],
    durationMinutes,
    status,
    active: status === 'Active',
    badges: durationMinutes > 0 ? [`${durationMinutes} min`] : undefined,
    sortOrder: 0,
    image: typeof activity.imageUrl === 'string' ? activity.imageUrl : undefined,
    imageUrl: typeof activity.imageUrl === 'string' ? activity.imageUrl : undefined,
    locationName: typeof activity.locationName === 'string' ? activity.locationName : undefined,
    gameId: typeof activity.gameId === 'string' ? activity.gameId : undefined,
    gameName,
    subGameId: typeof activity.subGameId === 'string' ? activity.subGameId : undefined,
    subGameName,
    variantId: typeof activity.variantId === 'string' ? activity.variantId : undefined,
    variantLabel,
    laps: typeof activity.laps === 'number' ? activity.laps : undefined,
    vendorId:
      typeof activity.vendorId === 'string' && activity.vendorId ? activity.vendorId : undefined,
    vendorBranchId:
      typeof activity.vendorBranchId === 'string' && activity.vendorBranchId
        ? activity.vendorBranchId
        : undefined,
    platforms: resolvedPlatforms,
    visibleInPOS:
      typeof activity.bookingMeta?.visibleInPOS === 'boolean'
        ? (activity.bookingMeta.visibleInPOS as boolean)
        : undefined,
    visibleInProtocol:
      typeof activity.bookingMeta?.visibleInProtocol === 'boolean'
        ? (activity.bookingMeta.visibleInProtocol as boolean)
        : undefined,
    visibleInOffers:
      typeof activity.bookingMeta?.visibleInOffers === 'boolean'
        ? (activity.bookingMeta.visibleInOffers as boolean)
        : undefined,
    visibleInBooking:
      typeof activity.bookingMeta?.visibleInBooking === 'boolean'
        ? (activity.bookingMeta.visibleInBooking as boolean)
        : undefined,
    offerPrice:
      typeof activity.bookingMeta?.offerPrice === 'number'
        ? (activity.bookingMeta.offerPrice as number)
        : undefined,
    printIndividualTokens: activity.bookingMeta?.printIndividualTokens === true,
    temporarilyUnavailable: activity.temporarilyUnavailable === true,
    temporarilyUnavailableReason:
      typeof activity.temporarilyUnavailableReason === 'string'
        ? activity.temporarilyUnavailableReason
        : undefined,
    temporarilyUnavailableSince:
      typeof activity.temporarilyUnavailableSince === 'string'
        ? activity.temporarilyUnavailableSince
        : undefined,
    temporarilyUnavailableMarkedById:
      typeof activity.temporarilyUnavailableMarkedById === 'string'
        ? activity.temporarilyUnavailableMarkedById
        : undefined,
    temporarilyUnavailableMarkedByName:
      typeof activity.temporarilyUnavailableMarkedByName === 'string'
        ? activity.temporarilyUnavailableMarkedByName
        : undefined,
    temporarilyUnavailableUntil:
      typeof activity.temporarilyUnavailableUntil === 'string'
        ? activity.temporarilyUnavailableUntil
        : undefined,
    createdAt: String(activity.createdAt ?? new Date().toISOString()),
    updatedAt: String(activity.updatedAt ?? activity.createdAt ?? new Date().toISOString()),
  }
}

export const isFirestoreActivityCatalogActive = (): boolean => true

// In-memory cache for the activity catalog. Walking the variant hierarchy
// touches O(locations × games × subgames × variants) Firestore docs — easily
// 10–20s on a populated catalog. Many surfaces (booking pickers, defensive
// submit-time re-checks, the availability modal) call this multiple times
// per page, so a short TTL with request coalescing collapses repeated calls
// in the same session into one Firestore round-trip.
//
// TTL is intentionally short — 60s — so admin flag flips become visible to
// other surfaces within a minute without waiting on tab reload.
//
// `clearActivityCatalogCache()` is exported below and called from
// `setActivityAvailability` / `setLegacyActivityAvailability` after a write
// so the next read sees the updated state immediately.
const CATALOG_TTL_MS = 60_000
let _catalogCache: { data: ActivityCatalogRecord[]; expiresAt: number } | null = null
let _catalogInflight: Promise<ActivityCatalogRecord[]> | null = null

export const clearActivityCatalogCache = (): void => {
  _catalogCache = null
  _catalogInflight = null
}

const _listFirestoreActivityCatalogUncached = async (): Promise<ActivityCatalogRecord[]> => {
  // Load both flat records (for data) and hierarchy (for sub-game metadata)
  const [activitiesByLocation, hierarchy] = await Promise.all([
    listFirestoreActivities(),
    listFirestoreActivityHierarchy(),
  ])

  // Build a lookup: locationKey → gameId → subGameId → sub-game metadata
  const subGameMetaLookup = new Map<string, Record<string, unknown> | undefined>()
  const gamePlatformsLookup = new Map<
    string,
    ('web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings')[] | undefined
  >()
  for (const loc of hierarchy) {
    for (const game of loc.games) {
      gamePlatformsLookup.set(`${loc.id}::${game.id}`, game.platforms)
      for (const sg of game.subGames) {
        subGameMetaLookup.set(`${loc.id}::${game.id}::${sg.id}`, sg.metadata)
      }
    }
  }

  return Object.entries(activitiesByLocation)
    .flatMap(([locationKey, records]) => {
      const branchKey = normalizeBranchKey(locationKey)
      return records
        .filter((record) => {
          // Check sub-game level location visibility
          const sgMeta = subGameMetaLookup.get(
            `${locationKey}::${record.gameId}::${record.subGameId}`,
          )
          const sgLocationKeys =
            Array.isArray(sgMeta?.locationKeys) && (sgMeta!.locationKeys as string[]).length > 0
              ? (sgMeta!.locationKeys as string[])
              : null
          if (sgLocationKeys && !sgLocationKeys.includes(branchKey)) return false
          return true
        })
        .map((record) => {
          // Resolve effective platforms (sub-game overrides game)
          const sgMeta = subGameMetaLookup.get(
            `${locationKey}::${record.gameId}::${record.subGameId}`,
          )
          const gamePlatforms = gamePlatformsLookup.get(`${locationKey}::${record.gameId}`)
          const resolvedPlatforms =
            Array.isArray(sgMeta?.platforms) && (sgMeta!.platforms as string[]).length > 0
              ? (sgMeta!.platforms as (
                  | 'web'
                  | 'windows'
                  | 'android'
                  | 'ios'
                  | 'pos'
                  | 'bookings'
                )[])
              : gamePlatforms
          return buildCatalogRecord(record.id, branchKey, record, resolvedPlatforms)
        })
    })
    .sort((left, right) => {
      const gameCompare = String(left.gameName ?? '').localeCompare(String(right.gameName ?? ''))
      if (gameCompare !== 0) {
        return gameCompare
      }
      const subGameCompare = String(left.subGameName ?? '').localeCompare(
        String(right.subGameName ?? ''),
      )
      if (subGameCompare !== 0) {
        return subGameCompare
      }
      return left.name.localeCompare(right.name)
    })
}

export const listFirestoreActivityCatalog = async (): Promise<ActivityCatalogRecord[]> => {
  // Serve fresh cached snapshot if available.
  if (_catalogCache && Date.now() < _catalogCache.expiresAt) {
    return _catalogCache.data
  }
  // Coalesce concurrent callers onto one in-flight Firestore round-trip.
  if (_catalogInflight) return _catalogInflight
  _catalogInflight = _listFirestoreActivityCatalogUncached()
    .then((data) => {
      _catalogCache = { data, expiresAt: Date.now() + CATALOG_TTL_MS }
      return data
    })
    .finally(() => {
      _catalogInflight = null
    })
  return _catalogInflight
}

export const listBranchActivityCatalog = async (
  locationKey?: BranchLocationKey,
): Promise<ActivityCatalogRecord[]> => {
  const rows = await listFirestoreActivityCatalog()
  if (!locationKey) {
    return rows
  }
  const normalizedKey = normalizeBranchKey(locationKey)
  return rows
    .filter((item) => item.locationKeys.includes(normalizedKey))
    .map((item) => {
      // If vendorBranchId is set and doesn't match the requested branch,
      // strip vendorId to prevent cross-branch vendor payment routing.
      if (item.vendorId && item.vendorBranchId && item.vendorBranchId !== normalizedKey) {
        logger.warn('activity_catalog.vendor_branch_mismatch', {
          activityId: item.id,
          vendorId: item.vendorId,
          vendorBranchId: item.vendorBranchId,
          requestedBranch: normalizedKey,
        })
        return { ...item, vendorId: undefined, vendorBranchId: undefined }
      }
      return item
    })
}
