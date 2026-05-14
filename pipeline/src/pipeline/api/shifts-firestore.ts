import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { ensureFirebaseAuthForStorage } from '../lib/firebase-auth'
import {
  assertLocationAccess,
  getFirestoreSessionUser,
  isPrivilegedRole,
} from './firestore-session'
import type { ShiftRecord } from './shifts'
import type { Role } from './types'
import { nowIso } from './firestore-utils'
import { normalizeLocationId, getLocationDisplayName } from '../../lib/locations'
import { logger } from '../../lib/logger'
import { todayIST } from '../lib/ist-date'
import { getKartReportForDate } from '../features/track/services/kartReportService'
import {
  buildTrackTaskBlockMessage,
  getTrackEndOfDayStatus,
} from '../features/track/services/trackEndOfDayStatus'

const SHIFTS_COLLECTION = 'shifts'
const USE_FIRESTORE_SHIFTS = import.meta.env.VITE_USE_FIRESTORE_SHIFTS !== 'false'
const VALID_SHIFT_ROLES: ShiftRecord['role'][] = [
  'Telecaller',
  'Cashier',
  'TrackMarshall',
  'Incharge',
]

const toLocalDate = (value: Date): string => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toOptionalTimestamp = (value: unknown): string | undefined => {
  const text = String(value ?? '').trim()
  if (!text) {
    return undefined
  }
  const normalized = text.toLowerCase()
  if (
    normalized === 'null' ||
    normalized === 'undefined' ||
    normalized === 'none' ||
    normalized === '-'
  ) {
    return undefined
  }
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }
  return parsed.toISOString()
}

const toTimestamp = (value: unknown, fallback: string): string => {
  const text = String(value ?? '').trim()
  if (!text) {
    return fallback
  }
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) {
    return fallback
  }
  return parsed.toISOString()
}

const isShiftRole = (value: unknown): value is ShiftRecord['role'] =>
  typeof value === 'string' && VALID_SHIFT_ROLES.includes(value as ShiftRecord['role'])

const parseBreaks = (value: unknown): ShiftRecord['breaks'] => {
  if (!Array.isArray(value)) {
    return []
  }

  const rows: ShiftRecord['breaks'] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const row = item as Record<string, unknown>
    const breakStart = toOptionalTimestamp(row.breakStart)
    if (!breakStart) {
      continue
    }
    rows.push({
      breakStart,
      breakEnd: toOptionalTimestamp(row.breakEnd),
    })
  }
  return rows
}

const toNonNegativeHours = (value: number): number => Number(Math.max(0, value).toFixed(2))

const computeTotalActiveHours = (
  startTime: string,
  endTime: string,
  breaks: ShiftRecord['breaks'],
): number => {
  const start = new Date(startTime).getTime()
  const end = new Date(endTime).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return 0
  }

  const breakDurationMs = breaks.reduce((sum, item) => {
    if (!item.breakEnd) {
      return sum
    }
    const breakStart = new Date(item.breakStart).getTime()
    const breakEnd = new Date(item.breakEnd).getTime()
    if (Number.isNaN(breakStart) || Number.isNaN(breakEnd) || breakEnd <= breakStart) {
      return sum
    }
    return sum + (breakEnd - breakStart)
  }, 0)

  const activeMs = Math.max(0, end - start - breakDurationMs)
  return toNonNegativeHours(activeMs / (1000 * 60 * 60))
}

/** Auto-close any active shifts whose shiftDate is before today (IST).
 *
 * Performance fix (post-2026-05-12 audit): pre-fix this called
 * `getDocs(shiftsCollection)` which reads the FULL collection (~1.2k+
 * docs and growing) on every list-shifts and start-shift call. At 10k
 * shifts that's a real Firestore bill multiplied per request.
 *
 * Now uses `where('shiftDate', '<', todayIST)` — Firestore's single-
 * field index covers this, no composite index required. The `endTime`
 * check still happens client-side because adding `where('endTime',
 * '==', null)` would require a composite index AND Firestore's
 * inequality + missing-field semantics are tricky. Filtering ~50 docs
 * (one shift per branch per day × ~10 days × N missed) client-side is
 * trivial vs. reading the whole collection.
 */
