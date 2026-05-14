import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import type { UpdateData } from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { nowIso } from './firestore-utils'
import { logger } from '../../lib/logger'
import { asquareBookingsApi, type AsquareBooking } from './asquare-bookings'
import {
  createFirestoreHelicopterActivity,
  createFirestoreHelicopterPayment,
  listFirestoreHelicopterActivities,
  listFirestoreHelicopterPayments,
  updateFirestoreHelicopterActivity,
} from './billing-firestore'
import type {
  HelicopterActivityRecord,
  HelicopterBookingView,
  HelicopterConfigRecord,
  HelicopterCounterRecord,
  HelicopterPassengerSnapshot,
  HelicopterPaymentRecord,
  HelicopterSlotRecord,
  HelicopterSlotStatus,
} from './types'

const SLOTS_COLLECTION = 'helicopterSlots'
const CONFIG_COLLECTION = 'helicopterConfig'
const CONFIG_DOC_ID = 'global'
const COUNTER_COLLECTION = 'counters'
const COUNTER_DOC_ID = 'helicopter_bookings'
const BOOKINGS_COLLECTION = 'bookings'

const DEFAULT_MAX_SEATS = 6
const DEFAULT_EARLY_BIRD_THRESHOLD = 300
const DEFAULT_EARLY_BIRD_PRICE = 3999
const DEFAULT_REGULAR_PRICE = 4999
const DEFAULT_MAX_TOTAL_WEIGHT_KG = 540

const generateId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// ─── Slots ──────────────────────────────────────────────────────────────────

const getSlotsCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, SLOTS_COLLECTION)
}

const mapSlot = (id: string, data: Record<string, unknown>): HelicopterSlotRecord => ({
  id,
  date: String(data.date ?? ''),
  startTime: String(data.startTime ?? ''),
  branchId: String(data.branchId ?? ''),
  branchName: data.branchName ? String(data.branchName) : undefined,
  maxSeats: Number(data.maxSeats ?? DEFAULT_MAX_SEATS),
  bookedSeats: Number(data.bookedSeats ?? 0),
  status:
    data.status === 'Closed' || data.status === 'Cancelled'
      ? (data.status as HelicopterSlotStatus)
      : 'Open',
  pricePerSeat: Number(data.pricePerSeat ?? 0),
  earlyBirdPrice:
    data.earlyBirdPrice !== undefined && data.earlyBirdPrice !== null
      ? Number(data.earlyBirdPrice)
      : undefined,
  notes: data.notes ? String(data.notes) : undefined,
  createdAt: String(data.createdAt ?? ''),
  updatedAt: String(data.updatedAt ?? ''),
})

export interface SlotFilter {
  branchId?: string
  fromDate?: string // YYYY-MM-DD inclusive
  toDate?: string // YYYY-MM-DD inclusive
}

export const listHelicopterSlots = async (
  filter: SlotFilter = {},
): Promise<HelicopterSlotRecord[]> => {
  const col = getSlotsCollection()
  if (!col) return []

  const constraints = [] as Parameters<typeof query>[1][]
  if (filter.branchId) constraints.push(where('branchId', '==', filter.branchId))
  if (filter.fromDate) constraints.push(where('date', '>=', filter.fromDate))
  if (filter.toDate) constraints.push(where('date', '<=', filter.toDate))
  constraints.push(orderBy('date', 'asc'))
  constraints.push(orderBy('startTime', 'asc'))

  const snapshot = await getDocs(query(col, ...constraints))
  return snapshot.docs.map((d) => mapSlot(d.id, d.data() as Record<string, unknown>))
}

export interface CreateSlotInput {
  date: string
  startTime: string
  branchId: string
  branchName?: string
  maxSeats?: number
  pricePerSeat: number
  earlyBirdPrice?: number
  notes?: string
}

