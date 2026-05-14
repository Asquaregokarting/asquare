# A Square GoKarting -- API / Endpoint Test Skill Document

Generated: 2026-03-31

---

## Production Safety

All tests use **fully mocked Firebase** via `src/test/mocks/firebase.ts`. **ZERO network calls, ZERO production data access.** Every Firestore operation (`getDoc`, `setDoc`, `runTransaction`, etc.) is a `vi.fn()` no-op returning fake snapshots.

- Mock registration: `src/test/setup.ts` calls `registerFirebaseMocks()` before any import resolves
- Fake env vars: `VITE_FIREBASE_API_KEY=FAKE_API_KEY_FOR_TESTING`, `VITE_RAZORPAY_KEY_ID=rzp_test_FAKE000000000`, etc.
- Mock data factories: `src/test/test-utils.tsx` exports `createMockUser()`, `createMockActivity()`, `createMockBooking()`, `createMockBookingItem()`, `createMockPipelineSession()`, etc.
- React wrappers: `renderWithProviders()` (Customer App), `renderPipelineWithProviders()` (Pipeline Admin)

---

## Testing Framework

- **Vitest** with `globals: true` (`describe` / `it` / `expect` available without import)
- Firebase mocked via `src/test/mocks/firebase.ts` (exports: `firebaseFirestoreMock`, `createFakeDocSnapshot`, `createFakeQuerySnapshot`)
- Capacitor mocked via `src/test/mocks/capacitor.ts`
- `afterEach` runs `cleanup()`, `vi.restoreAllMocks()`, `localStorage.clear()`, `sessionStorage.clear()`

---

# SECTION 1: Customer App Services

---

## 1. `src/services/bookingService.ts`

**Priority**: P0-CRITICAL
**Exports**:
- `createRazorpayOrder(params)` -- calls Cloud Function, returns Razorpay order ID string
- `submitOrderToAPI(params, billingId, orderNumber)` -- writes booking to Firestore `bookings` collection
- `generateOrderNumber()` -- re-exported from `src/lib/unified-booking.ts`
- `ensureUniqueOrderNumber()` -- re-exported from `src/lib/unified-booking.ts`
- `triggerInteraktBookingConfirmation(orderNumber, forceResend?)` -- calls Cloud Function for WhatsApp/SMS
- `sendPaymentLink(orderNumber, templateName?)` -- calls Cloud Function for payment link
- `bookingService.generateBillingId()` -- returns timestamp+random billing ID string
- `bookingService.createDraftBooking(params, preGeneratedOrderNumber?)` -- writes pending booking to Firestore
- `bookingService.confirmDraftBooking(orderNumber, paymentId, skipApi?, razorpaySignature?)` -- confirms draft, triggers API + Interakt + billing
- `bookingService.createPendingBooking(params)` -- creates pending booking via `createUnifiedBooking`
- `bookingService.createBooking(params, preGeneratedOrderNumber?, skipApi?, isPaid?)` -- full booking flow
- `bookingService.getUserBookings(userId, mobile?, page?, pageLimit?)` -- fetches user bookings from Firestore
- `bookingService.markAsUsed(bookingId)` -- no-op, returns true
- `bookingService.deleteBooking(orderNumber, userId, deletedBy?)` -- soft delete to `deleted_bookings`
- `bookingService.updateBooking(orderNumber, userId, updates)` -- merges updates into Firestore
- `bookingService.resetCheckInStatus(bookings)` -- batch reset check-in to pending
- `bookingService.updateBookingStatus(orderNumber, status, paymentStatus, paymentId?, razorpayOrderId?, razorpaySignature?)` -- updates status in flat + user subcollection
- `bookingService.confirmRazorpayOrder(params)` -- stores payment reference in Firestore
- `bookingService.sendPaymentLink(orderNumber, templateName?)` -- delegates to top-level `sendPaymentLink`
- `bookingService.triggerRescheduleNotification(...)` -- calls Cloud Function
- `bookingService.triggerPaymentFailedNotification(...)` -- calls Cloud Function
- `bookingService.logRescheduleEvent(...)` -- writes to `reschedule_logs` collection
- `bookingService.getUserData(mobile)` -- queries `users` by phone, returns tier + wallet
- `bookingService.getBookingCount(mobile)` -- counts bookings in user subcollection
- `bookingService.getAdminBookings(locationId?)` -- fetches all bookings, optionally filtered

**Test file**: `src/services/__tests__/bookingService.test.ts`

### Test Cases

#### `createRazorpayOrder`
- [ ] **happy path** -- Mock `fetch` to return `{ ok: true, orderId: 'order_abc123' }`. Verify it sends correct JSON body (amount, orderNumber, customerName, customerPhone, customerEmail) and returns the orderId string.
- [ ] **API error** -- Mock `fetch` to return `{ ok: false, message: 'Server error' }`. Verify it throws `APIError` with code `RAZORPAY_ORDER_FAILED`.
- [ ] **network failure** -- Mock `fetch` to reject. Verify it throws.

#### `submitOrderToAPI`
- [ ] **happy path** -- Provide valid `CreateBookingParams`. Mock `firebaseFirestoreMock.setDoc`. Verify it normalizes phone (strips non-digits, takes last 10), maps `locationId` via `BRANCH_MAP`, builds `orderData` with both standard and legacy fields, calls `setDoc` with `{ merge: true }`, and returns object with `status: 'yes'`.
- [ ] **missing mobile** -- Pass params with `mobile: ''`. Verify it throws `ValidationError('Mobile number is required')`.
- [ ] **negative finalAmount** -- Pass `finalAmount: -100`. Verify it throws `ValidationError('Invalid order amount')`.
- [ ] **strips undefined values** -- Include an item with `activity.apiId = undefined`. Verify the `games` array replaces it with `0` via `parseInt(...) || 0` and no Firestore undefined error occurs.

#### `bookingService.generateBillingId()`
- [ ] **format** -- Returns a string matching pattern `YYYYMMDDHHMMSSMMM[A-Z0-9]{4}` (17+ chars, ends with 4 alphanumeric).
- [ ] **uniqueness** -- Call twice in succession; IDs should differ (random suffix).

#### `bookingService.createDraftBooking`
- [ ] **happy path** -- Verify it writes to both `bookings/{orderNumber}` and `users/{userId}/bookings/{orderNumber}` via `setDoc`. Verify `paymentStatus` is `'pending'`, `bookingStatus` is `'pending'`, `qrCode` starts with `ASQUARE-`.
- [ ] **offline user** -- Pass `userId: 'offline_9876543210'`. Verify it skips the user subcollection write (only writes flat `bookings`).
- [ ] **pre-generated order number** -- Pass `preGeneratedOrderNumber: 'ASG260401120000100ABCD'`. Verify that specific ID is used without calling `ensureUniqueOrderNumber`.

#### `bookingService.confirmDraftBooking`
- [ ] **happy path** -- Mock `getDoc` to return a pending booking. Verify it calls `updateBookingStatus`, `submitOrderToAPI`, `triggerInteraktBookingConfirmation`, and `completeBillingOnPayment`.
- [ ] **already confirmed** -- Mock `getDoc` to return booking with `bookingStatus: 'confirmed'`. Verify it returns `true` immediately without calling API.
- [ ] **booking not found** -- Mock `getDoc` to return non-existent doc. Verify it throws `Error('Booking not found')`.
- [ ] **helicopter counter** -- Mock booking with helicopter items. Verify `incrementHelicopterBookingCount` is called with correct seat count.

#### `bookingService.deleteBooking`
- [ ] **happy path** -- Mock `getDoc` to return existing booking. Verify it writes to `deleted_bookings/{orderNumber}` with `deletedAt` and `deletedBy`, deletes from `bookings/{orderNumber}`, and deletes from `users/{userId}/bookings/{orderNumber}`.
- [ ] **confirmed helicopter booking** -- Mock booking with `bookingStatus: 'confirmed'` and helicopter items. Verify `incrementHelicopterBookingCount` is called with negative seat count.
- [ ] **offline user** -- Verify it skips user subcollection delete for `userId` starting with `offline_`.

#### `bookingService.getUserBookings`
- [ ] **merges sources** -- Mock both main user and offline user subcollection queries to return overlapping bookings. Verify deduplication by `id` and sorted by `createdAt` descending.
- [ ] **excludes deleted** -- Mock `deleted_bookings` query to return a set of IDs. Verify those IDs are excluded from results.
- [ ] **empty userId** -- Pass `userId: ''`. Verify it returns `[]` immediately.

### Mocking Strategy

- Mock `fetch` globally for Cloud Function calls (`createRazorpayOrder`, `triggerInteraktBookingConfirmation`, etc.)
- Override `firebaseFirestoreMock.getDoc` to return `createFakeDocSnapshot(bookingData)` for booking lookups
- Override `firebaseFirestoreMock.getDocs` to return `createFakeQuerySnapshot([...])` for user queries
- Mock `auth.currentUser` and `getIdToken()` for authenticated Cloud Function calls
- Mock dynamic import `import('../lib/unified-booking')` for `completeBillingOnPayment`

### Example Test Skeleton

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeDocSnapshot, firebaseFirestoreMock } from '../../test/mocks/firebase'

// Must mock firebase/firestore before importing the module under test
const { bookingService, submitOrderToAPI, createRazorpayOrder } = await import('../bookingService')

describe('createRazorpayOrder', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns orderId on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, orderId: 'order_test123' }),
    })

    const result = await createRazorpayOrder({
      amount: 500,
      orderNumber: 'ASG260401120000100ABCD',
      customerName: 'Test User',
    })

    expect(result).toBe('order_test123')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('createOnlineOrder'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws APIError on failure response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: false, message: 'Amount mismatch' }),
    })

    await expect(createRazorpayOrder({ amount: 500, orderNumber: 'X' }))
      .rejects.toThrow('Amount mismatch')
  })
})

