# Owner-Only Customer Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Owner role exclusive powers to lock, unlock, blacklist, verify, tag as influencer, and adjust wallet balances for customer accounts — all from a new "Customer Controls" tab in the Admin Module.

**Architecture:** Customer flags (`locked`, `blacklisted`, `verified`, `influencer`) stored on `users/{id}` Firestore docs. Lock enforcement is client-side (checkout + wallet service). Blacklist enforcement is server-side via Firebase Auth custom claims set by a Cloud Function. Wallet adjustment calls existing `walletService` with a new `ownerOverride` param. UI is a new view in AdminModule, Owner-gated.

**Tech Stack:** React 18, TypeScript, Firebase Firestore, Firebase Auth Admin SDK, Cloud Functions v2, Tailwind CSS, Lucide React icons

**Spec:** `docs/superpowers/specs/2026-04-20-owner-customer-controls-design.md`

---

## File Structure

### New files

| File                                    | Responsibility                                            |
| --------------------------------------- | --------------------------------------------------------- |
| `src/pipeline/api/customer-controls.ts` | API module: phone lookup, toggle flags, wallet adjustment |
| `functions/api/customer-blacklist.js`   | Cloud Function: toggle blacklist via Auth custom claims   |

### Modified files

| File                                         | Changes                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/types/index.ts`                         | Add `locked` field to `User` interface                                            |
| `src/services/walletService.ts`              | Add `ownerOverride` param to `deductBalance` and `addBalance`; add `locked` check |
| `src/pages/Checkout.tsx`                     | Add lock check before payment                                                     |
| `src/contexts/AuthContext.tsx`               | Add `locked`/`blacklisted` to user sync; check `blacklisted` to force sign-out    |
| `src/pipeline/pages/modules/AdminModule.tsx` | Add `customer-controls` view, Owner-gated, with full UI                           |
| `functions/index.js`                         | Export `toggleCustomerBlacklist`                                                  |

---

## Task 1: Add `locked` field to User type and AuthContext sync

**Files:**

- Modify: `src/types/index.ts:1-22`
- Modify: `src/contexts/AuthContext.tsx:103-121` and `191-208`

- [ ] **Step 1: Add `locked` to the `User` interface**

In `src/types/index.ts`, add after `isVerified`:

```typescript
  isVerified?: boolean
  referredBy?: string
  // ── Account restriction flags (Owner-managed) ────────────────────
  locked?: boolean
