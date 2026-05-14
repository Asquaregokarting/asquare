import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { AsquareBooking, asquareBookingsApi } from './asquare-bookings'
import { toOptionalString } from './firestore-utils'
import {
  TelecallerIncentiveConfig,
  TelecallerMonthlyPerformanceRecord,
  TelecallerMonthlyPlanRecord,
  UserRecord,
} from './types'
import { listFirestoreUsers } from './users-firestore'

const TELECALLER_MONTHLY_PLANS_COLLECTION = 'telecallerMonthlyPlans'
const TELECALLER_INCENTIVE_CONFIG_COLLECTION = 'telecallerIncentiveConfig'
const TELECALLER_INCENTIVE_CONFIG_DOC_ID = 'singleton'

export const DEFAULT_TELECALLER_INCENTIVE_PERCENT = 2

const padMonth = (value: number): string => String(value).padStart(2, '0')

export const getCurrentMonthKey = (): string => {
  const now = new Date()
  return `${now.getFullYear()}-${padMonth(now.getMonth() + 1)}`
}

export const normalizeMonthKey = (value?: string): string => {
  const raw = String(value ?? '').trim()
  if (/^\d{4}-\d{2}$/.test(raw)) {
    return raw
  }
  return getCurrentMonthKey()
}

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

const sanitizeIncentivePercent = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null
  }
  const parsed = toFiniteNumber(value, Number.NaN)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }
  return parsed
}

const mapPlanRecord = (id: string, data: Record<string, unknown>): TelecallerMonthlyPlanRecord => ({
  id,
  telecallerId: String(data.telecallerId ?? ''),
  monthKey: normalizeMonthKey(String(data.monthKey ?? '')),
  targetAmount: Math.max(0, toFiniteNumber(data.targetAmount)),
  incentivePercent: sanitizeIncentivePercent(data.incentivePercent),
  updatedAt: String(data.updatedAt ?? new Date().toISOString()),
  updatedBy: toOptionalString(data.updatedBy),
})

const getMonthlyPlansCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return collection(firestore, TELECALLER_MONTHLY_PLANS_COLLECTION)
}

const getIncentiveConfigDocRef = () => {
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return doc(firestore, TELECALLER_INCENTIVE_CONFIG_COLLECTION, TELECALLER_INCENTIVE_CONFIG_DOC_ID)
}

const buildPlanDocId = (telecallerId: string, monthKey: string): string =>
  `${telecallerId}__${monthKey}`

const toMonthKeyFromDate = (date: Date): string =>
  `${date.getFullYear()}-${padMonth(date.getMonth() + 1)}`

const toBookingPaymentDate = (booking: AsquareBooking): Date => {
  if (
    booking.paymentCompletedAt instanceof Date &&
    !Number.isNaN(booking.paymentCompletedAt.getTime())
  ) {
    return booking.paymentCompletedAt
  }
  if (booking.createdAt instanceof Date && !Number.isNaN(booking.createdAt.getTime())) {
    return booking.createdAt
  }
  const parsed = new Date(String(booking.paymentCompletedAt ?? booking.createdAt ?? ''))
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed
}

const toTelecallerMap = (telecallers: UserRecord[]): Map<string, UserRecord> =>
  new Map(telecallers.map((telecaller) => [telecaller.id, telecaller]))

const calculatePerformance = (
  telecaller: UserRecord,
  monthKey: string,
  bookings: AsquareBooking[],
  plan: TelecallerMonthlyPlanRecord | null,
  defaultIncentivePercent: number,
): TelecallerMonthlyPerformanceRecord => {
  const bookingCount = bookings.length
  const bookedAmount = bookings.reduce(
    (sum, booking) => sum + Math.max(0, Number(booking.finalAmount ?? 0)),
    0,
  )
  const targetAmount = Math.max(0, Number(plan?.targetAmount ?? 0))
  const hasPlan = Boolean(plan)

  const effectivePercent = plan?.incentivePercent ?? defaultIncentivePercent
  const estimatedIncentiveTotal = bookings.reduce((sum, booking) => {
    const amount = Math.max(0, Number(booking.finalAmount ?? 0))
    return sum + Math.round((amount * effectivePercent) / 100)
  }, 0)

  return {
    telecallerId: telecaller.id,
    telecallerName: telecaller.name,
    monthKey,
    hasPlan,
    bookingCount,
    bookedAmount,
    targetAmount,
    achievementPercent: hasPlan && targetAmount > 0 ? (bookedAmount / targetAmount) * 100 : 0,
    incentivePercentUsed: effectivePercent,
    estimatedIncentiveTotal,
  }
}

