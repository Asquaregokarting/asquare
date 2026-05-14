# Staff Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a top-level "Monitor" tab in the pipeline admin that shows live presence (who is signed in right now, per branch) and session history (filterable, CSV-exportable attendance log) for Telecaller / Cashier / Incharge / TrackMarshall roles.

**Architecture:** Two new Firestore collections — `staffPresence/{userId}` (live roster, updated every 60s by a client heartbeat) and `staffSessionLog/*` (append-only history). A scheduled Firebase Function runs every 2 minutes to close presence docs whose heartbeat has stopped for > 5 minutes, and a weekly job prunes history older than 90 days. The UI is a single scrolling page — a live-now card grid at the top and a filterable history table below — restricted to Owner and Admin.

**Tech Stack:** React 18 + TypeScript + Vite, Firebase 12 (Firestore + Cloud Functions JS), Tailwind 3, Vitest, `firebase-admin` for scheduled functions.

**Spec:** `docs/superpowers/specs/2026-04-24-staff-monitor-design.md`

---

## File Structure

**New:**

- `src/pipeline/api/staff-presence-firestore.ts` — pure Firestore CRUD + query helpers
- `src/pipeline/api/staff-presence.ts` — public API facade used by hooks/components
- `src/pipeline/features/auth/useStaffPresenceHeartbeat.ts` — client heartbeat hook
- `src/pipeline/pages/modules/MonitorModule.tsx` — the page
- `src/pipeline/pages/modules/monitor/LiveRosterSection.tsx` — top live-now grid
- `src/pipeline/pages/modules/monitor/SessionHistorySection.tsx` — bottom history table
- `functions/api/staff-presence-cleanup.js` — scheduled cleanup + pruning jobs

**Modified:**

- `src/pipeline/api/types.ts` — add `StaffPresenceRecord` and `StaffSessionLogRecord`
- `src/pipeline/features/auth/auth-context.tsx` — mount heartbeat hook + call closeSession in logout
- `src/pipeline/app/router.tsx` — add `/monitor` route
- `src/pipeline/features/navigation/module-manifest.ts` — add `Monitor` tab for Owner/Admin
- `firestore.indexes.json` — composite index on `staffSessionLog`
- `firestore.rules` — Owner/Admin reads; self-writes to presence; server-only writes to log
- `functions/index.js` — register the new scheduled function exports

---

### Task 1: Add types for presence and session log

**Files:**

- Modify: `src/pipeline/api/types.ts` (append at end)

- [ ] **Step 1: Add the two record types**

Append to `src/pipeline/api/types.ts`:

```ts
// ─── Staff Monitor ─────────────────────────────────────────────────

export type MonitoredRole = 'Telecaller' | 'Cashier' | 'Incharge' | 'TrackMarshall'

export const MONITORED_ROLES: MonitoredRole[] = [
  'Telecaller',
  'Cashier',
  'Incharge',
  'TrackMarshall',
]

export interface StaffPresenceRecord {
  userId: string
  userName: string
  role: MonitoredRole
  /** Canonical branchId (normalized via `normalizeLocationId`). */
  branchId: string
  /** Current deviceSessions/{id}. */
  sessionId: string
  /** ISO timestamp when this session started. */
  loginAt: string
  /** ISO timestamp, refreshed every heartbeat. */
  lastSeenAt: string
  /** Set when user clicks Sign Out. Null while the session is active. */
  explicitLogoutAt: string | null
}

export type StaffSessionEndReason = 'explicit_signout' | 'timeout' | 'new_session_replaced'

export interface StaffSessionLogRecord {
  id: string
  userId: string
  userName: string
  role: MonitoredRole
  branchId: string
  sessionId: string
  loginAt: string
  logoutAt: string
  durationMinutes: number
  endReason: StaffSessionEndReason
  /** Links to trackMarshallShifts or cashier shift doc when one was active. */
  officialShiftId: string | null
}
```

- [ ] **Step 2: Run tsc to verify no type errors**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/api/types.ts
git commit -m "feat(monitor): add StaffPresence and StaffSessionLog types"
```

---

### Task 2: Derive status from lastSeenAt (pure function, test-first)

**Files:**

- Create: `src/pipeline/api/staff-presence-firestore.ts` (stub + one pure helper)
- Test: `src/pipeline/api/staff-presence-firestore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/api/staff-presence-firestore.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { derivePresenceStatus } from './staff-presence-firestore'

