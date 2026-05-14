# Tickets Phase 4 — Resolution Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Build the full ticket resolution workspace — modal default + shareable full route — with threaded comments (incl. internal-note toggle), activity log, linked-entities panel, resolution form, reopen flow, merge duplicates, quick actions, tags, status workflow validation. (`@mentions` deferred to Phase 8 alongside KB.)

**Architecture:**

- Two new Firestore collections: `pipeline-ticket-comments`, `pipeline-ticket-activity`. Both keyed by `ticketId` field for filtering.
- A pure `validateStatusTransition(from, to, context) → { ok: true } | { ok: false, reason }` function gates state changes.
- `TicketDetailContent` is the shared body used by both the modal and the full route — single source of truth for the workspace UI.
- Resolution and reopen are explicit operations with required notes; merge sets `mergedInto` on the source.

---

## File structure

| File                                                                    | Status | Responsibility                                                                                                                                                    |
| ----------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pipeline/api/types.ts`                                             | Modify | Add `TicketComment`, `TicketActivity`, `TicketActivityType`, root-cause tag enum.                                                                                 |
| `src/pipeline/api/ticket-comments-firestore.ts`                         | Create | CRUD + subscribe; appends activity log entries.                                                                                                                   |
| `src/pipeline/api/ticket-comments.ts`                                   | Create | Barrel.                                                                                                                                                           |
| `src/pipeline/api/ticket-activity-firestore.ts`                         | Create | `subscribeToTicketActivity(id)`, `recordActivity(...)`.                                                                                                           |
| `src/pipeline/api/ticket-activity.ts`                                   | Create | Barrel.                                                                                                                                                           |
| `src/pipeline/api/ticket-status-machine.ts`                             | Create | Pure validator + tests.                                                                                                                                           |
| `src/pipeline/api/ticket-status-machine.test.ts`                        | Create |                                                                                                                                                                   |
| `src/pipeline/api/tickets-firestore.ts`                                 | Modify | New ops: `transitionStatus`, `resolveTicket`, `reopenTicket`, `mergeTicketInto`, `addTagsToTicket`, `setTicketAssignee`, `addLinkedEntity`. Each writes activity. |
| `src/pipeline/pages/modules/tickets/TicketDetailContent.tsx`            | Create | The workspace body.                                                                                                                                               |
| `src/pipeline/pages/modules/tickets/TicketDetailModal.tsx`              | Create | Modal wrapper around `TicketDetailContent`.                                                                                                                       |
| `src/pipeline/pages/modules/tickets/TicketDetailRoute.tsx`              | Modify | Render `TicketDetailContent` instead of placeholder. Add "Open as modal" link.                                                                                    |
| `src/pipeline/pages/modules/tickets/TicketsListView.tsx`                | Modify | Row click opens detail modal.                                                                                                                                     |
| `src/pipeline/pages/modules/tickets/components/CommentThread.tsx`       | Create | Comment list + composer + internal-note toggle.                                                                                                                   |
| `src/pipeline/pages/modules/tickets/components/ActivityLog.tsx`         | Create | Time-ordered activity entries.                                                                                                                                    |
| `src/pipeline/pages/modules/tickets/components/LinkedEntitiesPanel.tsx` | Create | Links to bookings/karts/customers/payments.                                                                                                                       |
| `src/pipeline/pages/modules/tickets/components/ResolutionForm.tsx`      | Create | Required note + root-cause tag.                                                                                                                                   |
| `src/pipeline/pages/modules/tickets/components/QuickActions.tsx`        | Create | Buttons for refund / void / send WA / mark resolved.                                                                                                              |
| `src/pipeline/pages/modules/tickets/components/MergeTicketModal.tsx`    | Create | Admin-only merge UI.                                                                                                                                              |
| `src/pipeline/pages/modules/tickets/components/ReopenForm.tsx`          | Create | Reason input + 48h window check.                                                                                                                                  |
| `src/pipeline/pages/modules/tickets/components/TagEditor.tsx`           | Create | Free-form tags with autocomplete from existing distinct tags.                                                                                                     |

---

## Task 1: Types — comments, activity, root-cause tags

**File:** `src/pipeline/api/types.ts`

Append after the existing Tickets section:

```ts
// ── Ticket comments ──────────────────────────────────────────────────────────