const autoCloseExpiredShifts = async (): Promise<void> => {
  const shiftsCollection = getShiftsCollection()
  if (!shiftsCollection) return

  const nowUtc = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const nowIST = new Date(nowUtc.getTime() + istOffset)
  const todayIST = `${nowIST.getFullYear()}-${String(nowIST.getMonth() + 1).padStart(2, '0')}-${String(nowIST.getDate()).padStart(2, '0')}`

  const snapshot = await getDocs(
    query(shiftsCollection, where('shiftDate', '<', todayIST)),
  )
  const activeShifts = snapshot.docs
    .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
    .filter((row) => !row.data.endTime && typeof row.data.shiftDate === 'string')

  if (activeShifts.length === 0) return

  await ensureFirebaseAuthForStorage()

  for (const row of activeShifts) {
    const shift = mapShiftRecord(row.id, row.data)
    // End time = 01:30 AM IST on the day after the shift date
    const shiftDateObj = new Date(shift.shiftDate + 'T01:30:00+05:30')
    shiftDateObj.setDate(shiftDateObj.getDate() + 1)
    const endTime = shiftDateObj.toISOString()

    const normalizedBreaks = shift.breaks.map((b) => (b.breakEnd ? b : { ...b, breakEnd: endTime }))
    const totalActiveHours = computeTotalActiveHours(shift.startTime, endTime, normalizedBreaks)

    await updateDoc(doc(shiftsCollection, row.id), {
      endTime,
      breaks: normalizedBreaks,
      totalActiveHours,
      updatedAt: nowIso(),
      autoEnded: true,
    })
  }
}

const normalizeRoleFilter = (role?: Role): ShiftRecord['role'] | undefined =>
  isShiftRole(role) ? role : undefined

const mapShiftRecord = (id: string, data: Record<string, unknown>): ShiftRecord => {
  const startTime = toTimestamp(data.startTime, nowIso())
  const endTime = toOptionalTimestamp(data.endTime)
  const breaks = parseBreaks(data.breaks)

  const settlement =
    data.settlement && typeof data.settlement === 'object' && !Array.isArray(data.settlement)
      ? (() => {
          const s = data.settlement as Record<string, unknown>
          return {
            cashEntered: Number(s.cashEntered ?? 0),
            cardEntered: Number(s.cardEntered ?? 0),
            upiEntered: Number(s.upiEntered ?? 0),
            cashActual: Number(s.cashActual ?? 0),
            cardActual: Number(s.cardActual ?? 0),
            upiActual: Number(s.upiActual ?? 0),
            settledAt: String(s.settledAt ?? ''),
            totalTransactions: Number(s.totalTransactions ?? 0),
            locationId: s.locationId ? String(s.locationId) : undefined,
          }
        })()
      : undefined

  const rawLocationId = data.locationId ? String(data.locationId) : ''
  const locationId = rawLocationId ? normalizeLocationId(rawLocationId) : ''
  if (rawLocationId && rawLocationId !== locationId) {
    logger.debug('shifts_firestore.location_normalized', { rawLocationId, locationId, shiftId: id })
  }

  return {
    id,
    userId: String(data.userId ?? ''),
    role: isShiftRole(data.role) ? data.role : 'Telecaller',
    locationId,
    locationName: locationId ? getLocationDisplayName(locationId) : '',
    shiftDate: String(data.shiftDate ?? toLocalDate(new Date(startTime))),
    startTime,
    endTime,
    totalActiveHours:
      typeof data.totalActiveHours === 'number' && Number.isFinite(data.totalActiveHours)
        ? toNonNegativeHours(data.totalActiveHours)
        : endTime
          ? computeTotalActiveHours(startTime, endTime, breaks)
          : undefined,
    breaks,
    ...(settlement ? { settlement } : {}),
    ...(data.forceClosedBy ? { forceClosedBy: String(data.forceClosedBy) } : {}),
    ...(data.forceClosedByName ? { forceClosedByName: String(data.forceClosedByName) } : {}),
    ...(data.forceClosedAt ? { forceClosedAt: String(data.forceClosedAt) } : {}),
    ...(data.forceCloseReason ? { forceCloseReason: String(data.forceCloseReason) } : {}),
  }
}

