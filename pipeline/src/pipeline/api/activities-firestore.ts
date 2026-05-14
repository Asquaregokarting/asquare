import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import {
  ActivityGameTreeRecord,
  ActivityLocationTreeRecord,
  ActivityRecord,
  ActivitySubGameTreeRecord,
  ActivityVariantTreeRecord,
  BranchLocationKey,
} from './types'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { nowIso, toOptionalString } from './firestore-utils'

const LOCATIONS_COLLECTION = 'locations'
const GAMES_SUBCOLLECTION = 'games'
const SUBGAMES_SUBCOLLECTION = 'subgames'
const VARIANTS_SUBCOLLECTION = 'variants'

const LEGACY_ACTIVITIES_COLLECTION = 'Activities'
const LEGACY_ACTIVITY_CATALOG_COLLECTION = 'activityCatalog'
const LEGACY_LOCATION_ACTIVITIES_SUBCOLLECTION = 'activities'
const LEGACY_LOCATION_SUBTYPES_SUBCOLLECTION = 'subtypes'

const USE_FIRESTORE_ACTIVITIES = import.meta.env.VITE_USE_FIRESTORE_ACTIVITIES !== 'false'

interface FirestoreLocationDocument {
  id?: string
  name?: string
  branchId?: string
  locationKey?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

interface FirestoreGameDocument {
  id?: string
  name?: string
  imageUrl?: string
  status?: string | boolean | number
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

interface FirestoreSubGameDocument {
  id?: string
  name?: string
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

interface FirestoreVariantDocument {
  id?: string
  label?: string
  price?: number | string
  duration?: number | string
  durationMinutes?: number | string
  laps?: number | string
  active?: boolean | string | number
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

import { getLocationDisplayName as _getLocationDisplayName } from '../../lib/locations'
const LOCATION_LABELS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_target, prop: string) => _getLocationDisplayName(prop),
})

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

const toStatus = (value: unknown): 'Active' | 'Inactive' => {
  if (typeof value === 'boolean') {
    return value ? 'Active' : 'Inactive'
  }
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!normalized || normalized === 'active' || normalized === '0' || normalized === 'true') {
    return 'Active'
  }
  return 'Inactive'
}

const toBoolean = (value: unknown, fallback = true): boolean => {
  if (typeof value === 'boolean') {
    return value
  }
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!normalized) {
    return fallback
  }
  if (['true', '1', 'active', 'yes'].includes(normalized)) {
    return true
  }
  if (['false', '0', 'inactive', 'no'].includes(normalized)) {
    return false
  }
  return fallback
}

const isPermissionDeniedError = (error: unknown): boolean => {
  const code = String((error as { code?: unknown })?.code ?? '').toLowerCase()
  const message = String((error as { message?: unknown })?.message ?? '').toLowerCase()
  return (
    code.includes('permission-denied') || message.includes('missing or insufficient permissions')
  )
}

const compactDocData = <T extends Record<string, unknown>>(data: T): T =>
  Object.entries(data).reduce((accumulator, [key, value]) => {
    if (value !== undefined) {
      accumulator[key as keyof T] = value as T[keyof T]
    }
    return accumulator
  }, {} as T)

const normalizeCompactId = (value: string, fallback: string): string => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  return normalized || fallback
}

const normalizeUnderscoreId = (value: string, fallback: string): string => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || fallback
}

export const createGameDocumentId = (name: string): string => normalizeCompactId(name, 'game')

export const createSubGameDocumentId = (name: string): string =>
  normalizeUnderscoreId(name, 'subgame')

export const createVariantDocumentId = (label: string): string => {
  const normalized = String(label ?? '')
    .trim()
    .toLowerCase()
  const firstNumber = normalized.match(/\d+/)?.[0]
  if (firstNumber) {
    if (normalized.includes('lap')) return `lap_${firstNumber}`
    if (normalized.includes('round')) return `round_${firstNumber}`
    if (normalized.includes('bullet')) return `bullet_${firstNumber}`
    if (normalized.includes('arrow')) return `arrow_${firstNumber}`
    if (normalized.includes('ball')) return `ball_${firstNumber}`
    if (normalized.includes('shot')) return `shot_${firstNumber}`
    if (/(hour|hr|min|minute|sec)/.test(normalized)) return `duration_${firstNumber}`
  }
  return normalizeUnderscoreId(label, 'variant')
}

// Opaque, prefix-typed catalog IDs. Used for NEW games / sub-games /
// variants. Existing docs keep whatever ID they were created with —
// the writer accepts either form so legacy data is untouched.
//
// Why opaque: name-derived IDs (`createGameDocumentId` etc. above)
// collapse multiple distinct labels onto one Firestore doc — e.g.
// "5 laps", "laps 5", "5 lap sprint" all resolve to `lap_5`, which
// silently overwrites the first variant when the second is saved.
// Opaque IDs are stable across renames and never collide.
const randomIdSegment = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

export const generateOpaqueGameId = (): string => `g_${randomIdSegment()}`
export const generateOpaqueSubGameId = (): string => `sg_${randomIdSegment()}`
export const generateOpaqueVariantId = (): string => `var_${randomIdSegment()}`

const createLocationDocumentId = (locationKey: string, locationName: string): string => {
  const normalizedKey = String(locationKey ?? '').trim()
  if (normalizedKey) {
    return normalizedKey
  }
  return normalizeUnderscoreId(locationName, 'location')
}

