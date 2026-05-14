import { collection, doc, getDoc, getDocs, type Firestore } from 'firebase/firestore'
import type { BranchLocation } from '../types'

// ── Fallback data (available synchronously before Firestore loads) ────
const FALLBACK_LOCATIONS: BranchLocation[] = [
  {
    slug: 'visakhapatnam',
    branchId: '0',
    displayName: 'Visakhapatnam',
    shortName: 'Vizag',
    enabled: true,
    firestoreDocId: 'visakhapatnam',
  },
  {
    slug: 'kakinada',
    branchId: '1',
    displayName: 'Kakinada',
    shortName: 'Kakinada',
    enabled: true,
    firestoreDocId: 'kakinada',
  },
  {
    slug: 'rajahmundry',
    branchId: '2',
    displayName: 'Rajahmundry',
    shortName: 'Rajahmundry',
    enabled: true,
    firestoreDocId: 'rajahmundry',
  },
  {
    slug: 'srikakulam',
    branchId: '5',
    displayName: 'Srikakulam',
    shortName: 'Srikakulam',
    enabled: true,
    firestoreDocId: 'srikakulam',
  },
]

// ── Legacy aliases — old slugs/variants that map to current slugs ─────
const LEGACY_ALIASES: Record<string, string> = {
  vizag: 'visakhapatnam',
  vskp: 'visakhapatnam',
  kkd: 'kakinada',
  rjy: 'rajahmundry',
}

// ── Singleton state ───────────────────────────────────────────────────
let currentLocations: BranchLocation[] = FALLBACK_LOCATIONS
let bySlug = new Map<string, BranchLocation>()
let byBranchId = new Map<string, BranchLocation>()
let byDisplayName = new Map<string, BranchLocation>()

function rebuildMaps(locations: BranchLocation[]) {
  currentLocations = locations
  bySlug = new Map()
  byBranchId = new Map()
  byDisplayName = new Map()
  for (const loc of locations) {
    bySlug.set(loc.slug.toLowerCase(), loc)
    byBranchId.set(loc.branchId, loc)
    byDisplayName.set(loc.displayName.toLowerCase(), loc)
    if (loc.shortName.toLowerCase() !== loc.displayName.toLowerCase()) {
      byDisplayName.set(loc.shortName.toLowerCase(), loc)
    }
  }
  // Index legacy aliases so old slugs resolve correctly
  for (const [alias, canonical] of Object.entries(LEGACY_ALIASES)) {
    if (!bySlug.has(alias)) {
      const target = bySlug.get(canonical)
      if (target) bySlug.set(alias, target)
    }
  }
}

// Build maps from fallback on load
rebuildMaps(FALLBACK_LOCATIONS)

// ── Lookup functions (synchronous) ────────────────────────────────────

export function getAllLocations(): BranchLocation[] {
  return currentLocations
}

export function getEnabledLocations(): BranchLocation[] {
  return currentLocations.filter((l) => l.enabled)
}

export function getLocationBySlug(slug: string): BranchLocation | undefined {
  return bySlug.get(slug.toLowerCase())
}

export function getLocationByBranchId(branchId: string): BranchLocation | undefined {
  return byBranchId.get(branchId)
}

export function getLocationByDisplayName(name: string): BranchLocation | undefined {
  return byDisplayName.get(name.toLowerCase())
}

/** Resolve any location identifier (slug, branchId, or display name) to a BranchLocation. */
export function resolveLocation(idOrSlugOrName: string): BranchLocation | undefined {
  const key = idOrSlugOrName.toLowerCase()
  return bySlug.get(key) ?? byBranchId.get(idOrSlugOrName) ?? byDisplayName.get(key)
}

export function slugToBranchId(slug: string): string {
  return getLocationBySlug(slug)?.branchId ?? slug
}

export function branchIdToSlug(branchId: string): string {
  return getLocationByBranchId(branchId)?.slug ?? branchId
}

export function branchIdToDisplayName(branchId: string): string {
  return getLocationByBranchId(branchId)?.displayName ?? branchId
}

/** Resolve any identifier to the full display name. */
export function getLocationDisplayName(idOrSlug: string): string {
  return resolveLocation(idOrSlug)?.displayName ?? idOrSlug
}

/** Resolve any identifier to the short display name (e.g. "Vizag"). */
export function getLocationShortName(idOrSlug: string): string {
  return resolveLocation(idOrSlug)?.shortName ?? idOrSlug
}

/**
 * Normalize any location variant ("vizag", "Vizag", "VISAKHAPATNAM", etc.)
 * into the canonical branchId ("0"). Returns the input unchanged if
 * it cannot be resolved to a known location.
 */
export function normalizeLocationId(value: string): string {
  if (!value) return value
  const resolved = resolveLocation(value)
  return resolved?.branchId ?? value
}

