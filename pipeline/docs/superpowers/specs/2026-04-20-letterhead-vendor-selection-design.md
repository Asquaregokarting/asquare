# Letterhead Vendor Selection — Design

**Date:** 2026-04-20
**Scope:** `src/pipeline/pages/modules/AccountingModule.tsx` → `ChequeLetterheadModal`
**Related API:** `src/pipeline/api/accounting.ts` (`finalizePayoutForLocation`, `markPeriodLetterheadDownloaded`)

## Problem

The invoice/letterhead generation flow in `AccountingModule` currently has **no way to exclude a specific vendor** from a given cheque letterhead. `buildVendorRows()` at line 649 auto-pulls every vendor invoice for the period/location (minus a hardcoded `mpg` string filter), and `Lock All & Download` at line 700 locks every matching invoice unconditionally.

Operators need two behaviors:

1. **Hide from this letterhead only** (Mode A, default) — vendor still gets locked and paid; they just don't appear on this printed cheque letter. Example: vendor was paid via a different channel, or their row doesn't belong on this letter.
2. **Skip payout entirely** (Mode B, per-row escalation) — vendor stays pending, doesn't get locked, rolls into the next run. Example: vendor's cheque isn't being cut this week.

## Goals

- Let the user pick **which vendors appear** on a given letterhead via checkboxes in the existing modal.
- Default all vendors checked → current behavior preserved when user doesn't interact with the selection panel.
- Per-row escalation to "also skip payout" for vendors whose lock must be deferred.
- No regression to the `mpg` filter or existing completed-mode reprint flow.

## Non-goals

- No change to how the period or billing transactions are computed.
- No new persistent selection state (selections are per-modal-open; closing and reopening resets).
- No change to vendor _row contents_ in the PDF (bank details, formatting, totals column) — only which rows appear.
- No UI for per-row "include but mark as partial payout" or similar intermediate states.

## UI design

Insert a new **"Vendors on this letterhead"** panel inside the modal body (between the info banner at line 812 and the `iframe` preview at line 831). The panel is scrollable (`max-h-64 overflow-auto`) and renders one row per vendor invoice for the current period + location (after the existing `mpg` filter).

Layout (conceptual):

```
┌─────────────────────────────────────────────────────┐
│ Vendors on this letterhead (3 of 5 selected)        │
│ [Select all] [Clear all]                            │
├─────────────────────────────────────────────────────┤
│ ☑  Vizag Boys Pvt Ltd           ₹5,000              │
│ ☑  Raju Fuels                   ₹8,200              │
│ ☐  ACE Suppliers  ₹3,000    [▢ Also skip payout]   │
│ ☐  MPG Printing   ₹2,000    [☑ Also skip payout]   │
│ ☑  Sri Sai Tires                ₹4,500              │
├─────────────────────────────────────────────────────┤
│ Total on letterhead: ₹17,700                        │
└─────────────────────────────────────────────────────┘
```

Row behavior:

- **Primary checkbox** (default checked) — unchecking hides the vendor from the PDF (Mode A).
- **Dimmed styling** (`text-muted`) on unchecked rows.
- **Secondary `Also skip payout` checkbox** appears inline on unchecked rows only. Ticking it escalates that row to Mode B.
- Re-ticking the primary checkbox drops the vendor from _both_ hidden and skip-payout sets.
- `Select all` / `Clear all` bulk controls in the panel header.
- Live header count `{selected}/{total}`.
- Live grand total below the list, computed from checked-only rows, matches the PDF total.
- In `mode === 'completed'`, the secondary `Also skip payout` checkbox is not rendered (can't unlock finalized invoices via this flow).

The primary download button label flips from `Lock All & Download` to `Lock Selected & Download` whenever any row has `skipPayout` set, making the scope change visible.

## State model

Two sets, local to `ChequeLetterheadModal`:

```ts
const [hiddenVendorIds, setHiddenVendorIds] = useState<Set<string>>(new Set())
const [skipPayoutVendorIds, setSkipPayoutVendorIds] = useState<Set<string>>(new Set())
```

Invariant: `skipPayoutVendorIds ⊆ hiddenVendorIds`. Enforced by handlers — the UI never renders the secondary checkbox for a non-hidden row.

**Derived view model** (memoized off `vendorInvoices`, `hiddenVendorIds`, `skipPayoutVendorIds`):

```ts
const selectableVendors = useMemo(
  () =>
    vendorInvoices
      .filter((inv) => !(inv.vendorCompanyName ?? '').toLowerCase().includes('mpg'))
      .map((inv) => ({
        invoice: inv,
        hidden: hiddenVendorIds.has(inv.vendorId),
        skipPayout: skipPayoutVendorIds.has(inv.vendorId),
      })),
  [vendorInvoices, hiddenVendorIds, skipPayoutVendorIds],
)
```

The `mpg` filter moves here so it's applied once (currently duplicated in `buildVendorRows`).

**Handlers:**

- `toggleHidden(vendorId)` — flips membership in `hiddenVendorIds`. When re-including (was hidden, now un-hiding), also removes from `skipPayoutVendorIds`.
- `toggleSkipPayout(vendorId)` — flips membership in `skipPayoutVendorIds`. Only reachable when vendor is hidden.
- `selectAll()` — clears both sets.
- `clearAll()` — adds every vendorId to `hiddenVendorIds`; leaves `skipPayoutVendorIds` unchanged.

**Reset:** a `useEffect` watching `periodStart` and `locationFilter` clears both sets, so stale selections from a different vendor set never leak across reopens.

## PDF generation

Extract a shared config builder used by both `handleGeneratePreview` and `handleLockAndDownload`:

```ts
const buildPdfConfig = (): LetterheadConfig => {
  const visible = selectableVendors.filter((v) => !v.hidden)
  const rows = visible.map((v, idx) => ({
    sNo: idx + 1,
    // existing mapping from inv → row (vendor name, bank fields, amount, etc.)
  }))
  const grandTotal = rows.reduce((s, r) => s + r.amount, 0)
  return {
    chequeNumber: chequeNumber.trim(),
    date: letterheadDate,
    periodStart,
    periodEnd,
    locationLabel,
    vendors: rows,
    grandTotal,
  }
}
```

`sNo` re-indexes sequentially 1..N so the printed serial numbers are gap-free.

## Locking API change

Add an **optional `excludeVendorIds: string[]` parameter** (default `[]`) to two accounting API methods — additive, fully backward compatible.

```ts
// src/pipeline/api/accounting.ts

async finalizePayoutForLocation(
  periodStart: string,
  chequeNumber: string,
  locationFilter: string,
  userId: string,
  userName: string,
  excludeVendorIds: string[] = [],   // ← new
): Promise<void>

async markPeriodLetterheadDownloaded(
  periodStart: string,
  locationFilter: string,
  excludeVendorIds: string[] = [],   // ← new
): Promise<void>
```

Both methods, after fetching the invoice set for `{periodStart, locationFilter}`, filter out any invoice whose `vendorId ∈ excludeVendorIds` before their batch write. Skipped invoices keep their current pending state untouched and naturally appear in the next period's pending view.

`updateChequeForLocation` (completed-mode path, line 716) is untouched — Mode B is disabled when `mode === 'completed'`.

**Call site** in `handleLockAndDownload`:

```ts
await accountingApi.finalizePayoutForLocation(
  periodStart,
  chequeNumber.trim(),
  locationFilter,
  session.user.id,
  session.user.name,
  Array.from(skipPayoutVendorIds),
)
// ... generate + save PDF ...
await accountingApi.markPeriodLetterheadDownloaded(
  periodStart,
  locationFilter,
  Array.from(skipPayoutVendorIds),
)
```

## Validation & edge cases

| Case                                          | Behavior                                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| All vendors hidden                            | `Generate Preview` and `Lock Selected & Download` disabled. Inline warning: _"At least one vendor must be included in the letterhead."_            |
| Cheque number empty                           | Existing behavior preserved — both buttons disabled.                                                                                               |
| Vendor has ₹0 amount                          | Shown in panel like any other; user can hide if they wish.                                                                                         |
| Completed-mode reopen                         | Both sets start empty → all rows checked. `Also skip payout` control hidden. User can still hide rows from a re-print without changing lock state. |
| `selectAll` while some rows have `skipPayout` | Both sets cleared (un-hiding must drop skip flag — invariant).                                                                                     |
| `clearAll` while some rows have `skipPayout`  | All ids moved into `hiddenVendorIds`; `skipPayoutVendorIds` untouched (those rows stay escalated).                                                 |
| `mpg`-filtered vendor                         | Excluded up-front in `selectableVendors`. Never reaches the checkbox panel, never in the lock call. Unchanged from current behavior.               |
| Period/location change mid-modal              | `useEffect` resets both sets.                                                                                                                      |

## Error handling

Existing `try/catch` blocks in `handleGeneratePreview` and `handleLockAndDownload` remain. The new guard (at least one vendor included) is a client-side UI-disable, not an API-level error.

## Tests

### Unit (Vitest — `AccountingModule.test.tsx`, co-located)

- Unchecking a vendor row removes it from the generated `LetterheadConfig.vendors` array.
- `skipPayoutVendorIds ⊆ hiddenVendorIds` invariant holds after arbitrary toggle sequences.
- `toggleHidden` on a currently-hidden+skipped vendor drops it from both sets.
- `selectAll` clears both sets.
- `clearAll` fills `hiddenVendorIds` with every id; leaves `skipPayoutVendorIds` alone.
- Live grand total recomputes from non-hidden rows only.
- `sNo` re-indexes sequentially 1..N after filtering.
- `Lock Selected & Download` is disabled when all rows hidden.
- `Also skip payout` control is not rendered when `mode === 'completed'`.
- Period/location change clears both sets.
- `mpg`-filtered vendors never appear in the panel regardless of state.

### Integration (API mocks)

- `finalizePayoutForLocation` called with exactly `Array.from(skipPayoutVendorIds)` as its `excludeVendorIds` argument.
- `markPeriodLetterheadDownloaded` called with the same `excludeVendorIds` array.
- When no rows are `skipPayout`, `excludeVendorIds` is an empty array (not `undefined`) — preserves the new parameter's default-path behavior.

### Backend (API tests, if present for `accounting.ts`)

- `finalizePayoutForLocation` with `excludeVendorIds = []` locks every invoice (backward compat).
- `finalizePayoutForLocation` with a non-empty `excludeVendorIds` skips matching invoices in the batch write; non-matching invoices still get locked.
- `markPeriodLetterheadDownloaded` behaves symmetrically.

## Files touched

- `src/pipeline/pages/modules/AccountingModule.tsx` — `ChequeLetterheadModal` component (UI, state, handlers, filter pipeline, `buildPdfConfig` extraction).
- `src/pipeline/api/accounting.ts` — optional `excludeVendorIds` param on `finalizePayoutForLocation` and `markPeriodLetterheadDownloaded`.
- Tests — new or extended co-located `*.test.tsx` / `*.test.ts` files under the same paths.

No other modules, no route changes, no new shared types (`LetterheadConfig` shape unchanged).
