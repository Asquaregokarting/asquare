/**
 * Monitor roster data layer.
 *
 * The Monitor page used to read only `staffPresence/*` (web-app heartbeats).
 * That meant a Cashier/TrackMarshall who started a shift via the Billing UI
 * but didn't open the Pipeline web app would show as "not signed in" — even
 * though the Owner Dashboard counted them as "on shift" via the legacy
 * `shifts` collection.
 *
 * This module merges both sources so Monitor reflects what the Owner
 * Dashboard already shows:
 *   - shifts (`shiftsApi.list`)               — primary signal: shift state
 *   - presence (`staffPresenceApi.listLive`)  — overlay: web-app activity
 *   - users (`usersApi.list`)                 — canonical roster + names
 *
 * The merge is a pure function (`mergeMonitorRoster`) so it can be tested
 * without Firestore mocks.
 */

import { shiftsApi, type ShiftRecord } from '../../api/shifts'
import { staffPresenceApi } from '../../api/staff-presence'
import { usersApi } from '../../api/users'
import {
  MONITORED_ROLES,
  type MonitoredRole,
  type StaffPresenceRecord,
  type StaffSessionEndReason,
  type StaffSessionLogRecord,
  type UserRecord,
} from '../../api/types'
import { todayIST } from '../../lib/ist-date'
import { logger } from '../../../lib/logger'

/** Roles that have a formal start/end shift workflow (Billing → Shift). */
export const SHIFT_REQUIRED_ROLES: MonitoredRole[] = ['Cashier', 'TrackMarshall']

export type MonitorShiftStatus =
  | 'active' /** shift started, no endTime */
  | 'on_break' /** active break in progress */
  | 'completed' /** shift ended */
  | 'not_started' /** role requires a shift but none exists today */
  | 'no_shift_required' /** Telecaller / Incharge — no formal shift workflow */

export type MonitorWebStatus =
  | 'online' /** heartbeat <2m */
  | 'idle' /** heartbeat 2–5m */
  | 'offline' /** heartbeat >5m */
  | 'never' /** no presence record at all */

export interface MonitorRosterEntry {
  userId: string
  userName: string
  role: MonitoredRole
  branchId: string
  shiftStatus: MonitorShiftStatus
  shiftStartTime?: string
  shiftEndTime?: string
  webStatus: MonitorWebStatus
  webLastSeenAt?: string
  webLoginAt?: string
}

export interface MonitorRoster {
  /** Branch → entries, ordered by shift recency then user name. */
  byBranch: Map<string, MonitorRosterEntry[]>
  /** Counts per branch (active shifts) for the section headers. */
  activeCountByBranch: Map<string, number>
  /** Counts per branch (online web sessions). */
  onlineCountByBranch: Map<string, number>
  /** Non-fatal errors so the UI can surface them. */
  shiftLoadError?: string
  presenceLoadError?: string
  userLoadError?: string
}

interface MergeInput {
  todayShifts: ShiftRecord[]
  presenceRecords: StaffPresenceRecord[]
  monitoredUsers: UserRecord[]
  allowedBranchIds: string[]
  nowMs: number
}

/**
 * Pure merger. Combines today's shifts, live presence, and the user list
 * into one branch-grouped roster. Anyone whose branch isn't in
 * `allowedBranchIds` is dropped (matches the page guard).
 */
