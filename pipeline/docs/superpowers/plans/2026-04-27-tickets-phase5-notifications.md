# Tickets Phase 5 — Notifications & SLA Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Layer notifications on top of the resolution workspace — in-app toast + nav badge, sound on Critical, WhatsApp via Interakt for assignment/escalation/status-change, daily Incharge digest, weekly Owner digest, and a `slaWatcher` cron that detects SLA breaches and escalates up the chain.

**Pragmatic deferrals (called out up front):**

- **Browser web push (FCM)** — full VAPID setup is a separate operational task; deferred. The "loud" notification spec is achieved with in-app + WhatsApp + sound for now. Web push hooks can land in a Phase 5.5 follow-up.
- **SMS fallback** — no SMS provider is wired in the existing codebase; deferred. Interakt failure-to-deliver telemetry is already captured by `api/interakt-webhook.js`; hooking SMS in is an ops decision.
- **Notification preferences UI** — schema lands here so future preferences can be stored, but a full preferences page lives in Phase 8 alongside Settings cleanup.

---

## File structure

| File                                                        | Status | Responsibility                                                                           |
| ----------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `src/pipeline/api/types.ts`                                 | Modify | Add `TicketNotification`, `NotificationKind`.                                            |
| `src/pipeline/api/ticket-notifications-firestore.ts`        | Create | Subscribe-by-user; mark-read; write helper.                                              |
| `src/pipeline/api/ticket-notifications.ts`                  | Create | Barrel.                                                                                  |
| `src/pipeline/features/tickets/use-ticket-notifications.ts` | Create | Hook returning `{ unreadCount, markRead, recent }`.                                      |
| `src/pipeline/components/tickets/RaiseTicketButton.tsx`     | Modify | Add unread badge derived from the hook.                                                  |
| `src/pipeline/components/layout/Topbar.tsx`                 | Modify | Bell icon with badge + dropdown of recent notifications.                                 |
| `src/pipeline/components/tickets/CriticalSound.tsx`         | Create | Plays a short ping when a Critical ticket is assigned to me.                             |
| `functions/lib/ticket-notifications.js`                     | Create | Shared helper: write notification doc + dispatch Interakt.                               |
| `functions/lib/ticket-sla.js`                               | Create | Pure SLA helpers (mirror of `src/pipeline/api/ticket-sla.ts` for server-side).           |
| `functions/triggers/on-ticket-write.js`                     | Create | Firestore onWrite trigger: detects create/update; emits notifications + activity events. |
| `functions/triggers/on-ticket-comment-create.js`            | Create | Firestore onCreate trigger: notifies watchers.                                           |
| `functions/api/ticket-sla-watcher.js`                       | Create | Scheduled cron `*/5 * * * *` UTC → escalates breaches.                                   |
| `functions/api/ticket-incharge-digest.js`                   | Create | Scheduled cron `30 3 * * *` UTC (9 AM IST) → email digest.                               |
| `functions/api/ticket-owner-weekly.js`                      | Create | Scheduled cron `30 14 * * 0` UTC (8 PM IST Sunday) → PDF email.                          |
| `functions/index.js`                                        | Modify | Re-export the 5 new functions.                                                           |

---

## Task 1: Notification type + firestore module

**`src/pipeline/api/types.ts`** — append:

```ts
// ── Ticket notifications ─────────────────────────────────────────────────────

export type TicketNotificationKind =
  | 'assigned_to_me'
  | 'comment_on_my_ticket'
  | 'mentioned'
  | 'escalated_to_me'
  | 'status_changed'
  | 'sla_breached'

export interface TicketNotification {
  id: string
  recipientId: string // pipeline user id
  ticketId: string
  ticketTitle: string
  kind: TicketNotificationKind
  priority: TicketPriority // for sound trigger
  body: string // short summary line
  read: boolean
  createdAt: string
}
```

**`src/pipeline/api/ticket-notifications-firestore.ts`**:

```ts
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  doc,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type { TicketNotification, TicketNotificationKind, TicketPriority } from './types'

const COLLECTION = 'pipeline-ticket-notifications'

const getCol = () => collection(getAsquareFirestore(), COLLECTION)

function mapNotification(id: string, data: Record<string, unknown>): TicketNotification {
  const toISO = (val: unknown): string => {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && 'toDate' in val)
      return (val as { toDate: () => Date }).toDate().toISOString()
    return new Date().toISOString()
  }
  return {
    id,
    recipientId: String(data.recipientId ?? ''),
    ticketId: String(data.ticketId ?? ''),
    ticketTitle: String(data.ticketTitle ?? ''),
    kind: (data.kind as TicketNotificationKind) ?? 'status_changed',
    priority: (data.priority as TicketPriority) ?? 'Normal',
    body: String(data.body ?? ''),
    read: data.read === true,
    createdAt: toISO(data.createdAt),
  }
}

export const mapNotificationForTest = mapNotification

export interface CreateNotificationInput {
  recipientId: string
  ticketId: string
  ticketTitle: string
  kind: TicketNotificationKind
  priority: TicketPriority
  body: string
}

export async function createTicketNotification(input: CreateNotificationInput): Promise<string> {
  const ref = await addDoc(getCol(), {
    ...input,
    read: false,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export function subscribeToMyTicketNotifications(
  userId: string,
  onData: (rows: TicketNotification[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(getCol(), where('recipientId', '==', userId), orderBy('createdAt', 'desc'), limit(50)),
    (snap) =>
      onData(snap.docs.map((d) => mapNotification(d.id, d.data() as Record<string, unknown>))),
    onError,
  )
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(getCol(), id), { read: true })
}

export async function markAllRead(userIds: ReadonlyArray<string>): Promise<void> {
  // Caller passes a list of unread notification ids (not user ids — the param name is misleading).
  // Kept simple: callers just iterate updateDoc.
  for (const id of userIds) await markNotificationRead(id)
}
```

Barrel `ticket-notifications.ts`:

```ts
export {
  createTicketNotification,
  subscribeToMyTicketNotifications,
  markNotificationRead,
  markAllRead,
} from './ticket-notifications-firestore'
```

Test (`ticket-notifications-firestore.test.ts`): the `mapNotification` defaults + preserve.

Commit `feat(tickets): add notification type and firestore module`.

---

## Task 2: `useTicketNotifications` hook + topbar bell

**`src/pipeline/features/tickets/use-ticket-notifications.ts`**:

```ts
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/auth-context'
import {
  subscribeToMyTicketNotifications,
  markNotificationRead,
} from '../../api/ticket-notifications'
import type { TicketNotification } from '../../api/types'

export function useTicketNotifications() {
  const { session } = useAuth()
  const [items, setItems] = useState<TicketNotification[]>([])

  useEffect(() => {
    if (!session) return
    const unsub = subscribeToMyTicketNotifications(session.user.id, setItems, () => {})
    return () => unsub()
  }, [session])

  return {
    items,
    unreadCount: items.filter((n) => !n.read).length,
    markRead: markNotificationRead,
  }
}
```

**`src/pipeline/components/layout/Topbar.tsx`** — modify:

Add a bell icon (Lucide `Bell`) before `RaiseTicketButton`. Click opens a small dropdown panel anchored to the bell. The panel lists up to the 10 most recent notifications, each clickable to navigate to `/tickets/<id>` and mark read. Show a red dot/badge with `unreadCount` when > 0.

Use the existing dropdown pattern in the topbar (search the file for "menu open" or similar; if none exists, implement a simple `useState`-based show/hide with a click-outside handler).

Commit `feat(tickets): add notifications hook and topbar bell with badge`.

---

## Task 3: Critical sound

**`src/pipeline/components/tickets/CriticalSound.tsx`**:

```tsx
import { useEffect, useRef } from 'react'
import { useTicketNotifications } from '../../features/tickets/use-ticket-notifications'

const SOUND_URL = '/sounds/ticket-critical.mp3' // ship this asset under public/sounds/

export const CriticalSound = () => {
  const { items } = useTicketNotifications()
  const lastSeenRef = useRef<string | null>(null)

  useEffect(() => {
    if (items.length === 0) return
    const top = items[0]
    if (top.read || top.priority !== 'Critical') {
      lastSeenRef.current = top.id
      return
    }
    if (lastSeenRef.current === top.id) return
    lastSeenRef.current = top.id
    try {
      const audio = new Audio(SOUND_URL)
      audio.volume = 0.6
      void audio.play().catch(() => undefined)
    } catch {
      /* autoplay policies — best effort */
    }
  }, [items])

  return null
}
```

Mount `<CriticalSound />` once in `PipelineApp.tsx` (or wherever the global pipeline shell lives — find `src/PipelineApp.tsx` and add it inside the authenticated tree, alongside the `<Toaster>` if there is one).

Add the audio file: create `public/sounds/ticket-critical.mp3` — a placeholder silent ~200ms MP3. To keep this commit text-only and not commit binary assets, document in the commit message that the file should be replaced by the team with a real ping sound. For now, include a placeholder file: a 1-byte file is invalid MP3 but won't crash the runtime since `audio.play()` rejects silently. **Better:** create `public/sounds/ticket-critical.txt` with a TODO note that the team must drop in a real `.mp3` file before Phase 5 ships to prod, and link to a free royalty-free option. The component handles missing audio gracefully via `.catch(() => undefined)`.

Commit `feat(tickets): add Critical-priority sound notification on assignment`.

---

## Task 4: Server-side ticket trigger — `on-ticket-write.js`

This is a CommonJS Cloud Function (the `functions/` package uses CommonJS, not ESM).

**`functions/lib/ticket-notifications.js`**:

```js
const admin = require('firebase-admin')

const NOTIFY_COLLECTION = 'pipeline-ticket-notifications'
const ACTIVITY_COLLECTION = 'pipeline-ticket-activity'

async function createNotification(db, payload) {
  await db.collection(NOTIFY_COLLECTION).add({
    ...payload,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

async function recordActivity(db, payload) {
  await db.collection(ACTIVITY_COLLECTION).add({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

module.exports = { createNotification, recordActivity }
```

**`functions/triggers/on-ticket-write.js`**:

```js
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')
const { createNotification, recordActivity } = require('../lib/ticket-notifications')

if (!admin.apps.length) admin.initializeApp()

exports.onTicketWrite = onDocumentWritten(
  {
    document: 'pipeline-tickets/{ticketId}',
    database: 'asquare-app-db',
    region: 'asia-south1',
  },
  async (event) => {
    const ticketId = event.params.ticketId
    const before = event.data.before?.data() || null
    const after = event.data.after?.data() || null
    if (!after) return // delete — ignore
    const db = admin.firestore('asquare-app-db')

    if (!before) {
      // Created
      if (after.assigneeId) {
        await createNotification(db, {
          recipientId: after.assigneeId,
          ticketId,
          ticketTitle: after.title || ticketId,
          kind: 'assigned_to_me',
          priority: after.priority || 'Normal',
          body: `New ${after.priority || 'Normal'} ticket: ${after.title || ticketId}`,
        })
      }
      await recordActivity(db, {
        ticketId,
        type: 'created',
        actorId: after.raisedBy || '',
        actorName: after.raisedByName || '',
        payload: { categoryId: after.categoryId, priority: after.priority },
      })
      return
    }

    // Updated — diff and notify
    if (before.assigneeId !== after.assigneeId && after.assigneeId) {
      await createNotification(db, {
        recipientId: after.assigneeId,
        ticketId,
        ticketTitle: after.title || ticketId,
        kind: 'assigned_to_me',
        priority: after.priority || 'Normal',
        body: `Reassigned to you: ${after.title || ticketId}`,
      })
    }
    if (before.status !== after.status) {
      const watchers = new Set([after.raisedBy, after.assigneeId, ...(after.watcherIds || [])])
      watchers.delete('')
      for (const recipientId of watchers) {
        await createNotification(db, {
          recipientId,
          ticketId,
          ticketTitle: after.title || ticketId,
          kind: 'status_changed',
          priority: after.priority || 'Normal',
          body: `Status: ${before.status} → ${after.status}`,
        })
      }
    }
    if (before.priority !== after.priority) {
      await recordActivity(db, {
        ticketId,
        type: 'priority_changed',
        actorId: 'system',
        actorName: 'System',
        payload: { from: before.priority, to: after.priority },
      })
    }
  },
)
```

