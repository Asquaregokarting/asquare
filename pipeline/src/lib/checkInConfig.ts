import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { db } from './firebase'
import { logger } from './logger'

export interface CheckInField {
  id: string
  label: string
  type: 'text' | 'number' | 'select' | 'checkbox' | 'date' | 'email' | 'tel'
  required: boolean
  enabled: boolean
  placeholder?: string
  options?: string[] // For select type
  isSystem?: boolean // If true, cannot be deleted (e.g. Name, Weight)
}

export type SlotStatus = 'available' | 'blocked' | 'lunch' | 'booked' | 'fast-filling'

export interface SlotInfo {
  time: string
  status: SlotStatus
  capacityOverride?: number // per-slot capacity override
}

export interface CheckInConfig {
  fields: CheckInField[]
  allowGuestCheckIn: boolean
  availableTimings: string[]
  dateTimings: Record<string, string[]>
  locationTimings?: Record<string, Record<string, string[]>> // locationId -> date -> timings
  slotCapacity: number // default 45 passengers per slot
  // dateKey -> timeSlot -> SlotStatus
  slotStatuses?: Record<string, Record<string, SlotStatus>>
  // locationId -> dateKey -> timeSlot -> SlotStatus
  locationSlotStatuses?: Record<string, Record<string, Record<string, SlotStatus>>>
  // per-slot capacity overrides: dateKey -> timeSlot -> capacity
  slotCapacityOverrides?: Record<string, Record<string, number>>
  locationSlotCapacityOverrides?: Record<string, Record<string, Record<string, number>>>
}

export const DEFAULT_CHECKIN_CONFIG: CheckInConfig = {
  allowGuestCheckIn: true,
  slotCapacity: 45,
  availableTimings: ['09:00 AM', '10:30 AM', '12:00 PM', '02:00 PM', '04:00 PM'],
  dateTimings: {},
  locationTimings: {},
  slotStatuses: {},
  locationSlotStatuses: {},
  slotCapacityOverrides: {},
  locationSlotCapacityOverrides: {},
  fields: [
    {
      id: 'name',
      label: 'Full Name',
      type: 'text',
      required: true,
      enabled: true,
      isSystem: true,
      placeholder: 'As per ID proof',
    },
    {
      id: 'weight',
      label: 'Weight (kg)',
      type: 'number',
      required: true,
      enabled: true,
      isSystem: true,
      placeholder: '0.0',
    },
    {
      id: 'age',
      label: 'Age',
      type: 'number',
      required: false,
      enabled: true,
      isSystem: true,
      placeholder: 'Years',
    },
    {
      id: 'gender',
      label: 'Gender',
      type: 'select',
      required: false,
      enabled: true,
      isSystem: true,
      options: ['Male', 'Female', 'Other', 'Prefer not to say'],
    },
    {
      id: 'email',
      label: 'Email',
      type: 'email',
      required: false,
      enabled: false,
      isSystem: false,
      placeholder: 'passenger@example.com',
    },
    {
      id: 'phone',
      label: 'Phone',
      type: 'tel',
      required: false,
      enabled: false,
      isSystem: false,
      placeholder: '+91 98765 43210',
    },
  ],
}

export const getCheckInConfig = async (): Promise<CheckInConfig> => {
  try {
    const docRef = doc(db, 'settings', 'checkin')
    const snap = await getDoc(docRef)
    if (snap.exists()) {
      return { ...DEFAULT_CHECKIN_CONFIG, ...snap.data() } as CheckInConfig
    }
    return DEFAULT_CHECKIN_CONFIG
  } catch (error) {
    logger.error('checkin.fetch_config_failed', error)
    return DEFAULT_CHECKIN_CONFIG
  }
}

export const saveCheckInConfig = async (config: CheckInConfig): Promise<void> => {
  try {
    const docRef = doc(db, 'settings', 'checkin')
    await setDoc(docRef, config)
  } catch (error) {
    logger.error('checkin.save_config_failed', error)
    throw error
  }
}

// Get checked-in passenger count for a specific date + time slot + location
export const getCheckedInCounts = async (
  dateKey: string,
  locationId?: string,
): Promise<Record<string, number>> => {
  try {
    // Query bookings collection for this date with check-in completed
    const bookingsRef = collection(db, 'bookings')

    // Build date range for the dateKey (YYYY-MM-DD)
    const startOfDay = new Date(dateKey + 'T00:00:00.000Z')
    const endOfDay = new Date(dateKey + 'T23:59:59.999Z')
    const q = query(
      bookingsRef,
      where('checkInStatus', '==', 'completed'),
      where('sessionDate', '>=', startOfDay),
      where('sessionDate', '<=', endOfDay),
    )

    const snap = await getDocs(q)
    const counts: Record<string, number> = {}

    snap.docs.forEach((d) => {
      const data = d.data()
      // Filter by location if specified
      if (locationId && data.locationId !== locationId) return

      const items = data.items || []
      const timeSlot = items[0]?.timeSlot || 'unassigned'
      const passengerCount =
        data.passengers?.length ||
        items.reduce((acc: number, i: { quantity?: number }) => acc + (i.quantity || 0), 0)
      counts[timeSlot] = (counts[timeSlot] || 0) + passengerCount
    })

    return counts
  } catch (error) {
    logger.error('checkin.get_counts_failed', error)
    return {}
  }
}

