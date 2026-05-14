# Customer 360 — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of Customer 360 — advanced search/sort/filter on the Customers list and a full-page detail view with 7 lazy-loaded tabs (Overview, Bookings, Games, Wallet, Tires, Coupons, Referrals).

**Architecture:** Pipeline-app-only. Firestore-backed (no paid search). Per-customer subcollections + denormalized bucket fields on `users/{uid}` powered by a Cloud Function trigger. Detail page is a route at `/admin/customers/:customerId` with URL-driven tabs that lazy-load via React Query.

**Tech Stack:** React 18 + TypeScript + Vite + TanStack Query v5 + Firebase 12 (Firestore + Cloud Functions Node 20) + Vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-04-16-customer-360-design.md`

---

## File map

**Create:**

- `src/pipeline/api/customer-detail/customer-bookings.ts`
- `src/pipeline/api/customer-detail/customer-wallet.ts`
- `src/pipeline/api/customer-detail/customer-tires.ts`
- `src/pipeline/api/customer-detail/customer-coupons.ts`
- `src/pipeline/api/customer-detail/customer-referrals.ts`
- `src/pipeline/api/customer-detail/customer-detail-types.ts`
- `src/pipeline/api/customer-buckets.ts` (pure bucket logic + tests)
- `src/pipeline/pages/modules/customer-detail/CustomerDetailPage.tsx`
- `src/pipeline/pages/modules/customer-detail/tabs/OverviewTab.tsx`
- `src/pipeline/pages/modules/customer-detail/tabs/BookingsTab.tsx`
- `src/pipeline/pages/modules/customer-detail/tabs/GamesTab.tsx`
- `src/pipeline/pages/modules/customer-detail/tabs/WalletTab.tsx`
- `src/pipeline/pages/modules/customer-detail/tabs/TiresTab.tsx`
- `src/pipeline/pages/modules/customer-detail/tabs/CouponsTab.tsx`
- `src/pipeline/pages/modules/customer-detail/tabs/ReferralsTab.tsx`
- `src/pipeline/pages/modules/customer-detail/CustomerActionDialogs.tsx` (lifted Edit/Delete from AdminModule)
- `functions/triggers/on-user-write-customer-buckets.js`
- `functions/triggers/on-user-create-referral-index.js`
- `scripts/backfill-customer-search-and-buckets.ts`
- `scripts/backfill-referral-forward-index.ts`
- Test files co-located with each new source file (`*.test.ts(x)`)
- `e2e/customer-360.spec.ts`

**Modify:**

- `src/pipeline/api/asquare-customers.ts` — extend `AsquareCustomer` type, extend `listCustomers` with new filters/sort/search, maintain `displayNameLower`/`emailLower` on `updateCustomer`.
- `src/pipeline/pages/modules/AdminModule.tsx` — wire new search/sort/filter UI; row click navigates to detail page; lift dialogs.
- `src/pipeline/app/router.tsx` — add `/admin/customers/:customerId` route.
- `src/services/userService.ts` — write `displayNameLower`/`emailLower` on `resolveOrCreateUserDoc`.
- `functions/triggers/on-booking-write-customer-stats.js` — also maintain `lastBookingAt` + `branchPreferred` on `users/{uid}`.
- `firestore.indexes.json` — add ~10 composite indexes.
- `vitest.config.ts` — add coverage thresholds for new modules.

---

## Section A: Backend infrastructure (Cloud Functions, indexes, backfills)

### Task A1: Pure bucket-computation utility (TDD)

**Files:**

- Create: `src/pipeline/api/customer-buckets.ts`
- Test: `src/pipeline/api/customer-buckets.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/pipeline/api/customer-buckets.test.ts
import { describe, it, expect } from 'vitest'
import {
  spendBucketFor,
  bookingBucketFor,
  computeCustomerBuckets,
  type CustomerBuckets,
} from './customer-buckets'

describe('spendBucketFor', () => {
  it.each([
    [0, '0'],
    [1, '1-5k'],
    [4999, '1-5k'],
    [5000, '5-25k'],
    [24999, '5-25k'],
    [25000, '25k+'],
    [1000000, '25k+'],
  ])('totalSpent=%d → %s', (input, expected) => {
    expect(spendBucketFor(input)).toBe(expected)
  })

  it('clamps negatives to 0 bucket', () => {
    expect(spendBucketFor(-100)).toBe('0')
  })
})

describe('bookingBucketFor', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [2, '2-5'],
    [5, '2-5'],
    [6, '6+'],
    [500, '6+'],
  ])('count=%d → %s', (input, expected) => {
    expect(bookingBucketFor(input)).toBe(expected)
  })
})

describe('computeCustomerBuckets', () => {
  it('derives all bucket fields from source values', () => {
    const result = computeCustomerBuckets({
      totalSpent: 7500,
      bookingCount: 3,
      walletBalance: 100,
      tires: 0,
      coupons150Available: 2,
    })
    const expected: CustomerBuckets = {
      spendBucket: '5-25k',
      bookingBucket: '2-5',
      hasWalletBalance: true,
      hasTires: false,
      hasUnredeemedCoupons150: true,
    }
    expect(result).toEqual(expected)
  })

  it('handles all-zero customer', () => {
    expect(
      computeCustomerBuckets({
        totalSpent: 0,
        bookingCount: 0,
        walletBalance: 0,
        tires: 0,
        coupons150Available: 0,
      }),
    ).toEqual({
      spendBucket: '0',
      bookingBucket: '0',
      hasWalletBalance: false,
      hasTires: false,
      hasUnredeemedCoupons150: false,
    })
  })
})
```

- [ ] **Step 2: Run tests — confirm fail**

Run: `npm run test:run -- customer-buckets`
Expected: FAIL "Cannot find module './customer-buckets'"

- [ ] **Step 3: Implement**

```ts
// src/pipeline/api/customer-buckets.ts
export type SpendBucket = '0' | '1-5k' | '5-25k' | '25k+'
export type BookingBucket = '0' | '1' | '2-5' | '6+'

export interface CustomerBuckets {
  spendBucket: SpendBucket
  bookingBucket: BookingBucket
  hasWalletBalance: boolean
  hasTires: boolean
  hasUnredeemedCoupons150: boolean
}

export interface BucketSourceFields {
  totalSpent: number
  bookingCount: number
  walletBalance: number
  tires: number
  coupons150Available: number
}

export const spendBucketFor = (totalSpent: number): SpendBucket => {
  const v = Math.max(0, totalSpent)
  if (v === 0) return '0'
  if (v < 5000) return '1-5k'
  if (v < 25000) return '5-25k'
  return '25k+'
}

export const bookingBucketFor = (count: number): BookingBucket => {
  const v = Math.max(0, count)
  if (v === 0) return '0'
  if (v === 1) return '1'
  if (v <= 5) return '2-5'
  return '6+'
}