const buildActivityId = (
  locationId: string,
  gameId: string,
  subGameId: string,
  variantId: string,
): string => `activity__${locationId}__${gameId}__${subGameId}__${variantId}`

const parseActivityId = (
  activityId: string,
): { locationId: string; gameId: string; subGameId: string; variantId: string } | null => {
  const parts = String(activityId ?? '')
    .split('__')
    .filter(Boolean)
  if (parts.length !== 5 || parts[0] !== 'activity') {
    return null
  }
  return {
    locationId: parts[1],
    gameId: parts[2],
    subGameId: parts[3],
    variantId: parts[4],
  }
}

const resolveLocationName = (locationId: string, data?: FirestoreLocationDocument): string =>
  String(data?.name ?? LOCATION_LABELS[locationId] ?? locationId).trim() || 'Location'

const getFirestore = () => {
  if (!USE_FIRESTORE_ACTIVITIES) {
    return null
  }
  return initializeFirestore()
}

const getLocationRef = (locationId: string) => {
  const firestore = getFirestore()
  if (!firestore) {
    return null
  }
  return doc(firestore, LOCATIONS_COLLECTION, locationId)
}

const getGameRef = (locationId: string, gameId: string) => {
  const firestore = getFirestore()
  if (!firestore) {
    return null
  }
  return doc(firestore, LOCATIONS_COLLECTION, locationId, GAMES_SUBCOLLECTION, gameId)
}

const getSubGameRef = (locationId: string, gameId: string, subGameId: string) => {
  const firestore = getFirestore()
  if (!firestore) {
    return null
  }
  return doc(
    firestore,
    LOCATIONS_COLLECTION,
    locationId,
    GAMES_SUBCOLLECTION,
    gameId,
    SUBGAMES_SUBCOLLECTION,
    subGameId,
  )
}

const getVariantRef = (
  locationId: string,
  gameId: string,
  subGameId: string,
  variantId: string,
) => {
  const firestore = getFirestore()
  if (!firestore) {
    return null
  }
  return doc(
    firestore,
    LOCATIONS_COLLECTION,
    locationId,
    GAMES_SUBCOLLECTION,
    gameId,
    SUBGAMES_SUBCOLLECTION,
    subGameId,
    VARIANTS_SUBCOLLECTION,
    variantId,
  )
}

const sortByCreatedAtThenName = <T extends { createdAt: string; name?: string; label?: string }>(
  items: T[],
): T[] =>
  [...items].sort((left, right) => {
    const createdCompare = left.createdAt.localeCompare(right.createdAt)
    if (createdCompare !== 0) {
      return createdCompare
    }
    return String(left.name ?? left.label ?? '').localeCompare(
      String(right.name ?? right.label ?? ''),
    )
  })

const toVariantRecord = (
  data: FirestoreVariantDocument,
  locationId: string,
  game: ActivityGameTreeRecord,
  subGame: ActivitySubGameTreeRecord,
): ActivityRecord => {
  const durationMinutes = toNumber(data.durationMinutes ?? data.duration)
  const laps = toNumber(data.laps)
  const createdAt = String(data.createdAt ?? subGame.createdAt ?? game.createdAt ?? nowIso())
  const updatedAt = String(data.updatedAt ?? createdAt)
  const label = String(data.label ?? 'Variant').trim() || 'Variant'
  const active = toBoolean(data.active, true) && game.status === 'Active'
  const bookingName = [game.name, subGame.name, label].filter(Boolean).join(' • ')

  return {
    id: buildActivityId(locationId, game.id, subGame.id, String(data.id ?? '')),
    locationKey: locationId,
    locationName: LOCATION_LABELS[locationId] ?? locationId,
    name: label,
    type: game.name,
    durationMinutes: Math.max(0, Math.round(durationMinutes ?? 0)),
    price: Math.max(0, toNumber(data.price) ?? 0),
    status: active ? 'Active' : 'Inactive',
    activityId: game.id,
    activityName: game.name,
    gameId: game.id,
    gameName: game.name,
    subTypeId: subGame.id,
    subTypeName: subGame.name,
    subGameId: subGame.id,
    subGameName: subGame.name,
    variantId: String(data.id ?? ''),
    variantName: label,
    variantLabel: label,
    imageUrl: game.imageUrl,
    laps,
    bookingName,
    hierarchyPath: [game.name, subGame.name, label],
    bookingMeta: data.metadata,
    // Read vendorId from metadata.vendorId (canonical) with fallback to metadata.vendorUserId
    // (legacy key written by ActivitiesModule before the vendorId normalisation fix).
    vendorId:
      typeof game.metadata?.vendorId === 'string' && game.metadata.vendorId
        ? game.metadata.vendorId
        : typeof game.metadata?.vendorUserId === 'string' && game.metadata.vendorUserId
          ? game.metadata.vendorUserId
          : undefined,
    vendorBranchId:
      typeof game.metadata?.vendorBranchId === 'string' && game.metadata.vendorBranchId
        ? game.metadata.vendorBranchId
        : undefined,
    // Propagate the sub-game's Interakt template choice down to the flat
    // ActivityRecord so booking flows can resolve it without re-walking
    // the hierarchy. Sub-game is the granularity at which templates differ
    // (helicopter vs go-kart vs paintball); variants share the same one.
    interaktTemplateId: subGame.interaktTemplateId,
    interaktTemplateLanguage: subGame.interaktTemplateLanguage,
    // Soft-availability flag stored alongside other variant metadata; surfaced
    // onto the flat ActivityRecord so booking surfaces can filter without
    // re-reading metadata. See ActivityCatalogRecord docs for semantics.
    temporarilyUnavailable: data.metadata?.temporarilyUnavailable === true,
    temporarilyUnavailableReason:
      typeof data.metadata?.temporarilyUnavailableReason === 'string'
        ? data.metadata.temporarilyUnavailableReason
        : undefined,
    temporarilyUnavailableSince:
      typeof data.metadata?.temporarilyUnavailableSince === 'string'
        ? data.metadata.temporarilyUnavailableSince
        : undefined,
    temporarilyUnavailableMarkedById:
      typeof data.metadata?.temporarilyUnavailableMarkedById === 'string'
        ? data.metadata.temporarilyUnavailableMarkedById
        : undefined,
    temporarilyUnavailableMarkedByName:
      typeof data.metadata?.temporarilyUnavailableMarkedByName === 'string'
        ? data.metadata.temporarilyUnavailableMarkedByName
        : undefined,
    temporarilyUnavailableUntil:
      typeof data.metadata?.temporarilyUnavailableUntil === 'string'
        ? data.metadata.temporarilyUnavailableUntil
        : undefined,
    createdAt,
    updatedAt,
  }
}

