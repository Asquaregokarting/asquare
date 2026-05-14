import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore'
import { ensureAnonymousAuth, initializeFirestore } from '../lib/firebase'
import { nowIso } from './firestore-utils'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { DeviceSessionRecord, DeviceType } from './types'
import { parseMockTokenUserId } from './client'

const SESSIONS_COLLECTION = 'deviceSessions'

// ─── Device fingerprint helpers ────────────────────────────────────

const generateSessionId = (): string => {
  const random = Math.random().toString(36).slice(2, 10)
  return `ds-${Date.now()}-${random}`
}

const SESSION_ID_KEY = 'pipeline-device-session-id'

export const getStoredSessionId = (): string | null => localStorage.getItem(SESSION_ID_KEY)

const storeSessionId = (id: string): void => localStorage.setItem(SESSION_ID_KEY, id)

const clearStoredSessionId = (): void => localStorage.removeItem(SESSION_ID_KEY)

const detectDeviceType = (): DeviceType => {
  const ua = navigator.userAgent
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet'
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile'
  return 'desktop'
}

const detectBrowser = (): string => {
  const ua = navigator.userAgent
  if (ua.includes('Edg/')) return 'Edge'
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera'
  if (ua.includes('Chrome/') && !ua.includes('Edg/')) return 'Chrome'
  if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari'
  if (ua.includes('Firefox/')) return 'Firefox'
  return 'Unknown'
}

const detectOS = (): string => {
  const ua = navigator.userAgent
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Mac OS')) return 'macOS'
  if (ua.includes('Android')) return 'Android'
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (ua.includes('Linux')) return 'Linux'
  if (ua.includes('CrOS')) return 'ChromeOS'
  return 'Unknown'
}

const fetchPublicIp = async (): Promise<string> => {
  try {
    const response = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(4000),
    })
    const data = (await response.json()) as { ip?: string }
    return data.ip ?? ''
  } catch {
    return ''
  }
}

// ─── Firestore helpers ─────────────────────────────────────────────

const getSessionsCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore is not initialized.')
  return collection(firestore, SESSIONS_COLLECTION)
}

const mapSessionRecord = (id: string, data: Record<string, unknown>): DeviceSessionRecord => ({
  id,
  userId: String(data.userId ?? ''),
  deviceType: (data.deviceType as DeviceType) ?? 'desktop',
  browserName: String(data.browserName ?? 'Unknown'),
  osName: String(data.osName ?? 'Unknown'),
  ipAddress: String(data.ipAddress ?? ''),
  location: data.location ? String(data.location) : undefined,
  loginAt: String(data.loginAt ?? ''),
  lastActiveAt: String(data.lastActiveAt ?? ''),
  isRevoked: Boolean(data.isRevoked),
})

// ─── Public API ────────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/**
 * Find an existing non-revoked session for the same user + device fingerprint
 * within the dedup window. Returning one lets `register()` refresh it in place
 * instead of creating yet another row — which was the root cause of the
 * "duplicate entries on every refresh" complaint from the Devices view.
 */
const findReusableSession = async (
  sessionsCol: ReturnType<typeof getSessionsCollection>,
  userId: string,
  fingerprint: { deviceType: DeviceType; browserName: string; osName: string },
): Promise<{ id: string; data: Record<string, unknown> } | null> => {
  const snapshot = await getDocs(
    query(
      sessionsCol,
      where('userId', '==', userId),
      where('deviceType', '==', fingerprint.deviceType),
      where('browserName', '==', fingerprint.browserName),
      where('osName', '==', fingerprint.osName),
      where('isRevoked', '==', false),
    ),
  )
  if (snapshot.empty) return null

  const cutoff = Date.now() - DEDUP_WINDOW_MS
  const candidates = snapshot.docs
    .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
    .filter((c) => {
      const iso = String(c.data.lastActiveAt ?? c.data.loginAt ?? '')
      const ms = iso ? Date.parse(iso) : NaN
      return Number.isFinite(ms) && ms >= cutoff
    })
    .sort((a, b) =>
      String(b.data.lastActiveAt ?? '').localeCompare(String(a.data.lastActiveAt ?? '')),
    )

  return candidates[0] ?? null
}

