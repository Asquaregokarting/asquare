# CLAUDE.md — A Square GoKarting App

## Overview

Dual-app platform for A Square GoKarting: a **Customer App** (booking, games, wallet) and a **Pipeline Admin App** (operations dashboard). 4 branches: Vizag, Kakinada, Rajahmundry, Srikakulam.

**Tech stack:** React 18 + TypeScript + Vite 6 + Tailwind 3 + Firebase 12 (Auth, Firestore, Storage, Functions) + Capacitor 8 (mobile) + Razorpay (payments)

---

## Architecture

### Dual-App Boundary (strictly enforced)

| Scope      | Customer App                                           | Pipeline Admin                |
| ---------- | ------------------------------------------------------ | ----------------------------- |
| Pages      | `src/pages/`                                           | `src/pipeline/pages/modules/` |
| Services   | `src/services/*Service.ts`                             | `src/pipeline/api/*.ts`       |
| Components | `src/components/`                                      | `src/pipeline/components/`    |
| Contexts   | `src/contexts/`                                        | `src/pipeline/features/*/`    |
| Router     | `src/CustomerApp.tsx`                                  | `src/PipelineApp.tsx`         |
| Entry      | `src/main.tsx` routes via `?app=pipeline` or subdomain | Same                          |

- **Never** import pipeline code into the customer app or vice versa.
- Shared types live in `src/types/`. Shared utilities live in `src/lib/`.
- Firebase config is shared from `src/lib/firebase.ts`.

### App Detection

- Query param: `?app=pipeline`
- Subdomain: `pipeline.localhost` or `pipeline.asquaregokarting.com`

---

## Data Layer

### Customer App — Service Layer

Services are singleton objects in `src/services/`. All Firestore access goes through services, never raw Firestore calls in components.

```ts
// Pattern:
export const bookingService = {
  async createBooking(params: CreateBookingParams): Promise<Booking> { ... }
}
```

### Pipeline Admin — API Layer

API modules in `src/pipeline/api/`. Same rule: no raw Firestore in components.

```ts
// Pattern:
export const asquareBookingsApi = {
  async getBooking(id: string): Promise<AsquareBooking> { ... }
}
```

### Databases

- `asquare-app-db` — sole live Firestore database (bookings, users, activities, billing, members, phoneToUid index, all pipeline admin data)
- `pipeline` — **deprovisioned** (April 2026). Was a secondary database for admin-specific data; all contents were migrated to `asquare-app-db` via `scripts/archive/migrate-pipeline-to-asquare.ts` and the database was deleted from the Firebase project. Do not recreate.

### State Management

- **Server state:** TanStack React Query v5
- **Client state:** React Context (Auth, Booking, Cart, Games, Theme, Toast)
- **Persistence:** localStorage (web), IndexedDB (mobile/auth)

---

## Firestore & Security

- The current `firestore.rules` is **intentionally permissive** for this
  project — the team has confirmed wide-open rules are by design. Don't
  flag this as a security gap.
- Wallet/tire balance changes **must** use Firestore transactions (atomic),
  even though the rules don't enforce it. See `walletService.deductBalance`
  for the canonical example using `runTransaction`.
- Treat sensitive data (phone, payment payloads, OTP) carefully at the
  application layer — the logger scrubs these but call sites should still
  avoid passing them around unnecessarily.

---

## Coding Conventions

### Naming

- Components: `PascalCase.tsx`
- Services: `camelCaseService.ts`
- API modules: `kebab-case.ts` (pipeline) or `camelCase.ts`
- Types/Interfaces: `PascalCase` in `src/types/`
- Constants: `UPPER_SNAKE_CASE`

### File Placement

- New customer pages → `src/pages/`
- New admin modules → `src/pipeline/pages/modules/`
- Shared UI components → `src/components/` or `src/pipeline/components/ui/`
- Custom hooks → `src/hooks/`
- Co-locate component-specific types in the component file. Shared types in `src/types/`.

### Styling

- Tailwind utility classes only. No inline styles, no CSS modules.
- Custom colors: primary blue `#0066FF`, secondary orange `#FF6B00` (defined in `tailwind.config.js`).
- Animations: Framer Motion.
- Icons: Lucide React.

### Imports

```ts
// Firebase from shared lib
import { db, auth } from '../lib/firebase'

// Pipeline uses path alias
import { useAuth } from '@pipeline/features/auth/auth-context'

// Types
import type { User, Booking } from '../types'
```

### New Pages

- Must be lazy-loaded with `React.lazy()`.
- Must be added to the appropriate router (`CustomerApp.tsx` or pipeline router).

---

## Roles & Access Control

Pipeline users have roles that gate UI and data access:

- **Owner** — full access
- **Admin** — operations management
- **Cashier** — billing and POS
- **Telecaller** — leads and follow-ups
- **TrackMarshall** — ride scanning and track ops
- **Editor** — content management
- **Developer** — technical access
- **Backend** — backend operations
- **ThirdParty** — limited external access

Always check role before showing admin features. Dashboards are role-specific (`src/pipeline/pages/dashboard/`).

---

## Multi-Branch

All bookings, billing, reporting, and shift features **must** support branch filtering. Branch is stored as a field on documents. The 4 branches:

1. Vizag (Visakhapatnam, branchId `0`)
2. Kakinada (branchId `1`)
3. Rajahmundry (branchId `2`)
4. Srikakulam (branchId `5`)