export const createHelicopterSlot = async (
  input: CreateSlotInput,
): Promise<HelicopterSlotRecord> => {
  const col = getSlotsCollection()
  if (!col) throw new Error('Firestore is not configured.')

  const id = generateId('heli-slot')
  const now = nowIso()
  const record: HelicopterSlotRecord = {
    id,
    date: input.date,
    startTime: input.startTime,
    branchId: input.branchId,
    branchName: input.branchName,
    maxSeats: Math.max(1, input.maxSeats ?? DEFAULT_MAX_SEATS),
    bookedSeats: 0,
    status: 'Open',
    pricePerSeat: Math.max(0, input.pricePerSeat),
    earlyBirdPrice: input.earlyBirdPrice,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  }
  await setDoc(doc(col, id), record)
  logger.info('helicopter.slot.created', { id, date: record.date, branchId: record.branchId })
  return record
}

export const updateHelicopterSlot = async (
  slotId: string,
  patch: Partial<
    Pick<
      HelicopterSlotRecord,
      | 'date'
      | 'startTime'
      | 'branchId'
      | 'branchName'
      | 'maxSeats'
      | 'pricePerSeat'
      | 'earlyBirdPrice'
      | 'status'
      | 'notes'
    >
  >,
): Promise<HelicopterSlotRecord> => {
  const col = getSlotsCollection()
  if (!col) throw new Error('Firestore is not configured.')
  const ref = doc(col, slotId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Slot not found.')

  const updates: Record<string, unknown> = { updatedAt: nowIso() }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) updates[key] = value
  }
  await updateDoc(ref, updates as UpdateData<Record<string, unknown>>)

  const merged = { ...(snap.data() as Record<string, unknown>), ...updates }
  logger.info('helicopter.slot.updated', { id: slotId })
  return mapSlot(slotId, merged)
}

export const deleteHelicopterSlot = async (slotId: string): Promise<void> => {
  const col = getSlotsCollection()
  if (!col) throw new Error('Firestore is not configured.')
  await deleteDoc(doc(col, slotId))
  logger.info('helicopter.slot.deleted', { id: slotId })
}

export interface BulkCreateSlotsInput {
  dates: string[] // YYYY-MM-DD list
  times: string[] // HH:mm list
  branchId: string
  branchName?: string
  maxSeats: number
  pricePerSeat: number
  earlyBirdPrice?: number
}

export const bulkCreateHelicopterSlots = async (
  input: BulkCreateSlotsInput,
): Promise<HelicopterSlotRecord[]> => {
  const created: HelicopterSlotRecord[] = []
  for (const date of input.dates) {
    for (const startTime of input.times) {
      const slot = await createHelicopterSlot({
        date,
        startTime,
        branchId: input.branchId,
        branchName: input.branchName,
        maxSeats: input.maxSeats,
        pricePerSeat: input.pricePerSeat,
        earlyBirdPrice: input.earlyBirdPrice,
      })
      created.push(slot)
    }
  }
  return created
}

/**
 * Atomically reserve `seats` on a slot. Returns updated slot. Throws if
 * insufficient capacity or slot is not Open.
 */
export const reserveHelicopterSlotSeats = async (
  slotId: string,
  seats: number,
): Promise<HelicopterSlotRecord> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore is not configured.')
  const ref = doc(firestore, SLOTS_COLLECTION, slotId)

  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Slot not found.')
    const data = snap.data() as Record<string, unknown>
    const slot = mapSlot(slotId, data)
    if (slot.status !== 'Open') throw new Error(`Slot is ${slot.status}.`)
    const next = slot.bookedSeats + seats
    if (next > slot.maxSeats) throw new Error('Not enough seats available on this slot.')
    const updatedAt = nowIso()
    tx.update(ref, { bookedSeats: next, updatedAt })
    return { ...slot, bookedSeats: next, updatedAt }
  })
}

// ─── Config (global / per-branch) ───────────────────────────────────────────

const defaultConfig = (): HelicopterConfigRecord => ({
  enabled: true,
  branchEnabled: {},
  earlyBirdEnabled: true,
  maxTotalWeightKg: DEFAULT_MAX_TOTAL_WEIGHT_KG,
  updatedAt: nowIso(),
  updatedBy: 'system',
})

