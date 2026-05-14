# Tickets Phase 6 — Customer-Facing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Let customers raise tickets from three entry points (booking-specific, general help, free-form), see live status of their tickets in their profile, and comment on their own tickets. Customer comments mirror staff updates (internal notes are hidden).

**Pragmatic constraints:**

- The customer app cannot import from `src/pipeline/*` per CLAUDE.md. Phase 6 introduces a thin customer-side service `src/services/ticketCustomerService.ts` that wraps the same Firestore collections the pipeline writes to, with customer-only fields populated.
- Customer notifications are app-only (in-app toast / badge in profile) — WhatsApp customer pings ride on the existing Phase 5 onWrite trigger, which already targets `raisedBy` regardless of `raisedByKind`.

---

## File structure

| File                                                  | Status | Responsibility                                                                                 |
| ----------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `src/services/ticketCustomerService.ts`               | Create | `createTicket`, `subscribeToMyTickets`, `subscribeToTicket`, `addComment` — all customer-side. |
| `src/services/ticketCustomerService.test.ts`          | Create | Pure helper tests (e.g. validation).                                                           |
| `src/pages/Help.tsx`                                  | Create | Customer help hub: KB articles section + "Raise a ticket" button + "My tickets" preview.       |
| `src/pages/HelpTicketDetail.tsx`                      | Create | Customer-side ticket detail (status, ETA, comment thread).                                     |
| `src/pages/BookingDetails.tsx`                        | Modify | Add "Report an issue" button → opens customer raise-ticket flow with booking pre-linked.       |
| `src/pages/Profile.tsx`                               | Modify | Add "My tickets" section with live status + ETA.                                               |
| `src/components/BottomNav.tsx`                        | Modify | Add Help entry.                                                                                |
| `src/components/tickets/CustomerRaiseTicketModal.tsx` | Create | Customer-flavored raise-ticket modal (no role/staff fields, single category dropdown).         |
| `src/components/tickets/CustomerTicketCard.tsx`       | Create | Compact card for the profile/help list.                                                        |
| `src/CustomerApp.tsx`                                 | Modify | Lazy-route `/help` and `/help/tickets/:id`.                                                    |

---

## Task 1: Customer service layer

**File:** `src/services/ticketCustomerService.ts`

