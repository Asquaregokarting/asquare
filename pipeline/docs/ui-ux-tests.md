# UI/UX Test Skill Document -- A Square GoKarting Platform

> **Stack:** React 18 + TypeScript + Vite 6 + Tailwind CSS 3 + Firebase 12 + Framer Motion + Capacitor 8
> **Testing Framework:** Vitest + @testing-library/react + @testing-library/jest-dom + jsdom
> **Date Generated:** 2026-03-31

---

## Testing Infrastructure

### Production Safety

All tests use fully mocked Firebase (`src/test/mocks/firebase.ts`). ZERO network calls, ZERO production data access. The setup file (`src/test/setup.ts`) registers mocks before any imports resolve, stubs all environment variables with fake keys, and shims browser APIs (matchMedia, IntersectionObserver, ResizeObserver, navigator.vibrate) for jsdom.

### Test Utilities -- `src/test/test-utils.tsx`

| Helper | Description |
|--------|-------------|
| `renderWithProviders(ui, options?)` | Wraps in QueryClientProvider + HelmetProvider + BrowserRouter. Pass `{ route: '/path' }` to set initial URL. |
| `renderPipelineWithProviders(ui, options?)` | Wraps in QueryClientProvider + BrowserRouter (no HelmetProvider). |
| `createMockUser(overrides?)` | Returns a `User` with id, displayName, phone, email, tires, walletBalance, tier, referralCode, dates, isVerified. |
| `createMockActivity(overrides?)` | Returns an `Activity` with id, name, description, image, basePrice, available, category, platforms, variants, locationIds. |
| `createMockBookingItem(overrides?)` | Returns a `BookingItem` with activity, quantity, duration, date, timeSlot, price. |
| `createMockBooking(overrides?)` | Returns a `Booking` with id, userId, locationId, items, amounts, statuses, qrCode, dates, tires, paymentMethod. |
| `createMockSpinPrize(overrides?)` | Returns a `SpinPrize` with id, name, description, tier, type, value, icon, color, weight. |
| `createMockUserSpins(overrides?)` | Returns `UserSpins` with available, total, used, history, lastEarnedAt. |
| `createMockGameProgress(overrides?)` | Returns `GameProgress` with puzzlesCompleted, memoryGamesWon, runnerHighScore, triviaQuestionsAnswered, streaks, lastPlayedAt. |
| `createMockPipelineSession(role?, overrides?)` | Returns a pipeline admin session with uid, email, displayName, role, allowedLocations, loginAt. |

### Firebase Mocks -- `src/test/mocks/firebase.ts`

| Factory | Purpose |
|---------|---------|
| `createFakeDocSnapshot(data?, id?)` | Returns `{ exists(), data(), id, ref, get() }` |
| `createFakeQuerySnapshot(docs?)` | Returns `{ docs, empty, size, forEach() }` |
| `registerFirebaseMocks()` | Calls `vi.mock()` for `firebase/app`, `firebase/auth`, `firebase/firestore`, `firebase/storage` |

All Firestore writes (`setDoc`, `updateDoc`, `addDoc`, `deleteDoc`) are no-ops. All reads (`getDoc`, `getDocs`) return empty snapshots by default. Override per-test with `vi.mocked(getDoc).mockResolvedValueOnce(...)`.

### Re-exported from test-utils

`render`, `cleanup`, `screen`, `waitFor`, `within`, `act`, `fireEvent` are re-exported for convenience.

---

## SECTION 1: Customer App Contexts (HIGH PRIORITY)

---

### `src/contexts/CartContext.tsx`

**Priority**: P0-CRITICAL
**Complexity**: Complex
**Test file**: `src/contexts/CartContext.test.tsx`

#### Context Interface

The `CartProvider` exposes via `useCart()`:
- `items: CartItem[]` -- stored in localStorage key `asquare_cart_items`
- `addItem(activity, quantity?, date?)` -- adds or increments existing item
- `removeItem(activityId)` -- filters out by `activity.id`
- `updateQuantity(activityId, quantity)` -- updates quantity; removes if `<= 0`
- `clearCart()` -- empties items and removes applied coupon
- `getTotal()` -- sum of `(basePrice * offerPercent adjustment) * quantity`
- `getDiscountedTotal(couponCode?)` -- returns `{ total, discount, cashback, code }`
- `getItemQuantity(activityId)` -- returns quantity for specific item
- `itemCount` -- total ticket count across all items
- `appliedCoupon: string | null` -- persisted in localStorage key `asquare_applied_coupon`
- `applyCoupon(code)` -- returns `true` on success, error string on failure
- `removeCoupon()` -- clears applied coupon
- `coupons: Coupon[]` -- fetched from `couponService.fetchCoupons()` on mount
- `cartDate: string` -- persisted in localStorage key `asquare_cart_date`; auto-resets if past
- `setCartDate(date)` -- updates cartDate and propagates to all items
- `isUsingWallet: boolean` / `setIsUsingWallet(value)`
- `hasGokartingActivity()` -- checks if any item name/category includes "kart"

#### Test Cases

**Cart Item Management:**
- [ ] **useCart throws outside provider** -- Calling `useCart()` without `CartProvider` throws `"useCart must be used within a CartProvider"`
- [ ] **addItem adds new activity** -- Add an activity; expect `items.length === 1`, correct activity.id, quantity defaults to 1
- [ ] **addItem increments existing activity** -- Add same activity twice; expect single item with `quantity === 2`
- [ ] **addItem with explicit quantity** -- `addItem(activity, 5)` creates item with `quantity === 5`
- [ ] **removeItem removes by activityId** -- Add two activities, remove one; expect only the other remains
- [ ] **updateQuantity changes quantity** -- Add item, update to 3; expect `quantity === 3`
- [ ] **updateQuantity removes item when <= 0** -- `updateQuantity(id, 0)` removes the item entirely
- [ ] **clearCart empties items and removes coupon** -- Add items and coupon, call `clearCart()`; expect `items.length === 0` and `appliedCoupon === null`
- [ ] **itemCount sums all quantities** -- Add 2 items with quantities 3 and 5; expect `itemCount === 8`
- [ ] **getItemQuantity returns 0 for missing item** -- Query a non-existent activityId; expect 0

**Price Calculation:**
- [ ] **getTotal calculates base price sum** -- Add item at `basePrice: 500`, quantity 2; expect `getTotal() === 1000`
- [ ] **getTotal applies offerPercent** -- Activity with `basePrice: 1000`, `offerPercent: 20`; expect price per unit is 800
- [ ] **getTotal handles mixed items** -- One item with offer, one without; verify correct sum

**Coupon Validation (applyCoupon returns):**
- [ ] **invalid coupon returns error string** -- `applyCoupon('INVALID')` returns `'Invalid coupon code'`
- [ ] **expired coupon returns error** -- Coupon with past `expiryDate`; returns `'This coupon has expired'`
- [ ] **minimum amount not met** -- Coupon with `minAmount: 2000`, cart total 500; returns `'Minimum cart amount of ...'`
- [ ] **minimum tickets not met** -- Coupon `ASG1000` requires `Math.max(6, minTickets)` tickets; returns `'Minimum ... tickets required'`
- [ ] **helicopter-only coupon rejects non-helicopter** -- Coupon with `isForHelicopterOnly: true`, no helicopter items; returns `'A helicopter joy ride is required...'`
- [ ] **helicopter-only coupon rejects mixed cart** -- Coupon with `isForHelicopterOnly: true`, cart has helicopter + non-helicopter; returns `'This coupon is only valid for helicopter...'`
- [ ] **excludeCategories rejects excluded items** -- Coupon with `excludeCategories: ['helicopter']`, cart has helicopter item; returns error string
- [ ] **validDates rejects wrong date** -- Coupon with `validDates: ['2026-02-14']`, cartDate is `'2026-03-01'`; returns `'This coupon is only valid for visits on...'`
- [ ] **valid coupon returns true** -- Coupon passes all checks; returns `true` and sets `appliedCoupon`
- [ ] **coupon code is uppercased** -- Applying `'welcome200'` matches coupon with code `'WELCOME200'`