```

- [ ] **Step 2: Read `locked` and `blacklisted` in `syncUserWithAPI`**

In `src/contexts/AuthContext.tsx`, in `syncUserWithAPI` around line 106, update the `userObj` construction to include `locked`:

```typescript
const userObj: User = {
  id: canonicalId,
  email: data.email || auth.currentUser?.email || '',
  displayName: data.displayName || data.name || auth.currentUser?.displayName || 'Guest',
  phone: data.phone || cleanPhone,
  tires: data.tires || 0,
  walletBalance: data.walletBalance || 0,
  tier: (data.tier?.toLowerCase() as string | undefined) || 'bronze',
  referralCode: data.referralCode || 'USER' + canonicalId.slice(-6).toUpperCase(),
  createdAt: data.createdAt?.toDate?.() || new Date(),
  updatedAt: data.updatedAt?.toDate?.() || new Date(),
  isVerified: data.isVerified || false,
  referredBy: data.referredBy || '',
  locked: data.locked || false,
}
```

- [ ] **Step 3: Add blacklist check in `syncUserWithAPI` — force sign-out**

In `src/contexts/AuthContext.tsx`, immediately after `const data = userSnap.data()` (line 104), add a blacklist check:

```typescript
      if (userSnap.exists()) {
        const data = userSnap.data()

        // Blacklisted customers cannot use the app at all.
        if (data.blacklisted === true) {
          await auth.signOut()
          await storage.remove('mock_user')
          setUser(null)
          setError('Your account has been suspended. Contact support.')
          setLoading(false)
          return
        }

        const userObj: User = {
          // ... existing construction
```

- [ ] **Step 4: Sync `locked` in the real-time profile listener**

In `src/contexts/AuthContext.tsx`, in the `unsubProfile` `onSnapshot` callback (around line 191-208), add `locked` to the real-time sync:

```typescript
const unsubProfile = onSnapshot(
  userDocRef,
  (snapshot) => {
    if (!snapshot.exists()) return
    const data = snapshot.data()

    // If the Owner blacklists this user in real time, force sign-out.
    if (data.blacklisted === true) {
      auth.signOut()
      storage.remove('mock_user').catch(() => {})
      setUser(null)
      setError('Your account has been suspended. Contact support.')
      return
    }

    setUser((prev) => {
      if (!prev) return null
      const updates: Partial<User> = {}
      if (data.referralCode && data.referralCode !== prev.referralCode)
        updates.referralCode = data.referralCode
      if (data.referredBy && data.referredBy !== prev.referredBy)
        updates.referredBy = data.referredBy
      // Sync locked flag in real time so Owner toggle takes immediate effect
      if (data.locked !== undefined && data.locked !== prev.locked) updates.locked = data.locked
      if (Object.keys(updates).length === 0) return prev
      return { ...prev, ...updates }
    })
  },
  (err) => logger.error('auth.profile.sync_failed', err),
)
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/contexts/AuthContext.tsx
git commit -m "feat(customer-controls): add locked flag to User type and AuthContext sync

- Add locked field to User interface
- Read locked/blacklisted in syncUserWithAPI
- Force sign-out on blacklisted in initial sync and real-time listener
- Sync locked flag in real-time profile onSnapshot"
```

---

## Task 2: Add `ownerOverride` and `locked` check to walletService

**Files:**

- Modify: `src/services/walletService.ts:82-133` (deductBalance) and `149-220` (addBalance)

- [ ] **Step 1: Add `locked` check and `ownerOverride` to `deductBalance`**

In `src/services/walletService.ts`, change the signature and add a locked check after the walletFrozen check:

```typescript
  async deductBalance(
    userId: string,
    amount: number,
    description: string,
    options?: { ownerOverride?: boolean },
  ): Promise<boolean> {
    try {
      if (!userId || amount <= 0) return false

      const walletRef = doc(db, 'users', userId, 'wallet', 'data')
      const userRef = doc(db, 'users', userId)

      return await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userRef)
        if (!options?.ownerOverride) {
          if (userDoc.exists() && userDoc.data().walletFrozen === true) {
            throw new Error('Wallet is frozen')
          }
          if (userDoc.exists() && userDoc.data().locked === true) {
            throw new Error('Account is locked')
          }
        }
        // ... rest unchanged
```

- [ ] **Step 2: Add `locked` check and `ownerOverride` to `addBalance`**

In `src/services/walletService.ts`, change the signature and add the locked check:

```typescript
  async addBalance(
    userId: string,
    amount: number,
    description: string = 'Credit',
    idempotencyKey?: string,
    options?: { ownerOverride?: boolean },
  ): Promise<boolean> {
    try {
      if (!userId || amount <= 0) return false

      const walletRef = doc(db, 'users', userId, 'wallet', 'data')
      const userRef = doc(db, 'users', userId)
      const txRef = idempotencyKey
        ? doc(db, 'users', userId, 'wallet_transactions', `idem_${idempotencyKey}`)
        : doc(collection(db, 'users', userId, 'wallet_transactions'))

      return await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userRef)
        if (!options?.ownerOverride) {
          if (userDoc.exists() && userDoc.data().walletFrozen === true) {
            throw new Error('Wallet is frozen')
          }
          if (userDoc.exists() && userDoc.data().locked === true) {
            throw new Error('Account is locked')
          }
        }
        // ... rest unchanged (idempotency check, balance update, etc.)
```

- [ ] **Step 3: Update the Transaction type to include owner types**

In `src/services/walletService.ts`, update the Transaction interface:

```typescript
export interface Transaction {
  id: string
  type: 'credit' | 'debit' | 'owner_credit' | 'owner_debit' | 'tire_credit' | 'tire_debit'
  amount: number
  description: string
  timestamp: Timestamp
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/services/walletService.ts
git commit -m "feat(customer-controls): add ownerOverride and locked check to walletService

- deductBalance and addBalance now check user.locked
- ownerOverride param bypasses both locked and walletFrozen checks
- Add owner_credit/owner_debit to Transaction type"
```

---

## Task 3: Add lock check to Checkout.tsx

**Files:**

- Modify: `src/pages/Checkout.tsx:196-203`

- [ ] **Step 1: Add lock check after the `!user` check in `handlePayment`**

In `src/pages/Checkout.tsx`, after the existing `if (!user)` block (around line 196) and before the `if (remainingAmount > 0 && !selectedPayment)` check, add:

```typescript
// Block locked customers from making bookings
if (user.locked) {
  paymentInFlight.current = false
  setStatusModal({
    show: true,
    type: 'failed',
    message: 'Your account is restricted. Please contact support.',
  })
  return
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/Checkout.tsx
git commit -m "feat(customer-controls): block locked customers at checkout"
```

---

## Task 4: Create `toggleCustomerBlacklist` Cloud Function

**Files:**

- Create: `functions/api/customer-blacklist.js`
- Modify: `functions/index.js`

- [ ] **Step 1: Create the Cloud Function**

Create `functions/api/customer-blacklist.js`:

```javascript
/**
 * Customer Blacklist Toggle — Owner-only Cloud Function.
 *
 * POST /toggleCustomerBlacklist
 * Headers: Authorization: Bearer <Firebase ID token>
 * Body: { customerId, blacklist: boolean, reason?: string }
 *
 * When blacklist=true: sets Auth custom claim { disabled: true }, revokes
 * refresh tokens, sets blacklisted+locked on user doc.
 * When blacklist=false: removes the claim, clears blacklisted on user doc.
 */
const logger = require('firebase-functions/logger')
const { onRequest } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const setup = require('../lib/setup')
const { extractBearerToken } = require('../lib/utils')

exports.toggleCustomerBlacklist = onRequest(
  {
    region: 'asia-south1',
    timeoutSeconds: 30,
    cors: true,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, message: 'Method Not Allowed' })
      return
    }

    // ── Auth: verify Firebase ID token ──
    const idToken = extractBearerToken(req)
    if (!idToken) {
      res.status(401).json({ ok: false, message: 'Missing bearer token' })
      return
    }

    let decodedToken
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken)
    } catch {
      res.status(401).json({ ok: false, message: 'Invalid auth token' })
      return
    }

    // ── Role check: Owner only ──
    const callerUid = decodedToken.uid
    const callerSnap = await setup.db.collection('users').doc(callerUid).get()
    if (!callerSnap.exists || callerSnap.data().role !== 'Owner') {
      res.status(403).json({ ok: false, message: 'Only the Owner can blacklist customers' })
      return
    }
    const callerName = callerSnap.data().name || callerSnap.data().displayName || 'Owner'

    try {
      const { customerId, blacklist, reason } = req.body

      if (!customerId || typeof blacklist !== 'boolean') {
        res
          .status(400)
          .json({ ok: false, message: 'customerId and blacklist (boolean) are required' })
        return
      }

      if (blacklist && !reason) {
        res.status(400).json({ ok: false, message: 'reason is required when blacklisting' })
        return
      }

      const customerRef = setup.db.collection('users').doc(customerId)
      const customerSnap = await customerRef.get()
      if (!customerSnap.exists) {
        res.status(404).json({ ok: false, message: 'Customer not found' })
        return
      }

      // Don't allow blacklisting staff accounts
      if (customerSnap.data().role) {
        res.status(400).json({ ok: false, message: 'Cannot blacklist a staff account' })
        return
      }

      const now = new Date().toISOString()

      if (blacklist) {
        // Set custom claim to block login
        await admin.auth().setCustomUserClaims(customerId, { disabled: true })
        // Revoke refresh tokens — forces immediate sign-out
        await admin.auth().revokeRefreshTokens(customerId)

        await customerRef.set(
          {
            blacklisted: true,
            locked: true,
            accountFlags: {
              blacklistedAt: now,
              blacklistedBy: callerUid,
              blacklistedByName: callerName,
              blacklistReason: reason,
              // Blacklist implies lock
              lockedAt: now,
              lockedBy: callerUid,
              lockedByName: callerName,
            },
          },
          { merge: true },
        )

        logger.info(`Customer ${customerId} blacklisted by ${callerName}`, { reason })
        res.status(200).json({ ok: true, message: 'Customer blacklisted' })
      } else {
        // Remove the disabled claim (set claims without disabled key)
        const existingClaims = (await admin.auth().getUser(customerId)).customClaims || {}
        delete existingClaims.disabled
        await admin.auth().setCustomUserClaims(customerId, existingClaims)

        await customerRef.set(
          {
            blacklisted: false,
            accountFlags: {
              unblacklistedAt: now,
              unblacklistedBy: callerUid,
              unblacklistedByName: callerName,
            },
          },
          { merge: true },
        )

        logger.info(`Customer ${customerId} unblacklisted by ${callerName}`)
        res.status(200).json({ ok: true, message: 'Customer unblacklisted' })
      }
    } catch (err) {
      logger.error('Failed to toggle customer blacklist', err)
      res.status(500).json({
        ok: false,
        message: err.message || 'Failed to toggle blacklist',
      })
    }
  },
)
```

- [ ] **Step 2: Export from `functions/index.js`**

Add at the end of `functions/index.js`:

```javascript
// ─── Customer Blacklist ──────────────────────────────────────────────
const { toggleCustomerBlacklist } = require('./api/customer-blacklist')
exports.toggleCustomerBlacklist = toggleCustomerBlacklist
```

- [ ] **Step 3: Verify syntax**

Run: `cd functions && node -c api/customer-blacklist.js && echo "OK"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add functions/api/customer-blacklist.js functions/index.js
git commit -m "feat(customer-controls): add toggleCustomerBlacklist Cloud Function

- Owner-only: verifies caller role via Firestore user doc
- Blacklist sets Auth custom claim { disabled: true } + revokes tokens
- Unblacklist removes claim, does not auto-unlock
- Rejects staff accounts and missing reason"
```

---

## Task 5: Create `customer-controls.ts` pipeline API module

**Files:**

- Create: `src/pipeline/api/customer-controls.ts`

- [ ] **Step 1: Create the API module**

Create `src/pipeline/api/customer-controls.ts`:

```typescript
/**
 * Customer Controls — Owner-only API for managing customer account flags
 * and wallet adjustments. All functions require the caller to be Owner.
 *
 * Flags (lock, verified, influencer) are direct Firestore writes.
 * Blacklist requires a Cloud Function (Auth custom claims).
 * Wallet adjustments call the customer-app walletService with ownerOverride.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  orderBy,
  limit,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { normalizePhone } from '../features/leads/lead-utils'
import { logger } from '../../lib/logger'
import { auth } from '../../lib/firebase'

// ─── Customer Lookup ─────────────────────────────────────────────────

export interface CustomerControlsData {
  userId: string
  displayName: string
  phone: string
  email: string
  walletBalance: number
  locked: boolean
  blacklisted: boolean
  verified: boolean
  influencer: boolean
  accountFlags?: Record<string, unknown>
}

/**
 * Look up a customer by phone number. Uses phoneToUid index first,
 * falls back to users collection scan (skipping staff docs).
 */
export const lookupCustomerByPhone = async (
  phone: string,
): Promise<CustomerControlsData | null> => {
  const firestore = initializeFirestore()
  if (!firestore) return null

  const normalized = normalizePhone(phone)
  const variants = [normalized, `+91${normalized}`, `91${normalized}`]

  // Route through phoneToUid index first
  let userId: string | null = null
  try {
    const indexSnap = await getDoc(doc(firestore, 'phoneToUid', normalized))
    if (indexSnap.exists()) {
      const mapped = (indexSnap.data() as Record<string, unknown>).uid
      if (typeof mapped === 'string' && mapped.length > 0) userId = mapped
    }
  } catch {
    /* fall through */
  }

  // Fallback: scan users collection
  if (!userId) {
    for (const variant of variants) {
      if (userId) break
      try {
        const q = query(collection(firestore, 'users'), where('phone', '==', variant))
        const snap = await getDocs(q)
        for (const candidate of snap.docs) {
          const data = candidate.data() as Record<string, unknown>
          if (data.role) continue // skip staff
          userId = candidate.id
          break
        }
      } catch {
        /* try next */
      }
    }
  }

  if (!userId) return null

  const userSnap = await getDoc(doc(firestore, 'users', userId))
  if (!userSnap.exists()) return null

  const data = userSnap.data() as Record<string, unknown>
  // Don't return staff accounts
  if (data.role) return null

  return {
    userId,
    displayName: String(data.displayName || data.name || 'Unknown'),
    phone: String(data.phone || normalized),
    email: String(data.email || ''),
    walletBalance: Number(data.walletBalance || 0),
    locked: data.locked === true,
    blacklisted: data.blacklisted === true,
    verified: data.verified === true,
    influencer: data.influencer === true,
    accountFlags: (data.accountFlags as Record<string, unknown>) || undefined,
  }
}

// ─── Toggle Flags (direct Firestore writes) ──────────────────────────

export const toggleCustomerLock = async (
  userId: string,
  locked: boolean,
  owner: { id: string; name: string },
): Promise<void> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured.')

  const now = new Date().toISOString()
  const flagUpdate = locked
    ? { lockedAt: now, lockedBy: owner.id, lockedByName: owner.name }
    : { unlockedAt: now, unlockedBy: owner.id, unlockedByName: owner.name }

  await setDoc(
    doc(firestore, 'users', userId),
    { locked, accountFlags: flagUpdate },
    { merge: true },
  )
}

