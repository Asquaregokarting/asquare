import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { getAsquareFirestore, toDate } from './asquare-firestore'
import { isTerminatedBooking } from '../../lib/booking-filter'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RevenueBooking {
  id: string
  locationId: string
  finalAmount: number
  bookingStatus: string
  paymentStatus: string
  createdAt: Date
  sessionDate: Date
  items: Array<Record<string, unknown>>
  userDisplayName: string
  userPhone: string
  createdByRole?: string
  isHelicopter: boolean
}

export interface RevenueData {
  bookings: RevenueBooking[]
  totalRevenue: number
  pendingRevenue: number
  totalQuantity: number
}

export interface RevenueFilters {
  locationId?: string
  dateFrom?: string
  dateTo?: string
  type?: 'helicopter' | 'other' | 'all'
  source?: 'telecaller' | 'online' | 'desk' | 'all'
  status?: string
  search?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isHelicopterBooking = (items: Array<Record<string, unknown>>): boolean =>
  items.some((item) => {
    const activity = item.activity as Record<string, unknown> | undefined
    if (!activity) return false
    const name = String(activity.name ?? '').toLowerCase()
    const category = String(activity.category ?? '').toLowerCase()
    return name.includes('helicopter') || category.includes('helicopter')
  })

const parseRevenueBooking = (data: Record<string, unknown>): RevenueBooking => {
  const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []

  return {
    id: String(data.id ?? ''),
    locationId: String(data.locationId ?? ''),
    finalAmount: Number(data.finalAmount ?? 0),
    bookingStatus: String(data.bookingStatus ?? ''),
    paymentStatus: String(data.paymentStatus ?? ''),
    createdAt: toDate(data.createdAt),
    sessionDate: toDate(data.sessionDate),
    items,
    userDisplayName: String(data.userDisplayName ?? ''),
    userPhone: String(data.userPhone ?? ''),
    createdByRole: typeof data.createdByRole === 'string' ? data.createdByRole : undefined,
    isHelicopter: isHelicopterBooking(items),
  }
}

const matchesFilters = (booking: RevenueBooking, filters: RevenueFilters): boolean => {
  if (filters.locationId && booking.locationId !== filters.locationId) {
    return false
  }

  if (filters.dateFrom) {
    const from = new Date(`${filters.dateFrom}T00:00:00`)
    if (booking.sessionDate < from) return false
  }

  if (filters.dateTo) {
    const to = new Date(`${filters.dateTo}T23:59:59`)
    if (booking.sessionDate > to) return false
  }

  if (filters.type && filters.type !== 'all') {
    if (filters.type === 'helicopter' && !booking.isHelicopter) return false
    if (filters.type === 'other' && booking.isHelicopter) return false
  }

  if (filters.source && filters.source !== 'all') {
    const role = (booking.createdByRole ?? '').toLowerCase()
    if (filters.source === 'telecaller' && role !== 'telecaller') return false
    if (filters.source === 'online' && role !== '') return false
    if (filters.source === 'desk' && role !== 'cashier' && role !== 'admin') return false
  }

  if (filters.status && booking.bookingStatus !== filters.status) {
    return false
  }

  if (filters.search) {
    const term = filters.search.toLowerCase()
    const haystack = [booking.id, booking.userDisplayName, booking.userPhone, booking.locationId]
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(term)) return false
  }

  return true
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const asquareRevenueApi = {
  /**
   * Read all bookings, apply optional filters, and return aggregated revenue
   * data including per-booking details and totals.
   */
  async getRevenueData(filters?: RevenueFilters): Promise<RevenueData> {
    const firestore = getAsquareFirestore()
    const bookingsQuery = query(collection(firestore, 'bookings'), orderBy('createdAt', 'desc'))
    const snapshot = await getDocs(bookingsQuery)

    let bookings = snapshot.docs
      // Skip ANY terminated booking (cancelled, soft-deleted, voided,
      // bookingStatus='cancelled') before parsing so they never roll
      // into the revenue/quantity totals. Pre-fix this only checked
      // `deletedAt` — the four-signal cascade gap from the platform audit.
      .filter((record) => !isTerminatedBooking(record.data() as Record<string, unknown>))
      .map((record) => parseRevenueBooking(record.data() as Record<string, unknown>))

    if (filters) {
      bookings = bookings.filter((b) => matchesFilters(b, filters))
    }

    let totalRevenue = 0
    let pendingRevenue = 0
    let totalQuantity = 0

    for (const booking of bookings) {
      const quantity = booking.items.reduce(
        (sum, item) => sum + Number((item as Record<string, unknown>).quantity ?? 1),
        0,
      )
      totalQuantity += quantity

      if (booking.paymentStatus === 'completed') {
        totalRevenue += booking.finalAmount
      } else if (booking.paymentStatus === 'pending') {
        pendingRevenue += booking.finalAmount
      }
    }

    return {
      bookings,
      totalRevenue,
      pendingRevenue,
      totalQuantity,
    }
  },
}