describe('bookingService.generateBillingId', () => {
  it('returns a string of at least 17 characters', () => {
    const id = bookingService.generateBillingId()
    expect(id.length).toBeGreaterThanOrEqual(17)
    expect(/^\d{17}[A-Z0-9]{4}$/.test(id)).toBe(true)
  })
})
```

---

## 2. `src/services/walletService.ts`

**Priority**: P0-CRITICAL
**Exports**:
- `walletService.getBalance(userId)` -- reads `users/{userId}/wallet/data`, returns `balance` number (default 0)
- `walletService.initializeWallet(userId)` -- creates wallet doc with `balance: 0` if missing
- `walletService.deductBalance(userId, amount, description)` -- atomic `runTransaction`: checks balance >= amount, decrements via `increment(-amount)`, logs debit to `wallet_transactions`
- `walletService.addBalance(userId, amount, description?)` -- reads wallet, increments or creates, logs credit to `wallet_transactions`
- `walletService.logTireTransaction(userId, amount, description, type?)` -- writes to `tire_transactions` subcollection
- `walletService.getWalletHistory(userId)` -- queries `wallet_transactions` ordered by timestamp desc, limit 50
- `walletService.getTireHistory(userId)` -- queries `tire_transactions` ordered by timestamp desc, limit 50
- `Transaction` interface (exported type)

**Test file**: `src/services/__tests__/walletService.test.ts`

### Test Cases

#### `getBalance`
- [ ] **wallet exists** -- Mock `getDoc` to return `{ balance: 250 }`. Verify returns `250`.
- [ ] **wallet missing** -- Mock `getDoc` to return non-existent doc. Verify returns `0`.
- [ ] **empty userId** -- Pass `userId: ''`. Verify returns `0` without calling Firestore.
- [ ] **Firestore error** -- Mock `getDoc` to reject. Verify returns `0` (silent catch).
- [ ] **balance field missing** -- Mock `getDoc` to return `{}` (exists but no balance). Verify returns `0` via `|| 0`.

#### `initializeWallet`
- [ ] **new wallet** -- Mock `getDoc` to return non-existent doc. Verify `setDoc` is called with `{ balance: 0, lastUpdated: <serverTimestamp> }`.
- [ ] **existing wallet** -- Mock `getDoc` to return existing doc. Verify `setDoc` is NOT called.

#### `deductBalance` (ATOMIC -- highest criticality)
- [ ] **sufficient balance** -- Mock `runTransaction` so `transaction.get()` returns `{ balance: 500 }`. Call with `amount: 200`. Verify `transaction.update` is called with `increment(-200)`, `transaction.set` logs debit with `type: 'debit', amount: -200`. Verify returns `true`.
- [ ] **insufficient balance** -- Mock transaction to return `{ balance: 50 }`. Call with `amount: 100`. Verify it throws inside transaction (`'Insufficient balance'`), and outer function returns `false`.
- [ ] **wallet not found** -- Mock transaction `get()` to return non-existent doc. Verify it throws `'Wallet not found'`, returns `false`.
- [ ] **zero or negative amount** -- Call with `amount: 0` or `amount: -5`. Verify returns `false` without calling `runTransaction`.
- [ ] **empty userId** -- Verify returns `false` immediately.

#### `addBalance`
- [ ] **existing wallet** -- Mock `getDoc` to return existing wallet. Verify `updateDoc` is called with `increment(amount)`. Verify credit transaction logged with `type: 'credit'`.
- [ ] **new wallet** -- Mock `getDoc` to return non-existent doc. Verify `setDoc` creates wallet with initial `balance: amount`.
- [ ] **zero amount** -- Call with `amount: 0`. Verify returns `false`.
- [ ] **default description** -- Call without description. Verify transaction logged with `description: 'Credit'`.

#### `logTireTransaction`
- [ ] **happy path** -- Verify `setDoc` is called on `tire_transactions/{timestamp}` with correct `type`, `amount`, `description`.
- [ ] **empty userId** -- Verify returns without calling Firestore.

#### `getWalletHistory` / `getTireHistory`
- [ ] **returns mapped transactions** -- Mock `getDocs` to return 3 docs. Verify returns array of `Transaction` objects with `id` from doc.id.
- [ ] **empty userId** -- Verify returns `[]`.
- [ ] **Firestore error** -- Verify returns `[]` on error.

### Mocking Strategy

- Override `firebaseFirestoreMock.runTransaction` per-test to control `transaction.get()` return value
- Override `firebaseFirestoreMock.getDoc` for balance reads
- Spy on `firebaseFirestoreMock.setDoc` to verify transaction logging

### Example Test Skeleton

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeDocSnapshot, firebaseFirestoreMock } from '../../test/mocks/firebase'

const { walletService } = await import('../walletService')

describe('walletService.deductBalance', () => {
  it('deducts when balance is sufficient', async () => {
    const mockTxn = {
      get: vi.fn().mockResolvedValue(createFakeDocSnapshot({ balance: 500 })),
      update: vi.fn(),
      set: vi.fn(),
    }
    firebaseFirestoreMock.runTransaction.mockImplementation((_db, cb) => cb(mockTxn))

    const result = await walletService.deductBalance('user-123', 200, 'Booking payment')

    expect(result).toBe(true)
    expect(mockTxn.update).toHaveBeenCalled()
    expect(mockTxn.set).toHaveBeenCalled() // transaction log
  })

  it('returns false when balance is insufficient', async () => {
    const mockTxn = {
      get: vi.fn().mockResolvedValue(createFakeDocSnapshot({ balance: 50 })),
      update: vi.fn(),
      set: vi.fn(),
    }
    firebaseFirestoreMock.runTransaction.mockImplementation((_db, cb) => cb(mockTxn))

    const result = await walletService.deductBalance('user-123', 100, 'Payment')

    expect(result).toBe(false)
    expect(mockTxn.update).not.toHaveBeenCalled()
  })
})
```

---

## 3. `src/services/couponService.ts`

**Priority**: P0-CRITICAL
**Exports**:
- `couponService.fetchCoupons()` -- reads `coupons` collection, filters by `isActive` and not expired, returns `Coupon[]`
- `couponService.generateUserCoupon(userId, prize)` -- checks `getUserCouponsEnabled()`, generates code with prefix (`DISC`/`GO`/`RWD`), writes to `users/{userId}/coupons`
- `couponService.markCouponAsUsed(userId, couponCode)` -- sets `isUsed: true` on user coupon, increments `usedCount` on global coupon
- `getUserCouponsEnabled()` -- reads `settings/coupons`, returns boolean
- `setUserCouponsEnabled(enabled)` -- writes to `settings/coupons`
- `getRecentUserCoupons(limitCount?)` -- collectionGroup query on `coupons` subcollection
- `searchUserCoupons(term)` -- searches by coupon code prefix and user phone
- `deleteUserCoupon(userId, couponDocId)` -- deletes single coupon doc
- `deleteAllUserCoupons(userId)` -- deletes all coupons for a user
- `Coupon` interface, `UserCouponRow` interface

**Test file**: `src/services/__tests__/couponService.test.ts`

### Test Cases

#### `fetchCoupons`
- [ ] **returns active, non-expired coupons** -- Mock `getDocs` to return 3 docs: one active+unexpired, one active+expired, one inactive. Verify only the first is returned. Verify fields are correctly coerced (`Number(data.minAmount) || 0`, booleans via `=== true`).
- [ ] **empty collection** -- Mock `getDocs` to return empty. Verify returns `[]`.
- [ ] **Firestore error** -- Mock `getDocs` to reject. Verify returns `[]`.
- [ ] **coupon without expiryDate** -- Verify it passes the not-expired check (`!c.expiryDate` is truthy).

#### `generateUserCoupon`
- [ ] **happy path -- discount type** -- Prize `type: 'discount', value: 50`. Verify code starts with `DISC50OFF` followed by 4 random digits. Verify `addDoc` is called with correct `couponData`.
- [ ] **happy path -- session type** -- Prize `type: 'session'`. Verify code starts with `GO`.
- [ ] **coupons disabled** -- Mock `getUserCouponsEnabled()` to return `false`. Verify returns `null` without writing to Firestore.
- [ ] **empty userId** -- Verify throws `Error('User ID required')`.
- [ ] **expiry calculation** -- Prize `expiresInDays: 7`. Verify `expiryDate` is 7 days from now (ISO string).

#### `markCouponAsUsed`
- [ ] **happy path** -- Mock user coupons query to return one matching code. Verify `setDoc` called with `{ isUsed: true }` on user coupon. Mock global coupons query to return matching doc with `usedCount: 3`. Verify `updateDoc` increments to `4`.
- [ ] **no matching global coupon** -- Mock global query to return empty. Verify no `updateDoc` call (graceful skip).

#### `getUserCouponsEnabled`
- [ ] **setting exists, enabled** -- Mock `getDoc` to return `{ userCouponsEnabled: true }`. Verify returns `true`.
- [ ] **setting exists, disabled** -- Mock `getDoc` to return `{ userCouponsEnabled: false }`. Verify returns `false`.
- [ ] **setting missing** -- Mock `getDoc` non-existent. Verify returns `true` (default enabled).

#### `searchUserCoupons`
- [ ] **searches by code prefix** -- Term `'DISC50'`. Verify `collectionGroup` query uses `where('code', '>=', 'DISC50')`.
- [ ] **searches by phone** -- Term is a phone number. Verify it queries `users` by phone, then fetches their coupons subcollection.
- [ ] **deduplicates results** -- Return overlapping docs from code and phone searches. Verify unique by `id`.
- [ ] **empty term** -- Verify returns `[]` immediately.

### Mocking Strategy

- Override `firebaseFirestoreMock.getDocs` to return `createFakeQuerySnapshot([...couponDocs])`
- Override `firebaseFirestoreMock.getDoc` for settings doc
- Spy on `firebaseFirestoreMock.addDoc` for `generateUserCoupon`
- Spy on `firebaseFirestoreMock.setDoc` and `firebaseFirestoreMock.updateDoc` for `markCouponAsUsed`

