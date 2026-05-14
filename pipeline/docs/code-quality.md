# Code Quality Analysis -- A Square GoKarting Platform

**Date**: 2026-03-31
**Codebase**: React 18 + TypeScript + Vite 6 + Tailwind CSS 3 + Firebase 12 + ESLint 9
**Scope**: Full `src/` directory (Customer App + Pipeline Admin)

---

## Table of Contents

1. [Linting Analysis](#section-1-linting-analysis)
2. [Type Safety Analysis](#section-2-type-safety-analysis)
3. [Code Smells](#section-3-code-smells)
4. [Security Concerns](#section-4-security-concerns)
5. [Performance Concerns](#section-5-performance-concerns)
6. [Actionable Recommendations Summary](#section-6-actionable-recommendations-summary)

---

## Section 1: Linting Analysis

### Current ESLint Configuration

**File**: `eslint.config.js`

The project uses ESLint 9 flat config with the following plugins:

| Plugin                        | Config                |
| ----------------------------- | --------------------- |
| `@eslint/js`                  | `configs.recommended` |
| `typescript-eslint`           | `configs.recommended` |
| `eslint-plugin-react-hooks`   | `recommended-latest`  |
| `eslint-plugin-react-refresh` | `configs.vite`        |

Only `dist/` is in `globalIgnores`. The config applies to `**/*.{ts,tsx}` files.

---

### Finding: Excessive `console.*` Statements in Production Code

**Severity**: High
**Files**: 41 files, **186 total occurrences**
**Issue**: No `no-console` ESLint rule is configured. Console statements are scattered across every layer of the application including payment, auth, and booking logic.

**Top offending files by count:**

| File                                   | Count |
| -------------------------------------- | ----- |
| `src/services/bookingService.ts`       | 38    |
| `src/contexts/AuthContext.tsx`         | 26    |
| `src/pages/Checkout.tsx`               | 12    |
| `src/pipeline/api/asquare-bookings.ts` | 9     |
| `src/services/activityService.ts`      | 8     |
| `src/services/couponService.ts`        | 8     |
| `src/services/walletService.ts`        | 7     |
| `src/contexts/GamesContext.tsx`        | 7     |
| `src/pages/CheckInPage.tsx`            | 6     |
| `src/pages/Profile.tsx`                | 5     |

**Critical console statements in sensitive code:**

- `src/services/bookingService.ts:174` -- logs order submission errors with full error objects
- `src/services/bookingService.ts:258` -- logs payment link errors
- `src/services/razorpayService.ts:88` -- `console.log('Razorpay payment successful:', response)` logs payment response data
- `src/contexts/AuthContext.tsx:52` -- `console.log('Loaded user from storage, skipping API call')` leaks auth flow info
- `src/contexts/AuthContext.tsx:347` -- `console.log('Calling signInWithPhoneNumber...', phoneNumber)` logs user phone numbers
- `src/pages/Checkout.tsx:308` -- logs payment confirmation errors

**Fix**: Add `no-console` rule allowing only `console.warn` and `console.error` in development, and consider a structured logger for production:

```js
// Add to eslint.config.js rules:
rules: {
  'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
}
```

**Effort**: Moderate -- rule addition is quick, but cleaning up 186 occurrences requires review of which should become proper error handling vs. removal.

---

### Finding: Missing `@typescript-eslint/no-explicit-any` Enforcement

**Severity**: High
**Issue**: While `typescript-eslint/recommended` is enabled (which includes a default `warn` for `no-explicit-any`), the codebase has **21 explicit `: any` annotations** and **16 `as any` casts** across 16 files. These are either being ignored or the rule is not erroring. The rule should be escalated to `error` level.

**Fix**:

```js
rules: {
  '@typescript-eslint/no-explicit-any': 'error',
}
```

**Effort**: Moderate -- requires fixing 37 total `any` usages across 16 files.

---

### Finding: No Accessibility Linting (`eslint-plugin-jsx-a11y`)

**Severity**: Medium
**Issue**: No accessibility plugin is installed or configured. The customer-facing app serves public users and should meet WCAG standards. Without this plugin, missing `alt` attributes, improper ARIA roles, and non-interactive element click handlers go undetected.

**Fix**:

```bash
npm install -D eslint-plugin-jsx-a11y
```

```js
// eslint.config.js
import jsxA11y from 'eslint-plugin-jsx-a11y'

// Add to extends array:
jsxA11y.configs['recommended'],
```

**Effort**: Quick fix for installation; moderate effort to resolve violations discovered afterward.

---

### Finding: No Import Sorting or Organization Plugin

**Severity**: Low
**Issue**: No import sorting plugin is configured. Import order varies across files (some put Firebase first, some put React first, some mix types with values). This affects readability and can lead to merge conflicts.

**Fix**:

```bash
npm install -D eslint-plugin-simple-import-sort
```

```js
// eslint.config.js
import simpleImportSort from 'eslint-plugin-simple-import-sort'

// Add plugin and rules:
plugins: {
  'simple-import-sort': simpleImportSort,
},
rules: {
  'simple-import-sort/imports': 'error',
  'simple-import-sort/exports': 'error',
}
```

**Effort**: Quick fix -- auto-fixable with `eslint --fix`.

---

### Recommended Complete ESLint Config Addition

```js
// eslint.config.js -- additional rules block to add inside defineConfig
{
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
  },
}
```

---

## Section 2: Type Safety Analysis

### Current TypeScript Configuration

**File**: `tsconfig.app.json`

| Setting                        | Value    | Assessment                 |
| ------------------------------ | -------- | -------------------------- |
| `strict`                       | `true`   | Good                       |
| `target`                       | `ES2022` | Good                       |
| `noUnusedLocals`               | `false`  | Should be `true`           |
| `noUnusedParameters`           | `false`  | Should be `true`           |
| `noFallthroughCasesInSwitch`   | `true`   | Good                       |
| `noUncheckedSideEffectImports` | `true`   | Good                       |
| `skipLibCheck`                 | `true`   | Acceptable for build speed |

---

### Finding: `noUnusedLocals` and `noUnusedParameters` Disabled

**Severity**: Medium
**Files**: `tsconfig.app.json:20-21`
**Issue**: Both `noUnusedLocals` and `noUnusedParameters` are set to `false`. Dead code and unused parameters accumulate silently, leading to confusion and larger bundles.

**Fix**:

```json
{
  "noUnusedLocals": true,
  "noUnusedParameters": true
}
```

**Effort**: Moderate -- enabling these will surface compile errors that need cleanup. Prefix intentionally unused parameters with `_`.

---

### Finding: Explicit `any` Types (`: any`)

**Severity**: High
**Files**: 12 files, **21 occurrences**

| File                                  | Line(s)                      | Usage                                                                             |
| ------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| `src/contexts/AuthContext.tsx`        | 290, 351, 397, 415, 441, 520 | `catch (err: any)` in all auth methods                                            |
| `src/services/walletService.ts`       | 9                            | `timestamp: any` in Transaction interface                                         |
| `src/services/razorpayService.ts`     | 8, 103                       | `Razorpay: any` window declaration, `response: any`                               |
| `src/services/bookingService.ts`      | 179, 877                     | `interaktResponse?: any`, `previousDetails: any, newDetails: any, adminUser: any` |
| `src/services/helicopterEarlyBird.ts` | 78, 180                      | `item: any` in forEach loops                                                      |
| `src/services/couponService.ts`       | 133                          | `docs: any[], preloadedUserData?: any`                                            |
| `src/components/BottomNav.tsx`        | 17                           | `icon: any` in NavItem interface                                                  |
| `src/pages/HelicopterBookings.tsx`    | 33                           | `icon: any`                                                                       |
| `src/pages/CheckInPage.tsx`           | 145                          | `const mockBooking: any`                                                          |
| `src/pages/Wallet.tsx`                | 113                          | `catch (error: any)`                                                              |
| `src/pages/Activities.tsx`            | 91                           | `catch (err: any)`                                                                |
| `src/lib/checkInConfig.ts`            | 110, 159                     | `i: any`, `p: any` in forEach callbacks                                           |

**Fix**: Replace each `any` with proper types:

- `catch (err: any)` --> `catch (err: unknown)` with type guards
- `timestamp: any` --> `timestamp: Timestamp | Date`
- `Razorpay: any` --> declare a proper `RazorpayOptions` interface
- `icon: any` --> `icon: React.ComponentType<{ className?: string }>`
- `item: any` --> define the actual item shape from the data structure

**Effort**: Moderate -- each requires understanding the actual data shape.

---

### Finding: `as any` Type Assertions

**Severity**: High
**Files**: 8 files, **16 occurrences**

| File                                     | Line(s)          | Usage                                                                     |
| ---------------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| `src/components/ActivityBottomSheet.tsx` | 96-97, 407-408   | `(window as any).dataLayer` (GTM)                                         |
| `src/components/GTMTracker.tsx`          | 9-10             | `(window as any).dataLayer`                                               |
| `src/pages/Checkout.tsx`                 | 127-128, 398-399 | `(window as any).dataLayer`                                               |
| `src/pages/CheckInPage.tsx`              | 44               | `(sd as any).toDate()`                                                    |
| `src/services/activityService.ts`        | 318              | `id: activityId as any`                                                   |
| `src/services/couponService.ts`          | 213              | `doc.data() as any`                                                       |
| `src/services/bookingService.ts`         | 379, 745         | `(item.activity as any).game_name`, `{ checkInStatus: 'pending' } as any` |
| `src/contexts/AuthContext.tsx`           | 130              | `as any` for tier casting                                                 |

**Fix for GTM `window.dataLayer`**: Add a global type declaration:

```ts
// src/types/gtm.d.ts
interface Window {
  dataLayer?: Array<Record<string, unknown>>
}
```

This eliminates 8 of the 16 `as any` usages.

**Effort**: Quick fix for GTM (single type declaration file). Moderate for remaining 8.

---

### Finding: Untyped Firestore `.data()` Calls

**Severity**: Medium
**Files**: Multiple across services and API layers

Firestore `doc.data()` returns `DocumentData | undefined` which is effectively untyped. Many calls lack type assertions:

| File                              | Line          | Issue                                            |
| --------------------------------- | ------------- | ------------------------------------------------ |
| `src/services/walletService.ts`   | 21, 61        | `walletDoc.data().balance` -- no type guard      |
| `src/services/walletService.ts`   | 153, 174      | `...doc.data()` spread with no type              |
| `src/contexts/GamesContext.tsx`   | 228           | `snapshot.data()` -- untyped                     |
| `src/contexts/AuthContext.tsx`    | 121, 184, 203 | `userSnap.data()` / `snapshot.data()` -- untyped |
| `src/services/activityService.ts` | 220           | `doc.data()` with ternary, no type               |
| `src/services/couponService.ts`   | 213           | Explicitly cast to `any` instead of proper type  |

Some files do it correctly, for example:

- `src/lib/unified-booking.ts:91` -- `snap.data() as Record<string, unknown>` (proper)
- `src/services/waitingListService.ts:222` -- `d.data() as RawBookingDoc` (proper)

**Fix**: Create typed converter helpers or use Firestore `withConverter()`:

```ts
const walletConverter: FirestoreDataConverter<WalletData> = {
  toFirestore: (data) => data,
  fromFirestore: (snap) => snap.data() as WalletData,
}
```

**Effort**: Significant -- requires defining types for every Firestore document shape.

---

### Finding: `Record<string, any>` in Error Hierarchy

**Severity**: Low
**Files**: `src/types/errors.ts:6, 15, 21, 27, 33`
**Issue**: The `details` parameter on all error classes uses `Record<string, any>`. Per the CLAUDE.md convention, `any` should be avoided.

**Fix**: Change to `Record<string, unknown>`.

**Effort**: Quick fix.

---

## Section 3: Code Smells

### Finding: Duplicate Coupon Discount Logic in CartContext

**Severity**: High
**File**: `src/contexts/CartContext.tsx:150-228`
**Issue**: The coupon discount calculation logic is duplicated between the `discountedTotalResult` memo (lines 150-193) and the `getDiscountedTotal` callback (lines 195-229). The code itself has a comment acknowledging this on line 199:

```
// ... (duplicate logic or extract to helper? For now, simplistic duplication for the preview case which is rare)
```

Both blocks contain identical logic for:

- Wallet payment check
- Coupon lookup and minimum amount check
- Ticket count validation for ASG1000/ASG600
- Cashback vs discount branching
- Per-ticket discount calculation

**Fix**: Extract to a pure helper function:

```ts
function calculateDiscount(
  total: number,
  couponCode: string | null,
  coupons: Coupon[],
  items: CartItem[],
  isUsingWallet: boolean,
): { total: number; discount: number; cashback: number; code: string | null } {
  // ... single implementation
}
```

Then both `discountedTotalResult` and `getDiscountedTotal` call this helper.

**Effort**: Quick fix -- straightforward extraction.

---

### Finding: Hardcoded Cloud Function URLs

**Severity**: High
**Files**:

- `src/services/bookingService.ts:9-11, 839, 859`
- `src/pipeline/api/asquare-bookings.ts:21-30`
- `src/services/apiProxy.ts:10`
- `src/pipeline/api/leads-firestore.ts:617`

**Issue**: Cloud Function URLs are hardcoded as string constants. The same base URL `https://asia-south1-a-square-6720c.cloudfunctions.net/` appears in **at least 13 places** across both apps. Both the customer app and pipeline app duplicate these URLs independently.

Hardcoded URLs in `src/services/bookingService.ts`:

```
const INTERAKT_CONFIRM_FUNCTION_URL = 'https://asia-south1-a-square-6720c.cloudfunctions.net/sendBookingConfirmationForUserBooking'
const INTERAKT_PAYMENT_LINK_FUNCTION_URL = 'https://asia-south1-a-square-6720c.cloudfunctions.net/sendRazorpayPaymentLink'
const CREATE_ONLINE_ORDER_URL = 'https://asia-south1-a-square-6720c.cloudfunctions.net/createOnlineOrder'
```

And again separately in `src/pipeline/api/asquare-bookings.ts`:

```
const INTERAKT_CONFIRM_FUNCTION_URL = "https://asia-south1-a-square-6720c.cloudfunctions.net/sendBookingConfirmationForUserBooking";
const INTERAKT_PAYMENT_LINK_FUNCTION_URL = "https://asia-south1-a-square-6720c.cloudfunctions.net/sendRazorpayPaymentLink";
```

Plus additional inline URLs on `bookingService.ts` lines 839 and 859 (reschedule and payment-failed notifications).

**Fix**: Define a single environment variable and shared constant:

```ts
// .env
VITE_CLOUD_FUNCTIONS_BASE_URL=https://asia-south1-a-square-6720c.cloudfunctions.net

// src/lib/config.ts (shared)
export const CLOUD_FUNCTIONS_BASE = import.meta.env.VITE_CLOUD_FUNCTIONS_BASE_URL
  || 'https://asia-south1-a-square-6720c.cloudfunctions.net';

export const CLOUD_FUNCTIONS = {
  sendBookingConfirmation: `${CLOUD_FUNCTIONS_BASE}/sendBookingConfirmationForUserBooking`,
  sendPaymentLink: `${CLOUD_FUNCTIONS_BASE}/sendRazorpayPaymentLink`,
  createOnlineOrder: `${CLOUD_FUNCTIONS_BASE}/createOnlineOrder`,
  sendRescheduleNotification: `${CLOUD_FUNCTIONS_BASE}/sendRescheduleNotification`,
  sendPaymentFailedNotification: `${CLOUD_FUNCTIONS_BASE}/sendPaymentFailedNotification`,
  deleteBooking: `${CLOUD_FUNCTIONS_BASE}/deleteBooking`,
  sendLeadFollowUp: `${CLOUD_FUNCTIONS_BASE}/sendLeadFollowUpWhatsApp`,
} as const;
```

**Effort**: Moderate -- requires updating all call sites in both apps.

---

### Finding: Hardcoded Image URLs in activityService

**Severity**: Medium
**File**: `src/services/activityService.ts:17, 128, 325, 358`
**Issue**: Multiple hardcoded image URLs to `https://asquaregokarting.com/admin_secure/images/games/`:

```ts
const GAME_IMAGE_BASE = 'https://asquaregokarting.com/admin_secure/images/games'
// ...
return `https://asquaregokarting.com/${cleanPath}`
// ...
image: '...https://asquaregokarting.com/admin_secure/images/games/gokarting%201x1.jpg'
```

**Fix**: Use an environment variable `VITE_IMAGE_CDN_BASE_URL` or at minimum centralize to a single constant.

**Effort**: Quick fix.

---

### Finding: No `ErrorBoundary` Components

**Severity**: High
**Files**: Entire `src/` directory
**Issue**: A search for `ErrorBoundary` across all source files returned **zero results**. The application has no error boundary components. Any uncaught rendering error in a component will crash the entire React tree.

This is especially critical given that the app makes many async Firestore calls that could fail, and the payment flow in `Checkout.tsx` has complex state management.

**Fix**: Add at minimum a top-level error boundary, and ideally route-level boundaries:

```tsx
// src/components/ErrorBoundary.tsx
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}
interface State {
  hasError: boolean
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to error reporting service
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div>Something went wrong. Please refresh.</div>
    }
    return this.props.children
  }
}
```

Wrap in `CustomerApp.tsx` and `PipelineApp.tsx`.

**Effort**: Quick fix for a basic boundary; moderate for comprehensive per-route boundaries.

---

### Finding: `console.log` Leaking User Phone Numbers

**Severity**: Critical
**File**: `src/contexts/AuthContext.tsx:347, 350`
**Issue**: Auth flow logs user phone numbers to the browser console:

```ts
console.log('Calling signInWithPhoneNumber...', phoneNumber)
// ...
console.log('OTP sent successfully to', phoneNumber)
```

This is a PII leak in production. Anyone opening browser dev tools can see phone numbers.

**Fix**: Remove these lines entirely or gate behind `import.meta.env.DEV`.

**Effort**: Quick fix.

---

### Finding: Inline Styles Despite Tailwind Convention

**Severity**: Low
**Files**: 19 files, **48 occurrences** of `style={`
**Issue**: The CLAUDE.md states "Tailwind utility classes only. No inline styles." However, 48 inline style usages exist, with the highest concentrations in:

- `src/components/BoardingPass.tsx` (7)
- `src/pages/LinksPage.tsx` (7)
- `src/pipeline/pages/LoginPage.tsx` (6)
- `src/pages/HelicopterBookings.tsx` (4)

Some are justified (dynamic values like print layouts in BoardingPass), but others (like hover effects in LinksPage using `onMouseIn`/`onMouseOut` style manipulation) should use Tailwind's `hover:` utilities.

**Fix**: Audit each usage; replace static inline styles with Tailwind classes. For dynamic values, use Tailwind's arbitrary value syntax (e.g., `bg-[#color]`).

**Effort**: Moderate.

---

## Section 4: Security Concerns

### Finding: Hardcoded API Password in Source Code

**Severity**: Critical
**File**: `src/pipeline/api/asquare-customer-lookup.ts:9`
**Issue**: A plaintext password is hardcoded as a fallback default:

```ts
const SEARCH_API_PASSWORD =
  (import.meta.env.VITE_ASQUARE_CUSTOMER_LOOKUP_PASSWORD as string | undefined)?.trim() ||
  'Asquare@012026'
```

Even though an env var override exists, the fallback means the password is embedded in every production JavaScript bundle. Anyone can view it via browser dev tools or by downloading the built JS files.

Similarly on line 7:

```ts
const SEARCH_API_KEY =
  (import.meta.env.VITE_ASQUARE_CUSTOMER_LOOKUP_KEY as string | undefined)?.trim() || 'asquare_key'
```

**Fix**: Remove hardcoded fallbacks. Require the env vars and fail gracefully if missing:

```ts
const SEARCH_API_KEY = (
  import.meta.env.VITE_ASQUARE_CUSTOMER_LOOKUP_KEY as string | undefined
)?.trim()
const SEARCH_API_PASSWORD = (
  import.meta.env.VITE_ASQUARE_CUSTOMER_LOOKUP_PASSWORD as string | undefined
)?.trim()

if (!SEARCH_API_KEY || !SEARCH_API_PASSWORD) {
  console.error('Customer lookup API credentials not configured')
}
```

**Effort**: Quick fix.

---

### Finding: Hardcoded Firebase Credentials in Pipeline Firebase Config

**Severity**: High
**File**: `src/pipeline/lib/firebase.ts:8-12`
**Issue**: Firebase API key, app ID, project ID, and messaging sender ID are hardcoded as default constants:

```ts
const DEFAULT_PROJECT_ID = 'a-square-6720c'
const DEFAULT_MESSAGING_SENDER_ID = '1042048485512'
const DEFAULT_FIRESTORE_DATABASE_ID = 'asquare-app-db'
const DEFAULT_API_KEY = 'AIzaSyD2oTrz2cxLn9w3TEhj1GKkzz0WSShVjCo'
const DEFAULT_APP_ID = '1:1042048485512:web:9a6d606470c29729aef73d'
```

While Firebase API keys are technically not secret (they are restricted by Firebase Security Rules and App Check), embedding them as hardcoded defaults in source code means they are version-controlled and cannot be rotated without a code change. They should only come from environment variables.

**Fix**: Remove `DEFAULT_API_KEY` and `DEFAULT_APP_ID` fallbacks. Require env vars. Keep project ID as a non-secret default if needed for local dev.

**Effort**: Quick fix.

---

### Finding: `serviceAccountKey.json` Not in `.gitignore`

**Severity**: Critical
**File**: `.gitignore`
**Issue**: The `.gitignore` file does **not** include `serviceAccountKey.json`. Migration scripts (`scripts/migrate-members-to-users.ts`, `scripts/verify-migration.ts`, `scripts/migrate-pipeline-to-asquare.ts`) reference `serviceAccountKey.json` as an expected file at the project root or `scripts/` directory.

If a developer accidentally places this file in the repo, it would be committed, exposing full admin access to the Firebase project.

Current `.gitignore` sensitive entries:

```
.env
.env.local
.env.*.local
functions/key_id.txt
functions/key_secret.txt
```

Missing entries:

```
serviceAccountKey.json
**/serviceAccountKey.json
*.pem
*.key
```

**Fix**: Add to `.gitignore`:

```
# Service account keys (NEVER commit)
serviceAccountKey.json
**/serviceAccountKey.json
*.pem
*.key
```

**Effort**: Quick fix.

---

### Finding: `dangerouslySetInnerHTML` XSS Risk

**Severity**: Medium
**File**: `src/pages/LinksPage.tsx:98`
**Issue**: Uses `dangerouslySetInnerHTML` to render icon HTML:

```tsx
<span
  style={{ color: link.color, flexShrink: 0 }}
  dangerouslySetInnerHTML={{ __html: link.icon }}
/>
```

If the `link.icon` data comes from a database or external source, this is an XSS vector. Even if the data is currently hardcoded, this pattern should be avoided.

**Fix**: Use Lucide React icons (per project convention) or a sanitization library like `DOMPurify`. If icons must be SVG strings, sanitize first:

```ts
import DOMPurify from 'dompurify';
dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(link.icon) }}
```

**Effort**: Quick fix.

---

### Finding: Guest Login Creates Predictable User IDs

**Severity**: Medium
**File**: `src/contexts/AuthContext.tsx:410-434`
**Issue**: The `loginAsGuest` function creates a fallback user with a predictable ID pattern:

```ts
const minimalUser: User = {
  id: 'guest-' + Date.now(),
  displayName: 'Guest User',
  // ...
}
```

`Date.now()` is predictable and sequential. This could allow enumeration of guest users. Additionally, the guest user is set in local state without Firebase Auth, so there is no server-side verification.

**Fix**: Use `crypto.randomUUID()` for guest IDs. Consider whether guest users truly need local-only state or should go through Firebase anonymous auth.

**Effort**: Quick fix for ID generation; moderate if switching to Firebase anonymous auth.

---

### Finding: `.env` File Exists in Working Directory

**Severity**: Medium
**Files**: `.env`, `functions/.env`
**Issue**: Both `.env` and `functions/.env` exist in the working directory. While `.env` is in `.gitignore`, the `functions/.env` entry is not explicitly gitignored (only `functions/key_id.txt` and `functions/key_secret.txt` are). Verify `functions/.env` is not tracked.

The `.env.example` is present and properly templated with placeholder values -- good.

**Fix**: Add `functions/.env` to `.gitignore` if not already covered by the `.env` pattern (git may or may not match it depending on directory context).

**Effort**: Quick fix.

---

## Section 5: Performance Concerns

### Finding: Unbounded Firestore Queries (Missing `limit()`)

**Severity**: Critical
**Files**: Multiple -- see table below
**Issue**: Many Firestore queries fetch entire collections without `limit()`. The `getDocs(collection(...))` pattern returns ALL documents, which becomes catastrophic as data grows.

**Queries without `limit()` that read full collections:**

| File                                                  | Line               | Collection                       | Risk                                      |
| ----------------------------------------------------- | ------------------ | -------------------------------- | ----------------------------------------- |
| `src/pages/PlayAndWin.tsx`                            | 325                | `users`                          | Fetches ALL users for leaderboard         |
| `src/services/activityService.ts`                     | 218, 535           | `activities`                     | Fetches ALL activities (2 locations)      |
| `src/services/couponService.ts`                       | 113, 193           | `users/{uid}/coupons`            | Fetches all user coupons                  |
| `src/lib/locations.ts`                                | 180                | `locations`                      | Fetches all locations (small, acceptable) |
| `src/pipeline/api/asquare-customers.ts`               | 61                 | `bookings`                       | Fetches ALL bookings for aggregation      |
| `src/pipeline/api/asquare-customers.ts`               | 125                | `users`                          | Fetches ALL users                         |
| `src/pipeline/api/asquare-customers.ts`               | 167                | `adminUsers`                     | Fetches all admin users (small)           |
| `src/pipeline/api/asquare-bookings.ts`                | 339                | `activities`                     | Fetches ALL activities                    |
| `src/pipeline/api/accounting-firestore.ts`            | 994, 1004          | `vendorDetails`, vendor invoices | Fetches all vendor data                   |
| `src/pipeline/api/activities-firestore.ts`            | 377, 414, 593, 609 | Various activity collections     | Multiple full reads                       |
| `src/pipeline/api/track-marshall-shifts-firestore.ts` | 55                 | Shift records                    | All shifts, sorted only                   |
| `src/pipeline/api/shift-workforce-firestore.ts`       | 145, 270, 345      | Workforce records                | All shifts                                |
| `src/pipeline/features/combos/combo-firestore.ts`     | 43, 55             | `combos`                         | All combos (2 calls)                      |
| `src/pipeline/api/vendor-details-firestore.ts`        | 207                | `vendorDetails`                  | All vendor details                        |

**Most critical**: `src/pipeline/api/asquare-customers.ts:61` fetches the ENTIRE `bookings` collection just to aggregate stats. As bookings grow (hundreds/thousands), this will cause timeouts and excessive reads billing.

**Fix**: Implement server-side aggregation via Cloud Functions or Firestore aggregation queries. For client-side lists, always paginate with `limit()` and `startAfter()`:

```ts
const q = query(collection(firestore, 'bookings'), orderBy('createdAt', 'desc'), limit(50))
```

For `PlayAndWin.tsx` leaderboard, maintain a pre-aggregated leaderboard collection updated by Cloud Functions.

**Effort**: Significant -- requires architectural changes for aggregation and pagination across multiple modules.

---

### Finding: N+1 Query Pattern in Activities

**Severity**: Medium
**File**: `src/pipeline/api/activities-firestore.ts:593-609`
**Issue**: The legacy activity import reads all activities, then for each activity document reads a `games` subcollection:

```ts
const legacyActivities = await getDocs(collection(firestore, LEGACY_ACTIVITIES_COLLECTION))
// Then for EACH:
const nestedGames = await getDocs(
  collection(firestore, LEGACY_ACTIVITIES_COLLECTION, legacyDoc.id, 'games'),
)
```

This is an N+1 query -- if there are 20 activities, this makes 21 Firestore reads.

**Fix**: Use `Promise.all()` to parallelize subcollection reads, or restructure data to avoid subcollection reads:

```ts
const nestedResults = await Promise.all(
  legacyActivities.docs.map((doc) =>
    getDocs(collection(firestore, LEGACY_ACTIVITIES_COLLECTION, doc.id, 'games')).catch(() => null),
  ),
)
```

(Note: this already partially uses `.catch(() => null)` on line 595, but the reads are still sequential if not wrapped in `Promise.all`.)

**Effort**: Quick fix if parallelized; significant if restructuring data.

---

### Finding: Full Users Collection Fetched for Leaderboard

**Severity**: Critical
**File**: `src/pages/PlayAndWin.tsx:325`
**Issue**: The leaderboard loads by fetching the ENTIRE `users` collection client-side:

```ts
const usersSnap = await getDocs(collection(db, 'users'))
```

Then iterates every user to compute scores. This is extremely inefficient and will not scale past a few hundred users. It also exposes all user data to the client.

**Fix**: Create a Cloud Function that maintains a `leaderboard` collection with pre-computed scores, or use Firestore aggregation queries with proper ordering and `limit()`.

**Effort**: Significant.

---

### Finding: Lazy Loading Properly Implemented

**Severity**: N/A (Positive finding)
**Files**: `src/CustomerApp.tsx:11-34`, `src/pipeline/app/router.tsx:10-35`
**Issue**: Both the Customer App and Pipeline Admin properly use `React.lazy()` for all page components. This is correctly implemented with `Suspense` fallbacks.

Customer App: 24 lazy-loaded routes.
Pipeline Admin: 26+ lazy-loaded routes.

Some sub-modules also lazy-load their child views (e.g., `ActivitiesModule.tsx`, `TrackModule.tsx`).

No action needed.

---

### Finding: Missing `Suspense` Boundaries for Nested Lazy Components

**Severity**: Low
**Files**: `src/pipeline/pages/modules/ActivitiesModule.tsx:6-8`, `src/pipeline/pages/modules/TrackModule.tsx:13`
**Issue**: Sub-modules lazy-load child components. While the top-level router wraps in `Suspense`, deeply nested lazy components may benefit from their own `Suspense` boundaries for better UX (showing a local spinner instead of replacing the entire page).

**Fix**: Add `<Suspense fallback={<Spinner />}>` wrapping the lazy components within each module.

**Effort**: Quick fix.

---

### Finding: Entire `bookings` + `users` Fetched for Customer List

**Severity**: High
**File**: `src/pipeline/api/asquare-customers.ts:121-139`
**Issue**: The `listCustomers()` function runs two unbounded queries in parallel:

```ts
const [usersSnapshot, bookingStats] = await Promise.all([
  getDocs(collection(firestore, 'users')), // ALL users
  aggregateBookings(), // ALL bookings
])
```

The `aggregateBookings()` function (line 61) reads every single booking document. For a business with 4 branches and growing bookings, this will quickly become unacceptable.

**Fix**: Move aggregation to a Cloud Function that runs on a schedule or on booking creation. Store aggregated stats on the user document itself.

**Effort**: Significant.

---

## Section 6: Actionable Recommendations Summary

### Priority Matrix

| #   | Finding                                                | Severity     | Effort      | Fix                                           |
| --- | ------------------------------------------------------ | ------------ | ----------- | --------------------------------------------- |
| 1   | Hardcoded API password in `asquare-customer-lookup.ts` | **Critical** | Quick       | Remove fallback defaults, require env vars    |
| 2   | `serviceAccountKey.json` not in `.gitignore`           | **Critical** | Quick       | Add to `.gitignore`                           |
| 3   | Console.log leaks phone numbers in `AuthContext.tsx`   | **Critical** | Quick       | Remove or gate behind `DEV`                   |
| 4   | Unbounded `users` collection fetch in `PlayAndWin.tsx` | **Critical** | Significant | Pre-aggregated leaderboard via Cloud Function |
| 5   | Unbounded `bookings` fetch in `asquare-customers.ts`   | **Critical** | Significant | Server-side aggregation, pagination           |
| 6   | No `ErrorBoundary` in either app                       | **High**     | Quick       | Add top-level error boundaries                |
| 7   | 186 `console.*` statements with no lint rule           | **High**     | Moderate    | Add `no-console` rule, clean up               |
| 8   | 37 explicit `any` types                                | **High**     | Moderate    | Replace with proper types                     |
| 9   | 13+ hardcoded Cloud Function URLs                      | **High**     | Moderate    | Centralize to shared config with env var base |
| 10  | Duplicate coupon logic in `CartContext.tsx`            | **High**     | Quick       | Extract helper function                       |
| 11  | Hardcoded Firebase credentials in pipeline firebase.ts | **High**     | Quick       | Remove defaults, use env vars only            |
| 12  | `noUnusedLocals`/`noUnusedParameters` disabled         | **Medium**   | Moderate    | Enable in tsconfig, fix violations            |
| 13  | Untyped Firestore `.data()` calls                      | **Medium**   | Significant | Add typed converters                          |
| 14  | `dangerouslySetInnerHTML` in LinksPage                 | **Medium**   | Quick       | Sanitize or use React icons                   |
| 15  | Guest login with predictable IDs                       | **Medium**   | Quick       | Use `crypto.randomUUID()`                     |
| 16  | No accessibility linting plugin                        | **Medium**   | Moderate    | Install `eslint-plugin-jsx-a11y`              |
| 17  | N+1 queries in activities-firestore.ts                 | **Medium**   | Quick       | Parallelize with `Promise.all`                |
| 18  | 48 inline styles despite Tailwind convention           | **Low**      | Moderate    | Audit and replace with Tailwind classes       |
| 19  | No import sorting plugin                               | **Low**      | Quick       | Install `eslint-plugin-simple-import-sort`    |
| 20  | `Record<string, any>` in error types                   | **Low**      | Quick       | Change to `Record<string, unknown>`           |

### Recommended Action Plan

**Phase 1 -- Immediate (Critical Security):**

1. Remove hardcoded password from `asquare-customer-lookup.ts`
2. Add `serviceAccountKey.json` to `.gitignore`
3. Remove phone number logging from `AuthContext.tsx`
4. Remove hardcoded Firebase credentials fallbacks from `pipeline/lib/firebase.ts`

**Phase 2 -- This Sprint (High Impact, Quick Fixes):** 5. Add `ErrorBoundary` components 6. Add `no-console` ESLint rule 7. Extract duplicate coupon logic in `CartContext.tsx` 8. Centralize Cloud Function URLs

**Phase 3 -- Next Sprint (Moderate Effort):** 9. Fix all `any` types (37 occurrences) 10. Enable `noUnusedLocals` and `noUnusedParameters` 11. Install accessibility and import sorting ESLint plugins 12. Add GTM window type declaration (eliminates 8 `as any`)

**Phase 4 -- Backlog (Significant Effort):** 13. Implement server-side aggregation for customer stats and leaderboard 14. Add pagination to all unbounded Firestore queries 15. Add Firestore typed converters for all collections 16. Audit and fix inline styles

---

_Generated by automated analysis on 2026-03-31. All findings reference actual code at the time of analysis._