export const getHelicopterConfig = async (): Promise<HelicopterConfigRecord> => {
  const firestore = initializeFirestore()
  if (!firestore) return defaultConfig()
  const ref = doc(firestore, CONFIG_COLLECTION, CONFIG_DOC_ID)
  const snap = await getDoc(ref)
  if (!snap.exists()) return defaultConfig()
  const data = snap.data() as Record<string, unknown>
  return {
    enabled: data.enabled !== false,
    branchEnabled: (data.branchEnabled as Record<string, boolean>) ?? {},
    earlyBirdEnabled: data.earlyBirdEnabled !== false,
    maxTotalWeightKg: Number(data.maxTotalWeightKg ?? DEFAULT_MAX_TOTAL_WEIGHT_KG),
    updatedAt: String(data.updatedAt ?? ''),
    updatedBy: String(data.updatedBy ?? ''),
  }
}

export const updateHelicopterConfig = async (
  patch: Partial<
    Pick<
      HelicopterConfigRecord,
      'enabled' | 'branchEnabled' | 'earlyBirdEnabled' | 'maxTotalWeightKg'
    >
  >,
  actorUid: string,
): Promise<HelicopterConfigRecord> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore is not configured.')
  const ref = doc(firestore, CONFIG_COLLECTION, CONFIG_DOC_ID)
  const existing = await getHelicopterConfig()
  const next: HelicopterConfigRecord = {
    ...existing,
    ...patch,
    updatedAt: nowIso(),
    updatedBy: actorUid,
  }
  await setDoc(ref, next, { merge: true })
  logger.info('helicopter.config.updated', {
    actorUid,
    keys: Object.keys(patch),
  })
  return next
}

export const setHelicopterBranchEnabled = async (
  branchId: string,
  enabled: boolean,
  actorUid: string,
): Promise<HelicopterConfigRecord> => {
  const existing = await getHelicopterConfig()
  const branchEnabled = { ...existing.branchEnabled, [branchId]: enabled }
  return updateHelicopterConfig({ branchEnabled }, actorUid)
}

// ─── Counter / Early-bird pricing ───────────────────────────────────────────

export const getHelicopterCounter = async (): Promise<HelicopterCounterRecord> => {
  const firestore = initializeFirestore()
  if (!firestore) {
    return {
      count: 0,
      earlyBirdThreshold: DEFAULT_EARLY_BIRD_THRESHOLD,
      earlyBirdPrice: DEFAULT_EARLY_BIRD_PRICE,
      regularPrice: DEFAULT_REGULAR_PRICE,
      updatedAt: '',
    }
  }
  const ref = doc(firestore, COUNTER_COLLECTION, COUNTER_DOC_ID)
  const snap = await getDoc(ref)
  const data = (snap.exists() ? snap.data() : {}) as Record<string, unknown>
  return {
    count: Number(data.count ?? 0),
    earlyBirdThreshold: Number(data.earlyBirdThreshold ?? DEFAULT_EARLY_BIRD_THRESHOLD),
    earlyBirdPrice: Number(data.earlyBirdPrice ?? DEFAULT_EARLY_BIRD_PRICE),
    regularPrice: Number(data.regularPrice ?? DEFAULT_REGULAR_PRICE),
    updatedAt: String(data.updatedAt ?? ''),
  }
}

export const updateHelicopterCounter = async (
  patch: Partial<
    Pick<
      HelicopterCounterRecord,
      'earlyBirdThreshold' | 'earlyBirdPrice' | 'regularPrice' | 'count'
    >
  >,
): Promise<HelicopterCounterRecord> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore is not configured.')
  const ref = doc(firestore, COUNTER_COLLECTION, COUNTER_DOC_ID)
  const existing = await getHelicopterCounter()
  const next: HelicopterCounterRecord = {
    ...existing,
    ...patch,
    updatedAt: nowIso(),
  }
  await setDoc(ref, next, { merge: true })
  logger.info('helicopter.counter.updated', { keys: Object.keys(patch) })
  return next
}

// ─── Booking projection ─────────────────────────────────────────────────────

const isHelicopterBooking = (booking: AsquareBooking): boolean =>
  (booking.items || []).some((item) => {
    const name = String(item.activity?.name ?? '').toLowerCase()
    const category = String(item.activity?.category ?? '').toLowerCase()
    return name.includes('helicopter') || category.includes('helicopter')
  })