### Example Test Skeleton

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createFakeQuerySnapshot, firebaseFirestoreMock } from '../../test/mocks/firebase'

const { couponService } = await import('../couponService')

describe('couponService.fetchCoupons', () => {
  it('filters out expired and inactive coupons', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString()
    const tomorrow = new Date(Date.now() + 86400000).toISOString()

    firebaseFirestoreMock.getDocs.mockResolvedValueOnce(
      createFakeQuerySnapshot([
        { code: 'ACTIVE1', discount: 10, isActive: true, expiryDate: tomorrow, description: 'Valid' },
        { code: 'EXPIRED', discount: 20, isActive: true, expiryDate: yesterday, description: 'Expired' },
        { code: 'INACTIVE', discount: 30, isActive: false, description: 'Inactive' },
      ])
    )

    const result = await couponService.fetchCoupons()

    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('ACTIVE1')
  })
})
```

---

## 4. `src/services/razorpayService.ts`

**Priority**: P1-HIGH
**Exports**:
- `loadRazorpaySDK()` -- dynamically injects `<script>` for Razorpay checkout.js, returns Promise<void>
- `razorpayService.initiatePayment(options: RazorpayPaymentOptions)` -- opens Razorpay checkout modal, returns `Promise<RazorpayResponse>` on success, rejects with `PaymentError` on failure/dismiss
- `razorpayService.isLoaded()` -- returns `boolean` checking `window.Razorpay`
- `RazorpayPaymentOptions` interface
- `RazorpayResponse` interface

**Test file**: `src/services/__tests__/razorpayService.test.ts`

### Test Cases

#### `loadRazorpaySDK`
- [ ] **already loaded** -- Set `window.Razorpay = vi.fn()`. Verify resolves immediately without creating a script tag.
- [ ] **loads script** -- Unset `window.Razorpay`. Verify a `<script>` element is appended to `document.head` with `src` containing `checkout.razorpay.com`.
- [ ] **script error** -- Simulate `onerror` event. Verify rejects with `PaymentError('Failed to load Razorpay SDK...')`.
- [ ] **deduplicates loading** -- Call twice before first resolves. Verify only one script tag is created (singleton promise).

#### `razorpayService.initiatePayment`
- [ ] **successful payment** -- Mock `window.Razorpay` constructor to capture `handler` callback. Invoke handler with `{ razorpay_payment_id: 'pay_123' }`. Verify promise resolves with that response.
- [ ] **payment failed** -- Mock `window.Razorpay` to capture `on('payment.failed')` callback. Invoke with error response. Verify rejects with `PaymentError`. Verify `bookingService.triggerPaymentFailedNotification` is called if `orderNumber` is provided.
- [ ] **user dismisses** -- Mock `window.Razorpay` to capture `modal.ondismiss`. Invoke it. Verify rejects with `PaymentError('Payment cancelled by user')`.
- [ ] **SDK not loaded** -- Set `window.Razorpay = undefined`. Verify rejects with `PaymentError('Razorpay SDK not loaded...')`.
- [ ] **options mapping** -- Verify `amount` is passed through as-is (paise), `currency` is `'INR'`, `key` is from env var, `prefill` maps `name/email/phone`.

#### `razorpayService.isLoaded`
- [ ] **loaded** -- Set `window.Razorpay`. Verify returns `true`.
- [ ] **not loaded** -- Unset `window.Razorpay`. Verify returns `false`.

### Mocking Strategy

- `vi.stubGlobal('Razorpay', mockRazorpayClass)` per test
- Mock `loadRazorpaySDK` via script tag simulation (override `document.createElement`)
- Mock `bookingService.triggerPaymentFailedNotification` to spy on payment failure notifications

---

## 5. `src/services/activityService.ts`

**Priority**: P2-MEDIUM
**Exports**:
- `getGameTypes(locationId)` -- fetches activity hierarchy, filters by status/platform, sorts by custom order, injects helicopter if missing
- `getGames(locationId, gameTypeId?)` -- fetches and merges Firestore activities + pipeline hierarchy, groups gokarting by type (adult/child/double), caches for 5 min
- `getGameById(locationId, activityId)` -- finds single game from `getGames` result
- `getHelicopterAvailableDates(locationId)` -- extracts available dates from helicopter activities
- `Category` interface

- [ ] **getGameTypes -- filters inactive games** -- Mock hierarchy with active and inactive games. Verify only active returned.
- [ ] **getGameTypes -- excludes blacklisted names** -- Include "dayout", "rock climbing" in mock data. Verify excluded via `EXCLUDED_TERMS`.
- [ ] **getGameTypes -- sorts by CATEGORY_SORT_ORDER** -- Verify gokarting before helicopter before paintball.
- [ ] **getGameTypes -- injects helicopter for locations 0,1,2,3** -- Mock hierarchy without helicopter. Verify it's prepended.
- [ ] **getGames -- groups gokarting by adult/child/double** -- Mock subGames with "child 200cc", "double kart", "adult". Verify 3 separate Activity entries.
- [ ] **getGames -- caches for 5 minutes** -- Call twice within 5 min. Verify second call uses cache (no Firestore call).
- [ ] **getGames -- filters by schedule date range** -- Mock activity with `schedule[].startDate/endDate`. Verify filtering by today.
- [ ] **getHelicopterAvailableDates -- returns future dates only** -- Mock helicopter with past and future dates. Verify only future dates returned.
- [ ] **getGameById -- returns null for unknown ID** -- Verify returns `null`.

---

## 6. `src/services/waitingListService.ts`

**Priority**: P3-LOW
**Exports**: `subscribeAllWaitingLists`, `subscribeWaitingList`, `getCurrentServing`, `getSlotCounts`, `getAllWaitingLists`, `KART_TYPES`, `WaitingSlot`, `WaitingListResponse`

- [ ] **getCurrentServing** -- returns first occupied slot `srno`
- [ ] **getCurrentServing** -- returns `null` when no occupied slots
- [ ] **getSlotCounts** -- returns correct counts for occupied/done/available
- [ ] **getAllWaitingLists** -- returns array with 3 entries (adult, child, double), all data `null`

---

# SECTION 2: Customer App Utilities

---

## 7. `src/lib/utils.ts`

**Priority**: P3 (pure functions, quick wins)
**Exports**: `getLocalISODate`, `formatCurrency`, `vibrate`, `formatDate`, `formatDateLong`, `formatTime`, `getCountdown`, `isPeakHours`, `calculateComboDiscount`, `setWithExpiry`, `getWithExpiry`, `getLocationName`

**Test file**: `src/lib/__tests__/utils.test.ts`

- [ ] **formatCurrency(1500)** -- returns `'INR 1,500'` (Indian locale, no decimals)
- [ ] **formatCurrency(0)** -- returns `'INR 0'`
- [ ] **formatTime('14:30')** -- returns `'2:30 PM'`
- [ ] **formatTime('00:00')** -- returns `'12:00 AM'`
- [ ] **formatTime('invalid')** -- returns `'invalid'` unchanged
- [ ] **formatTime('')** -- returns `''` unchanged
- [ ] **isPeakHours(Saturday, '10:00')** -- returns `true` (weekend)
- [ ] **isPeakHours(Monday, '18:00')** -- returns `true` (weekday 4-10PM)
- [ ] **isPeakHours(Monday, '14:00')** -- returns `false` (weekday off-peak)
- [ ] **calculateComboDiscount(1)** -- returns `0`
- [ ] **calculateComboDiscount(2)** -- returns `5`
- [ ] **calculateComboDiscount(3)** -- returns `10`
- [ ] **calculateComboDiscount(5)** -- returns `20`
- [ ] **setWithExpiry + getWithExpiry -- valid** -- Set key with 10s TTL. Get immediately. Verify returns stored value.
- [ ] **getWithExpiry -- expired** -- Set key with 0ms TTL. Get after mock time advance. Verify returns `null` and `localStorage.removeItem` called.
- [ ] **getWithExpiry -- missing key** -- Verify returns `null`.
- [ ] **getWithExpiry -- corrupted JSON** -- Set raw invalid JSON in localStorage. Verify returns `null`.
- [ ] **getCountdown -- invalid date** -- Pass `new Date('invalid')`. Verify returns all zeros.
- [ ] **getCountdown -- future date** -- Verify positive days/hours/minutes/seconds.
- [ ] **getCountdown -- past date** -- Verify all zeros (clamped with `Math.max(0, ...)`).
- [ ] **vibrate** -- Verify `navigator.vibrate` called with given pattern.

---

## 8. `src/lib/date-format.ts`

**Priority**: P3 (pure functions)
**Exports**: `fmtDateTimeFullIST`, `fmtDateIST`, `fmtTimeFullIST`, `fmtTimeShortIST`, `fmtDateLongIST`, `todayISTStr`

**Test file**: `src/lib/__tests__/date-format.test.ts`

- [ ] **fmtDateIST(new Date('2026-03-28T00:00:00Z'))** -- returns `'28/03/2026'`
- [ ] **fmtDateIST(null)** -- returns `'-'`
- [ ] **fmtDateIST('invalid')** -- returns `'-'`
- [ ] **fmtTimeShortIST(new Date('2026-03-28T00:00:00Z'))** -- returns `'05:30 AM'` (UTC midnight = IST 5:30 AM)
- [ ] **fmtDateLongIST(null)** -- returns `'Select Date'`
- [ ] **fmtDateLongIST('invalid')** -- returns `'Invalid Date'`
- [ ] **fmtDateLongIST('2026-03-28')** -- returns string containing `'Saturday'`, `'28'`, `'Mar'`
- [ ] **todayISTStr()** -- returns string matching `YYYY-MM-DD` format
- [ ] **Firestore Timestamp input** -- Pass `{ toDate: () => new Date('2026-01-15T12:00:00Z') }`. Verify formats correctly.

---

## 9. `src/lib/locations.ts`

**Priority**: P3 (data lookup)
**Exports**: `getAllLocations`, `getEnabledLocations`, `getLocationBySlug`, `getLocationByBranchId`, `resolveLocation`, `slugToBranchId`, `branchIdToSlug`, `normalizeLocationId`, `normalizeStoredLocation`, `getSlugToBranchIdMap`, `getBranchIdToSlugMap`, `fetchLocationsFromFirestore`

**Test file**: `src/lib/__tests__/locations.test.ts`

- [ ] **getAllLocations** -- returns 3 fallback locations (visakhapatnam, kakinada, rajahmundry)
- [ ] **getLocationBySlug('vizag')** -- resolves via `LEGACY_ALIASES` to visakhapatnam entry
- [ ] **getLocationByBranchId('0')** -- returns visakhapatnam
- [ ] **resolveLocation('Kakinada')** -- resolves via display name (case-insensitive)
- [ ] **slugToBranchId('kakinada')** -- returns `'1'`
- [ ] **branchIdToSlug('2')** -- returns `'rajahmundry'`
- [ ] **normalizeLocationId('Vizag')** -- returns `'visakhapatnam'`
- [ ] **normalizeLocationId('unknown')** -- returns `'unknown'` unchanged
- [ ] **normalizeStoredLocation** -- reads from localStorage, normalizes, writes back if changed

---

## 10. `src/lib/unified-booking.ts`

**Priority**: P1-HIGH
**Exports**:
- `generateOrderNumber()` -- generates `ASG{YY}{MM}{DD}{HH}{mm}{SS}{CNT}{RAND}` format
- `ensureUniqueOrderNumber()` -- retries up to 5 times if order exists in Firestore
- `isValidOrderNumber(id)` -- regex validation for ASG format
- `isValidStatusTransition(from, to)` -- validates booking status transitions
- `canConfirmBooking(paymentStatus, paymentMethod?, finalAmount?)` -- checks if booking can be confirmed
- `computeGst(totalAmount, gstPercent?)` -- extracts base + GST from total (inclusive)
- `computeRevenueSplit(baseAmount, gstAmount, sharePercent, vendorType?)` -- ThirdParty vs SubLease split
- `createUnifiedBooking(params)` -- the master booking creation function
- `completeBillingOnPayment(orderNumber)` -- finalizes billing on payment completion

**Test file**: `src/lib/__tests__/unified-booking.test.ts`

### Test Cases

#### `generateOrderNumber`
- [ ] **format** -- Verify matches regex `/^ASG\d{12}\d{3}[A-Z0-9]{4}$/` (ASG + 12-digit timestamp + 3-digit counter + 4-char random).
- [ ] **counter increments** -- Call twice. Verify counter portion increments (from localStorage).
- [ ] **counter wraps** -- Set localStorage counter to `999`. Call. Verify counter resets to `100`.

#### `isValidOrderNumber`
- [ ] **valid** -- `'ASG260401120000100ABCD'` returns `true`.
- [ ] **invalid prefix** -- `'XYZ260401120000100ABCD'` returns `false`.
- [ ] **too short** -- `'ASG123'` returns `false`.

#### `ensureUniqueOrderNumber`
- [ ] **first attempt unique** -- Mock `getDoc` to return non-existent doc. Verify returns order number after 1 attempt.
- [ ] **collision then unique** -- Mock `getDoc` to return existent on first call, non-existent on second. Verify retries.
- [ ] **all collisions** -- Mock `getDoc` to always return existent. Verify returns after 5 attempts (returns the last generated number).

#### `isValidStatusTransition`
- [ ] **pending to confirmed** -- returns `true`
- [ ] **pending to completed** -- returns `false`
- [ ] **confirmed to cancelled** -- returns `true`
- [ ] **completed to confirmed** -- returns `false`
- [ ] **same status** -- `('pending', 'pending')` returns `true`
- [ ] **cancelled to confirmed** -- returns `true` (admin reactivation)

#### `canConfirmBooking`
- [ ] **payment completed** -- returns `true` regardless of method
- [ ] **cash payment** -- `paymentStatus: 'pending', paymentMethod: 'cash'` returns `true`
- [ ] **zero amount** -- `paymentStatus: 'pending', finalAmount: 0` returns `true`
- [ ] **pending non-cash** -- `paymentStatus: 'pending', paymentMethod: 'razorpay'` returns `false`

#### `computeGst`
- [ ] **standard 18%** -- `computeGst(1180)` returns `{ baseAmount: 1000, gstAmount: 180, gstPercent: 18 }`.
- [ ] **zero amount** -- `computeGst(0)` returns `{ baseAmount: 0, gstAmount: 0, gstPercent: 18 }`.
- [ ] **rounding** -- `computeGst(100)` returns `baseAmount: 85`, `gstAmount: 15` (rounded correctly).

#### `computeRevenueSplit`
- [ ] **ThirdParty 80%** -- `computeRevenueSplit(1000, 180, 80, 'ThirdParty')`. Vendor gets 80% of base (800) + 80% of GST (144) = 944. Company gets 200 + 36 = 236.
- [ ] **SubLease 80%** -- `computeRevenueSplit(1000, 180, 80, 'SubLease')`. Vendor gets 80% of base (800) + 0 GST = 800. Company gets 200 + 180 (all GST) = 380.
- [ ] **0% share** -- Verify vendor gets 0, company gets everything.
- [ ] **100% share** -- Verify vendor gets everything.

### Mocking Strategy

- Override `firebaseFirestoreMock.getDoc` for `ensureUniqueOrderNumber` collision detection
- `computeGst` and `computeRevenueSplit` are pure functions -- no mocks needed

### Example Test Skeleton

```typescript
import { describe, it, expect } from 'vitest'