export const computeCustomerBuckets = (s: BucketSourceFields): CustomerBuckets => ({
  spendBucket: spendBucketFor(s.totalSpent),
  bookingBucket: bookingBucketFor(s.bookingCount),
  hasWalletBalance: s.walletBalance > 0,
  hasTires: s.tires > 0,
  hasUnredeemedCoupons150: s.coupons150Available > 0,
})
```

- [ ] **Step 4: Run tests — confirm pass**

Run: `npm run test:run -- customer-buckets`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/api/customer-buckets.ts src/pipeline/api/customer-buckets.test.ts
git commit -m "feat(pipeline): add pure customer-bucket utilities"
```

---

### Task A2: Cloud Function — recompute buckets on user write

**Files:**

- Create: `functions/triggers/on-user-write-customer-buckets.js`
- Modify: `functions/index.js` (export the new trigger)
- Test: `functions/triggers/on-user-write-customer-buckets.test.js`

- [ ] **Step 1: Inspect functions structure**

Run: `ls functions/triggers/ && head -40 functions/index.js`
Expected: see existing triggers + their export pattern in `index.js`.

- [ ] **Step 2: Write the trigger**

```js
// functions/triggers/on-user-write-customer-buckets.js
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions/v2')

const spendBucketFor = (totalSpent) => {
  const v = Math.max(0, Number(totalSpent) || 0)
  if (v === 0) return '0'
  if (v < 5000) return '1-5k'
  if (v < 25000) return '5-25k'
  return '25k+'
}

const bookingBucketFor = (count) => {
  const v = Math.max(0, Number(count) || 0)
  if (v === 0) return '0'
  if (v === 1) return '1'
  if (v <= 5) return '2-5'
  return '6+'
}

const computeDerived = (data) => ({
  spendBucket: spendBucketFor(data?.stats?.totalSpent),
  bookingBucket: bookingBucketFor(data?.stats?.bookingCount),
  hasWalletBalance: Number(data?.walletBalance) > 0,
  hasTires: Number(data?.tires) > 0,
  hasUnredeemedCoupons150: Number(data?.coupons150Available) > 0,
  displayNameLower: String(data?.displayName ?? '').toLowerCase(),
  emailLower: String(data?.email ?? '').toLowerCase(),
})

const sourcesEqual = (a, b) =>
  a?.stats?.totalSpent === b?.stats?.totalSpent &&
  a?.stats?.bookingCount === b?.stats?.bookingCount &&
  a?.walletBalance === b?.walletBalance &&
  a?.tires === b?.tires &&
  a?.coupons150Available === b?.coupons150Available &&
  a?.displayName === b?.displayName &&
  a?.email === b?.email

exports.onUserWriteCustomerBuckets = onDocumentWritten(
  { document: 'users/{uid}', region: 'asia-south1' },
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()
    if (!after) return // user deleted
    if (before && sourcesEqual(before, after)) return // no source field changed

    const next = computeDerived(after)
    const allEqual = Object.entries(next).every(([k, v]) => after[k] === v)
    if (allEqual) return // already up-to-date — avoid trigger loop

    try {
      await event.data.after.ref.update(next)
      logger.debug('customer.derived.updated', { uid: event.params.uid, ...next })
    } catch (err) {
      logger.error('customer.derived.update_failed', err, { uid: event.params.uid })
      throw err
    }
  },
)

// exported for unit testing
exports._internals = { spendBucketFor, bookingBucketFor, computeDerived, sourcesEqual }
```

- [ ] **Step 3: Add a unit test**

```js
// functions/triggers/on-user-write-customer-buckets.test.js
const { _internals } = require('./on-user-write-customer-buckets')

describe('bucket trigger internals', () => {
  it('computes derived fields including lowercase indexes', () => {
    expect(
      _internals.computeDerived({
        displayName: 'Asha Sharma',
        email: 'Asha@Example.COM',
        stats: { totalSpent: 12000, bookingCount: 4 },
        walletBalance: 0,
        tires: 5,
        coupons150Available: 1,
      }),
    ).toEqual({
      spendBucket: '5-25k',
      bookingBucket: '2-5',
      hasWalletBalance: false,
      hasTires: true,
      hasUnredeemedCoupons150: true,
      displayNameLower: 'asha sharma',
      emailLower: 'asha@example.com',
    })
  })

  it('detects when source fields have not changed', () => {
    const a = {
      displayName: 'A',
      email: 'a@b',
      stats: { totalSpent: 100, bookingCount: 1 },
      walletBalance: 0,
      tires: 0,
      coupons150Available: 0,
    }
    expect(_internals.sourcesEqual(a, { ...a })).toBe(true)
    expect(_internals.sourcesEqual(a, { ...a, walletBalance: 50 })).toBe(false)
    expect(_internals.sourcesEqual(a, { ...a, displayName: 'B' })).toBe(false)
  })
})
```

- [ ] **Step 4: Wire into functions/index.js**

Add at the bottom of `functions/index.js`:

```js
const { onUserWriteCustomerBuckets } = require('./triggers/on-user-write-customer-buckets')
exports.onUserWriteCustomerBuckets = onUserWriteCustomerBuckets
```

- [ ] **Step 5: Run function tests**

Run: `cd functions && npm test -- on-user-write-customer-buckets`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add functions/triggers/on-user-write-customer-buckets.js \
  functions/triggers/on-user-write-customer-buckets.test.js \
  functions/index.js
git commit -m "feat(functions): trigger to maintain customer bucket fields"
```

---

### Task A3: Extend booking-stats trigger with `lastBookingAt` + `branchPreferred`

**Files:**

- Modify: `functions/triggers/on-booking-write-customer-stats.js`

- [ ] **Step 1: Read the existing trigger**

Run: `cat functions/triggers/on-booking-write-customer-stats.js`
Expected: existing trigger that updates `users/{uid}.stats.bookingCount` + `stats.totalSpent`.

- [ ] **Step 2: Extend it**

Modify the trigger so the same single transaction also writes `lastBookingAt` (max of `sessionDate` across all this user's bookings — easiest implementation: take the just-written booking's `sessionDate` if it's larger than the current `lastBookingAt` on the user doc) and `branchPreferred` (recomputed via a small in-trigger aggregation: read `users/{uid}/bookings` ordered by `locationId`, count by location, write the top one). Keep the function idempotent: skip writes when nothing changes.

```js
// inside the trigger, after stats are computed:
const sessionTs = data?.sessionDate ? new Date(data.sessionDate).getTime() : 0
const currentLastTs = userBefore?.lastBookingAt
  ? new Date(
      userBefore.lastBookingAt.toDate
        ? userBefore.lastBookingAt.toDate()
        : userBefore.lastBookingAt,
    ).getTime()
  : 0