const extractPassengers = (booking: AsquareBooking): HelicopterPassengerSnapshot[] => {
  const passengers = booking.passengers ?? []
  return passengers.map((p) => {
    const checkedInAt = (p as unknown as { checkedInAt?: string }).checkedInAt
    return {
      name: String(p.name ?? ''),
      weight: typeof p.weight === 'number' ? p.weight : undefined,
      age: typeof p.age === 'number' ? p.age : undefined,
      gender: p.gender ? String(p.gender) : undefined,
      checkedInAt: checkedInAt ? String(checkedInAt) : undefined,
    }
  })
}

const toDateString = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString().split('T')[0]
  if (value && typeof value === 'object' && 'toDate' in (value as object)) {
    const d = (value as { toDate?: () => Date }).toDate?.()
    if (d) return d.toISOString().split('T')[0]
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0]
    return value.split('T')[0] ?? value
  }
  return ''
}

const toBookingView = (booking: AsquareBooking): HelicopterBookingView => {
  const passengers = extractPassengers(booking)
  const totalWeightKg = passengers.reduce((sum, p) => sum + (p.weight ?? 0), 0)
  let seats = 0
  for (const item of booking.items || []) {
    const name = String(item.activity?.name ?? '').toLowerCase()
    const category = String(item.activity?.category ?? '').toLowerCase()
    if (name.includes('helicopter') || category.includes('helicopter')) {
      seats += Number(item.quantity ?? 0)
    }
  }
  const firstItem = booking.items?.[0]
  return {
    id: booking.id,
    bookingId: booking.id,
    orderNumber: (booking as unknown as { orderNumber?: string }).orderNumber,
    customerName: String(booking.userDisplayName ?? ''),
    customerPhone: String(booking.userPhone ?? ''),
    branchId: booking.locationId,
    branchName: undefined,
    sessionDate: toDateString(booking.sessionDate),
    slotId: (booking as unknown as { slotId?: string }).slotId,
    startTime: firstItem?.timeSlot,
    seats,
    totalAmount: Number(booking.finalAmount ?? booking.totalAmount ?? 0),
    bookingStatus: String(booking.bookingStatus ?? ''),
    paymentStatus: String(booking.paymentStatus ?? ''),
    passengers,
    totalWeightKg,
    createdAt: booking.createdAt?.toISOString?.() ?? '',
  }
}

export interface HelicopterBookingFilter {
  branchId?: string
  date?: string // YYYY-MM-DD
  status?: string // bookingStatus
}

export const listHelicopterBookings = async (
  filter: HelicopterBookingFilter = {},
): Promise<HelicopterBookingView[]> => {
  const bookings = await asquareBookingsApi.listAdminBookings(filter.branchId)
  return bookings
    .filter(isHelicopterBooking)
    .filter((b) => {
      if (filter.date && toDateString(b.sessionDate) !== filter.date) return false
      if (filter.status && String(b.bookingStatus) !== filter.status) return false
      return true
    })
    .map(toBookingView)
}

export const checkInHelicopterPassenger = async (
  bookingId: string,
  passengerIndex: number,
): Promise<void> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore is not configured.')
  const ref = doc(firestore, BOOKINGS_COLLECTION, bookingId)

  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Booking not found.')
    const data = snap.data() as Record<string, unknown>
    const passengers = Array.isArray(data.passengers) ? [...(data.passengers as object[])] : []
    if (passengerIndex < 0 || passengerIndex >= passengers.length) {
      throw new Error('Invalid passenger index.')
    }
    const current = { ...(passengers[passengerIndex] as Record<string, unknown>) }
    current.checkedInAt = nowIso()
    passengers[passengerIndex] = current
    tx.update(ref, { passengers, updatedAt: nowIso() })
  })

  logger.info('helicopter.passenger.checked_in', { bookingId, passengerIndex })
}