const { computeGst, computeRevenueSplit, isValidStatusTransition } = await import('../unified-booking')

describe('computeGst', () => {
  it('extracts base and GST from inclusive total at 18%', () => {
    const result = computeGst(1180)
    expect(result.baseAmount).toBe(1000)
    expect(result.gstAmount).toBe(180)
    expect(result.gstPercent).toBe(18)
  })
})

describe('computeRevenueSplit', () => {
  it('splits proportionally for ThirdParty', () => {
    const result = computeRevenueSplit(1000, 180, 80, 'ThirdParty')
    expect(result.vendorBase).toBe(800)
    expect(result.vendorGst).toBe(144)
    expect(result.vendorTotal).toBe(944)
    expect(result.companyBase).toBe(200)
    expect(result.companyGst).toBe(36)
    expect(result.companyTotal).toBe(236)
  })

  it('gives company all GST for SubLease', () => {
    const result = computeRevenueSplit(1000, 180, 80, 'SubLease')
    expect(result.vendorGst).toBe(0)
    expect(result.companyGst).toBe(180)
  })
})
```

---

## 11. `src/lib/storage.ts` -- Basic coverage

**Priority**: P3
**Exports**: `storage.get(key)`, `storage.set(key, value)`, `storage.remove(key)`, `storage.clear()`

- [ ] **get -- web platform** -- returns `localStorage.getItem(key)` (Capacitor mocked as web)
- [ ] **set -- web platform** -- calls `localStorage.setItem(key, value)`
- [ ] **remove -- web platform** -- calls `localStorage.removeItem(key)`
- [ ] **clear -- web platform** -- calls `localStorage.clear()`

---

## 12. `src/lib/platform.ts` -- Basic coverage

**Priority**: P3
**Exports**: `getCurrentPlatform()`, `isPlatformAvailable(platforms?)`, `ALL_PLATFORMS`, `AppPlatform`

- [ ] **getCurrentPlatform** -- returns `'web'` in test environment (Capacitor mocked as web)
- [ ] **isPlatformAvailable(undefined)** -- returns `true` (no restriction)
- [ ] **isPlatformAvailable([])** -- returns `true` (empty = all platforms)
- [ ] **isPlatformAvailable(['android'])** -- returns `false` (current is web)
- [ ] **isPlatformAvailable(['web', 'android'])** -- returns `true`

---

## 13. `src/lib/gamificationConfig.ts` -- Basic coverage

**Priority**: P3
**Exports**: `defaultGamificationConfig`, `normalizeGamificationConfig(value)`, `getGamificationConfig()`, `saveGamificationConfig(config)`, `sanitizeTasks` (internal)

- [ ] **normalizeGamificationConfig(null)** -- returns `defaultGamificationConfig`
- [ ] **normalizeGamificationConfig with valid tasks** -- preserves task fields
- [ ] **normalizeGamificationConfig with invalid tasks** -- filters out tasks with empty name
- [ ] **always includes social_follow task** -- even if missing from input
- [ ] **social_follow task reward is forced to 10** -- regardless of input value

---

## 14. `src/lib/checkInConfig.ts` -- Basic coverage

**Priority**: P3
**Exports**: `DEFAULT_CHECKIN_CONFIG`, `getCheckInConfig()`, `saveCheckInConfig(config)`, `getCheckedInCounts(dateKey, locationId?)`, `getCheckedInPassengers(dateKey, timeSlot, locationId?)`, `updateBookingTimeSlot(bookingId, newDateKey, newTimeSlot)`, `getEffectiveSlotStatus(config, dateKey, timeSlot, locationId?)`, `getEffectiveSlotCapacity(config, dateKey, timeSlot, locationId?)`

- [ ] **getEffectiveSlotStatus -- location override** -- Config has `locationSlotStatuses['vizag']['2026-04-01']['09:00 AM'] = 'blocked'`. Returns `'blocked'`.
- [ ] **getEffectiveSlotStatus -- global override** -- Returns global status when no location override.
- [ ] **getEffectiveSlotStatus -- default** -- Returns `'available'` when no overrides.
- [ ] **getEffectiveSlotCapacity -- returns default** -- Returns `config.slotCapacity` when no overrides.
- [ ] **DEFAULT_CHECKIN_CONFIG** -- has 6 fields, `slotCapacity: 45`, `allowGuestCheckIn: true`

---

# SECTION 3: Pipeline API Modules

---

## 15. `src/pipeline/features/track/scanner/services/scannerApi.ts`

**Priority**: P1-HIGH
**Exports**:
- `lookupBill(billingId)` -- 5 lookup strategies: direct doc, invoiceNumber query, orderNumber query, qrCode query, ASQUARE-{ORDER}-{SUFFIX} extraction. Returns `BillLookupResult` with normalized serials.
- `verifySerials(bookingId, selectedIds, userName, context)` -- atomic transaction marking selected serials as `"completed"`
- `startRide(bookingId, serialId, kartNumber, userName)` -- atomic transaction marking serial as `"riding"` with kartNumber
- `markRideDone(bookingId, serialId, userName)` -- atomic transaction marking serial as `"completed"`

**Test file**: `src/pipeline/features/track/scanner/services/__tests__/scannerApi.test.ts`

### Test Cases

#### `lookupBill`
- [ ] **direct document lookup** -- Mock `getDoc` to return booking data with `paymentStatus: 'completed'`, `bookingStatus: 'confirmed'`. Verify returns `BillLookupResult` with correct `billingId`, `customerName`, `serials`.
- [ ] **invoiceNumber fallback** -- Direct lookup returns empty. Mock `getDocs` (invoiceNumber query) to return match. Verify finds booking.
- [ ] **orderNumber fallback** -- Both previous fail. Mock orderNumber query to find it.
- [ ] **qrCode fallback** -- All previous fail. Mock qrCode query with original `billingId`. Verify finds booking.
- [ ] **ASQUARE- QR extraction** -- Input `'ASQUARE-ORDER123-ABCD'`. Verify it extracts `'ORDER123'` and does a direct lookup.
- [ ] **not found** -- All strategies fail. Verify throws `Error('Invalid or not found in system.')`.
- [ ] **payment not completed** -- Booking found but `paymentStatus: 'pending'`. Verify throws error mentioning payment status.
- [ ] **booking not confirmed** -- `bookingStatus: 'cancelled'`. Verify throws error.
- [ ] **future session date** -- `sessionDate` is tomorrow. Verify throws `'This ticket is scheduled for...'`.
- [ ] **serial normalization** -- Booking has `items` with `serialStart: 5`, `quantity: 3`. Verify generates serials `S-005`, `S-006`, `S-007` with `status: 'pending'` and `verifiable: true` for Go-Karting items.
- [ ] **merge with stored serials** -- Booking has `serials[{ serialId: 'S-005', status: 'completed' }]`. Verify merged serial has `status: 'completed'`.
- [ ] **non-GoKarting items** -- Item named `'Paintball 100 Bullets'`. Verify `verifiable: false`.
- [ ] **QR with checksum** -- Input `'INV-123|GK:001,002|CHK:xxxx'`. Verify parseQrValue extracts invoiceNumber and gkSerials. Verify checksum validation.
- [ ] **QR with bad checksum** -- Verify throws `'QR code checksum validation failed...'`.

#### `verifySerials`
- [ ] **happy path** -- Selected `['S-005', 'S-006']`. Verify transaction updates serials to `status: 'completed'`, sets `verifiedAt` and `verifiedBy`.
- [ ] **already completed serial** -- Serial `S-005` has `status: 'completed'` in stored data. Verify throws `'Serial S-005 has already been verified.'`.
- [ ] **non-GoKarting serial** -- Select a serial for `'Paintball'`. Verify throws `'"Paintball 100 Bullets" is not a Go-Karting activity...'`.
- [ ] **booking not found** -- Verify throws `'Booking {id} not found.'`.
- [ ] **payment not completed** -- Verify throws `'Cannot verify: payment is not completed.'`.

#### `startRide`
- [ ] **happy path** -- Serial is `'pending'`. Verify updates to `status: 'riding'`, sets `kartNumber` and `rideStartedAt`.
- [ ] **already riding** -- Verify throws `'This serial is already riding.'`.
- [ ] **already completed** -- Verify throws `'This serial is already completed.'`.

#### `markRideDone`
- [ ] **happy path** -- Serial is `'riding'`. Verify updates to `status: 'completed'`, sets `verifiedAt`.

### Mocking Strategy

- Override `firebaseFirestoreMock.getDoc` for direct lookups
- Override `firebaseFirestoreMock.getDocs` for query-based lookups
- Override `firebaseFirestoreMock.runTransaction` for verify/startRide/markRideDone
- Mock `ensureFirebaseAuthForStorage` and `initializeFirestore` from pipeline lib

### Example Test Skeleton

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createFakeDocSnapshot, createFakeQuerySnapshot, firebaseFirestoreMock } from '../../../../../test/mocks/firebase'

// Mock the pipeline firebase module
vi.mock('../../../../lib/firebase', () => ({
  initializeFirestore: vi.fn(() => ({})),
}))
vi.mock('../../../../lib/firebase-auth', () => ({
  ensureFirebaseAuthForStorage: vi.fn(),
}))

const { lookupBill } = await import('../scannerApi')

describe('lookupBill', () => {
  it('finds booking by direct document lookup', async () => {
    firebaseFirestoreMock.getDoc.mockResolvedValueOnce(
      createFakeDocSnapshot({
        paymentStatus: 'completed',
        bookingStatus: 'confirmed',
        userDisplayName: 'John',
        userPhone: '9876543210',
        finalAmount: 1200,
        items: [
          { activity: { name: 'Gokarting Adult' }, quantity: 2, price: 600 },
        ],
        billingItems: [{ serialStart: 10, itemName: 'Gokarting Adult', quantity: 2 }],
        serials: [],
      }, 'ORDER-001')
    )

    const result = await lookupBill('ORDER-001')

    expect(result.billingId).toBe('ORDER-001')
    expect(result.customerName).toBe('John')
    expect(result.serials).toHaveLength(2)
    expect(result.serials[0].serialId).toBe('S-010')
  })
})
```

