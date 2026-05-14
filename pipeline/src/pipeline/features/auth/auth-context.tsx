/* eslint-disable react-refresh/only-export-components -- idiomatic context: provider + useAuth hook co-located */
import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { authApi } from '../../api/auth'
import { deviceSessionsApi, getStoredSessionId } from '../../api/device-sessions'
import { LoginResponse } from '../../api/types'
import { requestNotificationPermission } from '../../../lib/native-permissions'
import { ensureAnonymousAuth } from '../../lib/firebase'
import { logger } from '../../../lib/logger'
import { useStaffPresenceHeartbeat } from './useStaffPresenceHeartbeat'
import { staffPresenceApi } from '../../api/staff-presence'
import { normalizeLocationId } from '../../../lib/locations'

const STORAGE_KEY = 'pipeline-auth'

interface AuthContextValue {
  session: LoginResponse | null
  initialized: boolean
  isAuthenticated: boolean
  login: (identifier: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateSessionUser: (updates: Partial<LoginResponse['user']>) => void
  /** True when the current session was forcefully revoked from another device. */
  sessionRevoked: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const loadStoredSession = (): LoginResponse | null => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as LoginResponse
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<LoginResponse | null>(() => loadStoredSession())
  const [initialized] = useState(true)
  const [sessionRevoked, setSessionRevoked] = useState(false)
  const unsubRevocationRef = useRef<(() => void) | null>(null)

  useStaffPresenceHeartbeat({
    user: session
      ? {
          id: session.user.id,
          name: session.user.name,
          role: session.user.role,
          // allowedLocations stores slugs (e.g. "visakhapatnam"). Normalize to
          // canonical branchId ("0") so presence docs match what the UI filters on.
          branchId:
            Array.isArray(session.user.allowedLocations) &&
            session.user.allowedLocations.length === 1
              ? normalizeLocationId(session.user.allowedLocations[0])
              : undefined,
        }
      : null,
    sessionId: getStoredSessionId(),
  })

  // Periodically update lastActiveAt on the current device session (every 5 minutes).
  // Skips the touch when the tab is hidden so background tabs don't pile up
  // redundant writes — with N tabs open this was previously N writes every
  // 5 minutes even for tabs the user wasn't looking at.
  useEffect(() => {
    if (!session?.token) return
    const deviceSessionId = getStoredSessionId()
    if (!deviceSessionId) return

    const touchIfVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      deviceSessionsApi.touchSession(deviceSessionId).catch(() => undefined)
    }

    // Touch immediately on mount so lastActiveAt diverges from loginAt
    touchIfVisible()

    const interval = setInterval(touchIfVisible, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [session?.token])

  // Subscribe to real-time revocation when the user is authenticated.
  // We must wait for anonymous auth to be ready before subscribing, otherwise
  // Firestore security rules may deny the read and the listener silently fails.
  useEffect(() => {
    if (!session?.token) {
      unsubRevocationRef.current?.()
      unsubRevocationRef.current = null
      return
    }

    const deviceSessionId = getStoredSessionId()
    if (!deviceSessionId) return

    let cancelled = false

    void ensureAnonymousAuth().then(() => {
      if (cancelled) return
      unsubRevocationRef.current = deviceSessionsApi.onSessionRevoked(deviceSessionId, () => {
        if (session?.user.id) {
          staffPresenceApi.close(session.user.id, 'new_session_replaced').catch((err) => {
            logger.warn('staff_presence.close_on_revoke_failed', err)
          })
        }
        setSessionRevoked(true)
        setSession(null)
        localStorage.removeItem(STORAGE_KEY)
      })
    })

    return () => {
      cancelled = true
      unsubRevocationRef.current?.()
      unsubRevocationRef.current = null
    }
    // Only re-subscribe when the session token changes
  }, [session?.token])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      initialized,
      isAuthenticated: Boolean(session?.token),
      sessionRevoked,
      login: async (identifier: string, password: string) => {
        setSessionRevoked(false)
        const nextSession = await authApi.login(identifier, password)
        setSession(nextSession)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession))

        // Register a device session in the background — non-blocking.
        // Previously this swallowed every error silently; if `fetchPublicIp()`
        // timed out or Firestore rejected the write, the Devices view stayed
        // empty and no signal reached the logger. Logging the failure here
        // feeds our standard scrubbed pipeline so ops can notice.
        deviceSessionsApi.register(nextSession.token).catch((err) => {
          logger.error('device_session.register_failed', err, { userId: nextSession.user.id })
        })

        // Request notification permission after login (Android 13+ needs runtime prompt)
        requestNotificationPermission().catch((err) => {
          logger.warn('native_permissions.request_failed', { reason: err })
        })
      },
      logout: async () => {
        unsubRevocationRef.current?.()
        unsubRevocationRef.current = null

        // Capture userId and token BEFORE clearing state so the close call
        // still has the right identity even after setSession(null).
        const userId = session?.user.id
        const token = session?.token

        // Clear local state first so the UI reflects logout immediately.
        setSession(null)
        localStorage.removeItem(STORAGE_KEY)

        // Close presence AFTER clearing local session to avoid a race where
        // the heartbeat hook re-fires after logout during the async close.
        if (userId) {
          await staffPresenceApi.close(userId, 'explicit_signout').catch((err) => {
            logger.error('staff_presence.close_on_logout_failed', err)
          })
        }

        if (token) {
          await Promise.all([
            authApi.logout(token).catch(() => undefined),
            deviceSessionsApi.removeCurrentSession(token).catch(() => undefined),
          ])
        }
      },
      updateSessionUser: (updates: Partial<LoginResponse['user']>) => {
        setSession((current) => {
          if (!current) {
            return current
          }
          const nextSession = {
            ...current,
            user: {
              ...current.user,
              ...updates,
            },
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession))
          return nextSession
        })
      },
    }),
    [initialized, session, sessionRevoked],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
