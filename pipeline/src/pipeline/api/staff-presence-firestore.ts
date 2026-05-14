/**
 * Firestore layer for Staff Monitor (presence + session log).
 *
 * This file holds pure helpers + Firestore CRUD. The public facade is
 * `staff-presence.ts` — call that from hooks and components.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  QueryConstraint,
  runTransaction,
  setDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { logger } from '../../lib/logger'
import {
  MonitoredRole,
  StaffPresenceRecord,
  StaffSessionEndReason,
  StaffSessionLogRecord,
} from './types'
import { getActiveTrackMarshallShiftByUser } from './track-marshall-shifts-firestore'

export type PresenceStatus = 'online' | 'idle' | 'offline'

const IDLE_THRESHOLD_MS = 2 * 60_000
const OFFLINE_THRESHOLD_MS = 5 * 60_000

export function derivePresenceStatus(
  lastSeenAtIso: string,
  nowMs: number = Date.now(),
): PresenceStatus {
  const ts = Date.parse(lastSeenAtIso)
  if (!Number.isFinite(ts)) return 'offline'
  const ageMs = nowMs - ts
  if (ageMs < IDLE_THRESHOLD_MS) return 'online'
  if (ageMs < OFFLINE_THRESHOLD_MS) return 'idle'
  return 'offline'
}

const PRESENCE_COLLECTION = 'staffPresence'
const SESSION_LOG_COLLECTION = 'staffSessionLog'

const getPresenceCollection = () => {
  const firestore = initializeFirestore()
  return firestore ? collection(firestore, PRESENCE_COLLECTION) : null
}

const getSessionLogCollection = () => {
  const firestore = initializeFirestore()
  return firestore ? collection(firestore, SESSION_LOG_COLLECTION) : null
}

const nowIso = () => new Date().toISOString()

function minutesBetween(startIso: string, endIso: string): number {
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.round((end - start) / 60_000)
}

export interface StartPresenceInput {
  userId: string
  userName: string
  role: MonitoredRole
  branchId: string
  sessionId: string
}

/**
 * Start a new presence session for this user. Wrapped in a Firestore
 * transaction so that closing an existing session and writing the new one are
 * atomic — avoids orphan presence docs if one write succeeds and the other
 * fails (mirrors the wallet runTransaction pattern).
 *
 * Special case: if a presence doc already exists for the SAME userId AND the
 * SAME sessionId (e.g. page refresh), skip the close-and-replace and simply
 * return the existing loginAt — this prevents phantom 'new_session_replaced'
 * log entries on every page reload (fixes I2).
 */
export async function startPresence(input: StartPresenceInput): Promise<string> {
  const firestore = initializeFirestore()
  if (!firestore) {
    throw new Error('Firestore is not configured.')
  }
  const presenceCol = collection(firestore, PRESENCE_COLLECTION)
  const logCol = collection(firestore, SESSION_LOG_COLLECTION)
  const ref = doc(presenceCol, input.userId)

  return runTransaction(firestore, async (tx) => {
    const existing = await tx.get(ref)

    if (existing.exists()) {
      const data = existing.data() as StaffPresenceRecord

      // Same session still alive — just treat this as a heartbeat so page
      // refreshes don't create spurious 'new_session_replaced' log entries.
      if (data.sessionId === input.sessionId) {
        tx.set(ref, { lastSeenAt: nowIso() }, { merge: true })
        return data.loginAt
      }

      // Different session: close the old one to the log first.
      const logoutAt = nowIso()
      const logRef = doc(logCol)
      tx.set(logRef, {
        userId: data.userId,
        userName: data.userName,
        role: data.role,
        branchId: data.branchId,
        sessionId: data.sessionId,
        loginAt: data.loginAt,
        logoutAt,
        durationMinutes: minutesBetween(data.loginAt, logoutAt),
        endReason: 'new_session_replaced' as StaffSessionEndReason,
        officialShiftId: null,
      })
    }

    const loginAt = nowIso()
    const record: StaffPresenceRecord = {
      userId: input.userId,
      userName: input.userName,
      role: input.role,
      branchId: input.branchId,
      sessionId: input.sessionId,
      loginAt,
      lastSeenAt: loginAt,
      explicitLogoutAt: null,
    }
    tx.set(ref, record)
    return loginAt
  })
}

/**
 * Refresh `lastSeenAt` on the presence doc. No-op if the doc doesn't exist
 * (user may have been timed out by the scheduled function between renders).
 */
export async function heartbeatPresence(userId: string): Promise<void> {
  const presenceCol = getPresenceCollection()
  if (!presenceCol) return
  const ref = doc(presenceCol, userId)
  const existing = await getDoc(ref)
  if (!existing.exists()) return
  await setDoc(ref, { lastSeenAt: nowIso() }, { merge: true })
}

/**
 * Close the current presence session atomically: append a log entry and
 * delete the presence doc in a single Firestore transaction. Safe to call
 * even if no presence doc exists (no-op). Uses runTransaction so a failed
 * log-write never leaves an orphan presence doc and vice-versa.
 *
 * Looks up the user's active TrackMarshall shift (if any) before the
 * transaction and records it as `officialShiftId` on the log entry. For
 * roles without a formal shift system (Telecaller, Incharge, Cashier) or
 * when no shift is active, writes null.
 */
