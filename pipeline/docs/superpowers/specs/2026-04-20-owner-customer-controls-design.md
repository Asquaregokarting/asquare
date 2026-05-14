# Owner-Only Customer Controls

**Date:** 2026-04-20
**Status:** Approved
**Scope:** Pipeline Admin — new "Customer Controls" tab in AdminModule, Owner role only

## Problem

The Owner has no way to manage customer accounts from the pipeline. There are no controls to restrict abusive customers, adjust wallet balances for operational reasons, or tag customers as verified/influencer. All customer data is currently read-only in the pipeline.

## Solution

A dedicated Customer Controls section in the Admin Module, visible only to the Owner role. Provides 6 powers: lock, unlock, edit (wallet adjustment), blacklist, verified, and influencer.

## Data Model

### New fields on `users/{id}` documents

```typescript
// Account restriction flags
locked?: boolean           // Soft restriction — blocks bookings + wallet usage
blacklisted?: boolean      // Hard ban — blocks login via Firebase Auth custom claim

// Customer tags
verified?: boolean         // Identity-verified trust badge
influencer?: boolean       // Kartfluencer tag

// Audit metadata
accountFlags?: {
  lockedAt?: string        // ISO timestamp
  lockedBy?: string        // Owner's userId
  lockedByName?: string
  unlockedAt?: string
  unlockedBy?: string
  unlockedByName?: string
  blacklistedAt?: string
  blacklistedBy?: string
  blacklistedByName?: string
  blacklistReason?: string
  unblacklistedAt?: string
  unblacklistedBy?: string
  unblacklistedByName?: string
}
```

### Flag hierarchy

- **Blacklist supersedes lock.** A blacklisted customer is implicitly locked.
- Unblacklisting does NOT auto-unlock — the Owner decides the lock state separately.
- Verified and influencer are independent tags with no enforcement behavior.

## Enforcement

### Locked customers (client-side)

| Checkpoint                              | Behavior                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `Checkout.tsx` — before `handlePayment` | Check `user.locked`. Block with message: "Your account is restricted. Contact support." |
| `walletService.deductBalance`           | Reject if `locked === true` (same pattern as `walletFrozen`)                            |
| `walletService.addBalance`              | Reject if `locked === true`, UNLESS called with `ownerOverride: true`                   |
| Cart-to-checkout navigation             | Redirect locked users back with a toast                                                 |

### Blacklisted customers (server-side)

| Checkpoint                                  | Behavior                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Firebase Auth custom claim `disabled: true` | Firebase SDK refuses token refresh — forces sign-out                                                               |
| Customer app auth context (`AuthContext`)   | On auth state change, if `disabled` claim present, force sign-out with message: "Your account has been suspended." |
| Pipeline views                              | Red "Blacklisted" badge next to customer name                                                                      |

### Verified / Influencer (display-only)

| Where                      | Display                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| Pipeline booking views     | Blue "Verified" or gold "Influencer" badge next to customer name |
| Pipeline Customer Controls | Toggle switches showing current state                            |
| Customer app               | Not in scope — future enhancement                                |

### Owner wallet adjustment bypasses lock and freeze

The Owner adjusting a locked or frozen customer's wallet must still work. The lock/freeze prevents the _customer_ from using their wallet, not the Owner from managing it. The `ownerOverride` flag on `addBalance`/`deductBalance` bypasses both `locked` and `walletFrozen` checks. This is the only codepath that sets `ownerOverride` — it is never passed from the customer app.

## Cloud Function: `toggleCustomerBlacklist`

### Endpoint

```
POST /toggleCustomerBlacklist
Region: asia-south1
Auth: Firebase ID token (Bearer header)
```

### Request body

```json
{
  "customerId": "string",
  "blacklist": true,
  "reason": "string (required when blacklist=true)"
}
```

### Logic

1. Extract and verify Firebase ID token from Authorization header
2. Read caller's `users/{callerId}.role` — reject unless `Owner`
3. If `blacklist: true`:
   - Set Firebase Auth custom claim `{ disabled: true }` on the customer via Admin SDK
   - Revoke the customer's refresh tokens (forces immediate sign-out)
   - Set `blacklisted: true` + audit metadata on `users/{customerId}`
   - Set `locked: true` (blacklist implies lock)