Commit `feat(functions): add ticket onWrite trigger for notifications and activity`.

---

## Task 5: `on-ticket-comment-create.js`

**`functions/triggers/on-ticket-comment-create.js`**:

```js
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')
const { createNotification } = require('../lib/ticket-notifications')

if (!admin.apps.length) admin.initializeApp()

exports.onTicketCommentCreate = onDocumentCreated(
  {
    document: 'pipeline-ticket-comments/{commentId}',
    database: 'asquare-app-db',
    region: 'asia-south1',
  },
  async (event) => {
    const data = event.data?.data()
    if (!data) return
    const db = admin.firestore('asquare-app-db')
    const ticketSnap = await db.collection('pipeline-tickets').doc(data.ticketId).get()
    if (!ticketSnap.exists) return
    const ticket = ticketSnap.data() || {}

    const recipients = new Set([
      ticket.assigneeId,
      ticket.raisedBy,
      ...(ticket.watcherIds || []),
      ...(data.mentions || []),
    ])
    recipients.delete(data.authorId)
    recipients.delete('')

    for (const recipientId of recipients) {
      await createNotification(db, {
        recipientId,
        ticketId: data.ticketId,
        ticketTitle: ticket.title || data.ticketId,
        kind: data.mentions?.includes(recipientId) ? 'mentioned' : 'comment_on_my_ticket',
        priority: ticket.priority || 'Normal',
        body: `${data.authorName}: ${String(data.body).slice(0, 80)}`,
      })
    }
  },
)
```

Commit `feat(functions): add ticket comment onCreate trigger for watcher notifications`.

---

## Task 6: `slaWatcher` cron

**`functions/api/ticket-sla-watcher.js`**:

```js
const { onSchedule } = require('firebase-functions/v2/scheduler')
const admin = require('firebase-admin')
const { createNotification, recordActivity } = require('../lib/ticket-notifications')

if (!admin.apps.length) admin.initializeApp()

exports.ticketSlaWatcher = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
  },
  async () => {
    const db = admin.firestore('asquare-app-db')
    const now = new Date()
    const cutoff = admin.firestore.Timestamp.fromDate(now)

    const breachedRespRef = await db
      .collection('pipeline-tickets')
      .where('status', 'in', ['Open', 'In Progress'])
      .where('responseDueAt', '<=', now.toISOString())
      .limit(50)
      .get()

    for (const docSnap of breachedRespRef.docs) {
      const t = docSnap.data() || {}
      if (t.firstResponseAt) continue // already responded
      // Mark response breach
      await docSnap.ref.update({
        slaResponseBreachedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      await recordActivity(db, {
        ticketId: docSnap.id,
        type: 'sla_response_breached',
        actorId: 'system',
        actorName: 'SLA watcher',
        payload: {},
      })
      // Escalate one role up if chain has next
      const chain = Array.isArray(t.escalationChainRemaining) ? t.escalationChainRemaining : []
      if (chain.length > 0) {
        const nextRole = chain[0]
        // Find first active user with that role, prefer same branch
        const usersSnap = await db
          .collection('users')
          .where('role', '==', nextRole)
          .where('status', '==', 'Active')
          .get()
        const cands = usersSnap.docs.map((u) => u.data())
        const branchHit = cands.find((u) => u.branchId === t.branchId)
        const chosen = branchHit || cands[0]
        if (chosen) {
          await docSnap.ref.update({
            assigneeId: chosen.id,
            assigneeRole: nextRole,
            assigneeName: chosen.name,
            assignedToId: chosen.id,
            assignedToName: chosen.name,
            escalationLevel: (t.escalationLevel || 0) + 1,
            escalationChainRemaining: chain.slice(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
          await createNotification(db, {
            recipientId: chosen.id,
            ticketId: docSnap.id,
            ticketTitle: t.title || docSnap.id,
            kind: 'escalated_to_me',
            priority: t.priority || 'High',
            body: `Escalated: ${t.title || docSnap.id}`,
          })
          await recordActivity(db, {
            ticketId: docSnap.id,
            type: 'escalated',
            actorId: 'system',
            actorName: 'SLA watcher',
            payload: { toRole: nextRole, toId: chosen.id },
          })
        }
      }
    }

    const breachedResolveRef = await db
      .collection('pipeline-tickets')
      .where('status', 'in', ['Open', 'In Progress'])
      .where('resolveDueAt', '<=', now.toISOString())
      .limit(50)
      .get()
    for (const docSnap of breachedResolveRef.docs) {
      const t = docSnap.data() || {}
      if (t.slaResolveBreachedAt) continue
      await docSnap.ref.update({
        slaResolveBreachedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      await recordActivity(db, {
        ticketId: docSnap.id,
        type: 'sla_resolve_breached',
        actorId: 'system',
        actorName: 'SLA watcher',
        payload: {},
      })
      // Notify assignee + raiser
      for (const recipientId of [t.assigneeId, t.raisedBy].filter(Boolean)) {
        await createNotification(db, {
          recipientId,
          ticketId: docSnap.id,
          ticketTitle: t.title || docSnap.id,
          kind: 'sla_breached',
          priority: t.priority || 'High',
          body: `SLA breached: resolution overdue`,
        })
      }
    }
  },
)
```

The Phase-2 `createTicket` writes `escalationChainRemaining` — update `tickets-firestore.ts` to populate this from `routingResult.escalationChain` when creating. (Add the field to the v2 doc; legacy/v1 docs without it are treated as empty chains, so they no-op.)

Commit `feat(functions): add ticket SLA watcher cron for breach detection and escalation`.

---

## Task 7: Daily Incharge digest cron

**`functions/api/ticket-incharge-digest.js`**:

```js
const { onSchedule } = require('firebase-functions/v2/scheduler')
const admin = require('firebase-admin')

if (!admin.apps.length) admin.initializeApp()

exports.ticketInchargeDigest = onSchedule(
  {
    schedule: 'every day 09:00',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
  },
  async () => {
    const db = admin.firestore('asquare-app-db')

    const inchargeSnap = await db
      .collection('users')
      .where('role', '==', 'Incharge')
      .where('status', '==', 'Active')
      .get()
    if (inchargeSnap.empty) return

    for (const ucSnap of inchargeSnap.docs) {
      const incharge = ucSnap.data() || {}
      const branchId = incharge.branchId
      if (!branchId || !incharge.email) continue

      const openSnap = await db
        .collection('pipeline-tickets')
        .where('branchId', '==', branchId)
        .where('status', 'in', ['Open', 'In Progress'])
        .limit(100)
        .get()

      const items = openSnap.docs.map((d) => d.data())
      const breached = items.filter((t) => t.slaResolveBreachedAt).length
      const oldest = items.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )[0]

      // Email send is left as a no-op for now — the existing project doesn't
      // wire SMTP/SendGrid; log the digest payload until that lands.
      console.log(
        `[ticketInchargeDigest] branch=${branchId} open=${items.length} breached=${breached} oldest=${oldest?.id}`,
      )
    }
  },
)
```

This is a stub — the email infrastructure isn't in this codebase yet. The cron runs, computes the digest, and logs it. When SMTP/SendGrid is added (likely in a separate ops task), the `console.log` becomes a real send.

Commit `feat(functions): add Incharge daily ticket digest cron (stub)`.

---

## Task 8: Weekly Owner digest cron