export interface TicketComment {
  id: string
  ticketId: string
  authorId: string
  authorName: string
  authorKind: 'staff' | 'customer'
  body: string
  internal: boolean // true = staff-only note, hidden from customers
  mentions: string[] // user IDs (Phase 8 ships @mention pings; field exists now for forward compat)
  createdAt: string
  updatedAt: string
}

export interface CreateTicketCommentPayload {
  ticketId: string
  authorId: string
  authorName: string
  authorKind: 'staff' | 'customer'
  body: string
  internal: boolean
  mentions?: string[]
}

// ── Ticket activity ──────────────────────────────────────────────────────────

export type TicketActivityType =
  | 'created'
  | 'status_changed'
  | 'assignee_changed'
  | 'priority_changed'
  | 'category_changed'
  | 'tags_changed'
  | 'comment_added'
  | 'attachment_added'
  | 'attachment_removed'
  | 'linked_entity_added'
  | 'linked_entity_removed'
  | 'resolved'
  | 'reopened'
  | 'merged'
  | 'sla_response_breached'
  | 'sla_resolve_breached'
  | 'escalated'

export interface TicketActivity {
  id: string
  ticketId: string
  type: TicketActivityType
  actorId: string
  actorName: string
  payload: Record<string, unknown>
  createdAt: string
}

// Root-cause tags for resolution
export const TICKET_ROOT_CAUSE_TAGS = [
  'user-error',
  'staff-error',
  'hardware-fault',
  'software-bug',
  'process-gap',
  'third-party-issue',
  'duplicate',
  'wont-fix',
  'other',
] as const

export type TicketRootCauseTag = (typeof TICKET_ROOT_CAUSE_TAGS)[number]
```

Commit `feat(tickets): add comment, activity, and root-cause tag types`.

---

## Task 2: Pure status state machine

**File:** `src/pipeline/api/ticket-status-machine.ts`

```ts
import type { TicketStatus } from './types'

export interface TransitionContext {
  isReopen?: boolean // explicit reopen flow
  resolvedAt?: string | null // for the 48h reopen window
  now?: Date
}

export type TransitionResult = { ok: true } | { ok: false; reason: string }

export function validateStatusTransition(
  from: TicketStatus,
  to: TicketStatus,
  ctx: TransitionContext = {},
): TransitionResult {
  if (from === to) return { ok: false, reason: 'same status' }

  const legal: Record<TicketStatus, TicketStatus[]> = {
    Open: ['In Progress', 'Resolved', 'Closed'],
    'In Progress': ['Open', 'Resolved', 'Closed'],
    Resolved: ['Closed'],
    Closed: [],
  }

  if (legal[from].includes(to)) return { ok: true }

  // Reopen flow: Resolved → Open within 48h of resolvedAt
  if (from === 'Resolved' && to === 'Open' && ctx.isReopen) {
    if (!ctx.resolvedAt) return { ok: false, reason: 'resolvedAt unknown' }
    const resolvedMs = new Date(ctx.resolvedAt).getTime()
    const nowMs = (ctx.now ?? new Date()).getTime()
    const elapsed = nowMs - resolvedMs
    const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000
    if (elapsed > FORTY_EIGHT_HOURS) {
      return { ok: false, reason: 'reopen window expired (48h)' }
    }
    return { ok: true }
  }

  return { ok: false, reason: `${from} → ${to} not allowed` }
}
```

Tests:

```ts
import { describe, it, expect } from 'vitest'
import { validateStatusTransition } from './ticket-status-machine'

