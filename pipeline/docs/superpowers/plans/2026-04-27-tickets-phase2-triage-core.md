# Tickets Phase 2 — Triage Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add categories (with default config), priority floor, round-robin assignment within branch, and SLA snapshot at create. New tickets get routed to the right role automatically; the modal exposes category + priority; the list filters by both.

**Architecture:** Categories live in a new `pipeline-ticket-categories` Firestore collection (Owner/Admin writable). A pure `routeTicket(category, branchId, candidates)` helper picks an assignee via round-robin, and a pure `computeSlaSnapshot(category)` computes due-by timestamps. `createTicket` consumes both. The `RaiseTicketModal` adds category + priority dropdowns; the list view adds category filter.

**Spec:** [docs/superpowers/specs/2026-04-27-tickets-overhaul-design.md](../specs/2026-04-27-tickets-overhaul-design.md) §6 + §11.2.

---

## File structure

| File                                                     | Status | Responsibility                                                                                                    |
| -------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `src/pipeline/api/types.ts`                              | Modify | Add `TicketCategory` interface and `DEFAULT_TICKET_CATEGORIES`.                                                   |
| `src/pipeline/api/ticket-categories-firestore.ts`        | Create | CRUD + `subscribeToTicketCategories`; seeds defaults if empty.                                                    |
| `src/pipeline/api/ticket-categories.ts`                  | Create | Re-export barrel.                                                                                                 |
| `src/pipeline/api/ticket-routing.ts`                     | Create | Pure `routeTicket(category, branchId, candidates) → { assigneeId, assigneeRole, assigneeName, escalationChain }`. |
| `src/pipeline/api/ticket-sla.ts`                         | Create | Pure `computeSlaSnapshot(category, now) → { responseDueAt, resolveDueAt, slaSnapshot }`.                          |
| `src/pipeline/api/tickets-firestore.ts`                  | Modify | `createTicket` accepts `categoryId` + `priority`, calls routing + SLA helpers.                                    |
| `src/pipeline/api/types.ts`                              | Modify | `CreateTicketPayload` adds `categoryId`, optional `priority` override.                                            |
| `src/pipeline/components/tickets/RaiseTicketModal.tsx`   | Modify | Add category dropdown (drives priority floor) and priority override.                                              |
| `src/pipeline/pages/modules/tickets/TicketsListView.tsx` | Modify | Add category + priority filters.                                                                                  |
| `src/pipeline/pages/modules/SettingsModule.tsx`          | Modify | Add a "Tickets / Categories" section (Owner/Admin only) — table + edit modal.                                     |
| `src/pipeline/api/ticket-routing.test.ts`                | Create | Unit tests for round-robin + chain fallback.                                                                      |
| `src/pipeline/api/ticket-sla.test.ts`                    | Create | Unit tests for SLA computation.                                                                                   |
| `src/pipeline/api/ticket-categories-firestore.test.ts`   | Create | Tests for the seed-on-empty behavior.                                                                             |

---

## Task 1: Add `TicketCategory` type and defaults

**Files:** `src/pipeline/api/types.ts`

Add after the existing Tickets section:

```ts
// ── Ticket categories ────────────────────────────────────────────────────────

export interface TicketCategory {
  id: string // 'track-safety', 'billing-refund', etc.
  label: string // user-facing
  priorityFloor: TicketPriority // priority cannot go below this when category is selected
  responseSlaSeconds: number | null // null = no response SLA (e.g. feedback)
  resolveSlaSeconds: number
  routingChain: Role[] // ordered: first role in branch is the target; subsequent are escalation hops
  active: boolean
  sortOrder: number
}

export interface CreateTicketCategoryPayload {
  label: string
  priorityFloor: TicketPriority
  responseSlaSeconds: number | null
  resolveSlaSeconds: number
  routingChain: Role[]
  active?: boolean
  sortOrder?: number
}

export const DEFAULT_TICKET_CATEGORIES: ReadonlyArray<TicketCategory> = [
  {
    id: 'track-safety',
    label: 'Track / Safety',
    priorityFloor: 'Critical',
    responseSlaSeconds: 15 * 60,
    resolveSlaSeconds: 2 * 60 * 60,
    routingChain: ['TrackMarshall', 'Incharge', 'Admin', 'Owner'],
    active: true,
    sortOrder: 10,
  },
  {
    id: 'billing-refund',
    label: 'Billing / Refund',
    priorityFloor: 'High',
    responseSlaSeconds: 60 * 60,
    resolveSlaSeconds: 8 * 60 * 60,
    routingChain: ['Cashier', 'Incharge', 'Admin'],
    active: true,
    sortOrder: 20,
  },
  {
    id: 'booking-change',
    label: 'Booking change',
    priorityFloor: 'Normal',
    responseSlaSeconds: 2 * 60 * 60,
    resolveSlaSeconds: 24 * 60 * 60,
    routingChain: ['Telecaller', 'Incharge'],
    active: true,
    sortOrder: 30,
  },
  {
    id: 'app-bug',
    label: 'App bug / tech',
    priorityFloor: 'Normal',
    responseSlaSeconds: 4 * 60 * 60,
    resolveSlaSeconds: 3 * 24 * 60 * 60,
    routingChain: ['Developer', 'Backend'],
    active: true,
    sortOrder: 40,
  },
  {
    id: 'feedback',
    label: 'Feedback / suggestion',
    priorityFloor: 'Low',
    responseSlaSeconds: null,
    resolveSlaSeconds: 7 * 24 * 60 * 60,
    routingChain: ['Editor'],
    active: true,
    sortOrder: 50,
  },
  {
    id: 'other',
    label: 'Other',
    priorityFloor: 'Normal',
    responseSlaSeconds: 4 * 60 * 60,
    resolveSlaSeconds: 24 * 60 * 60,
    routingChain: ['Incharge', 'Admin'],
    active: true,
    sortOrder: 99,
  },
]
```