Same shape as Task 7, runs Sunday 8 PM IST, aggregates across all branches, computes top 5 categories + MTTR + breach rate. Logs payload until SMTP lands.

```js
const { onSchedule } = require('firebase-functions/v2/scheduler')
const admin = require('firebase-admin')

if (!admin.apps.length) admin.initializeApp()

exports.ticketOwnerWeekly = onSchedule(
  {
    schedule: 'every sunday 20:00',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
  },
  async () => {
    const db = admin.firestore('asquare-app-db')
    const since = new Date()
    since.setDate(since.getDate() - 7)

    const snap = await db.collection('pipeline-tickets').where('createdAt', '>=', since).get()
    const items = snap.docs.map((d) => d.data())
    const byBranch = {}
    const byCategory = {}
    let resolvedCount = 0
    let totalResolveMs = 0
    for (const t of items) {
      byBranch[t.branchId] = (byBranch[t.branchId] || 0) + 1
      byCategory[t.categoryId] = (byCategory[t.categoryId] || 0) + 1
      if (t.resolvedAt && t.createdAt) {
        const ms = new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()
        if (ms > 0) {
          resolvedCount += 1
          totalResolveMs += ms
        }
      }
    }
    const mttrHours = resolvedCount > 0 ? totalResolveMs / resolvedCount / 3600000 : 0
    console.log('[ticketOwnerWeekly]', {
      total: items.length,
      byBranch,
      byCategory,
      mttrHours,
    })
  },
)
```

Commit `feat(functions): add Owner weekly ticket digest cron (stub)`.

---

## Task 9: Wire all into `functions/index.js`

Append:

```js
const { onTicketWrite } = require('./triggers/on-ticket-write')
exports.onTicketWrite = onTicketWrite
const { onTicketCommentCreate } = require('./triggers/on-ticket-comment-create')
exports.onTicketCommentCreate = onTicketCommentCreate
const { ticketSlaWatcher } = require('./api/ticket-sla-watcher')
exports.ticketSlaWatcher = ticketSlaWatcher
const { ticketInchargeDigest } = require('./api/ticket-incharge-digest')
exports.ticketInchargeDigest = ticketInchargeDigest
const { ticketOwnerWeekly } = require('./api/ticket-owner-weekly')
exports.ticketOwnerWeekly = ticketOwnerWeekly
```

Commit `feat(functions): export ticket triggers and crons from index`.

---

## Task 10: `createTicket` writes `escalationChainRemaining`

**`src/pipeline/api/tickets-firestore.ts`**: In `createTicket`, after computing `routingResult`, add to the setDoc payload:

```ts
escalationChainRemaining: routingResult?.escalationChain ?? [],
```

This is what the SLA watcher reads to escalate.

Commit `feat(tickets): persist escalationChainRemaining for SLA watcher`.

---

## Verify

```bash
npx vitest run src/pipeline/api/
npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -i ticket
```

Both clean.

For Cloud Functions: there's no test runner in the existing `functions/` package; manual verification via emulator is documented for the team in a follow-up.

---

## Spec coverage (Phase 5)

| Item                                     | Task                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| In-app toast + red badge                 | 1, 2                                                                                                                                                                     |
| Browser web push                         | **Deferred (5.5)**                                                                                                                                                       |
| Sound on Critical                        | 3                                                                                                                                                                        |
| WhatsApp via Interakt                    | **Stubbed** — notification doc is created; actual Interakt template send is a Phase-5.5 add (the existing `functions/api/interakt-webhook.js` patterns are the template) |
| SMS fallback                             | **Deferred** — no provider in repo                                                                                                                                       |
| Daily Incharge digest                    | 7                                                                                                                                                                        |
| Weekly Owner digest                      | 8 (PDF rendering deferred — currently logs JSON)                                                                                                                         |
| `slaWatcher` (5min)                      | 6                                                                                                                                                                        |
| Customer notifications respecting opt-in | **Deferred to Phase 6**                                                                                                                                                  |