**Discount Calculation (getDiscountedTotal):**
- [ ] **no coupon returns full total** -- No applied coupon; `discount === 0`, `cashback === 0`, `total === cartTotal`
- [ ] **wallet mode disables coupons** -- `isUsingWallet: true`; returns `{ discount: 0, cashback: 0, code: null }`
- [ ] **percentage coupon calculates discount** -- Coupon with `isPercentage: true`, `discount: 10`; expect 10% off total
- [ ] **flat coupon subtracts amount** -- Coupon with `isPercentage: false`, `discount: 100`; expect total reduced by 100
- [ ] **per-ticket flat coupon multiplies** -- Coupon with `applyPerTicket: true`, `discount: 50`, 4 tickets; expect discount of 200
- [ ] **cashback coupon returns cashback** -- Coupon with `type: 'cashback'`; expect `cashback > 0`, `discount === 0`, `total === cartTotal`
- [ ] **RD26 forced cashback** -- Coupon code `'RD26'` always treated as cashback regardless of `type` field

**Auto-removal of Invalid Coupons:**
- [ ] **coupon auto-removed when cart total drops below minAmount** -- Apply coupon, then remove items until total < minAmount; expect `appliedCoupon` resets to null
- [ ] **coupon auto-removed when ticket count drops below minTickets** -- Apply coupon requiring 6+ tickets, reduce to 5; expect removal

**Persistence:**
- [ ] **items persist to localStorage** -- Add item, check `localStorage.getItem('asquare_cart_items')` is valid JSON
- [ ] **items load from localStorage on mount** -- Pre-set localStorage, mount provider; expect items populated
- [ ] **cartDate persists to localStorage** -- Set cartDate, check `localStorage.getItem('asquare_cart_date')`
- [ ] **past cartDate auto-resets to today** -- Pre-set localStorage with yesterday's date; expect cartDate reset to today
- [ ] **appliedCoupon persists to localStorage** -- Apply coupon, check localStorage key `asquare_applied_coupon`

**hasGokartingActivity:**
- [ ] **returns true when cart has go-kart item** -- Item with `name: 'Go Karting -- Adult'`; returns `true`
- [ ] **returns false when no kart items** -- Item with `name: 'Helicopter Joy Ride'`; returns `false`

#### Mocking Notes

- Mock `couponService.fetchCoupons()` to return a known array of `Coupon` objects
- Mock `getLocalISODate()` from `src/lib/utils` to return a controlled date
- Pre-populate `localStorage` for persistence tests

#### Example Test Skeleton

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { CartProvider, useCart } from './CartContext'
import { createMockActivity } from '../test/test-utils'

vi.mock('../services/couponService', () => ({
  couponService: {
    fetchCoupons: vi.fn(() => Promise.resolve([
      { code: 'TEST10', discount: 10, isPercentage: true, minAmount: 0, type: 'discount' },
      { code: 'FLAT100', discount: 100, isPercentage: false, minAmount: 500, type: 'discount' },
    ])),
  },
}))

vi.mock('../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/utils')>()
  return { ...actual, getLocalISODate: () => '2026-03-31' }
})

describe('CartContext', () => {
  beforeEach(() => localStorage.clear())

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <CartProvider>{children}</CartProvider>
  )

  it('addItem creates new cart entry', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    const activity = createMockActivity({ id: 'gk-1', basePrice: 500 })

    act(() => result.current.addItem(activity))

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].activity.id).toBe('gk-1')
    expect(result.current.items[0].quantity).toBe(1)
  })

  it('getTotal calculates sum with offerPercent', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    const activity = createMockActivity({ basePrice: 1000, offerPercent: 20 })

    act(() => result.current.addItem(activity, 2))

    expect(result.current.getTotal()).toBe(1600) // 1000 * 0.8 * 2
  })
})
```

---

### `src/contexts/AuthContext.tsx`

**Priority**: P1-HIGH
**Complexity**: Complex
**Test file**: `src/contexts/AuthContext.test.tsx`

#### Context Interface

The `AuthProvider` exposes via `useAuth()`:
- `user: User | null` / `loading: boolean` / `error: string | null`
- `signInWithEmail(email, password)` -- creates mock user from email
- `signUpWithEmail(email, password, displayName)` -- creates mock new user
- `signInWithGoogle()` -- uses `GoogleAuthProvider` + `signInWithPopup`
- `signInWithPhone(phoneNumber)` -- delegates to `sendOTP`
- `loginWithPhone(phoneNumber)` -- calls `syncUserWithAPI`, fallback creates minimal user
- `loginAsGuest(phoneNumber)` -- calls `syncUserWithAPI`, fallback creates guest user
- `sendOTP(phoneNumber, recaptchaContainerId?)` -- validates phone starts with `+`, creates `RecaptchaVerifier`, calls `signInWithPhoneNumber`
- `verifyOTP(otp)` -- calls `confirmationResult.confirm(otp)`, syncs user, marks `isVerified: true`
- `logout()` -- calls `auth.signOut()`, removes `mock_user` from storage, reloads page
- `updateUserProfile(data)` -- validates mobile required, writes to Firestore, updates local state
- `clearError()` -- resets error to null

#### Test Cases

- [ ] **useAuth throws outside provider** -- Calling `useAuth()` without `AuthProvider` throws `"useAuth must be used within an AuthProvider"`
- [ ] **initial state is loading with no user** -- On mount, `loading === true`, `user === null`
- [ ] **onAuthStateChanged with no Firebase user loads from storage** -- `storage.get('mock_user')` returns null; user stays null, loading becomes false
- [ ] **onAuthStateChanged with stored user sets user** -- Pre-set storage with serialized user; expect user populated from storage
- [ ] **signInWithEmail sets mock user** -- Call with email/password; expect user with email, displayName derived from email
- [ ] **signUpWithEmail sets new user with tier bronze** -- Call with email/password/name; expect user with `tier: 'bronze'`, `tires: 0`
- [ ] **signInWithGoogle success** -- Mock `signInWithPopup` to return user with displayName; expect user populated
- [ ] **signInWithGoogle failure sets error** -- Mock `signInWithPopup` to throw; expect `error` set to message
- [ ] **sendOTP validates phone starts with +** -- Call with `'9876543210'` (no +); expect error `'Phone number must include country code'`
- [ ] **sendOTP requires recaptcha container** -- Call when container element does not exist; expect error about container not found
- [ ] **verifyOTP without prior OTP request throws** -- Call `verifyOTP('123456')` without `sendOTP` first; expect `'Please request an OTP first'`
- [ ] **verifyOTP success marks user isVerified** -- Mock `confirmationResult.confirm` to resolve; expect `user.isVerified === true`
- [ ] **verifyOTP failure sets error** -- Mock `confirmationResult.confirm` to reject; expect error `'Invalid OTP code...'`
- [ ] **loginWithPhone success syncs from Firestore** -- Mock `getDoc` to return user data; expect user populated from Firestore fields
- [ ] **loginWithPhone fallback creates minimal user** -- Mock `getDoc` to throw; expect fallback user with `displayName: 'Guest User'`
- [ ] **loginAsGuest fallback creates guest** -- Mock `syncUserWithAPI` to throw; expect user with `id: 'guest-...'`
- [ ] **logout clears user and storage** -- Login then logout; expect `user === null`, storage cleared
- [ ] **updateUserProfile validates mobile required** -- Call with empty phone; expect error `'Mobile number is required'`
- [ ] **updateUserProfile updates local state** -- Call with new displayName; expect user.displayName updated
- [ ] **clearError resets error to null** -- Set error via failed call, then `clearError()`; expect `error === null`
- [ ] **wallet balance syncs via onSnapshot** -- Simulate snapshot with different balance; expect `user.walletBalance` updated
- [ ] **profile data syncs referralCode via onSnapshot** -- Simulate snapshot with new referralCode; expect field updated

#### Mocking Notes

- Mock `firebase/auth` functions: `onAuthStateChanged`, `signInWithPopup`, `signInWithPhoneNumber`, `RecaptchaVerifier`
- Mock `firebase/firestore` functions: `doc`, `onSnapshot`, `setDoc`, `getDoc`, `serverTimestamp`
- Mock `src/lib/storage` with `{ get: vi.fn(), set: vi.fn(), remove: vi.fn() }`
- For `sendOTP` tests, create a DOM element with `id="recaptcha-container"` before calling
- Mock `window.location.reload` for logout tests

#### Example Test Skeleton

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

vi.mock('../lib/storage', () => ({
  storage: {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  },
}))

describe('AuthContext', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  )

  it('throws when used outside provider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within an AuthProvider'
    )
  })
})
```