export function mergeMonitorRoster(input: MergeInput): MonitorRoster {
  const { todayShifts, presenceRecords, monitoredUsers, allowedBranchIds, nowMs } = input
  const allowed = new Set(allowedBranchIds)

  const presenceByUser = new Map<string, StaffPresenceRecord>()
  for (const p of presenceRecords) presenceByUser.set(p.userId, p)

  // Pick the most recent shift per (userId) for today. Defensive — typically
  // each user has at most one open shift, but auto-close edge cases can leave
  // multiple rows on the same date.
  const shiftByUser = new Map<string, ShiftRecord>()
  for (const s of todayShifts) {
    if (!s.userId) continue
    const prev = shiftByUser.get(s.userId)
    if (!prev || Date.parse(s.startTime) > Date.parse(prev.startTime)) {
      shiftByUser.set(s.userId, s)
    }
  }

  const userById = new Map<string, UserRecord>()
  for (const u of monitoredUsers) userById.set(u.id, u)

  // Union of all relevant userIds: monitored-role active users + anyone with
  // a shift today + anyone with presence (covers users not in the active
  // list for whatever reason, e.g. role recently changed).
  const userIds = new Set<string>()
  for (const u of monitoredUsers) userIds.add(u.id)
  for (const id of shiftByUser.keys()) userIds.add(id)
  for (const id of presenceByUser.keys()) userIds.add(id)

  const entries: MonitorRosterEntry[] = []
  for (const userId of userIds) {
    const user = userById.get(userId)
    const shift = shiftByUser.get(userId)
    const presence = presenceByUser.get(userId)

    // Resolve role from the most authoritative source available.
    const rawRole = (user?.role ?? presence?.role ?? shift?.role) as string | undefined
    if (!rawRole || !(MONITORED_ROLES as string[]).includes(rawRole)) continue
    const role = rawRole as MonitoredRole

    // Resolve branch in the same priority order. Drop entries with no branch.
    const branchId = shift?.locationId ?? presence?.branchId ?? user?.allowedLocations?.[0] ?? ''
    if (!branchId || !allowed.has(branchId)) continue

    const shiftStatus = deriveShiftStatus(role, shift)
    const webStatus = deriveWebStatus(presence, nowMs)

    const resolvedName =
      user?.name ?? presence?.userName ?? extractShiftName(shift) ?? userId.slice(0, 8)
    entries.push({
      userId,
      userName: resolvedName,
      role,
      branchId,
      shiftStatus,
      shiftStartTime: shift?.startTime,
      shiftEndTime: shift?.endTime,
      webStatus,
      webLastSeenAt: presence?.lastSeenAt,
      webLoginAt: presence?.loginAt,
    })
  }

  const byBranch = new Map<string, MonitorRosterEntry[]>()
  for (const bid of allowedBranchIds) byBranch.set(bid, [])
  for (const e of entries) {
    // Hide non-actionable rows: "not_started" Cashier/TrackMarshall and
    // "no_shift_required" Telecaller/Incharge add noise without a current
    // shift or live session. Only surface them once they're on shift or in app.
    if (e.shiftStatus === 'not_started') continue
    if (e.shiftStatus === 'no_shift_required' && e.webStatus === 'never') continue
    const arr = byBranch.get(e.branchId)
    if (arr) arr.push(e)
  }
  const sortRank: Record<MonitorShiftStatus, number> = {
    active: 0,
    on_break: 1,
    completed: 2,
    no_shift_required: 3,
    not_started: 4,
  }
  for (const [bid, rows] of byBranch) {
    rows.sort((a, b) => {
      const r = sortRank[a.shiftStatus] - sortRank[b.shiftStatus]
      if (r !== 0) return r
      return a.userName.localeCompare(b.userName)
    })
    byBranch.set(bid, rows)
  }

  const activeCountByBranch = new Map<string, number>()
  const onlineCountByBranch = new Map<string, number>()
  for (const [bid, rows] of byBranch) {
    activeCountByBranch.set(
      bid,
      rows.filter((r) => r.shiftStatus === 'active' || r.shiftStatus === 'on_break').length,
    )
    onlineCountByBranch.set(bid, rows.filter((r) => r.webStatus === 'online').length)
  }

  return { byBranch, activeCountByBranch, onlineCountByBranch }
}

function deriveShiftStatus(
  role: MonitoredRole,
  shift: ShiftRecord | undefined,
): MonitorShiftStatus {
  if (!shift) {
    return SHIFT_REQUIRED_ROLES.includes(role) ? 'not_started' : 'no_shift_required'
  }
  if (shift.endTime) return 'completed'
  const onBreak = shift.breaks.some((b) => b.breakStart && !b.breakEnd)
  if (onBreak) return 'on_break'
  return 'active'
}

function deriveWebStatus(
  presence: StaffPresenceRecord | undefined,
  nowMs: number,
): MonitorWebStatus {
  if (!presence) return 'never'
  return staffPresenceApi.deriveStatus(presence.lastSeenAt, nowMs)
}

function extractShiftName(shift: ShiftRecord | undefined): string | undefined {
  // ShiftRecord doesn't carry the staff name directly — only userId. Caller
  // usually has a user list to look up. Returns undefined so the resolver
  // can fall through to the next source.
  if (!shift) return undefined
  return undefined
}

/**
 * Async loader used by the LiveRosterSection. Failures in any one source are
 * swallowed (logged + recorded on the result) so a partial outage still
 * shows what we know. Returns the merged roster plus per-source error flags
 * the UI can surface.
 */