export async function closeSession(
  userId: string,
  endReason: StaffSessionEndReason,
  officialShiftId: string | null = null,
): Promise<void> {
  const firestore = initializeFirestore()
  if (!firestore) return
  const presenceCol = collection(firestore, PRESENCE_COLLECTION)
  const logCol = collection(firestore, SESSION_LOG_COLLECTION)
  const ref = doc(presenceCol, userId)

  // Look up active shift BEFORE the transaction (reads inside transactions must
  // be on refs that the transaction watches; an external collection query is
  // cleaner outside).
  let resolvedShiftId = officialShiftId
  if (resolvedShiftId === null) {
    try {
      const activeShift = await getActiveTrackMarshallShiftByUser(userId)
      resolvedShiftId = activeShift?.id ?? null
    } catch {
      // Shift lookup is best-effort; don't block the close on a shift read failure.
      resolvedShiftId = null
    }
  }

  try {
    await runTransaction(firestore, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) return

      const data = snap.data() as StaffPresenceRecord
      const logoutAt = nowIso()
      const logRef = doc(logCol)
      tx.set(logRef, {
        userId: data.userId,
        userName: data.userName,
        role: data.role,
        branchId: data.branchId,
        sessionId: data.sessionId,
        loginAt: data.loginAt,
        logoutAt,
        durationMinutes: minutesBetween(data.loginAt, logoutAt),
        endReason,
        officialShiftId: resolvedShiftId,
      })
      tx.delete(ref)
    })
  } catch (err) {
    logger.error('staff_presence.close_session_failed', err, { userId, endReason })
    throw err
  }
}

/**
 * Read all active presence docs, optionally filtered to a branch. Used by
 * the Live Now section on the Monitor page.
 */
export async function listPresence(branchId?: string): Promise<StaffPresenceRecord[]> {
  const presenceCol = getPresenceCollection()
  if (!presenceCol) return []
  const q = branchId ? query(presenceCol, where('branchId', '==', branchId)) : presenceCol
  const snap = await getDocs(q)
  return snap.docs.map((d) => d.data() as StaffPresenceRecord)
}

export interface HistoryQueryInput {
  fromDateIso: string
  toDateIso: string
  roles?: MonitoredRole[]
  branchIds?: string[]
}

/**
 * Build Firestore `QueryConstraint[]` for the session-history query. Kept
 * pure (no Firestore instance) so it can be unit-tested without mocks.
 */
export function buildHistoryQueryConstraints(input: HistoryQueryInput): QueryConstraint[] {
  const constraints: QueryConstraint[] = [
    where('loginAt', '>=', input.fromDateIso),
    where('loginAt', '<=', input.toDateIso),
  ]
  if (input.roles && input.roles.length > 0) {
    constraints.push(
      input.roles.length === 1
        ? where('role', '==', input.roles[0])
        : where('role', 'in', input.roles),
    )
  }
  if (input.branchIds && input.branchIds.length > 0) {
    constraints.push(
      input.branchIds.length === 1
        ? where('branchId', '==', input.branchIds[0])
        : where('branchId', 'in', input.branchIds),
    )
  }
  return constraints
}

/**
 * Firestore caps disjunctive queries at 30 disjunctions total — i.e. when
 * combining two `in` clauses the *product* of their lengths must be ≤ 30,
 * and any single `in` clause must have ≤ 30 values.
 * See: https://cloud.google.com/firestore/native/docs/query-data/queries#query_limitations
 *
 * If the requested filter would exceed that cap, we split it into multiple
 * sub-queries and merge results in memory. We chunk the larger of the two
 * dimensions first so the resulting sub-queries stay valid.
 *
 * Pure (no Firestore handle) so it can be unit-tested directly.
 */
export function splitHistoryQueryForDisjunctionLimit(
  input: HistoryQueryInput,
  limit = 30,
): HistoryQueryInput[] {
  const roles = input.roles ?? []
  const branchIds = input.branchIds ?? []
  const roleCount = roles.length
  const branchCount = branchIds.length
  const product = Math.max(1, roleCount) * Math.max(1, branchCount)
  if (product <= limit && roleCount <= limit && branchCount <= limit) return [input]

  // Pick the dimension to chunk: the larger one, so each chunk × the smaller
  // dimension stays under `limit`. Each chunk's size is capped so:
  //   chunkSize × otherCount ≤ limit  AND  chunkSize ≤ limit
  const chunkRoles = roleCount >= branchCount
  const source = chunkRoles ? roles : branchIds
  const otherCount = chunkRoles ? Math.max(1, branchCount) : Math.max(1, roleCount)
  const chunkSize = Math.max(1, Math.min(limit, Math.floor(limit / otherCount)))

  const chunks: HistoryQueryInput[] = []
  for (let i = 0; i < source.length; i += chunkSize) {
    const slice = source.slice(i, i + chunkSize)
    chunks.push(
      chunkRoles ? { ...input, roles: slice as MonitoredRole[] } : { ...input, branchIds: slice },
    )
  }
  return chunks
}

async function runHistoryQuery(
  logCol: ReturnType<typeof collection>,
  input: HistoryQueryInput,
): Promise<StaffSessionLogRecord[]> {
  const constraints = buildHistoryQueryConstraints(input)
  const q = query(logCol, ...constraints, orderBy('loginAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<StaffSessionLogRecord, 'id'>),
  }))
}

export async function queryHistory(input: HistoryQueryInput): Promise<StaffSessionLogRecord[]> {
  const logCol = getSessionLogCollection()
  if (!logCol) return []

  const subQueries = splitHistoryQueryForDisjunctionLimit(input)
  if (subQueries.length === 1) {
    return runHistoryQuery(logCol, subQueries[0])
  }

  const results = await Promise.all(subQueries.map((q) => runHistoryQuery(logCol, q)))
  // Sub-queries chunk along role OR branch, so a doc can't legitimately appear
  // in two of them — but de-dupe by id defensively in case a future change
  // chunks both dimensions.
  const seen = new Set<string>()
  const merged: StaffSessionLogRecord[] = []
  for (const arr of results) {
    for (const row of arr) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      merged.push(row)
    }
  }
  return merged.sort((a, b) => Date.parse(b.loginAt) - Date.parse(a.loginAt))
}