export const deviceSessionsApi = {
  /**
   * Register a device session for the current browser/device.
   *
   * Reuses an existing session in two cases, in priority order:
   *   1. A sessionId stored in localStorage still exists in Firestore, belongs
   *      to this user, and isn't revoked — refresh `lastActiveAt` + `ipAddress`.
   *   2. A recent (≤30d) non-revoked session exists for the same
   *      `(userId, deviceType, browserName, osName)` tuple — rebind its id to
   *      localStorage and refresh timestamps.
   *
   * Otherwise creates a new doc. This collapses the previous "every page
   * refresh spawns a new row" bug that polluted the Devices view.
   */
  async register(token: string): Promise<DeviceSessionRecord> {
    const userId = parseMockTokenUserId(token)
    if (!userId) throw new Error('Unauthorized')

    await ensureAnonymousAuth()
    const sessionsCol = getSessionsCollection()
    const ip = await fetchPublicIp()
    const fingerprint = {
      deviceType: detectDeviceType(),
      browserName: detectBrowser(),
      osName: detectOS(),
    }

    // 1. Try the localStorage-stored sessionId first.
    const storedId = getStoredSessionId()
    if (storedId) {
      const storedSnap = await getDoc(doc(sessionsCol, storedId))
      const storedData = storedSnap.exists() ? (storedSnap.data() as Record<string, unknown>) : null
      if (storedData && storedData.userId === userId && storedData.isRevoked !== true) {
        const refreshed: Partial<DeviceSessionRecord> = {
          ipAddress: ip,
          lastActiveAt: nowIso(),
          ...fingerprint,
        }
        await updateDoc(doc(sessionsCol, storedId), refreshed)
        return mapSessionRecord(storedId, { ...storedData, ...refreshed })
      }
      // Stored id is stale (revoked or owned by a different user — can happen
      // when two accounts share a browser). Fall through and look for another
      // reusable row before creating a new one.
      clearStoredSessionId()
    }

    // 2. Try matching by fingerprint within the dedup window.
    const reusable = await findReusableSession(sessionsCol, userId, fingerprint)
    if (reusable) {
      const refreshed: Partial<DeviceSessionRecord> = {
        ipAddress: ip,
        lastActiveAt: nowIso(),
      }
      await updateDoc(doc(sessionsCol, reusable.id), refreshed)
      storeSessionId(reusable.id)
      return mapSessionRecord(reusable.id, { ...reusable.data, ...refreshed })
    }

    // 3. Nothing to reuse — create a fresh row.
    const sessionId = generateSessionId()
    const record: Omit<DeviceSessionRecord, 'id'> = {
      userId,
      deviceType: fingerprint.deviceType,
      browserName: fingerprint.browserName,
      osName: fingerprint.osName,
      ipAddress: ip,
      loginAt: nowIso(),
      lastActiveAt: nowIso(),
      isRevoked: false,
    }

    await setDoc(doc(sessionsCol, sessionId), record)
    storeSessionId(sessionId)
    return { id: sessionId, ...record }
  },

  /** Get all active (non-revoked) sessions for the given user. */
  async listForUser(token: string): Promise<DeviceSessionRecord[]> {
    const userId = parseMockTokenUserId(token)
    if (!userId) throw new Error('Unauthorized')

    await ensureAnonymousAuth()
    const sessionsCol = getSessionsCollection()
    const snapshot = await getDocs(
      query(sessionsCol, where('userId', '==', userId), where('isRevoked', '==', false)),
    )

    return snapshot.docs
      .map((d) => mapSessionRecord(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  },

  /** Update lastActiveAt timestamp for the current session. */
  async touchSession(sessionId: string): Promise<void> {
    await ensureAnonymousAuth()
    const sessionsCol = getSessionsCollection()
    await updateDoc(doc(sessionsCol, sessionId), { lastActiveAt: nowIso() })
  },

  /** Revoke a single session (logout that device). */
  async revokeSession(token: string, sessionId: string): Promise<void> {
    const userId = parseMockTokenUserId(token)
    if (!userId) throw new Error('Unauthorized')

    await ensureAnonymousAuth()
    const sessionsCol = getSessionsCollection()
    await updateDoc(doc(sessionsCol, sessionId), {
      isRevoked: true,
      revokedAt: nowIso(),
    })
  },

  /** Revoke all sessions for the user except the current one. */
  async revokeAllOtherSessions(token: string, currentSessionId: string): Promise<number> {
    const userId = parseMockTokenUserId(token)
    if (!userId) throw new Error('Unauthorized')

    await ensureAnonymousAuth()
    const sessionsCol = getSessionsCollection()
    const snapshot = await getDocs(
      query(sessionsCol, where('userId', '==', userId), where('isRevoked', '==', false)),
    )

    const firestore = initializeFirestore()
    if (!firestore) throw new Error('Firestore is not initialized.')

    let revokedCount = 0
    const batch = writeBatch(firestore)
    for (const d of snapshot.docs) {
      if (d.id !== currentSessionId) {
        batch.update(d.ref, { isRevoked: true, revokedAt: nowIso() })
        revokedCount++
      }
    }

    if (revokedCount > 0) {
      await batch.commit()
    }
    return revokedCount
  },

  /** Remove revoked session from the current device on logout. */
  async removeCurrentSession(token: string): Promise<void> {
    const sessionId = getStoredSessionId()
    if (!sessionId) return

    try {
      const userId = parseMockTokenUserId(token)
      if (!userId) return

      await ensureAnonymousAuth()
      const sessionsCol = getSessionsCollection()
      await deleteDoc(doc(sessionsCol, sessionId))
    } finally {
      clearStoredSessionId()
    }
  },

  /**
   * Subscribe to real-time changes on the current session document.
   * If the session gets revoked, the callback is invoked so the app can force-logout.
   */
  onSessionRevoked(sessionId: string, onRevoked: () => void): Unsubscribe {
    const firestore = initializeFirestore()
    if (!firestore) return () => {}

    const sessionRef = doc(collection(firestore, SESSIONS_COLLECTION), sessionId)
    return onSnapshot(
      sessionRef,
      (snap) => {
        if (!snap.exists()) {
          // Document missing — could mean registration failed, doc was cleaned up,
          // or Firestore auth isn't ready yet. NOT the same as an explicit revocation.
          return
        }
        const data = snap.data() as Record<string, unknown>
        if (data.isRevoked === true) {
          onRevoked()
        }
      },
      () => {
        // Permission error or network issue — ignore silently.
        // The session remains valid based on localStorage until explicitly revoked.
      },
    )
  },

  // ─── Admin-only methods (Owner / Admin) ────────────────────────

  /** Fetch all active sessions across all users. Owner/Admin only. */
  async listAllSessions(token: string): Promise<DeviceSessionRecord[]> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role)) throw new Error('Only Owner/Admin can view all sessions.')

    await ensureAnonymousAuth()
    const sessionsCol = getSessionsCollection()
    const snapshot = await getDocs(query(sessionsCol, where('isRevoked', '==', false)))

    return snapshot.docs
      .map((d) => mapSessionRecord(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  },

  /** Fetch active sessions for a specific user. Owner/Admin only. */
  async listSessionsForUser(token: string, targetUserId: string): Promise<DeviceSessionRecord[]> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role))
      throw new Error("Only Owner/Admin can view other users' sessions.")

    await ensureAnonymousAuth()
    const sessionsCol = getSessionsCollection()
    const snapshot = await getDocs(
      query(sessionsCol, where('userId', '==', targetUserId), where('isRevoked', '==', false)),
    )

    return snapshot.docs
      .map((d) => mapSessionRecord(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  },

  /**
   * Revoke a specific session for any user. Owner/Admin only.
   *
   * Requires `expectedUserId` so we can verify the sessionId actually belongs
   * to that user before touching it — prevents a bad UI state or hand-crafted
   * call from accidentally revoking a session on an unrelated account.
   */
  async adminRevokeSession(
    token: string,
    sessionId: string,
    expectedUserId: string,
  ): Promise<void> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role))
      throw new Error("Only Owner/Admin can revoke other users' sessions.")

    await ensureAnonymousAuth()
    const sessionsCol = getSessionsCollection()
    const snap = await getDoc(doc(sessionsCol, sessionId))
    if (!snap.exists()) throw new Error('Session not found.')
    const data = snap.data() as Record<string, unknown>
    if (String(data.userId ?? '') !== expectedUserId) {
      throw new Error('Session does not belong to the targeted user.')
    }

    await updateDoc(doc(sessionsCol, sessionId), {
      isRevoked: true,
      revokedAt: nowIso(),
      revokedBy: user.id,
    })
  },

  /** Revoke all active sessions for a target user. Owner/Admin only. */
  async adminRevokeAllForUser(token: string, targetUserId: string): Promise<number> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role))
      throw new Error("Only Owner/Admin can revoke other users' sessions.")

    await ensureAnonymousAuth()
    const sessionsCol = getSessionsCollection()
    const snapshot = await getDocs(
      query(sessionsCol, where('userId', '==', targetUserId), where('isRevoked', '==', false)),
    )

    const firestore = initializeFirestore()
    if (!firestore) throw new Error('Firestore is not initialized.')

    let revokedCount = 0
    const batch = writeBatch(firestore)
    for (const d of snapshot.docs) {
      batch.update(d.ref, { isRevoked: true, revokedAt: nowIso(), revokedBy: user.id })
      revokedCount++
    }

    if (revokedCount > 0) {
      await batch.commit()
    }
    return revokedCount
  },
}