---

### `src/contexts/GamesContext.tsx`

**Priority**: P2-MEDIUM
**Complexity**: Complex
**Test file**: `src/contexts/GamesContext.test.tsx`

#### Context Interface

Uses `useReducer` with actions: `ADD_TIRES`, `SPEND_TIRES`, `ADD_SCORE`, `UPDATE_PROGRESS`, `SET_DAILY_CHALLENGES`, `COMPLETE_DAILY_GAME`, `UPDATE_STREAK`, `SET_OFFLINE`, `CLEAR_PENDING_SYNC`, `LOAD_FROM_STORAGE`, `EARN_SPIN`, `USE_SPIN`, `INCREMENT_GAMES_COUNT`, `RESET_GAMES_COUNT`, `CLAIM_SPIN_PRIZE`.

Exposed via `useGames()`:
- `tires`, `progress`, `dailyChallenges`, `recentScores`, `currentStreak`, `isOffline`, `pendingSync`, `spins`, `gamesCompletedSinceLastSpin`
- `addTires(tires, streakBonus?)` -- applies streak bonus (10% per streak level, capped at 100% of base), syncs to Firestore
- `spendTires(tires)` -- returns false if insufficient, deducts and syncs
- `recordScore(gameType, score, difficulty?)` -- adds score, updates progress per gameType, calculates tires, tracks spin earning (1 spin per 3 games)
- `updateProgress(update)` / `completeDailyGame(gameType, bonusTires)` / `canAfford(cost)`
- `syncWithServer()` -- batch writes pending scores to Firestore
- `earnSpin(count, source)` / `useSpin()` / `claimSpinPrize(spinId)`

#### Test Cases

- [ ] **useGames throws outside provider** -- Expect error `"useGames must be used within a GamesProvider"`
- [ ] **initial state has zero tires and empty progress** -- Expect `tires === 0`, `progress.puzzlesCompleted === 0`
- [ ] **addTires increases tire count** -- `addTires(50)` with no streak; expect `tires === 50`
- [ ] **addTires applies streak bonus** -- Set `currentStreak: 3`, add 100 tires; bonus = `min(100 * 0.1 * 3, 100)` = 30; expect `tires === 130`
- [ ] **addTires caps streak bonus at 100%** -- Set `currentStreak: 15`, add 100 tires; bonus capped at 100; expect `tires === 200`
- [ ] **spendTires returns false when insufficient** -- `tires: 20`, `spendTires(50)` returns `false`, tires unchanged
- [ ] **spendTires deducts correctly** -- `tires: 100`, `spendTires(30)` returns `true`, `tires === 70`
- [ ] **recordScore adds to recentScores (max 50)** -- Record 51 scores; expect `recentScores.length === 50`
- [ ] **recordScore updates puzzle progress** -- `recordScore('puzzle', 100)`; expect `progress.puzzlesCompleted` incremented
- [ ] **recordScore updates memory progress** -- `recordScore('memory', 100)`; expect `progress.memoryGamesWon` incremented
- [ ] **recordScore updates runner high score** -- `recordScore('runner', 500)`; expect `progress.runnerHighScore === 500` (if higher)
- [ ] **recordScore updates trivia progress** -- `recordScore('trivia', 100)`; expect `progress.triviaQuestionsAnswered` incremented
- [ ] **recordScore awards spin after 3 games** -- Record 3 non-spin games; expect `spins.available` incremented by 1
- [ ] **recordScore resets games count after awarding spin** -- After 3 games, `gamesCompletedSinceLastSpin` resets to 0
- [ ] **useSpin returns null when none available** -- `spins.available: 0`; returns `null`
- [ ] **useSpin decrements available and increments used** -- `spins.available: 3`; after `useSpin()`, available is 2, used incremented
- [ ] **claimSpinPrize marks spin as claimed** -- Claim a spin by id; expect `spin.claimed === true` in history
- [ ] **claimSpinPrize awards tires for tire prize** -- Prize with `type: 'tires', value: 50`; expect tires increased
- [ ] **offline mode queues scores in pendingSync** -- Set `isOffline: true`, record a score; expect `pendingSync.length > 0`
- [ ] **streak resets after 1+ day gap** -- `lastPlayedAt` 2 days ago; expect `currentStreak === 0`
- [ ] **streak increments on consecutive days** -- `lastPlayedAt` yesterday; expect `currentStreak` incremented
- [ ] **localStorage persistence** -- State saved to `asquare_games_state` with 30-day expiry
- [ ] **daily login spin awarded once per day** -- Mount twice on same day; expect only 1 spin awarded

#### Mocking Notes

- Must wrap in `AuthProvider` (or mock `useAuth` to return a user) since `GamesProvider` calls `useAuth()`
- Mock `firebase/firestore` for `onSnapshot`, `updateDoc`, `setDoc`, `increment`
- Mock `src/services/walletService` for `logTireTransaction`
- Mock `src/data/spinPrizes` `getRandomPrize()` for deterministic spin results
- Mock `navigator.onLine` for offline tests

---

### `src/contexts/BookingContext.tsx`

**Priority**: P2-MEDIUM
**Complexity**: Medium
**Test file**: `src/contexts/BookingContext.test.tsx`

#### Context Interface

Uses `useReducer` with actions: `SET_LOCATION`, `SET_LOCATIONS`, `SET_LOADING_LOCATIONS`, `SET_DATE`, `ADD_ITEM`, `REMOVE_ITEM`, `UPDATE_ITEM`, `SET_STEP`, `CLEAR_CART`, `RECALCULATE_TOTALS`.

Exposed via `useBooking()`:
- `selectedLocation`, `locations`, `loadingLocations`, `selectedDate`, `items`, `totalAmount`, `discountAmount`, `finalAmount`, `step`
- `setLocation(locationId)` -- persists to localStorage key `asquare_selected_location`
- `fetchLocations()` -- sets static locations from `getAllLocations()`
- `setDate(date)`, `setStep(step)`, `clearCart()`
- `addItem(activity, quantity, duration, timeSlot)` -- calculates price using `calculateItemPrice`
- `removeItem(index)`, `updateItemQuantity(index, quantity)`
- `calculateItemPrice(activity, quantity, duration, date, time)` -- applies `peakMultiplier` and duration multiplier

#### Test Cases

- [ ] **useBooking throws outside provider** -- Expect error `"useBooking must be used within a BookingProvider"`
- [ ] **initial state has today's date and empty items** -- `selectedDate` is today's ISO date, `items: []`, `step: 'location'`
- [ ] **setLocation persists to localStorage** -- Call `setLocation('kakinada')`; check localStorage key `asquare_selected_location`
- [ ] **locations populated on mount** -- Static locations from `getAllLocations()` loaded immediately
- [ ] **addItem calculates price correctly** -- Add item with `basePrice: 500`, quantity 2, duration 20, activity.duration 10; expect price = `500 * 2 * (20/10) * 1` = 2000
- [ ] **addItem applies peakMultiplier** -- Activity with `peakMultiplier: 1.5`, call during peak; expect multiplied price
- [ ] **removeItem removes by index** -- Add 2 items, remove index 0; expect only second item remains
- [ ] **updateItemQuantity recalculates price** -- Add item quantity 1, update to 3; expect price tripled
- [ ] **setStep changes step** -- `setStep('review')`; expect `step === 'review'`
- [ ] **clearCart resets to initial state** -- Add items, `clearCart()`; expect empty items, totals zero
- [ ] **calculateTotals applies combo discount** -- Add multiple items; expect `discountAmount` based on `calculateComboDiscount(items.length)`
- [ ] **finalAmount = totalAmount - discountAmount** -- Verify arithmetic

