# RBAC capabilities refactor — scope

**Status**: scoping  ·  **Owner**: dev.asquaregokarting@gmail.com  ·  **Date**: 2026-05-11

## Goal

Make **adding a new role** a one-row change instead of a 7-file change. Allow Owner to flip individual capabilities per role from the dashboard (no code deploy).

## Current pain (measured)

- `Role` enum has **10 values**, the new matrix needs **8** (drop 4, add 2)
- **232 `role === 'X'` / `role !== 'X'` comparisons** across **~80 production files**
- Role definitions live in **7 files**, none of which are the source of truth:
  - `src/pipeline/api/types.ts` — `Role` enum
  - `src/pipeline/features/dashboard/role-config.ts` — `roleConfig`, `rolePathMap`
  - `src/pipeline/features/navigation/action-route-map.ts` — per-role action routes
  - `src/pipeline/features/navigation/module-manifest.ts` — `canRoleAccessTab`, sidebar tabs
  - `src/pipeline/components/layout/Sidebar.tsx` — role gates
  - `src/pipeline/components/layout/AppShell.tsx` — FAB visibility
  - `src/pipeline/pages/modules/bookings/bookings-utils.ts` — `normalizeRole` + lowercase variants

Every new role requires touching all of these plus every `role === 'X'` site.

## Proposed architecture

### 1. Capabilities are the source of truth

Add `src/pipeline/features/permissions/capabilities.ts`:

```ts
export type Capability =
  // Booking & billing
  | 'booking.view-own-branch'
  | 'booking.view-cross-branch'
  | 'booking.create'
  | 'booking.invoice'
  | 'booking.refund.small'      // ≤ ₹500
  | 'booking.refund.large'      // > ₹500
  | 'booking.refund.large.approve'
  | 'booking.refund.large.request'
  // Shifts
  | 'shift.open-close.any'
  | 'shift.open-close.self'
  // Track / karts
  | 'kart.edit-status'
  | 'incident.log'
  | 'incharge.checklist'
  // Leads
  | 'lead.claim-dispose'
  // Admin
  | 'user.provision'
  | 'user.provision.scoped'
  | 'pricing.edit'
  | 'vendor.settlement.view'
  | 'vendor.settlement.view.self'
  | 'gst.export'
  | 'system.settings'
  // Analytics
  | 'analytics.cross-branch'
```

One identifier per row of your matrix. Each `Capability` is a stable string id.

### 2. Per-role capability sets live in Firestore

Collection `roleCapabilities/{role}`:

```ts
{
  role: 'Owner',
  capabilities: ['booking.create', 'booking.invoice', /* ... */],
  updatedAt: Timestamp,
  updatedBy: 'uid-of-owner',
}
```

Owner edits these from the new admin UI (point 5 below). The matrix in your table becomes the **seed data** for the first deploy.

### 3. Loading + caching

Hook into the existing `auth-context.tsx`:

```ts
// After session is hydrated, fetch roleCapabilities/{session.user.role} once
// and cache on the AuthContext as session.user.capabilities: Set<Capability>.
// Subscribe to the doc so flips by Owner reach other open sessions live.
```

On capability miss in dev → log loud, fail closed (no access).

### 4. The single permission helper

```ts
export function hasCapability(
  session: Session | null,
  capability: Capability,
): boolean {
  return !!session?.user.capabilities?.has(capability)
}
```

This replaces every `role === 'Owner' || role === 'Admin'` check.

### 5. Owner-facing UI (new module)

`src/pipeline/pages/modules/admin/RolesCapabilities.tsx` — checkbox grid that IS your matrix:

```
              | Owner | Admin | Cashier | TrackMarshal | Incharge | Telecaller | Vendor | Customer
booking.create| ✓     | ✓     | ✓       | ✓            |          | ✓          |        | ✓
booking.invoice| ✓    | ✓     | ✓       |              |          |            |        |
...
```

Click a checkbox → writes the role's capability set to Firestore. Live for all sessions within seconds.

Gated by `hasCapability('system.settings')` so only Owner can edit.

### 6. Existing config files: keep as derived data

`roleConfig` / `module-manifest` / `action-route-map` stay, but lose their permission semantics. They keep what's genuinely per-role-UI (dashboard title, sidebar label, KPI list). Permission gates move to capability checks.

### 7. The `Role` enum

Settle on 8 values to match your matrix:
- Owner, Admin, Cashier, TrackMarshall, Incharge, Telecaller, Vendor, Customer

Dropped from the current enum: Editor, Developer, Backend, ThirdParty. See decision question 1 below.

## Migration plan (incremental, safe)