const updates = { stats: nextStats }
if (sessionTs > currentLastTs) {
  updates.lastBookingAt = new Date(data.sessionDate)
}

// branchPreferred recompute — only when locationId changed for this booking
if (data?.locationId && data.locationId !== before?.locationId) {
  const all = await db
    .collection('users')
    .doc(uid)
    .collection('bookings')
    .select('locationId')
    .get()
  const counts = new Map()
  all.docs.forEach((d) => {
    const loc = d.get('locationId')
    if (!loc) return
    counts.set(loc, (counts.get(loc) ?? 0) + 1)
  })
  let top = null
  let topCount = 0
  for (const [loc, n] of counts) {
    if (n > topCount) {
      top = loc
      topCount = n
    }
  }
  if (top && top !== userBefore?.branchPreferred) {
    updates.branchPreferred = top
  }
}

await userRef.update(updates)
```

(Adapt variable names to the existing trigger — the snippet above shows the additions, not the full file.)

- [ ] **Step 3: Add or extend the trigger's test**

Cover three cases: new booking sets `lastBookingAt`; older booking doesn't override; first booking at a new location flips `branchPreferred`.

- [ ] **Step 4: Run function tests**

Run: `cd functions && npm test -- on-booking-write-customer-stats`
Expected: existing tests still pass + new ones pass.

- [ ] **Step 5: Commit**

```bash
git add functions/triggers/on-booking-write-customer-stats.js \
  functions/triggers/on-booking-write-customer-stats.test.js
git commit -m "feat(functions): maintain lastBookingAt and branchPreferred in stats trigger"
```

---

### Task A4: Cloud Function — forward referral index on user create

**Files:**

- Create: `functions/triggers/on-user-create-referral-index.js`
- Modify: `functions/index.js`

- [ ] **Step 1: Write the trigger**

```js
// functions/triggers/on-user-create-referral-index.js
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions/v2')
const { getFirestore } = require('firebase-admin/firestore')

exports.onUserCreateReferralIndex = onDocumentCreated(
  { document: 'users/{uid}', region: 'asia-south1' },
  async (event) => {
    const data = event.data?.data()
    const referrerUid = data?.referredBy
    if (!referrerUid) return

    const db = getFirestore()
    const referredUid = event.params.uid

    try {
      await db
        .collection('users')
        .doc(referrerUid)
        .collection('referredCustomers')
        .doc(referredUid)
        .set({
          referredUid,
          displayName: data?.displayName ?? '',
          phone: data?.phone ?? '',
          joinedAt: data?.createdAt ?? new Date(),
          totalSpent: 0,
        })
      logger.debug('referral.index.written', { referrerUid, referredUid })
    } catch (err) {
      logger.error('referral.index.failed', err, { referrerUid, referredUid })
      throw err
    }
  },
)
```

- [ ] **Step 2: Wire into functions/index.js**

```js
const { onUserCreateReferralIndex } = require('./triggers/on-user-create-referral-index')
exports.onUserCreateReferralIndex = onUserCreateReferralIndex
```

- [ ] **Step 3: Commit**

```bash
git add functions/triggers/on-user-create-referral-index.js functions/index.js
git commit -m "feat(functions): forward referral index on user create"
```

---

### Task A5: Backfill — lowercase fields + buckets + lastBookingAt + branchPreferred

**Files:**

- Create: `scripts/backfill-customer-search-and-buckets.ts`

- [ ] **Step 1: Write the script**

```ts
// scripts/backfill-customer-search-and-buckets.ts
/**
 * One-shot backfill for the Customer 360 list-page enhancements.
 * - displayNameLower, emailLower (for prefix search)
 * - spendBucket, bookingBucket, hasWalletBalance, hasTires, hasUnredeemedCoupons150
 * - lastBookingAt, branchPreferred
 *
 * Run with: npx tsx scripts/backfill-customer-search-and-buckets.ts
 */
import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'
import {
  computeCustomerBuckets,
  type BucketSourceFields,
} from '../src/pipeline/api/customer-buckets'

const serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH!, 'utf8'))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const PIPELINE_ROLES = new Set([
  'Owner',
  'Admin',
  'Telecaller',
  'Cashier',
  'TrackMarshall',
  'Editor',
  'Developer',
  'Backend',
  'ThirdParty',
])

async function backfillUser(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data()
  const role = String(data.role ?? '')
  if (role && PIPELINE_ROLES.has(role)) return

  const source: BucketSourceFields = {
    totalSpent: Number(data?.stats?.totalSpent ?? 0),
    bookingCount: Number(data?.stats?.bookingCount ?? 0),
    walletBalance: Number(data?.walletBalance ?? 0),
    tires: Number(data?.tires ?? 0),
    coupons150Available: Number(data?.coupons150Available ?? 0),
  }
  const buckets = computeCustomerBuckets(source)

  // lastBookingAt + branchPreferred from the user's bookings subcollection
  const bookings = await doc.ref.collection('bookings').select('sessionDate', 'locationId').get()
  let lastBookingAt: Date | null = null
  const locCounts = new Map<string, number>()
  for (const b of bookings.docs) {
    const sd = b.get('sessionDate')
    if (sd) {
      const ts = new Date(sd.toDate ? sd.toDate() : sd)
      if (!lastBookingAt || ts > lastBookingAt) lastBookingAt = ts
    }
    const loc = b.get('locationId')
    if (loc) locCounts.set(loc, (locCounts.get(loc) ?? 0) + 1)
  }
  let branchPreferred: string | null = null
  let topCount = 0
  for (const [loc, n] of locCounts) {
    if (n > topCount) {
      branchPreferred = loc
      topCount = n
    }
  }

  await doc.ref.update({
    displayNameLower: String(data.displayName ?? '').toLowerCase(),
    emailLower: String(data.email ?? '').toLowerCase(),
    ...buckets,
    ...(lastBookingAt ? { lastBookingAt } : {}),
    ...(branchPreferred ? { branchPreferred } : {}),
  })
}

async function main() {
  const PAGE = 500
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  let total = 0
  while (true) {
    let q = db.collection('users').orderBy('__name__').limit(PAGE)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break
    await Promise.all(snap.docs.map(backfillUser))
    total += snap.size
    console.log(`processed ${total}`)
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < PAGE) break
  }
  console.log(`done, ${total} users processed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Verify it builds**

Run: `npx tsc --noEmit scripts/backfill-customer-search-and-buckets.ts`
Expected: no errors.

- [ ] **Step 3: Commit (do not run yet — runs at deploy time)**

```bash
git add scripts/backfill-customer-search-and-buckets.ts
git commit -m "chore(scripts): backfill customer search/bucket fields"
```

---

### Task A6: Backfill — forward referral index

**Files:**

- Create: `scripts/backfill-referral-forward-index.ts`

- [ ] **Step 1: Write the script**

```ts
// scripts/backfill-referral-forward-index.ts
/**
 * One-shot backfill: walks all users and writes the forward referral index
 * at users/{referrerUid}/referredCustomers/{referredUid}.
 */
import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'

const serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH!, 'utf8'))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