const getShiftsCollection = () => {
  if (!USE_FIRESTORE_SHIFTS) {
    return null
  }
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return collection(firestore, SHIFTS_COLLECTION)
}

const sortShiftsDesc = (rows: ShiftRecord[]): ShiftRecord[] =>
  [...rows].sort((left, right) => {
    if (left.startTime === right.startTime) {
      return right.id.localeCompare(left.id)
    }
    return right.startTime.localeCompare(left.startTime)
  })

export const getLatestActiveShiftForUser = async (
  userId: string,
): Promise<{ id: string; shift: ShiftRecord } | null> => {
  const shiftsCollection = getShiftsCollection()
  if (!shiftsCollection) {
    throw new Error('Firestore shifts is not configured.')
  }

  // Perf fix (post-2026-05-12 audit): pre-fix this called `getDocs(
  // shiftsCollection)` which reads the FULL collection on every check.
  // Use a `where('userId', '==', userId)` query so Firestore returns
  // only this cashier's docs — ~5 to ~30 per user, not ~1.2k+ for the
  // whole collection. `endTime` check stays client-side (composite
  // index for "endTime missing" is fiddly).
  const snapshot = await getDocs(
    query(shiftsCollection, where('userId', '==', userId)),
  )
  const active = snapshot.docs
    .map((row) => ({
      id: row.id,
      shift: mapShiftRecord(row.id, row.data() as Record<string, unknown>),
    }))
    .filter((row) => !row.shift.endTime)
    .sort((left, right) => right.shift.startTime.localeCompare(left.shift.startTime))
  return active[0] ?? null
}

export const isFirestoreShiftsActive = (): boolean => Boolean(getShiftsCollection())

export const listFirestoreShifts = async (
  token: string,
  query?: {
    from?: string
    to?: string
    role?: Role
    userId?: string
    activeOnly?: boolean
    locationId?: string
  },
): Promise<ShiftRecord[]> => {
  const shiftsCollection = getShiftsCollection()
  if (!shiftsCollection) {
    throw new Error('Firestore shifts is not configured.')
  }

  // Auto-close any expired shifts before listing
  await autoCloseExpiredShifts()

  const sessionUser = await getFirestoreSessionUser(token)
  const privileged = isPrivilegedRole(sessionUser.role)
  const requestedUserId = query?.userId?.trim()
  if (!privileged && requestedUserId && requestedUserId !== sessionUser.id) {
    throw new Error("You are not allowed to view other users' shifts.")
  }

  const normalizedRole = normalizeRoleFilter(query?.role)
  const effectiveUserId = requestedUserId || (privileged ? undefined : sessionUser.id)
  const from = query?.from?.trim()
  const to = query?.to?.trim()

  // Enforce location restriction for non-privileged users
  let filterLocationId = query?.locationId ? normalizeLocationId(query.locationId) : undefined
  const userAllowed = sessionUser.allowedLocations
  if (!privileged && Array.isArray(userAllowed) && userAllowed.length > 0) {
    // If user requested a location, validate it; otherwise force their allowed location(s)
    if (filterLocationId && !userAllowed.includes(filterLocationId)) {
      throw new Error('You are not authorized to view shifts for this location.')
    }
    if (!filterLocationId && userAllowed.length === 1) {
      filterLocationId = userAllowed[0]
    }
  }

  const snapshot = await getDocs(shiftsCollection)
  const shifts = snapshot.docs.map((row) =>
    mapShiftRecord(row.id, row.data() as Record<string, unknown>),
  )
  const filtered = shifts.filter((shift) => {
    if (!shift.userId) {
      return false
    }
    if (effectiveUserId && shift.userId !== effectiveUserId) {
      return false
    }
    if (normalizedRole && shift.role !== normalizedRole) {
      return false
    }
    if (from && shift.shiftDate < from) {
      return false
    }
    if (to && shift.shiftDate > to) {
      return false
    }
    if (typeof query?.activeOnly === 'boolean') {
      const isActive = !shift.endTime
      if (query.activeOnly !== isActive) {
        return false
      }
    }
    if (filterLocationId && shift.locationId !== filterLocationId) {
      return false
    }
    return true
  })

  return sortShiftsDesc(filtered)
}

