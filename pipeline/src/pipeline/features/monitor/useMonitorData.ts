import { useCallback, useEffect, useRef, useState } from 'react'
import { shiftsApi, type ShiftRecord } from '../../api/shifts'
import { staffPresenceApi } from '../../api/staff-presence'
import { usersApi } from '../../api/users'
import { MONITORED_ROLES, type StaffPresenceRecord, type UserRecord } from '../../api/types'
import { logger } from '../../../lib/logger'

const PRESENCE_REFRESH_MS = 30_000 // cheap query, refresh often
const SHIFT_REFRESH_MS = 5 * 60_000 // expensive (auto-close + full scan), every 5 min
const USER_REFRESH_MS = 30 * 60_000 // user list rarely changes within a session

export interface MonitorData {
  shifts: ShiftRecord[]
  presence: StaffPresenceRecord[]
  users: UserRecord[]
  loadingInitial: boolean
  refreshing: boolean
  error: string | null
  refresh: () => void
}

interface CacheEntry<T> {
  value: T
  fetchedAt: number
}

/**
 * Centralized loader for the Monitor page. Each source has its own cadence
 * since their cost differs by ~100x:
 *   - presence: light read of staffPresence, every 30s
 *   - shifts: heavy (auto-close + full collection scan), every 5 min
 *   - users: heaviest list, every 30 min
 *
 * This replaces the prior pattern where LiveRosterSection and
 * SessionHistorySection each independently re-fetched shifts + users on
 * every render/poll, leading to perceived slowness.
 */
export function useMonitorData(token: string): MonitorData {
  const shiftsRef = useRef<CacheEntry<ShiftRecord[]> | null>(null)
  const usersRef = useRef<CacheEntry<UserRecord[]> | null>(null)
  const presenceRef = useRef<CacheEntry<StaffPresenceRecord[]> | null>(null)

  const [shifts, setShifts] = useState<ShiftRecord[]>([])
  const [presence, setPresence] = useState<StaffPresenceRecord[]>([])
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchShifts = useCallback(
    async (force: boolean): Promise<void> => {
      const cached = shiftsRef.current
      if (!force && cached && Date.now() - cached.fetchedAt < SHIFT_REFRESH_MS) return
      try {
        const r = await shiftsApi.list(token)
        shiftsRef.current = { value: r.shifts, fetchedAt: Date.now() }
        setShifts(r.shifts)
      } catch (err) {
        logger.error('monitor.shifts_load_failed', err)
        setError((prev) => prev ?? (err instanceof Error ? err.message : 'Unknown error'))
      }
    },
    [token],
  )

  const fetchUsers = useCallback(
    async (force: boolean): Promise<void> => {
      const cached = usersRef.current
      if (!force && cached && Date.now() - cached.fetchedAt < USER_REFRESH_MS) return
      try {
        const r = await usersApi.list(token, { status: 'Active' })
        const filtered = r.users.filter((u) => (MONITORED_ROLES as string[]).includes(u.role))
        usersRef.current = { value: filtered, fetchedAt: Date.now() }
        setUsers(filtered)
      } catch (err) {
        logger.error('monitor.users_load_failed', err)
        setError((prev) => prev ?? (err instanceof Error ? err.message : 'Unknown error'))
      }
    },
    [token],
  )

  const fetchPresence = useCallback(async (force: boolean): Promise<void> => {
    const cached = presenceRef.current
    if (!force && cached && Date.now() - cached.fetchedAt < PRESENCE_REFRESH_MS) return
    try {
      const rows = await staffPresenceApi.listLive()
      presenceRef.current = { value: rows, fetchedAt: Date.now() }
      setPresence(rows)
    } catch (err) {
      logger.error('monitor.presence_load_failed', err)
      // presence failures are non-fatal — leave prior data in place
    }
  }, [])

  const refresh = useCallback(() => {
    setRefreshing(true)
    Promise.all([fetchShifts(true), fetchUsers(true), fetchPresence(true)]).finally(() =>
      setRefreshing(false),
    )
  }, [fetchShifts, fetchUsers, fetchPresence])

  // Initial parallel load — single round-trip cost, not 2× per section.
  useEffect(() => {
    let cancelled = false
    setLoadingInitial(true)
    setError(null)
    Promise.all([fetchShifts(true), fetchUsers(true), fetchPresence(true)]).finally(() => {
      if (!cancelled) setLoadingInitial(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchShifts, fetchUsers, fetchPresence])

  // Background poll: presence ticks fast, shifts ticks slow; both honor cache.
  useEffect(() => {
    const presenceTimer = setInterval(() => void fetchPresence(false), PRESENCE_REFRESH_MS)
    const shiftTimer = setInterval(() => void fetchShifts(false), SHIFT_REFRESH_MS)
    return () => {
      clearInterval(presenceTimer)
      clearInterval(shiftTimer)
    }
  }, [fetchPresence, fetchShifts])

  return { shifts, presence, users, loadingInitial, refreshing, error, refresh }
}