/**
 * Normalize any location variant ("0", "vizag", "Visakhapatnam", etc.)
 * into the canonical slug form ("visakhapatnam"). The slug is what every
 * `bookings.locationId` is stored as (after the 2026-05-11 normalization
 * pass); use this at WRITE time so writers can't drift back to the
 * numeric or alias forms that previously fragmented dashboards.
 *
 * Returns the input unchanged if it cannot be resolved to a known
 * location, so unfamiliar inputs aren't silently mangled.
 */
export function normalizeLocationSlug(value: string): string {
  if (!value) return value
  const resolved = resolveLocation(value)
  return resolved?.slug ?? value
}

/**
 * Normalize a localStorage location value. Reads the key, normalizes the
 * stored value, and overwrites it if it was a legacy variant.
 */
export function normalizeStoredLocation(storageKey: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const normalized = normalizeLocationId(raw)
    if (normalized !== raw) {
      localStorage.setItem(storageKey, normalized)
    }
    return normalized
  } catch {
    return null
  }
}

// ── Derived maps (for backward-compatible imports) ────────────────────

/** slug → branchId mapping. */
export function getSlugToBranchIdMap(): Record<string, string> {
  return Object.fromEntries(currentLocations.map((l) => [l.slug, l.branchId]))
}

/** branchId → slug mapping. */
export function getBranchIdToSlugMap(): Record<string, string> {
  return Object.fromEntries(currentLocations.map((l) => [l.branchId, l.slug]))
}

/** branchId → displayName mapping. */
export function getBranchIdToDisplayNameMap(): Record<string, string> {
  return Object.fromEntries(currentLocations.map((l) => [l.branchId, l.displayName]))
}

// ── Firestore fetcher ─────────────────────────────────────────────────

interface FirestoreLocationDoc {
  name?: string
  branchId?: string
  locationKey?: string
  [key: string]: unknown
}

const SHORT_NAME_OVERRIDES: Record<string, string> = {
  visakhapatnam: 'Vizag',
}

function deriveShortName(displayName: string): string {
  return SHORT_NAME_OVERRIDES[displayName.toLowerCase()] ?? displayName
}

/**
 * Fetches locations from Firestore `locations/` collection and visibility
 * overrides from `settings/admin_locations`. Updates the singleton maps so
 * all synchronous lookup functions use live data after the first call.
 *
 * @param db - The Firestore instance (asquare-app-db / pipeline db — same after merge)
 */
export async function fetchLocationsFromFirestore(db: Firestore): Promise<BranchLocation[]> {
  // 1. Read all location documents
  const locationsSnap = await getDocs(collection(db, 'locations'))

  // 2. Read visibility overrides
  let overrides: Record<string, boolean> = {}
  try {
    const overridesSnap = await getDoc(doc(db, 'settings', 'admin_locations'))
    if (overridesSnap.exists()) {
      overrides = (overridesSnap.data() as { overrides?: Record<string, boolean> }).overrides ?? {}
    }
  } catch {
    // Permission denied or missing — use defaults (all enabled)
  }

  // 3. Build BranchLocation[] from Firestore docs
  const locations: BranchLocation[] = []
  for (const docSnap of locationsSnap.docs) {
    const data = docSnap.data() as FirestoreLocationDoc
    const displayName = (data.name ?? docSnap.id).trim()
    const rawSlug = (data.locationKey ?? docSnap.id).trim().toLowerCase()
    // Legacy data wrote `locationKey` as the branchId itself ("0", "1", "2")
    // instead of the canonical slug ("visakhapatnam", "kakinada",
    // "rajahmundry"). When the raw slug matches a known fallback's
    // branchId, swap in the canonical slug. Without this, every consumer
    // that compares against canonical slugs (event-campaign filters,
    // BillingModule.locationKey, useLocations.allowedSlugs, etc.) silently
    // misses live data — observed via Rajahmundry cashier seeing "no
    // active event campaigns" because campaigns store locationKeys as
    // ["0","1","2"] (canonical branchIds) and the cashier's locationKey
    // resolved to the literal numeric slug "2" only when comparing it
    // back to itself; non-canonical paths broke.
    const fallbackByBranchId = FALLBACK_LOCATIONS.find((f) => f.branchId === rawSlug)
    const slug = fallbackByBranchId ? fallbackByBranchId.slug : rawSlug
    // Prefer explicit branchId from Firestore; fall back to the known
    // fallback mapping so the numeric "0"/"1"/"2" keys stay in the
    // byBranchId map even when the Firestore doc omits branchId.
    const branchId =
      data.branchId?.trim() ||
      FALLBACK_LOCATIONS.find((f) => f.slug === slug)?.branchId ||
      docSnap.id
    const firestoreDocId = docSnap.id

    locations.push({
      slug,
      branchId,
      displayName,
      shortName: deriveShortName(displayName),
      enabled: overrides[slug] !== false && overrides[firestoreDocId] !== false,
      firestoreDocId,
    })
  }

  // 4. If Firestore returned nothing, keep fallback
  if (locations.length === 0) {
    return currentLocations
  }

  // 5. Update singleton
  rebuildMaps(locations)
  return locations
}