export const toggleCustomerVerified = async (userId: string, verified: boolean): Promise<void> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured.')
  await setDoc(doc(firestore, 'users', userId), { verified }, { merge: true })
}

export const toggleCustomerInfluencer = async (
  userId: string,
  influencer: boolean,
): Promise<void> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured.')
  await setDoc(doc(firestore, 'users', userId), { influencer }, { merge: true })
}

// ─── Blacklist (via Cloud Function) ──────────────────────────────────

const BLACKLIST_FUNCTION_URL =
  'https://asia-south1-a-square-6720c.cloudfunctions.net/toggleCustomerBlacklist'

export const toggleCustomerBlacklist = async (
  customerId: string,
  blacklist: boolean,
  reason?: string,
): Promise<{ ok: boolean; message: string }> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const token = await auth.currentUser?.getIdToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  } catch {
    throw new Error('Could not get auth token')
  }

  const res = await fetch(BLACKLIST_FUNCTION_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ customerId, blacklist, reason }),
  })
  const result = await res.json()
  if (!res.ok) throw new Error(result.message || 'Blacklist toggle failed')
  return result
}

// ─── Wallet History (for the controls panel) ─────────────────────────

export interface WalletTransaction {
  id: string
  type: string
  amount: number
  description: string
  timestamp: unknown
}