async function main() {
  const PAGE = 500
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  let count = 0
  while (true) {
    let q = db.collection('users').orderBy('__name__').limit(PAGE)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break
    const writes: Promise<unknown>[] = []
    for (const doc of snap.docs) {
      const data = doc.data()
      const referrer = data.referredBy
      if (!referrer) continue
      writes.push(
        db
          .collection('users')
          .doc(referrer)
          .collection('referredCustomers')
          .doc(doc.id)
          .set({
            referredUid: doc.id,
            displayName: data.displayName ?? '',
            phone: data.phone ?? '',
            joinedAt: data.createdAt ?? new Date(),
            totalSpent: Number(data?.stats?.totalSpent ?? 0),
          }),
      )
    }
    await Promise.all(writes)
    count += writes.length
    console.log(`indexed ${count}`)
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < PAGE) break
  }
  console.log(`done, ${count} referral edges indexed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Build check + commit**

```bash
npx tsc --noEmit scripts/backfill-referral-forward-index.ts
git add scripts/backfill-referral-forward-index.ts
git commit -m "chore(scripts): backfill forward referral index"
```

---

### Task A7: Composite indexes

**Files:**

- Modify: `firestore.indexes.json`

- [ ] **Step 1: Read existing indexes**

Run: `cat firestore.indexes.json | head -80`
Expected: existing index entries, JSON shape.

- [ ] **Step 2: Append new indexes**

Add the following entries to the `indexes` array:

```json
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tier", "order": "ASCENDING" },
    { "fieldPath": "spendBucket", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "spendBucket", "order": "ASCENDING" },
    { "fieldPath": "lastLoginAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tier", "order": "ASCENDING" },
    { "fieldPath": "stats.totalSpent", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tier", "order": "ASCENDING" },
    { "fieldPath": "stats.bookingCount", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "branchPreferred", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "hasWalletBalance", "order": "ASCENDING" },
    { "fieldPath": "walletBalance", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "hasTires", "order": "ASCENDING" },
    { "fieldPath": "tires", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "hasUnredeemedCoupons150", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "displayNameLower", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "emailLower", "order": "ASCENDING" }
  ]
}
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add firestore.indexes.json
git commit -m "chore(firestore): composite indexes for customer 360 list filters"
```

---

## Section B: API extensions

### Task B1: Extend `AsquareCustomer` type with new fields

**Files:**

- Modify: `src/pipeline/api/asquare-customers.ts`
- Test: `src/pipeline/api/asquare-customers.test.ts`

- [ ] **Step 1: Add fields to interface and parser**

In `AsquareCustomer`:

```ts
export interface AsquareCustomer {
  // ...existing fields...
  displayNameLower: string
  emailLower: string
  spendBucket: '0' | '1-5k' | '5-25k' | '25k+'
  bookingBucket: '0' | '1' | '2-5' | '6+'
  hasWalletBalance: boolean
  hasTires: boolean
  hasUnredeemedCoupons150: boolean
  branchPreferred: string | null
  lastBookingAt: Date | null
}
```

Update `parseCustomer` to read these (with safe defaults for not-yet-backfilled docs):

```ts
displayNameLower: String(data.displayNameLower ?? data.displayName ?? '').toLowerCase(),
emailLower: String(data.emailLower ?? data.email ?? '').toLowerCase(),
spendBucket: (data.spendBucket as AsquareCustomer['spendBucket']) ?? '0',
bookingBucket: (data.bookingBucket as AsquareCustomer['bookingBucket']) ?? '0',
hasWalletBalance: data.hasWalletBalance === true,
hasTires: data.hasTires === true,
hasUnredeemedCoupons150: data.hasUnredeemedCoupons150 === true,
branchPreferred: data.branchPreferred ? String(data.branchPreferred) : null,
lastBookingAt: data.lastBookingAt ? toDate(data.lastBookingAt) : null,
```

- [ ] **Step 2: Maintain lowercase fields on update**

In `asquareCustomersApi.updateCustomer`, expand the merge payload:

```ts
const payload = { ...data, updatedAt: new Date() }
if (data.displayName !== undefined) payload.displayNameLower = data.displayName.toLowerCase()
if (data.email !== undefined) payload.emailLower = data.email.toLowerCase()
await setDoc(userRef, payload, { merge: true })
```

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/api/asquare-customers.ts
git commit -m "feat(pipeline): extend AsquareCustomer with search/bucket fields"
```

---

### Task B2: Extend `listCustomers` with new filters/sort/search (TDD)

**Files:**

- Modify: `src/pipeline/api/asquare-customers.ts`
- Test: `src/pipeline/api/asquare-customers.test.ts`

- [ ] **Step 1: Write tests first**

```ts
// src/pipeline/api/asquare-customers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { asquareCustomersApi } from './asquare-customers'

// Mock getAsquareFirestore so each test wires the query path it needs.
// Use the existing test setup pattern (see existing pipeline api tests).

describe('listCustomers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('phone search bypasses query and uses phoneToUid', async () => {
    // mock phoneToUid/{digits} → uid → users/{uid}
    // assert: no call to query(collection('users'), ...)
    // assert: result.items has the single matching customer
  })

  it('name search uses displayNameLower prefix range', async () => {
    // assert: query constraints contain where('displayNameLower', '>=', 'shar')
    //         and where('displayNameLower', '<=', 'shar\uf8ff')
    //         and orderBy('displayNameLower')
  })

  it('email search uses emailLower prefix range', async () => {
    // similar to name
  })

  it('combines equality filters with the active sort field', async () => {
    // input: { filters: { tier: 'gold', spendBucket: '5-25k' }, sortBy: 'totalSpent' }
    // assert: where(tier ==), where(spendBucket ==), orderBy('stats.totalSpent', 'desc')
  })

  it('uses one range filter and ignores conflicting date ranges', async () => {
    // input: { filters: { joinedAfter: D1, lastSeenAfter: D2 } }
    // assert: only joinedAfter is sent to Firestore (the joined range wins)
  })

  it('falls back to createdAt desc when no sort given', async () => {
    // assert: orderBy('createdAt', 'desc')
  })

  it('respects pageSize and emits nextCursor when full', async () => {
    // assert: when snapshot returns pageSize+CUSTOMER_STAFF_BUFFER, nextCursor is set
  })
})
```

(Use the existing pipeline API test files as a template for the Firestore mocking — `vi.mock('firebase/firestore', ...)` plus a hand-rolled snapshot factory.)

- [ ] **Step 2: Run tests — confirm fail (red)**

Run: `npm run test:run -- asquare-customers`
Expected: failures because the new options aren't handled.

