# Tickets Phase 7 — Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Build the analytics surfaces — Owner dashboard, Incharge dashboard, "My Tickets" topbar entry, Heatmap, Kart-failure report, CSV export, and a Sunday weekly PDF (already stubbed in Phase 5; this phase fleshes the body).

---

## File structure

| File                                                            | Status | Responsibility                                                                                               |
| --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `src/pipeline/api/ticket-analytics.ts`                          | Create | Pure aggregations: `aggregateByBranch`, `aggregateByCategory`, `computeMTTR`, `breachRate`, `heatmapMatrix`. |
| `src/pipeline/api/ticket-analytics.test.ts`                     | Create | Unit tests for each aggregation.                                                                             |
| `src/pipeline/pages/modules/tickets/TicketsAnalyticsView.tsx`   | Create | Owner-tier dashboard shell.                                                                                  |
| `src/pipeline/pages/modules/tickets/TicketsBranchView.tsx`      | Create | Incharge-tier dashboard shell (per branch).                                                                  |
| `src/pipeline/pages/modules/tickets/TicketsHeatmapView.tsx`     | Create | Heatmap (branch × category × hour).                                                                          |
| `src/pipeline/pages/modules/tickets/TicketsKartFailureView.tsx` | Create | Kart-serial aggregation for Track/Safety tickets.                                                            |
| `src/pipeline/pages/modules/tickets/MyTicketsView.tsx`          | Create | "Assigned to me" / "Raised by me" / "Mentioned in" tabs.                                                     |
| `src/pipeline/pages/modules/tickets/TicketsModule.tsx`          | Modify | Add nav between list / analytics / branch / heatmap / kart / my views.                                       |
| `src/pipeline/api/ticket-csv-export.ts`                         | Create | Pure CSV builder; tests.                                                                                     |
| `src/pipeline/api/ticket-csv-export.test.ts`                    | Create |                                                                                                              |
| `functions/api/ticket-owner-weekly.js`                          | Modify | Replace stub log with real aggregation + JSON email body (PDF rendering deferred to ops).                    |

---

## Task 1: Pure analytics helpers

**File:** `src/pipeline/api/ticket-analytics.ts`