export const getCustomerWalletHistory = async (
  userId: string,
  count = 20,
): Promise<WalletTransaction[]> => {
  const firestore = initializeFirestore()
  if (!firestore) return []

  try {
    const q = query(
      collection(firestore, 'users', userId, 'wallet_transactions'),
      orderBy('timestamp', 'desc'),
      limit(count),
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WalletTransaction)
  } catch (err) {
    logger.error('customer_controls.wallet_history_failed', err)
    return []
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/api/customer-controls.ts
git commit -m "feat(customer-controls): add customer-controls API module

- lookupCustomerByPhone via phoneToUid index + fallback
- toggleCustomerLock/Verified/Influencer as direct Firestore writes
- toggleCustomerBlacklist calls Cloud Function with auth token
- getCustomerWalletHistory for the controls panel"
```

---

## Task 6: Add Customer Controls view to AdminModule

**Files:**

- Modify: `src/pipeline/pages/modules/AdminModule.tsx`

This is the largest task. It adds the `customer-controls` view type, Owner-gated subnav entry, and the full UI panel.

- [ ] **Step 1: Add `'customer-controls'` to the `AdminView` type**

In `AdminModule.tsx` around line 37, add to the union:

```typescript
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
  | 'customer-controls'
```

- [ ] **Step 2: Add Owner-gated subnav entry**

In the `subnav` array (around line 48), add conditionally. Change from a static array to a computed one, or add the entry and filter in the JSX. The simplest approach — add it to the array and gate it in the role-redirect logic:

```typescript
  { label: 'Customer Controls', to: '/admin/customer-controls' },
```

Then in the role-gating section (around line 964-979), add a redirect for non-Owners:

```typescript
if (view === 'customer-controls' && currentUser.role !== 'Owner') {
  return <Navigate replace to="/admin/roles" />
}
```

- [ ] **Step 3: Add imports for the API module and icons**

At the top of AdminModule.tsx, add:

```typescript
import {
  lookupCustomerByPhone,
  toggleCustomerLock,
  toggleCustomerVerified,
  toggleCustomerInfluencer,
  toggleCustomerBlacklist,
  getCustomerWalletHistory,
  type CustomerControlsData,
  type WalletTransaction,
} from '../../api/customer-controls'
import { walletService } from '../../../services/walletService'
```

Add to the existing Lucide import any missing icons: `Lock`, `Unlock`, `ShieldBan`, `ShieldCheck`, `Star`, `Wallet`, `Plus`, `Minus`.

- [ ] **Step 4: Add state declarations for the customer-controls view**

Inside the component function, add state for the customer controls view:

```typescript
// ── Customer Controls state (Owner only) ──
const [ccPhone, setCcPhone] = useState('')
const [ccCustomer, setCcCustomer] = useState<CustomerControlsData | null>(null)
const [ccHistory, setCcHistory] = useState<WalletTransaction[]>([])
const [ccLoading, setCcLoading] = useState(false)
const [ccError, setCcError] = useState<string | null>(null)
const [ccActionLoading, setCcActionLoading] = useState(false)
// Wallet adjustment form
const [ccWalletType, setCcWalletType] = useState<'credit' | 'debit'>('credit')
const [ccWalletAmount, setCcWalletAmount] = useState('')
const [ccWalletNote, setCcWalletNote] = useState('')
// Blacklist reason dialog
const [ccBlacklistDialog, setCcBlacklistDialog] = useState(false)
const [ccBlacklistReason, setCcBlacklistReason] = useState('')
```

- [ ] **Step 5: Add the customer lookup handler**

```typescript
const handleCcLookup = async () => {
  if (!ccPhone.trim()) return
  setCcLoading(true)
  setCcError(null)
  setCcCustomer(null)
  setCcHistory([])
  try {
    const result = await lookupCustomerByPhone(ccPhone.trim())
    if (!result) {
      setCcError('No customer found with this phone number.')
      return
    }
    setCcCustomer(result)
    const history = await getCustomerWalletHistory(result.userId)
    setCcHistory(history)
  } catch (err) {
    setCcError(err instanceof Error ? err.message : 'Lookup failed')
  } finally {
    setCcLoading(false)
  }
}
```

- [ ] **Step 6: Add toggle handlers**

```typescript
const handleCcToggleLock = async () => {
  if (!ccCustomer || !currentUser) return
  const newValue = !ccCustomer.locked
  const msg = newValue ? "Lock this customer's account?" : "Unlock this customer's account?"
  if (!confirm(msg)) return
  setCcActionLoading(true)
  try {
    await toggleCustomerLock(ccCustomer.userId, newValue, {
      id: currentUser.id,
      name: currentUser.name,
    })
    setCcCustomer({ ...ccCustomer, locked: newValue })
  } catch (err) {
    setCcError(err instanceof Error ? err.message : 'Failed to toggle lock')
  } finally {
    setCcActionLoading(false)
  }
}

const handleCcToggleBlacklist = async (reason?: string) => {
  if (!ccCustomer) return
  const newValue = !ccCustomer.blacklisted
  if (newValue && !reason) {
    setCcBlacklistDialog(true)
    return
  }
  setCcActionLoading(true)
  setCcBlacklistDialog(false)
  try {
    await toggleCustomerBlacklist(ccCustomer.userId, newValue, reason)
    setCcCustomer({
      ...ccCustomer,
      blacklisted: newValue,
      locked: newValue ? true : ccCustomer.locked,
    })
  } catch (err) {
    setCcError(err instanceof Error ? err.message : 'Failed to toggle blacklist')
  } finally {
    setCcActionLoading(false)
  }
}

const handleCcToggleVerified = async () => {
  if (!ccCustomer) return
  setCcActionLoading(true)
  try {
    await toggleCustomerVerified(ccCustomer.userId, !ccCustomer.verified)
    setCcCustomer({ ...ccCustomer, verified: !ccCustomer.verified })
  } catch (err) {
    setCcError(err instanceof Error ? err.message : 'Failed to toggle verified')
  } finally {
    setCcActionLoading(false)
  }
}

const handleCcToggleInfluencer = async () => {
  if (!ccCustomer) return
  setCcActionLoading(true)
  try {
    await toggleCustomerInfluencer(ccCustomer.userId, !ccCustomer.influencer)
    setCcCustomer({ ...ccCustomer, influencer: !ccCustomer.influencer })
  } catch (err) {
    setCcError(err instanceof Error ? err.message : 'Failed to toggle influencer')
  } finally {
    setCcActionLoading(false)
  }
}
```

- [ ] **Step 7: Add wallet adjustment handler**

```typescript
const handleCcWalletAdjust = async () => {
  if (!ccCustomer || !currentUser) return
  const amt = parseFloat(ccWalletAmount)
  if (!amt || amt <= 0 || !ccWalletNote.trim()) return

  const label = ccWalletType === 'credit' ? 'Credit' : 'Debit'
  const msg = `${label} ₹${amt} ${ccWalletType === 'credit' ? 'to' : 'from'} ${ccCustomer.displayName}'s wallet?\n\nNote: ${ccWalletNote}`
  if (!confirm(msg)) return

  setCcActionLoading(true)
  try {
    const description = `Owner adjustment: ${ccWalletNote} (by ${currentUser.name})`
    let success: boolean

    if (ccWalletType === 'credit') {
      const idempotencyKey = `ownerAdjust_${ccCustomer.userId}_${Date.now()}`
      success = await walletService.addBalance(
        ccCustomer.userId,
        amt,
        description,
        idempotencyKey,
        { ownerOverride: true },
      )
    } else {
      success = await walletService.deductBalance(ccCustomer.userId, amt, description, {
        ownerOverride: true,
      })
    }

    if (!success) throw new Error('Wallet operation returned false')

    // Refresh customer data and history
    const refreshed = await lookupCustomerByPhone(ccCustomer.phone)
    if (refreshed) setCcCustomer(refreshed)
    const history = await getCustomerWalletHistory(ccCustomer.userId)
    setCcHistory(history)
    setCcWalletAmount('')
    setCcWalletNote('')
  } catch (err) {
    setCcError(err instanceof Error ? err.message : 'Wallet adjustment failed')
  } finally {
    setCcActionLoading(false)
  }
}
```

- [ ] **Step 8: Add the view rendering block**

Add the Customer Controls view block in the return JSX, following the existing pattern of `{view === 'customer-controls' ? (...) : null}`:

```tsx
{
  view === 'customer-controls' ? (
    <div className="space-y-6">
      {/* Search */}
      <div className="flex gap-3">
        <input
          type="tel"
          placeholder="Search customer by phone..."
          value={ccPhone}
          onChange={(e) => setCcPhone(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCcLookup()}
          className="flex-1 bg-dark-800 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-dark-400 focus:outline-none focus:border-primary-500"
        />
        <button
          onClick={handleCcLookup}
          disabled={ccLoading || !ccPhone.trim()}
          className="px-6 py-2.5 bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {ccLoading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {ccError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
          {ccError}
        </div>
      )}

      {ccCustomer && (
        <div className="space-y-6">
          {/* Customer Info */}
          <div className="bg-dark-800/50 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">{ccCustomer.displayName}</h3>
                <p className="text-dark-400 text-sm">
                  {ccCustomer.phone} {ccCustomer.email && `· ${ccCustomer.email}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-dark-400 text-xs">Wallet Balance</p>
                <p className="text-xl font-bold text-white">
                  ₹{ccCustomer.walletBalance.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Tags */}
            <div className="flex gap-2">
              {ccCustomer.blacklisted && (
                <span className="px-2.5 py-1 bg-red-500/20 text-red-400 text-xs font-bold rounded-full">
                  Blacklisted
                </span>
              )}
              {ccCustomer.locked && !ccCustomer.blacklisted && (
                <span className="px-2.5 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold rounded-full">
                  Locked
                </span>
              )}
              {ccCustomer.verified && (
                <span className="px-2.5 py-1 bg-blue-500/20 text-blue-400 text-xs font-bold rounded-full">
                  Verified
                </span>
              )}
              {ccCustomer.influencer && (
                <span className="px-2.5 py-1 bg-yellow-500/20 text-yellow-400 text-xs font-bold rounded-full">
                  Influencer
                </span>
              )}
              {!ccCustomer.locked && !ccCustomer.blacklisted && (
                <span className="px-2.5 py-1 bg-green-500/20 text-green-400 text-xs font-bold rounded-full">
                  Active
                </span>
              )}
            </div>
          </div>

          {/* Account Controls */}
          <div className="bg-dark-800/50 border border-white/10 rounded-2xl p-5">
            <h4 className="text-sm font-bold text-dark-300 uppercase tracking-wider mb-4">
              Account Controls
            </h4>
            <div className="space-y-3">
              {/* Lock Toggle */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Lock className="w-4 h-4 text-dark-400" />
                  <span className="text-white text-sm">Lock Account</span>
                </div>
                <button
                  onClick={handleCcToggleLock}
                  disabled={ccActionLoading || ccCustomer.blacklisted}
                  className={`relative w-11 h-6 rounded-full transition-colors ${ccCustomer.locked ? 'bg-amber-500' : 'bg-dark-600'} ${ccCustomer.blacklisted ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${ccCustomer.locked ? 'translate-x-5' : ''}`}
                  />
                </button>
              </div>

              {/* Blacklist Toggle */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <ShieldBan className="w-4 h-4 text-dark-400" />
                  <span className="text-white text-sm">Blacklist</span>
                </div>
                <button
                  onClick={() => handleCcToggleBlacklist()}
                  disabled={ccActionLoading}
                  className={`relative w-11 h-6 rounded-full transition-colors ${ccCustomer.blacklisted ? 'bg-red-500' : 'bg-dark-600'}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${ccCustomer.blacklisted ? 'translate-x-5' : ''}`}
                  />
                </button>
              </div>

              {/* Verified Toggle */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-4 h-4 text-dark-400" />
                  <span className="text-white text-sm">Verified</span>
                </div>
                <button
                  onClick={handleCcToggleVerified}
                  disabled={ccActionLoading}
                  className={`relative w-11 h-6 rounded-full transition-colors ${ccCustomer.verified ? 'bg-blue-500' : 'bg-dark-600'}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${ccCustomer.verified ? 'translate-x-5' : ''}`}
                  />
                </button>
              </div>

              {/* Influencer Toggle */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Star className="w-4 h-4 text-dark-400" />
                  <span className="text-white text-sm">Influencer</span>
                </div>
                <button
                  onClick={handleCcToggleInfluencer}
                  disabled={ccActionLoading}
                  className={`relative w-11 h-6 rounded-full transition-colors ${ccCustomer.influencer ? 'bg-yellow-500' : 'bg-dark-600'}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${ccCustomer.influencer ? 'translate-x-5' : ''}`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Wallet Adjustment */}
          <div className="bg-dark-800/50 border border-white/10 rounded-2xl p-5">
            <h4 className="text-sm font-bold text-dark-300 uppercase tracking-wider mb-4">
              Wallet Adjustment
            </h4>
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setCcWalletType('credit')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${ccWalletType === 'credit' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-dark-700 text-dark-400'}`}
                >
                  <Plus className="w-4 h-4 inline mr-1" /> Credit
                </button>
                <button
                  onClick={() => setCcWalletType('debit')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${ccWalletType === 'debit' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-dark-700 text-dark-400'}`}
                >
                  <Minus className="w-4 h-4 inline mr-1" /> Debit
                </button>
              </div>
              <input
                type="number"
                placeholder="Amount (₹)"
                value={ccWalletAmount}
                onChange={(e) => setCcWalletAmount(e.target.value)}
                min="1"
                className="w-full bg-dark-800 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-dark-400 focus:outline-none focus:border-primary-500"
              />
              <input
                type="text"
                placeholder="Note (required)"
                value={ccWalletNote}
                onChange={(e) => setCcWalletNote(e.target.value)}
                className="w-full bg-dark-800 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-dark-400 focus:outline-none focus:border-primary-500"
              />
              <button
                onClick={handleCcWalletAdjust}
                disabled={
                  ccActionLoading ||
                  !ccWalletAmount ||
                  !ccWalletNote.trim() ||
                  parseFloat(ccWalletAmount) <= 0
                }
                className={`w-full py-2.5 rounded-xl font-medium text-sm transition-colors ${
                  ccWalletType === 'credit'
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {ccActionLoading
                  ? 'Processing...'
                  : `${ccWalletType === 'credit' ? 'Credit' : 'Debit'} Wallet`}
              </button>
            </div>
          </div>

          {/* Wallet History */}
          {ccHistory.length > 0 && (
            <div className="bg-dark-800/50 border border-white/10 rounded-2xl p-5">
              <h4 className="text-sm font-bold text-dark-300 uppercase tracking-wider mb-4">
                Recent Wallet History
              </h4>
              <div className="space-y-2">
                {ccHistory.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-dark-300 truncate flex-1">{tx.description}</span>
                    <span
                      className={`font-mono font-medium ml-3 ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {tx.amount >= 0 ? '+' : ''}
                      {tx.amount}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Blacklist Reason Dialog */}
      {ccBlacklistDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setCcBlacklistDialog(false)}
          />
          <div className="relative bg-dark-900 border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-2">Blacklist Customer</h3>
            <p className="text-dark-400 text-sm mb-4">
              This will ban {ccCustomer?.displayName} from logging in. Enter a reason:
            </p>
            <input
              type="text"
              placeholder="Reason for blacklisting..."
              value={ccBlacklistReason}
              onChange={(e) => setCcBlacklistReason(e.target.value)}
              className="w-full bg-dark-800 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-dark-400 focus:outline-none focus:border-red-500 mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => setCcBlacklistDialog(false)}
                className="flex-1 py-2.5 bg-dark-700 text-dark-300 rounded-xl font-medium hover:bg-dark-600"
              >
                Cancel
              </button>
              <button
                onClick={() => handleCcToggleBlacklist(ccBlacklistReason)}
                disabled={!ccBlacklistReason.trim()}
                className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 disabled:opacity-50"
              >
                Blacklist
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null
}
```

- [ ] **Step 9: Filter subnav to hide "Customer Controls" for non-Owners**

Where the `subnav` array is passed to `ModulePageLayout`, filter it:

```typescript
    subnav={subnav.filter(
      (item) =>
        item.to !== '/admin/customer-controls' || currentUser?.role === 'Owner',
    )}
```

- [ ] **Step 10: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 11: Test manually**

1. Run `npm run dev`
2. Open pipeline as Owner → Admin → Customer Controls tab should appear
3. Search a known customer phone number
4. Verify: customer info, wallet balance, all 4 toggles, wallet adjustment form
5. Test lock toggle, verified toggle, influencer toggle
6. Test wallet credit with a note
7. Switch to a non-Owner role → Customer Controls tab should not appear
8. Navigate directly to `/admin/customer-controls` as non-Owner → should redirect

- [ ] **Step 12: Commit**

```bash
git add src/pipeline/pages/modules/AdminModule.tsx
git commit -m "feat(customer-controls): add Customer Controls view to AdminModule

- Owner-gated tab with phone lookup, account flag toggles,
  wallet adjustment, and transaction history
- Blacklist opens confirmation dialog requiring reason
- Subnav filtered to hide tab from non-Owner roles"
```

---

## Task 7: Final integration verification

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Cloud Functions syntax check**

Run: `cd functions && node -c api/customer-blacklist.js && node -c index.js && echo "OK"`
Expected: `OK`

- [ ] **Step 4: End-to-end smoke test**

1. Start dev server: `npm run dev`
2. **Owner flow:** Open pipeline as Owner → Admin → Customer Controls → search customer → lock → verify → adjust wallet → unlock
3. **Lock enforcement:** Open customer app as the locked customer → attempt checkout → should see "restricted" message
4. **Non-Owner gate:** Log in as Admin/Cashier → verify no Customer Controls tab visible

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(customer-controls): integration fixes from smoke testing"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-04-20-owner-customer-controls.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
