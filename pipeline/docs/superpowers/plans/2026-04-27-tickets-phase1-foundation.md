# Tickets Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump the ticket schema to v2 (adds title, description, categoryId, priority, branchId, raisedByKind, watcherIds, attachments, linkedEntities, autoContext, slaSnapshot, escalation/merge/reopen pointers, schemaVersion), migrate existing docs in place, extract the existing `TicketsView` from `ReportsModule` into a new top-level **Tickets** module with role-gated routes, and add a placeholder ticket-detail route.

**Architecture:** Phase 1 is purely structural — no behavior changes for staff yet. The data model becomes forward-compatible with Phases 2–8, the new module replaces the embedded view, and `ReportsModule` no longer owns tickets. All reads stay backward-compatible (v1 docs without new fields still render). The `RaiseTicketModal` keeps the same 3 fields visually; it just writes v2 documents under the hood. Categories/priority logic itself comes in Phase 2.

**Tech Stack:** TypeScript 5, React 18, react-router-dom 6, Firebase Firestore (`asquare-app-db/pipeline-tickets`), Vitest, ESLint. Migration is a one-shot Node script run via `npx tsx`.

**Spec:** [docs/superpowers/specs/2026-04-27-tickets-overhaul-design.md](../specs/2026-04-27-tickets-overhaul-design.md) — Phase 1 covers items in §15 step 1 plus the §11.1 schema and §14 migration.

---

## File structure

| File                                                        | Status                | Responsibility                                                                                                                                                                               |
| ----------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pipeline/api/types.ts`                                 | Modify (around L1870) | Extend `Ticket` + `CreateTicketPayload`, add `Priority`, `TicketAttachment`, `TicketLinkedEntity`, `TicketAutoContext`, `TicketSlaSnapshot`, `RaisedByKind`. Add `'Tickets'` to `ModuleTab`. |
| `src/pipeline/api/tickets-firestore.ts`                     | Modify                | Update `mapTicket` to read both v1 and v2 docs; `createTicket` writes v2 with defaults; export `subscribeToTicket(id)` for the detail route.                                                 |
| `src/pipeline/components/tickets/RaiseTicketModal.tsx`      | Modify                | Keep current UX; populate v2 fields with defaults at submit time.                                                                                                                            |
| `src/pipeline/pages/modules/tickets/TicketsModule.tsx`      | Create                | Module shell — role-gated, currently renders the migrated list view.                                                                                                                         |
| `src/pipeline/pages/modules/tickets/TicketsListView.tsx`    | Create                | Holds the list + filters previously in `TicketsView` (cut from `ReportsModule.tsx`).                                                                                                         |
| `src/pipeline/pages/modules/tickets/TicketDetailRoute.tsx`  | Create                | Placeholder route at `/tickets/:id` — fetches the ticket and renders details read-only (full workspace lands in Phase 4).                                                                    |
| `src/pipeline/pages/modules/ReportsModule.tsx`              | Modify                | Remove `TicketsView` definition + `'tickets'` case; the route `/reports/tickets` redirects to `/tickets`.                                                                                    |
| `src/pipeline/features/navigation/module-manifest.ts`       | Modify                | Add `Tickets` tab with role gates.                                                                                                                                                           |
| `src/pipeline/app/router.tsx`                               | Modify                | Lazy-import `TicketsModule` + `TicketDetailRoute`; add `/tickets`, `/tickets/:id`; redirect `/reports/tickets` → `/tickets`.                                                                 |
| `scripts/migrate-tickets-2026-04.ts`                        | Create                | Idempotent migration of existing `pipeline-tickets` to schemaVersion 2.                                                                                                                      |
| `scripts/migrate-tickets-2026-04.test.ts`                   | Create                | Unit tests for the pure mapping function.                                                                                                                                                    |
| `src/pipeline/api/tickets-firestore.test.ts`                | Create                | Tests `mapTicket` against both v1 and v2 raw shapes.                                                                                                                                         |
| `src/pipeline/pages/modules/tickets/TicketsModule.test.tsx` | Create                | Smoke test that the module mounts and renders.                                                                                                                                               |

---

## Task 1: Extend ticket types and update `mapTicket` to read both v1 and v2

> **Note:** The type bump and the `mapTicket` rewrite are merged into one task because the new v2 fields are required on the `Ticket` interface — the existing `mapTicket` would fail type-check without populating them. Doing both in one commit keeps every commit on the branch type-clean.

**Files:**

- Modify: `src/pipeline/api/types.ts` (Tickets section, around L1870 + `ModuleTab` union)
- Modify: `src/pipeline/api/tickets-firestore.ts` (`mapTicket`)
- Test: `src/pipeline/api/tickets-firestore.test.ts` (create)

- [ ] **Step 1: Open `src/pipeline/api/types.ts` and locate the Tickets section**

The block starts at `// ── Tickets ──...` (around line 1870) and ends after `CreateTicketPayload`.

- [ ] **Step 2: Replace the Tickets section with the v2 schema**

Replace lines 1870–1897 with:

```ts
// ── Tickets ──────────────────────────────────────────────────────────────────

export type TicketStatus = 'Open' | 'In Progress' | 'Resolved' | 'Closed'

export type TicketPriority = 'Low' | 'Normal' | 'High' | 'Critical'

export type RaisedByKind = 'staff' | 'customer'

export type TicketAttachmentKind = 'image' | 'voice' | 'video'

export interface TicketAttachment {
  id: string
  kind: TicketAttachmentKind
  storagePath: string
  url: string
  sizeBytes: number
  mimeType: string
  uploadedAt: string
}

export type TicketLinkedEntityType = 'booking' | 'kart' | 'customer' | 'payment'

export interface TicketLinkedEntity {
  type: TicketLinkedEntityType
  id: string
  label: string
}

export interface TicketAutoContext {
  url?: string
  userAgent?: string
  appVersion?: string
  buildSha?: string
  lastErrorMessage?: string
  lastErrorAt?: string
}

export interface TicketSlaSnapshot {
  responseSeconds: number | null
  resolveSeconds: number
}

export interface Ticket {
  id: string
  schemaVersion: 1 | 2
  title: string
  description: string
  categoryId: string
  priority: TicketPriority
  tags: string[]
  status: TicketStatus

  role: Role
  raisedBy: string
  raisedByName: string
  raisedByKind: RaisedByKind
  branchId: string
  branchDisplayName: string

  // Phase-1 keeps the existing assignee fields under the new names.
  // `assignedTo` literal is preserved for backward compatibility with
  // dashboards that still read it; routing logic lands in Phase 2.
  assignedTo: 'Developer'
  assigneeId: string
  assigneeRole: Role
  assigneeName: string
  watcherIds: string[]

  attachments: TicketAttachment[]
  linkedEntities: TicketLinkedEntity[]
  autoContext: TicketAutoContext

  slaSnapshot: TicketSlaSnapshot | null
  responseDueAt: string | null
  resolveDueAt: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  resolutionNote: string | null
  rootCauseTag: string | null

  escalationLevel: number
  mergedInto: string | null
  reopenedFrom: string | null

  // Legacy fields kept for dashboards still reading the v1 shape.
  // Phase 2 removes consumers; Phase 4 removes the fields themselves.
  location: string
  locationDisplayName: string
  issue: string
  assignedToId: string
  assignedToName: string

  createdAt: string
  updatedAt: string
}

export interface CreateTicketPayload {
  role: Role
  location: string
  locationDisplayName: string
  issue: string
  raisedBy: string
  raisedByName: string
}
```

- [ ] **Step 3: Add `'Tickets'` to the `ModuleTab` union**

