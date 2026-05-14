# Merge Customers + Members Admin View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the separate `/admin/customers` and `/admin/members` tabs into a single unified Customers tab with sort, advanced filtering (membership tier, verified state, customer tier), a detail modal, and server-paginated row display — recovering the work from dangling stash `d2a6a654` while keeping HEAD's scalable cursor-paginated API.

**Architecture:** Keep HEAD's `asquareCustomersApi.listCustomers({ cursor, pageSize, tier })` cursor pagination (do NOT regress to the stash's `listAllCustomers` fetch-all approach — it reads 50k+ docs per visit). Sort and non-tier filters operate client-side over the current 20-row page (documented trade-off — server-side would need composite indexes). Members tab redirects to Customers; member-specific state is removed. Detail panel (`CustomerDetailPanel`) is already complete in HEAD — wire it in via a `viewingCustomer` state + `View` row action.

**Tech Stack:** React 18 + TypeScript (strict) + Tailwind 3 + React Router v6 + Vitest + existing Firestore cursor-paginated API + existing `CustomerDetailPanel` component.

**Assumed starting state:**

- Current branch: `main` at `1a92237`.
- Working tree clean for `src/pipeline/pages/modules/AdminModule.tsx` and `src/pipeline/app/router.tsx` (the files this plan modifies). The recovered stash sits at `_stash-recovery/d2a6a654/` for reference only — do not copy wholesale.
- No uncommitted work on AdminModule. If `git status` shows `M` on this file, stop and resolve first.

---

### Task 1: Redirect `/admin/members` to `/admin/customers` and drop `members` from `AdminView`

**Files:**

- Modify: `src/pipeline/app/router.tsx` (lines 869–874 region)
- Modify: `src/pipeline/pages/modules/AdminModule.tsx:43-53` (the `AdminView` union)

**Why first:** Everything downstream (subnav, view JSX, state) gets easier once the type narrows.

- [ ] **Step 1: Read the current `/admin/members` route block**