Type-check, commit `feat(tickets): add TicketCategory type and defaults`.

---

## Task 2: `ticket-categories-firestore.ts` with seed-on-empty

**Files:** `src/pipeline/api/ticket-categories-firestore.ts`, `src/pipeline/api/ticket-categories.ts`, `src/pipeline/api/ticket-categories-firestore.test.ts`

Create the firestore module:

```ts
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  serverTimestamp,
  type Unsubscribe,
  writeBatch,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type { TicketCategory, CreateTicketCategoryPayload } from './types'
import { DEFAULT_TICKET_CATEGORIES } from './types'
import { logger } from '../../lib/logger'

const COLLECTION = 'pipeline-ticket-categories'

const getCol = () => collection(getAsquareFirestore(), COLLECTION)

function mapCategory(id: string, data: Record<string, unknown>): TicketCategory {
  return {
    id,
    label: String(data.label ?? id),
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
}

export const mapCategoryForTest = mapCategory

export async function ensureSeedCategories(): Promise<void> {
  const snap = await getDocs(getCol())
  if (snap.size > 0) return
  const batch = writeBatch(getAsquareFirestore())
  for (const c of DEFAULT_TICKET_CATEGORIES) {
    const ref = doc(getCol(), c.id)
    batch.set(ref, { ...c, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  }
  await batch.commit()
  logger.info('ticket_category.seeded', { count: DEFAULT_TICKET_CATEGORIES.length })
}

export function subscribeToTicketCategories(
  onData: (rows: TicketCategory[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(getCol(), orderBy('sortOrder', 'asc')),
    (snap) => onData(snap.docs.map((d) => mapCategory(d.id, d.data() as Record<string, unknown>))),
    onError,
  )
}

export async function upsertCategory(
  id: string,
  payload: CreateTicketCategoryPayload,
): Promise<void> {
  const ref = doc(getCol(), id)
  await setDoc(
    ref,
    {
      ...payload,
      active: payload.active ?? true,
      sortOrder: payload.sortOrder ?? 99,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function setCategoryActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(getCol(), id), { active, updatedAt: serverTimestamp() })
}
```

Barrel `ticket-categories.ts`:

```ts
export {
  ensureSeedCategories,
  subscribeToTicketCategories,
  upsertCategory,
  setCategoryActive,
} from './ticket-categories-firestore'
```

Test (covers `mapCategory` defaults; the seed/CRUD calls will be covered through integration in Task 11):

