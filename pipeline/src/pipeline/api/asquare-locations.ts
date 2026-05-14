import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { getAsquareFirestore, toOptionalDate } from './asquare-firestore'
import { getAllLocations } from '../../lib/locations'
import { listFirestoreActivityHierarchy } from './activities-firestore'
import { listFirestoreUsers } from './users-firestore'
import type { BranchLocation } from '../../types'
import type { ActivityGameTreeRecord } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AsquareLocationWithMetrics {
  id: string
  name: string
  enabled: boolean
  bookingCount: number
  revenue: number
  lastBookingAt?: Date
}

export interface LocationDetailActivity {
  gameId: string
  name: string
  status: 'Active' | 'Inactive'
  subGames: Array<{ id: string; name: string; variantCount: number }>
}

export interface LocationDetailStaff {
  id: string
  name: string
  role: string
  status: string
}

export interface LocationDetail {
  id: string
  name: string
  shortName: string
  enabled: boolean
  bookingCount: number
  revenue: number
  lastBookingAt?: Date
  activities: LocationDetailActivity[]
  staff: LocationDetailStaff[]
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const asquareLocationsApi = {
  /**
   * Returns all known locations enriched with booking metrics (count, revenue,
   * last booking date) and visibility overrides from `settings/admin_locations`.
   */
  async listLocationsWithMetrics(): Promise<AsquareLocationWithMetrics[]> {
    const firestore = getAsquareFirestore()

    // 1. Read visibility overrides
    const overridesSnap = await getDoc(doc(firestore, 'settings', 'admin_locations'))
    const overridesData = overridesSnap.exists()
      ? (overridesSnap.data() as { overrides?: Record<string, boolean> })
      : {}
    const overrides: Record<string, boolean> = overridesData.overrides ?? {}

    // 2. Read all bookings to compute per-location metrics
    const bookingsSnap = await getDocs(
      query(collection(firestore, 'bookings'), orderBy('createdAt', 'desc')),
    )

    const metricsMap: Record<
      string,
      { bookingCount: number; revenue: number; lastBookingAt?: Date }
    > = {}

    for (const record of bookingsSnap.docs) {
      const data = record.data() as Record<string, unknown>
      // Skip soft-deleted (Trash) bookings — they shouldn't contribute
      // to the per-location booking count or revenue tile on the
      // Locations module dashboard.
      if (data.deletedAt) continue
      const locationId = String(data.locationId ?? '')
      if (!locationId) continue

      if (!metricsMap[locationId]) {
        metricsMap[locationId] = { bookingCount: 0, revenue: 0 }
      }

      metricsMap[locationId].bookingCount += 1
      metricsMap[locationId].revenue += Number(data.finalAmount ?? 0)

      if (!metricsMap[locationId].lastBookingAt) {
        metricsMap[locationId].lastBookingAt = toOptionalDate(data.createdAt)
      }
    }

    // 3. Merge everything into the result — sourced from centralized registry
    const locations = getAllLocations()
    return locations.map((loc) => {
      const metrics = metricsMap[loc.slug] ?? { bookingCount: 0, revenue: 0 }
      return {
        id: loc.slug,
        name: loc.displayName,
        enabled: overrides[loc.slug] !== false,
        bookingCount: metrics.bookingCount,
        revenue: metrics.revenue,
        lastBookingAt: metrics.lastBookingAt,
      }
    })
  },

  /**
   * Creates a new branch location document in the Firestore `locations/` collection.
   * The branchId is auto-assigned as the next integer after the highest existing one.
   * Returns the resulting BranchLocation so the caller can switch to it immediately.
   */
  async createLocation(
    displayName: string,
    shortName: string | undefined,
    existingLocations: BranchLocation[],
  ): Promise<BranchLocation> {
    const firestore = getAsquareFirestore()
    const slug = displayName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    const maxBranchId = Math.max(
      -1,
      ...existingLocations.map((l) => Number(l.branchId)).filter(Number.isFinite),
    )
    const branchId = String(maxBranchId + 1)
    await setDoc(doc(firestore, 'locations', slug), {
      name: displayName,
      locationKey: slug,
      branchId,
    })
    return {
      slug,
      branchId,
      displayName,
      shortName: shortName || displayName,
      enabled: true,
      firestoreDocId: slug,
    }
  },

  /**
   * Persist location visibility overrides to `settings/admin_locations`.
   */
  async updateLocationVisibility(overrides: Record<string, boolean>): Promise<void> {
    const firestore = getAsquareFirestore()
    await setDoc(doc(firestore, 'settings', 'admin_locations'), { overrides }, { merge: true })
  },

  /**
   * Fetch full detail for a single location: metrics, activities, and staff.
   */
  async getLocationDetail(slug: string): Promise<LocationDetail> {
    // Fetch metrics, activities, and staff in parallel
    const [metricsAll, hierarchy, users] = await Promise.all([
      asquareLocationsApi.listLocationsWithMetrics(),
      listFirestoreActivityHierarchy(slug).catch(() => []),
      listFirestoreUsers({ status: 'Active' }).catch(() => []),
    ])

    const metrics = metricsAll.find((l) => l.id === slug)
    const loc = getAllLocations().find((l) => l.slug === slug)

    const locationHierarchy = hierarchy.find((h) => h.id === slug)
    const games: ActivityGameTreeRecord[] = locationHierarchy?.games ?? []

    const activities: LocationDetailActivity[] = games.map((g) => ({
      gameId: g.id,
      name: g.name,
      status: g.status,
      subGames: g.subGames.map((sg) => ({
        id: sg.id,
        name: sg.name,
        variantCount: sg.variants.length,
      })),
    }))

    const staff: LocationDetailStaff[] = users
      .filter((u) => u.allowedLocations?.includes(slug))
      .map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        status: u.isActive ? 'Active' : 'Inactive',
      }))

    return {
      id: slug,
      name: loc?.displayName ?? metrics?.name ?? slug,
      shortName: loc?.shortName ?? loc?.displayName ?? slug,
      enabled: metrics?.enabled ?? true,
      bookingCount: metrics?.bookingCount ?? 0,
      revenue: metrics?.revenue ?? 0,
      lastBookingAt: metrics?.lastBookingAt,
      activities,
      staff,
    }
  },

  /**
   * Update location display name and short name.
   */
  async updateLocationDetails(
    slug: string,
    details: { displayName: string; shortName?: string },
  ): Promise<void> {
    const firestore = getAsquareFirestore()
    await updateDoc(doc(firestore, 'locations', slug), {
      name: details.displayName,
      ...(details.shortName ? { shortName: details.shortName } : {}),
    })
  },

  /**
   * Toggle a game's status at a specific location.
   */
  async toggleGameStatus(locationSlug: string, gameId: string, active: boolean): Promise<void> {
    const firestore = getAsquareFirestore()
    await updateDoc(doc(firestore, 'locations', locationSlug, 'games', gameId), {
      status: active ? 'Active' : 'Inactive',
    })
  },
}