const readVariants = async (
  locationId: string,
  game: ActivityGameTreeRecord,
  subGame: ActivitySubGameTreeRecord,
): Promise<ActivityVariantTreeRecord[]> => {
  const firestore = getFirestore()
  if (!firestore) {
    return []
  }

  const snapshot = await getDocs(
    collection(
      firestore,
      LOCATIONS_COLLECTION,
      locationId,
      GAMES_SUBCOLLECTION,
      game.id,
      SUBGAMES_SUBCOLLECTION,
      subGame.id,
      VARIANTS_SUBCOLLECTION,
    ),
  )

  return sortByCreatedAtThenName(
    snapshot.docs.map((variantDoc) => {
      const data = variantDoc.data() as FirestoreVariantDocument
      const createdAt = String(data.createdAt ?? subGame.createdAt ?? game.createdAt ?? nowIso())
      const updatedAt = String(data.updatedAt ?? createdAt)
      return {
        id: variantDoc.id,
        label: String(data.label ?? 'Variant').trim() || 'Variant',
        price: Math.max(0, toNumber(data.price) ?? 0),
        durationMinutes: toNumber(data.durationMinutes ?? data.duration),
        laps: toNumber(data.laps),
        active: toBoolean(data.active, true),
        metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : undefined,
        createdAt,
        updatedAt,
      }
    }),
  )
}

const readSubGames = async (
  locationId: string,
  game: ActivityGameTreeRecord,
): Promise<ActivitySubGameTreeRecord[]> => {
  const firestore = getFirestore()
  if (!firestore) {
    return []
  }

  const snapshot = await getDocs(
    collection(
      firestore,
      LOCATIONS_COLLECTION,
      locationId,
      GAMES_SUBCOLLECTION,
      game.id,
      SUBGAMES_SUBCOLLECTION,
    ),
  )

  const subGames = await Promise.all(
    snapshot.docs.map(async (subGameDoc) => {
      const data = subGameDoc.data() as FirestoreSubGameDocument
      const createdAt = String(data.createdAt ?? game.createdAt ?? nowIso())
      const updatedAt = String(data.updatedAt ?? createdAt)
      const subGame: ActivitySubGameTreeRecord = {
        id: subGameDoc.id,
        name: String(data.name ?? 'Sub Game').trim() || 'Sub Game',
        metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : undefined,
        variants: [],
        interaktTemplateId: toOptionalString(data.interaktTemplateId),
        interaktTemplateLanguage: toOptionalString(data.interaktTemplateLanguage),
        createdAt,
        updatedAt,
      }
      return {
        ...subGame,
        variants: await readVariants(locationId, game, subGame),
      }
    }),
  )

  return sortByCreatedAtThenName(subGames)
}

const readGames = async (locationId: string): Promise<ActivityGameTreeRecord[]> => {
  const firestore = getFirestore()
  if (!firestore) {
    return []
  }

  const snapshot = await getDocs(
    collection(firestore, LOCATIONS_COLLECTION, locationId, GAMES_SUBCOLLECTION),
  )

  const games = await Promise.all(
    snapshot.docs.map(async (gameDoc) => {
      const data = gameDoc.data() as FirestoreGameDocument
      const createdAt = String(data.createdAt ?? nowIso())
      const updatedAt = String(data.updatedAt ?? createdAt)
      const platforms = Array.isArray(data.platforms)
        ? data.platforms.filter(
            (p): p is 'web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings' =>
              ['web', 'windows', 'android', 'ios', 'pos', 'bookings'].includes(String(p)),
          )
        : undefined
      const game: ActivityGameTreeRecord = {
        id: gameDoc.id,
        name: String(data.name ?? 'Game').trim() || 'Game',
        imageUrl: toOptionalString(data.imageUrl),
        status: toStatus(data.status),
        platforms: platforms && platforms.length > 0 ? platforms : undefined,
        metadata:
          data.metadata && typeof data.metadata === 'object'
            ? (data.metadata as Record<string, unknown>)
            : undefined,
        subGames: [],
        createdAt,
        updatedAt,
      }
      return {
        ...game,
        subGames: await readSubGames(locationId, game),
      }
    }),
  )

  return sortByCreatedAtThenName(games)
}