describe('validateStatusTransition', () => {
  it('allows Open → In Progress', () => {
    expect(validateStatusTransition('Open', 'In Progress')).toEqual({ ok: true })
  })
  it('allows In Progress → Resolved', () => {
    expect(validateStatusTransition('In Progress', 'Resolved')).toEqual({ ok: true })
  })
  it('rejects same status', () => {
    expect(validateStatusTransition('Open', 'Open')).toEqual({ ok: false, reason: 'same status' })
  })
  it('rejects Closed → anything (terminal)', () => {
    expect(validateStatusTransition('Closed', 'Open').ok).toBe(false)
    expect(validateStatusTransition('Closed', 'Resolved').ok).toBe(false)
  })
  it('allows Resolved → Open via reopen within 48h', () => {
    const r = validateStatusTransition('Resolved', 'Open', {
      isReopen: true,
      resolvedAt: '2026-04-26T10:00:00Z',
      now: new Date('2026-04-27T10:00:00Z'),
    })
    expect(r).toEqual({ ok: true })
  })
  it('rejects Resolved → Open after 48h', () => {
    const r = validateStatusTransition('Resolved', 'Open', {
      isReopen: true,
      resolvedAt: '2026-04-20T10:00:00Z',
      now: new Date('2026-04-27T10:00:00Z'),
    })
    expect(r).toEqual({ ok: false, reason: 'reopen window expired (48h)' })
  })
  it('rejects Resolved → Open without reopen flag', () => {
    expect(validateStatusTransition('Resolved', 'Open').ok).toBe(false)
  })
})
```

Commit `feat(tickets): add pure status state machine`.

---

## Task 3: Comments + activity firestore modules

**Files:** `src/pipeline/api/ticket-comments-firestore.ts`, `ticket-comments.ts`, `ticket-activity-firestore.ts`, `ticket-activity.ts`.

`ticket-activity-firestore.ts`:

```ts
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type { TicketActivity, TicketActivityType } from './types'

const COLLECTION = 'pipeline-ticket-activity'

const getCol = () => collection(getAsquareFirestore(), COLLECTION)

function mapActivity(id: string, data: Record<string, unknown>): TicketActivity {
  const toISO = (val: unknown): string => {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && 'toDate' in val)
      return (val as { toDate: () => Date }).toDate().toISOString()
    return new Date().toISOString()
  }
  return {
    id,
    ticketId: String(data.ticketId ?? ''),
    type: (data.type as TicketActivityType) ?? 'created',
    actorId: String(data.actorId ?? ''),
    actorName: String(data.actorName ?? ''),
    payload: (data.payload as Record<string, unknown>) ?? {},
    createdAt: toISO(data.createdAt),
  }
}

export const mapActivityForTest = mapActivity

export interface RecordActivityInput {
  ticketId: string
  type: TicketActivityType
  actorId: string
  actorName: string
  payload?: Record<string, unknown>
}