Run: look at [router.tsx:869-874](src/pipeline/app/router.tsx#L869-L874). It currently renders `<AdminModule view="members" />` inside a `<Protected>` wrapper.

- [ ] **Step 2: Replace the members route with a `<Navigate>` redirect**

In `src/pipeline/app/router.tsx`, find the route element:

```tsx
<Route
  path="/admin/members"
  element={
    <Protected>
      <AdminModule view="members" />
    </Protected>
  }
/>
```

Replace with:

```tsx
<Route path="/admin/members" element={<Navigate replace to="/admin/customers" />} />
```

Ensure `Navigate` is imported from `react-router-dom` at the top of the file (it likely already is — `grep -n "Navigate" src/pipeline/app/router.tsx` to confirm; if absent, add it to the existing import).

- [ ] **Step 3: Remove `'members'` from the `AdminView` union**

In `src/pipeline/pages/modules/AdminModule.tsx`, modify lines 43–53:

```ts
export type AdminView =
  | 'users'
  | 'audit'
  | 'roles'
  | 'telecallers'
  | 'vendors'
  | 'registrations'
  | 'customers'
  | 'locations'
  | 'notifications'
```

(Delete the trailing `| 'members'` line.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: Errors pointing to the `view === 'members'` branches in `AdminModule.tsx` (load function around line 582, JSX block around line 2007). Keep these errors visible — they are the checklist for Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/app/router.tsx src/pipeline/pages/modules/AdminModule.tsx
git commit -m "refactor(admin): redirect /admin/members to /admin/customers"
```

---

### Task 2: Remove the `Members` entry from the Admin subnav

**Files:**

- Modify: `src/pipeline/pages/modules/AdminModule.tsx:55-66`

- [ ] **Step 1: Edit the `subnav` array**

In `src/pipeline/pages/modules/AdminModule.tsx`, current lines 55–66 look like:

```ts
const subnav = [
  { label: 'Telecallers', to: '/admin/telecallers' },
  { label: 'Users', to: '/admin/users' },
  { label: 'Audit', to: '/admin/audit' },
  { label: 'Roles', to: '/admin/roles' },
  { label: 'Vendor Forms', to: '/admin/vendors' },
  { label: 'Vendor Requests', to: '/admin/registrations' },
  { label: 'Customers', to: '/admin/customers' },
  { label: 'Locations', to: '/admin/locations' },
  { label: 'Notifications', to: '/admin/notifications' },
  { label: 'Members', to: '/admin/members' },
]
```

Delete the `Members` line so it becomes:

```ts
const subnav = [
  { label: 'Telecallers', to: '/admin/telecallers' },
  { label: 'Users', to: '/admin/users' },
  { label: 'Audit', to: '/admin/audit' },
  { label: 'Roles', to: '/admin/roles' },
  { label: 'Vendor Forms', to: '/admin/vendors' },
  { label: 'Vendor Requests', to: '/admin/registrations' },
  { label: 'Customers', to: '/admin/customers' },
  { label: 'Locations', to: '/admin/locations' },
  { label: 'Notifications', to: '/admin/notifications' },
]
```

- [ ] **Step 2: Commit**

```bash
git add src/pipeline/pages/modules/AdminModule.tsx
git commit -m "refactor(admin): drop Members subnav entry"
```

---

### Task 3: Remove the members view block and dead member state from AdminModule

**Files:**

- Modify: `src/pipeline/pages/modules/AdminModule.tsx` (multiple regions — see steps)

**What dies in this task (inventory — use this to verify you removed everything):**

- `MemberRecord, listMembersPage, lookupMemberByPhone, type MemberPageSource` imports (line 10–14)
- `members`, `memberCursorStack`, `memberPageIndex`, `memberHasMore`, `memberSource`, `memberLookupResult`, `memberSearch`, `debouncedMemberSearch`, `membershipFilter`, `memberSyncing`, `selectedMember` state (lines 333–346)
- Debounce effect for member search (lines 384–391)
- `filteredMembers` memo (lines 439–454)
- `view === 'members'` branch inside `load()` (lines 582–606)
- Dependency entries for `debouncedMemberSearch`, `memberPageIndex` in the loader `useEffect` (lines 694–714)
- Member pagination reset effect (lines 727–730)
- `MEMBER_PAGE_SIZE` const (line 333)
- Entire `view === 'members'` JSX block (starts line 2007)
- The `Sync Members` button + `memberSyncing` references
- Any import-only fallout (e.g., `QueryDocumentSnapshot` if only used by members; check with `grep`)

- [ ] **Step 1: Remove member-only imports**

Delete lines that import from `../../api/asquare-members`. Leave the customer API imports untouched.

- [ ] **Step 2: Delete member state declarations**

Remove the block documented in the inventory (around lines 333–346 plus `MEMBER_PAGE_SIZE`). Keep customer-side state intact.

- [ ] **Step 3: Delete the member debounce and filteredMembers memo**

Remove the `useEffect` for `memberSearch` (≈384–391) and the entire `filteredMembers = useMemo(...)` block (≈439–454).

- [ ] **Step 4: Delete the `view === 'members'` branch in `load()`**

In the `load` async function, delete the `else if (view === 'members') { ... }` block (≈582–606). Confirm the surrounding `else if` chain is still syntactically valid.

- [ ] **Step 5: Delete the members view JSX**

Delete the entire `{view === 'members' ? ( ... ) : null}` block starting at line 2007. Verify balanced JSX with your editor.

- [ ] **Step 6: Clean up the main loader `useEffect` deps**

Remove `debouncedMemberSearch` and `memberPageIndex` from the dependency array (currently at lines 694–714). Remove the member-pagination reset effect too.

- [ ] **Step 7: Prune imports that became unused**

Run: `npx tsc --noEmit -p tsconfig.app.json`
For each "is declared but its value is never read" error, delete the orphan import. Expect `QueryDocumentSnapshot`, `DocumentData` to possibly still be used by customer pagination — do not delete if they are.

- [ ] **Step 8: Lint**

Run: `npm run lint -- --max-warnings=0 src/pipeline/pages/modules/AdminModule.tsx`
Expected: no errors for unused vars.

- [ ] **Step 9: Commit**

```bash
git add src/pipeline/pages/modules/AdminModule.tsx
git commit -m "refactor(admin): remove members view and dead state"
```

---

### Task 4: Add a pure `sortAndFilterCustomers` helper with unit tests

**Files:**

- Create: `src/pipeline/pages/modules/admin/customerListView.ts`
- Create: `src/pipeline/pages/modules/admin/customerListView.test.ts`

**Why a dedicated file:** Isolates the comparator so we can unit-test it without mounting React, and so `AdminModule.tsx` (already 3461 lines) doesn't grow further.

- [ ] **Step 1: Write the failing tests**

Create `src/pipeline/pages/modules/admin/customerListView.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AsquareCustomer } from '../../../api/asquare-customers'
import { sortAndFilterCustomers, type CustomerListOptions } from './customerListView'

const makeCustomer = (overrides: Partial<AsquareCustomer> = {}): AsquareCustomer => ({
  id: 'c1',
  displayName: 'Alpha',
  email: 'a@x.com',
  phone: '9000000001',
  tier: 'bronze',
  isVerified: false,
  referralCode: '',
  referredBy: '',
  tires: 0,
  walletBalance: 0,
  lastLoginAt: new Date(0),
  updatedAt: new Date(0),
  createdAt: new Date(0),
  bookingCount: 0,
  totalSpent: 0,
  coupons150Earned: 0,
  coupons150Available: 0,
  ...overrides,
})

const baseOpts: CustomerListOptions = {
  searchTerm: '',
  membershipFilter: '',
  verifiedFilter: '',
  sortKey: '',
  sortDir: 'desc',
}

describe('sortAndFilterCustomers', () => {
  it('returns all rows when no filters set', () => {
    const rows = [makeCustomer({ id: 'a' }), makeCustomer({ id: 'b' })]
    expect(sortAndFilterCustomers(rows, baseOpts)).toHaveLength(2)
  })

  it('filters by case-insensitive name / email / phone substring', () => {
    const rows = [
      makeCustomer({ id: 'a', displayName: 'Ravi Kumar' }),
      makeCustomer({ id: 'b', displayName: 'Anita', email: 'anita@x.com' }),
      makeCustomer({ id: 'c', displayName: 'Other', phone: '9876543210' }),
    ]
    expect(
      sortAndFilterCustomers(rows, { ...baseOpts, searchTerm: 'RAVI' }).map((c) => c.id),
    ).toEqual(['a'])
    expect(
      sortAndFilterCustomers(rows, { ...baseOpts, searchTerm: 'anita@' }).map((c) => c.id),
    ).toEqual(['b'])
    expect(
      sortAndFilterCustomers(rows, { ...baseOpts, searchTerm: '98765' }).map((c) => c.id),
    ).toEqual(['c'])
  })

  it('filters by membership case-insensitively, treating missing membership as none', () => {
    const rows = [
      makeCustomer({ id: 'a', membership: 'Gold' }),
      makeCustomer({ id: 'b', membership: undefined }),
      makeCustomer({ id: 'c', membership: 'silver' }),
    ]
    expect(
      sortAndFilterCustomers(rows, { ...baseOpts, membershipFilter: 'gold' }).map((c) => c.id),
    ).toEqual(['a'])
    expect(
      sortAndFilterCustomers(rows, { ...baseOpts, membershipFilter: 'none' }).map((c) => c.id),
    ).toEqual(['b'])
  })

  it('filters by verified state', () => {
    const rows = [
      makeCustomer({ id: 'a', isVerified: true }),
      makeCustomer({ id: 'b', isVerified: false }),
    ]
    expect(
      sortAndFilterCustomers(rows, { ...baseOpts, verifiedFilter: 'verified' }).map((c) => c.id),
    ).toEqual(['a'])
    expect(
      sortAndFilterCustomers(rows, { ...baseOpts, verifiedFilter: 'unverified' }).map((c) => c.id),
    ).toEqual(['b'])
  })

  it('sorts by totalSpent desc then asc', () => {
    const rows = [
      makeCustomer({ id: 'a', totalSpent: 100 }),
      makeCustomer({ id: 'b', totalSpent: 300 }),
      makeCustomer({ id: 'c', totalSpent: 200 }),
    ]
    expect(
      sortAndFilterCustomers(rows, { ...baseOpts, sortKey: 'totalSpent', sortDir: 'desc' }).map(
        (c) => c.id,
      ),
    ).toEqual(['b', 'c', 'a'])
    expect(
      sortAndFilterCustomers(rows, { ...baseOpts, sortKey: 'totalSpent', sortDir: 'asc' }).map(
        (c) => c.id,
      ),
    ).toEqual(['a', 'c', 'b'])
  })

  it('sorts by displayName using locale compare', () => {
    const rows = [
      makeCustomer({ id: 'a', displayName: 'Charlie' }),
      makeCustomer({ id: 'b', displayName: 'alpha' }),
      makeCustomer({ id: 'c', displayName: 'Bravo' }),
    ]
    expect(
      sortAndFilterCustomers(rows, { ...baseOpts, sortKey: 'displayName', sortDir: 'asc' }).map(
        (c) => c.id,
      ),
    ).toEqual(['b', 'c', 'a'])
  })

  it('returns input order when sortKey is empty', () => {
    const rows = [
      makeCustomer({ id: 'b', totalSpent: 300 }),
      makeCustomer({ id: 'a', totalSpent: 100 }),
    ]
    expect(sortAndFilterCustomers(rows, baseOpts).map((c) => c.id)).toEqual(['b', 'a'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pipeline/pages/modules/admin/customerListView.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/pipeline/pages/modules/admin/customerListView.ts`:

```ts
import type { AsquareCustomer } from '../../../api/asquare-customers'

export type CustomerSortKey =
  | ''
  | 'displayName'
  | 'bookingCount'
  | 'totalSpent'
  | 'walletBalance'
  | 'tires'
  | 'createdAt'

export type CustomerVerifiedFilter = '' | 'verified' | 'unverified'

export interface CustomerListOptions {
  searchTerm: string
  membershipFilter: string
  verifiedFilter: CustomerVerifiedFilter
  sortKey: CustomerSortKey
  sortDir: 'asc' | 'desc'
}

const membershipOf = (c: AsquareCustomer): string => (c.membership ?? '').toLowerCase()

export const sortAndFilterCustomers = (
  customers: readonly AsquareCustomer[],
  opts: CustomerListOptions,
): AsquareCustomer[] => {
  const term = opts.searchTerm.trim().toLowerCase()
  const membership = opts.membershipFilter.toLowerCase()

  const filtered = customers.filter((c) => {
    if (term) {
      const hit =
        c.displayName.toLowerCase().includes(term) ||
        c.email.toLowerCase().includes(term) ||
        c.phone.includes(term)
      if (!hit) return false
    }
    if (membership) {
      const value = membershipOf(c)
      if (membership === 'none') {
        if (value) return false
      } else if (value !== membership) {
        return false
      }
    }
    if (opts.verifiedFilter === 'verified' && !c.isVerified) return false
    if (opts.verifiedFilter === 'unverified' && c.isVerified) return false
    return true
  })

  if (!opts.sortKey) return filtered

  const dir = opts.sortDir === 'asc' ? 1 : -1
  const key = opts.sortKey
  return [...filtered].sort((a, b) => {
    if (key === 'displayName') {
      return a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' }) * dir
    }
    if (key === 'createdAt') {
      return (a.createdAt.getTime() - b.createdAt.getTime()) * dir
    }
    const av = a[key] as number
    const bv = b[key] as number
    return (av - bv) * dir
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pipeline/pages/modules/admin/customerListView.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/pages/modules/admin/customerListView.ts src/pipeline/pages/modules/admin/customerListView.test.ts
git commit -m "feat(admin): add sortAndFilterCustomers helper with tests"
```

---

### Task 5: Add sort/filter/viewing state to AdminModule

**Files:**

- Modify: `src/pipeline/pages/modules/AdminModule.tsx` (customer state region, ~lines 302–317)
- Modify: `src/pipeline/pages/modules/AdminModule.tsx` (filteredCustomers memo, ~lines 406–418)

- [ ] **Step 1: Import the helper and types**

Near the other admin-internal imports at the top of `AdminModule.tsx`, add:

```ts
import {
  sortAndFilterCustomers,
  type CustomerListOptions,
  type CustomerSortKey,
  type CustomerVerifiedFilter,
} from './admin/customerListView'
```

- [ ] **Step 2: Add the new state in the Customer management region**

Locate the existing `// Customer management state` block (around line 298). Directly after the existing `customerTierFilter` state, add:

```ts
const [customerMembershipFilter, setCustomerMembershipFilter] = useState('')
const [customerVerifiedFilter, setCustomerVerifiedFilter] = useState<CustomerVerifiedFilter>('')
const [customerSortKey, setCustomerSortKey] = useState<CustomerSortKey>('')
const [customerSortDir, setCustomerSortDir] = useState<'asc' | 'desc'>('desc')
const [viewingCustomer, setViewingCustomer] = useState<AsquareCustomer | null>(null)
```

- [ ] **Step 3: Rewrite `filteredCustomers` to use the helper**

Replace the entire existing `filteredCustomers` memo (~lines 406–418) with:

```tsx
const filteredCustomers = useMemo(() => {
  if (customerLookupResult === 'empty') return []
  if (customerLookupResult) return [customerLookupResult]

  const opts: CustomerListOptions = {
    searchTerm: debouncedCustomerSearch,
    membershipFilter: customerMembershipFilter,
    verifiedFilter: customerVerifiedFilter,
    sortKey: customerSortKey,
    sortDir: customerSortDir,
  }
  return sortAndFilterCustomers(customers, opts)
}, [
  customers,
  customerLookupResult,
  debouncedCustomerSearch,
  customerMembershipFilter,
  customerVerifiedFilter,
  customerSortKey,
  customerSortDir,
])
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/pages/modules/AdminModule.tsx
git commit -m "feat(admin): wire sort/filter state for Customers view"
```

---

### Task 6: Extend the Customers `FilterBar` with the new controls

**Files:**

- Modify: `src/pipeline/pages/modules/AdminModule.tsx` (Customers `FilterBar`, ~lines 1707–1731)

- [ ] **Step 1: Add new `<FilterField>` entries to the existing bar**

Inside the `view === 'customers'` block, find the `FilterBar` that currently wraps Search + Tier. After the `Tier` field, insert:

```tsx
<FilterField label="Membership">
  <select
    className="ui-field min-h-10"
    value={customerMembershipFilter}
    onChange={(event) => setCustomerMembershipFilter(event.target.value)}
  >
    <option value="">All Memberships</option>
    <option value="none">No membership</option>
    <option value="silver">Silver</option>
    <option value="gold">Gold</option>
    <option value="platinum">Platinum</option>
  </select>
</FilterField>
<FilterField label="Verified">
  <select
    className="ui-field min-h-10"
    value={customerVerifiedFilter}
    onChange={(event) =>
      setCustomerVerifiedFilter(event.target.value as CustomerVerifiedFilter)
    }
  >
    <option value="">All</option>
    <option value="verified">Verified only</option>
    <option value="unverified">Unverified only</option>
  </select>
</FilterField>
<FilterField label="Sort by">
  <select
    className="ui-field min-h-10"
    value={customerSortKey}
    onChange={(event) => setCustomerSortKey(event.target.value as CustomerSortKey)}
  >
    <option value="">Default (newest)</option>
    <option value="displayName">Name</option>
    <option value="bookingCount">Visits</option>
    <option value="totalSpent">Total spent</option>
    <option value="walletBalance">Wallet</option>
    <option value="tires">Tires</option>
    <option value="createdAt">Created</option>
  </select>
</FilterField>
<FilterField label="Direction">
  <select
    className="ui-field min-h-10"
    value={customerSortDir}
    onChange={(event) => setCustomerSortDir(event.target.value as 'asc' | 'desc')}
    disabled={!customerSortKey}
  >
    <option value="desc">Desc</option>
    <option value="asc">Asc</option>
  </select>
</FilterField>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/AdminModule.tsx
git commit -m "feat(admin): add membership/verified/sort controls to Customers filter bar"
```

---

### Task 7: Wire the `View` action to open `CustomerDetailPanel`

**Files:**

- Modify: `src/pipeline/pages/modules/AdminModule.tsx` (Customers `DataTable` actions column + render the panel)
- Check: `src/pipeline/components/CustomerDetailPanel.tsx` — already exists, no change.

- [ ] **Step 1: Confirm the import**

At the top of `AdminModule.tsx`, add (if missing):

```ts
import { CustomerDetailPanel } from '../../components/CustomerDetailPanel'
```

Verify path: HEAD location is [CustomerDetailPanel.tsx](src/pipeline/components/CustomerDetailPanel.tsx), and AdminModule lives in `src/pipeline/pages/modules/`, so the relative path is `../../components/CustomerDetailPanel`.

- [ ] **Step 2: Add a `View` button in the `actions` column of the Customers table**

Find the customer table `actions` column (currently Edit + Delete). Prepend a View button:

```tsx
<button
  type="button"
  onClick={() => setViewingCustomer(c)}
  className="ui-btn ui-btn-info min-h-8 px-2 py-1 text-xs"
>
  View
</button>
```

Keep the existing Edit and Delete buttons in place.

- [ ] **Step 3: Render the panel conditionally at the end of the Customers view block**

Immediately after the Customers pagination controls (still inside the `view === 'customers' ? ( ... ) : null` fragment), add:

```tsx
{
  viewingCustomer ? (
    <CustomerDetailPanel customer={viewingCustomer} onClose={() => setViewingCustomer(null)} />
  ) : null
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 5: Unit test suite sanity**

Run: `npm run test:run -- src/pipeline/pages/modules/admin`
Expected: the 7 helper tests still pass; nothing else regresses.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/pages/modules/AdminModule.tsx
git commit -m "feat(admin): open CustomerDetailPanel from Customers table"
```

---

### Task 8: Manual smoke test + cleanup of `_stash-recovery/`

**Files:**

- Remove (once verified): `_stash-recovery/` directory

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Open: `http://pipeline.localhost:5173/admin/customers`

- [ ] **Step 2: Exercise the merged view**

Verify in order:

1. The page loads without runtime errors in console.
2. Subnav no longer shows `Members`.
3. Navigating directly to `http://pipeline.localhost:5173/admin/members` redirects to `/admin/customers`.
4. Entering a 10-digit phone in Search resolves a single-row lookup.
5. Selecting each filter dropdown narrows results as expected.
6. Changing sort key + direction reorders the visible rows.
7. Clicking `View` on a row opens `CustomerDetailPanel` with avg spend / last visit / coupons / branch-wise visits. Close button dismisses it.
8. Edit + Delete row actions still work.
9. Next/Prev pagination still advances the server cursor.

- [ ] **Step 3: Lint + test gate**

Run: `npm run lint && npm run test:run`
Expected: both pass.

- [ ] **Step 4: Delete the stash-recovery sandbox**

Run:

```bash
rm -rf _stash-recovery
```

- [ ] **Step 5: Drop the consumed stash**

Identify the WIP stash created from base `685acc5` (commit pair `d2a6a654` / `c8f5d3e8`) in `git stash list`. Only drop it once the manual test has passed — otherwise the dangling commit remains recoverable.

Run: `git stash list`
If `stash@{0}` is the lint-staged backup for THIS session's changes, leave it. If the WIP-on-main stash is present, drop only that one by SHA:

```bash
# Find its stash index, e.g. stash@{N} pointing to d2a6a654
git stash drop stash@{N}
```

If the stash is no longer referenced by a stash entry (common for WIP stashes surfaced only via `git fsck`), git's gc will eventually prune it — no action needed.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore(admin): remove stash-recovery sandbox after merge"
```

---

## Out of Scope (explicit)

- **Do NOT add** `totalVisits`, `totalBillAmount`, `coupons150Redeemed` required fields to `AsquareCustomer`. The stash version did, but HEAD's `CustomerDetailPanel` does not depend on them, and making them required breaks the many legacy documents without `memberData`.
- **Do NOT add** `listAllCustomers` / `allCustomersCache`. The existing cursor pagination is the intended scaling path; the stash's approach was identified as a regression.
- **Do NOT touch** `BillingModule`, `generateBillingReceipt`, `useCreateBooking`, `FeedbackCallDetailSlideOver`. They consume `asquare-members` APIs and are not part of this merge.
- Server-side sorting/filtering of membership + verified fields would need composite Firestore indexes and is deferred to a separate plan.