#### Mocking Notes

- Mock `src/lib/utils` for `isPeakHours` and `calculateComboDiscount`
- Mock `src/lib/locations` for `getAllLocations` and `normalizeStoredLocation`

---

## SECTION 2: Customer App Pages

---

### `src/pages/Checkout.tsx`

**Priority**: P0-CRITICAL
**Complexity**: Complex
**Test file**: `src/pages/Checkout.test.tsx`

#### Test Cases

- [ ] **redirects to /cart when cart is empty** -- Mount with empty items; expect `navigate('/cart')` called
- [ ] **renders order summary with item names and prices** -- Mount with 2 cart items; expect item names and formatted prices visible
- [ ] **subtotal, discount, and total displayed correctly** -- Verify summary math matches `getTotal()` and `getDiscountedTotal()`
- [ ] **wallet toggle hidden when walletBalance is 0** -- User with `walletBalance: 0`; expect wallet section absent
- [ ] **wallet toggle shown when walletBalance > 0** -- User with `walletBalance: 500`; expect "Use Wallet Balance" button visible
- [ ] **enabling wallet removes coupon** -- Apply coupon, toggle wallet on; expect `removeCoupon()` called
- [ ] **wallet toggle disables when no gokarting activity** -- Cart has helicopter only; expect wallet toggle disabled with `cursor-not-allowed`
- [ ] **wallet calculates remaining amount** -- `finalAmount: 1000`, `walletBalance: 300`; expect `walletAmountToUse: 300`, `remainingAmount: 700`
- [ ] **full wallet payment shows "Pay with Wallet"** -- `walletBalance >= finalAmount`; expect button text "Pay with Wallet"
- [ ] **free booking shows "Confirm Free Booking"** -- `finalAmount === 0`; expect button text with "Free Booking"
- [ ] **payment method selection shows 3 options** -- UPI, Credit/Debit Card, Net Banking buttons rendered
- [ ] **payment button disabled without method when remainingAmount > 0** -- No payment selected; button has `cursor-not-allowed`
- [ ] **payment button enabled with method selected** -- Select UPI; button becomes active
- [ ] **handlePayment redirects unauthenticated user to /activities** -- `user: null`; expect `navigate('/activities')`
- [ ] **processing state shows loader** -- During payment, "Processing Payment..." text and spinner visible
- [ ] **offline state shows "You are offline"** -- `isOnline: false`; expect button text "You are offline"
- [ ] **success screen shows order number** -- After payment success; expect "Payment Successful!" and order number
- [ ] **failed payment shows error modal with retry button** -- Mock payment to fail; expect "Payment Failed" and "Try Again" button
- [ ] **delayed payment shows "Go to My Bookings" button** -- Status modal with `type: 'delayed'`; expect navigation button

#### Mocking Notes

- Mock `useCart()`, `useAuth()`, `useGames()`, `useBooking()` return values
- Mock `bookingService` methods: `createDraftBooking`, `confirmDraftBooking`, `generateBillingId`, `updateBooking`, `getUserBookings`, `confirmRazorpayOrder`, `triggerPaymentFailedNotification`
- Mock `submitOrderToAPI`, `createRazorpayOrder`, `ensureUniqueOrderNumber`, `BRANCH_MAP`
- Mock `walletService` for `deductBalance`, `addBalance`
- Mock `razorpayService.initiatePayment` (dynamically imported)
- Mock `couponService.markCouponAsUsed`
- Mock `useOnlineStatus` hook

---

### `src/pages/Cart.tsx`

**Priority**: P1-HIGH
**Complexity**: Medium
**Test file**: `src/pages/Cart.test.tsx`

#### Test Cases

- [ ] **renders empty cart illustration** -- No items; expect "Your Cart is Lonely!" heading and "Go Racing!" button
- [ ] **renders cart items with names and prices** -- 2 items; expect item names visible
- [ ] **quantity controls increment and decrement** -- Click + and - buttons; expect `updateQuantity` called with correct args
- [ ] **minus button removes item at quantity 1** -- Item at quantity 1, click minus; expect `updateQuantity(id, 0)` called
- [ ] **remove button calls removeItem** -- Click trash icon; expect `removeItem(activityId)` called
- [ ] **clear all confirms before clearing** -- Click "Clear All"; expect `window.confirm` called, then `clearCart()`
- [ ] **items count badge shows correct count** -- 3 items; expect badge shows "3 Items"
- [ ] **location name displayed in header** -- Selected location "vizag"; expect `getLocationName` result visible
- [ ] **date picker shows formatted date** -- `cartDate: '2026-04-15'`; expect `formatDateLong` result visible
- [ ] **coupon input accepts and applies code** -- Type "TEST10", click "Apply"; expect `applyCoupon` called
- [ ] **coupon error displayed** -- `applyCoupon` returns error string; expect red error message
- [ ] **coupon success displayed** -- `applyCoupon` returns true; expect green success message
- [ ] **applied coupon shows with remove button** -- Coupon applied; expect coupon code and trash icon
- [ ] **discount displayed in bill details** -- Coupon gives discount; expect green "Discount" line
- [ ] **cashback displayed in bill details** -- Cashback coupon; expect "Wallet Cashback" line with amount
- [ ] **proceed button disabled without date** -- `cartDate` empty; expect button disabled
- [ ] **proceed navigates to /checkout for verified user** -- User with 10-digit phone; expect `navigate('/checkout')`
- [ ] **proceed shows VerificationModal for unverified user** -- User without phone; expect modal opens
- [ ] **offer price shows strikethrough original** -- Item with `offerPercent`; expect `line-through` on original price

#### Mocking Notes

- Mock `useCart()`, `useAuth()`, `useBooking()` return values
- Mock `src/lib/utils` for `formatCurrency`, `formatDateLong`, `getLocationName`, `getLocalISODate`

---

### `src/pages/Activities.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pages/Activities.test.tsx`

- [ ] Renders without crashing
- [ ] Loading spinner shown while fetching activities
- [ ] Error state displayed on fetch failure
- [ ] Category filters rendered from `getGameTypes()`
- [ ] Clicking category filters activities by `gameTypeId`
- [ ] Activity cards show name, price, and image
- [ ] Add-to-cart button calls `addItem` from `useCart()`
- [ ] Quantity controls shown for items already in cart
- [ ] Redirects to `/helicopter-bookings` when `?category=helicopter`
- [ ] Empty state when no activities match selected category
- [ ] Default category is "gokarting" when available

---

### `src/pages/ActivityDetails.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pages/ActivityDetails.test.tsx`

- [ ] Renders loading spinner while fetching activity
- [ ] Renders error state when activity not found
- [ ] Displays activity name, description, price, duration, min age
- [ ] Go-karting activity shows lap selection grid (6 options: 8, 12, 15, 20, 30, 50 laps)
- [ ] Selecting laps updates calculated price via `priceMultiplier`
- [ ] Helicopter activity shows duration selection (5, 10 minutes)
- [ ] Instructions list rendered (5 items)
- [ ] Safety guidelines list rendered (5 items)
- [ ] "Book Now" button calls `addItem` and navigates to `/cart`
- [ ] Price in CTA button matches calculated price
- [ ] Default image used on image load error

---

### `src/pages/MyBookings.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pages/MyBookings.test.tsx`