export const startFirestoreShift = async (
  token: string,
  role: ShiftRecord['role'],
  locationId: string,
): Promise<ShiftRecord> => {
  const shiftsCollection = getShiftsCollection()
  if (!shiftsCollection) {
    throw new Error('Firestore shifts is not configured.')
  }

  if (!locationId) {
    throw new Error('Location is required to start a shift.')
  }

  const normalizedLocId = normalizeLocationId(locationId)
  const locationName = getLocationDisplayName(normalizedLocId)

  const sessionUser = await getFirestoreSessionUser(token)

  // Backend enforcement: validate user has access to this location
  assertLocationAccess(sessionUser, normalizedLocId)

  if (!isShiftRole(sessionUser.role)) {
    throw new Error('Only Telecaller, Cashier and Track Marshall can start shifts.')
  }
  if (!isShiftRole(role)) {
    throw new Error('Invalid shift role.')
  }
  if (role !== sessionUser.role) {
    throw new Error('Shift role must match your account role.')
  }

  // Auto-close any expired shifts before checking for active ones
  await autoCloseExpiredShifts()

  const activeShift = await getLatestActiveShiftForUser(sessionUser.id)
  if (activeShift) {
    throw new Error('You already have an active shift.')
  }

  // Cashier shift start requires today's kart report for this location.
  // Track Marshall and Telecaller are exempt — only the cashier flow gates billing.
  if (sessionUser.role === 'Cashier') {
    const todayStr = todayIST()
    const kartReport = await getKartReportForDate(normalizedLocId, todayStr)
    if (!kartReport || kartReport.status !== 'submitted') {
      throw new Error(
        "Kart update was not completed. Please wait for Track Marshall to submit today's kart report.",
      )
    }
  }

  const startTime = nowIso()
  const shiftDate = toLocalDate(new Date(startTime))
  const payload = {
    userId: sessionUser.id,
    role: sessionUser.role,
    locationId: normalizedLocId,
    locationName,
    shiftDate,
    startTime,
    breaks: [] as ShiftRecord['breaks'],
    createdAt: startTime,
    updatedAt: startTime,
  }

  await ensureFirebaseAuthForStorage()
  const created = await addDoc(shiftsCollection, payload)
  return {
    id: created.id,
    userId: payload.userId,
    role: payload.role,
    locationId: normalizedLocId,
    locationName,
    shiftDate: payload.shiftDate,
    startTime: payload.startTime,
    breaks: payload.breaks,
  }
}

export const startFirestoreShiftBreak = async (token: string): Promise<ShiftRecord> => {
  const shiftsCollection = getShiftsCollection()
  if (!shiftsCollection) {
    throw new Error('Firestore shifts is not configured.')
  }

  const sessionUser = await getFirestoreSessionUser(token)
  const active = await getLatestActiveShiftForUser(sessionUser.id)
  if (!active) {
    throw new Error('No active shift found.')
  }

  const openBreak = [...active.shift.breaks].reverse().find((item) => !item.breakEnd)
  if (openBreak) {
    throw new Error('Break already started.')
  }

  const breakStart = nowIso()
  const nextBreaks = [...active.shift.breaks, { breakStart }]
  await ensureFirebaseAuthForStorage()
  await updateDoc(doc(shiftsCollection, active.id), {
    breaks: nextBreaks,
    updatedAt: breakStart,
  })

  return {
    ...active.shift,
    breaks: nextBreaks,
  }
}