export const listFirestoreActivityHierarchy = async (
  locationKey?: BranchLocationKey,
): Promise<ActivityLocationTreeRecord[]> => {
  const firestore = getFirestore()
  if (!firestore) {
    throw new Error('Firestore activities is not configured.')
  }

  let snapshot
  try {
    snapshot = await getDocs(collection(firestore, LOCATIONS_COLLECTION))
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      throw new Error(
        'Firestore rules are blocking `locations/*`. Deploy `firestore.rules` to the `pipeline` database, then reload the Activities module.',
      )
    }
    throw error
  }
  const filteredDocs = locationKey
    ? snapshot.docs.filter(
        (entry) =>
          entry.id === locationKey ||
          String((entry.data() as FirestoreLocationDocument).branchId ?? '').trim() === locationKey,
      )
    : snapshot.docs

  const locations = await Promise.all(
    filteredDocs.map(async (locationDoc) => {
      const data = locationDoc.data() as FirestoreLocationDocument
      const createdAt = String(data.createdAt ?? nowIso())
      const updatedAt = String(data.updatedAt ?? createdAt)
      const locationId =
        String(data.branchId ?? data.locationKey ?? locationDoc.id).trim() || locationDoc.id
      return {
        id: locationId,
        name: resolveLocationName(locationDoc.id, data),
        games: await readGames(locationDoc.id),
        createdAt,
        updatedAt,
      } satisfies ActivityLocationTreeRecord
    }),
  )

  return locations.sort((left, right) => left.id.localeCompare(right.id))
}

const flattenHierarchy = (
  locations: ActivityLocationTreeRecord[],
): Record<BranchLocationKey, ActivityRecord[]> =>
  locations.reduce<Record<BranchLocationKey, ActivityRecord[]>>((accumulator, location) => {
    accumulator[location.id] = location.games.flatMap((game) =>
      game.subGames.flatMap((subGame) =>
        subGame.variants.map((variant) =>
          toVariantRecord(
            {
              id: variant.id,
              label: variant.label,
              price: variant.price,
              durationMinutes: variant.durationMinutes,
              laps: variant.laps,
              active: variant.active,
              metadata: variant.metadata,
              createdAt: variant.createdAt,
              updatedAt: variant.updatedAt,
            },
            location.id,
            game,
            subGame,
          ),
        ),
      ),
    )
    return accumulator
  }, {})

export const isFirestoreActivitiesActive = (): boolean => Boolean(getFirestore())

export const listFirestoreActivities = async (): Promise<
  Record<BranchLocationKey, ActivityRecord[]>
> => {
  const locations = await listFirestoreActivityHierarchy()
  return flattenHierarchy(locations)
}

const ensureUniqueIds = (entries: string[], label: string) => {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry)) {
      throw new Error(`Duplicate ${label} id detected: ${entry}`)
    }
    seen.add(entry)
  }
}

const clearLegacyLocationActivities = async (locationId: string) => {
  const firestore = getFirestore()
  if (!firestore) {
    return
  }

  try {
    const activitySnapshot = await getDocs(
      collection(
        firestore,
        LOCATIONS_COLLECTION,
        locationId,
        LEGACY_LOCATION_ACTIVITIES_SUBCOLLECTION,
      ),
    )
    for (const activityDoc of activitySnapshot.docs) {
      const directVariants = await getDocs(
        collection(
          firestore,
          LOCATIONS_COLLECTION,
          locationId,
          LEGACY_LOCATION_ACTIVITIES_SUBCOLLECTION,
          activityDoc.id,
          VARIANTS_SUBCOLLECTION,
        ),
      ).catch(() => null)
      if (directVariants) {
        await Promise.all(directVariants.docs.map((entry) => deleteDoc(entry.ref)))
      }

      const subtypes = await getDocs(
        collection(
          firestore,
          LOCATIONS_COLLECTION,
          locationId,
          LEGACY_LOCATION_ACTIVITIES_SUBCOLLECTION,
          activityDoc.id,
          LEGACY_LOCATION_SUBTYPES_SUBCOLLECTION,
        ),
      ).catch(() => null)

      if (subtypes) {
        for (const subtypeDoc of subtypes.docs) {
          const subtypeVariants = await getDocs(
            collection(
              firestore,
              LOCATIONS_COLLECTION,
              locationId,
              LEGACY_LOCATION_ACTIVITIES_SUBCOLLECTION,
              activityDoc.id,
              LEGACY_LOCATION_SUBTYPES_SUBCOLLECTION,
              subtypeDoc.id,
              VARIANTS_SUBCOLLECTION,
            ),
          ).catch(() => null)
          if (subtypeVariants) {
            await Promise.all(subtypeVariants.docs.map((entry) => deleteDoc(entry.ref)))
          }
          await deleteDoc(subtypeDoc.ref)
        }
      }

      await deleteDoc(activityDoc.ref)
    }
  } catch {
    // Legacy location collections may not exist.
  }
}