- [ ] Renders loading state with spinner
- [ ] Renders error state with retry button
- [ ] Upcoming tab shows confirmed bookings with future dates
- [ ] Past tab shows completed/cancelled bookings
- [ ] Booking card shows activity name, location, date, time
- [ ] QR code rendered for each booking
- [ ] Countdown displayed for upcoming bookings (days, hours, minutes)
- [ ] "Web Check-in" button shown for helicopter bookings
- [ ] "Load More Bookings" button shown when `hasMore` is true
- [ ] Empty state shown when no bookings in tab
- [ ] Mobile tabs switch between upcoming/past
- [ ] Clicking booking navigates to `/bookings/{id}`

---

### `src/pages/Profile.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pages/Profile.test.tsx`

- [ ] Renders without crashing
- [ ] User name, email, phone, tier displayed
- [ ] Tire count displayed from `useGames()`
- [ ] Edit mode toggles form fields
- [ ] Logout button calls `logout()`
- [ ] Daily tasks section with completion status
- [ ] Achievement badges displayed
- [ ] Social media links rendered
- [ ] Verification modal triggered for unverified users

---

### `src/pages/Wallet.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pages/Wallet.test.tsx`

- [ ] Renders wallet balance card with formatted amount
- [ ] Renders tire count card
- [ ] "Add Money" button opens top-up modal
- [ ] Quick amounts grid shows 500, 1000, 2500, 5000
- [ ] Clicking quick amount sets `topUpAmount`
- [ ] Custom amount input accepts numeric values
- [ ] Pay button disabled when `topUpAmount < 50`
- [ ] "View Full History" button opens history modal
- [ ] Transaction items show credit (green) and debit (red) indicators
- [ ] Tire transactions labeled as "Tires", wallet as "Cash"
- [ ] Loading skeleton shown while history loads
- [ ] Empty state shown when no transactions
- [ ] Recent activity section shows first 10 transactions

---

### `src/pages/SpinAndWin.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pages/SpinAndWin.test.tsx`

- [ ] Renders available spins counter from `useGames().spins.available`
- [ ] SpinWheel component rendered with prizes from `spinPrizes`
- [ ] Spin disabled when `spins.available === 0`
- [ ] "Get more spins below!" shown when no spins available
- [ ] "How to Earn More Spins" section shows 4 sources (Daily Login, First Booking, Refer Friends, Play Games)
- [ ] Prize tiers section shows common, grand, mega
- [ ] Recent wins list shown when `spins.history.length > 0`
- [ ] Stats section shows total, used, mega wins
- [ ] Prize won modal shown after spin complete
- [ ] "Claim Prize" button calls `claimSpinPrize`
- [ ] Tires prize shows "+{value} Tires"
- [ ] Discount prize shows "{value}% OFF"

---

### `src/pages/PlayAndWin.tsx`

**Priority**: P3-LOW
**Test file**: `src/pages/PlayAndWin.test.tsx`

- [ ] Renders without crashing
- [ ] Game cards displayed (3D Kart Dash, Spin the Wheel, etc.)
- [ ] Leaderboard section rendered
- [ ] Tire count shown from `useGames()`

---

### `src/pages/CheckInPage.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pages/CheckInPage.test.tsx`

- [ ] Renders loading state while fetching booking
- [ ] Renders booking info (activity, date, location)
- [ ] Passenger form fields shown based on config
- [ ] Time slot selection available
- [ ] Submit button triggers Firestore update
- [ ] Confetti shown on successful check-in
- [ ] BoardingPass component rendered after check-in

---

### `src/pages/HelicopterBookings.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pages/HelicopterBookings.test.tsx`

- [ ] Renders without crashing
- [ ] Hero video/placeholder image rendered
- [ ] Helicopter services section shows 4 service types
- [ ] Boarding steps shown (Check-in, Safety Brief, Takeoff)
- [ ] Early bird pricing displayed when applicable
- [ ] "Book Now" adds helicopter activity to cart
- [ ] Notify modal available for out-of-stock

---

### `src/pages/BookingDetails.tsx` -- P3-LOW

- [ ] Renders without crashing
- [ ] Booking details displayed (activity, date, amount, QR code)

### `src/pages/BoardingPassPage.tsx` -- P3-LOW

- [ ] Renders without crashing
- [ ] Boarding pass component rendered

### `src/pages/WaitingListDashboard.tsx` -- P3-LOW

- [ ] Renders without crashing

### `src/pages/LinksPage.tsx` -- P3-LOW (smoke test only)

- [ ] Renders without crashing

### `src/pages/LeadCaptureBirthday.tsx` -- P3-LOW (smoke test only)

- [ ] Renders without crashing
- [ ] LeadCaptureForm rendered with `sourceRef="birthday"`

### `src/pages/LeadCaptureCorporate.tsx` -- P3-LOW (smoke test only)

- [ ] Renders without crashing
- [ ] LeadCaptureForm rendered with `sourceRef="corporate"`

### `src/pages/LeadCaptureSchool.tsx` -- P3-LOW (smoke test only)

- [ ] Renders without crashing
- [ ] LeadCaptureForm rendered with `sourceRef="school"`

### `src/pages/PrivacyPolicy.tsx` -- P3-LOW (smoke test only)

- [ ] Renders without crashing

### `src/pages/PrivacySecurity.tsx` -- P3-LOW (smoke test only)

- [ ] Renders without crashing

### `src/pages/TermsAndConditions.tsx` -- P3-LOW (smoke test only)

- [ ] Renders without crashing

### `src/pages/ReturnRefundPolicy.tsx` -- P3-LOW (smoke test only)

- [ ] Renders without crashing

---

## SECTION 3: Customer App Components

---

### `src/components/VerificationModal.tsx`

**Priority**: P1-HIGH
**Complexity**: Medium
**Test file**: `src/components/VerificationModal.test.tsx`

#### Props

```typescript
interface VerificationModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}
```

#### Test Cases

- [ ] **returns null when isOpen is false** -- `isOpen={false}`; expect nothing rendered
- [ ] **renders modal with "Verify Phone Number" heading** -- `isOpen={true}`; expect heading present
- [ ] **pre-fills name, email, phone from user context** -- User with displayName, email, phone; expect fields populated
- [ ] **phone input limits to 10 digits, strips non-numeric** -- Type `"abc123456def0"` into phone; expect value is `"1234560000"` (10 chars max)
- [ ] **country code selector defaults to +91** -- Expect `<select>` default value `"+91"`
- [ ] **country code options include IN, US, UK, AU, UAE** -- 5 options rendered
- [ ] **validates 10-digit phone before sending OTP** -- Enter 5 digits, click "Send Verification OTP"; expect error `"Please enter a valid 10-digit mobile number"`
- [ ] **send OTP button calls sendOTP with country code + phone** -- Enter valid phone, click send; expect `sendOTP('+919876543210', 'verification-recaptcha-container')`
- [ ] **OTP step shows phone number and OTP input** -- After OTP sent, step changes to 'otp'; expect phone displayed and 6-digit input
- [ ] **OTP input limits to 6 digits** -- Type 8 chars; expect value limited to 6
- [ ] **verify button disabled when OTP < 6 digits** -- Enter 4 digits; button disabled
- [ ] **verify calls verifyOTP and updateUserProfile** -- Enter 6-digit OTP, submit; expect both called
- [ ] **verify calls onSuccess and onClose on success** -- Successful verification; expect both callbacks invoked
- [ ] **error displayed on send failure** -- `sendOTP` throws; expect error message in red box
- [ ] **error displayed on verify failure** -- `verifyOTP` throws; expect error message
- [ ] **"Back to details" button returns to first step** -- On OTP step, click back; expect details step shown
- [ ] **close button calls onClose** -- Click X button; expect `onClose()` called
- [ ] **recaptcha container div rendered** -- Expect element with `id="verification-recaptcha-container"`

#### Mocking Notes

- Mock `useAuth()` to return `user`, `sendOTP`, `verifyOTP`, `updateUserProfile`

---

### `src/components/SpinWheel.tsx`

**Priority**: P2-MEDIUM
**Complexity**: Medium
**Test file**: `src/components/SpinWheel.test.tsx`

#### Props