---

## 16. `src/pipeline/api/serial-counters.ts`

**Priority**: P1-HIGH
**Exports**:
- `reserveSerials(locationId, date, item, count, category?)` -- atomic transaction on `serialCounters/{locationId}_{date}_{category}`. Returns `startSerial` (lastSerial + 1).
- `reserveSerialsForItems(locationId, date, items, documentId?)` -- groups items by category, calls `reserveSerials` per group, distributes serial starts, writes ledger entries. Returns `number[]` aligned with input items.

**Test file**: `src/pipeline/api/__tests__/serial-counters.test.ts`

### Test Cases

#### `reserveSerials`
- [ ] **new counter** -- Counter doc doesn't exist. Request `count: 3`. Verify returns `1` and sets `lastSerial: 3`.
- [ ] **existing counter** -- Counter doc has `lastSerial: 5`. Request `count: 2`. Verify returns `6` and sets `lastSerial: 7`.
- [ ] **category extraction** -- Item name `'Gokarting -- Adult -- Adult 8 Laps'`. Verify category resolved to `'adult'`.
- [ ] **explicit category** -- Pass `category: 'double'` explicitly. Verify uses it instead of extracting.

#### `reserveSerialsForItems`
- [ ] **multiple categories** -- Items: `['Gokarting -- Adult -- 8 Laps' x2, 'Gokarting -- Child -- 5 Laps' x1]`. Verify two separate `reserveSerials` calls (adult batch, child batch). Verify serialStarts array aligns with input order.
- [ ] **same category grouped** -- Two adult items (qty 2 + qty 3 = 5 total). Verify single `reserveSerials(count=5)`. First item gets `start`, second gets `start+2`.
- [ ] **ledger entries** -- Pass `documentId: 'INV-001'`. Verify `addDoc` called for each item with `serialStart`, `serialEnd`, `quantity`, `documentId`.
- [ ] **ledger failure non-critical** -- Mock `addDoc` to throw. Verify function still returns serial starts (does not throw).

#### `extractSerialCategory` (internal, tested via integration)
- [ ] **3-part name** -- `'Gokarting -- Adult -- Adult 8 Laps'` produces `'adult'`
- [ ] **4-part combo** -- `'ComboName -- Gokarting -- Double -- Double Kart'` produces `'double'` (uses parts[2])
- [ ] **1-part name** -- `'Paintball'` produces `'default'`

### Mocking Strategy

- Override `firebaseFirestoreMock.runTransaction` to simulate counter reads/writes
- Override `firebaseFirestoreMock.addDoc` for ledger writes
- Mock `initializeFirestore` from pipeline firebase lib

---

## 17. `src/pipeline/api/billing-firestore.ts`

**Priority**: P1-HIGH
**Exports**:
- `computeRevenueSplit(baseAmount, gstAmount, vendorSharePercent, vendorType?)` -- pure function, ThirdParty vs SubLease
- `mapTransactionRecord(id, data)` -- maps raw Firestore data to `TransactionRecord` type, supports old and new field names
- `generateInvoiceNumber()` -- returns `INV-{IST timestamp}-{RAND}`
- `GST_PERCENT_DEFAULT` (18), `VENDOR_SHARE_PERCENT_DEFAULT` (80)
- CRUD functions: `listFirestoreBillingTransactions`, `getFirestoreBillingTransactionById`, `getFirestoreBillingInvoice`, `queryTransactionsByPhone`, `cancelFirestoreBillingTransaction`, `refundFirestoreBillingTransaction`, `rescheduleFirestoreBillingTransaction`, `updateFirestoreTransactionPaymentStatus`, `creditCustomerWallet`, `refundSelectedItems`
- Helicopter: `createFirestoreHelicopterActivity`, `listFirestoreHelicopterActivities`, `createFirestoreHelicopterPayment`, `listFirestoreHelicopterPayments`, `updateFirestoreHelicopterActivity`

**Test file**: `src/pipeline/api/__tests__/billing-firestore.test.ts`

### Test Cases