```ts
import type { Ticket } from './types'

export interface BucketCount {
  key: string
  label: string
  count: number
}

export function aggregateByBranch(tickets: ReadonlyArray<Ticket>): BucketCount[] {
  const map = new Map<string, { label: string; count: number }>()
  for (const t of tickets) {
    const key = t.branchId
    const existing = map.get(key)
    if (existing) existing.count += 1
    else map.set(key, { label: t.branchDisplayName || key, count: 1 })
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.count - a.count)
}

export function aggregateByCategory(tickets: ReadonlyArray<Ticket>): BucketCount[] {
  const map = new Map<string, number>()
  for (const t of tickets) map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + 1)
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count)
}

export interface MttrResult {
  resolvedCount: number
  meanResolveSeconds: number
  medianResolveSeconds: number
}

export function computeMTTR(tickets: ReadonlyArray<Ticket>): MttrResult {
  const durations: number[] = []
  for (const t of tickets) {
    if (!t.resolvedAt || !t.createdAt) continue
    const ms = new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()
    if (ms > 0) durations.push(ms / 1000)
  }
  if (durations.length === 0) {
    return { resolvedCount: 0, meanResolveSeconds: 0, medianResolveSeconds: 0 }
  }
  durations.sort((a, b) => a - b)
  const sum = durations.reduce((a, b) => a + b, 0)
  const mid = Math.floor(durations.length / 2)
  const median =
    durations.length % 2 === 0 ? (durations[mid - 1] + durations[mid]) / 2 : durations[mid]
  return {
    resolvedCount: durations.length,
    meanResolveSeconds: sum / durations.length,
    medianResolveSeconds: median,
  }
}

export function breachRate(tickets: ReadonlyArray<Ticket>): number {
  if (tickets.length === 0) return 0
  let breached = 0
  const nowMs = Date.now()
  for (const t of tickets) {
    const dueMs = t.resolveDueAt ? new Date(t.resolveDueAt).getTime() : Infinity
    if (t.resolvedAt) {
      const resolvedMs = new Date(t.resolvedAt).getTime()
      if (resolvedMs > dueMs) breached += 1
    } else if (t.status !== 'Closed' && nowMs > dueMs) {
      breached += 1
    }
  }
  return breached / tickets.length
}

export interface HeatmapCell {
  branchId: string
  categoryId: string
  hour: number // 0-23 in IST
  count: number
}

export function heatmapMatrix(tickets: ReadonlyArray<Ticket>): HeatmapCell[] {
  const map = new Map<string, HeatmapCell>()
  for (const t of tickets) {
    const d = new Date(t.createdAt)
    // Convert UTC → IST (UTC+5:30) without DST since India doesn't observe DST.
    const istHour = (d.getUTCHours() + 5 + (d.getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24
    const key = `${t.branchId}|${t.categoryId}|${istHour}`
    const existing = map.get(key)
    if (existing) existing.count += 1
    else
      map.set(key, {
        branchId: t.branchId,
        categoryId: t.categoryId,
        hour: istHour,
        count: 1,
      })
  }
  return Array.from(map.values())
}

export function kartFailureReport(
  tickets: ReadonlyArray<Ticket>,
): Array<{ kartId: string; count: number; lastIncidentAt: string }> {
  const map = new Map<string, { count: number; lastIncidentAt: string }>()
  for (const t of tickets) {
    if (t.categoryId !== 'track-safety') continue
    for (const e of t.linkedEntities) {
      if (e.type !== 'kart') continue
      const existing = map.get(e.id)
      const at = t.createdAt
      if (existing) {
        existing.count += 1
        if (at > existing.lastIncidentAt) existing.lastIncidentAt = at
      } else {
        map.set(e.id, { count: 1, lastIncidentAt: at })
      }
    }
  }
  return Array.from(map.entries())
    .map(([kartId, v]) => ({ kartId, ...v }))
    .sort((a, b) => b.count - a.count)
}
```

Tests `ticket-analytics.test.ts` covering each function with at least 2 cases.

Commit `feat(tickets): add pure analytics aggregation helpers`.

---

## Task 2: CSV export

**File:** `src/pipeline/api/ticket-csv-export.ts`

