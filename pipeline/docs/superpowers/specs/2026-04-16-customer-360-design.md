# Customer 360 — Pipeline Admin

**Status:** Design (Phase 1 specced in detail; Phases 2–4 outlined)
**Date:** 2026-04-16
**Owner:** dev.asquaregokarting@gmail.com
**Module:** `src/pipeline/pages/modules/AdminModule.tsx` + new `customer-detail/`

---

## Goal

Admins clicking a row in the Customers tab should land on a dedicated page showing **everything we know about that customer** — profile, every booking, every wallet/tire transaction, coupons, referrals, games played. Plus advanced search, sort, and filter on the list itself.

Three downstream phases extend this with session tracking, audit logging, and per-customer notification history.

---

## Non-goals

- Building Algolia / Elasticsearch / paid search infrastructure.
- Importing customer-app components into the pipeline app (forbidden by `CLAUDE.md`).
- Per-game-session collection (games derived from `bookings.items[]`).
- Customer reviews/ratings (don't exist; not adding).
- Customer-side UI changes in Phase 1.

---

## Phasing

| Phase             | Scope                                                                                                                            | Ships                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **1 (this spec)** | List page advanced search/sort/filter; detail page route + 7 tabs (Overview, Bookings, Games, Wallet, Tires, Coupons, Referrals) | Bulk of admin value       |
| 2                 | Customer-app session tracking + Sessions tab + revoke                                                                            | Per-session login history |
| 3                 | Admin-edit audit log + Audit tab                                                                                                 | Change history            |
| 4                 | Per-customer Interakt notification log + Notifications tab                                                                       | Outbound message history  |

Each phase gets its own brainstorming → spec → plan cycle. Phases 2–4 are outlined at the bottom of this doc; the rest of this spec is **Phase 1 only**.

---

## Architecture

### File layout

```
src/pipeline/
├── api/
│   ├── asquare-customers.ts                 ← extend with paginated/filtered listCustomers
│   └── customer-detail/                     ← NEW: small focused fetchers
│       ├── customer-bookings.ts
│       ├── customer-wallet.ts
│       ├── customer-tires.ts
│       ├── customer-coupons.ts
│       └── customer-referrals.ts
├── pages/modules/
│   ├── AdminModule.tsx                      ← list page (extended)
│   └── customer-detail/                     ← NEW
│       ├── CustomerDetailPage.tsx           ← route shell, header, tab nav
│       ├── tabs/
│       │   ├── OverviewTab.tsx
│       │   ├── BookingsTab.tsx
│       │   ├── GamesTab.tsx
│       │   ├── WalletTab.tsx
│       │   ├── TiresTab.tsx
│       │   ├── CouponsTab.tsx
│       │   └── ReferralsTab.tsx
│       └── customer-detail-types.ts
└── app/router.tsx                           ← + /admin/customers/:customerId
```

Each tab is its own file (~150–250 lines), self-contained loader + render. Phases 2–4 add `tabs/SessionsTab.tsx`, `tabs/AuditTab.tsx`, `tabs/NotificationsTab.tsx` next to the existing files.

### Routing

```
/admin/customers              → AdminModule (existing list, extended)
/admin/customers/:customerId  → CustomerDetailPage  (NEW, lazy-loaded)
```

`:customerId` is the Firestore `users/{uid}` document id. Deep-linkable, sharable.

---

## List page enhancements

### Backend strategy

Firestore-only (no paid search). Three structural changes:

1. **Lowercase index fields on `users/{uid}`** for prefix search: `displayNameLower`, `emailLower`. Backfilled once; maintained on write via the existing `userService.resolveOrCreateUserDoc` and admin `updateCustomer`.
2. **Denormalized bucket fields** for multi-dimensional filtering: `spendBucket` (`'0' | '1-5k' | '5-25k' | '25k+'`), `bookingBucket` (`'0' | '1' | '2-5' | '6+'`), `hasWalletBalance` (boolean), `hasTires` (boolean), `hasUnredeemedCoupons150` (boolean). Computed from the existing `stats`, `walletBalance`, `tires`, `coupons150Available` fields by a Cloud Function trigger on `users/{uid}` writes (`functions/triggers/on-user-write-customer-buckets.js`). One-shot backfill script: `scripts/backfill-customer-buckets.ts`.
3. **Forward referral index**: new subcollection `users/{uid}/referredCustomers/{referredUid}` with `{ referredUid, displayName, phone, joinedAt, totalSpent }`. Written by a Cloud Function trigger on user create when `referredBy` is set (`functions/triggers/on-user-create-referral-index.js`). Backfill script: `scripts/backfill-referral-forward-index.ts`.

### Composite indexes (Firestore)

Add to `firestore.indexes.json`:

| Filter equalities                                                                                                                | Range / prefix                                              | Order by                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------- |
| `tier`                                                                                                                           | —                                                           | `createdAt desc` _(existing)_ |
| `tier`, `verified`, `spendBucket`, `bookingBucket`, `hasWalletBalance`, `hasTires`, `hasUnredeemedCoupons150`, `branchPreferred` | —                                                           | `createdAt desc`              |
| same as above                                                                                                                    | —                                                           | `lastLoginAt desc`            |
| same as above                                                                                                                    | —                                                           | `stats.totalSpent desc`       |
| same as above                                                                                                                    | —                                                           | `stats.bookingCount desc`     |
| same as above                                                                                                                    | —                                                           | `walletBalance desc`          |
| same as above                                                                                                                    | —                                                           | `tires desc`                  |
| —                                                                                                                                | `displayNameLower >=  <= +\uf8ff`                           | `displayNameLower asc`        |
| —                                                                                                                                | `emailLower >= <= +\uf8ff`                                  | `emailLower asc`              |
| —                                                                                                                                | `phone == digits` _(via existing `phoneToUid` for instant)_ | —                             |

Firestore composite indexes are flexible: a query that uses a subset of the equality fields above will use the same index. Total index count: ~10.

### Query constraints to know

- **One range filter per query** (Firestore rule). Date ranges (joined / last seen / last booking) and prefix search (name/email) all count as ranges. UI enforces: at most one date-range filter active at a time. Name and email prefix search are mutually exclusive in the same query (UI offers a "search by" radio group: Phone / Name / Email). Phone search bypasses the list query entirely (uses `phoneToUid` direct lookup).
- **`branchPreferred`** is a new derived field on `users/{uid}` (the location id where the customer has booked the most). Maintained by the same Cloud Function as buckets. Empty for customers with no bookings.

### `asquareCustomersApi.listCustomers` signature

```ts
interface ListCustomersOptions {
  pageSize?: number // default 20
  cursor?: QueryDocumentSnapshot<DocumentData>
  filters?: {
    tier?: string
    membership?: string
    verified?: boolean
    branchPreferred?: string
    spendBucket?: '0' | '1-5k' | '5-25k' | '25k+'
    bookingBucket?: '0' | '1' | '2-5' | '6+'
    hasWalletBalance?: boolean
    hasTires?: boolean
    hasUnredeemedCoupons150?: boolean
    joinedAfter?: Date
    joinedBefore?: Date
    lastSeenAfter?: Date
    lastSeenBefore?: Date
    lastBookingAfter?: Date
    lastBookingBefore?: Date
  }
  sortBy?: 'createdAt' | 'lastLoginAt' | 'totalSpent' | 'bookingCount' | 'walletBalance' | 'tires'
  sortDir?: 'asc' | 'desc'
  search?: { kind: 'phone' | 'name' | 'email'; value: string }
}
```

The implementation:

- If `search.kind === 'phone'`: short-circuit via `phoneToUid` → return single result.
- If `search.kind === 'name' | 'email'`: prefix range on `displayNameLower` / `emailLower` (forces `sortBy` to that field, ignores other sort).
- Else: equality `where` clauses for each defined filter, one range `where` for the active date range, then `orderBy` on `sortBy`.
- Returns `{ items, nextCursor }` (already the shape after the recent fix).

### List page UI changes

`AdminModule.tsx` Customers branch:

- **Search bar**: kind-radio (Phone / Name / Email) + input. Phone search bypasses pagination.
- **Filter bar** (collapsible "More filters" panel for non-default filters):
  - Always visible: Tier, Membership, Verified.
  - Inside More: Branch (preferred), Spend bucket, Booking bucket, Has wallet, Has tires, Has unredeemed ₹150 coupons, Joined date range, Last seen date range, Last booking date range. UI greys out the other date-range inputs once one is active.
- **Sort dropdown** above the table: Joined / Last seen / Total spent / Booking count / Wallet / Tires + asc/desc.
- **Cursor pagination**: "Next" + "Prev" buttons (Firestore cursor stack kept in component state). Replaces the existing single-page load.
- **Row click** (anywhere except the Edit/Delete action cell): navigates to `/admin/customers/:customerId`. The existing Edit / Delete buttons keep their inline behavior.

---

## Detail page

### Shell — `CustomerDetailPage.tsx`

Layout:

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back to Customers          [Edit]  [Delete]                   │
├─────────────────────────────────────────────────────────────────┤
│ HEADER                                                          │
│  Name (display)         Joined: 12 Mar 2024  · Last seen: today │
│  Phone · Email          Tier: Gold  Membership: Silver  ✓verified│
│                                                                  │
│  ┌──── KPI strip (6 cards) ──────────────────────────────────┐  │
│  │ Total Spent │ Bookings │ Wallet │ Tires │ Coupons │ Visits │  │
│  └──────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│ [Overview] [Bookings] [Games] [Wallet] [Tires] [Coupons] [Refs] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   <active tab content>                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- Header is rendered eagerly (one `getDoc(users/{customerId})`).
- Tabs are lazy: only the active tab loads its data. Switching tabs runs the loader for that tab. React Query (already in the project) caches results so re-clicking is instant.
- Tab state is in the URL: `/admin/customers/:customerId?tab=bookings`. Default tab is `overview`. Deep-linkable.
- `Edit` opens the existing `editingCustomer` modal from `AdminModule.tsx` (lifted into a small shared module to avoid duplication). `Delete` opens the existing delete confirmation. Both are role-gated (Owner/Admin only — same policy as today).

### Tabs (Phase 1)

#### 1. Overview

Renders the same KPIs from the header in a richer layout, plus:

- Recent activity timeline (last 10 events, merged from bookings/wallet tx/tire tx).
- Tier change history _(empty in Phase 1 — no log exists yet; placeholder section reads "No tier changes recorded".)_
- Quick links to other tabs.

No additional fetches beyond the timeline (one paginated fetch each from bookings/wallet/tires, take 10 most recent).

#### 2. Bookings — `BookingsTab.tsx`

- Table: Date · Branch · Items (name + qty) · Status · Final amount · Payment · Actions (View → existing booking detail page).
- Filters above table: branch, status (confirmed/pending/cancelled/rescheduled), date range, payment status.
- Includes soft-deleted (`deleted_bookings`) toggle: "Show cancelled/deleted" checkbox. When on, those rows are styled red and tagged with the deleter.
- Cursor pagination, 50/page. Backed by `customer-bookings.ts` (queries `users/{uid}/bookings` then merges `deleted_bookings where userId == :uid` when toggle on).
- Reuses `formatCurrency` and the existing `DataTable` / `FilterBar` primitives.

#### 3. Games — `GamesTab.tsx`

Aggregated view (no source collection):

- Loader fetches _all_ of this customer's bookings (cursored over pages, capped at 5,000 to protect the browser — a customer with 5k bookings is a non-issue).
- Reduces `bookings.items[]` to `{ activityId/name → { count, totalSpent, lastPlayed, locations: Set }`.
- Renders as a sortable card grid: each card shows activity name, total plays, total spent on it, last played date, locations played at.
- Note in the empty state: "Game-level history is aggregated from bookings. For session-level detail, see the Bookings tab."

#### 4. Wallet — `WalletTab.tsx`

- Top: current `walletBalance` (big, green if > 0).
- Table: Date · Type (credit/debit) · Amount (signed) · Reason/description · Booking link if present.
- Filters: type (credit / debit / all), date range.
- Pagination: 50/page, cursor-based.
- Backed by `customer-wallet.ts` reading `users/{uid}/wallet_transactions` ordered by `timestamp desc`.

#### 5. Tires — `TiresTab.tsx`

Same shape as Wallet but reading `users/{uid}/tire_transactions`. Adds a "tires earned per booking" derived row beneath each booking-driven credit (the formula is `floor(finalAmount/10)` per `walletService`).

#### 6. Coupons — `CouponsTab.tsx`

- Top KPI strip: ₹150 Earned / Redeemed / Available + total reward coupons available.
- Table: Code · Type · Discount · Source · Created · Expiry · Used (✓/✗).
- Filter: source (member_150 / reward / all), used / unused.
- Pagination: 50/page.
- Backed by `customer-coupons.ts` reading `users/{uid}/coupons` (subcollection — the existing `couponService` already exposes the read; pipeline gets a thin wrapper).

#### 7. Referrals — `ReferralsTab.tsx`

Two sections:

- **Referred by** — looks up `users/{referredBy}` and shows that customer's name/phone with a link to their detail page.
- **Customers I referred** — paginates `users/{uid}/referredCustomers` (the new forward index). Each row links to that customer's detail page.

Empty states for both when not applicable.

---

## Permissions

Detail page accessible to roles that already access the Customers list: Owner, Admin, Telecaller, Cashier, ThirdParty, Backend, Developer.

Role gating per action:

- **View** any tab: any role with list access.
- **Edit / Delete** customer: Owner, Admin (existing rule).
- **Future** revoke session (Phase 2): Owner, Admin only.
- **Future** view audit (Phase 3): Owner, Admin only.

Enforced at the route level via the existing `ProtectedRoute` and at the action level via the existing `getUserManagementPolicy` (which is for staff users today; a new `getCustomerActionPolicy` will be added next to it for customer-side actions).

---

## Data infrastructure (Phase 1 only)

### New / extended fields on `users/{uid}`

- `displayNameLower: string` — backfilled, maintained on write.
- `emailLower: string` — backfilled, maintained on write.
- `spendBucket: '0' | '1-5k' | '5-25k' | '25k+'` — derived from `stats.totalSpent`.
- `bookingBucket: '0' | '1' | '2-5' | '6+'` — derived from `stats.bookingCount`.
- `hasWalletBalance: boolean` — `walletBalance > 0`.
- `hasTires: boolean` — `tires > 0`.
- `hasUnredeemedCoupons150: boolean` — `coupons150Available > 0`.
- `branchPreferred: string` — locationId most-booked-at.
- `lastBookingAt: Timestamp | null` — most recent booking sessionDate.

**Single owner per field to avoid races:**

- `stats.totalSpent`, `stats.bookingCount`, `lastBookingAt`, `branchPreferred` — owned by the existing `onBookingWriteSyncCustomerStats` trigger (extended).
- `displayNameLower`, `emailLower` — owned by `userService.resolveOrCreateUserDoc` (write path) + a one-shot backfill.
- `spendBucket`, `bookingBucket`, `hasWalletBalance`, `hasTires`, `hasUnredeemedCoupons150` — owned by a new `functions/triggers/on-user-write-customer-buckets.js` that recomputes buckets when its source fields (`stats.*`, `walletBalance`, `tires`, `coupons150Available`) change.

The bucket trigger reads but never writes the source fields, eliminating circular updates.

### New subcollection

- `users/{uid}/referredCustomers/{referredUid}` — forward referral index. Written by `functions/triggers/on-user-create-referral-index.js`.

### Backfill scripts (one-shot, `scripts/`)

- `backfill-customer-search-fields.ts` — populates `displayNameLower`, `emailLower` for existing users.
- `backfill-customer-buckets.ts` — populates the bucket fields for existing users.
- `backfill-referral-forward-index.ts` — walks `users` once, populates forward index.

Run order: backfill scripts → deploy Cloud Function triggers → deploy frontend changes. Documented in the implementation plan.

### Composite indexes (`firestore.indexes.json`)

~10 new indexes per the table earlier. Single PR addition.

---

## Performance & UX guarantees

- List page: ≤500 ms to first paint at p95 (server-paginated 20 rows, denormalized stats).
- Detail page header: ≤300 ms (one `getDoc`).
- Each tab: ≤800 ms to first paint at p95 (lazy-loaded, single query, 50-row cursored pages).
- Games tab: ≤2 s for a customer with 200 bookings; explicit "still loading…" past 2 s for heavier customers; hard cap at 5,000 bookings.
- All tabs cached for 60 s via React Query so tab switching is free within a session.

---

## Error handling

Existing pipeline patterns:

- Loaders throw on Firestore failures; tab components catch and render `<ErrorState />` with retry (the existing component at `src/components/ui/ErrorState.tsx`).
- Header `getDoc` 404 → renders a "Customer not found" page with a back button to the list.
- Logging via the `logger` facade — `customer.detail.tab.bookings.failed`, etc. Sensitive fields (phone, payment) already scrubbed by the logger.

---

## Testing

- **Unit tests** (Vitest, co-located `*.test.ts(x)`):
  - `asquareCustomersApi.listCustomers` — every filter combo, sort, search kind, cursor pagination.
  - Each `customer-detail/` API fetcher — happy path, empty result, Firestore error.
  - Each tab component — loading state, empty state, error state, populated state. Mock the API.
  - Bucket computation logic (extracted to a pure function so it's trivially testable).
- **Coverage threshold** for the new modules added to `vitest.config.ts`.
- **Playwright** (defer to Phase 1 wrap-up): one happy-path E2E for "list → click row → see Overview → click Bookings tab → see rows."

---

## Out of scope for Phase 1 (handled in later phases)

- **Sessions tab** (Phase 2) — needs customer-app instrumentation: `users/{uid}/loginSessions` subcollection written from `AuthContext` on every login with `{ deviceType, browserName, osName, userAgent, ipAddress, geo: { city, country }, loginAt, lastActiveAt, isRevoked }`. Geo via free tier of `ipapi.co` (Cloud Function so the IP isn't stored client-side raw). Revoke = setting `isRevoked: true`; AuthContext checks on every page load and signs out.
- **Audit tab** (Phase 3) — new `users/{uid}/auditLog` subcollection. Writes wrapped around `asquareCustomersApi.updateCustomer` and `deleteCustomer` and any future admin-mutation API (tier change, wallet adjust, etc.).
- **Notifications tab** (Phase 4) — extend Interakt webhook integration to write `users/{uid}/notificationLog` on every send. Until then, the Notifications tab can fall back to filtering the global `notifications` collection by phone.

These three phases are sequenced because each unblocks user-visible value with one tab; they can be re-prioritised based on real demand.

---

## Open risks

1. **Firestore one-range-filter limit** could surprise admins ("why can't I combine joined-date AND last-seen-date?"). Mitigated by the UI greying-out: only one date-range filter input is enabled at a time, with a tooltip explaining.
2. **Bucket recompute lag** — Cloud Function triggers are eventually consistent. A new booking might take 1–3 seconds before `spendBucket` updates. Acceptable for admin filtering.
3. **Forward referral backfill cost** — single full scan of `users` (~50k docs). Run once, off-hours. Estimated ~$1 in Firestore reads.
4. **Games tab on whales** — a customer with 5k+ bookings hits the cap and shows a "showing first 5,000 bookings" warning. Acceptable; if it becomes real we can shift to a stored aggregation (Phase 5+).

---

## Implementation order (for the plan)

1. **API + indexes**: extend `asquareCustomersApi.listCustomers`, add `firestore.indexes.json` entries, write the bucket-trigger Cloud Function + backfill scripts, deploy.
2. **List page**: extend `AdminModule.tsx` with new filter/sort/search UI + cursor pagination. Row-click navigates to detail page.
3. **Detail page shell**: route, header, tab navigation, lazy tab loading.
4. **Tabs**: Overview → Bookings → Wallet → Tires → Coupons → Referrals → Games (in that order; Games last because it's the heaviest and most derived).
5. **Tests + a11y pass + coverage thresholds**.
6. **Manual QA** on dev (clicking through with a real customer that has data in every tab).

The implementation plan (next step after spec approval) will break each of these into TDD-able tasks.