export const endFirestoreShiftBreak = async (token: string): Promise<ShiftRecord> => {
  const shiftsCollection = getShiftsCollection()
  if (!shiftsCollection) {
    throw new Error('Firestore shifts is not configured.')
  }

  const sessionUser = await getFirestoreSessionUser(token)
  const active = await getLatestActiveShiftForUser(sessionUser.id)
  if (!active) {
    throw new Error('No active shift found.')
  }

  const breakEnd = nowIso()
  let hasOpenBreak = false
  const nextBreaks = active.shift.breaks.map((item) => {
    if (item.breakEnd || hasOpenBreak) {
      return item
    }
    hasOpenBreak = true
    return { ...item, breakEnd }
  })

  if (!hasOpenBreak) {
    throw new Error('No active break found.')
  }

  await ensureFirebaseAuthForStorage()
  await updateDoc(doc(shiftsCollection, active.id), {
    breaks: nextBreaks,
    updatedAt: breakEnd,
  })

  return {
    ...active.shift,
    breaks: nextBreaks,
  }
}

export const endFirestoreShift = async (token: string): Promise<ShiftRecord> => {
  const shiftsCollection = getShiftsCollection()
  if (!shiftsCollection) {
    throw new Error('Firestore shifts is not configured.')
  }

  const sessionUser = await getFirestoreSessionUser(token)
  const active = await getLatestActiveShiftForUser(sessionUser.id)
  if (!active) {
    throw new Error('No active shift found.')
  }

  const endTime = nowIso()
  const normalizedBreaks = active.shift.breaks.map((item) => {
    if (item.breakEnd) {
      return item
    }
    return {
      ...item,
      breakEnd: endTime,
    }
  })
  const totalActiveHours = computeTotalActiveHours(
    active.shift.startTime,
    endTime,
    normalizedBreaks,
  )

  await ensureFirebaseAuthForStorage()
  await updateDoc(doc(shiftsCollection, active.id), {
    endTime,
    breaks: normalizedBreaks,
    totalActiveHours,
    updatedAt: endTime,
  })

  return {
    ...active.shift,
    endTime,
    breaks: normalizedBreaks,
    totalActiveHours,
  }
}

export const endFirestoreShiftById = async (
  token: string,
  shiftId: string,
): Promise<ShiftRecord> => {
  const shiftsCollection = getShiftsCollection()
  if (!shiftsCollection) {
    throw new Error('Firestore shifts is not configured.')
  }

  const sessionUser = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(sessionUser.role)) {
    throw new Error("Only Owner or Admin can end another user's shift.")
  }

  const ref = doc(shiftsCollection, shiftId)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    throw new Error('Shift not found.')
  }

  const shift = mapShiftRecord(snap.id, snap.data() as Record<string, unknown>)
  if (shift.endTime) {
    throw new Error('Shift is already ended.')
  }

  const endTime = nowIso()
  const normalizedBreaks = shift.breaks.map((item) =>
    item.breakEnd ? item : { ...item, breakEnd: endTime },
  )
  const totalActiveHours = computeTotalActiveHours(shift.startTime, endTime, normalizedBreaks)

  await ensureFirebaseAuthForStorage()
  await updateDoc(ref, {
    endTime,
    breaks: normalizedBreaks,
    totalActiveHours,
    updatedAt: endTime,
  })

  return { ...shift, endTime, breaks: normalizedBreaks, totalActiveHours }
}