#### `computeRevenueSplit` (pure function)
- [ ] **ThirdParty 80/20** -- `computeRevenueSplit(1000, 180, 80, 'ThirdParty')`. vendorBase=800, vendorGst=144, vendorTotal=944. companyBase=200, companyGst=36, companyTotal=236.
- [ ] **SubLease 80/20** -- Company keeps ALL GST. vendorBase=800, vendorGst=0, vendorTotal=800. companyBase=200, companyGst=180, companyTotal=380.
- [ ] **50/50 split** -- Both sides get half of base and GST.
- [ ] **0% vendor share** -- Vendor gets 0 across the board.
- [ ] **100% vendor share ThirdParty** -- Vendor gets all base + all GST.
- [ ] **rounding consistency** -- vendorBase + companyBase must equal baseAmount. vendorGst + companyGst must equal gstAmount.

#### `mapTransactionRecord`
- [ ] **new field names** -- Data has `vendorTotal`, `companyTotal`. Maps correctly.
- [ ] **legacy field names** -- Data has `vendorAmount`, `companyAmount`. Falls back correctly.
- [ ] **customer name fallback chain** -- Tests priority: `customerName` > `userDisplayName` > `userName` > `name`.
- [ ] **missing invoiceNumber** -- Verify auto-generates one via `generateInvoiceNumber()`.

#### `generateInvoiceNumber`
- [ ] **format** -- Matches `/^INV-\d{14}-[A-Z0-9]{4}$/` (INV- + 14-digit IST timestamp + 4 random chars).

### Mocking Strategy

- `computeRevenueSplit` and `mapTransactionRecord` are pure/quasi-pure -- minimal mocking needed
- For CRUD tests, override `firebaseFirestoreMock` methods

---

## 18. `src/pipeline/features/billing/validateCoupon.ts`

**Priority**: P0-CRITICAL
**Exports**:
- `validateCouponForCart(couponCode, cart, subtotal, customerPhone?)` -- full validation pipeline, returns `CouponValidationResult`
- `validateVendorCoupon(couponCode, vendorId, customerMobile, cart, subtotal)` -- vendor-specific validation

**Test file**: `src/pipeline/features/billing/__tests__/validateCoupon.test.ts`

### Test Cases

#### `validateCouponForCart`
- [ ] **invalid code** -- Code not in coupons list. Returns `{ valid: false, errorMessage: 'Invalid coupon code.' }`.
- [ ] **inactive coupon** -- `isActive: false`. Returns `'This coupon is inactive.'`.
- [ ] **expired coupon** -- `expiryDate` in the past. Returns `'This coupon has expired.'`.
- [ ] **not yet valid** -- `startDate` in the future. Returns `'This coupon is not yet valid.'`.
- [ ] **helicopter only** -- `isForHelicopterOnly: true`. Returns `'This coupon is for helicopter bookings only.'`.
- [ ] **non-discount type** -- `type: 'cashback'`. Returns `'Only discount coupons can be applied at POS.'`.
- [ ] **usage limit reached** -- `maxUsageCount: 5, usedCount: 5`. Returns `'Coupon usage limit reached.'`.
- [ ] **vendor coupon mobile mismatch** -- `createdByVendorId: 'v1'`, `allowedMobile: '9876543210'`, customer phone `'9999999999'`. Returns `'This coupon is not valid for this mobile number.'`.
- [ ] **vendor coupon mobile match (with country code)** -- `allowedMobile: '919876543210'`, customer `'+919876543210'`. Both normalize to `'9876543210'`. Returns valid.
- [ ] **min amount not met** -- `minAmount: 1000`, subtotal `500`. Returns `'Minimum amount of INR 1000 required.'`.
- [ ] **min tickets not met** -- `minTickets: 3`, cart has 2 total quantity. Returns `'Minimum 3 tickets required.'`.
- [ ] **percentage discount** -- `isPercentage: true, discount: 20`, subtotal `1000`. `discountAmount = 200`.
- [ ] **flat discount** -- `isPercentage: false, discount: 150`, subtotal `1000`. `discountAmount = 150`.
- [ ] **per-ticket flat discount** -- `applyPerTicket: true, isPercentage: false, discount: 50`, 3 eligible tickets. `discountAmount = 150`.
- [ ] **per-ticket percentage discount** -- `applyPerTicket: true, isPercentage: true, discount: 10`, eligible subtotal `1000`. `discountAmount = 100` (percentage ignores ticket count multiplier).
- [ ] **discount capped at subtotal** -- `discount: 2000`, subtotal `500`. `discountAmount = 500` (capped).
- [ ] **game eligibility filter** -- `applicableGames: [{ locationId: 'viz', gameId: 'gk' }]`. Cart has gokarting + paintball. Only gokarting subtotal counts for discount.
- [ ] **no eligible items** -- All cart items excluded by `applicableGames`. Returns `'No items in cart are eligible for this coupon.'`.
- [ ] **itemDiscounts distribution** -- Global coupon. 2 items at 600 and 400 (total 1000). Flat discount 100. itemDiscounts = [60, 40] (proportional).
- [ ] **itemDiscounts residual correction** -- Verify sum of `itemDiscounts` always equals `discountAmount` exactly.
- [ ] **event coupon with rejected vendors** -- `category: 'event'`. Mock `listAllEventNotifications` to return rejected vendor. Verify that vendor's games are excluded from eligibleGames.
- [ ] **event coupon all vendors pending/rejected** -- Returns `'No vendors have accepted this event coupon yet.'`.

#### `validateVendorCoupon`
- [ ] **wrong vendor** -- `createdByVendorId: 'vendor-A'`, calling with `vendorId: 'vendor-B'`. Returns `'This coupon does not belong to your account.'`.
- [ ] **mobile mismatch** -- Returns `'Coupon is not valid for this mobile number.'`.
- [ ] **happy path -- percentage** -- Valid vendor coupon with `isPercentage: true, discount: 15`. Verify `discountAmount` is 15% of eligible subtotal.
- [ ] **happy path -- flat** -- Valid vendor coupon with `isPercentage: false`. Verify flat discount.
- [ ] **no eligible items** -- Cart items don't match `applicableGames`. Returns `'No items are eligible for this coupon.'`.

### Mocking Strategy

- Mock `asquareCouponsApi.listCoupons()` to return test coupon arrays
- Mock `listAllEventNotifications()` for event coupon tests
- No Firestore mocks needed (the API functions are mocked at a higher level)

### Example Test Skeleton

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../api/asquare-coupons', () => ({
  asquareCouponsApi: {
    listCoupons: vi.fn(),
  },
}))
vi.mock('../../../api/event-coupon-notifications', () => ({
  listAllEventNotifications: vi.fn().mockResolvedValue([]),
}))

import { asquareCouponsApi } from '../../../api/asquare-coupons'
const { validateCouponForCart } = await import('../validateCoupon')