export interface CheckedInPassengerInfo {
  bookingId: string
  passengerName: string
  flightNumber?: string
  contactNumber?: string
  weight?: string | number
  age?: string | number
  gender?: string
  email?: string
}

// Get check-in passengers for a specific date + time slot + location
export const getCheckedInPassengers = async (
  dateKey: string,
  timeSlot: string,
  locationId?: string,
): Promise<CheckedInPassengerInfo[]> => {
  try {
    const bookingsRef = collection(db, 'bookings')
    const startOfDay = new Date(dateKey + 'T00:00:00')
    const endOfDay = new Date(dateKey + 'T23:59:59')

    const q = query(
      bookingsRef,
      where('checkInStatus', '==', 'completed'),
      where('sessionDate', '>=', startOfDay),
      where('sessionDate', '<=', endOfDay),
    )

    const snap = await getDocs(q)
    const passengers: CheckedInPassengerInfo[] = []

    snap.docs.forEach((d) => {
      const data = d.data()
      if (locationId && data.locationId !== locationId) return

      const items = data.items || []
      const bookingSlot = items[0]?.timeSlot || 'unassigned'

      if (bookingSlot === timeSlot) {
        // If the booking has an array of passengers, add them all
        if (data.passengers && Array.isArray(data.passengers)) {
          data.passengers.forEach(
            (p: {
              name?: string
              phone?: string
              weight?: string | number
              age?: string | number
              gender?: string
              email?: string
            }) => {
              passengers.push({
                bookingId: d.id,
                passengerName: p.name || 'Guest',
                flightNumber: data.flightNumber,
                contactNumber: p.phone || data.phone || data.userPhoneNumber,
                weight: p.weight,
                age: p.age,
                gender: p.gender,
                email: p.email,
              })
            },
          )
        } else {
          // Fallback for older bookings
          passengers.push({
            bookingId: d.id,
            passengerName: data.userDisplayName || 'Guest',
            flightNumber: data.flightNumber,
            contactNumber: data.phone || data.userPhoneNumber,
          })
        }
      }
    })

    return passengers
  } catch (error) {
    logger.error('checkin.get_passengers_failed', error)
    return []
  }
}

// Update the time slot for a checked-in booking
export const updateBookingTimeSlot = async (
  bookingId: string,
  newDateKey: string,
  newTimeSlot: string,
): Promise<boolean> => {
  try {
    const bookingRef = doc(db, 'bookings', bookingId)
    const snap = await getDoc(bookingRef)

    if (!snap.exists()) {
      throw new Error('Booking not found')
    }

    const data = snap.data()
    const items = data.items || []

    // Update the time slot in the first item (assuming single activity bookings for check-in)
    if (items.length > 0) {
      items[0].timeSlot = newTimeSlot
    }

    // Keep the time portion from the original sessionDate, but update the year/month/day
    const originalDate = new Date(
      data.sessionDate.toDate ? data.sessionDate.toDate() : data.sessionDate,
    )
    const newDateParts = newDateKey.split('-') // YYYY-MM-DD

    const newSessionDate = new Date(originalDate)
    newSessionDate.setFullYear(parseInt(newDateParts[0], 10))
    newSessionDate.setMonth(parseInt(newDateParts[1], 10) - 1)
    newSessionDate.setDate(parseInt(newDateParts[2], 10))

    // visitDate (YYYY-MM-DD in IST) is what the admin dashboard buckets
    // by, what feedback-calls filter by, and what the future-bookings
    // strip queries against. After a reschedule we MUST flip it to the
    // new date or the booking sticks in the old bucket. newDateKey is
    // already a YYYY-MM-DD in the user's intended IST day.
    await setDoc(
      bookingRef,
      {
        ...data,
        items,
        sessionDate: newSessionDate,
        visitDate: newDateKey,
        updatedAt: new Date(),
      },
      { merge: true },
    )

    return true
  } catch (error) {
    logger.error('checkin.update_time_slot_failed', error)
    return false
  }
}

// Get the effective slot status for a specific date/time
export const getEffectiveSlotStatus = (
  config: CheckInConfig,
  dateKey: string,
  timeSlot: string,
  locationId?: string,
): SlotStatus => {
  // 1. Check location-specific status
  if (locationId && config.locationSlotStatuses?.[locationId]?.[dateKey]?.[timeSlot]) {
    return config.locationSlotStatuses[locationId][dateKey][timeSlot]
  }
  // 2. Check global date status
  if (config.slotStatuses?.[dateKey]?.[timeSlot]) {
    return config.slotStatuses[dateKey][timeSlot]
  }
  // 3. Default
  return 'available'
}

// Get effective capacity for a slot
export const getEffectiveSlotCapacity = (
  config: CheckInConfig,
  dateKey: string,
  timeSlot: string,
  locationId?: string,
): number => {
  // 1. Check location-specific override
  if (locationId && config.locationSlotCapacityOverrides?.[locationId]?.[dateKey]?.[timeSlot]) {
    return config.locationSlotCapacityOverrides[locationId][dateKey][timeSlot]
  }
  // 2. Check global date override
  if (config.slotCapacityOverrides?.[dateKey]?.[timeSlot]) {
    return config.slotCapacityOverrides[dateKey][timeSlot]
  }
  // 3. Global default
  return config.slotCapacity
}
