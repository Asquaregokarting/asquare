# Staff Monitor — design

_2026-04-24_

## Summary

A new top-level "Monitor" tab in the pipeline admin that gives Owner and Admin a single place to see two things:

1. **Live roster** — who among the operations staff is signed in right now, which branch, how long they've been active.
2. **Session history** — an append-only log of past login/logout sessions, filterable by date / role / branch, with CSV export for attendance audits.

Scope is restricted to four operations roles: **Telecaller**, **Cashier**, **Incharge**, **TrackMarshall**. Owners, Admins, Developer, Backend, Editor, and ThirdParty are not monitored.

Signals of presence:

- **Heartbeat** — client pings Firestore every 60s while the tab is open. This is the primary signal; it catches the common case of staff closing the browser without clicking Sign Out.
- **Official shift** (supplementary) — TrackMarshall shifts (`trackMarshallShifts/*`) and cashier shifts already exist. Session log rows link to the official shift when one was active, so the history view shows discipline (did they start a proper shift and close it?).

## Non-goals

- No force-logout / remote-revoke buttons.
- No email / push alerts. Row-level visual flags only.
- No "expected shift start" tracking. We don't have a central shift schedule yet, so we can't flag late arrivals. Revisit when that source exists.
- Incharge-level visibility (each Incharge monitors their own branch) is deferred — Owner and Admin only for v1.

## Placement and access

- New top-level nav tab **"Monitor"** (route `/monitor`), appearing after "Incentives" in [module-manifest.ts](../../../src/pipeline/features/navigation/module-manifest.ts).
- Visible only to Owner and Admin. Enforced in the manifest role map (so the tab is hidden) and in the page guard (`MonitorModule` redirects non-Owner/Admin to `/dashboard`). Firestore rules currently gate only on authentication (`request.auth != null`) — matching the project-wide convention — not on role; see the rules TODO above.
- Admin users see only the branches listed in their `allowedLocations`. Owners see all five.

## Data model

Two new Firestore collections in `asquare-app-db`.

### `staffPresence/{userId}`

One doc per currently-active staff member. Size stays bounded to ~50 docs (total head count). Read as a whole on every Monitor page open.

```
interface StaffPresenceRecord {
  userId: string
  userName: string
  role: 'Telecaller' | 'Cashier' | 'Incharge' | 'TrackMarshall'
  branchId: string        // canonical branchId (normalized via normalizeLocationId)
  sessionId: string       // deviceSessions/{id} that owns this presence
  loginAt: string         // ISO timestamp, set once at session start
  lastSeenAt: string      // ISO timestamp, refreshed every 60s by the client
  status: 'online' | 'idle' | 'offline'   // derived at read time from lastSeenAt
  explicitLogoutAt: string | null          // set when user clicks Sign Out
}
```

`status` is not stored — it is derived from `lastSeenAt` on the client:

- `now - lastSeenAt < 2 min` → `online`
- `2 min ≤ now - lastSeenAt < 5 min` → `idle`
- `now - lastSeenAt ≥ 5 min` → `offline` (the scheduled cleanup function will shortly move this doc to the log)

### `staffSessionLog/{autoId}`

Append-only history of completed sessions. Pruned to 90 days rolling by a weekly scheduled function.

```
interface StaffSessionLogRecord {
  id: string
  userId: string
  userName: string
  role: 'Telecaller' | 'Cashier' | 'Incharge' | 'TrackMarshall'
  branchId: string
  sessionId: string
  loginAt: string
  logoutAt: string
  durationMinutes: number
  endReason: 'explicit_signout' | 'timeout' | 'new_session_replaced'
  officialShiftId: string | null   // links to trackMarshallShifts or cashierShifts
}
```

Required composite index (add to [firestore.indexes.json](../../../firestore.indexes.json)):

```
collection: staffSessionLog
fields: role (asc), branchId (asc), loginAt (desc)
```

## Lifecycle

### Login

1. User authenticates normally (existing auth flow, unchanged).
2. **`useStaffPresenceHeartbeat()`** hook mounts if `user.role ∈ {Telecaller, Cashier, Incharge, TrackMarshall}`.
3. The hook writes `staffPresence/{userId}` with `loginAt = now`, `lastSeenAt = now`, `sessionId = getStoredSessionId()`.
4. If a presence doc already exists for the same user (e.g. stale from a previous device), the existing one is first closed to the log with `endReason: 'new_session_replaced'`.

### Active session