```ts
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { logger } from '../lib/logger'
import type { Ticket, TicketComment, CreateTicketCommentPayload, TicketCategory } from '../types'

const TICKETS = 'pipeline-tickets'
const CATEGORIES = 'pipeline-ticket-categories'
const COMMENTS = 'pipeline-ticket-comments'

function asISO(val: unknown): string {
  if (typeof val === 'string') return val
  if (val && typeof val === 'object' && 'toDate' in val)
    return (val as { toDate: () => Date }).toDate().toISOString()
  return new Date().toISOString()
}

function mapTicket(id: string, data: Record<string, unknown>): Ticket {
  // Mirror enough of the pipeline mapTicket to render in the customer app.
  // Only the fields the customer UI needs are preserved.
  return {
    id,
    schemaVersion: data.schemaVersion === 2 ? 2 : 1,
    title: String(data.title ?? data.issue ?? ''),
    description: String(data.description ?? data.issue ?? ''),
    categoryId: String(data.categoryId ?? 'other'),
    priority: (data.priority as Ticket['priority']) ?? 'Normal',
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    status: (data.status as Ticket['status']) ?? 'Open',
    role: (data.role as Ticket['role']) ?? 'ThirdParty',
    raisedBy: String(data.raisedBy ?? ''),
    raisedByName: String(data.raisedByName ?? ''),
    raisedByKind: (data.raisedByKind as Ticket['raisedByKind']) ?? 'customer',
    branchId: String(data.branchId ?? data.location ?? ''),
    branchDisplayName: String(data.branchDisplayName ?? data.locationDisplayName ?? ''),
    assignedTo: 'Developer' as const,
    assigneeId: String(data.assigneeId ?? data.assignedToId ?? ''),
    assigneeRole: (data.assigneeRole as Ticket['assigneeRole']) ?? 'Developer',
    assigneeName: String(data.assigneeName ?? data.assignedToName ?? ''),
    watcherIds: Array.isArray(data.watcherIds) ? (data.watcherIds as string[]) : [],
    attachments: Array.isArray(data.attachments) ? (data.attachments as Ticket['attachments']) : [],
    linkedEntities: Array.isArray(data.linkedEntities)
      ? (data.linkedEntities as Ticket['linkedEntities'])
      : [],
    autoContext: (data.autoContext as Ticket['autoContext']) ?? {},
    slaSnapshot: (data.slaSnapshot as Ticket['slaSnapshot']) ?? null,
    responseDueAt: (data.responseDueAt as string | null) ?? null,
    resolveDueAt: (data.resolveDueAt as string | null) ?? null,
    firstResponseAt: (data.firstResponseAt as string | null) ?? null,
    resolvedAt: (data.resolvedAt as string | null) ?? null,
    resolutionNote: (data.resolutionNote as string | null) ?? null,
    rootCauseTag: (data.rootCauseTag as string | null) ?? null,
    escalationLevel: typeof data.escalationLevel === 'number' ? data.escalationLevel : 0,
    mergedInto: (data.mergedInto as string | null) ?? null,
    reopenedFrom: (data.reopenedFrom as string | null) ?? null,
    location: String(data.location ?? data.branchId ?? ''),
    locationDisplayName: String(data.locationDisplayName ?? data.branchDisplayName ?? ''),
    issue: String(data.issue ?? data.description ?? ''),
    assignedToId: String(data.assignedToId ?? data.assigneeId ?? ''),
    assignedToName: String(data.assignedToName ?? data.assigneeName ?? ''),
    createdAt: asISO(data.createdAt),
    updatedAt: asISO(data.updatedAt),
  }
}

const generateTicketId = (): string => `TKT-${Math.random().toString(36).slice(2, 10)}`

export interface CustomerCreateTicketInput {
  userId: string
  userName: string
  branchId: string
  branchDisplayName: string
  categoryId: string
  title: string
  description: string
  bookingId?: string
}

const DEFAULT_OTHER_CATEGORY: Pick<
  TicketCategory,
  'id' | 'priorityFloor' | 'responseSlaSeconds' | 'resolveSlaSeconds' | 'routingChain'
> = {
  id: 'other',
  priorityFloor: 'Normal',
  responseSlaSeconds: 4 * 60 * 60,
  resolveSlaSeconds: 24 * 60 * 60,
  routingChain: ['Incharge'],
}

async function loadCategoryClientSide(id: string): Promise<typeof DEFAULT_OTHER_CATEGORY> {
  const snap = await getDoc(doc(db, CATEGORIES, id))
  if (!snap.exists()) return DEFAULT_OTHER_CATEGORY
  const data = snap.data() || {}
  return {
    id,
    priorityFloor: (data.priorityFloor as TicketCategory['priorityFloor']) ?? 'Normal',
    responseSlaSeconds:
      typeof data.responseSlaSeconds === 'number' ? data.responseSlaSeconds : null,
    resolveSlaSeconds:
      typeof data.resolveSlaSeconds === 'number' ? data.resolveSlaSeconds : 24 * 60 * 60,
    routingChain: Array.isArray(data.routingChain) ? data.routingChain : ['Incharge'],
  }
}

export const ticketCustomerService = {
  async createTicket(input: CustomerCreateTicketInput): Promise<string> {
    if (!input.title.trim()) throw new Error('title required')
    if (input.description.trim().length < 10) throw new Error('description must be ≥ 10 chars')

    const id = generateTicketId()
    const cat = await loadCategoryClientSide(input.categoryId || 'other')
    const now = new Date()
    const responseDueAt =
      cat.responseSlaSeconds === null
        ? null
        : new Date(now.getTime() + cat.responseSlaSeconds * 1000).toISOString()
    const resolveDueAt = new Date(now.getTime() + cat.resolveSlaSeconds * 1000).toISOString()

    await addDoc(collection(db, TICKETS), {
      // Server-side onTicketWrite will pick routing/assignee from the chain on first save —
      // for now just write the ticket with no assignee and let the trigger populate.
      // The trigger uses `escalationChainRemaining` to know the chain.
      schemaVersion: 2,
      title: input.title.trim().slice(0, 120),
      description: input.description.trim(),
      issue: input.description.trim(),
      categoryId: input.categoryId || 'other',
      priority: cat.priorityFloor,
      tags: [],
      status: 'Open',
      role: 'ThirdParty',
      raisedBy: input.userId,
      raisedByName: input.userName,
      raisedByKind: 'customer',
      branchId: input.branchId,
      branchDisplayName: input.branchDisplayName,
      location: input.branchId,
      locationDisplayName: input.branchDisplayName,
      assignedTo: 'Developer',
      assigneeId: '',
      assigneeRole: 'Developer',
      assigneeName: '',
      assignedToId: '',
      assignedToName: '',
      watcherIds: [],
      attachments: [],
      linkedEntities: input.bookingId
        ? [{ type: 'booking', id: input.bookingId, label: `Booking ${input.bookingId}` }]
        : [],
      autoContext: {
        appVersion: 'customer-app',
      },
      slaSnapshot: {
        responseSeconds: cat.responseSlaSeconds,
        resolveSeconds: cat.resolveSlaSeconds,
      },
      responseDueAt,
      resolveDueAt,
      firstResponseAt: null,
      resolvedAt: null,
      resolutionNote: null,
      rootCauseTag: null,
      escalationLevel: 0,
      escalationChainRemaining: cat.routingChain,
      mergedInto: null,
      reopenedFrom: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    logger.info('customer.ticket.created', { id, categoryId: input.categoryId })
    return id
  },

  subscribeToMyTickets(
    userId: string,
    onData: (rows: Ticket[]) => void,
    onError: (err: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      query(
        collection(db, TICKETS),
        where('raisedBy', '==', userId),
        where('raisedByKind', '==', 'customer'),
        orderBy('createdAt', 'desc'),
        limit(50),
      ),
      (snap) => onData(snap.docs.map((d) => mapTicket(d.id, d.data() as Record<string, unknown>))),
      onError,
    )
  },

  subscribeToTicket(
    ticketId: string,
    userId: string,
    onData: (t: Ticket | null) => void,
    onError: (err: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      doc(db, TICKETS, ticketId),
      (snap) => {
        if (!snap.exists()) {
          onData(null)
          return
        }
        const t = mapTicket(snap.id, snap.data() as Record<string, unknown>)
        // Authorization: customer can only see tickets they raised.
        if (t.raisedBy !== userId) {
          onData(null)
          return
        }
        onData(t)
      },
      onError,
    )
  },

  subscribeToComments(
    ticketId: string,
    onData: (rows: TicketComment[]) => void,
    onError: (err: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      query(
        collection(db, COMMENTS),
        where('ticketId', '==', ticketId),
        where('internal', '==', false),
        orderBy('createdAt', 'asc'),
      ),
      (snap) =>
        onData(
          snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>
            return {
              id: d.id,
              ticketId: String(data.ticketId ?? ''),
              authorId: String(data.authorId ?? ''),
              authorName: String(data.authorName ?? ''),
              authorKind: (data.authorKind as TicketComment['authorKind']) ?? 'staff',
              body: String(data.body ?? ''),
              internal: false,
              mentions: Array.isArray(data.mentions) ? (data.mentions as string[]) : [],
              createdAt: asISO(data.createdAt),
              updatedAt: asISO(data.updatedAt),
            }
          }),
        ),
      onError,
    )
  },

  async addComment(
    payload: Omit<CreateTicketCommentPayload, 'authorKind' | 'internal'>,
  ): Promise<string> {
    const ref = await addDoc(collection(db, COMMENTS), {
      ...payload,
      authorKind: 'customer',
      internal: false,
      mentions: payload.mentions ?? [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return ref.id
  },

  async listActiveCategories(): Promise<TicketCategory[]> {
    const snap = await getDocs(query(collection(db, CATEGORIES), orderBy('sortOrder', 'asc')))
    return snap.docs
      .map((d) => {
        const data = d.data()
        return {
          id: d.id,
          label: String(data.label ?? d.id),
          priorityFloor: (data.priorityFloor as TicketCategory['priorityFloor']) ?? 'Normal',
          responseSlaSeconds:
            typeof data.responseSlaSeconds === 'number' ? data.responseSlaSeconds : null,
          resolveSlaSeconds:
            typeof data.resolveSlaSeconds === 'number' ? data.resolveSlaSeconds : 24 * 60 * 60,
          routingChain: Array.isArray(data.routingChain)
            ? (data.routingChain as TicketCategory['routingChain'])
            : ['Incharge'],
          active: data.active !== false,
          sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 99,
        }
      })
      .filter((c) => c.active)
  },
}
```

