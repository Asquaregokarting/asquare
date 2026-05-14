import {
  getFirestoreActivityById,
  listFirestoreActivities,
  listFirestoreActivityHierarchy,
  removeFirestoreActivity,
  replaceFirestoreLocationHierarchy,
} from './activities-firestore'
import { apiRequest } from './client'
import {
  ActivityBookingRecord,
  ActivityLocationTreeRecord,
  ActivityRecord,
  BranchLocationKey,
} from './types'

export interface ActivitiesByLocationResponse {
  activitiesByLocation: Record<BranchLocationKey, ActivityRecord[]>
}

export interface ActivitiesHierarchyResponse {
  locations: ActivityLocationTreeRecord[]
}

export interface ActivityDetailsRecord extends Record<string, unknown> {
  id: string
}

export interface ActivityBookingListResponse {
  bookings: ActivityBookingRecord[]
}

export const activitiesApi = {
  async list(token: string): Promise<ActivitiesByLocationResponse> {
    if (!token) {
      throw new Error('Unauthorized')
    }
    const activitiesByLocation = await listFirestoreActivities()
    return { activitiesByLocation }
  },

  async listHierarchy(token: string): Promise<ActivitiesHierarchyResponse> {
    if (!token) {
      throw new Error('Unauthorized')
    }
    const locations = await listFirestoreActivityHierarchy()
    return { locations }
  },

  async replaceLocationHierarchy(
    token: string,
    payload: {
      locationKey: BranchLocationKey
      locationName?: string
      games: Array<{
        id?: string
        name: string
        imageUrl?: string
        status: 'Active' | 'Inactive'
        platforms?: ('web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings')[]
        subGames: Array<{
          id?: string
          name: string
          metadata?: Record<string, unknown>
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
  ): Promise<{ location: ActivityLocationTreeRecord }> {
    const location = await replaceFirestoreLocationHierarchy(token, payload)
    return { location }
  },

  async createActivity(): Promise<never> {
    throw new Error('Legacy single-activity creation has been removed. Use the hierarchy editor.')
  },

  async createCombo(): Promise<never> {
    throw new Error('Legacy combo creation has been removed in the rebuilt Activities module.')
  },

  async updateActivity(): Promise<never> {
    throw new Error(
      'Legacy single-activity editing has been removed. Save changes from the hierarchy editor.',
    )
  },

  async removeActivity(token: string, activityId: string): Promise<{ message: string }> {
    await removeFirestoreActivity(token, activityId)
    return { message: 'Activity deleted.' }
  },

  async getActivityDetails(
    token: string,
    activityId: string,
  ): Promise<{ activity: ActivityDetailsRecord }> {
    if (!token) {
      throw new Error('Unauthorized')
    }
    const activity = await getFirestoreActivityById(activityId)
    if (!activity) {
      throw new Error('Activity not found.')
    }
    return { activity: activity as ActivityDetailsRecord }
  },

  listBookings(
    token: string,
    query?: { locationKey?: BranchLocationKey; limit?: number },
  ): Promise<ActivityBookingListResponse> {
    const params = new URLSearchParams()
    if (query?.locationKey) params.set('locationKey', query.locationKey)
    if (typeof query?.limit === 'number') params.set('limit', String(query.limit))
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return apiRequest(`/activities/bookings${suffix}`, { method: 'GET' }, { token })
  },

  sendBookingLink(
    token: string,
    payload: {
      customerName: string
      phone: string
      locationKey: BranchLocationKey
      activityIds: string[]
    },
  ): Promise<{ booking: ActivityBookingRecord }> {
    return apiRequest(
      '/activities/bookings/send',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      { token },
    )
  },
}