const clearLegacyCollections = async () => {
  const firestore = getFirestore()
  if (!firestore) {
    return
  }

  try {
    const legacyActivities = await getDocs(collection(firestore, LEGACY_ACTIVITIES_COLLECTION))
    for (const legacyDoc of legacyActivities.docs) {
      const nestedGames = await getDocs(
        collection(firestore, LEGACY_ACTIVITIES_COLLECTION, legacyDoc.id, 'games'),
      ).catch(() => null)
      if (nestedGames) {
        await Promise.all(nestedGames.docs.map((entry) => deleteDoc(entry.ref)))
      }
      await deleteDoc(legacyDoc.ref)
    }
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return
    }
    // Legacy root may not exist.
  }

  try {
    const legacyCatalog = await getDocs(collection(firestore, LEGACY_ACTIVITY_CATALOG_COLLECTION))
    await Promise.all(legacyCatalog.docs.map((entry) => deleteDoc(entry.ref)))
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return
    }
    // Legacy catalog may not exist.
  }
}

export const replaceFirestoreLocationHierarchy = async (
  token: string,
  payload: {
    locationKey: BranchLocationKey
    locationName?: string
    games: Array<{
      // Existing Firestore doc id, when the editor is saving a known game.
      // Omit for fresh games — the writer mints an opaque id.
      id?: string
      name: string
      imageUrl?: string
      status: 'Active' | 'Inactive'
      platforms?: ('web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings')[]
      metadata?: Record<string, unknown>
      subGames: Array<{
        id?: string
        name: string
        metadata?: Record<string, unknown>
        interaktTemplateId?: string
        interaktTemplateLanguage?: string
        variants: Array<{
          id?: string
          label: string
          price: number
          durationMinutes?: number
          laps?: number
          active: boolean
          metadata?: Record<string, unknown>
        }>
      }>
    }>
  },
): Promise<ActivityLocationTreeRecord> => {
  const firestore = getFirestore()
  if (!firestore) {
    throw new Error('Firestore activities is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(user.role)) {
    throw new Error('Only Owner or Admin can rebuild activities.')
  }

  const locationId = createLocationDocumentId(payload.locationKey, payload.locationName ?? '')
  const locationName =
    String(payload.locationName ?? LOCATION_LABELS[locationId] ?? payload.locationKey).trim() ||
    'Location'
  const locationRef = getLocationRef(locationId)
  if (!locationRef) {
    throw new Error('Firestore activities is not configured.')
  }

  // ---------------------------------------------------------------------
  // 1. Validate uniqueness on the user-visible labels (cheap, no I/O).
  //    Names/labels are compared case-insensitively after trimming —
  //    distinct-but-similar entries like "5 laps" vs "laps 5" are
  //    accepted; only same-text duplicates are rejected.
  // ---------------------------------------------------------------------
  const normalize = (s: string): string =>
    String(s ?? '')
      .trim()
      .toLowerCase()
  const gameNames = payload.games.map((game) => normalize(game.name))
  if (gameNames.some((n) => !n)) {
    throw new Error('Each game needs a name.')
  }
  ensureUniqueIds(gameNames, 'game')
  for (const game of payload.games) {
    const subGameNames = game.subGames.map((subGame) => normalize(subGame.name))
    if (subGameNames.some((n) => !n)) {
      throw new Error(`Each sub game inside ${game.name || 'a game'} needs a name.`)
    }
    ensureUniqueIds(subGameNames, `sub game in ${game.name}`)
    for (const subGame of game.subGames) {
      const variantLabels = subGame.variants.map((variant) => normalize(variant.label))
      if (variantLabels.some((l) => !l)) {
        throw new Error(`Each variant inside ${subGame.name || 'a sub game'} needs a label.`)
      }
      ensureUniqueIds(variantLabels, `variant in ${game.name} / ${subGame.name}`)
    }
  }

  // Resolve the Firestore doc id for every incoming game / sub-game /
  // variant exactly once. Existing items keep their stable doc id;
  // fresh items get a fresh opaque id minted here so the rest of the
  // writer (set ops, orphan-detection sets, return synthesizer) all
  // see the same value.
  const resolvedGameIds = payload.games.map((game) =>
    typeof game.id === 'string' && game.id.trim() ? game.id.trim() : generateOpaqueGameId(),
  )
  const resolvedSubGameIds = payload.games.map((game) =>
    game.subGames.map((subGame) =>
      typeof subGame.id === 'string' && subGame.id.trim()
        ? subGame.id.trim()
        : generateOpaqueSubGameId(),
    ),
  )
  const resolvedVariantIds = payload.games.map((game) =>
    game.subGames.map((subGame) =>
      subGame.variants.map((variant) =>
        typeof variant.id === 'string' && variant.id.trim()
          ? variant.id.trim()
          : generateOpaqueVariantId(),
      ),
    ),
  )
  const incomingGameIds = new Set(resolvedGameIds)

  // ---------------------------------------------------------------------
  // 2. Pre-fetch the existing hierarchy in three parallel waves.
  //
  // The previous implementation did one sequential `getDoc` per ref just
  // to read `createdAt`, then one sequential `setDoc` per ref. For a
  // typical location (~13 games × 3 subgames × 5 variants) that's ~600
  // round-trips at ~50ms each → ~30s saves. We instead fetch parents in
  // bulk via `getDocs`, which gives us each child's `createdAt` and the
  // orphan list in one query per parent.
  // ---------------------------------------------------------------------
  const gamesCollectionRef = collection(
    firestore,
    LOCATIONS_COLLECTION,
    locationId,
    GAMES_SUBCOLLECTION,
  )
  const [existingLocationSnap, existingGamesSnap] = await Promise.all([
    getDoc(locationRef),
    getDocs(gamesCollectionRef),
  ])

  const existingSubGameSnaps = await Promise.all(
    existingGamesSnap.docs.map((gameDoc) =>
      getDocs(
        collection(
          firestore,
          LOCATIONS_COLLECTION,
          locationId,
          GAMES_SUBCOLLECTION,
          gameDoc.id,
          SUBGAMES_SUBCOLLECTION,
        ),
      ),
    ),
  )

  // Build a flat list of (gameId, subGameId) pairs so we can fetch every
  // variant collection in one parallel wave.
  const subGamePairs: Array<{ gameId: string; subGameId: string }> = []
  existingGamesSnap.docs.forEach((gameDoc, gIdx) => {
    for (const subGameDoc of existingSubGameSnaps[gIdx].docs) {
      subGamePairs.push({ gameId: gameDoc.id, subGameId: subGameDoc.id })
    }
  })
  const existingVariantSnaps = await Promise.all(
    subGamePairs.map((pair) =>
      getDocs(
        collection(
          firestore,
          LOCATIONS_COLLECTION,
          locationId,
          GAMES_SUBCOLLECTION,
          pair.gameId,
          SUBGAMES_SUBCOLLECTION,
          pair.subGameId,
          VARIANTS_SUBCOLLECTION,
        ),
      ),
    ),
  )

  // ---------------------------------------------------------------------
  // 3. Build createdAt lookup maps from the fetched snapshots.
  // ---------------------------------------------------------------------
  const updatedAt = nowIso()
  const locationCreatedAt = String(
    (existingLocationSnap.data() as FirestoreLocationDocument | undefined)?.createdAt ?? nowIso(),
  )
  const gameCreatedAtById = new Map<string, string>(
    existingGamesSnap.docs.map((g) => [
      g.id,
      String((g.data() as FirestoreGameDocument | undefined)?.createdAt ?? updatedAt),
    ]),
  )
  const subGameCreatedAtByPath = new Map<string, string>()
  existingGamesSnap.docs.forEach((gameDoc, gIdx) => {
    for (const subGameDoc of existingSubGameSnaps[gIdx].docs) {
      subGameCreatedAtByPath.set(
        `${gameDoc.id}/${subGameDoc.id}`,
        String((subGameDoc.data() as FirestoreSubGameDocument | undefined)?.createdAt ?? updatedAt),
      )
    }
  })
  const variantCreatedAtByPath = new Map<string, string>()
  subGamePairs.forEach((pair, idx) => {
    for (const variantDoc of existingVariantSnaps[idx].docs) {
      variantCreatedAtByPath.set(
        `${pair.gameId}/${pair.subGameId}/${variantDoc.id}`,
        String((variantDoc.data() as FirestoreVariantDocument | undefined)?.createdAt ?? updatedAt),
      )
    }
  })

  // ---------------------------------------------------------------------
  // 4. Build the flat list of operations (sets + deletes for orphans).
  // ---------------------------------------------------------------------
  type Op =
    | { kind: 'set'; ref: DocumentReference; data: Record<string, unknown> }
    | { kind: 'delete'; ref: DocumentReference }
  const ops: Op[] = []

  ops.push({
    kind: 'set',
    ref: locationRef,
    data: compactDocData({
      name: locationName,
      branchId: payload.locationKey,
      locationKey: payload.locationKey,
      createdAt: locationCreatedAt,
      updatedAt,
    }),
  })

  // Helper: find the variant snapshot for a given (gameId, subGameId).
  const variantSnapAt = (gameId: string, subGameId: string) => {
    const idx = subGamePairs.findIndex((p) => p.gameId === gameId && p.subGameId === subGameId)
    return idx >= 0 ? existingVariantSnaps[idx] : null
  }

  payload.games.forEach((game, gIdx) => {
    const gameId = resolvedGameIds[gIdx]
    const gameRef = getGameRef(locationId, gameId)
    if (!gameRef) throw new Error('Firestore activities is not configured.')

    ops.push({
      kind: 'set',
      ref: gameRef,
      data: compactDocData({
        name: game.name.trim(),
        imageUrl: toOptionalString(game.imageUrl),
        status: game.status,
        platforms: game.platforms && game.platforms.length > 0 ? game.platforms : undefined,
        metadata: game.metadata ?? {},
        createdAt: gameCreatedAtById.get(gameId) ?? updatedAt,
        updatedAt,
      }),
    })

    const incomingSubGameIds = new Set(resolvedSubGameIds[gIdx])

    game.subGames.forEach((subGame, sIdx) => {
      const subGameId = resolvedSubGameIds[gIdx][sIdx]
      const subGameRef = getSubGameRef(locationId, gameId, subGameId)
      if (!subGameRef) throw new Error('Firestore activities is not configured.')

      ops.push({
        kind: 'set',
        ref: subGameRef,
        data: compactDocData({
          name: subGame.name.trim(),
          metadata: subGame.metadata ?? {},
          interaktTemplateId: toOptionalString(subGame.interaktTemplateId),
          interaktTemplateLanguage: toOptionalString(subGame.interaktTemplateLanguage),
          createdAt: subGameCreatedAtByPath.get(`${gameId}/${subGameId}`) ?? updatedAt,
          updatedAt,
        }),
      })

      const incomingVariantIds = new Set(resolvedVariantIds[gIdx][sIdx])

      subGame.variants.forEach((variant, vIdx) => {
        const variantId = resolvedVariantIds[gIdx][sIdx][vIdx]
        const variantRef = getVariantRef(locationId, gameId, subGameId, variantId)
        if (!variantRef) throw new Error('Firestore activities is not configured.')

        ops.push({
          kind: 'set',
          ref: variantRef,
          data: compactDocData({
            label: variant.label.trim(),
            price: Math.max(0, Number(variant.price) || 0),
            durationMinutes:
              typeof variant.durationMinutes === 'number' &&
              Number.isFinite(variant.durationMinutes)
                ? Math.max(0, Math.round(variant.durationMinutes))
                : undefined,
            laps:
              typeof variant.laps === 'number' && Number.isFinite(variant.laps)
                ? Math.max(0, Math.round(variant.laps))
                : undefined,
            active: Boolean(variant.active),
            metadata: variant.metadata ?? {},
            createdAt:
              variantCreatedAtByPath.get(`${gameId}/${subGameId}/${variantId}`) ?? updatedAt,
            updatedAt,
          }),
        })
      })

      // Delete orphaned variants under this surviving subgame.
      const variantSnap = variantSnapAt(gameId, subGameId)
      if (variantSnap) {
        for (const variantDoc of variantSnap.docs) {
          if (!incomingVariantIds.has(variantDoc.id)) {
            ops.push({ kind: 'delete', ref: variantDoc.ref })
          }
        }
      }
    })

    // Delete orphaned subgames under this surviving game (and their variants).
    const existingGameIdx = existingGamesSnap.docs.findIndex((g) => g.id === gameId)
    if (existingGameIdx >= 0) {
      for (const subGameDoc of existingSubGameSnaps[existingGameIdx].docs) {
        if (!incomingSubGameIds.has(subGameDoc.id)) {
          const variantSnap = variantSnapAt(gameId, subGameDoc.id)
          if (variantSnap) {
            for (const variantDoc of variantSnap.docs) {
              ops.push({ kind: 'delete', ref: variantDoc.ref })
            }
          }
          ops.push({ kind: 'delete', ref: subGameDoc.ref })
        }
      }
    }
  })

  // Delete games not in the incoming payload, plus all of their descendants.
  existingGamesSnap.docs.forEach((existingGame, gIdx) => {
    if (incomingGameIds.has(existingGame.id)) return
    for (const subGameDoc of existingSubGameSnaps[gIdx].docs) {
      const variantSnap = variantSnapAt(existingGame.id, subGameDoc.id)
      if (variantSnap) {
        for (const variantDoc of variantSnap.docs) {
          ops.push({ kind: 'delete', ref: variantDoc.ref })
        }
      }
      ops.push({ kind: 'delete', ref: subGameDoc.ref })
    }
    ops.push({ kind: 'delete', ref: existingGame.ref })
  })

  // ---------------------------------------------------------------------
  // 5. Commit operations in writeBatch chunks (Firestore limit: 500/batch).
  // ---------------------------------------------------------------------
  const BATCH_LIMIT = 450
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(firestore)
    for (const op of ops.slice(i, i + BATCH_LIMIT)) {
      if (op.kind === 'set') batch.set(op.ref, op.data)
      else batch.delete(op.ref)
    }
    await batch.commit()
  }

  // ---------------------------------------------------------------------
  // 6. Legacy cleanup runs in the background. These collections are
  // pre-hierarchy migration artifacts; running them on every save was
  // adding ~1-2s of latency per save. Errors are swallowed because the
  // legacy roots may not even exist anymore.
  // ---------------------------------------------------------------------
  void Promise.all([
    clearLegacyLocationActivities(locationId).catch(() => undefined),
    clearLegacyCollections().catch(() => undefined),
  ])

  // ---------------------------------------------------------------------
  // 7. Synthesize the return value from the input payload + the createdAt
  // maps we already have. Both call sites
  // (`useActivitiesEditor.performSave`, vendor import) discard this, but
  // we keep the API contract intact in case future callers need it.
  // ---------------------------------------------------------------------
  return {
    id: payload.locationKey,
    name: locationName,
    games: payload.games.map<ActivityGameTreeRecord>((game, gIdx) => {
      const gameId = resolvedGameIds[gIdx]
      return {
        id: gameId,
        name: game.name.trim(),
        imageUrl: toOptionalString(game.imageUrl),
        status: game.status,
        platforms: game.platforms && game.platforms.length > 0 ? [...game.platforms] : undefined,
        metadata: game.metadata ?? {},
        createdAt: gameCreatedAtById.get(gameId) ?? updatedAt,
        updatedAt,
        subGames: game.subGames.map<ActivitySubGameTreeRecord>((subGame, sIdx) => {
          const subGameId = resolvedSubGameIds[gIdx][sIdx]
          return {
            id: subGameId,
            name: subGame.name.trim(),
            metadata: subGame.metadata ?? {},
            interaktTemplateId: toOptionalString(subGame.interaktTemplateId),
            interaktTemplateLanguage: toOptionalString(subGame.interaktTemplateLanguage),
            createdAt: subGameCreatedAtByPath.get(`${gameId}/${subGameId}`) ?? updatedAt,
            updatedAt,
            variants: subGame.variants.map<ActivityVariantTreeRecord>((variant, vIdx) => {
              const variantId = resolvedVariantIds[gIdx][sIdx][vIdx]
              return {
                id: variantId,
                label: variant.label.trim(),
                price: Math.max(0, Number(variant.price) || 0),
                durationMinutes:
                  typeof variant.durationMinutes === 'number' &&
                  Number.isFinite(variant.durationMinutes)
                    ? Math.max(0, Math.round(variant.durationMinutes))
                    : undefined,
                laps:
                  typeof variant.laps === 'number' && Number.isFinite(variant.laps)
                    ? Math.max(0, Math.round(variant.laps))
                    : undefined,
                active: Boolean(variant.active),
                metadata: variant.metadata ?? {},
                createdAt:
                  variantCreatedAtByPath.get(`${gameId}/${subGameId}/${variantId}`) ?? updatedAt,
                updatedAt,
              }
            }),
          }
        }),
      }
    }),
    createdAt: locationCreatedAt,
    updatedAt,
  }
}