describe('validateCouponForCart', () => {
  const cart = [
    { itemName: 'Gokarting Adult 8 Laps', quantity: 2, unitPrice: 500, gameId: 'gk' },
    { itemName: 'Paintball 100 Bullets', quantity: 1, unitPrice: 300, gameId: 'pb' },
  ]

  it('applies percentage discount to full subtotal for global coupon', async () => {
    (asquareCouponsApi.listCoupons as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'c1', code: 'SAVE20', isActive: true, type: 'discount',
        discount: 20, isPercentage: true, minAmount: 0, minTickets: 0,
        applicableGames: [], maxUsageCount: 0, usedCount: 0,
      },
    ])

    const result = await validateCouponForCart('SAVE20', cart, 1300)

    expect(result.valid).toBe(true)
    expect(result.discountAmount).toBe(260) // 20% of 1300
  })

  it('rejects expired coupon', async () => {
    (asquareCouponsApi.listCoupons as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'c2', code: 'OLD', isActive: true, type: 'discount',
        discount: 10, isPercentage: false, minAmount: 0, minTickets: 0,
        applicableGames: [], expiryDate: '2020-01-01',
        maxUsageCount: 0, usedCount: 0,
      },
    ])

    const result = await validateCouponForCart('OLD', cart, 1300)

    expect(result.valid).toBe(false)
    expect(result.errorMessage).toBe('This coupon has expired.')
  })
})
```

---

## 19. `src/pipeline/api/lead-scoring.ts`

**Priority**: P2-MEDIUM
**Exports**:
- `computeLeadScore(source, factors, config?)` -- returns `{ score: number, scoreLabel: 'hot' | 'warm' | 'cold' }`

- [ ] **abandoned_cart -- high value, recent** -- `source: 'abandoned_cart'`, `abandonedCartValue: 5000`, `recencyDays: 0`. Score should be near 100 (60% of cartValueScore + 40% of recencyScore). Floor at 50. Label: `'hot'`.
- [ ] **abandoned_cart -- low value, old** -- `abandonedCartValue: 100`, `recencyDays: 30`. Score = max(50, low_score). Always at least 50 (floor).
- [ ] **abandoned_cart -- floor at 50** -- Even with zero value and 100 days, score >= 50.
- [ ] **inquiry -- WhatsApp, recent** -- `source: 'inquiry'`, `inquiryChannel: 'whatsapp'`, `recencyDays: 0`. High channel score (100) + high recency (100). Label: `'hot'` or `'warm'`.
- [ ] **inquiry -- unknown channel, old** -- `inquiryChannel: undefined`, `recencyDays: 30`. Low score.
- [ ] **channel scoring** -- whatsapp=100, website=80, phone=60, walk-in=50, unknown=40.
- [ ] **recency decay (inquiry)** -- `recencyDays: 20`. Recency score = max(0, 100 - 20*5) = 0.
- [ ] **recency decay (abandoned_cart)** -- `recencyDays: 10`. Recency score = max(0, 100 - 10*10) = 0.
- [ ] **score clamped 0-100** -- Verify score never exceeds 100 or drops below 0.
- [ ] **score labels** -- Verify hot >= `thresholds.hotMin`, warm >= `thresholds.warmMin`, cold below warm threshold.
- [ ] **custom config overrides** -- Pass custom `autoScoreWeights` and `scoreThresholds`. Verify they override defaults.

---

## 20. `src/pipeline/api/auth-firestore.ts`

**Priority**: P1-HIGH
**Exports**:
- `loginWithFirestoreAuth(identifier, password)` -- validates credentials, returns `LoginResponse { token, user }`
- `logoutFirestoreAuth()` -- returns `{ message: 'Logged out.' }`
- `resetFirestoreAuthPassword(token, oldPassword, newPassword)` -- validates old password, sets new one

**Test file**: `src/pipeline/api/__tests__/auth-firestore.test.ts`

### Test Cases

#### `loginWithFirestoreAuth`
- [ ] **happy path** -- Mock `getFirestoreUserAuthByIdentifier` to return valid record. Verify returns `{ token, user }` with correct fields (id, name, email, phone, role).
- [ ] **invalid credentials** -- Record not found. Verify throws `ApiError('Invalid email/mobile or password.', 401)`.
- [ ] **password mismatch** -- Record found but password differs. Verify throws `ApiError('Invalid email/mobile or password.', 401)`.
- [ ] **inactive account** -- `user.isActive: false`. Verify throws `ApiError('Your account is pending approval...', 403)`.
- [ ] **trims identifier** -- Pass `'  admin@test.com  '`. Verify normalized before lookup.
- [ ] **calls markFirestoreUserLogin** -- Verify login timestamp is recorded.
- [ ] **calls syncMockUserForSession** -- Verify session is synced.

#### `logoutFirestoreAuth`
- [ ] **returns message** -- Verify returns `{ message: 'Logged out.' }`.

#### `resetFirestoreAuthPassword`
- [ ] **happy path** -- Valid token, correct old password, new password. Verify calls `setFirestoreUserPassword` with new password.
- [ ] **invalid token** -- `parseMockTokenUserId` returns null. Verify throws `ApiError('Unauthorized', 401)`.
- [ ] **wrong old password** -- Verify throws `ApiError('Old password is incorrect.', 400)`.
- [ ] **empty new password** -- Verify throws `ApiError('New password is required.', 400)`.
- [ ] **inactive user** -- Verify throws `ApiError('Unauthorized', 401)`.

### Mocking Strategy

- Mock `./users-firestore` functions: `getFirestoreUserAuthByIdentifier`, `getFirestoreUserAuthById`, `markFirestoreUserLogin`, `setFirestoreUserPassword`, `isFirestoreUsersActive`
- Mock `./client` functions: `buildMockTokenForUser`, `parseMockTokenUserId`, `syncMockUserForSession`, `updateMockUserPassword`

---

## 21. `src/pipeline/api/device-sessions.ts`

**Priority**: P1-HIGH
**Exports**: `deviceSessionsApi` object with methods:
- `register(token)` -- creates session doc in `deviceSessions` with device fingerprint
- `listForUser(token)` -- queries active sessions for user
- `touchSession(sessionId)` -- updates `lastActiveAt`
- `revokeSession(token, sessionId)` -- marks `isRevoked: true`
- `revokeAllOtherSessions(token, currentSessionId)` -- batch revoke all except current
- `removeCurrentSession(token)` -- deletes session doc + clears localStorage
- `onSessionRevoked(sessionId, onRevoked)` -- realtime listener
- `listAllSessions(token)` -- admin-only: all active sessions
- `listSessionsForUser(token, targetUserId)` -- admin-only: sessions for specific user
- `adminRevokeSession(token, sessionId)` -- admin-only revoke
- `adminRevokeAllForUser(token, targetUserId)` -- admin-only batch revoke

**Test file**: `src/pipeline/api/__tests__/device-sessions.test.ts`

### Test Cases

- [ ] **register -- creates session** -- Verify `setDoc` called with `userId`, `deviceType`, `browserName`, `osName`, `isRevoked: false`. Verify localStorage stores session ID.
- [ ] **register -- unauthorized** -- Invalid token. Verify throws `'Unauthorized'`.
- [ ] **listForUser -- returns sorted sessions** -- Mock `getDocs` to return 3 sessions. Verify sorted by `lastActiveAt` descending.
- [ ] **touchSession** -- Verify `updateDoc` called with `lastActiveAt`.
- [ ] **revokeSession** -- Verify `updateDoc` sets `isRevoked: true, revokedAt`.
- [ ] **revokeAllOtherSessions** -- 3 active sessions, current is session B. Verify batch updates A and C but not B. Returns `2`.
- [ ] **revokeAllOtherSessions -- no others** -- Only current session active. Returns `0`, no batch commit.
- [ ] **removeCurrentSession** -- Verify `deleteDoc` called, localStorage cleared.
- [ ] **listAllSessions -- non-admin** -- Non-privileged role. Verify throws `'Only Owner/Admin...'`.
- [ ] **adminRevokeAllForUser** -- Admin token. Verify batch revokes all user sessions, returns count.
- [ ] **detectDeviceType** -- Internal helper. Verify `'desktop'` in test environment.

---

## 22. `src/pipeline/api/leads-firestore.ts`

**Priority**: P2-MEDIUM
**Exports**: `leadsApi`-compatible functions: `listFirestoreLeads`, `getFirestoreLeadById`, `createFirestoreLead`, `updateFirestoreLeadStatus`, `claimFirestoreLead`, `assignFirestoreLead`, `deleteFirestoreLead`, timeline functions

- [ ] **createFirestoreLead -- computes lead score** -- Verify `computeLeadScore` is called with correct factors
- [ ] **createFirestoreLead -- normalizes phone** -- Verify phone is normalized via `normalizePhone`
- [ ] **updateFirestoreLeadStatus -- adds timeline event** -- Verify timeline subcollection is written
- [ ] **listFirestoreLeads -- pagination** -- Verify cursor-based pagination with `startAfter`
- [ ] **claimFirestoreLead -- sets assignedTo** -- Verify updates lead with current user's ID

---

## 23. `src/pipeline/api/billing.ts`

**Priority**: P2-MEDIUM
**Exports**: `billingApi` object with: `listTransactions`, `getTransaction`, `getInvoice`, `refund`, `cancel`, `reschedule`, `updatePaymentStatus`, etc.

- [ ] **listTransactions** -- delegates to `listFirestoreBillingTransactions`, wraps in `{ transactions }`
- [ ] **refund** -- calls `refundFirestoreBillingTransaction`, then regenerates weekly invoices
- [ ] **cancel** -- calls `cancelFirestoreBillingTransaction`, then regenerates weekly invoices
- [ ] **getInvoice** -- delegates to `getFirestoreBillingInvoice`

---

## 24. `src/pipeline/api/asquare-bookings.ts`

**Priority**: P2-MEDIUM
**Exports**: `asquareBookingsApi` with booking CRUD, Interakt triggers, payment link functions

- [ ] **listBookings** -- queries bookings collection with filters
- [ ] **getBooking** -- fetches single booking by ID
- [ ] **deleteBooking** -- soft deletes to `deleted_bookings` and calls Cloud Function
- [ ] **sendConfirmation** -- triggers Interakt webhook
- [ ] **sendPaymentLink** -- triggers payment link Cloud Function

---

## 25. `src/pipeline/api/asquare-members.ts`

**Priority**: P2-MEDIUM
**Exports**: `asquareMembersApi` with `lookupByPhone`, `lookupById`, `ensureMember`, `redeemCoupon150`, `MemberRecord` type

- [ ] **lookupByPhone -- finds member** -- Mock query by normalized phone. Verify returns `MemberRecord` with computed `coupons150Earned`, `coupons150Available`.
- [ ] **coupon computation** -- `totalBillAmount: 1800, coupons150Redeemed: 1`. Earned = floor(1800/600) = 3. Available = 3 - 1 = 2.
- [ ] **coupon computation -- zero bill** -- Earned = 0, Available = 0.
- [ ] **normalizePhone** -- `'(+91) 987-654 3210'` becomes `'9876543210'`.
- [ ] **ensureMember -- creates if not found** -- Verify `setDoc` called with default fields.

---

## 26. `src/pipeline/api/users-firestore.ts`

**Priority**: P2-MEDIUM
**Exports**: User CRUD functions, role management, auth record functions

- [ ] **getFirestoreUserAuthByIdentifier** -- searches by email and phone
- [ ] **createFirestoreUser** -- generates doc ID from name, validates role
- [ ] **updateFirestoreUser** -- merges updates, validates role
- [ ] **isRole validation** -- only accepts valid `Role` values from `VALID_ROLES` array
- [ ] **toBoolean helper** -- handles string/number/boolean inputs correctly

---

## 27. `src/pipeline/api/shifts-firestore.ts` -- Basic coverage

**Priority**: P3-LOW
**Exports**: `listFirestoreShifts`, `startFirestoreShift`, `startFirestoreShiftBreak`, `endFirestoreShiftBreak`, `endFirestoreShift`, `endFirestoreShiftById`, `endFirestoreShiftWithSettlement`, `reportFirestoreShifts`, `getLatestActiveShiftForUser`, `isFirestoreShiftsActive`

- [ ] **startFirestoreShift** -- creates shift doc with `startTime`, `userId`, `status: 'active'`
- [ ] **endFirestoreShift** -- updates shift with `endTime`, `status: 'completed'`
- [ ] **startFirestoreShiftBreak** -- adds break entry to shift
- [ ] **getLatestActiveShiftForUser** -- returns most recent active shift

---

## 28. `src/pipeline/api/tasks-firestore.ts` -- Basic coverage

**Priority**: P3-LOW
**Exports**: `listFirestoreWorkspaces`, `createFirestoreWorkspace`, `listFirestoreTasks`, `createFirestoreTask`, `updateFirestoreTask`, `removeFirestoreTask`, `addFirestoreTaskComment`, `subscribeFirestoreTaskConversation`, `sendFirestoreTaskMessage`, `deleteFirestoreTaskMessage`, etc.

- [ ] **createFirestoreTask** -- returns task with generated ID
- [ ] **updateFirestoreTask** -- merges updates to task doc
- [ ] **sendFirestoreTaskMessage** -- writes to task messages subcollection
- [ ] **isFirestoreTasksActive** -- returns boolean based on collection availability

---

## 29. `src/pipeline/api/contacts-firestore.ts` -- Basic coverage

**Priority**: P3-LOW
**Exports**: `listFirestoreContacts`, `createFirestoreContact`, `updateFirestoreContact`, `removeFirestoreContact`, `isFirestoreContactsActive`

- [ ] **createFirestoreContact** -- returns contact with ID
- [ ] **listFirestoreContacts** -- returns array of contacts
- [ ] **removeFirestoreContact** -- calls deleteDoc

---

## 30. `src/pipeline/api/reports-firestore.ts` -- Basic coverage

**Priority**: P3-LOW
**Exports**: `buildFirestoreOperationsReport`, `buildFirestoreRevenueReport`, `buildFirestoreShiftSummaryReport`, `buildFirestoreGameRevenueReport`, `buildFirestoreCallHistory`, `buildFirestoreStaffInsights`, `isFirestoreReportsActive`

- [ ] **buildFirestoreRevenueReport** -- returns expected shape with revenue fields
- [ ] **buildFirestoreOperationsReport** -- returns expected shape with operations metrics
- [ ] **isFirestoreReportsActive** -- returns boolean

---

# SECTION 4: Pipeline Feature Hooks

---

## `src/pipeline/features/leads/useLeadList.ts`

**Priority**: P2
**Exports**: `useLeadList(filters)` -- React hook returning `{ leads, loading, error, hasMore, loadLeads }`

- [ ] **initial load** -- Renders hook with empty filters. Verify `loading` starts true, `leads` populates after API resolves.
- [ ] **client-side text search** -- Set `filters.search = 'john'`. Verify only leads with matching name/phone/email are returned.
- [ ] **client-side date range filter** -- Set `dateFrom` and `dateTo`. Verify leads outside range are excluded.
- [ ] **pagination (append mode)** -- Call `loadLeads(true)`. Verify `cursor` is passed to API and results are appended.
- [ ] **error handling** -- Mock API to reject. Verify `error` state is set.
- [ ] **no token** -- Session has no token. Verify `loadLeads` returns early.

---

## `src/pipeline/features/leads/useLeadActions.ts`

**Priority**: P2
**Exports**: `useLeadActions(onMutate?)` -- React hook returning `{ createLead, claimLead, assignLead, updateStatus, busy, error, success }`

- [ ] **createLead** -- Calls `leadsApi.create` with token and payload. On success, calls `onMutate`.
- [ ] **claimLead** -- Calls `leadsApi.claim`. Verify success message `'Lead claimed'`.
- [ ] **assignLead** -- Calls `leadsApi.assign` with `leadId` and `toUserId`.
- [ ] **updateStatus** -- Calls `leadsApi.updateStatus` with `leadId`, `status`, `subStatus`.
- [ ] **error handling** -- API rejects. Verify `error` state set to fallback message.
- [ ] **busy state** -- Verify `busy` is true during async operation.

---

## `src/pipeline/features/leads/useLeadFilters.ts`

**Priority**: P2
**Exports**: `useLeadFilters()` -- React hook returning `{ filters, setFilter, resetFilters }`

- [ ] **reads from URL params** -- Mock `useSearchParams` with `status=new&branchId=vizag`. Verify `filters.status === 'new'`, `filters.branchId === 'vizag'`.
- [ ] **setFilter updates URL** -- Call `setFilter('status', 'contacted')`. Verify `setSearchParams` called with updated params.
- [ ] **setFilter removes param when undefined** -- Call `setFilter('status', undefined)`. Verify param deleted.
- [ ] **resetFilters clears all** -- Verify `setSearchParams({})` called.
- [ ] **empty params return undefined** -- Verify `filters.status` is `undefined` when param not in URL.

---

## `src/pipeline/features/track/scanner/hooks/useScannerApi.ts`

**Priority**: P2
**Exports**: `useScannerApi()` -- React hook returning `{ phase, result, errorMsg, fetchBill, submitVerification, reset }`

- [ ] **fetchBill -- happy path** -- Mock `lookupBill` to return valid result with serials. Verify `phase` transitions `idle -> loading -> result`.
- [ ] **fetchBill -- no serials** -- Mock `lookupBill` to return empty serials. Verify `phase: 'error'`, `errorMsg: 'No items found...'`.
- [ ] **fetchBill -- API error** -- Mock `lookupBill` to throw. Verify `phase: 'error'`, `errorMsg` from error message.
- [ ] **submitVerification -- happy path** -- Set state to `result` phase with mock data. Call `submitVerification`. Verify `verifySerials` called, `phase` transitions to `'done'`.
- [ ] **submitVerification -- error** -- Mock `verifySerials` to throw. Verify `phase: 'error'`.
- [ ] **reset** -- Verify state returns to `{ phase: 'idle', result: null, errorMsg: null }`.

---

## `src/pipeline/features/track/scanner/hooks/useShift.ts`

**Priority**: P2
**Exports**: `useShift` -- re-export of `useShiftContext` from `ShiftContext`

- [ ] **re-export** -- Verify `useShift` is the same function as `useShiftContext`.

---

## `src/pipeline/features/billing/generateBillingReceipt.ts`

**Priority**: P2
**Exports**: `generateBillingReceipt(txn, member?)` (the main function), plus internal helpers: `currency`, `maskPhone`, `getQrValue`, `simpleChecksum`

- [ ] **currency(1500)** -- returns `'INR 1,500'`
- [ ] **maskPhone('9876543210')** -- returns `'XXXXXX3210'`
- [ ] **maskPhone(undefined)** -- returns `'--'` (em dash)
- [ ] **maskPhone('1234')** -- returns `'1234'` (4 or fewer digits, no masking)
- [ ] **getQrValue -- no Go-Karting** -- Returns just invoice number.
- [ ] **getQrValue -- with Go-Karting serials** -- Returns `'INV-123|GK:005,006,007|CHK:xxxx'` format.
- [ ] **simpleChecksum** -- Deterministic: same input always produces same 4-digit output.
- [ ] **generateBillingReceipt -- returns HTML string** -- Verify contains invoice number, customer name, GST number, item rows, total amount.

---

## `src/pipeline/features/activities/useVendorGameImport.ts`

**Priority**: P2
**Exports**: `useVendorGameImport()` -- React hook for Excel import flow

- [ ] **selectFile -- valid file** -- Mock `readExcelSheets` to return headers. Verify `step` transitions to `'mapping'`, `sheetInfo` populated.
- [ ] **selectFile -- invalid file** -- Mock to throw. Verify `error` state set.
- [ ] **step transitions** -- Verify flow: `idle -> file_selected -> mapping -> preview -> importing -> complete`.
- [ ] **updateVendorMapping / updateGameMapping** -- Verify state updates for column mappings.

---

# Appendix: Test Infrastructure Reference

| File | Purpose |
|------|---------|
| `src/test/setup.ts` | Global setup: registers Firebase/Capacitor mocks, stubs env vars, browser API shims, afterEach cleanup |
| `src/test/mocks/firebase.ts` | `registerFirebaseMocks()`, `createFakeDocSnapshot(data?, id?)`, `createFakeQuerySnapshot(docs?)`, individual mocks (`firebaseFirestoreMock`, `firebaseAuthMock`, etc.) |
| `src/test/mocks/capacitor.ts` | Stubs `@capacitor/core`, `@capacitor/preferences` for web-like behavior |
| `src/test/test-utils.tsx` | `renderWithProviders()`, `renderPipelineWithProviders()`, mock data factories: `createMockUser()`, `createMockActivity()`, `createMockBooking()`, `createMockBookingItem()`, `createMockSpinPrize()`, `createMockUserSpins()`, `createMockGameProgress()`, `createMockPipelineSession()` |

### Overriding Mocks Per-Test

```typescript
import { firebaseFirestoreMock, createFakeDocSnapshot, createFakeQuerySnapshot } from '../../test/mocks/firebase'