export const isFirestoreTelecallerPerformanceActive = (): boolean =>
  Boolean(getMonthlyPlansCollection())

export const getFirestoreTelecallerIncentiveConfig =
  async (): Promise<TelecallerIncentiveConfig> => {
    const ref = getIncentiveConfigDocRef()
    if (!ref) {
      return {
        defaultIncentivePercent: DEFAULT_TELECALLER_INCENTIVE_PERCENT,
        updatedAt: new Date(0).toISOString(),
      }
    }

    const snapshot = await getDoc(ref)
    if (!snapshot.exists()) {
      return {
        defaultIncentivePercent: DEFAULT_TELECALLER_INCENTIVE_PERCENT,
        updatedAt: new Date(0).toISOString(),
      }
    }

    const data = snapshot.data() as Record<string, unknown>
    const parsedPercent = sanitizeIncentivePercent(data.defaultIncentivePercent)
    return {
      defaultIncentivePercent: parsedPercent ?? DEFAULT_TELECALLER_INCENTIVE_PERCENT,
      updatedAt: String(data.updatedAt ?? new Date().toISOString()),
      updatedBy: toOptionalString(data.updatedBy),
    }
  }

export const updateFirestoreTelecallerIncentiveConfig = async (payload: {
  defaultIncentivePercent: number
  updatedBy?: string
}): Promise<TelecallerIncentiveConfig> => {
  const ref = getIncentiveConfigDocRef()
  if (!ref) {
    throw new Error('Firestore telecaller performance is not configured.')
  }

  const percent = Number(payload.defaultIncentivePercent)
  if (!Number.isFinite(percent) || percent < 0) {
    throw new Error('Default incentive percent must be a non-negative number.')
  }

  const updatedAt = new Date().toISOString()
  const body = {
    defaultIncentivePercent: percent,
    updatedAt,
    updatedBy: toOptionalString(payload.updatedBy),
  }
  await setDoc(ref, body, { merge: true })
  return body
}

export const listFirestoreTelecallerMonthlyPlans = async (
  monthKey?: string,
): Promise<TelecallerMonthlyPlanRecord[]> => {
  const monthlyPlansCollection = getMonthlyPlansCollection()
  if (!monthlyPlansCollection) {
    return []
  }

  const normalizedMonthKey = normalizeMonthKey(monthKey)
  const snapshot = await getDocs(
    query(monthlyPlansCollection, where('monthKey', '==', normalizedMonthKey)),
  )
  return snapshot.docs
    .map((item) => mapPlanRecord(item.id, item.data() as Record<string, unknown>))
    .sort((left, right) => left.telecallerId.localeCompare(right.telecallerId))
}

export const getFirestoreTelecallerMonthlyPlan = async (
  telecallerId: string,
  monthKey?: string,
): Promise<TelecallerMonthlyPlanRecord | null> => {
  const monthlyPlansCollection = getMonthlyPlansCollection()
  if (!monthlyPlansCollection) {
    return null
  }

  const normalizedMonthKey = normalizeMonthKey(monthKey)
  const snapshot = await getDoc(
    doc(monthlyPlansCollection, buildPlanDocId(telecallerId, normalizedMonthKey)),
  )
  if (!snapshot.exists()) {
    return null
  }

  return mapPlanRecord(snapshot.id, snapshot.data() as Record<string, unknown>)
}