export async function loadMonitorRoster(
  token: string,
  allowedBranchIds: string[],
  nowMs: number = Date.now(),
): Promise<MonitorRoster> {
  const today = todayIST()

  const shiftsP = shiftsApi.list(token, { from: today, to: today }).then(
    (r) => ({ ok: true as const, shifts: r.shifts }),
    (err) => {
      logger.error('monitor.load_shifts_failed', err)
      return { ok: false as const, message: err instanceof Error ? err.message : 'Unknown error' }
    },
  )
  const presenceP = staffPresenceApi.listLive().then(
    (rows) => ({ ok: true as const, rows }),
    (err) => {
      logger.error('monitor.load_presence_failed', err)
      return { ok: false as const, message: err instanceof Error ? err.message : 'Unknown error' }
    },
  )
  const usersP = usersApi.list(token, { status: 'Active' }).then(
    (r) => ({
      ok: true as const,
      users: r.users.filter((u) => (MONITORED_ROLES as string[]).includes(u.role)),
    }),
    (err) => {
      logger.error('monitor.load_users_failed', err)
      return { ok: false as const, message: err instanceof Error ? err.message : 'Unknown error' }
    },
  )

  const [shiftRes, presenceRes, usersRes] = await Promise.all([shiftsP, presenceP, usersP])

  const merged = mergeMonitorRoster({
    todayShifts: shiftRes.ok ? shiftRes.shifts : [],
    presenceRecords: presenceRes.ok ? presenceRes.rows : [],
    monitoredUsers: usersRes.ok ? usersRes.users : [],
    allowedBranchIds,
    nowMs,
  })

  return {
    ...merged,
    shiftLoadError: shiftRes.ok ? undefined : shiftRes.message,
    presenceLoadError: presenceRes.ok ? undefined : presenceRes.message,
    userLoadError: usersRes.ok ? undefined : usersRes.message,
  }
}

/**
 * Convert completed shifts (`shifts/*`) into rows shaped like
 * `StaffSessionLogRecord` so the existing Session History table can render
 * them without a UI rewrite.
 *
 * Rationale: `staffSessionLog` is empty (no monitored-role users have
 * logged into the pipeline web app yet), but `shifts` has the actual
 * attendance data the operations team cares about. We surface that.
 *
 * Pure (no Firestore handle) so it's testable.
 */
export function shiftsToSessionLogRows(
  shifts: ShiftRecord[],
  userNameById: Map<string, string>,
): StaffSessionLogRecord[] {
  const rows: StaffSessionLogRecord[] = []
  for (const s of shifts) {
    if (!s.endTime) continue // in-progress — only history view
    if (!(MONITORED_ROLES as string[]).includes(s.role)) continue
    if (!s.userId) continue

    const start = Date.parse(s.startTime)
    const end = Date.parse(s.endTime)
    const durationMinutes =
      Number.isFinite(start) && Number.isFinite(end) && end > start
        ? Math.round((end - start) / 60_000)
        : Math.round((s.totalActiveHours ?? 0) * 60)

    rows.push({
      id: s.id,
      userId: s.userId,
      userName: userNameById.get(s.userId) ?? s.userId.slice(0, 8),
      role: s.role as MonitoredRole,
      branchId: s.locationId,
      sessionId: s.id,
      loginAt: s.startTime,
      logoutAt: s.endTime,
      durationMinutes,
      // Shifts don't carry the staffSessionLog end-reason taxonomy. Default
      // every shift to 'explicit_signout' since we can't tell auto-close
      // from manual close without the raw `autoEnded` flag (not in
      // ShiftRecord). Refine if/when the type is extended.
      endReason: 'explicit_signout' as StaffSessionEndReason,
      officialShiftId: s.id,
    })
  }
  rows.sort((a, b) => Date.parse(b.loginAt) - Date.parse(a.loginAt))
  return rows
}

export interface LoadSessionHistoryInput {
  token: string
  fromDate: string // YYYY-MM-DD (IST)
  toDate: string // YYYY-MM-DD (IST)
  roles: MonitoredRole[]
  branchIds: string[]
}

/**
 * Loader for the Session History table. Pulls from the `shifts` collection
 * (where today's data actually lives) plus the user list for name lookup,
 * filters by date / role / branch, and reshapes into StaffSessionLogRecord
 * rows for the existing table component.
 */
export async function loadSessionHistory(
  input: LoadSessionHistoryInput,
): Promise<{ rows: StaffSessionLogRecord[]; error?: string }> {
  try {
    const [shiftsResult, usersResult] = await Promise.all([
      shiftsApi.list(input.token, { from: input.fromDate, to: input.toDate }),
      usersApi.list(input.token).catch((err) => {
        logger.error('monitor.history_users_load_failed', err)
        return { users: [] as UserRecord[] }
      }),
    ])

    const userNameById = new Map<string, string>()
    for (const u of usersResult.users) userNameById.set(u.id, u.name)

    const branchSet = new Set(input.branchIds)
    const roleSet = new Set<string>(input.roles)
    const filtered = shiftsResult.shifts.filter(
      (s) => roleSet.has(s.role) && branchSet.has(s.locationId),
    )

    return { rows: shiftsToSessionLogRows(filtered, userNameById) }
  } catch (err) {
    logger.error('monitor.history_load_failed', err)
    return { rows: [], error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