// Override getDoc for a specific test
firebaseFirestoreMock.getDoc.mockResolvedValueOnce(
  createFakeDocSnapshot({ balance: 500 }, 'wallet-doc')
)

// Override getDocs for query results
firebaseFirestoreMock.getDocs.mockResolvedValueOnce(
  createFakeQuerySnapshot([
    { name: 'Booking 1', finalAmount: 1000 },
    { name: 'Booking 2', finalAmount: 500 },
  ])
)

// Override runTransaction for atomic operations
firebaseFirestoreMock.runTransaction.mockImplementation((_db, callback) => {
  const mockTxn = {
    get: vi.fn().mockResolvedValue(createFakeDocSnapshot({ lastSerial: 5 })),
    set: vi.fn(),
    update: vi.fn(),
  }
  return callback(mockTxn)
})
```

---

## Priority Summary

| Priority | Modules | Total Test Cases |
|----------|---------|-----------------|
| P0-CRITICAL | bookingService, walletService, couponService, validateCoupon | ~75 |
| P1-HIGH | razorpayService, unified-booking, scannerApi, serial-counters, billing-firestore, auth-firestore, device-sessions | ~65 |
| P2-MEDIUM | activityService, lead-scoring, leads-firestore, billing.ts, asquare-bookings, asquare-members, users-firestore, hook tests, generateBillingReceipt, useVendorGameImport | ~50 |
| P3-LOW | utils, date-format, locations, storage, platform, gamificationConfig, checkInConfig, waitingListService, shifts, tasks, contacts, reports | ~45 |
| **Total** | **30 modules** | **~235 test cases** |

### Recommended Execution Order

1. Pure functions first (fastest, no mocks): `computeGst`, `computeRevenueSplit`, `formatCurrency`, `isPeakHours`, `calculateComboDiscount`, `isValidStatusTransition`, `extractSerialCategory`, `computeLeadScore`
2. Wallet service (atomic transactions, highest financial risk)
3. Coupon validation (complex business rules, revenue impact)
4. Scanner API (operational correctness, serial integrity)
5. Booking service (end-to-end flow, depends on 1-4)
6. Auth + sessions (security)
7. Everything else by priority