Search the file for `export type ModuleTab` (it's a union of string literals). Add `'Tickets'` to the union:

```ts
// before
export type ModuleTab =
  | 'Dashboard'
  | 'Shifts'
  // ...existing entries...
  | 'Settings'

// after
export type ModuleTab =
  | 'Dashboard'
  | 'Shifts'
  // ...existing entries...
  | 'Tickets'
  | 'Settings'
```

- [ ] **Step 4: Write the failing `mapTicket` test**

Create `src/pipeline/api/tickets-firestore.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { mapTicketForTest } from './tickets-firestore'

describe('mapTicket', () => {
  const v1Doc = {
    role: 'Cashier',
    raisedBy: 'user-1',
    raisedByName: 'Alice',
    location: 'vizag',
    locationDisplayName: 'Vizag',
    issue: 'Printer is jammed',
    status: 'Open',
    assignedTo: 'Developer',
    assignedToId: 'dev-1',
    assignedToName: 'Bob',
    createdAt: Timestamp.fromDate(new Date('2026-04-20T10:00:00Z')),
    updatedAt: Timestamp.fromDate(new Date('2026-04-20T10:00:00Z')),
  }

  it('maps a v1 document to v2 shape with defaults', () => {
    const t = mapTicketForTest('TKT-abc12345', v1Doc)
    expect(t.schemaVersion).toBe(1)
    expect(t.title).toBe('Printer is jammed')
    expect(t.description).toBe('Printer is jammed')
    expect(t.issue).toBe('Printer is jammed')
    expect(t.categoryId).toBe('other')
    expect(t.priority).toBe('Normal')
    expect(t.branchId).toBe('vizag')
    expect(t.branchDisplayName).toBe('Vizag')
    expect(t.raisedByKind).toBe('staff')
    expect(t.assigneeId).toBe('dev-1')
    expect(t.assigneeName).toBe('Bob')
    expect(t.assigneeRole).toBe('Developer')
    expect(t.attachments).toEqual([])
    expect(t.linkedEntities).toEqual([])
    expect(t.tags).toEqual([])
    expect(t.watcherIds).toEqual([])
    expect(t.escalationLevel).toBe(0)
    expect(t.mergedInto).toBeNull()
    expect(t.reopenedFrom).toBeNull()
    expect(t.slaSnapshot).toBeNull()
  })

  it('preserves v2 fields when present', () => {
    const v2Doc = {
      ...v1Doc,
      schemaVersion: 2,
      title: 'Custom title',
      description: 'Long description',
      categoryId: 'billing',
      priority: 'High',
      branchId: 'kakinada',
      branchDisplayName: 'Kakinada',
      raisedByKind: 'customer',
      assigneeId: 'cashier-1',
      assigneeName: 'Cara',
      assigneeRole: 'Cashier',
      tags: ['refund'],
      watcherIds: ['user-2'],
      escalationLevel: 1,
      attachments: [],
      linkedEntities: [{ type: 'booking', id: 'BK-1', label: 'Booking BK-1' }],
    }
    const t = mapTicketForTest('TKT-xyz', v2Doc)
    expect(t.schemaVersion).toBe(2)
    expect(t.title).toBe('Custom title')
    expect(t.description).toBe('Long description')
    expect(t.categoryId).toBe('billing')
    expect(t.priority).toBe('High')
    expect(t.branchId).toBe('kakinada')
    expect(t.assigneeRole).toBe('Cashier')
    expect(t.tags).toEqual(['refund'])
    expect(t.linkedEntities[0].id).toBe('BK-1')
    expect(t.escalationLevel).toBe(1)
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run src/pipeline/api/tickets-firestore.test.ts`

Expected: FAIL — `mapTicketForTest` is not exported, and `mapTicket` does not yet populate v2 fields.

- [ ] **Step 6: Rewrite `mapTicket` in `src/pipeline/api/tickets-firestore.ts`**

Replace the existing `mapTicket` function with this version, and add the test export at the end of the file:

```ts
function mapTicket(id: string, data: Record<string, unknown>): Ticket {
  const toISO = (val: unknown): string => {
    if (!val) return new Date().toISOString()
    if (typeof val === 'string') return val
    if (typeof val === 'object' && val !== null && 'toDate' in val) {
      return (val as { toDate: () => Date }).toDate().toISOString()
    }
    return new Date().toISOString()
  }

  const toISOOrNull = (val: unknown): string | null => {
    if (val === null || val === undefined) return null
    return toISO(val)
  }

  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
  const arrStr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  const arrObj = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

  const schemaVersion = data.schemaVersion === 2 ? 2 : 1

  const issue = str(data.issue)
  const description = str(data.description, issue)
  const title = str(data.title, issue.slice(0, 80) || 'Untitled ticket')

  const branchId = str(data.branchId, str(data.location))
  const branchDisplayName = str(data.branchDisplayName, str(data.locationDisplayName, branchId))

  const assigneeId = str(data.assigneeId, str(data.assignedToId))
  const assigneeName = str(data.assigneeName, str(data.assignedToName, 'Developer'))
  const assigneeRole = (data.assigneeRole as Ticket['assigneeRole']) ?? 'Developer'

  return {
    id,
    schemaVersion,
    title,
    description,
    categoryId: str(data.categoryId, 'other'),
    priority: (data.priority as Ticket['priority']) ?? 'Normal',
    tags: arrStr(data.tags),
    status: (data.status as TicketStatus) ?? 'Open',

    role: (data.role as Ticket['role']) ?? 'Admin',
    raisedBy: str(data.raisedBy),
    raisedByName: str(data.raisedByName),
    raisedByKind: (data.raisedByKind as Ticket['raisedByKind']) ?? 'staff',
    branchId,
    branchDisplayName,

    assignedTo: 'Developer',
    assigneeId,
    assigneeRole,
    assigneeName,
    watcherIds: arrStr(data.watcherIds),

    attachments: arrObj<TicketAttachment>(data.attachments),
    linkedEntities: arrObj<TicketLinkedEntity>(data.linkedEntities),
    autoContext: (data.autoContext as TicketAutoContext) ?? {},

    slaSnapshot: (data.slaSnapshot as TicketSlaSnapshot | null) ?? null,
    responseDueAt: toISOOrNull(data.responseDueAt),
    resolveDueAt: toISOOrNull(data.resolveDueAt),
    firstResponseAt: toISOOrNull(data.firstResponseAt),
    resolvedAt: toISOOrNull(data.resolvedAt),
    resolutionNote: (data.resolutionNote as string | null) ?? null,
    rootCauseTag: (data.rootCauseTag as string | null) ?? null,

    escalationLevel: typeof data.escalationLevel === 'number' ? data.escalationLevel : 0,
    mergedInto: (data.mergedInto as string | null) ?? null,
    reopenedFrom: (data.reopenedFrom as string | null) ?? null,

    location: str(data.location, branchId),
    locationDisplayName: str(data.locationDisplayName, branchDisplayName),
    issue,
    assignedToId: str(data.assignedToId, assigneeId),
    assignedToName: str(data.assignedToName, assigneeName),

    createdAt: toISO(data.createdAt),
    updatedAt: toISO(data.updatedAt),
  }
}

// Test-only export. Not part of the public API.
export const mapTicketForTest = mapTicket
```

Update the type imports at the top of the file (replace the existing single-line import):

```ts
import type {
  Ticket,
  TicketStatus,
  CreateTicketPayload,
  TicketAttachment,
  TicketLinkedEntity,
  TicketAutoContext,
  TicketSlaSnapshot,
} from './types'
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/pipeline/api/tickets-firestore.test.ts`

Expected: PASS — both cases.

- [ ] **Step 8: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/pipeline/api/types.ts src/pipeline/api/tickets-firestore.ts src/pipeline/api/tickets-firestore.test.ts
git commit -m "feat(tickets): bump schema to v2 and read both v1 and v2 documents"
```

---

## Task 2 (was) — merged into Task 1

> Skipped. The mapTicket rewrite was merged into Task 1 to keep the type bump and reader update in a single type-clean commit.

<details>
<summary>Original (kept for reference only — do not execute)</summary>

## Task 2 (skipped): Update `mapTicket` to handle both v1 and v2 documents

**Files:**

- Modify: `src/pipeline/api/tickets-firestore.ts:25-49`
- Test: `src/pipeline/api/tickets-firestore.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/api/tickets-firestore.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { mapTicketForTest } from './tickets-firestore'

describe('mapTicket', () => {
  const v1Doc = {
    role: 'Cashier',
    raisedBy: 'user-1',
    raisedByName: 'Alice',
    location: 'vizag',
    locationDisplayName: 'Vizag',
    issue: 'Printer is jammed',
    status: 'Open',
    assignedTo: 'Developer',
    assignedToId: 'dev-1',
    assignedToName: 'Bob',
    createdAt: Timestamp.fromDate(new Date('2026-04-20T10:00:00Z')),
    updatedAt: Timestamp.fromDate(new Date('2026-04-20T10:00:00Z')),
  }

  it('maps a v1 document to v2 shape with defaults', () => {
    const t = mapTicketForTest('TKT-abc12345', v1Doc)
    expect(t.schemaVersion).toBe(1)
    expect(t.title).toBe('Printer is jammed')
    expect(t.description).toBe('Printer is jammed')
    expect(t.issue).toBe('Printer is jammed')
    expect(t.categoryId).toBe('other')
    expect(t.priority).toBe('Normal')
    expect(t.branchId).toBe('vizag')
    expect(t.branchDisplayName).toBe('Vizag')
    expect(t.raisedByKind).toBe('staff')
    expect(t.assigneeId).toBe('dev-1')
    expect(t.assigneeName).toBe('Bob')
    expect(t.assigneeRole).toBe('Developer')
    expect(t.attachments).toEqual([])
    expect(t.linkedEntities).toEqual([])
    expect(t.tags).toEqual([])
    expect(t.watcherIds).toEqual([])
    expect(t.escalationLevel).toBe(0)
    expect(t.mergedInto).toBeNull()
    expect(t.reopenedFrom).toBeNull()
    expect(t.slaSnapshot).toBeNull()
  })

  it('preserves v2 fields when present', () => {
    const v2Doc = {
      ...v1Doc,
      schemaVersion: 2,
      title: 'Custom title',
      description: 'Long description',
      categoryId: 'billing',
      priority: 'High',
      branchId: 'kakinada',
      branchDisplayName: 'Kakinada',
      raisedByKind: 'customer',
      assigneeId: 'cashier-1',
      assigneeName: 'Cara',
      assigneeRole: 'Cashier',
      tags: ['refund'],
      watcherIds: ['user-2'],
      escalationLevel: 1,
      attachments: [],
      linkedEntities: [{ type: 'booking', id: 'BK-1', label: 'Booking BK-1' }],
    }
    const t = mapTicketForTest('TKT-xyz', v2Doc)
    expect(t.schemaVersion).toBe(2)
    expect(t.title).toBe('Custom title')
    expect(t.description).toBe('Long description')
    expect(t.categoryId).toBe('billing')
    expect(t.priority).toBe('High')
    expect(t.branchId).toBe('kakinada')
    expect(t.assigneeRole).toBe('Cashier')
    expect(t.tags).toEqual(['refund'])
    expect(t.linkedEntities[0].id).toBe('BK-1')
    expect(t.escalationLevel).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pipeline/api/tickets-firestore.test.ts`

Expected: FAIL — `mapTicketForTest` is not exported.

- [ ] **Step 3: Replace `mapTicket` in `src/pipeline/api/tickets-firestore.ts`**

Replace the existing `mapTicket` function (lines 25–49) with the version below, and add the test export at the end of the file (before the last `}` of the module if there is one, otherwise as a top-level statement):

```ts
function mapTicket(id: string, data: Record<string, unknown>): Ticket {
  const toISO = (val: unknown): string => {
    if (!val) return new Date().toISOString()
    if (typeof val === 'string') return val
    if (typeof val === 'object' && val !== null && 'toDate' in val) {
      return (val as { toDate: () => Date }).toDate().toISOString()
    }
    return new Date().toISOString()
  }

  const toISOOrNull = (val: unknown): string | null => {
    if (val === null || val === undefined) return null
    return toISO(val)
  }

  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
  const arrStr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  const arrObj = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

  const schemaVersion = data.schemaVersion === 2 ? 2 : 1

  const issue = str(data.issue)
  const description = str(data.description, issue)
  const title = str(data.title, issue.slice(0, 80) || 'Untitled ticket')

  const branchId = str(data.branchId, str(data.location))
  const branchDisplayName = str(data.branchDisplayName, str(data.locationDisplayName, branchId))

  const assigneeId = str(data.assigneeId, str(data.assignedToId))
  const assigneeName = str(data.assigneeName, str(data.assignedToName, 'Developer'))
  const assigneeRole = (data.assigneeRole as Ticket['assigneeRole']) ?? 'Developer'

  return {
    id,
    schemaVersion,
    title,
    description,
    categoryId: str(data.categoryId, 'other'),
    priority: (data.priority as Ticket['priority']) ?? 'Normal',
    tags: arrStr(data.tags),
    status: (data.status as TicketStatus) ?? 'Open',

    role: (data.role as Ticket['role']) ?? 'Admin',
    raisedBy: str(data.raisedBy),
    raisedByName: str(data.raisedByName),
    raisedByKind: (data.raisedByKind as Ticket['raisedByKind']) ?? 'staff',
    branchId,
    branchDisplayName,

    assignedTo: 'Developer',
    assigneeId,
    assigneeRole,
    assigneeName,
    watcherIds: arrStr(data.watcherIds),

    attachments: arrObj<TicketAttachment>(data.attachments),
    linkedEntities: arrObj<TicketLinkedEntity>(data.linkedEntities),
    autoContext: (data.autoContext as TicketAutoContext) ?? {},

    slaSnapshot: (data.slaSnapshot as TicketSlaSnapshot | null) ?? null,
    responseDueAt: toISOOrNull(data.responseDueAt),
    resolveDueAt: toISOOrNull(data.resolveDueAt),
    firstResponseAt: toISOOrNull(data.firstResponseAt),
    resolvedAt: toISOOrNull(data.resolvedAt),
    resolutionNote: (data.resolutionNote as string | null) ?? null,
    rootCauseTag: (data.rootCauseTag as string | null) ?? null,

    escalationLevel: typeof data.escalationLevel === 'number' ? data.escalationLevel : 0,
    mergedInto: (data.mergedInto as string | null) ?? null,
    reopenedFrom: (data.reopenedFrom as string | null) ?? null,

    location: str(data.location, branchId),
    locationDisplayName: str(data.locationDisplayName, branchDisplayName),
    issue,

    createdAt: toISO(data.createdAt),
    updatedAt: toISO(data.updatedAt),
  }
}

// Test-only export. Not part of the public API.
export const mapTicketForTest = mapTicket
```

Add the new type imports at the top of the file:

```ts
import type {
  Ticket,
  TicketStatus,
  CreateTicketPayload,
  TicketAttachment,
  TicketLinkedEntity,
  TicketAutoContext,
  TicketSlaSnapshot,
} from './types'
```

(Replace the existing `import type { Ticket, TicketStatus, CreateTicketPayload } from './types'` line.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/pipeline/api/tickets-firestore.test.ts`

Expected: PASS — both cases.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/api/tickets-firestore.ts src/pipeline/api/tickets-firestore.test.ts
git commit -m "feat(tickets): map v1 and v2 documents in mapTicket"
```

</details>

---

## Task 3: `createTicket` writes v2 documents

**Files:**

- Modify: `src/pipeline/api/tickets-firestore.ts:64-83`

- [ ] **Step 1: Update `createTicket`**

Replace the existing `createTicket` function with:

```ts
export async function createTicket(payload: CreateTicketPayload): Promise<string> {
  const id = generateTicketId()
  const developer = await getFirstActiveDeveloper()
  const ref = doc(getTicketsCollection(), id)
  await setDoc(ref, {
    schemaVersion: 2,

    title: payload.issue.slice(0, 80) || 'Untitled ticket',
    description: payload.issue,
    issue: payload.issue, // keep v1 mirror until Phase 4 cleanup
    categoryId: 'other',
    priority: 'Normal',
    tags: [],
    status: 'Open' as TicketStatus,

    role: payload.role,
    raisedBy: payload.raisedBy,
    raisedByName: payload.raisedByName,
    raisedByKind: 'staff',

    branchId: payload.location,
    branchDisplayName: payload.locationDisplayName,
    location: payload.location, // v1 mirror
    locationDisplayName: payload.locationDisplayName, // v1 mirror

    assignedTo: 'Developer',
    assigneeId: developer.id,
    assigneeRole: 'Developer',
    assigneeName: developer.name,
    assignedToId: developer.id, // v1 mirror
    assignedToName: developer.name, // v1 mirror
    watcherIds: [],

    attachments: [],
    linkedEntities: [],
    autoContext: {},

    slaSnapshot: null,
    responseDueAt: null,
    resolveDueAt: null,
    firstResponseAt: null,
    resolvedAt: null,
    resolutionNote: null,
    rootCauseTag: null,

    escalationLevel: 0,
    mergedInto: null,
    reopenedFrom: null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  logger.info('ticket.created', {
    ticketId: id,
    assignedTo: developer.name,
    location: payload.location,
  })
  return id
}
```

- [ ] **Step 2: Add a `subscribeToTicket(id, ...)` helper for the detail route**

Append to the same file (after `updateTicketStatus`):

```ts
export function subscribeToTicket(
  ticketId: string,
  onData: (ticket: Ticket | null) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const ref = doc(getTicketsCollection(), ticketId)
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null)
        return
      }
      onData(mapTicket(snap.id, snap.data() as Record<string, unknown>))
    },
    onError,
  )
}
```

Add `import { onSnapshot, doc } from 'firebase/firestore'` if not already imported (they are — leave alone).

- [ ] **Step 3: Re-export from `tickets.ts`**

Modify `src/pipeline/api/tickets.ts` to:

```ts
export {
  createTicket,
  subscribeToTickets,
  subscribeToTicket,
  subscribeRecentTickets,
  updateTicketStatus,
} from './tickets-firestore'
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/api/tickets-firestore.ts src/pipeline/api/tickets.ts
git commit -m "feat(tickets): write v2 documents and add subscribeToTicket"
```

---

## Task 4: Migration script — `scripts/migrate-tickets-2026-04.ts`

**Files:**

- Create: `scripts/migrate-tickets-2026-04.ts`
- Test: `scripts/migrate-tickets-2026-04.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/migrate-tickets-2026-04.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildV2Patch } from './migrate-tickets-2026-04'

describe('buildV2Patch', () => {
  it('returns null when document is already v2', () => {
    expect(buildV2Patch({ schemaVersion: 2, issue: 'x' })).toBeNull()
  })

  it('maps a v1 document to a v2 patch with defaults', () => {
    const patch = buildV2Patch({
      issue: 'Card reader is offline at counter 2',
      location: 'rajahmundry',
      locationDisplayName: 'Rajahmundry',
      assignedToId: 'dev-1',
      assignedToName: 'Dev',
    })
    expect(patch).not.toBeNull()
    expect(patch!.schemaVersion).toBe(2)
    expect(patch!.title).toBe('Card reader is offline at counter 2')
    expect(patch!.description).toBe('Card reader is offline at counter 2')
    expect(patch!.categoryId).toBe('other')
    expect(patch!.priority).toBe('Normal')
    expect(patch!.branchId).toBe('rajahmundry')
    expect(patch!.branchDisplayName).toBe('Rajahmundry')
    expect(patch!.raisedByKind).toBe('staff')
    expect(patch!.assigneeId).toBe('dev-1')
    expect(patch!.assigneeName).toBe('Dev')
    expect(patch!.assigneeRole).toBe('Developer')
    expect(patch!.attachments).toEqual([])
    expect(patch!.linkedEntities).toEqual([])
    expect(patch!.tags).toEqual([])
    expect(patch!.watcherIds).toEqual([])
    expect(patch!.escalationLevel).toBe(0)
    expect(patch!.mergedInto).toBeNull()
    expect(patch!.reopenedFrom).toBeNull()
  })

  it('truncates very long issues to a 80-char title', () => {
    const longIssue = 'a'.repeat(200)
    const patch = buildV2Patch({ issue: longIssue, location: 'vizag' })
    expect(patch!.title).toHaveLength(80)
    expect(patch!.description).toBe(longIssue)
  })

  it('falls back when location is missing', () => {
    const patch = buildV2Patch({ issue: 'No location set' })
    expect(patch!.branchId).toBe('')
    expect(patch!.branchDisplayName).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run scripts/migrate-tickets-2026-04.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the migration script**

Create `scripts/migrate-tickets-2026-04.ts`:

```ts
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const COLLECTION = 'pipeline-tickets'

export interface RawTicket {
  schemaVersion?: number
  issue?: string
  title?: string
  description?: string
  categoryId?: string
  priority?: string
  tags?: string[]
  status?: string
  role?: string
  raisedBy?: string
  raisedByName?: string
  raisedByKind?: string
  location?: string
  locationDisplayName?: string
  branchId?: string
  branchDisplayName?: string
  assignedToId?: string
  assignedToName?: string
  assigneeId?: string
  assigneeName?: string
  assigneeRole?: string
  watcherIds?: string[]
  attachments?: unknown[]
  linkedEntities?: unknown[]
  autoContext?: unknown
  slaSnapshot?: unknown
  responseDueAt?: unknown
  resolveDueAt?: unknown
  firstResponseAt?: unknown
  resolvedAt?: unknown
  resolutionNote?: unknown
  rootCauseTag?: unknown
  escalationLevel?: number
  mergedInto?: unknown
  reopenedFrom?: unknown
}

export interface V2Patch {
  schemaVersion: 2
  title: string
  description: string
  categoryId: string
  priority: 'Normal'
  tags: string[]
  raisedByKind: 'staff' | 'customer'
  branchId: string
  branchDisplayName: string
  assigneeId: string
  assigneeRole: 'Developer'
  assigneeName: string
  watcherIds: string[]
  attachments: unknown[]
  linkedEntities: unknown[]
  autoContext: Record<string, unknown>
  slaSnapshot: null
  responseDueAt: null
  resolveDueAt: null
  firstResponseAt: null
  resolvedAt: null
  resolutionNote: null
  rootCauseTag: null
  escalationLevel: number
  mergedInto: null
  reopenedFrom: null
}

export function buildV2Patch(doc: RawTicket): V2Patch | null {
  if (doc.schemaVersion === 2) return null

  const issue = typeof doc.issue === 'string' ? doc.issue : ''
  const title =
    (typeof doc.title === 'string' && doc.title) || issue.slice(0, 80) || 'Untitled ticket'
  const description = (typeof doc.description === 'string' && doc.description) || issue

  const branchId = (typeof doc.branchId === 'string' && doc.branchId) || (doc.location ?? '')
  const branchDisplayName =
    (typeof doc.branchDisplayName === 'string' && doc.branchDisplayName) ||
    (doc.locationDisplayName ?? '')

  return {
    schemaVersion: 2,
    title,
    description,
    categoryId: doc.categoryId ?? 'other',
    priority: 'Normal',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    raisedByKind: doc.raisedByKind === 'customer' ? 'customer' : 'staff',
    branchId,
    branchDisplayName,
    assigneeId: doc.assigneeId ?? doc.assignedToId ?? '',
    assigneeRole: 'Developer',
    assigneeName: doc.assigneeName ?? doc.assignedToName ?? 'Developer',
    watcherIds: Array.isArray(doc.watcherIds) ? doc.watcherIds : [],
    attachments: Array.isArray(doc.attachments) ? doc.attachments : [],
    linkedEntities: Array.isArray(doc.linkedEntities) ? doc.linkedEntities : [],
    autoContext:
      typeof doc.autoContext === 'object' && doc.autoContext !== null
        ? (doc.autoContext as Record<string, unknown>)
        : {},
    slaSnapshot: null,
    responseDueAt: null,
    resolveDueAt: null,
    firstResponseAt: null,
    resolvedAt: null,
    resolutionNote: null,
    rootCauseTag: null,
    escalationLevel: typeof doc.escalationLevel === 'number' ? doc.escalationLevel : 0,
    mergedInto: null,
    reopenedFrom: null,
  }
}

async function main() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path.')
    process.exit(1)
  }
  const serviceAccount = JSON.parse(readFileSync(resolve(credPath), 'utf8'))
  const dryRun = process.argv.includes('--dry-run')

  if (getApps().length === 0) {
    initializeApp({ credential: cert(serviceAccount) })
  }
  const db = getFirestore('asquare-app-db')

  const snap = await db.collection(COLLECTION).get()
  let migrated = 0
  let skipped = 0

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as RawTicket
    const patch = buildV2Patch(data)
    if (!patch) {
      skipped += 1
      continue
    }
    if (dryRun) {
      console.log(`[dry-run] would migrate ${docSnap.id} → schemaVersion=2`)
    } else {
      // updatedAt is intentionally NOT bumped — preserve original "last activity" time.
      await docSnap.ref.update(patch as Record<string, unknown>)
    }
    migrated += 1
  }

  console.log(
    `migrate-tickets-2026-04: migrated=${migrated} skipped=${skipped} total=${snap.size} dryRun=${dryRun}`,
  )
}

if (process.argv[1] && process.argv[1].endsWith('migrate-tickets-2026-04.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/migrate-tickets-2026-04.test.ts`

Expected: PASS — all four cases.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-tickets-2026-04.ts scripts/migrate-tickets-2026-04.test.ts
git commit -m "feat(tickets): add idempotent v1→v2 migration script"
```

> **Note:** Do NOT run the migration against production yet. The migration is run in Task 13 only after the rest of Phase 1 ships and is verified in dev.

---

## Task 5: Add `Tickets` to module manifest

**Files:**

- Modify: `src/pipeline/features/navigation/module-manifest.ts`

- [ ] **Step 1: Add the tab definition**

In `moduleTabs`, after the `Reports` entry add:

```ts
{ id: 'Tickets', label: 'Tickets', path: '/tickets' },
```

- [ ] **Step 2: Add `'Tickets'` to the role permission lists**

For each of the role entries below, add `'Tickets'` to its `tabs` array (alphabetical placement near `Reports`):

- `Owner` — add
- `Admin` — add
- `Cashier` — add
- `Telecaller` — add
- `TrackMarshall` — add
- `Editor` — add
- `Developer` — add
- `Backend` — add
- `Incharge` — add (if a permission entry exists; if not, skip)

Do **not** add to `ThirdParty`.

Example (for Owner — apply the same pattern to others):

```ts
{
  role: 'Owner',
  tabs: [
    'Dashboard',
    // ...existing entries through 'Reports'...
    'Reports',
    'Tickets',
    'Admin',
    // ...rest...
  ],
},
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/features/navigation/module-manifest.ts
git commit -m "feat(tickets): register Tickets tab in navigation manifest"
```

---

## Task 6: Create the `Tickets` module shell

**Files:**

- Create: `src/pipeline/pages/modules/tickets/TicketsModule.tsx`
- Create: `src/pipeline/pages/modules/tickets/TicketsListView.tsx`
- Create: `src/pipeline/pages/modules/tickets/TicketsModule.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Create `src/pipeline/pages/modules/tickets/TicketsModule.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TicketsModule from './TicketsModule'

vi.mock('../../../api/tickets', () => ({
  subscribeToTickets: (_onData: unknown, _onError: unknown) => () => {},
}))

vi.mock('../../../features/auth/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1', name: 'U', role: 'Owner' } } }),
}))

vi.mock('../../../features/toast/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

describe('TicketsModule', () => {
  it('renders the list view heading', () => {
    render(
      <MemoryRouter initialEntries={['/tickets']}>
        <TicketsModule />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /tickets/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pipeline/pages/modules/tickets/TicketsModule.test.tsx`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Cut `TicketsView` from `ReportsModule.tsx` into `TicketsListView.tsx`**

Open `src/pipeline/pages/modules/ReportsModule.tsx`. Cut these blocks (locations approximate):

- `const TICKET_STATUS_OPTIONS: TicketStatus[] = [...]` (≈L1800)
- `const ticketStatusTone = (status: TicketStatus): string => {...}` (≈L1802)
- The full `const TicketsView = ({ isOwnerOrDev }: ...) => { ... }` component (≈L1817 to its closing brace)

Paste them into a new file `src/pipeline/pages/modules/tickets/TicketsListView.tsx`, rename the component to `TicketsListView`, and use these imports at the top:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ticket, TicketStatus } from '../../../api/types'
import { subscribeToTickets, updateTicketStatus } from '../../../api/tickets'
import { useToast } from '../../../features/toast/toast-context'
import { FilterBar, FilterField } from '../../../components/ui/FilterBar'

export const TicketsListView = ({ isOwnerOrDev }: { isOwnerOrDev: boolean }) => {
  // body identical to the prior TicketsView
}
```

If the cut body references any helper component that lives only inside `ReportsModule.tsx` (e.g. a local skeleton), promote it to its own export inside `src/pipeline/components/ui/` first or copy it inline at the top of `TicketsListView.tsx`. Run `npx tsc -p tsconfig.app.json --noEmit` after the cut and resolve every missing-import error before moving on.

Inside `ReportsModule.tsx`, replace the deleted `TicketsView` definition with a transitional re-export so the file still compiles and the existing `<TicketsView ... />` usage in the view switch keeps working until Task 8 deletes it:

```tsx
import { TicketsListView as TicketsView } from './tickets/TicketsListView'
```

- [ ] **Step 4: Create `TicketsModule.tsx`**

```tsx
import { useAuth } from '../../../features/auth/auth-context'
import { TicketsListView } from './TicketsListView'

const TicketsModule = () => {
  const { session } = useAuth()
  const role = session?.user.role ?? 'ThirdParty'
  const isOwnerOrDev = role === 'Owner' || role === 'Developer' || role === 'Admin'

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-text">Tickets</h1>
      </header>
      <TicketsListView isOwnerOrDev={isOwnerOrDev} />
    </div>
  )
}

export default TicketsModule
```

(Phase 1 keeps the `isOwnerOrDev` filter behavior identical to today. Per-role queues land in Phase 4.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/pipeline/pages/modules/tickets/TicketsModule.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/pages/modules/tickets/ src/pipeline/pages/modules/ReportsModule.tsx
git commit -m "feat(tickets): extract TicketsListView and add TicketsModule shell"
```

---

## Task 7: Placeholder ticket detail route

**Files:**

- Create: `src/pipeline/pages/modules/tickets/TicketDetailRoute.tsx`

- [ ] **Step 1: Implement the placeholder detail page**

```tsx
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { subscribeToTicket } from '../../../api/tickets'
import type { Ticket } from '../../../api/types'

const TicketDetailRoute = () => {
  const { ticketId } = useParams<{ ticketId: string }>()
  const [ticket, setTicket] = useState<Ticket | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticketId) return
    const unsub = subscribeToTicket(
      ticketId,
      (t) => setTicket(t),
      (err) => setError(err.message),
    )
    return () => unsub()
  }, [ticketId])

  if (!ticketId) return null
  if (error) {
    return <div className="p-6 text-sm text-critical">Failed to load ticket: {error}</div>
  }
  if (ticket === undefined) {
    return <div className="p-6 text-sm text-muted">Loading ticket…</div>
  }
  if (ticket === null) {
    return (
      <div className="p-6 text-sm text-muted">
        Ticket not found.{' '}
        <Link className="text-info underline" to="/tickets">
          Back to list
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <Link className="text-xs text-muted underline" to="/tickets">
        ← Back to tickets
      </Link>
      <header>
        <h1 className="font-display text-xl font-semibold text-text">{ticket.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {ticket.id} · {ticket.branchDisplayName} · {ticket.priority} · {ticket.status}
        </p>
      </header>
      <section className="rounded-lg border border-border/60 bg-surface p-4 text-sm text-text">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Description</h2>
        <p className="whitespace-pre-wrap">{ticket.description}</p>
      </section>
      <p className="text-xs text-muted">Full resolution workspace lands in Phase 4.</p>
    </div>
  )
}

export default TicketDetailRoute
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/tickets/TicketDetailRoute.tsx
git commit -m "feat(tickets): add placeholder ticket detail route"
```

---

## Task 8: Remove `TicketsView` ownership from `ReportsModule`

**Files:**

- Modify: `src/pipeline/pages/modules/ReportsModule.tsx`

- [ ] **Step 1: Delete the inlined `TicketsView` re-export and the `'tickets'` view case**

In `ReportsModule.tsx`:

1. Remove the `TICKET_STATUS_OPTIONS`, `ticketStatusTone`, and any other ticket-only helpers if any remain inlined (they were moved to `TicketsListView.tsx` in Task 6).
2. Remove the `import { TicketsListView as TicketsView } from './tickets/TicketsListView'` re-export added in Task 6.
3. Remove the `case 'tickets'` branch in the view switch — the route `/reports/tickets` will redirect (Task 9).
4. Remove the now-unused imports: `subscribeToTickets`, `updateTicketStatus`, `Ticket`, `TicketStatus` from `'../../api/tickets'` and `'../../api/types'` (only if no other code in the file uses them).

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: PASS — no unused-import errors.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/ReportsModule.tsx
git commit -m "refactor(reports): remove tickets view (moved to Tickets module)"
```

---

## Task 9: Wire up routes in `router.tsx`

**Files:**

- Modify: `src/pipeline/app/router.tsx`

- [ ] **Step 1: Lazy-import the new module + detail route**

Add near the other module imports (around L20–L51):

```tsx
const TicketsModule = lazy(() => import('../pages/modules/tickets/TicketsModule'))
const TicketDetailRoute = lazy(() => import('../pages/modules/tickets/TicketDetailRoute'))
```

- [ ] **Step 2: Replace the existing `/reports/tickets` route with a redirect, and add the new `/tickets` routes**

Find the existing route (around L793–L800):

```tsx
<Route
  path="/reports/tickets"
  element={
    <ProtectedRoute>
      <ReportsModule view="tickets" />
    </ProtectedRoute>
  }
/>
```

Replace with:

```tsx
<Route path="/reports/tickets" element={<Navigate replace to="/tickets" />} />
<Route
  path="/tickets"
  element={
    <ProtectedRoute>
      <TicketsModule />
    </ProtectedRoute>
  }
/>
<Route
  path="/tickets/:ticketId"
  element={
    <ProtectedRoute>
      <TicketDetailRoute />
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run lint`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/app/router.tsx
git commit -m "feat(tickets): add /tickets and /tickets/:id routes"
```

---

## Task 10: Manual smoke test in dev

**Files:** none

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Sign in as Owner and verify**

Manually verify in the browser:

1. The sidebar shows a **Tickets** entry.
2. Clicking it navigates to `/tickets` and renders the existing list.
3. Filters (status, location) still work.
4. Typing `/reports/tickets` redirects to `/tickets`.
5. Raising a new ticket via `RaiseTicketButton` succeeds and appears in the list.
6. Visiting `/tickets/<id>` for a real ticket shows the placeholder detail page with title, branch, priority, status, description.

Document any failures in this task and fix before continuing.

- [ ] **Step 3: Commit any fixes**

If fixes were needed:

```bash
git add -A
git commit -m "fix(tickets): <describe the fix>"
```

---

## Task 11: Run the full test suite

**Files:** none

- [ ] **Step 1: Run unit + integration tests**

Run: `npm run test:run`

Expected: PASS — including the new tests from Tasks 2, 4, and 6.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 3: Run type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: PASS.

- [ ] **Step 4: If any of the above fail, fix and commit**

```bash
git add -A
git commit -m "fix(tickets): resolve <test|lint|typecheck> failures"
```

---

## Task 12: Dry-run the migration against dev

**Files:** none

- [ ] **Step 1: Run the script with `--dry-run`**

Run:

```bash
GOOGLE_APPLICATION_CREDENTIALS=./.firebase/dev-service-account.json npx tsx scripts/migrate-tickets-2026-04.ts --dry-run
```

(Substitute the actual service-account path used in the project's `.firebase/` folder. If a dev service account is unavailable, run against a Firebase emulator with the `pipeline-tickets` collection seeded.)

Expected: prints `[dry-run] would migrate <id>` lines for each v1 doc; ends with `migrated=N skipped=0 total=N dryRun=true`. **No documents written.**

- [ ] **Step 2: Confirm idempotency on a fresh run**

If any docs in dev are already v2 (e.g., created via Task 3 since the schema was bumped), the script should skip them. Verify the `skipped` count includes those.

---

## Task 13: Run the migration for real (dev / staging)

**Files:** none (data-only)

- [ ] **Step 1: Backup `pipeline-tickets`**

Run:

```bash
gcloud firestore export gs://<your-bucket>/backups/pre-tickets-v2-$(date +%Y%m%d) \
  --collection-ids=pipeline-tickets \
  --database=asquare-app-db
```

(If `gcloud` is not configured, create a manual JSON dump via a one-off script before proceeding.)

- [ ] **Step 2: Run the migration**

```bash
GOOGLE_APPLICATION_CREDENTIALS=./.firebase/dev-service-account.json npx tsx scripts/migrate-tickets-2026-04.ts
```

Expected: prints `migrated=N skipped=0 total=N` on first run. Re-running prints `migrated=0 skipped=N total=N` (idempotency check).

- [ ] **Step 3: Spot-check three migrated documents in the Firestore console**

Verify on three random `pipeline-tickets/*` docs:

- `schemaVersion === 2`
- `title` is set (≤80 chars)
- `description` matches old `issue`
- `categoryId === 'other'`
- `priority === 'Normal'`
- `branchId` matches old `location`
- `assigneeId` / `assigneeRole` / `assigneeName` populated
- `attachments`, `linkedEntities`, `tags`, `watcherIds` are empty arrays
- `escalationLevel === 0`, `mergedInto === null`, `reopenedFrom === null`

- [ ] **Step 4: Re-test the app**

Reload `/tickets` in the browser. The list should still render correctly using the v2 reads.

- [ ] **Step 5: Document the migration run**

No commit — this is a data operation. Record the run timestamp + counts in the team's ops log.

> **Production migration is gated on this Phase 1 plan reaching production via the normal release flow.** Re-run the same script against prod with the prod service account when Phase 1 is promoted.

---

## Task 14: Final commit and end-of-phase tag

**Files:** none

- [ ] **Step 1: Verify the working tree is clean**

Run: `git status`

Expected: working tree clean.

- [ ] **Step 2: Tag the phase**

```bash
git tag -a tickets-phase-1 -m "Tickets overhaul — Phase 1 (Foundation) complete"
```

(Push the tag manually when convenient; do not auto-push.)

---

## Spec coverage check (Phase 1 only)

| Spec item                          | Task            |
| ---------------------------------- | --------------- |
| §11.1 schema v2 (Ticket interface) | Task 1          |
| §11.1 backward read of v1 docs     | Task 2          |
| §11.1 v2 write on create           | Task 3          |
| §14 idempotent migration script    | Tasks 4, 12, 13 |
| §13 module structure (`tickets/`)  | Tasks 6, 7      |
| §15 Phase 1 — move existing view   | Tasks 6, 8      |
| §15 Phase 1 — role-gated routes    | Tasks 5, 9      |
| §15 Phase 1 — types                | Task 1          |

Items intentionally deferred to later phases (do **not** address in Phase 1):

- Categories config + Settings UI (Phase 2)
- Routing logic + SLA snapshot at create (Phase 2)
- Attachments / auto-context / duplicate detection (Phase 3)
- Comments / activity log / quick actions / merge / reopen (Phase 4)
- Notifications + `slaWatcher` (Phase 5)
- Customer-facing entry points (Phase 6)
- Analytics dashboards + exports (Phase 7)
- KB + canned responses (Phase 8)
