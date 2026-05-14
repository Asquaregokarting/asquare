# Pipeline Module Decomposition — Follow-up Plan

> Sprint 3.10 of the lifecycle audit remediation backlog. **Not started in
> the audit-implementation session** because the scope (~6,600 lines of
> production business logic across two files) exceeds what can be done
> safely in one pass without deep team domain knowledge.

## Why this matters

Per the lifecycle audit, two pipeline modules are unmaintainable at their
current size:

| File | Lines | Top-level concerns observed |
| --- | --- | --- |
| [src/pipeline/pages/modules/BillingModule.tsx](../src/pipeline/pages/modules/BillingModule.tsx) | 3,697 | POS interface, day-close report, transaction list, refund flow, billing form, QR generation, branch filtering |
| [src/pipeline/pages/modules/BookingsModule.tsx](../src/pipeline/pages/modules/BookingsModule.tsx) | 2,919 | Booking list/grid, status filters, payment retry, Interakt notifications, reschedule modal, partial refund |

Symptoms today:
- Hard to test (no test file exists for either module).
- High merge-conflict rate when multiple devs touch billing/bookings.
- Slow first-load (single chunk pulls in everything).
- New devs need 1–2 days to read either file before they can change anything.

## Target structure

For each module, decompose into a **feature folder** following the existing
`src/pipeline/features/*` convention:

```
src/pipeline/features/billing/
  index.ts                  # public API barrel
  BillingPage.tsx           # ~150 lines: composition root, no business logic
  components/
    PosLayout.tsx
    TransactionList.tsx
    BillingForm.tsx
    DayCloseReport.tsx
    RefundDialog.tsx
    QrGeneratorPanel.tsx
  hooks/
    useBillingSession.ts    # current shift / cashier state
    useTransactions.ts      # query + mutations via React Query
    useDayClose.ts
  state/
    billing-context.tsx     # if cross-component state really needed
  utils/
    receipt-formatting.ts
    branch-filtering.ts
```

```
src/pipeline/features/bookings/
  index.ts
  BookingsPage.tsx          # ~150 lines composition root
  components/
    BookingsTable.tsx
    BookingsFilters.tsx
    BookingDetailDrawer.tsx
    RescheduleDialog.tsx
    PaymentRetryDialog.tsx
  hooks/
    useBookingsList.ts
    useBookingMutations.ts
  utils/
    status-transitions.ts
    interakt-payload.ts
```

The page wrapper that sits in `src/pipeline/pages/modules/` becomes a
two-line re-export so the existing router doesn't have to change.

## Decomposition strategy

Do this **incrementally** over 4–6 PRs, never one big-bang PR. The order
below minimizes merge conflicts because each step extracts a leaf concern.

### PR 1 — extract pure utility functions
Identify everything in BillingModule/BookingsModule that:
- Takes data in, returns data out (no React, no hooks).
- Has no closure over component state.

Examples: `formatBillingReceipt`, `computeRefundAmount`, `mapBookingToInteraktPayload`,
`statusTransitionAllowed`. Move them to `features/billing/utils/` and
`features/bookings/utils/`. Add unit tests as you move them — these are
pure functions, perfect for vitest.

### PR 2 — extract React Query hooks
Find every `useQuery` / `useMutation` defined inline. Move them into
`hooks/use*.ts` files. Each hook should be a thin wrapper around the
relevant API in `src/pipeline/api/`.

This step alone usually shrinks each module by 30–40%.

### PR 3 — extract dialogs and drawers
Modal components (`RescheduleDialog`, `RefundDialog`, `BookingDetailDrawer`)
are usually self-contained. Move each to `components/` with its own props
interface.

### PR 4 — extract list and form components
The biggest chunks: `BookingsTable`, `BillingForm`, `TransactionList`. Move
these last — they're the ones most likely to need state from the parent.
Pass that state in via props rather than recreating it inside.

### PR 5 — create the composition root
After PRs 1–4, the original module file should be ~300 lines and look like
nothing but JSX composition. Rename it to `features/billing/BillingPage.tsx`
and replace the old `pages/modules/BillingModule.tsx` with:

```tsx
export { default } from '../../features/billing/BillingPage'
```

### PR 6 — repeat for BookingsModule
Same five steps for the bookings module.

## Constraints

- **No behavior changes.** This is pure refactor. Any "while we're here"
  cleanup goes in a separate PR.
- **Add tests as you extract.** Every utility moved in PR 1 should land with
  a vitest file. Every hook moved in PR 2 should land with a React Testing
  Library test using the existing test-utils.
- **Don't introduce new state-management libs.** If a piece of state truly
  needs to live above multiple components, use the existing pattern
  (React Context in `state/`).
- **Keep the public API stable.** The router imports
  `BillingModule`/`BookingsModule` from `pages/modules/` — preserve that
  import path via the re-export shim until the router can be updated in a
  separate cleanup PR.

## Verification

After each PR:
1. `npx tsc -b` — must exit 0.
2. `npm run test:run` — must pass.
3. `npm run lint` — must not introduce new errors.
4. Manual smoke test: open the affected module in a dev build and exercise
   the touched flows.
5. Coverage report: per-file thresholds for the newly extracted utils
   should be added to `vitest.config.ts`.

## Estimate

A senior dev pairing with whoever owns billing should expect **5–8 working
days** for a clean decomposition with tests. Less if you skip tests, but
that defeats the purpose.

## Out of scope for Sprint 3.10

- Performance work (lazy loading split chunks) — that's a follow-up after
  the structure is in place.
- Visual redesign — same.
- Any change to the underlying `src/pipeline/api/billing*` or
  `src/pipeline/api/asquare-bookings*` files. Those are stable; only the UI
  layer is being refactored.