**Phase 1 — Add capability layer alongside existing code** (low risk, no behavior change)
- Create `Capability` type and helpers
- Seed `roleCapabilities/{role}` Firestore docs with your matrix as initial state
- Add capability loading to `AuthContext`
- Add `hasCapability()` helper
- Add the Owner-facing matrix UI under `/admin/roles-capabilities`

Estimate: **half a day**. Ship-able and reviewable in one PR.

**Phase 2 — Migrate role checks to capabilities** (medium risk, behavior preserved by 1:1 mapping)

For each of the 232 `role === 'X'` sites, replace with `hasCapability(session, '<id>')`. Done in batches by feature area:
- Bookings (~25 sites)
- Billing / refunds (~20 sites)
- Shifts (~15 sites)
- Track / scanner (~20 sites)
- Admin / Settings (~15 sites)
- Helicopter (~15 sites)
- Tickets (~12 sites)
- Reports / Accounting (~10 sites)
- Dashboard / nav (~30 sites)
- Reconciliation / Coupons / Activities (~15 sites)
- Rest (~55 sites)

Each batch is a separate PR. The mapping `role === 'X'` → `hasCapability(...)` is mechanical from the matrix.

Estimate: **2–3 days total** spread across batches. Safe because the mapping is 1:1 with current behavior, and we can run new + old gates side-by-side during transition.

**Phase 3 — Remove dropped roles + delete dead branches** (cleanup)
- Update `Role` enum to 8 values
- Delete `Editor` / `Developer` / `Backend` / `ThirdParty` config (after Phase 2 verifies nothing depends on them via capability)
- Remove `normalizeRole` lowercase aliases that are no longer needed

Estimate: **half a day** after Phase 2.

## Decision questions (need your call before Phase 1)

1. **Dropped roles** (Editor / Developer / Backend / ThirdParty):
   - (a) Keep with zero capabilities (preserves backward-compat for existing user docs that still have these roles)
   - (b) Remove entirely (cleaner, but every user with one of these roles needs reassignment first)
   - (c) Map to the new roles — e.g. `Developer` → `Admin`, `ThirdParty` → `Vendor`
   - **My recommendation**: (a) for Phase 1, decide (b)/(c) in Phase 3 after seeing actual user counts per role.

2. **"View own branch" vs "View cross-branch"** for Customer:
   - Customer in your matrix has no `view own branch` (you wrote "—"). Yet Customer needs to see their OWN bookings in the customer app. Is `view-own-branch` here scoped to the admin/operations dashboards specifically? I'll model it that way unless you correct me.

3. **`booking.refund.large.approve` vs `request`** split — Admin "approval", Cashier "request only". I'll model these as two separate capabilities so the UI can show "Request refund" vs "Approve refund" buttons distinctly. Confirm?

4. **Where in the Owner dashboard does the matrix UI go?**
   - (a) New module `/admin/roles-capabilities` (separate page, full grid)
   - (b) Inside existing AdminModule (`/admin/roles` already exists per route map)
   - **My recommendation**: (b) — it's the natural home and the route already exists.

5. **Live updates** when Owner flips a capability — should all other logged-in sessions see it within seconds (Firestore `onSnapshot` listener), or only on next login? Live is mildly more code but feels right for "I just took away Cashier's refund permission and don't want to wait for them to log out."

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Missed `role === 'X'` site → silent permission gap | medium | grep audit before each batch PR; lint rule that bans new `role === 'X'` comparisons after Phase 1 lands |
| Capability load fails on login → user locked out | low | fail-open to the role's seeded default capabilities if Firestore read fails; log error |
| Owner accidentally removes critical capability from their own role → lockout | low-medium | seed `system.settings` for Owner only and disallow removing it from Owner via the UI |
| Phase 2 breaks tests | medium | run full test suite after each batch; mock `hasCapability` in test setup |
| Two engineers writing role checks during Phase 2 → conflict | low | feature-flag Phase 2 work; one batch at a time |

## What this doesn't do

- Does **not** add per-branch capabilities (e.g. "Cashier at Vizag but not Kakinada"). If you want that, it's a separate axis on top — possible but out of scope here.
- Does **not** change customer-app permissions (it's gated by Firebase Auth + Firestore rules, separate system).
- Does **not** consolidate Firebase Rules. Capability checks remain client-enforced; Firestore Rules continue to be permissive per the CLAUDE.md intentional-design note.

## Approval checklist

Please confirm or redirect:

- [ ] Capability identifier list above matches your matrix (or list any missing/wrong rows)
- [ ] Phase 1/2/3 split is OK, or you want it consolidated
- [ ] Decisions 1–5 above
- [ ] Where the matrix UI lives (decision 4)
- [ ] Live-updates on capability flip (decision 5)

Once these are checked I'll start Phase 1 in one PR.