Source of truth: `src/lib/locations.ts`. Branches are loaded from Firestore `locations/` at runtime; the fallback list above is what ships in the bundle.

---

## Payments & Billing

- Payments via **Razorpay** — never store card/payment details in Firestore.
- Use `generateBillingId()` and `generateOrderNumber()` for IDs — never manual.
- Booking confirmations trigger **Interakt webhook** for SMS/WhatsApp notifications.
- Payment links generated via Cloud Functions.

---

## Error Handling

Use the existing error hierarchy:

- `ApplicationError` — general app errors
- `APIError` — API/network failures
- `ValidationError` — input validation
- `PaymentError` — payment-specific

Always try-catch Firestore operations. Never throw raw strings.

A top-level `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) wraps both
the customer and pipeline app trees in `src/main.tsx`. Render-time errors
anywhere below it are caught and surfaced via the structured logger. For
section-level recoverable errors use `src/components/ui/ErrorState.tsx`.

---

## Logging

**Never use raw `console.log/warn/error` in new code.** Use the structured
logger instead:

```ts
import { logger } from '../lib/logger'

logger.info('booking.created', { bookingId, branchId })
logger.error('payment.failed', err, { orderNumber })
```

The logger:

- Scrubs sensitive keys (`phone`, `otp`, `razorpayPaymentId`, etc.) before
  emitting.
- Suppresses `debug`/`info` in production builds.
- Has a pluggable reporter — Sentry/Crashlytics will be wired into
  `setLogReporter()` later without touching call sites.

---

## Analytics

Use the typed analytics facade — never import `firebase/analytics` directly:

```ts
import { analytics, AnalyticsEvent } from '../lib/analytics'

analytics.track(AnalyticsEvent.BookingStarted, { branchId })
analytics.identify(user.id, { tier: user.tier })
```

Add new event names to the `AnalyticsEvent` enum in `src/lib/analytics.ts`.
Renaming events breaks historical reporting — adding is cheap, renaming is
expensive.

---

## UX state primitives

For consistency, reach for these instead of bespoke gray boxes / centered
divs:

- `src/components/ui/Skeleton.tsx` — loading placeholders.
- `src/components/ui/EmptyState.tsx` — "no bookings yet", "no transactions".
- `src/components/ui/ErrorState.tsx` — recoverable per-section errors.

---

## Testing

- Vitest is configured with Firebase + Capacitor mocks (`src/test/setup.ts`).
- Test files live next to the code as `*.test.ts` / `*.test.tsx`.
- Per-file coverage thresholds are pinned in `vitest.config.ts` for the
  modules already under test — they act as regression guards. Add new
  thresholds when you add tests.
- Playwright E2E in `e2e/`. The OTP → checkout → Razorpay flow lives in
  `e2e/booking-flow.spec.ts` (currently skipped — see file header).
- Run `npm run test:run` for unit, `npm run test:coverage` for coverage,
  `npm run test:e2e` for Playwright (after `npx playwright install`).

---

## TypeScript

- All new code must be `.ts` / `.tsx`. No `.js` files.
- No `any` — prefer `unknown` with type guards.
- Strict mode is enabled in `tsconfig.app.json`.

---

## Domain Rules

### Bookings

- Statuses: `confirmed`, `pending`, `cancelled`, `rescheduled`
- Status transitions must be validated (e.g., can't go from `cancelled` to `confirmed`).
- Each booking belongs to a branch.

### Wallet & Tires

- Balance changes must be **atomic Firestore transactions**.
- Always log credit/debit with reason and timestamp.

### Coupons

Validation checklist:

- Expiry date
- Usage limits (per-user and global)
- Branch applicability
- Minimum order value

### Scanner (Track Operations)

Flow: **Scan QR/serial → Validate → Mark ride as used**. Never mark a ride without validation.

---

## Mobile / Capacitor

- Features must work on web **and** Capacitor (iOS/Android).
- Auth uses IndexedDB persistence on mobile.
- Check platform before using web-only APIs.
- App ID: `com.asquaregokarting.app`

---

## Build & Performance

- Vite manual chunk splitting: `vendor-react`, `vendor-firebase`, `vendor-ui`, `vendor-3d`.
- Chunk size warning at 1600KB — keep bundles lean.
- Don't introduce circular imports.
- Code-split pages with `React.lazy()`.

### Commands

```bash
npm run dev      # Dev server
npm run build    # TypeScript compile + Vite bundle
npm run lint     # ESLint
```

---

## Safety

- Never commit `.env` files or API keys.
- Razorpay keys, Firebase config, and webhook secrets go in environment variables.
- Validate all user input at system boundaries.
- Follow OWASP guidelines — no XSS, injection, or insecure direct object references.

<!-- code-review-graph MCP tools -->

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool                        | Use when                                               |
| --------------------------- | ------------------------------------------------------ |
| `detect_changes`            | Reviewing code changes — gives risk-scored analysis    |
| `get_review_context`        | Need source snippets for review — token-efficient      |
| `get_impact_radius`         | Understanding blast radius of a change                 |
| `get_affected_flows`        | Finding which execution paths are impacted             |
| `query_graph`               | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes`     | Finding functions/classes by name or keyword           |
| `get_architecture_overview` | Understanding high-level codebase structure            |
| `refactor_tool`             | Planning renames, finding dead code                    |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:

- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