```ts
import { describe, it, expect } from 'vitest'
import { mapCategoryForTest } from './ticket-categories-firestore'

describe('mapCategory', () => {
  it('uses safe defaults for missing fields', () => {
    const c = mapCategoryForTest('x', {})
    expect(c.label).toBe('x')
    expect(c.priorityFloor).toBe('Normal')
    expect(c.responseSlaSeconds).toBeNull()
    expect(c.resolveSlaSeconds).toBe(24 * 60 * 60)
    expect(c.routingChain).toEqual(['Incharge'])
    expect(c.active).toBe(true)
    expect(c.sortOrder).toBe(99)
  })

  it('preserves provided fields', () => {
    const c = mapCategoryForTest('a', {
      label: 'Alpha',
      priorityFloor: 'High',
      responseSlaSeconds: 3600,
      resolveSlaSeconds: 7200,
      routingChain: ['Cashier', 'Admin'],
      active: false,
      sortOrder: 5,
    })
    expect(c.label).toBe('Alpha')
    expect(c.priorityFloor).toBe('High')
    expect(c.responseSlaSeconds).toBe(3600)
    expect(c.resolveSlaSeconds).toBe(7200)
    expect(c.routingChain).toEqual(['Cashier', 'Admin'])
    expect(c.active).toBe(false)
    expect(c.sortOrder).toBe(5)
  })
})
```

Run, commit `feat(tickets): add ticket-categories firestore module with seed-on-empty`.

---

## Task 3: Pure routing helper + tests

**Files:** `src/pipeline/api/ticket-routing.ts`, `src/pipeline/api/ticket-routing.test.ts`

```ts
import type { Role, TicketCategory } from './types'

export interface RoutingCandidate {
  id: string
  name: string
  role: Role
  branchId: string
  active: boolean
  /** Last time this user was assigned a ticket. Used for round-robin tie-break. */
  lastAssignedAtMs: number
}

export interface RoutingResult {
  assigneeId: string
  assigneeRole: Role
  assigneeName: string
  /** Remaining roles after the chosen one — used by slaWatcher to escalate. */
  escalationChain: Role[]
}

export function routeTicket(
  category: TicketCategory,
  branchId: string,
  candidates: ReadonlyArray<RoutingCandidate>,
): RoutingResult | null {
  for (let i = 0; i < category.routingChain.length; i += 1) {
    const role = category.routingChain[i]
    const eligible = candidates
      .filter((c) => c.active && c.role === role && c.branchId === branchId)
      .sort((a, b) => a.lastAssignedAtMs - b.lastAssignedAtMs || a.id.localeCompare(b.id))
    if (eligible.length > 0) {
      const chosen = eligible[0]
      return {
        assigneeId: chosen.id,
        assigneeRole: chosen.role,
        assigneeName: chosen.name,
        escalationChain: category.routingChain.slice(i + 1),
      }
    }
  }
  // Fallback: anyone in the chain at any branch.
  for (let i = 0; i < category.routingChain.length; i += 1) {
    const role = category.routingChain[i]
    const eligible = candidates
      .filter((c) => c.active && c.role === role)
      .sort((a, b) => a.lastAssignedAtMs - b.lastAssignedAtMs || a.id.localeCompare(b.id))
    if (eligible.length > 0) {
      const chosen = eligible[0]
      return {
        assigneeId: chosen.id,
        assigneeRole: chosen.role,
        assigneeName: chosen.name,
        escalationChain: category.routingChain.slice(i + 1),
      }
    }
  }
  return null
}
```

Tests:

```ts
import { describe, it, expect } from 'vitest'
import type { TicketCategory } from './types'
import { routeTicket, RoutingCandidate } from './ticket-routing'

const cat: TicketCategory = {
  id: 'billing-refund',
  label: 'Billing',
  priorityFloor: 'High',
  responseSlaSeconds: 3600,
  resolveSlaSeconds: 28800,
  routingChain: ['Cashier', 'Incharge', 'Admin'],
  active: true,
  sortOrder: 0,
}

const c = (over: Partial<RoutingCandidate>): RoutingCandidate => ({
  id: 'u',
  name: 'U',
  role: 'Cashier',
  branchId: 'vizag',
  active: true,
  lastAssignedAtMs: 0,
  ...over,
})

describe('routeTicket', () => {
  it('returns null when no candidates match the chain', () => {
    expect(routeTicket(cat, 'vizag', [c({ role: 'Editor' })])).toBeNull()
  })

  it('picks the first chain role with an active candidate at the branch', () => {
    const r = routeTicket(cat, 'vizag', [c({ id: 'cashier-1', name: 'A' })])
    expect(r?.assigneeRole).toBe('Cashier')
    expect(r?.assigneeId).toBe('cashier-1')
    expect(r?.escalationChain).toEqual(['Incharge', 'Admin'])
  })

  it('round-robins by lastAssignedAtMs ascending, ties broken by id', () => {
    const r = routeTicket(cat, 'vizag', [
      c({ id: 'cashier-2', name: 'B', lastAssignedAtMs: 100 }),
      c({ id: 'cashier-1', name: 'A', lastAssignedAtMs: 50 }),
      c({ id: 'cashier-3', name: 'C', lastAssignedAtMs: 50 }),
    ])
    expect(r?.assigneeId).toBe('cashier-1')
  })

  it('falls back to next chain link when role is empty at branch', () => {
    const r = routeTicket(cat, 'vizag', [c({ id: 'in-1', role: 'Incharge' })])
    expect(r?.assigneeRole).toBe('Incharge')
    expect(r?.escalationChain).toEqual(['Admin'])
  })

  it('falls back cross-branch when nobody at the branch is in the chain', () => {
    const r = routeTicket(cat, 'vizag', [c({ id: 'cashier-other', branchId: 'kakinada' })])
    expect(r?.assigneeId).toBe('cashier-other')
  })

  it('skips inactive users', () => {
    const r = routeTicket(cat, 'vizag', [
      c({ id: 'cashier-1', active: false }),
      c({ id: 'cashier-2' }),
    ])
    expect(r?.assigneeId).toBe('cashier-2')
  })
})
```