export const cancelHelicopterBooking = async (bookingId: string, reason: string): Promise<void> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore is not configured.')
  const bookingRef = doc(firestore, BOOKINGS_COLLECTION, bookingId)

  // Bug-finder swarm 2026-05-13 found that the previous version only flipped
  // bookingStatus and never released seats on the linked slot. Cancelled
  // seats stayed "booked" against capacity, blocking real customers.
  // Read+write both docs in a single transaction to keep capacity honest.
  const releasedSeats = await runTransaction(firestore, async (tx) => {
    const bookingSnap = await tx.get(bookingRef)
    if (!bookingSnap.exists()) throw new Error('Booking not found.')
    const data = bookingSnap.data() as Record<string, unknown>
    const status = String(data.bookingStatus ?? '')
    if (status === 'cancelled') return 0
    if (status === 'completed') throw new Error('Cannot cancel a completed booking.')

    // Derive seat count from items the same way toBookingView does, so the
    // decrement matches the increment from reserveHelicopterSlotSeats.
    let seats = 0
    const items = Array.isArray(data.items) ? data.items : []
    for (const raw of items) {
      const item = (raw ?? {}) as Record<string, unknown>
      const activity = (item.activity ?? {}) as Record<string, unknown>
      const name = String(activity.name ?? '').toLowerCase()
      const category = String(activity.category ?? '').toLowerCase()
      if (name.includes('helicopter') || category.includes('helicopter')) {
        seats += Number(item.quantity ?? 0)
      }
    }

    const slotId = typeof data.slotId === 'string' ? data.slotId.trim() : ''
    if (slotId && seats > 0) {
      const slotRef = doc(firestore, SLOTS_COLLECTION, slotId)
      const slotSnap = await tx.get(slotRef)
      if (slotSnap.exists()) {
        const slotData = slotSnap.data() as Record<string, unknown>
        const currentBooked = Number(slotData.bookedSeats ?? 0)
        const nextBooked = Math.max(0, currentBooked - seats)
        tx.update(slotRef, { bookedSeats: nextBooked, updatedAt: nowIso() })
      }
    }

    tx.update(bookingRef, {
      bookingStatus: 'cancelled',
      cancellationReason: reason,
      cancelledAt: nowIso(),
      updatedAt: nowIso(),
    })
    return seats
  })
  logger.info('helicopter.booking.cancelled', { bookingId, releasedSeats })
}

// ─── Aggregates / helpers ───────────────────────────────────────────────────

export interface HelicopterDashboardSummary {
  todayDate: string
  todaySlots: number
  todayCapacity: number
  todayBooked: number
  todayRevenue: number
  upcomingSlots: HelicopterSlotRecord[]
  counter: HelicopterCounterRecord
  config: HelicopterConfigRecord
}

const todayIst = (): string => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date())
}

export const getHelicopterDashboardSummary = async (
  branchId?: string,
): Promise<HelicopterDashboardSummary> => {
  const today = todayIst()
  const [slots, counter, config, todaysBookings] = await Promise.all([
    listHelicopterSlots({ branchId, fromDate: today }),
    getHelicopterCounter(),
    getHelicopterConfig(),
    listHelicopterBookings({ branchId, date: today }),
  ])

  const todaysSlots = slots.filter((s) => s.date === today)
  const todayCapacity = todaysSlots.reduce((sum, s) => sum + s.maxSeats, 0)
  const todayBooked = todaysSlots.reduce((sum, s) => sum + s.bookedSeats, 0)
  const todayRevenue = todaysBookings
    .filter((b) => b.paymentStatus === 'completed' || b.bookingStatus === 'confirmed')
    .reduce((sum, b) => sum + b.totalAmount, 0)

  return {
    todayDate: today,
    todaySlots: todaysSlots.length,
    todayCapacity,
    todayBooked,
    todayRevenue,
    upcomingSlots: slots.slice(0, 10),
    counter,
    config,
  }
}

// Re-export existing billing-firestore helicopter helpers so module views
// have a single import surface. These write to the same collections.
export {
  createFirestoreHelicopterActivity as createHelicopterActivity,
  createFirestoreHelicopterPayment as createHelicopterPayment,
  listFirestoreHelicopterActivities as listHelicopterActivities,
  listFirestoreHelicopterPayments as listHelicopterPayments,
  updateFirestoreHelicopterActivity as updateHelicopterActivity,
}

export type {
  HelicopterActivityRecord,
  HelicopterBookingView,
  HelicopterConfigRecord,
  HelicopterCounterRecord,
  HelicopterPassengerSnapshot,
  HelicopterPaymentRecord,
  HelicopterSlotRecord,
  HelicopterSlotStatus,
}