- [ ] **Step 3: Implement the new signature**

```ts
export interface ListCustomersFilters {
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

export type ListCustomersSortBy =
  | 'createdAt'
  | 'lastLoginAt'
  | 'totalSpent'
  | 'bookingCount'
  | 'walletBalance'
  | 'tires'

export interface ListCustomersSearch {
  kind: 'phone' | 'name' | 'email'
  value: string
}

export interface ListCustomersOptions {
  pageSize?: number
  cursor?: QueryDocumentSnapshot<DocumentData>
  filters?: ListCustomersFilters
  sortBy?: ListCustomersSortBy
  sortDir?: 'asc' | 'desc'
  search?: ListCustomersSearch
}

const SORT_FIELD_MAP: Record<ListCustomersSortBy, string> = {
  createdAt: 'createdAt',
  lastLoginAt: 'lastLoginAt',
  totalSpent: 'stats.totalSpent',
  bookingCount: 'stats.bookingCount',
  walletBalance: 'walletBalance',
  tires: 'tires',
}

// Implementation: handle phone short-circuit first, then name/email prefix
// (which forces orderBy on the search field and ignores other sort), then
// the general filter+sort path. Honor the one-range-per-query constraint
// by picking the active range in this priority order:
// joinedAfter/Before > lastSeenAfter/Before > lastBookingAfter/Before.
```

(Keep the existing `parseCustomer`, the existing pagination/staff-skip logic, and the existing `nextCursor` semantics. Update the body of `listCustomers` to take an `opts` object with the new shape and apply the constraints described above.)

- [ ] **Step 4: Run tests — confirm pass**

Run: `npm run test:run -- asquare-customers`
Expected: all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/api/asquare-customers.ts src/pipeline/api/asquare-customers.test.ts
git commit -m "feat(pipeline): listCustomers supports advanced filter/sort/search"
```

---

## Section C: List page UI

### Task C1: Search-kind radio + input

**Files:**

- Modify: `src/pipeline/pages/modules/AdminModule.tsx`

- [ ] **Step 1: Add state**

Replace the existing `customerSearch` state with:

```tsx
const [customerSearchKind, setCustomerSearchKind] = useState<'phone' | 'name' | 'email'>('name')
const [customerSearch, setCustomerSearch] = useState('')
const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('')
```

- [ ] **Step 2: Replace the search FilterField**

```tsx
<FilterField label="Search">
  <div className="flex gap-2">
    <select
      className="ui-field min-h-10 w-24"
      value={customerSearchKind}
      onChange={(e) => setCustomerSearchKind(e.target.value as typeof customerSearchKind)}
    >
      <option value="name">Name</option>
      <option value="phone">Phone</option>
      <option value="email">Email</option>
    </select>
    <input
      className="ui-field min-h-10 flex-1"
      value={customerSearch}
      onChange={(e) => setCustomerSearch(e.target.value)}
      placeholder={
        customerSearchKind === 'phone'
          ? '10-digit number'
          : customerSearchKind === 'email'
            ? 'starts-with…'
            : 'name starts-with…'
      }
    />
  </div>
</FilterField>
```

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/AdminModule.tsx
git commit -m "feat(admin): search-kind radio for customers list"
```

---

### Task C2: Advanced filter panel (collapsible)

**Files:**

- Modify: `src/pipeline/pages/modules/AdminModule.tsx`

- [ ] **Step 1: Add state for all filters**

```tsx
const [verifiedFilter, setVerifiedFilter] = useState<'' | 'yes' | 'no'>('')
const [branchPreferredFilter, setBranchPreferredFilter] = useState('')
const [spendBucketFilter, setSpendBucketFilter] = useState<'' | '0' | '1-5k' | '5-25k' | '25k+'>('')
const [bookingBucketFilter, setBookingBucketFilter] = useState<'' | '0' | '1' | '2-5' | '6+'>('')
const [hasWalletFilter, setHasWalletFilter] = useState(false)
const [hasTiresFilter, setHasTiresFilter] = useState(false)
const [hasCouponsFilter, setHasCouponsFilter] = useState(false)
const [activeRangeKind, setActiveRangeKind] = useState<'' | 'joined' | 'lastSeen' | 'lastBooking'>(
  '',
)
const [rangeFrom, setRangeFrom] = useState('')
const [rangeTo, setRangeTo] = useState('')
const [showAdvanced, setShowAdvanced] = useState(false)
```

- [ ] **Step 2: Render the filter UI** (after the existing tier dropdown)

Show `Verified`, `Branch`, `Spend`, `Bookings` always. Behind a `<button>{showAdvanced ? 'Hide advanced' : 'More filters'}</button>` toggle, render: `Has wallet`, `Has tires`, `Has unredeemed ₹150 coupons`, `Date range` (kind dropdown + from/to inputs). When `activeRangeKind` is set, the other range options are not shown — only the picked one's from/to inputs.

(Use the existing `FilterField` and `FilterBar` primitives. Branch options come from `useLocations()` which is already imported.)

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/AdminModule.tsx
git commit -m "feat(admin): advanced filter panel for customers list"
```

---

### Task C3: Sort dropdown + cursor pagination

**Files:**

- Modify: `src/pipeline/pages/modules/AdminModule.tsx`

- [ ] **Step 1: Add state**

```tsx
const [sortBy, setSortBy] = useState<ListCustomersSortBy>('createdAt')
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
const [cursorStack, setCursorStack] = useState<QueryDocumentSnapshot<DocumentData>[]>([])
const [nextCursor, setNextCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null)
```

- [ ] **Step 2: Render sort UI above the table**

```tsx
<div className="mb-2 flex items-center gap-2">
  <select
    className="ui-field min-h-10"
    value={sortBy}
    onChange={(e) => setSortBy(e.target.value as ListCustomersSortBy)}
  >
    <option value="createdAt">Joined</option>
    <option value="lastLoginAt">Last seen</option>
    <option value="totalSpent">Total spent</option>
    <option value="bookingCount">Booking count</option>
    <option value="walletBalance">Wallet balance</option>
    <option value="tires">Tires</option>
  </select>
  <button
    className="ui-btn ui-btn-neutral min-h-10 px-3"
    onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
  >
    {sortDir === 'desc' ? '↓ Desc' : '↑ Asc'}
  </button>