- Every 60 seconds, the hook writes `lastSeenAt = now` on the presence doc.
- Exponential backoff on Firestore write failure: 60s → 120s → 300s, then level off at 300s. A dropped heartbeat must not crash the monitored tab.
- On `document.visibilityState` change to `visible`, the hook fires one immediate heartbeat (catches users returning from a background tab before they'd otherwise be marked idle).

### Explicit sign-out

1. The existing sign-out path calls `closeStaffPresence(userId, 'explicit_signout')`.
2. That helper writes a `staffSessionLog` entry with current `lastSeenAt` as `logoutAt`, computes `durationMinutes`, looks up any active `trackMarshallShifts` / `cashierShifts` for this user/branch to populate `officialShiftId`.
3. Then deletes the `staffPresence/{userId}` doc.

### Timeout cleanup (scheduled function)

- Runs every 2 minutes.
- Query: `staffPresence where lastSeenAt < now - 5 min`.
- For each hit: append to `staffSessionLog` with `endReason: 'timeout'`, delete the presence doc.

### History pruning (scheduled function)

- Runs weekly (Sunday 02:00 UTC).
- Deletes `staffSessionLog` docs where `loginAt < now - 90 days`.

## UI

### `MonitorModule.tsx`

`ModulePageLayout` with `moduleTab="Monitor"`, title `"Staff Monitor"`, breadcrumbs `['Pipeline', 'Monitor']`.

No sub-nav — the page is a single scrollable view with two sections.

#### Section 1 — "Live Now"

- One card per branch the viewer can see. Grid, 2 columns on desktop.
- Card header: branch display name · count of online staff.
- Card body: table-like rows — avatar/initial, name, role chip, status dot (green/yellow/grey for online/idle/offline), login time (HH:mm), elapsed time ("2h 14m"), any relevant official-shift chip.
- Auto-refreshing every 30s via a simple `setInterval`; no need for Firestore `onSnapshot` — avoids leaving open realtime listeners when the viewer navigates away.
- Empty state per branch: "No staff signed in."

#### Section 2 — "Session History"

- Filter row: date range (default: today), role multi-select, branch multi-select (Admin sees only their allowed branches), "Short sessions only" toggle, "Include timeouts only" toggle.
- DataTable rows: Date · Name · Role · Branch · Login (HH:mm) · Logout (HH:mm) · Duration (e.g. "3h 12m") · End reason chip · Official shift link chip (if present).
- **Row flags (visual only)**:
  - Red left border and faint red background when `durationMinutes < 240` (under 4 hours — "short session").
  - Grey when `endReason === 'timeout'` (walked away without clicking Sign Out).
- Pagination: 50 rows per page, server-side via Firestore cursor queries.
- **CSV export** button downloads all rows matching the current filters (not just the visible page). Columns mirror the on-screen columns.

## Files touched

| File                                                      | Change                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pipeline/api/staff-presence-firestore.ts`            | **new** — Firestore CRUD for both collections                                                                                                                                                                                                                  |
| `src/pipeline/api/staff-presence.ts`                      | **new** — public API facade (`heartbeat`, `closeSession`, `listLiveRoster`, `queryHistory`)                                                                                                                                                                    |
| `src/pipeline/features/auth/useStaffPresenceHeartbeat.ts` | **new** — client heartbeat hook                                                                                                                                                                                                                                |
| `src/pipeline/pages/modules/MonitorModule.tsx`            | **new** — the page                                                                                                                                                                                                                                             |
| `src/pipeline/features/auth/auth-context.tsx`             | hook mounted here; call `closeStaffPresence` in the sign-out path                                                                                                                                                                                              |
| `src/pipeline/app/router.tsx`                             | add `/monitor` route                                                                                                                                                                                                                                           |
| `src/pipeline/features/navigation/module-manifest.ts`     | add `Monitor` to `NAV_TABS` + role map for Owner/Admin                                                                                                                                                                                                         |
| `src/pipeline/api/types.ts`                               | add `StaffPresenceRecord` + `StaffSessionLogRecord`                                                                                                                                                                                                            |
| `functions/src/scheduled/staff-presence-cleanup.ts`       | **new** — 2-min timeout sweep + weekly history prune                                                                                                                                                                                                           |
| `firestore.indexes.json`                                  | new composite index on `staffSessionLog(role, branchId, loginAt desc)`                                                                                                                                                                                         |
| `firestore.rules`                                         | Currently gates only on `request.auth != null` (matching project-wide convention — the app uses anonymous Firebase Auth with mock JWTs; `request.auth.token.role` is not populated). TODO: tighten to Owner/Admin-only reads once custom JWT claims are wired. |

## Testing

- **Unit**: session lifecycle transitions (login creates presence, heartbeat refreshes, sign-out closes to log, timeout closes to log, duplicate-login replaces). Test in isolation via pure functions returning intended Firestore ops, not by running against Firestore.
- **Integration**: hook mounts for monitored roles only; unmount fires one final heartbeat so tab-close within 60s still produces a recent `lastSeenAt`.
- **E2E** (out of scope for v1): Playwright test that logs in as a Cashier, waits 70 seconds, checks presence doc exists; calls sign-out, verifies log entry.

## Rollout

1. Ship code behind a Firestore feature flag `monitor.enabled = false`. Hook and page both no-op when off.
2. Turn on in staging. Leave for 48 hours to collect heartbeat data.
3. Audit the log data against physical attendance from one branch for one week.
4. Turn on in production. Communicate to staff that their sessions are being tracked.

## Open follow-ups (explicitly deferred)

- Incharge-level visibility per branch.
- Expected shift-time schedule and late-arrival flags.
- Alerts / push notifications on short sessions.
- Aggregate attendance report (hours per staff per month).