```typescript
interface SpinWheelProps {
  prizes: SpinPrize[]
  onSpinComplete: (prize: SpinPrize) => void
  disabled?: boolean
}
```

#### Test Cases

- [ ] **renders SVG wheel with correct number of segments** -- Pass 8 prizes; expect 8 SVG path elements
- [ ] **renders prize icons/labels on segments** -- Prize names visible in text elements
- [ ] **spin button disabled when `disabled={true}`** -- Expect button does not trigger animation
- [ ] **spin button triggers animation and calls onSpinComplete** -- Click spin; after animation, expect callback called with a prize
- [ ] **prevents double-spin while spinning** -- Click twice rapidly; second click ignored (isSpinning guard)
- [ ] **wheel rotation state tracked between spins** -- After spin, `currentRotation` updated for next spin offset

#### Mocking Notes

- Mock `framer-motion` `useAnimation` controls
- Since animation is async, may need `waitFor` or mock `controls.start` to resolve immediately

---

### `src/components/LeadCaptureForm.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/components/LeadCaptureForm.test.tsx`

#### Props

```typescript
interface Props {
  sourceRef: string  // "birthday" | "corporate" | "school"
  extraFields?: React.ReactNode
}
```

#### Test Cases

- [ ] **renders form with name, phone, email, branch, message fields** -- All fields present
- [ ] **branch dropdown populated from `getAllLocations()`** -- Expect location options rendered
- [ ] **phone validation rejects < 10 digits** -- Submit with 5 digits; expect error `"Please enter a valid 10-digit phone number."`
- [ ] **phone normalizes country codes** -- Input `"919876543210"`; normalized to `"9876543210"`
- [ ] **successful submission adds to Firestore "leads" collection** -- Expect `addDoc(collection(db, 'leads'), ...)` called with correct `sourceRef`
- [ ] **success state shows confirmation message** -- After submit, expect `submitted === true`
- [ ] **submitting state shows loading indicator** -- During submit, button disabled
- [ ] **extraFields rendered when provided** -- Pass custom JSX; expect it visible

#### Mocking Notes

- Mock `firebase/firestore` `addDoc`, `collection`
- Mock `src/lib/tracking` `trackLeadGenerated`

---

### `src/components/LocationSelectPopup.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/components/LocationSelectPopup.test.tsx`

#### Props

```typescript
interface LocationSelectPopupProps {
  onSelect: () => void
}
```

#### Test Cases

- [ ] **renders "Choose Your Location" heading** -- Expect heading present
- [ ] **renders location list from BookingContext.locations** -- Mock 5 locations; expect 5 buttons
- [ ] **clicking location calls setLocation and onSelect** -- Click a location; expect `setLocation(location.id)` and `onSelect()` called
- [ ] **loading state shows spinner** -- `loadingLocations: true`; expect spinner visible

---

### `src/components/Layout.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/components/Layout.test.tsx`

- [ ] Renders children via `<Outlet />`
- [ ] BottomNav rendered on mobile
- [ ] DesktopNav rendered on desktop (when `matchMedia` returns `matches: true` for `lg`)
- [ ] Floating cart button shown when `itemCount > 0` and not on /cart or /checkout
- [ ] Cart button hidden on /cart and /checkout paths
- [ ] HeaderLogo and HeaderUser hidden on /cart and /checkout paths
- [ ] Scroll resets on route change

---

### `src/components/ProfileGate.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/components/ProfileGate.test.tsx`

#### Props

```typescript
interface ProfileGateProps {
  user: { displayName?: string | null; phone?: string | null; email?: string | null }
  onComplete: (data: { phone: string; email: string }) => void
  onClose: () => void
}
```

#### Test Cases

- [ ] **renders "Complete Your Profile" heading** -- Expect heading visible
- [ ] **pre-fills phone and email from user prop** -- User with phone and email; expect input values match
- [ ] **phone validation rejects non-10-digit** -- Enter 5 digits, submit; expect error "Please enter a valid 10-digit phone number"
- [ ] **email validation rejects invalid format** -- Enter "notanemail", submit; expect error "Please enter a valid email address"
- [ ] **valid submission calls onComplete with stripped phone** -- Enter valid phone `"(987) 654-3210"` and email; expect `onComplete({ phone: '9876543210', email: '...' })`
- [ ] **close button calls onClose** -- Click X; expect `onClose()` called
- [ ] **check icon shown for valid phone** -- Enter 10-digit phone; expect CheckCircle icon visible
- [ ] **check icon shown for valid email** -- Enter valid email; expect CheckCircle icon visible

---

### Smoke Tests (P3-LOW)

### `src/components/ActivityBottomSheet.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/BoardingPass.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/BottomNav.tsx` -- Smoke test only

- [ ] Renders without crashing
- [ ] Nav items include expected paths

### `src/components/ExitIntentPopup.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/FlightCertificate.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/FlightStatusTracker.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/Footer.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/GokartIcon.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/GTMTracker.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/Header.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/NotifyModal.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/OfflineToast.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/SEO.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/components/TrackingProvider.tsx` -- Smoke test only

- [ ] Renders without crashing

---

## SECTION 4: Pipeline Admin Dashboards

---

All pipeline dashboards are thin wrappers around `RoleDashboardScene`. For example:

```typescript
// src/pipeline/pages/dashboard/OwnerDashboard.tsx
const OwnerDashboard = () => <RoleDashboardScene role="Owner" />;
```

### `src/pipeline/pages/dashboard/RoleDashboardScene.tsx`

**Priority**: P2-MEDIUM
**Complexity**: Complex
**Test file**: `src/pipeline/pages/dashboard/RoleDashboardScene.test.tsx`

The `RoleDashboardScene` accepts a `role: Role` prop and:
- Calls `getRoleConfig(role)` for dashboard title, greeting
- Calls `getTabsForRole(role)` for allowed module tabs
- Calls `getRoleMobileShortcuts(role)` for mobile action cards
- Calls `loadDashboardData()` for KPI snapshot
- Subscribes to real-time activity streams (reprints, protocols, vendors, leaves, overtime, refunds)
- Uses `useAuth()` for user session and `useLocations()` for branch filter
- Uses `useTheme()` for light/dark mode
- Renders `AppShell`, `KpiCard`, `ActionCard`, `EmptyState`, `StatusBadge`, `Skeleton`

#### Test Cases for RoleDashboardScene

- [ ] **renders dashboard title based on role** -- Pass `role="Owner"`; expect title from `getRoleConfig("Owner")`
- [ ] **renders KPI cards from loadDashboardData** -- Mock snapshot with 4 KPIs; expect 4 `KpiCard` components
- [ ] **renders action cards from getRoleMobileShortcuts** -- Mock 3 shortcuts; expect 3 `ActionCard` components
- [ ] **loading state shows Skeleton components** -- Before data loads; expect skeleton placeholders
- [ ] **empty state when no data** -- Dashboard returns empty; expect `EmptyState` component
- [ ] **redirects if user not authenticated** -- `useAuth()` returns null session; expect `Navigate` to login
- [ ] **activity stream renders for Owner/Admin** -- Role is "Owner"; expect activity items rendered

#### Per-Dashboard Smoke Tests

### `src/pipeline/pages/dashboard/OwnerDashboard.tsx`

- [ ] Renders `RoleDashboardScene` with `role="Owner"`

### `src/pipeline/pages/dashboard/AdminDashboard.tsx`

- [ ] Renders `RoleDashboardScene` with `role="Admin"`

### `src/pipeline/pages/dashboard/CashierDashboard.tsx`

- [ ] Renders `RoleDashboardScene` with `role="Cashier"`

### `src/pipeline/pages/dashboard/TelecallerDashboard.tsx`

- [ ] Renders `RoleDashboardScene` with `role="Telecaller"`

### `src/pipeline/pages/dashboard/TrackMarshallDashboard.tsx`

- [ ] Renders `RoleDashboardScene` with `role="TrackMarshall"`

### `src/pipeline/pages/dashboard/EditorDashboard.tsx`