export const upsertFirestoreTelecallerMonthlyPlan = async (payload: {
  telecallerId: string
  monthKey: string
  targetAmount: number
  incentivePercent: number | null
  updatedBy?: string
}): Promise<TelecallerMonthlyPlanRecord> => {
  const monthlyPlansCollection = getMonthlyPlansCollection()
  if (!monthlyPlansCollection) {
    throw new Error('Firestore telecaller performance is not configured.')
  }

  const telecallerId = String(payload.telecallerId ?? '').trim()
  if (!telecallerId) {
    throw new Error('Telecaller ID is required.')
  }

  const monthKey = normalizeMonthKey(payload.monthKey)
  const targetAmount = Math.max(0, Number(payload.targetAmount ?? 0))
  if (targetAmount <= 0) {
    throw new Error('Target amount must be greater than zero.')
  }

  const incentivePercent =
    payload.incentivePercent == null ? null : sanitizeIncentivePercent(payload.incentivePercent)
  if (payload.incentivePercent != null && incentivePercent == null) {
    throw new Error('Incentive percent must be a non-negative number.')
  }

  const updatedAt = new Date().toISOString()
  const documentId = buildPlanDocId(telecallerId, monthKey)
  // Strip any legacy slab data on save — flat-percent model replaces it.
  const writeBody: Record<string, unknown> = {
    telecallerId,
    monthKey,
    targetAmount,
    incentivePercent,
    updatedAt,
    updatedBy: toOptionalString(payload.updatedBy),
    slabs: deleteField(),
  }

  await setDoc(doc(monthlyPlansCollection, documentId), writeBody, { merge: true })
  return {
    id: documentId,
    telecallerId,
    monthKey,
    targetAmount,
    incentivePercent,
    updatedAt,
    updatedBy: toOptionalString(payload.updatedBy),
  }
}

export const listFirestoreTelecallerMonthlyPerformance = async (options?: {
  monthKey?: string
  telecallerIds?: string[]
}): Promise<TelecallerMonthlyPerformanceRecord[]> => {
  const normalizedMonthKey = normalizeMonthKey(options?.monthKey)
  const telecallers = (await listFirestoreUsers({ role: 'Telecaller' })).sort((left, right) => {
    const nameDiff = left.name.localeCompare(right.name)
    if (nameDiff !== 0) {
      return nameDiff
    }
    return left.id.localeCompare(right.id)
  })

  const filteredTelecallers =
    options?.telecallerIds && options.telecallerIds.length > 0
      ? telecallers.filter((telecaller) => options.telecallerIds?.includes(telecaller.id))
      : telecallers

  const telecallerMap = toTelecallerMap(filteredTelecallers)
  const [plans, bookings, config] = await Promise.all([
    listFirestoreTelecallerMonthlyPlans(normalizedMonthKey),
    asquareBookingsApi.listAdminBookings(),
    getFirestoreTelecallerIncentiveConfig(),
  ])

  const plansByTelecaller = new Map(plans.map((plan) => [plan.telecallerId, plan] as const))
  const bookingsByTelecaller = new Map<string, AsquareBooking[]>()

  bookings.forEach((booking) => {
    if (String(booking.paymentStatus ?? '').toLowerCase() !== 'completed') {
      return
    }

    const createdByAdminId = String(booking.createdByAdminId ?? '').trim()
    if (!createdByAdminId || !telecallerMap.has(createdByAdminId)) {
      return
    }

    const paymentDate = toBookingPaymentDate(booking)
    if (
      Number.isNaN(paymentDate.getTime()) ||
      toMonthKeyFromDate(paymentDate) !== normalizedMonthKey
    ) {
      return
    }

    const existing = bookingsByTelecaller.get(createdByAdminId) ?? []
    existing.push(booking)
    bookingsByTelecaller.set(createdByAdminId, existing)
  })

  return filteredTelecallers
    .map((telecaller) =>
      calculatePerformance(
        telecaller,
        normalizedMonthKey,
        bookingsByTelecaller.get(telecaller.id) ?? [],
        plansByTelecaller.get(telecaller.id) ?? null,
        config.defaultIncentivePercent,
      ),
    )
    .sort((left, right) => {
      const amountDiff = right.bookedAmount - left.bookedAmount
      if (amountDiff !== 0) {
        return amountDiff
      }
      const incentiveDiff = right.estimatedIncentiveTotal - left.estimatedIncentiveTotal
      if (incentiveDiff !== 0) {
        return incentiveDiff
      }
      return left.telecallerName.localeCompare(right.telecallerName)
    })
}