Commit `feat(tickets): add pure routing helper with round-robin and chain fallback`.

---

## Task 4: Pure SLA helper + tests

**Files:** `src/pipeline/api/ticket-sla.ts`, `src/pipeline/api/ticket-sla.test.ts`

```ts
import type { TicketCategory, TicketSlaSnapshot } from './types'

export interface SlaResult {
  slaSnapshot: TicketSlaSnapshot
  responseDueAt: string | null
  resolveDueAt: string
}

export function computeSlaSnapshot(category: TicketCategory, now: Date = new Date()): SlaResult {
  const nowMs = now.getTime()
  const responseDueAt =
    category.responseSlaSeconds === null
      ? null
      : new Date(nowMs + category.responseSlaSeconds * 1000).toISOString()
  const resolveDueAt = new Date(nowMs + category.resolveSlaSeconds * 1000).toISOString()
  return {
    slaSnapshot: {
      responseSeconds: category.responseSlaSeconds,
      resolveSeconds: category.resolveSlaSeconds,
    },
    responseDueAt,
    resolveDueAt,
  }
}
```

Tests:

```ts
import { describe, it, expect } from 'vitest'
import type { TicketCategory } from './types'
import { computeSlaSnapshot } from './ticket-sla'

const at = (iso: string): Date => new Date(iso)

const baseCat: TicketCategory = {
  id: 'x',
  label: 'X',
  priorityFloor: 'Normal',
  responseSlaSeconds: 3600,
  resolveSlaSeconds: 7200,
  routingChain: ['Incharge'],
  active: true,
  sortOrder: 0,
}

describe('computeSlaSnapshot', () => {
  it('computes both due-by timestamps from now + seconds', () => {
    const r = computeSlaSnapshot(baseCat, at('2026-04-27T10:00:00Z'))
    expect(r.responseDueAt).toBe('2026-04-27T11:00:00.000Z')
    expect(r.resolveDueAt).toBe('2026-04-27T12:00:00.000Z')
    expect(r.slaSnapshot).toEqual({ responseSeconds: 3600, resolveSeconds: 7200 })
  })

  it('returns responseDueAt = null when category has no response SLA', () => {
    const r = computeSlaSnapshot(
      { ...baseCat, responseSlaSeconds: null },
      at('2026-04-27T10:00:00Z'),
    )
    expect(r.responseDueAt).toBeNull()
    expect(r.slaSnapshot.responseSeconds).toBeNull()
  })
})
```

Commit `feat(tickets): add pure SLA snapshot helper`.

---

## Task 5: Wire `createTicket` to category, priority, routing, SLA

**Files:** `src/pipeline/api/types.ts`, `src/pipeline/api/tickets-firestore.ts`, `src/pipeline/api/tickets-firestore.test.ts`

Update `CreateTicketPayload` to include `categoryId` (required), optional `priorityOverride`, and optional `attachments`/`linkedEntities` (keep their phase-3 defaults of `[]`):

```ts
export interface CreateTicketPayload {
  role: Role
  location: string // legacy — kept for now; equals branchId
  locationDisplayName: string
  issue: string
  raisedBy: string
  raisedByName: string
  raisedByKind?: RaisedByKind // default 'staff'
  categoryId: string // NEW
  priorityOverride?: TicketPriority // NEW
  title?: string // optional override (else slice from issue)
}
```

Update `createTicket` to:

1. Load the category by id (`getDoc` from `pipeline-ticket-categories/<id>`); if missing, fall back to the `'other'` default.
2. Compute the effective priority: `payload.priorityOverride ?? category.priorityFloor`. If override is _lower_ than the floor, snap to the floor.
3. Load active candidates for the routing chain via `listFirestoreUsers({ status: 'Active' })` (already imported), filter to roles in the chain.
4. Call `routeTicket(category, payload.location, candidates)` — store result; if null, fall back to existing `getFirstActiveDeveloper()`.
5. Call `computeSlaSnapshot(category)` — store result.
6. Write the v2 doc with the resolved `categoryId`, `priority`, `slaSnapshot`, `responseDueAt`, `resolveDueAt`, and the routed assignee.

Add a `priorityRank()` helper inline (Low=0, Normal=1, High=2, Critical=3) for the floor comparison.

Add new tests in `tickets-firestore.test.ts`:

- `createTicket uses category routing and SLA when category is found` (mock `getDoc` for category, `listFirestoreUsers`, assert `setDoc` payload contains the routed assignee + computed SLA fields).
- `createTicket falls back to 'other' when category is missing`.
- `createTicket clamps priority to category floor when override is lower`.

Run all ticket tests; expect green. Commit `feat(tickets): route createTicket via category, priority, SLA snapshot`.

---

## Task 6: Update `RaiseTicketModal` with category + priority

**File:** `src/pipeline/components/tickets/RaiseTicketModal.tsx`

Use `subscribeToTicketCategories` on mount. Add:

- Category dropdown (required, default = first active category in sortOrder).
- Priority dropdown (default = selected category's `priorityFloor`; user may bump up but not below floor — disable lower options visually).
- When the user changes category, reset the priority to that category's floor (unless the user has manually overridden — track an `overridden` boolean).
- Submit calls `createTicket({ ...existing, categoryId, priorityOverride: priority })`.

Test added separately is not required (component-level tests for this modal don't exist in Phase 1). Manual smoke later.

Commit `feat(tickets): add category and priority fields to RaiseTicketModal`.

---

## Task 7: List filters by category + priority

**File:** `src/pipeline/pages/modules/tickets/TicketsListView.tsx`

Add two more `FilterField`s — Category (dropdown of active categories) and Priority (dropdown of `Low | Normal | High | Critical | All`). Wire to `useMemo` filtering.

Add a small badge component for priority (color tones: Low=muted, Normal=info, High=warning, Critical=critical).

Commit `feat(tickets): filter list by category and priority`.

---

## Task 8: Settings UI for managing categories

**File:** `src/pipeline/pages/modules/SettingsModule.tsx`

Add a new `'tickets-categories'` view. Gate to `Owner | Admin`. Render:

- Table of categories (label, priorityFloor, response SLA, resolve SLA, routing chain, active toggle, sort order).
- "Add category" button → modal with `CreateTicketCategoryPayload` fields.
- "Edit" → same modal pre-filled.
- "Activate/Deactivate" toggle calls `setCategoryActive`.

Also add a route: `/settings/tickets/categories` in `router.tsx`.

Commit `feat(tickets): add Settings UI for ticket categories`.

---

## Task 9: Seed defaults on first pipeline boot

**File:** Wherever the pipeline app does first-load initialization (search for an `App` mount or auth-context bootstrap). The pattern: call `ensureSeedCategories()` once after the first authenticated session of an Owner/Admin/Developer.

If no obvious place, add a small effect inside `TicketsModule.tsx`:

```tsx
useEffect(() => {
  ensureSeedCategories().catch((err) => logger.error('ticket_category.seed_failed', err))
}, [])
```

This is benign — `ensureSeedCategories()` is idempotent (no-op when collection already has docs).

Commit `feat(tickets): seed default categories on first load`.

---

## Task 10: Run the full test suite

`npx vitest run` → expect all ticket tests green. Type-check clean for tickets. Commit any small fixups.

---

## Task 11: Tag end of phase

`git tag -a tickets-phase-2 -m "Tickets overhaul — Phase 2 complete"` (do not push).

---

## Spec coverage check

| Spec item                                             | Task |
| ----------------------------------------------------- | ---- |
| §6.1 default categories                               | 1    |
| §6.2 round-robin, branch-first, cross-branch fallback | 3, 5 |
| §6.3 escalation chain captured at create              | 3, 5 |
| §11.2 `pipeline-ticket-categories` collection         | 2    |
| §3 capture: category + priority drives routing/SLA    | 5, 6 |

Items still deferred: duplicate detection (Phase 3), attachments (Phase 3), full resolution workspace (Phase 4), `slaWatcher` cron (Phase 5), customer-facing entry (Phase 6).