- [ ] Renders `RoleDashboardScene` with `role="Editor"`

### `src/pipeline/pages/dashboard/DeveloperDashboard.tsx`

- [ ] Renders `RoleDashboardScene` with `role="Developer"`

### `src/pipeline/pages/dashboard/BackendDashboard.tsx`

- [ ] Renders `RoleDashboardScene` with `role="Backend"`

### `src/pipeline/pages/dashboard/ThirdPartyDashboard.tsx`

- [ ] Renders `RoleDashboardScene` with `role="ThirdParty"`

---

## SECTION 5: Pipeline Admin Modules

---

### `src/pipeline/pages/modules/BillingModule.tsx`

**Priority**: P1-HIGH
**Complexity**: Complex
**Test file**: `src/pipeline/pages/modules/BillingModule.test.tsx`

Sub-views: `pos`, `transactions`, `invoice`, `reprint`, `refunds`, `revenue`, `report`, `helicopter`

Uses: `ModulePageLayout`, `DataTable`, `DetailPanel`, `FilterBar`, `SummaryCards`, `BillingConfirmation`
API: `billingApi`, `listBranchActivityCatalog`, `lookupMemberByPhone`, `lookupAsquareCustomerByPhone`, `listCombos`, `shiftsApi`, `getLatestActiveShiftForUser`, `getLocationDayTotals`

- [ ] Renders sub-navigation with 7 tabs (POS, Transactions, Reprint, Refunds, Revenue, Report, Helicopter)
- [ ] POS view renders activity catalog for branch
- [ ] POS view has customer phone lookup via `lookupMemberByPhone`
- [ ] POS view calculates cart totals
- [ ] Transactions view renders DataTable with transaction rows
- [ ] Transactions view has date/branch filters via FilterBar
- [ ] Reprint view supports reprint approval flow
- [ ] Refunds view renders refund processing interface
- [ ] Revenue view shows SummaryCards with day totals
- [ ] Report view renders branch-level reporting
- [ ] Helicopter view renders helicopter-specific billing
- [ ] Unauthorized user redirected (auth check from `useAuth`)
- [ ] Receipt print calls `printTransactionReceipt`

---

### `src/pipeline/pages/modules/TrackModule.tsx`

**Priority**: P1-HIGH
**Complexity**: Complex
**Test file**: `src/pipeline/pages/modules/TrackModule.test.tsx`

Sub-views: `board`, `scanner`, `karts`, `waiting`, `sessions`, `queue`, `incidents`

Uses: `ModulePageLayout`, `DataTable`, `DetailPanel`, lazy-loaded `ScannerModule`, `KartsDashboard`, `WaitingListAdmin`
API: `trackApi`

- [ ] Renders sub-navigation with 7 tabs (Board, Scanner, Karts, Waiting List, Sessions, Queue, Incidents)
- [ ] Board view shows live track status
- [ ] Scanner view lazy-loaded with Suspense fallback
- [ ] Karts view renders `KartsDashboard` component
- [ ] Waiting List view renders `WaitingListAdmin` component
- [ ] Sessions view shows DataTable with session records
- [ ] Queue view shows queue management interface
- [ ] Incidents view shows incident log with DataTable
- [ ] Unauthorized user redirected

---

### `src/pipeline/pages/modules/AdminModule.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/pages/modules/AdminModule.test.tsx`

- [ ] Renders without crashing
- [ ] Module page layout rendered with correct title
- [ ] Unauthorized user redirected

### `src/pipeline/pages/modules/ActivitiesModule.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/pages/modules/ActivitiesModule.test.tsx`

- [ ] Renders without crashing
- [ ] Activity catalog loaded for selected branch
- [ ] CRUD operations for activities available

### `src/pipeline/pages/modules/BookingsModule.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/pages/modules/BookingsModule.test.tsx`

- [ ] Renders without crashing
- [ ] Booking list loaded in DataTable
- [ ] Filter by branch, date, status
- [ ] Booking detail panel opens on row click

### `src/pipeline/pages/modules/LeadsModule.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/pages/modules/LeadsModule.test.tsx`

- [ ] Renders without crashing
- [ ] Leads DataTable rendered
- [ ] Filter by source, branch, status
- [ ] Lead detail panel opens on row click

### `src/pipeline/pages/modules/ReportsModule.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/pages/modules/ReportsModule.test.tsx`

- [ ] Renders without crashing
- [ ] Report filters (date range, branch) rendered
- [ ] Summary cards displayed

### `src/pipeline/pages/modules/ShiftsModule.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/pages/modules/ShiftsModule.test.tsx`

- [ ] Renders without crashing
- [ ] Shift list displayed in DataTable
- [ ] Shift creation form available

### `src/pipeline/pages/modules/CouponsModule.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/pages/modules/CouponsModule.test.tsx`

- [ ] Renders without crashing
- [ ] Coupon list rendered
- [ ] Create/edit coupon form available

### `src/pipeline/pages/modules/AccountingModule.tsx`

**Priority**: P3-LOW
**Test file**: `src/pipeline/pages/modules/AccountingModule.test.tsx`

- [ ] Renders without crashing

### `src/pipeline/pages/modules/WorkspacesModule.tsx`

**Priority**: P3-LOW
**Test file**: `src/pipeline/pages/modules/WorkspacesModule.test.tsx`

- [ ] Renders without crashing

### `src/pipeline/pages/modules/TasksModule.tsx`

**Priority**: P3-LOW
**Test file**: `src/pipeline/pages/modules/TasksModule.test.tsx`

- [ ] Renders without crashing

### `src/pipeline/pages/modules/FilesModule.tsx`

**Priority**: P3-LOW
**Test file**: `src/pipeline/pages/modules/FilesModule.test.tsx`

- [ ] Renders without crashing

### `src/pipeline/pages/modules/SettingsModule.tsx`

**Priority**: P3-LOW
**Test file**: `src/pipeline/pages/modules/SettingsModule.test.tsx`

- [ ] Renders without crashing

---

## SECTION 6: Pipeline Admin Components

---

### `src/pipeline/components/ui/DataTable.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/components/ui/DataTable.test.tsx`

#### Props

```typescript
interface DataTableProps<RowT> {
  columns: Array<DataTableColumn<RowT>>
  rows: RowT[]
  rowKey: (row: RowT) => string
  emptyMessage?: string
  onRowClick?: (row: RowT) => void
}

interface DataTableColumn<RowT> {
  key: string
  header: string
  render: (row: RowT) => ReactNode
}
```

- [ ] **renders table headers from columns** -- 3 columns; expect 3 `<th>` elements with header text
- [ ] **renders rows using render function** -- 2 rows; expect 2 `<tr>` in tbody
- [ ] **shows emptyMessage when no rows** -- Empty rows array; expect "No records found." text
- [ ] **custom emptyMessage displayed** -- Pass `emptyMessage="Nothing here"`; expect custom text
- [ ] **onRowClick called on row click** -- Click a row; expect callback called with row data
- [ ] **actions column right-aligned** -- Column with `key: "actions"`; expect `text-right` class

---

### `src/pipeline/components/ui/KpiCard.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/components/ui/KpiCard.test.tsx`

#### Props

```typescript
interface KpiCardProps {
  label: string
  value: string
  tone: "success" | "warning" | "critical" | "info" | "muted"
}
```

- [ ] **renders label and value** -- `label="Revenue"`, `value="$10,000"`; expect both visible
- [ ] **StatusBadge rendered with correct tone** -- `tone="success"`; expect success badge
- [ ] **framer-motion animation applied** -- Expect `motion.article` rendered

---

### `src/pipeline/components/ui/EmptyState.tsx`

**Priority**: P3-LOW
**Test file**: `src/pipeline/components/ui/EmptyState.test.tsx`

#### Props

```typescript
{ title: string; description: string }
```

- [ ] **renders title and description** -- Pass title and description; expect both visible in DOM
- [ ] **has dashed border styling** -- Expect `border-dashed` class

---