</div>
```

- [ ] **Step 3: Replace the load function for the customers view**

```tsx
} else if (view === 'customers') {
  const search = customerSearch.trim()
  const result = await asquareCustomersApi.listCustomers({
    pageSize: 20,
    cursor: cursorStack.at(-1),
    sortBy,
    sortDir,
    filters: {
      tier: customerTierFilter || undefined,
      membership: membershipFilter || undefined,
      verified: verifiedFilter === '' ? undefined : verifiedFilter === 'yes',
      branchPreferred: branchPreferredFilter || undefined,
      spendBucket: spendBucketFilter || undefined,
      bookingBucket: bookingBucketFilter || undefined,
      hasWalletBalance: hasWalletFilter || undefined,
      hasTires: hasTiresFilter || undefined,
      hasUnredeemedCoupons150: hasCouponsFilter || undefined,
      ...(activeRangeKind === 'joined' && rangeFrom ? { joinedAfter: new Date(rangeFrom) } : {}),
      ...(activeRangeKind === 'joined' && rangeTo ? { joinedBefore: new Date(rangeTo) } : {}),
      ...(activeRangeKind === 'lastSeen' && rangeFrom ? { lastSeenAfter: new Date(rangeFrom) } : {}),
      ...(activeRangeKind === 'lastSeen' && rangeTo ? { lastSeenBefore: new Date(rangeTo) } : {}),
      ...(activeRangeKind === 'lastBooking' && rangeFrom ? { lastBookingAfter: new Date(rangeFrom) } : {}),
      ...(activeRangeKind === 'lastBooking' && rangeTo ? { lastBookingBefore: new Date(rangeTo) } : {}),
    },
    search: search ? { kind: customerSearchKind, value: search } : undefined,
  })
  setCustomers(result.items)
  setNextCursor(result.nextCursor)
}
```

- [ ] **Step 4: Render Next/Prev under the table**

```tsx
<div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted">
  <button
    className="ui-btn ui-btn-neutral min-h-7 px-2"
    disabled={cursorStack.length === 0}
    onClick={() => setCursorStack((s) => s.slice(0, -1))}
  >
    Prev
  </button>
  <button
    className="ui-btn ui-btn-neutral min-h-7 px-2"
    disabled={!nextCursor}
    onClick={() => setCursorStack((s) => [...s, nextCursor!])}
  >
    Next
  </button>
</div>
```

- [ ] **Step 5: Reset cursor stack when filters/sort/search change**

Add `useEffect(() => setCursorStack([]), [customerTierFilter, membershipFilter, verifiedFilter, branchPreferredFilter, spendBucketFilter, bookingBucketFilter, hasWalletFilter, hasTiresFilter, hasCouponsFilter, activeRangeKind, rangeFrom, rangeTo, debouncedCustomerSearch, customerSearchKind, sortBy, sortDir])`.

Also call `load()` whenever cursorStack changes for view === customers.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/pages/modules/AdminModule.tsx
git commit -m "feat(admin): cursor pagination + sort for customers list"
```

---

### Task C4: Row click navigates to detail page

**Files:**

- Modify: `src/pipeline/pages/modules/AdminModule.tsx`

- [ ] **Step 1: Import `useNavigate`**

`import { Link, Navigate, useNavigate } from 'react-router-dom'`
`const navigate = useNavigate()`

- [ ] **Step 2: Wire `onRowClick` on the customers DataTable**

```tsx
<DataTable
  // ...existing props...
  onRowClick={(c) => navigate(`/admin/customers/${c.id}`)}
/>
```

The existing Edit / Delete buttons must stop propagation so they keep their inline behavior:

```tsx
<button onClick={(e) => { e.stopPropagation(); setEditingCustomer(c) }}>Edit</button>
<button onClick={(e) => { e.stopPropagation(); setPendingDeleteCustomer(c) }}>Delete</button>
```

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/AdminModule.tsx
git commit -m "feat(admin): row click opens customer detail page"
```

---

## Section D: Detail page shell

### Task D1: Lift Edit/Delete dialogs into a shared module

**Files:**

- Create: `src/pipeline/pages/modules/customer-detail/CustomerActionDialogs.tsx`
- Modify: `src/pipeline/pages/modules/AdminModule.tsx`

- [ ] **Step 1: Extract the Edit + Delete dialog JSX from AdminModule.tsx**

Move both dialog blocks plus their related state setters into a self-contained component:

```tsx
// CustomerActionDialogs.tsx
import { AsquareCustomer, asquareCustomersApi } from '../../../api/asquare-customers'
import { useToast } from '../../../features/toast/toast-context'

interface Props {
  editingCustomer: AsquareCustomer | null
  setEditingCustomer: (c: AsquareCustomer | null) => void
  pendingDeleteCustomer: AsquareCustomer | null
  setPendingDeleteCustomer: (c: AsquareCustomer | null) => void
  onChanged?: () => void
}

export const CustomerActionDialogs = ({
  editingCustomer,
  setEditingCustomer,
  pendingDeleteCustomer,
  setPendingDeleteCustomer,
  onChanged,
}: Props) => {
  // …moved JSX…
}
```

- [ ] **Step 2: Replace the inline JSX in AdminModule with `<CustomerActionDialogs ... />`**

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/customer-detail/CustomerActionDialogs.tsx \
        src/pipeline/pages/modules/AdminModule.tsx
git commit -m "refactor(admin): lift customer Edit/Delete dialogs into shared component"
```

---

### Task D2: Add the detail route

**Files:**

- Modify: `src/pipeline/app/router.tsx`

- [ ] **Step 1: Lazy-import the page**

```tsx
const CustomerDetailPage = lazy(() => import('../pages/modules/customer-detail/CustomerDetailPage'))
```

- [ ] **Step 2: Add the route just below `/admin/customers`**

```tsx
<Route
  path="/admin/customers/:customerId"
  element={
    <ProtectedRoute>
      <CustomerDetailPage />
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/app/router.tsx
git commit -m "feat(router): /admin/customers/:customerId route"
```

---

### Task D3: CustomerDetailPage shell (header + tabs)

**Files:**

- Create: `src/pipeline/pages/modules/customer-detail/CustomerDetailPage.tsx`
- Create: `src/pipeline/pages/modules/customer-detail/customer-detail-types.ts`

- [ ] **Step 1: Define tab keys**

```ts
// customer-detail-types.ts
export type CustomerDetailTab =
  | 'overview'
  | 'bookings'
  | 'games'
  | 'wallet'
  | 'tires'
  | 'coupons'
  | 'referrals'

export const CUSTOMER_DETAIL_TABS: { key: CustomerDetailTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'games', label: 'Games' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'tires', label: 'Tires' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'referrals', label: 'Referrals' },
]
```

- [ ] **Step 2: Build the page shell**