export const endFirestoreShiftWithSettlement = async (
  token: string,
  settlement: NonNullable<ShiftRecord['settlement']>,
): Promise<ShiftRecord> => {
  const shiftsCollection = getShiftsCollection()
  if (!shiftsCollection) {
    throw new Error('Firestore shifts is not configured.')
  }

  const sessionUser = await getFirestoreSessionUser(token)
  const active = await getLatestActiveShiftForUser(sessionUser.id)
  if (!active) {
    throw new Error('No active shift found.')
  }

  // Cashier checkout requires Track Marshall daily tasks to be complete
  // for this location: today's deep clean + 5 end-shift verification photos.
  // TrackMarshall, Telecaller and Incharge are unaffected.
  if (active.shift.role === 'Cashier') {
    const trackStatus = await getTrackEndOfDayStatus(active.shift.locationId)
    const blockMsg = buildTrackTaskBlockMessage(trackStatus)
    if (blockMsg) {
      throw new Error(blockMsg)
    }
  }

  const endTime = nowIso()
  const normalizedBreaks = active.shift.breaks.map((item) =>
    item.breakEnd ? item : { ...item, breakEnd: endTime },
  )
  const totalActiveHours = computeTotalActiveHours(
    active.shift.startTime,
    endTime,
    normalizedBreaks,
  )

  await ensureFirebaseAuthForStorage()
  await updateDoc(doc(shiftsCollection, active.id), {
    endTime,
    breaks: normalizedBreaks,
    totalActiveHours,
    settlement,
    updatedAt: endTime,
  })

  return {
    ...active.shift,
    endTime,
    breaks: normalizedBreaks,
    totalActiveHours,
    settlement,
  }
}

/**
 * Owner/Admin path to force-close a shift on behalf of an absent cashier.
 * Distinct from `endFirestoreShiftWithSettlement` (which acts on the
 * caller's own active shift) and `endFirestoreShiftById` (which closes
 * without a settlement). Writes audit fields so the ledger can show
 * "force-closed by {Owner} · {reason}" instead of attributing the
 * settlement to the cashier. Idempotent on already-closed shifts: keeps
 * existing endTime, overwrites settlement + audit metadata only.
 */
export const forceCloseFirestoreShift = async (
  token: string,
  shiftId: string,
  settlement: NonNullable<ShiftRecord['settlement']>,
  reason: string,
): Promise<ShiftRecord> => {
  const shiftsCollection = getShiftsCollection()
  if (!shiftsCollection) {
    throw new Error('Firestore shifts is not configured.')
  }
  if (!reason.trim()) {
    throw new Error('A reason is required to force-close a shift.')
  }

  const sessionUser = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(sessionUser.role)) {
    throw new Error('Only Owner or Admin can force-close a shift.')
  }

  const ref = doc(shiftsCollection, shiftId)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    throw new Error('Shift not found.')
  }

  const shift = mapShiftRecord(snap.id, snap.data() as Record<string, unknown>)
  const closedAt = nowIso()
  // Preserve any existing endTime (e.g. the 20:00 fallback the May-11
  // cluster carries) — the audit trail keeps the original timing. Only
  // stamp endTime now if the shift was genuinely still open.
  const endTime = shift.endTime || closedAt
  const normalizedBreaks = shift.breaks.map((item) =>
    item.breakEnd ? item : { ...item, breakEnd: endTime },
  )
  const totalActiveHours = computeTotalActiveHours(shift.startTime, endTime, normalizedBreaks)

  await ensureFirebaseAuthForStorage()
  await updateDoc(ref, {
    endTime,
    breaks: normalizedBreaks,
    totalActiveHours,
    settlement,
    forceClosedBy: sessionUser.id,
    forceClosedByName: sessionUser.name,
    forceClosedAt: closedAt,
    forceCloseReason: reason.trim(),
    updatedAt: closedAt,
  })

  return {
    ...shift,
    endTime,
    breaks: normalizedBreaks,
    totalActiveHours,
    settlement,
    forceClosedBy: sessionUser.id,
    forceClosedByName: sessionUser.name,
    forceClosedAt: closedAt,
    forceCloseReason: reason.trim(),
  }
}

export const reportFirestoreShifts = async (
  token: string,
  userId: string,
): Promise<ShiftRecord[]> => {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) {
    throw new Error('User id is required.')
  }

  return listFirestoreShifts(token, { userId: normalizedUserId })
}

/** Delete a shift record. Only Owner/Admin can perform this action. */
export const deleteFirestoreShift = async (token: string, shiftId: string): Promise<void> => {
  const sessionUser = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(sessionUser.role)) {
    throw new Error('Only Owner or Admin can delete shift records.')
  }
  const shiftsCollection = getShiftsCollection()
  if (!shiftsCollection) throw new Error('Firestore shifts not configured.')
  await deleteDoc(doc(shiftsCollection, shiftId))
}