### `src/pipeline/components/ui/StatusBadge.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/components/ui/StatusBadge.test.tsx`

#### Props

```typescript
{ tone: Tone; children?: ReactNode; className?: string }
```

Tones: `success`, `warning`, `critical`, `info`, `muted`

- [ ] **renders tone text as default children** -- `tone="success"` with no children; expect text "success"
- [ ] **renders custom children** -- `children="Active"`; expect text "Active"
- [ ] **applies tone-specific classes** -- `tone="critical"`; expect `bg-critical/10` class
- [ ] **accepts custom className** -- Pass `className="extra"`; expect class present

---

### `src/pipeline/components/ui/ConfirmDialog.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/components/ui/ConfirmDialog.test.tsx`

#### Props

```typescript
{
  open: boolean
  title: string
  description: ReactNode
  confirmLabel?: string  // defaults to "Confirm"
  onConfirm: () => void
  onCancel: () => void
}
```

- [ ] **returns null when open is false** -- `open={false}`; expect nothing rendered
- [ ] **renders title and description when open** -- `open={true}`; expect both visible
- [ ] **confirm button uses custom label** -- `confirmLabel="Delete"`; expect "Delete" button text
- [ ] **confirm button defaults to "Confirm"** -- No `confirmLabel`; expect "Confirm"
- [ ] **cancel button calls onCancel** -- Click "Cancel"; expect callback
- [ ] **confirm button calls onConfirm** -- Click confirm; expect callback

---

### `src/pipeline/components/ui/FormDrawer.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/components/ui/FormDrawer.test.tsx`

#### Props

```typescript
{
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}
```

- [ ] **returns null when open is false** -- `open={false}`; expect nothing rendered
- [ ] **renders title and children when open** -- `open={true}`; expect title and child content
- [ ] **close button calls onClose** -- Click "Close"; expect callback

---

### `src/pipeline/components/ui/ModalShell.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/components/ui/ModalShell.test.tsx`

#### Props

```typescript
interface ModalShellProps {
  open: boolean
  onClose: () => void
  maxWidth?: string  // defaults to "max-w-lg"
  children: ReactNode
}
```

- [ ] **returns null when open is false** -- `open={false}`; expect nothing rendered
- [ ] **renders children when open** -- `open={true}`; expect child content in dialog
- [ ] **Escape key calls onClose** -- Press Escape; expect `onClose()` called
- [ ] **clicking backdrop calls onClose** -- Click outside dialog; expect `onClose()` called
- [ ] **clicking inside dialog does not close** -- Click dialog content; expect `onClose()` NOT called
- [ ] **custom maxWidth applied** -- `maxWidth="max-w-2xl"`; expect class present
- [ ] **dialog has aria-modal="true"** -- Expect accessibility attribute
- [ ] **dialog focused on open** -- Expect focus via `dialogRef.current?.focus()`

---

### `src/pipeline/components/ui/DetailPanel.tsx`

**Priority**: P3-LOW
**Test file**: `src/pipeline/components/ui/DetailPanel.test.tsx`

```typescript
{ title: string; children: ReactNode }
```

- [ ] **renders title and children** -- Pass title and JSX children; expect both visible

---

### `src/pipeline/components/ui/FilterBar.tsx`

**Priority**: P3-LOW
**Test file**: `src/pipeline/components/ui/FilterBar.test.tsx`

```typescript
FilterBar: { children: ReactNode }
FilterField: { label: string; children: ReactNode }
```

- [ ] **FilterBar renders children** -- Pass input elements; expect visible
- [ ] **FilterField renders label and children** -- Pass label and select; expect both visible

---

### `src/pipeline/components/ui/ActionCard.tsx`

**Priority**: P2-MEDIUM
**Test file**: `src/pipeline/components/ui/ActionCard.test.tsx`

#### Props

```typescript
interface ActionCardProps {
  label: string
  description: string
  hotkey?: string
  tone?: Tone  // defaults to "info"
  to?: string
  onClick?: () => void
  disabled?: boolean
}
```

- [ ] **renders label and description** -- Pass both; expect visible
- [ ] **navigates when `to` provided** -- Pass `to="/billing"`; click; expect `navigate("/billing")`
- [ ] **calls onClick when provided** -- Pass callback; click; expect called
- [ ] **disabled state prevents click** -- `disabled={true}`; click; expect no navigation or callback
- [ ] **hotkey displayed** -- `hotkey="Ctrl+B"`; expect "Shortcut: Ctrl+B" text
- [ ] **StatusBadge rendered with tone** -- `tone="warning"`; expect badge

---

### `src/pipeline/components/ui/SummaryCards.tsx`

**Priority**: P3-LOW
**Test file**: `src/pipeline/components/ui/SummaryCards.test.tsx`

```typescript
interface SummaryCardItem {
  id: string; label: string; value: string; tone: Tone
}
{ items: SummaryCardItem[] }
```

- [ ] **renders a KpiCard for each item** -- 4 items; expect 4 KpiCard components
- [ ] **passes label, value, tone to each KpiCard** -- Verify props

---

### Remaining Smoke Tests (P3-LOW)

### `src/pipeline/components/ui/Skeleton.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/pipeline/components/ui/AsyncContent.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/pipeline/components/ui/FeedbackBanner.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/pipeline/components/ui/MetricStrip.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/pipeline/components/ui/PermissionGate.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/pipeline/components/ui/SourceBadge.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/pipeline/components/ui/CallTypeBadge.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/pipeline/components/ui/ActionIconButton.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/pipeline/components/ui/GameDrillDownModal.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/pipeline/components/ui/TaskChatPanel.tsx` -- Smoke test only

- [ ] Renders without crashing

### `src/pipeline/components/ui/TaskNotificationCenter.tsx` -- Smoke test only

- [ ] Renders without crashing

---

### Pipeline Layout Components (P3-LOW -- Smoke Tests)

### `src/pipeline/components/layout/AppShell.tsx`

- [ ] Renders without crashing
- [ ] Children rendered inside layout

### `src/pipeline/components/layout/Sidebar.tsx`

- [ ] Renders without crashing

### `src/pipeline/components/layout/Topbar.tsx`

- [ ] Renders without crashing

### `src/pipeline/components/layout/ModulePageLayout.tsx`

- [ ] Renders without crashing
- [ ] Title and children rendered

### `src/pipeline/components/layout/MobileNavDrawer.tsx`

- [ ] Renders without crashing

---

## Implementation Priority Order

| Phase | Scope | Est. Test Files | Notes |
|-------|-------|-----------------|-------|
| **Phase 1** | CartContext, Checkout, Cart, VerificationModal | 4 | P0-CRITICAL + P1-HIGH: payment flow, coupon logic |
| **Phase 2** | AuthContext, ProfileGate | 2 | P1-HIGH: auth flows, form validation |
| **Phase 3** | GamesContext, BookingContext | 2 | P2-MEDIUM: game state, booking state |
| **Phase 4** | Activities, ActivityDetails, MyBookings, Wallet, SpinAndWin | 5 | P2-MEDIUM: core customer pages |
| **Phase 5** | Pipeline UI components (DataTable, KpiCard, ConfirmDialog, ModalShell, etc.) | 8 | P2-MEDIUM: reusable admin components |
| **Phase 6** | RoleDashboardScene + per-role smoke tests | 2 | P2-MEDIUM: dashboard rendering |
| **Phase 7** | Pipeline modules (BillingModule, TrackModule, etc.) | 14 | P1-P3 mix: module integration |
| **Phase 8** | All remaining smoke tests | ~30 | P3-LOW: all static pages, icons, wrappers |

**Total estimated test files: ~67**

---

## Running Tests

```bash
# Run all tests
npx vitest run

# Run tests in watch mode
npx vitest

# Run specific test file
npx vitest run src/contexts/CartContext.test.tsx

# Run tests with coverage
npx vitest run --coverage

# Run only P0/P1 tests by pattern
npx vitest run --testPathPattern="(CartContext|Checkout|Cart|AuthContext|VerificationModal)"
```