```tsx
// CustomerDetailPage.tsx
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { getAsquareFirestore, toDate } from '../../../api/asquare-firestore'
import { ModulePageLayout } from '../../../components/layout/ModulePageLayout'
import { ErrorState } from '../../../../components/ui/ErrorState'
import { Skeleton } from '../../../../components/ui/Skeleton'
import { CUSTOMER_DETAIL_TABS, CustomerDetailTab } from './customer-detail-types'
import { OverviewTab } from './tabs/OverviewTab'
import { BookingsTab } from './tabs/BookingsTab'
import { GamesTab } from './tabs/GamesTab'
import { WalletTab } from './tabs/WalletTab'
import { TiresTab } from './tabs/TiresTab'
import { CouponsTab } from './tabs/CouponsTab'
import { ReferralsTab } from './tabs/ReferralsTab'
import { CustomerActionDialogs } from './CustomerActionDialogs'
import type { AsquareCustomer } from '../../../api/asquare-customers'

const fmt = (n: number) => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

const CustomerDetailPage = () => {
  const { customerId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as CustomerDetailTab) || 'overview'

  const customerQ = useQuery({
    queryKey: ['customer', customerId],
    queryFn: async (): Promise<AsquareCustomer> => {
      const ref = doc(getAsquareFirestore(), 'users', customerId)
      const snap = await getDoc(ref)
      if (!snap.exists()) throw new Error('Customer not found')
      // Reuse parseCustomer if exported, otherwise inline-parse the small subset needed by the header.
      return /* parsed customer */ snap.data() as unknown as AsquareCustomer
    },
    staleTime: 60_000,
  })

  const [editing, setEditing] = useState<AsquareCustomer | null>(null)
  const [deleting, setDeleting] = useState<AsquareCustomer | null>(null)

  if (customerQ.isLoading)
    return (
      <ModulePageLayout title="Customer">
        <Skeleton className="h-40 w-full" />
      </ModulePageLayout>
    )
  if (customerQ.isError)
    return (
      <ModulePageLayout title="Customer">
        <ErrorState message="Customer not found" />
      </ModulePageLayout>
    )
  const c = customerQ.data!

  return (
    <ModulePageLayout
      title={c.displayName || 'Customer'}
      breadcrumb={<Link to="/admin/customers">← Customers</Link>}
    >
      <header className="mb-6 rounded-xl border border-border/70 bg-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-text">
              {c.displayName || 'Unknown'}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {c.phone} · {c.email}
            </p>
            <p className="mt-1 text-xs text-muted">
              Joined {c.createdAt.toLocaleDateString('en-IN')} · Last seen{' '}
              {c.lastLoginAt?.toLocaleDateString('en-IN') ?? 'never'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
              onClick={() => setEditing(c)}
            >
              Edit
            </button>
            <button
              className="ui-btn ui-btn-danger min-h-10 px-4 text-sm"
              onClick={() => setDeleting(c)}
            >
              Delete
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Total spent" value={fmt(c.totalSpent)} />
          <KpiCard label="Bookings" value={String(c.bookingCount)} />
          <KpiCard label="Wallet" value={fmt(c.walletBalance)} />
          <KpiCard label="Tires" value={String(c.tires)} />
          <KpiCard label="₹150 coupons" value={String(c.coupons150Available)} />
          <KpiCard label="Tier · Membership" value={`${c.tier} · ${c.membership ?? '—'}`} />
        </div>
      </header>

      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {CUSTOMER_DETAIL_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() =>
              setParams(
                (p) => {
                  p.set('tab', t.key)
                  return p
                },
                { replace: true },
              )
            }
            className={`min-h-10 px-3 text-sm ${tab === t.key ? 'border-b-2 border-accent text-text' : 'text-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab customer={c} />}
      {tab === 'bookings' && <BookingsTab customerId={customerId} />}
      {tab === 'games' && <GamesTab customerId={customerId} />}
      {tab === 'wallet' && <WalletTab customerId={customerId} />}
      {tab === 'tires' && <TiresTab customerId={customerId} />}
      {tab === 'coupons' && <CouponsTab customerId={customerId} />}
      {tab === 'referrals' && <ReferralsTab customerId={customerId} customer={c} />}

      <CustomerActionDialogs
        editingCustomer={editing}
        setEditingCustomer={setEditing}
        pendingDeleteCustomer={deleting}
        setPendingDeleteCustomer={setDeleting}
        onChanged={() => customerQ.refetch()}
      />
    </ModulePageLayout>
  )
}

const KpiCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border/50 bg-surface/30 p-3">
    <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{label}</p>
    <p className="mt-1 text-lg font-semibold text-text">{value}</p>
  </div>
)

export default CustomerDetailPage
```

- [ ] **Step 3: Export `parseCustomer` from `asquare-customers.ts`** so the detail page can reuse it instead of inline-parsing.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/pages/modules/customer-detail/CustomerDetailPage.tsx \
        src/pipeline/pages/modules/customer-detail/customer-detail-types.ts \
        src/pipeline/api/asquare-customers.ts
git commit -m "feat(admin): customer detail page shell with header + tab nav"
```

---

## Section E: Detail page tabs (each with its API)

> Each tab task pairs the data fetcher with the component and its tests. All fetchers live in `src/pipeline/api/customer-detail/` and use React Query in components for caching/loading/error.

### Task E1: Bookings — API + component

**Files:**

- Create: `src/pipeline/api/customer-detail/customer-bookings.ts`
- Create: `src/pipeline/pages/modules/customer-detail/tabs/BookingsTab.tsx`
- Test: `src/pipeline/api/customer-detail/customer-bookings.test.ts`

- [ ] **Step 1: Implement the fetcher** with cursor pagination over `users/{uid}/bookings` ordered by `sessionDate desc`, optional filter clauses for `bookingStatus`, `paymentStatus`, branch, date range. Optional second-pass merge of `deleted_bookings where userId == :uid` (sorted by `deletedAt desc`) when `includeDeleted` is true.

- [ ] **Step 2: Tests** for: empty, mid-page, filter-by-status, includeDeleted merge.

- [ ] **Step 3: Build BookingsTab** — filter bar (branch, status, payment, date range, includeDeleted toggle), DataTable, cursor Next/Prev, row click opens existing booking detail page.

- [ ] **Step 4: Run tests + manual smoke + commit**

```bash
npm run test:run -- customer-bookings
git add src/pipeline/api/customer-detail/customer-bookings.ts \
        src/pipeline/api/customer-detail/customer-bookings.test.ts \
        src/pipeline/pages/modules/customer-detail/tabs/BookingsTab.tsx
git commit -m "feat(customer-detail): Bookings tab"
```

---

### Task E2: Wallet — API + component

**Files:**

- Create: `src/pipeline/api/customer-detail/customer-wallet.ts`
- Create: `src/pipeline/pages/modules/customer-detail/tabs/WalletTab.tsx`
- Test: `src/pipeline/api/customer-detail/customer-wallet.test.ts`

- [ ] **Step 1: Fetcher** reads `users/{uid}/wallet/data` (balance) and paginates `users/{uid}/wallet_transactions` ordered by `timestamp desc`. Filter by `type` (credit/debit/all) and date range.

- [ ] **Step 2: Tests** for empty, populated, filter by type.