Test:

```ts
import { describe, it, expect } from 'vitest'
import { ticketCustomerService } from './ticketCustomerService'

describe('ticketCustomerService.createTicket validation', () => {
  it('rejects empty title', async () => {
    await expect(
      ticketCustomerService.createTicket({
        userId: 'u',
        userName: 'U',
        branchId: 'vizag',
        branchDisplayName: 'Vizag',
        categoryId: 'other',
        title: '   ',
        description: 'long enough description',
      }),
    ).rejects.toThrow(/title/)
  })

  it('rejects too-short description', async () => {
    await expect(
      ticketCustomerService.createTicket({
        userId: 'u',
        userName: 'U',
        branchId: 'vizag',
        branchDisplayName: 'Vizag',
        categoryId: 'other',
        title: 'OK',
        description: 'too short',
      }),
    ).rejects.toThrow(/10 chars/)
  })
})
```

(Service write is mocked via the global Firestore mock; `ticketCustomerService.createTicket` proceeds past validation but the addDoc mock handles it.)

Commit `feat(customer): add ticketCustomerService for customer-side ticket ops`.

---

## Task 2: `CustomerRaiseTicketModal.tsx`

**File:** `src/components/tickets/CustomerRaiseTicketModal.tsx`

Customer-flavored modal. Props:

- `open: boolean`
- `onClose: () => void`
- `bookingId?: string` (when raised from BookingDetails)
- `defaultBranchId?: string` (default to user's last-visited branch from auth context)

Fields:

- Category dropdown (calls `ticketCustomerService.listActiveCategories()`).
- Title (≤120 chars, required).
- Description (≥10 chars, required).
- "Linked booking" — pre-filled and read-only when `bookingId` is provided; hidden otherwise.

Submit calls `ticketCustomerService.createTicket(...)` and shows toast.

Commit `feat(customer): add CustomerRaiseTicketModal component`.

---

## Task 3: Help page + customer ticket detail + bottom-nav entry

**`src/pages/Help.tsx`**:

Sections:

1. Hero: "How can we help?"
2. "Raise a ticket" CTA → opens `<CustomerRaiseTicketModal />`.
3. "My recent tickets" — list of `<CustomerTicketCard>` (last 5, with link to detail page).
4. "FAQ" placeholder (Phase 8 fills with KB).

**`src/pages/HelpTicketDetail.tsx`**:

Status header (status badge, ETA from `resolveDueAt`), description, comment thread (read-only customer comments + their own composer), reopen button when status === Resolved within 48h (calls a new server-side reopen API or — since customers can't run admin functions directly — set `status: 'Open'` via the same `addComment` flow + a flag... actually keep it simple: the customer composes a "reopen reason" comment that staff sees, no automated status change. Document the limitation: customer reopen request creates a comment that staff acts on).

**`src/components/tickets/CustomerTicketCard.tsx`**:

Compact card: id, title, status badge, priority pill, created relative time, ETA delta if open ("Resolves in 2h"), click → navigates to `/help/tickets/<id>`.

**`src/components/BottomNav.tsx`** — add a "Help" entry (icon: Lucide `HelpCircle`, route `/help`). Place between Profile and the existing entries — match existing nav styling.

Commit `feat(customer): add Help page, ticket detail page, and bottom-nav entry`.

---

## Task 4: BookingDetails "Report an issue" button

**`src/pages/BookingDetails.tsx`** — add a button "Report an issue" that opens `<CustomerRaiseTicketModal bookingId={booking.id} defaultBranchId={booking.branchId} />`.

Place the button in a sensible location — after the booking summary, before any other action buttons. Use the existing button styling patterns in the file.

Commit `feat(customer): add 'Report an issue' button on BookingDetails`.

---

## Task 5: Profile "My tickets" section

**`src/pages/Profile.tsx`** — add a new section "My tickets" that:

- Subscribes via `ticketCustomerService.subscribeToMyTickets(userId, ...)` on mount.
- Renders up to 5 most recent tickets as `<CustomerTicketCard>` components.
- "View all" link → `/help` (which lists all the user's tickets).

Place the section above the "Logout" button or in a sensible profile position.

Commit `feat(customer): add 'My tickets' section to Profile`.

---

## Task 6: Routes in CustomerApp.tsx

**`src/CustomerApp.tsx`** — add lazy routes:

```tsx
const Help = lazy(() => import('./pages/Help'))
const HelpTicketDetail = lazy(() => import('./pages/HelpTicketDetail'))

// inside the Routes:
<Route path="/help" element={<Help />} />
<Route path="/help/tickets/:ticketId" element={<HelpTicketDetail />} />
```

Place near other lazy-imported routes.

Commit `feat(customer): wire /help and /help/tickets/:id routes`.

---

## Task 7: Verify

```bash
npx vitest run src/services/ticketCustomerService.test.ts \
              src/pipeline/api/ src/pipeline/pages/modules/tickets/
npx tsc -p tsconfig.app.json --noEmit | grep -i ticket
```

Both clean. Build sanity ok (modulo pre-existing unrelated TS errors).

---

## Spec coverage

| Spec item                                | Task                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customer raises booking-specific ticket  | 2, 4                                                                                                                                                                                                                                                                     |
| Customer raises general/free-form ticket | 2, 3                                                                                                                                                                                                                                                                     |
| Customer profile tracker                 | 5                                                                                                                                                                                                                                                                        |
| Customer-side comments (no internal)     | 1, 3                                                                                                                                                                                                                                                                     |
| Customer notifications respect opt-in    | **Deferred** — current customer notification surface is in-app only (the Phase 5 onTicketWrite trigger creates docs in `pipeline-ticket-notifications` keyed by `recipientId === raisedBy`; the customer app can subscribe to that collection in a Phase 6.5 follow-up). |
| 5-per-24h customer rate limit            | **Deferred** — server-side enforcement in Phase 8 alongside KB                                                                                                                                                                                                           |