4. If `blacklist: false`:
   - Remove the `disabled` custom claim
   - Set `blacklisted: false` on user doc
   - Do NOT change `locked` — Owner decides separately

### Why a Cloud Function

Firebase Auth custom claims can only be set via the Admin SDK (server-side). Lock, verified, and influencer are simple Firestore field writes the pipeline client handles directly.

## Wallet Adjustment (Owner "Edit" Power)

### UI flow

1. Owner searches customer by phone in Customer Controls
2. Current wallet balance displayed
3. Owner selects Credit or Debit, enters amount, writes mandatory note
4. Confirmation dialog: "Credit ₹500 to [Name]'s wallet? Note: [reason]"
5. Immediate execution on confirm

### Backend

- **Credit:** `walletService.addBalance(userId, amount, description, idempotencyKey)` with `ownerOverride: true`
  - Idempotency key: `ownerAdjust_{userId}_{timestamp}`
- **Debit:** `walletService.deductBalance(userId, amount, description)` with `ownerOverride: true`
- Transaction type: `owner_credit` or `owner_debit` (distinct from regular credit/debit)
- Description format: `"Owner adjustment: {note} (by {ownerName})"`

### Audit

The wallet transaction log is the audit trail. Each entry records amount, description (with Owner name), and timestamp. No separate approval workflow — Owner's action is final.

## UI Design

### Location

New tab "Customer Controls" in `AdminModule.tsx`. Only rendered when `role === 'Owner'`. Other roles do not see it in navigation.

### Layout

```
+---------------------------------------------------+
|  Customer Controls                       [Owner]   |
+---------------------------------------------------+
|  Search by phone: [_______________] [Search]       |
+---------------------------------------------------+
|  Customer: Ravi Kumar    Phone: 9876543210          |
|  Wallet: Rs.1,200        Status: Active             |
|  Tags: [Verified] [Influencer]                      |
|                                                     |
|  -- Account Controls ----------------------------   |
|  Lock Account        [Toggle]                       |
|  Blacklist           [Toggle]  (requires reason)    |
|  Verified            [Toggle]                       |
|  Influencer          [Toggle]                       |
|                                                     |
|  -- Wallet Adjustment ---------------------------   |
|  Type:    Credit / Debit                            |
|  Amount:  [___________]                             |
|  Note:    [_________________________] (required)    |
|  [Adjust Wallet]                                    |
|                                                     |
|  -- Recent Wallet History -----------------------   |
|  +500   Owner adjustment: Event comp (Shree)       |
|  -200   Booking Payment #ORD-12345                  |
|  +100   Cashback for booking #ORD-12300             |
+---------------------------------------------------+
```

### Interactions

- **Blacklist toggle:** Confirmation dialog with mandatory reason field
- **Lock toggle:** Simple confirmation ("Lock this customer's account?")
- **Verified / Influencer toggles:** Instant with toast confirmation
- **Wallet adjustment:** Confirmation dialog with full details before execution
- All controls disabled while a request is in-flight (prevents double-clicks)

### Customer lookup

Uses the existing `phoneToUid` index to resolve the phone to a userId, then reads the user document. Displays wallet balance from `users/{id}.walletBalance` and wallet history from `users/{id}/wallet_transactions`.

## Files to Create/Modify

### New files

- `functions/api/customer-blacklist.js` — Cloud Function for blacklist toggle
- `src/pipeline/api/customer-controls.ts` — API module for lock/verified/influencer/wallet operations
- Customer Controls UI component (inside AdminModule or as a separate component)

### Modified files

- `src/types/index.ts` — Add flag fields to a shared type or keep on Firestore docs only
- `src/services/walletService.ts` — Add `ownerOverride` param to bypass lock check, add `owner_credit`/`owner_debit` transaction types
- `src/pages/Checkout.tsx` — Add lock check before payment
- `src/contexts/AuthContext.tsx` — Check `disabled` custom claim on auth state change
- `src/pipeline/pages/modules/AdminModule.tsx` — Add Customer Controls tab (Owner only)
- `functions/index.js` — Export new Cloud Function

## Out of Scope

- Customer-app-side badge display for verified/influencer
- Notifications to the customer when flagged
- Bulk operations (lock/blacklist multiple customers at once)
- Lock/blacklist history view beyond the audit metadata fields