export const createFirestoreActivity = async (): Promise<ActivityRecord> => {
  throw new Error(
    'Legacy single-activity creation has been removed. Use the Activities hierarchy editor.',
  )
}

export const createFirestoreCombo = async (): Promise<ActivityRecord> => {
  throw new Error('Legacy combo creation has been removed. Use hierarchical game variants instead.')
}

export const updateFirestoreActivity = async (): Promise<ActivityRecord> => {
  throw new Error(
    'Legacy single-activity editing has been removed. Save changes from the Activities hierarchy editor.',
  )
}

export const removeFirestoreActivity = async (token: string, activityId: string): Promise<void> => {
  const firestore = getFirestore()
  if (!firestore) {
    throw new Error('Firestore activities is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(user.role)) {
    throw new Error('Only Owner or Admin can delete activities.')
  }

  const identity = parseActivityId(activityId)
  if (!identity) {
    throw new Error('Unknown activity id.')
  }

  const variantRef = getVariantRef(
    identity.locationId,
    identity.gameId,
    identity.subGameId,
    identity.variantId,
  )
  if (!variantRef) {
    throw new Error('Firestore activities is not configured.')
  }
  await deleteDoc(variantRef)
}

/**
 * Toggle the soft-availability flag for a single activity variant. Writes
 * the unavailable bit + audit fields into the variant's metadata via merge,
 * preserving any other metadata (vendorId, slot config, etc.).
 *
 * `unavailable: false` clears all flag fields by setting them to null so they
 * are removed by Firestore's merge semantics, leaving a clean variant doc.
 *
 * Returns true on success. Loud-fails to logger; never throws to the caller
 * since the booking surfaces should keep working even if the flag write fails.
 */
export const setActivityAvailability = async (
  activityId: string,
  params: {
    unavailable: boolean
    reason?: string
    markedById?: string
    markedByName?: string
    /** ISO datetime — flag auto-restores after this point. Omit for open-ended. */
    until?: string
  },
): Promise<boolean> => {
  try {
    const identity = parseActivityId(activityId)
    if (!identity) return false
    const ref = getVariantRef(
      identity.locationId,
      identity.gameId,
      identity.subGameId,
      identity.variantId,
    )
    if (!ref) return false

    const metadataPatch: Record<string, unknown> = params.unavailable
      ? {
          temporarilyUnavailable: true,
          temporarilyUnavailableReason: params.reason ?? '',
          temporarilyUnavailableSince: nowIso(),
          temporarilyUnavailableMarkedById: params.markedById ?? '',
          temporarilyUnavailableMarkedByName: params.markedByName ?? '',
          temporarilyUnavailableUntil: params.until ?? null,
        }
      : {
          temporarilyUnavailable: null,
          temporarilyUnavailableReason: null,
          temporarilyUnavailableSince: null,
          temporarilyUnavailableMarkedById: null,
          temporarilyUnavailableMarkedByName: null,
          temporarilyUnavailableUntil: null,
        }

    await setDoc(ref, { metadata: metadataPatch, updatedAt: nowIso() }, { merge: true })
    // Bust the catalog cache so the next list() call sees the updated state
    // immediately rather than waiting for the 60s TTL.
    try {
      const { clearActivityCatalogCache } = await import('./activity-catalog-firestore')
      clearActivityCatalogCache()
    } catch {
      // Cache clearing is best-effort — the TTL will eventually catch up.
    }
    return true
  } catch (error) {
    const { logger } = await import('../../lib/logger')
    logger.error('activities_firestore.set_availability_failed', error, { activityId })
    return false
  }
}

export const getFirestoreActivityById = async (
  activityId: string,
): Promise<Record<string, unknown> | null> => {
  const identity = parseActivityId(activityId)
  if (!identity) {
    return null
  }

  const [location] = await listFirestoreActivityHierarchy(identity.locationId)
  const game = location?.games.find((entry) => entry.id === identity.gameId)
  const subGame = game?.subGames.find((entry) => entry.id === identity.subGameId)
  const variant = subGame?.variants.find((entry) => entry.id === identity.variantId)

  if (!location || !game || !subGame || !variant) {
    return null
  }

  const record = toVariantRecord(
    {
      id: variant.id,
      label: variant.label,
      price: variant.price,
      durationMinutes: variant.durationMinutes,
      laps: variant.laps,
      active: variant.active,
      metadata: variant.metadata,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
    },
    location.id,
    game,
    subGame,
  )

  return {
    id: record.id,
    name: record.name,
    label: variant.label,
    price: variant.price,
    durationMinutes: variant.durationMinutes,
    laps: variant.laps,
    active: variant.active,
    status: record.status,
    gameId: game.id,
    gameName: game.name,
    subGameId: subGame.id,
    subGameName: subGame.name,
    imageUrl: game.imageUrl,
    hierarchyPath: record.hierarchyPath,
    bookingMeta: variant.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
