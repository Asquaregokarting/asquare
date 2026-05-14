import { useEffect, useRef } from 'react'
import { staffPresenceApi, type MonitoredRole } from '../../api/staff-presence'
import { MONITORED_ROLES, type Role } from '../../api/types'
import { logger } from '../../../lib/logger'

const BASE_HEARTBEAT_MS = 60_000
const MAX_HEARTBEAT_MS = 300_000

function isMonitoredRole(role: Role | string | undefined): role is MonitoredRole {
  return !!role && (MONITORED_ROLES as string[]).includes(role)
}

export interface UseStaffPresenceHeartbeatInput {
  /** Must type role as Role (not string) for compile-time safety. */
  user: { id: string; name: string; role: Role; branchId?: string } | null
  sessionId: string | null
}

/**
 * While mounted for a monitored role, keeps `staffPresence/{userId}` fresh:
 *   - Writes a starting presence doc on mount.
 *   - Pings heartbeat on a setTimeout loop (not setInterval) so the delay
 *     can change: backs off exponentially on consecutive failures
 *     (60s → 120s → 300s, then levels off at 300s). Resets to 60s on success.
 *   - Fires one immediate heartbeat when the tab becomes visible again
 *     (catches users returning from a backgrounded tab).
 *
 * Does NOT close the session on unmount — auth context's logout() and the
 * scheduled function own those paths.
 */
export function useStaffPresenceHeartbeat({
  user,
  sessionId,
}: UseStaffPresenceHeartbeatInput): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const failureCountRef = useRef(0)

  useEffect(() => {
    if (!user || !sessionId) return
    if (!isMonitoredRole(user.role)) return
    const branchId = user.branchId ?? ''

    let cancelled = false

    staffPresenceApi
      .start({ userId: user.id, userName: user.name, role: user.role, branchId, sessionId })
      .catch((err) => logger.error('staff_presence.start_failed', err, { userId: user.id }))

    // Schedule next heartbeat with exponential backoff on consecutive failures.
    const scheduleNext = (delayMs: number) => {
      timerRef.current = setTimeout(async () => {
        if (cancelled) return
        try {
          await staffPresenceApi.heartbeat(user.id)
          failureCountRef.current = 0
          scheduleNext(BASE_HEARTBEAT_MS)
        } catch (err) {
          logger.error('staff_presence.heartbeat_failed', err)
          failureCountRef.current += 1
          // 60s → 120s → 300s → 300s …
          const nextDelay = Math.min(
            MAX_HEARTBEAT_MS,
            BASE_HEARTBEAT_MS * Math.pow(2, failureCountRef.current),
          )
          scheduleNext(nextDelay)
        }
      }, delayMs)
    }

    scheduleNext(BASE_HEARTBEAT_MS)

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        staffPresenceApi.heartbeat(user.id).catch(() => {
          // Visibility heartbeat failures are best-effort; backoff timer handles recovery.
        })
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      failureCountRef.current = 0
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user, sessionId])
}