describe('derivePresenceStatus', () => {
  const now = new Date('2026-04-24T18:00:00Z').getTime()

  it('returns "online" when heartbeat is within 2 minutes', () => {
    const lastSeen = new Date(now - 60_000).toISOString() // 1m ago
    expect(derivePresenceStatus(lastSeen, now)).toBe('online')
  })

  it('returns "idle" when heartbeat is 2-5 minutes old', () => {
    const lastSeen = new Date(now - 3 * 60_000).toISOString() // 3m ago
    expect(derivePresenceStatus(lastSeen, now)).toBe('idle')
  })

  it('returns "offline" when heartbeat is older than 5 minutes', () => {
    const lastSeen = new Date(now - 6 * 60_000).toISOString()
    expect(derivePresenceStatus(lastSeen, now)).toBe('offline')
  })

  it('returns "offline" when lastSeenAt is missing or invalid', () => {
    expect(derivePresenceStatus('', now)).toBe('offline')
    expect(derivePresenceStatus('not-a-date', now)).toBe('offline')
  })
})
```

- [ ] **Step 2: Create the stub file with the helper**

Create `src/pipeline/api/staff-presence-firestore.ts`:

```ts
/**
 * Firestore layer for Staff Monitor (presence + session log).
 *
 * This file holds pure helpers + Firestore CRUD. The public facade is
 * `staff-presence.ts` — call that from hooks and components.
 */

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
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/pipeline/api/staff-presence-firestore.test.ts`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/api/staff-presence-firestore.ts src/pipeline/api/staff-presence-firestore.test.ts
git commit -m "feat(monitor): add derivePresenceStatus helper"
```

---

### Task 3: Firestore write helpers (startPresence, heartbeat, closeSession)

**Files:**

- Modify: `src/pipeline/api/staff-presence-firestore.ts`

- [ ] **Step 1: Add write helpers and Firestore collection constants**

Append to `src/pipeline/api/staff-presence-firestore.ts`:

```ts
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
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
 * Start a new presence session for this user. If a stale presence doc exists,
 * close it to the history log first (endReason 'new_session_replaced'), then
 * write a fresh doc. Returns the new loginAt.
 */
export async function startPresence(input: StartPresenceInput): Promise<string> {
  const presenceCol = getPresenceCollection()
  const logCol = getSessionLogCollection()
  if (!presenceCol || !logCol) {
    throw new Error('Firestore is not configured.')
  }

  const ref = doc(presenceCol, input.userId)
  const existing = await getDoc(ref)
  if (existing.exists()) {
    const data = existing.data() as StaffPresenceRecord
    const logoutAt = nowIso()
    await addDoc(logCol, {
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
  await setDoc(ref, record)
  return loginAt
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
 * Close the current presence session, append a log entry, delete the
 * presence doc. Safe to call even if no presence doc exists (no-op).
 */
export async function closeSession(
  userId: string,
  endReason: StaffSessionEndReason,
  officialShiftId: string | null = null,
): Promise<void> {
  const presenceCol = getPresenceCollection()
  const logCol = getSessionLogCollection()
  if (!presenceCol || !logCol) return
  const ref = doc(presenceCol, userId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return

  const data = snap.data() as StaffPresenceRecord
  const logoutAt = nowIso()
  try {
    await addDoc(logCol, {
      userId: data.userId,
      userName: data.userName,
      role: data.role,
      branchId: data.branchId,
      sessionId: data.sessionId,
      loginAt: data.loginAt,
      logoutAt,
      durationMinutes: minutesBetween(data.loginAt, logoutAt),
      endReason,
      officialShiftId,
    })
    await deleteDoc(ref)
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
```

- [ ] **Step 2: Run tsc + existing tests to verify nothing regressed**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx vitest run src/pipeline/api/staff-presence-firestore.test.ts`
Expected: 4 passed (the existing tests, unaffected).

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/api/staff-presence-firestore.ts
git commit -m "feat(monitor): add startPresence, heartbeatPresence, closeSession, listPresence"
```

---

### Task 4: History-query helper with role/branch/date filters

**Files:**

- Modify: `src/pipeline/api/staff-presence-firestore.ts`
- Test: `src/pipeline/api/staff-presence-firestore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/pipeline/api/staff-presence-firestore.test.ts`:

```ts
import { buildHistoryQueryConstraints } from './staff-presence-firestore'

describe('buildHistoryQueryConstraints', () => {
  it('returns a date-only constraint when no other filters', () => {
    const constraints = buildHistoryQueryConstraints({
      fromDateIso: '2026-04-20T00:00:00Z',
      toDateIso: '2026-04-24T23:59:59Z',
    })
    expect(constraints).toHaveLength(2)
  })

  it('adds role and branch filters when provided', () => {
    const constraints = buildHistoryQueryConstraints({
      fromDateIso: '2026-04-20T00:00:00Z',
      toDateIso: '2026-04-24T23:59:59Z',
      roles: ['Cashier'],
      branchIds: ['0'],
    })
    expect(constraints).toHaveLength(4)
  })

  it('uses `in` when multiple roles are requested', () => {
    const constraints = buildHistoryQueryConstraints({
      fromDateIso: '2026-04-20T00:00:00Z',
      toDateIso: '2026-04-24T23:59:59Z',
      roles: ['Cashier', 'Telecaller'],
    })
    expect(constraints).toHaveLength(3) // fromDate, toDate, role-in
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npx vitest run src/pipeline/api/staff-presence-firestore.test.ts`
Expected: 3 new tests fail with "is not a function".