- [ ] **Step 3: WalletTab** — top KPI (balance), filter bar, DataTable (Date · Type · Amount · Reason · Booking link), Next/Prev.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(customer-detail): Wallet tab"
```

---

### Task E3: Tires — API + component

**Files:**

- Create: `src/pipeline/api/customer-detail/customer-tires.ts`
- Create: `src/pipeline/pages/modules/customer-detail/tabs/TiresTab.tsx`
- Test: `src/pipeline/api/customer-detail/customer-tires.test.ts`

- [ ] **Step 1: Fetcher** mirrors the Wallet fetcher but reads `users/{uid}/tire_transactions`. Includes a second computed column "tires earned per booking" = `floor(booking.finalAmount / 10)` for `tire_credit` rows that link to a booking.

- [ ] **Step 2: Tests + TiresTab + commit**

```bash
git commit -m "feat(customer-detail): Tires tab"
```

---

### Task E4: Coupons — API + component

**Files:**

- Create: `src/pipeline/api/customer-detail/customer-coupons.ts`
- Create: `src/pipeline/pages/modules/customer-detail/tabs/CouponsTab.tsx`
- Test: `src/pipeline/api/customer-detail/customer-coupons.test.ts`

- [ ] **Step 1: Fetcher** reads `users/{uid}/coupons`. Filter by `source` (member_150 / reward / all) and `isUsed` (true/false/all). 50-row cursor pagination.

- [ ] **Step 2: Tests + CouponsTab** — KPI strip (₹150 earned/redeemed/available), filter bar, DataTable (Code · Type · Discount · Source · Created · Expiry · Used).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(customer-detail): Coupons tab"
```

---

### Task E5: Referrals — API + component

**Files:**

- Create: `src/pipeline/api/customer-detail/customer-referrals.ts`
- Create: `src/pipeline/pages/modules/customer-detail/tabs/ReferralsTab.tsx`
- Test: `src/pipeline/api/customer-detail/customer-referrals.test.ts`

- [ ] **Step 1: Fetcher** exports two functions:
  - `getReferrer(referrerUid)` → minimal `{ id, displayName, phone }` for the customer who referred this user (one `getDoc`).
  - `listReferredCustomers(uid, opts)` → paginates `users/{uid}/referredCustomers` ordered by `joinedAt desc`.

- [ ] **Step 2: Tests + ReferralsTab** — two stacked sections with empty states.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(customer-detail): Referrals tab"
```

---

### Task E6: Overview — recent activity timeline

**Files:**

- Create: `src/pipeline/pages/modules/customer-detail/tabs/OverviewTab.tsx`

- [ ] **Step 1: Build the tab**

Pulls the _first page only_ from each of bookings, wallet, tires (in parallel via `useQueries`), takes the 10 most recent events across all sources, and renders a vertical timeline (date · icon · description · amount). Adds a placeholder "Tier change history will appear here once tracking starts" footer card.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(customer-detail): Overview tab with activity timeline"
```

---

### Task E7: Games — aggregated view

**Files:**

- Create: `src/pipeline/pages/modules/customer-detail/tabs/GamesTab.tsx`

- [ ] **Step 1: Build the aggregator**

Walks the bookings cursor up to the configured cap (5,000), reduces `items[]` into `Map<activityName, { count, totalSpent, lastPlayed, locations: Set<string> }>`, sorts by `count desc`. Renders a card grid. If the cap is hit, show a banner: "Showing first 5,000 bookings."

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(customer-detail): Games tab with activity aggregation"
```

---

## Section F: Hardening

### Task F1: Coverage thresholds

**Files:**

- Modify: `vitest.config.ts`

- [ ] **Step 1: Add per-file thresholds for the new modules**

```ts
'src/pipeline/api/customer-buckets.ts': { lines: 95, branches: 90, functions: 100 },
'src/pipeline/api/customer-detail/customer-bookings.ts': { lines: 80, branches: 70, functions: 90 },
'src/pipeline/api/customer-detail/customer-wallet.ts': { lines: 80, branches: 70, functions: 90 },
'src/pipeline/api/customer-detail/customer-tires.ts': { lines: 80, branches: 70, functions: 90 },
'src/pipeline/api/customer-detail/customer-coupons.ts': { lines: 80, branches: 70, functions: 90 },
'src/pipeline/api/customer-detail/customer-referrals.ts': { lines: 80, branches: 70, functions: 90 },
```

- [ ] **Step 2: Run coverage and confirm the thresholds pass**

Run: `npm run test:coverage`
Expected: thresholds pass for the new modules.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test: coverage thresholds for customer-detail modules"
```

---

### Task F2: Playwright E2E (happy path)

**Files:**

- Create: `e2e/customer-360.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test'

test.describe('Customer 360', () => {
  test('list → click row → see Overview → switch to Bookings', async ({ page }) => {
    await page.goto('http://pipeline.localhost:5173/admin/customers')
    await page.getByPlaceholder('name starts-with…').fill('test')
    // wait for first row to appear
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor()
    await firstRow.click()
    await expect(page).toHaveURL(/\/admin\/customers\/[^/]+/)
    await expect(page.getByText('Total spent')).toBeVisible()
    await page.getByRole('button', { name: 'Bookings' }).click()
    await expect(page).toHaveURL(/tab=bookings/)
  })
})
```

- [ ] **Step 2: Run it locally**

Run: `npm run test:e2e -- customer-360`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add e2e/customer-360.spec.ts
git commit -m "test(e2e): customer 360 happy path"
```

---

### Task F3: a11y + lint sweep

- [ ] **Step 1: Run ESLint on changed files**

Run: `npm run lint`
Expected: no errors. Fix any.

- [ ] **Step 2: Spot-check keyboard nav on the detail page**

Tab through the header buttons, the tab nav (arrow keys not required, just Tab + Enter), and one tab's filter bar. Confirm focus rings are visible.

- [ ] **Step 3: Commit any fixes**

```bash
git commit -am "chore: a11y and lint cleanup for customer 360"
```

---

## Deployment order (post-merge)

1. Deploy Cloud Functions: `cd functions && npm run deploy -- --only functions:onUserWriteCustomerBuckets,functions:onUserCreateReferralIndex,functions:onBookingWriteSyncCustomerStats`
2. Deploy Firestore indexes: `firebase deploy --only firestore:indexes` (wait for "READY" in console — may take 10–30 min for ~50k users).
3. Run backfills:
   - `FIREBASE_SERVICE_ACCOUNT_PATH=./sa.json npx tsx scripts/backfill-customer-search-and-buckets.ts`
   - `FIREBASE_SERVICE_ACCOUNT_PATH=./sa.json npx tsx scripts/backfill-referral-forward-index.ts`
4. Deploy frontend (normal deploy).

---

## Out of scope (Phase 2/3/4)

- Sessions tab + customer-app session tracking instrumentation.
- Audit log for admin edits.
- Per-customer Interakt notification log.

These three are independent specs/plans, sequenced after Phase 1 ships.