export async function recordActivity(input: RecordActivityInput): Promise<string> {
  const ref = await addDoc(getCol(), {
    ticketId: input.ticketId,
    type: input.type,
    actorId: input.actorId,
    actorName: input.actorName,
    payload: input.payload ?? {},
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export function subscribeToTicketActivity(
  ticketId: string,
  onData: (rows: TicketActivity[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(getCol(), where('ticketId', '==', ticketId), orderBy('createdAt', 'asc')),
    (snap) => onData(snap.docs.map((d) => mapActivity(d.id, d.data() as Record<string, unknown>))),
    onError,
  )
}
```

Barrel `ticket-activity.ts`:

```ts
export { recordActivity, subscribeToTicketActivity } from './ticket-activity-firestore'
```

`ticket-comments-firestore.ts`:

```ts
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type { TicketComment, CreateTicketCommentPayload } from './types'
import { recordActivity } from './ticket-activity-firestore'

const COLLECTION = 'pipeline-ticket-comments'

const getCol = () => collection(getAsquareFirestore(), COLLECTION)

function mapComment(id: string, data: Record<string, unknown>): TicketComment {
  const toISO = (val: unknown): string => {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && 'toDate' in val)
      return (val as { toDate: () => Date }).toDate().toISOString()
    return new Date().toISOString()
  }
  return {
    id,
    ticketId: String(data.ticketId ?? ''),
    authorId: String(data.authorId ?? ''),
    authorName: String(data.authorName ?? ''),
    authorKind: (data.authorKind as TicketComment['authorKind']) ?? 'staff',
    body: String(data.body ?? ''),
    internal: data.internal === true,
    mentions: Array.isArray(data.mentions)
      ? data.mentions.filter((x): x is string => typeof x === 'string')
      : [],
    createdAt: toISO(data.createdAt),
    updatedAt: toISO(data.updatedAt),
  }
}

export const mapCommentForTest = mapComment

export async function addTicketComment(payload: CreateTicketCommentPayload): Promise<string> {
  const ref = await addDoc(getCol(), {
    ...payload,
    mentions: payload.mentions ?? [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await recordActivity({
    ticketId: payload.ticketId,
    type: 'comment_added',
    actorId: payload.authorId,
    actorName: payload.authorName,
    payload: { commentId: ref.id, internal: payload.internal },
  })
  return ref.id
}

export function subscribeToTicketComments(
  ticketId: string,
  onData: (rows: TicketComment[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(getCol(), where('ticketId', '==', ticketId), orderBy('createdAt', 'asc')),
    (snap) => onData(snap.docs.map((d) => mapComment(d.id, d.data() as Record<string, unknown>))),
    onError,
  )
}
```

Barrel `ticket-comments.ts`:

```ts
export { addTicketComment, subscribeToTicketComments } from './ticket-comments-firestore'
```

Commit `feat(tickets): add comments and activity log firestore modules`.

---

## Task 4: New ticket operations in `tickets-firestore.ts`

**File:** `src/pipeline/api/tickets-firestore.ts`

Add these exports. Each one uses the status machine (where applicable) and calls `recordActivity`:

```ts
import { validateStatusTransition } from './ticket-status-machine'
import { recordActivity } from './ticket-activity-firestore'

export interface ActorIdentity {
  id: string
  name: string
}

export async function transitionStatus(
  ticketId: string,
  from: TicketStatus,
  to: TicketStatus,
  actor: ActorIdentity,
): Promise<void> {
  const result = validateStatusTransition(from, to, {})
  if (!result.ok) throw new Error(`Cannot transition ${from} → ${to}: ${result.reason}`)
  const ref = doc(getTicketsCollection(), ticketId)
  await updateDoc(ref, { status: to, updatedAt: serverTimestamp() })
  await recordActivity({
    ticketId,
    type: 'status_changed',
    actorId: actor.id,
    actorName: actor.name,
    payload: { from, to },
  })
}

export interface ResolveTicketInput {
  ticketId: string
  fromStatus: TicketStatus
  resolutionNote: string
  rootCauseTag: TicketRootCauseTag
  actor: ActorIdentity
}

export async function resolveTicket(input: ResolveTicketInput): Promise<void> {
  const result = validateStatusTransition(input.fromStatus, 'Resolved', {})
  if (!result.ok) throw new Error(`Cannot resolve from ${input.fromStatus}: ${result.reason}`)
  if (!input.resolutionNote.trim()) throw new Error('resolution note required')
  const ref = doc(getTicketsCollection(), input.ticketId)
  const now = new Date().toISOString()
  await updateDoc(ref, {
    status: 'Resolved',
    resolvedAt: now,
    resolutionNote: input.resolutionNote.trim(),
    rootCauseTag: input.rootCauseTag,
    updatedAt: serverTimestamp(),
  })
  await recordActivity({
    ticketId: input.ticketId,
    type: 'resolved',
    actorId: input.actor.id,
    actorName: input.actor.name,
    payload: { rootCauseTag: input.rootCauseTag },
  })
}

export interface ReopenTicketInput {
  ticketId: string
  resolvedAt: string | null
  reason: string
  actor: ActorIdentity
}

export async function reopenTicket(input: ReopenTicketInput): Promise<void> {
  const result = validateStatusTransition('Resolved', 'Open', {
    isReopen: true,
    resolvedAt: input.resolvedAt,
  })
  if (!result.ok) throw new Error(result.reason)
  if (!input.reason.trim()) throw new Error('reopen reason required')
  const ref = doc(getTicketsCollection(), input.ticketId)
  await updateDoc(ref, {
    status: 'Open',
    reopenedFrom: input.ticketId, // self-reference; full reopen-as-new-ticket lands in Phase 8
    updatedAt: serverTimestamp(),
  })
  await recordActivity({
    ticketId: input.ticketId,
    type: 'reopened',
    actorId: input.actor.id,
    actorName: input.actor.name,
    payload: { reason: input.reason.trim() },
  })
}

export async function mergeTicketInto(
  sourceId: string,
  targetId: string,
  actor: ActorIdentity,
): Promise<void> {
  if (sourceId === targetId) throw new Error('cannot merge ticket into itself')
  const ref = doc(getTicketsCollection(), sourceId)
  await updateDoc(ref, {
    mergedInto: targetId,
    status: 'Closed',
    updatedAt: serverTimestamp(),
  })
  await recordActivity({
    ticketId: sourceId,
    type: 'merged',
    actorId: actor.id,
    actorName: actor.name,
    payload: { targetId },
  })
  await recordActivity({
    ticketId: targetId,
    type: 'merged',
    actorId: actor.id,
    actorName: actor.name,
    payload: { sourceId, direction: 'received' },
  })
}

export async function setTicketTags(
  ticketId: string,
  tags: string[],
  actor: ActorIdentity,
): Promise<void> {
  const ref = doc(getTicketsCollection(), ticketId)
  await updateDoc(ref, { tags, updatedAt: serverTimestamp() })
  await recordActivity({
    ticketId,
    type: 'tags_changed',
    actorId: actor.id,
    actorName: actor.name,
    payload: { tags },
  })
}

export async function addTicketLinkedEntity(
  ticketId: string,
  entity: TicketLinkedEntity,
  actor: ActorIdentity,
): Promise<void> {
  const ref = doc(getTicketsCollection(), ticketId)
  // Read-modify-write would race; let the caller pass the full new array.
  // Simpler: use Firestore arrayUnion.
  const { arrayUnion } = await import('firebase/firestore')
  await updateDoc(ref, { linkedEntities: arrayUnion(entity), updatedAt: serverTimestamp() })
  await recordActivity({
    ticketId,
    type: 'linked_entity_added',
    actorId: actor.id,
    actorName: actor.name,
    payload: { type: entity.type, id: entity.id },
  })
}
```

Add the new types to existing imports (`TicketRootCauseTag`, `TicketLinkedEntity`).

Commit `feat(tickets): add ticket operations (transition, resolve, reopen, merge, tags)`.

---

## Task 5: Workspace UI — `TicketDetailContent.tsx`

**File:** `src/pipeline/pages/modules/tickets/TicketDetailContent.tsx`

Single source of truth for the detail UI. Renders sections:

1. Header — title, id, branch, category badge, priority badge, status badge, "Open full page"/"Open as modal" link based on prop.
2. Tabs (Details / Comments / Activity / Linked) — local state, no router param.
3. Body (per tab):
   - Details: description (markdown rendered as plain text for now; markdown lib comes in Phase 8), attachments list (re-uses chip rendering from `AttachmentUploader`), tags editor.
   - Comments: `<CommentThread ticketId={...} canPostInternal={role !== 'ThirdParty'} />`
   - Activity: `<ActivityLog ticketId={...} />`
   - Linked: `<LinkedEntitiesPanel ticketId={...} entities={ticket.linkedEntities} />`
4. Footer — `<QuickActions ticket={ticket} actor={actor} />` (Resolve / Reopen / Merge / status dropdown / quick action menu).

Props: `ticket: Ticket`, `actor: { id; name; role }`, `surface: 'modal' | 'route'`.

The Tab body components are in their own files (Task 6).

Commit `feat(tickets): add TicketDetailContent shared workspace body`.

---

## Task 6: Sub-components

Single commit `feat(tickets): add workspace sub-components (CommentThread, ActivityLog, LinkedEntitiesPanel, ResolutionForm, QuickActions, MergeTicketModal, ReopenForm, TagEditor)`.

- **`CommentThread.tsx`** — subscribes via `subscribeToTicketComments(ticketId)`. Renders messages in time order with author chip + body + internal badge. Composer at bottom: textarea + "Internal note" toggle (visible to staff only) + "Post" button. Calls `addTicketComment`. Empty state when no comments.
- **`ActivityLog.tsx`** — subscribes via `subscribeToTicketActivity(ticketId)`. Each entry: actor name + relative time + a one-line summary derived from `type` + `payload`. Implement a small `summarize(activity): string` helper.
- **`LinkedEntitiesPanel.tsx`** — list of cards. Click opens the related entity in its module (`/bookings/<id>`, `/track/karts/<id>`, `/admin/customers/<id>`, `/billing/transactions?paymentId=<id>`). "Link booking..." button opens a small picker (free-text booking id input for Phase 4; full picker is a future task).
- **`ResolutionForm.tsx`** — required note (≥10 chars) + root-cause tag dropdown. Submit calls `resolveTicket(...)`.
- **`ReopenForm.tsx`** — required reason input. Submit calls `reopenTicket(...)`.
- **`MergeTicketModal.tsx`** — admin-only. Input: target ticket ID. Confirms with a warning that the source becomes Closed. Calls `mergeTicketInto(sourceId, targetId, actor)`.
- **`TagEditor.tsx`** — chips with X buttons + an input. On Enter, append; Backspace on empty input removes last. Calls `setTicketTags(...)`.
- **`QuickActions.tsx`** — buttons:
  - Status dropdown (with the legal-transition validation surfacing errors to the toast).
  - "Resolve" → opens `<ResolutionForm>` in a small inline modal.
  - "Reopen" → if status == Resolved and within 48h, shows reopen button → opens `<ReopenForm>`.
  - "Merge duplicate" → admin-only → opens `<MergeTicketModal>`.
  - "Refund booking" → only when ticket has a linked `booking`; opens external billing flow URL `/billing/refunds?bookingId=<id>` (no in-process refund call).
  - "Send WhatsApp" — visible only when ticket.role implies a customer counterpart; opens a placeholder URL (Phase 5 wires real Interakt template send).

---

## Task 7: Wire detail modal + route + list-row click

- `TicketDetailModal.tsx`: thin wrapper that renders `<ModalShell>` with `<TicketDetailContent surface="modal" />`. Has "Open full page" link to `/tickets/<id>`.
- `TicketDetailRoute.tsx`: replace the placeholder body with `<TicketDetailContent surface="route" />` plus a "Back to list" link and an "Open as modal in list" link to `/tickets?openId=<id>` (the list view honors the search param).
- `TicketsListView.tsx`: row click → setState `openId`; modal renders when `openId !== null`. Honor `?openId=` in URL search params.

Commit `feat(tickets): wire detail workspace into list, modal, and full route`.

---

## Task 8: Verify

```bash
npx vitest run src/pipeline/api/ticket-status-machine.test.ts \
              src/pipeline/api/ticket-routing.test.ts \
              src/pipeline/api/ticket-sla.test.ts \
              src/pipeline/api/ticket-categories-firestore.test.ts \
              src/pipeline/api/tickets-firestore.test.ts \
              src/pipeline/api/ticket-duplicates.test.ts \
              src/pipeline/api/ticket-auto-context.test.ts \
              src/pipeline/api/ticket-attachments.test.ts \
              scripts/migrate-tickets-2026-04.test.ts \
              src/pipeline/pages/modules/tickets/TicketsModule.test.tsx
```

Type-check clean. Build clean. Commit any small fixups.

---

## Spec coverage check

| Spec item                               | Task    |
| --------------------------------------- | ------- |
| Modal + full route                      | 5, 7    |
| Threaded comments + internal toggle     | 3, 6    |
| Activity log                            | 3, 6    |
| Linked entities panel                   | 6       |
| Resolution form (note + root-cause tag) | 4, 6    |
| Reopen with reason within 48h           | 2, 4, 6 |
| Merge duplicates (admin-only)           | 4, 6    |
| Quick actions                           | 6       |
| Tags / labels                           | 4, 6    |
| Status workflow validation              | 2, 4    |

Items deferred: `@mentions` ping (Phase 8 alongside KB/canned responses), real refund/WA actions (already exist in their respective modules — Phase 4 just deep-links), full booking picker (Phase 6).