- [ ] **Step 3: Implement the helper**

Append to `src/pipeline/api/staff-presence-firestore.ts`:

```ts
import { orderBy, QueryConstraint } from 'firebase/firestore'

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

export async function queryHistory(input: HistoryQueryInput): Promise<StaffSessionLogRecord[]> {
  const logCol = getSessionLogCollection()
  if (!logCol) return []
  const constraints = buildHistoryQueryConstraints(input)
  const q = query(logCol, ...constraints, orderBy('loginAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StaffSessionLogRecord, 'id'>) }))
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/pipeline/api/staff-presence-firestore.test.ts`
Expected: 7 passed (4 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/api/staff-presence-firestore.ts src/pipeline/api/staff-presence-firestore.test.ts
git commit -m "feat(monitor): add buildHistoryQueryConstraints + queryHistory"
```

---

### Task 5: Public API facade

**Files:**

- Create: `src/pipeline/api/staff-presence.ts`

- [ ] **Step 1: Create the facade**

Create `src/pipeline/api/staff-presence.ts`:

```ts
import { MonitoredRole, StaffPresenceRecord, StaffSessionLogRecord } from './types'
import {
  buildHistoryQueryConstraints,
  closeSession,
  derivePresenceStatus,
  heartbeatPresence,
  listPresence,
  queryHistory,
  startPresence,
  type HistoryQueryInput,
  type PresenceStatus,
  type StartPresenceInput,
} from './staff-presence-firestore'

export type { HistoryQueryInput, MonitoredRole, PresenceStatus, StartPresenceInput }

export const staffPresenceApi = {
  start(input: StartPresenceInput) {
    return startPresence(input)
  },
  heartbeat(userId: string) {
    return heartbeatPresence(userId)
  },
  close(userId: string, endReason: 'explicit_signout' | 'timeout' | 'new_session_replaced') {
    return closeSession(userId, endReason)
  },
  listLive(branchId?: string): Promise<StaffPresenceRecord[]> {
    return listPresence(branchId)
  },
  queryHistory(input: HistoryQueryInput): Promise<StaffSessionLogRecord[]> {
    return queryHistory(input)
  },
  deriveStatus: derivePresenceStatus,
  buildHistoryConstraints: buildHistoryQueryConstraints,
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/api/staff-presence.ts
git commit -m "feat(monitor): add staffPresenceApi facade"
```

---

### Task 6: Heartbeat hook

**Files:**

- Create: `src/pipeline/features/auth/useStaffPresenceHeartbeat.ts`
- Test: `src/pipeline/features/auth/useStaffPresenceHeartbeat.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/features/auth/useStaffPresenceHeartbeat.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStaffPresenceHeartbeat } from './useStaffPresenceHeartbeat'
import { staffPresenceApi } from '../../api/staff-presence'

vi.mock('../../api/staff-presence', () => ({
  staffPresenceApi: {
    start: vi.fn().mockResolvedValue('2026-04-24T18:00:00Z'),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('useStaffPresenceHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does nothing when user is null', () => {
    renderHook(() => useStaffPresenceHeartbeat({ user: null, sessionId: null }))
    expect(staffPresenceApi.start).not.toHaveBeenCalled()
  })

  it('does nothing for non-monitored roles', () => {
    renderHook(() =>
      useStaffPresenceHeartbeat({
        user: { id: 'u1', name: 'Owner', role: 'Owner', branchId: '0' },
        sessionId: 'ds-1',
      }),
    )
    expect(staffPresenceApi.start).not.toHaveBeenCalled()
  })

  it('starts presence and heartbeats every 60s for monitored role', async () => {
    renderHook(() =>
      useStaffPresenceHeartbeat({
        user: { id: 'u2', name: 'Cash', role: 'Cashier', branchId: '1' },
        sessionId: 'ds-2',
      }),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(staffPresenceApi.start).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(staffPresenceApi.heartbeat).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(staffPresenceApi.heartbeat).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npx vitest run src/pipeline/features/auth/useStaffPresenceHeartbeat.test.tsx`
Expected: fails with "Cannot find module './useStaffPresenceHeartbeat'".

- [ ] **Step 3: Implement the hook**

Create `src/pipeline/features/auth/useStaffPresenceHeartbeat.ts`:

```ts
import { useEffect, useRef } from 'react'
import { staffPresenceApi, type MonitoredRole } from '../../api/staff-presence'
import { MONITORED_ROLES } from '../../api/types'
import { logger } from '../../../lib/logger'

const HEARTBEAT_INTERVAL_MS = 60_000

function isMonitoredRole(role: string | undefined): role is MonitoredRole {
  return !!role && (MONITORED_ROLES as string[]).includes(role)
}

export interface UseStaffPresenceHeartbeatInput {
  user: { id: string; name: string; role: string; branchId?: string } | null
  sessionId: string | null
}

/**
 * While mounted for a monitored role, keeps `staffPresence/{userId}` fresh:
 *   - Writes a starting presence doc on mount.
 *   - Pings heartbeat every 60s.
 *   - Fires one immediate heartbeat when the tab becomes visible again
 *     (catches users returning from a backgrounded tab).
 *
 * Does NOT close the session on unmount — the auth context's `logout()`
 * path owns the explicit-signout close, and the scheduled function owns
 * the timeout close. Unmounting from a navigation reloaded tab must not
 * silently mark the user as logged out.
 */
export function useStaffPresenceHeartbeat({
  user,
  sessionId,
}: UseStaffPresenceHeartbeatInput): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!user || !sessionId) return
    if (!isMonitoredRole(user.role)) return
    const branchId = user.branchId ?? ''

    let cancelled = false

    staffPresenceApi
      .start({ userId: user.id, userName: user.name, role: user.role, branchId, sessionId })
      .catch((err) => logger.error('staff_presence.start_failed', err, { userId: user.id }))

    intervalRef.current = setInterval(() => {
      if (cancelled) return
      staffPresenceApi
        .heartbeat(user.id)
        .catch((err) => logger.error('staff_presence.heartbeat_failed', err))
    }, HEARTBEAT_INTERVAL_MS)

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        staffPresenceApi.heartbeat(user.id).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user, sessionId])
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/pipeline/features/auth/useStaffPresenceHeartbeat.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/features/auth/useStaffPresenceHeartbeat.ts src/pipeline/features/auth/useStaffPresenceHeartbeat.test.tsx
git commit -m "feat(monitor): add useStaffPresenceHeartbeat hook"
```

---

### Task 7: Wire heartbeat + close-on-logout into auth-context

**Files:**

- Modify: `src/pipeline/features/auth/auth-context.tsx`

- [ ] **Step 1: Inspect the existing logout method to find the insertion point**

Run: `grep -n "logout" src/pipeline/features/auth/auth-context.tsx | head -5`
Note the line where `logout: async () => {` starts — you'll add one line there.

- [ ] **Step 2: Add the heartbeat hook at the top of AuthProvider**

At the top of the `AuthProvider` component body (after `const [session, setSession]`), add:

```ts
import { useStaffPresenceHeartbeat } from './useStaffPresenceHeartbeat'
import { staffPresenceApi } from '../../api/staff-presence'
import { getStoredSessionId } from '../../api/device-sessions'
```

Then inside `AuthProvider`:

```ts
useStaffPresenceHeartbeat({
  user: session
    ? {
        id: session.user.id,
        name: session.user.name,
        role: session.user.role,
        branchId:
          Array.isArray(session.user.allowedLocations) && session.user.allowedLocations.length === 1
            ? session.user.allowedLocations[0]
            : undefined,
      }
    : null,
  sessionId: getStoredSessionId(),
})
```

- [ ] **Step 3: Close the session inside logout()**

In the `logout:` method body, before the existing `setSession(null)` call, add:

```ts
if (session?.user.id) {
  try {
    await staffPresenceApi.close(session.user.id, 'explicit_signout')
  } catch (err) {
    logger.error('staff_presence.close_on_logout_failed', err)
  }
}
```

- [ ] **Step 4: Also close in the `onSessionRevoked` handler**

Find the `deviceSessionsApi.onSessionRevoked` listener and before its `setSession(null)`:

```ts
if (session?.user.id) {
  staffPresenceApi.close(session.user.id, 'new_session_replaced').catch(() => {})
}
```

- [ ] **Step 5: Type-check and run existing auth tests**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx vitest run src/pipeline/features/auth`
Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/features/auth/auth-context.tsx
git commit -m "feat(monitor): mount heartbeat + close-on-logout in auth-context"
```

---

### Task 8: Firestore rules + composite index

**Files:**

- Modify: `firestore.indexes.json`
- Modify: `firestore.rules`

- [ ] **Step 1: Add the composite index**

Open `firestore.indexes.json` and add inside the `indexes` array:

```json
{
  "collectionGroup": "staffSessionLog",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "role", "order": "ASCENDING" },
    { "fieldPath": "branchId", "order": "ASCENDING" },
    { "fieldPath": "loginAt", "order": "DESCENDING" }
  ]
}
```

- [ ] **Step 2: Add rules**

Open `firestore.rules` and append inside the `match /databases/{db}/documents { ... }` block:

```
match /staffPresence/{userId} {
  // Owner/Admin can read for the Monitor page.
  allow read: if request.auth != null
    && (request.auth.token.role in ['Owner', 'Admin']);
  // Each user can write their OWN presence doc (the heartbeat hook).
  allow write: if request.auth != null && request.auth.uid == userId;
}
match /staffSessionLog/{id} {
  allow read: if request.auth != null
    && (request.auth.token.role in ['Owner', 'Admin']);
  // Writes happen server-side (heartbeat close + scheduled cleanup).
  allow write: if false;
}
```

Note: if the repo's rules are "intentionally permissive" today (per `CLAUDE.md`), leave that pattern as-is and still add these specific rules for Monitor — they'll take effect when rules are tightened project-wide.

- [ ] **Step 3: Lint the rules file and commit**

Run: `npx firebase firestore:rules:validate firestore.rules` (if the firebase CLI is available; otherwise skip — the deploy will validate).

```bash
git add firestore.indexes.json firestore.rules
git commit -m "feat(monitor): add staffSessionLog index + staffPresence/staffSessionLog rules"
```

---

### Task 9: Scheduled cleanup Cloud Function

**Files:**

- Create: `functions/api/staff-presence-cleanup.js`
- Modify: `functions/index.js` (register the export)

- [ ] **Step 1: Create the scheduled function**

Create `functions/api/staff-presence-cleanup.js`:

```js
/**
 * Scheduled jobs for Staff Monitor:
 *   1. closeStalePresences — every 2 min. For each staffPresence doc whose
 *      lastSeenAt is older than 5 min, append to staffSessionLog with
 *      endReason 'timeout' and delete the presence doc.
 *   2. pruneSessionLog — every Sunday 02:00 UTC. Deletes staffSessionLog
 *      docs whose loginAt is older than 90 days.
 */
const functions = require('firebase-functions')
const admin = require('firebase-admin')

if (!admin.apps.length) admin.initializeApp()
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const PRESENCE_COLLECTION = 'staffPresence'
const SESSION_LOG_COLLECTION = 'staffSessionLog'
const OFFLINE_THRESHOLD_MINUTES = 5
const HISTORY_RETENTION_DAYS = 90

function minutesBetween(startIso, endIso) {
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.round((end - start) / 60000)
}

exports.closeStalePresences = functions.pubsub
  .schedule('every 2 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const cutoffIso = new Date(Date.now() - OFFLINE_THRESHOLD_MINUTES * 60000).toISOString()
    const snap = await db.collection(PRESENCE_COLLECTION).where('lastSeenAt', '<', cutoffIso).get()

    if (snap.empty) {
      console.log('[closeStalePresences] nothing to close')
      return null
    }

    const batch = db.batch()
    const logCol = db.collection(SESSION_LOG_COLLECTION)
    const logoutAt = new Date().toISOString()

    snap.forEach((docSnap) => {
      const data = docSnap.data()
      const logRef = logCol.doc()
      batch.set(logRef, {
        userId: data.userId,
        userName: data.userName,
        role: data.role,
        branchId: data.branchId,
        sessionId: data.sessionId,
        loginAt: data.loginAt,
        logoutAt,
        durationMinutes: minutesBetween(data.loginAt, logoutAt),
        endReason: 'timeout',
        officialShiftId: null,
      })
      batch.delete(docSnap.ref)
    })

    await batch.commit()
    console.log(`[closeStalePresences] closed ${snap.size} stale presence(s)`)
    return null
  })

exports.pruneSessionLog = functions.pubsub
  .schedule('every sunday 02:00')
  .timeZone('UTC')
  .onRun(async () => {
    const cutoffIso = new Date(Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60_000).toISOString()
    const snap = await db.collection(SESSION_LOG_COLLECTION).where('loginAt', '<', cutoffIso).get()

    if (snap.empty) {
      console.log('[pruneSessionLog] nothing to prune')
      return null
    }

    // Firestore batch limit is 500 — chunk if needed.
    const docs = snap.docs
    for (let i = 0; i < docs.length; i += 450) {
      const batch = db.batch()
      docs.slice(i, i + 450).forEach((d) => batch.delete(d.ref))
      await batch.commit()
    }
    console.log(`[pruneSessionLog] pruned ${snap.size} old log entries`)
    return null
  })
```

- [ ] **Step 2: Register the exports**

Append to `functions/index.js`:

```js
const staffPresenceCleanup = require('./api/staff-presence-cleanup')
exports.closeStalePresences = staffPresenceCleanup.closeStalePresences
exports.pruneSessionLog = staffPresenceCleanup.pruneSessionLog
```

- [ ] **Step 3: Smoke-check with node syntax**

Run: `node --check functions/api/staff-presence-cleanup.js`
Expected: no output.

Run: `node --check functions/index.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add functions/api/staff-presence-cleanup.js functions/index.js
git commit -m "feat(monitor): add scheduled closeStalePresences + pruneSessionLog"
```

---

### Task 10: Monitor module — page skeleton

**Files:**

- Create: `src/pipeline/pages/modules/MonitorModule.tsx`

- [ ] **Step 1: Create the skeleton**

Create `src/pipeline/pages/modules/MonitorModule.tsx`:

```tsx
import { useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { useAuth } from '../../features/auth/auth-context'
import { useLocations } from '../../hooks/useLocations'
import { LiveRosterSection } from './monitor/LiveRosterSection'
import { SessionHistorySection } from './monitor/SessionHistorySection'

const MonitorModule = () => {
  const { session } = useAuth()
  const { enabledLocations } = useLocations()

  const allowedBranchIds = useMemo(
    () => enabledLocations.map((l) => l.branchId),
    [enabledLocations],
  )

  // Page is Owner/Admin only — defense in depth with the route guard.
  if (!session || (session.user.role !== 'Owner' && session.user.role !== 'Admin')) {
    return <Navigate replace to="/dashboard" />
  }

  return (
    <ModulePageLayout
      moduleTab="Monitor"
      title="Staff Monitor"
      subtitle="Live presence of operations staff and session-attendance history."
      breadcrumbs={['Pipeline', 'Monitor']}
    >
      <div className="space-y-6">
        <LiveRosterSection allowedBranchIds={allowedBranchIds} />
        <SessionHistorySection allowedBranchIds={allowedBranchIds} />
      </div>
    </ModulePageLayout>
  )
}

export default MonitorModule
```

- [ ] **Step 2: Type-check (will fail on the two section imports, that's expected)**

Run: `npx tsc --noEmit`
Expected: errors about missing LiveRosterSection/SessionHistorySection — fixed by next tasks.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/MonitorModule.tsx
git commit -m "feat(monitor): add MonitorModule skeleton"
```

---

### Task 11: LiveRosterSection

**Files:**

- Create: `src/pipeline/pages/modules/monitor/LiveRosterSection.tsx`

- [ ] **Step 1: Implement the live roster**

Create `src/pipeline/pages/modules/monitor/LiveRosterSection.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { staffPresenceApi } from '../../../api/staff-presence'
import { StaffPresenceRecord } from '../../../api/types'
import { branchIdToDisplayName } from '../../../../lib/locations'
import { logger } from '../../../../lib/logger'

const REFRESH_INTERVAL_MS = 30_000

function formatHHmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatElapsed(iso: string, nowMs: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const mins = Math.max(0, Math.round((nowMs - t) / 60_000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

const STATUS_DOT: Record<'online' | 'idle' | 'offline', string> = {
  online: 'bg-green-500',
  idle: 'bg-amber-400',
  offline: 'bg-gray-400',
}

export const LiveRosterSection = ({ allowedBranchIds }: { allowedBranchIds: string[] }) => {
  const [presence, setPresence] = useState<StaffPresenceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const rows = await staffPresenceApi.listLive()
      setPresence(rows)
    } catch (err) {
      logger.error('monitor.live_roster_load_failed', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(() => {
      load()
      setNowMs(Date.now())
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [load])

  const byBranch = useMemo(() => {
    const visible = presence.filter((p) => allowedBranchIds.includes(p.branchId))
    const map = new Map<string, StaffPresenceRecord[]>()
    for (const bid of allowedBranchIds) map.set(bid, [])
    for (const p of visible) {
      const arr = map.get(p.branchId) ?? []
      arr.push(p)
      map.set(p.branchId, arr)
    }
    return map
  }, [presence, allowedBranchIds])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Live Now</h3>
        {loading ? <span className="text-xs text-muted">Loading…</span> : null}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {allowedBranchIds.map((bid) => {
          const rows = byBranch.get(bid) ?? []
          const online = rows.filter(
            (r) => staffPresenceApi.deriveStatus(r.lastSeenAt, nowMs) === 'online',
          ).length
          return (
            <div key={bid} className="rounded-xl border border-border/60 bg-panel p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-text">{branchIdToDisplayName(bid)}</h4>
                <span className="text-xs text-muted">{online} online</span>
              </div>
              {rows.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted">No staff signed in.</p>
              ) : (
                <ul className="space-y-2">
                  {rows.map((r) => {
                    const status = staffPresenceApi.deriveStatus(r.lastSeenAt, nowMs)
                    return (
                      <li
                        key={r.userId}
                        className="flex items-center gap-3 rounded-lg border border-border/40 bg-surface px-3 py-2"
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} />
                        <span className="flex-1 truncate text-sm font-medium text-text">
                          {r.userName}
                        </span>
                        <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                          {r.role}
                        </span>
                        <span className="text-xs text-muted">{formatHHmm(r.loginAt)}</span>
                        <span className="w-14 text-right text-xs font-semibold text-text">
                          {formatElapsed(r.loginAt, nowMs)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only about missing SessionHistorySection (fixed next task).

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/monitor/LiveRosterSection.tsx
git commit -m "feat(monitor): add LiveRosterSection with branch grouping + 30s polling"
```

---

### Task 12: SessionHistorySection (filters + table + CSV)

**Files:**

- Create: `src/pipeline/pages/modules/monitor/SessionHistorySection.tsx`

- [ ] **Step 1: Implement the history section**

Create `src/pipeline/pages/modules/monitor/SessionHistorySection.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { staffPresenceApi } from '../../../api/staff-presence'
import {
  MONITORED_ROLES,
  MonitoredRole,
  StaffSessionEndReason,
  StaffSessionLogRecord,
} from '../../../api/types'
import { branchIdToDisplayName } from '../../../../lib/locations'
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable'
import { logger } from '../../../../lib/logger'

const SHORT_SESSION_MINUTES = 240 // 4h
const PAGE_SIZE = 50

const END_REASON_LABEL: Record<StaffSessionEndReason, string> = {
  explicit_signout: 'Sign-out',
  timeout: 'Timeout',
  new_session_replaced: 'New device',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN')
}

function formatHHmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

function toIsoStart(yyyyMmDd: string): string {
  return `${yyyyMmDd}T00:00:00.000Z`
}
function toIsoEnd(yyyyMmDd: string): string {
  return `${yyyyMmDd}T23:59:59.999Z`
}

function downloadCsv(rows: StaffSessionLogRecord[]): void {
  const header = [
    'Date',
    'Name',
    'Role',
    'Branch',
    'Login',
    'Logout',
    'Duration (min)',
    'End reason',
  ]
  const csv = [
    header.join(','),
    ...rows.map((r) =>
      [
        formatDate(r.loginAt),
        JSON.stringify(r.userName),
        r.role,
        JSON.stringify(branchIdToDisplayName(r.branchId)),
        formatHHmm(r.loginAt),
        formatHHmm(r.logoutAt),
        r.durationMinutes,
        END_REASON_LABEL[r.endReason],
      ].join(','),
    ),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `staff-sessions-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export const SessionHistorySection = ({ allowedBranchIds }: { allowedBranchIds: string[] }) => {
  const today = new Date().toISOString().slice(0, 10)
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [selectedRoles, setSelectedRoles] = useState<MonitoredRole[]>([...MONITORED_ROLES])
  const [selectedBranches, setSelectedBranches] = useState<string[]>(allowedBranchIds)
  const [shortOnly, setShortOnly] = useState(false)
  const [timeoutsOnly, setTimeoutsOnly] = useState(false)
  const [rows, setRows] = useState<StaffSessionLogRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await staffPresenceApi.queryHistory({
        fromDateIso: toIsoStart(fromDate),
        toDateIso: toIsoEnd(toDate),
        roles: selectedRoles.length > 0 ? selectedRoles : undefined,
        branchIds: selectedBranches.length > 0 ? selectedBranches : undefined,
      })
      setRows(result)
      setPage(1)
    } catch (err) {
      logger.error('monitor.history_load_failed', err)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate, selectedRoles, selectedBranches])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (shortOnly && r.durationMinutes >= SHORT_SESSION_MINUTES) return false
        if (timeoutsOnly && r.endReason !== 'timeout') return false
        return true
      }),
    [rows, shortOnly, timeoutsOnly],
  )

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  const columns: DataTableColumn<StaffSessionLogRecord>[] = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.loginAt) },
    { key: 'name', header: 'Name', render: (r) => r.userName },
    { key: 'role', header: 'Role', render: (r) => r.role },
    { key: 'branch', header: 'Branch', render: (r) => branchIdToDisplayName(r.branchId) },
    { key: 'login', header: 'Login', render: (r) => formatHHmm(r.loginAt) },
    { key: 'logout', header: 'Logout', render: (r) => formatHHmm(r.logoutAt) },
    { key: 'duration', header: 'Duration', render: (r) => formatDuration(r.durationMinutes) },
    { key: 'endReason', header: 'End', render: (r) => END_REASON_LABEL[r.endReason] },
  ]

  const toggleRole = (role: MonitoredRole) => {
    setSelectedRoles((cur) => (cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role]))
  }

  const toggleBranch = (bid: string) => {
    setSelectedBranches((cur) => (cur.includes(bid) ? cur.filter((b) => b !== bid) : [...cur, bid]))
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Session History</h3>
        <button
          type="button"
          onClick={() => downloadCsv(filtered)}
          disabled={filtered.length === 0}
          className="ui-btn ui-btn-neutral text-xs"
        >
          Export CSV
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/40 bg-panel p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">From</span>
          <input
            type="date"
            className="ui-field min-h-9"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">To</span>
          <input
            type="date"
            className="ui-field min-h-9"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {MONITORED_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => toggleRole(role)}
              className={`ui-btn min-h-7 px-2 text-[11px] ${
                selectedRoles.includes(role) ? 'ui-btn-info' : 'ui-btn-neutral'
              }`}
            >
              {role}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {allowedBranchIds.map((bid) => (
            <button
              key={bid}
              type="button"
              onClick={() => toggleBranch(bid)}
              className={`ui-btn min-h-7 px-2 text-[11px] ${
                selectedBranches.includes(bid) ? 'ui-btn-info' : 'ui-btn-neutral'
              }`}
            >
              {branchIdToDisplayName(bid)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={shortOnly}
            onChange={(e) => setShortOnly(e.target.checked)}
          />
          Short sessions only
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={timeoutsOnly}
            onChange={(e) => setTimeoutsOnly(e.target.checked)}
          />
          Timeouts only
        </label>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-muted">Loading…</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={paged}
            rowKey={(r) => r.id}
            emptyMessage="No sessions match the current filters."
          />
          {totalPages > 1 ? (
            <div className="flex items-center justify-end gap-2 text-xs text-muted">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="ui-btn ui-btn-neutral min-h-7 px-2 text-[11px]"
              >
                Prev
              </button>
              <span>
                Page {page} of {totalPages} · {filtered.length} total
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="ui-btn ui-btn-neutral min-h-7 px-2 text-[11px]"
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/monitor/SessionHistorySection.tsx
git commit -m "feat(monitor): add SessionHistorySection with filters, flags, CSV"
```

---

### Task 13: Add `/monitor` route + nav tab

**Files:**

- Modify: `src/pipeline/app/router.tsx`
- Modify: `src/pipeline/features/navigation/module-manifest.ts`
- Modify: `src/pipeline/api/types.ts` (`ModuleTab` union)

- [ ] **Step 1: Extend `ModuleTab` union**

In `src/pipeline/api/types.ts`, find `export type ModuleTab =` and add `'Monitor'` to the union alongside existing values.

- [ ] **Step 2: Add the route**

In `src/pipeline/app/router.tsx`, add (near other top-level module routes):

```tsx
<Route
  path="/monitor"
  element={
    <ProtectedRoute>
      <MonitorModule />
    </ProtectedRoute>
  }
/>
```

Add the import at the top:

```tsx
import MonitorModule from '../pages/modules/MonitorModule'
```

- [ ] **Step 3: Add Monitor to NAV_TABS and the Owner/Admin role-tabs**

In `src/pipeline/features/navigation/module-manifest.ts`:

Inside the `NAV_TABS` array, add (position it alphabetically or next to Incentives — use existing style):

```ts
{ id: 'Monitor', label: 'Monitor', path: '/monitor' },
```

Inside the role-tabs map, add `'Monitor'` to the `tabs:` array of the `Owner` and `Admin` entries only.

In the `getTabForPath` function, add:

```ts
if (pathname.startsWith('/monitor')) return 'Monitor'
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/app/router.tsx src/pipeline/features/navigation/module-manifest.ts src/pipeline/api/types.ts
git commit -m "feat(monitor): add /monitor route and Monitor nav tab for Owner/Admin"
```

---

### Task 14: End-to-end smoke verification

**Files:** none (manual verification against running dev server)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: tsc + vite build complete without errors.

- [ ] **Step 2: Run all tests**

Run: `npm run test:run`
Expected: full suite green (new tests from Tasks 2, 4, 6 all pass).

- [ ] **Step 3: Dev server sanity check**

Run: `npm run dev`

Open the app, sign in as an Owner. Verify:

- "Monitor" tab appears in the top nav.
- Clicking it lands on `/monitor` with Live Now + Session History sections visible.
- Live Now shows one entry per branch, initially empty (no other users signed in on the dev env).

Sign in as a Cashier in a second browser profile. Within 60 seconds, refresh the Owner's Monitor tab and verify the Cashier appears under their branch with status `online`.

Click Sign Out on the Cashier browser. Within 30 seconds, Owner's Monitor tab should drop the Cashier from Live Now. Scroll to Session History — verify a new row appears with `End: Sign-out`, correct login/logout times, and computed duration.

- [ ] **Step 4: Commit any last notes/tweaks (if needed) and tag**

If verification uncovered anything: fix, commit. Otherwise:

```bash
git tag staff-monitor-v1
```

---

## Self-Review

- **Spec coverage:** every section of the spec — placement, access, two-collection data model, heartbeat interval/idle/offline thresholds, three endReasons, scheduled timeout, weekly prune, Owner/Admin branch scoping, Live Now card grid, Session History filters, row flags for short/timeout, CSV export, composite index, Firestore rules — is covered by a task.
- **Placeholder scan:** no "TBD", no "add appropriate error handling", no "similar to Task N" shortcuts. Every code block is complete.
- **Type consistency:** `MonitoredRole`, `StaffPresenceRecord`, `StaffSessionLogRecord`, `StaffSessionEndReason`, `PresenceStatus`, `HistoryQueryInput`, `StartPresenceInput` names are consistent across files where they appear.
- **Function signatures:** `staffPresenceApi.start/heartbeat/close/listLive/queryHistory/deriveStatus/buildHistoryConstraints` match between the firestore module and the facade. Hook calls `start`, `heartbeat`, `close` and auth context calls `close` — all match. History section calls `queryHistory` which returns `StaffSessionLogRecord[]` — matches the Firestore layer output.
- **Rollout item from spec** ("feature flag `monitor.enabled`") is explicitly out of scope in v1 — the spec noted it, the plan does not add one. If you want a flag, open a follow-up.