```ts
import type { Ticket } from './types'

const COLS = [
  'id',
  'title',
  'status',
  'priority',
  'categoryId',
  'branchDisplayName',
  'raisedByName',
  'raisedByKind',
  'assigneeName',
  'assigneeRole',
  'createdAt',
  'resolvedAt',
  'resolveDueAt',
  'rootCauseTag',
  'tags',
] as const

function escapeCsv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function ticketsToCsv(tickets: ReadonlyArray<Ticket>): string {
  const lines = [COLS.join(',')]
  for (const t of tickets) {
    lines.push(
      COLS.map((col) => {
        const raw =
          col === 'tags' ? t.tags.join('|') : (t[col as keyof Ticket] as string | null | undefined)
        return escapeCsv(String(raw ?? ''))
      }).join(','),
    )
  }
  return lines.join('\n')
}

export function triggerCsvDownload(filename: string, csv: string): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

Tests cover `escapeCsv` and `ticketsToCsv` with 3 cases (basic, with commas/quotes/newlines, empty list). Commit `feat(tickets): add CSV export helpers`.

---

## Task 3: `MyTicketsView.tsx`

Tabs: `assigned | raised | mentioned`.

Subscribes via existing `subscribeToTickets`, then filters client-side:

- assigned → `assigneeId === me.id`
- raised → `raisedBy === me.id`
- mentioned → `watcherIds.includes(me.id)` (Phase 8 will populate watcherIds via @mentions; for now the list will be empty)

Renders the same row component as the main list (extract `<TicketRow>` if needed).

Add a "My tickets" link in the topbar (or sidebar). Place near the existing notifications bell.

Commit `feat(tickets): add MyTicketsView (assigned/raised/mentioned)`.

---

## Task 4: `TicketsAnalyticsView.tsx` (Owner)

Subscribes via `subscribeToTickets`. Renders cards:

- Open count by branch — bar chart (use raw HTML `<div>` widths, not a chart library — keep deps lean).
- MTTR per branch — table.
- SLA breach rate — single big number with sparkline.
- Top 5 categories this week — list.
- Trend: tickets per day for the last 30 days — bar chart.

All cards consume the helpers from Task 1.

Gate to Owner role only.

Commit `feat(tickets): add Owner analytics dashboard`.

---

## Task 5: `TicketsBranchView.tsx` (Incharge)

Same shape as Owner but scoped to `me.branchId`. Cards:

- Open count for my branch
- Breaches today
- Team MTTR
- Oldest unresolved ticket (with link to detail)

Gate to Incharge | Owner | Admin.

Commit `feat(tickets): add Incharge per-branch analytics`.

---

## Task 6: `TicketsHeatmapView.tsx` + `TicketsKartFailureView.tsx`

Heatmap: 5 branches × 6 categories × 24 hours. Render a grid: rows = `${branch}/${category}`, columns = hours. Color intensity by count. Use Tailwind's `bg-info/10` ... `bg-info/90` for 9 levels.

Kart failure report: simple table sorted by count desc — kart id, count, last incident, link to track/karts/<id>.

Two separate small views, two commits:

- `feat(tickets): add Heatmap analytics view`
- `feat(tickets): add Kart-failure analytics view`

---

## Task 7: Add views to TicketsModule + nav

`TicketsModule.tsx` — add a sub-nav (small horizontal tabs near the top): `List | Analytics | Branch | Heatmap | Karts | My Tickets`. The `view` prop on `TicketsModule` accepts these as values; default `list`.

Update `router.tsx`:

```tsx
<Route path="/tickets" element={<TicketsModule view="list" />} />
<Route path="/tickets/analytics" element={<TicketsModule view="analytics" />} />
<Route path="/tickets/branch" element={<TicketsModule view="branch" />} />
<Route path="/tickets/heatmap" element={<TicketsModule view="heatmap" />} />
<Route path="/tickets/karts" element={<TicketsModule view="karts" />} />
<Route path="/tickets/mine" element={<TicketsModule view="mine" />} />
<Route path="/tickets/:ticketId" element={<TicketDetailRoute />} />
```

Update navigation manifest: keep `Tickets` as a single tab; the sub-nav is internal. Tab path stays `/tickets`.

Commit `feat(tickets): add analytics sub-nav and routes`.

---

## Task 8: CSV export button on the list

`TicketsListView.tsx` — add an "Export CSV" button to the filter bar. On click, call `ticketsToCsv(filtered)` + `triggerCsvDownload(...)`.

Filename: `tickets-${todayDate}.csv`.

Commit `feat(tickets): add CSV export button to list view`.

---

## Task 9: Flesh out weekly Owner cron

`functions/api/ticket-owner-weekly.js` — replace the `console.log` with actual aggregation. Group by branch + category, compute MTTR + breach rate, render a JSON body. Email send remains stubbed.

Commit `feat(functions): flesh out Owner weekly digest aggregation`.

---

## Verify

```bash
npx vitest run src/pipeline/api/ src/pipeline/pages/modules/tickets/ scripts/migrate-tickets-2026-04.test.ts src/services/ticketCustomerService.test.ts
```

Type-check + build clean.

---

## Spec coverage

| Spec item               | Task                              |
| ----------------------- | --------------------------------- |
| Owner dashboard         | 4                                 |
| Incharge dashboard      | 5                                 |
| My Tickets              | 3                                 |
| Customer-facing tracker | (Phase 6)                         |
| Heatmap                 | 6                                 |
| Kart-failure report     | 6                                 |
| CSV export              | 2, 8                              |
| Weekly PDF              | 9 (PDF rendering deferred to ops) |
