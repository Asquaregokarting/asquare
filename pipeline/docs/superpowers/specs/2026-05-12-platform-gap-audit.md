# A Square Platform — Gap Audit (in progress)

Started: 2026-05-12 (overnight self-paced loop)

Auditing each subsystem across six recurring patterns:

1. **Idempotency / dedup at write**
2. **State-machine without validation**
3. **Cascade discipline** (soft-delete, location normalization, etc.)
4. **Cleanup / expiry paths**
5. **Audit / observability completeness**
6. **Server-side enforcement**

Impact tags: **HIGH** = money / audit-failure / customer-visible; **MED** = correctness drift; **LOW** = hygiene.

---

## Audit progress

- [x] Vendor share / GST / ledgers
- [x] Go-Kart Scanner
- [x] Customer-app bookings + Razorpay
- [x] Coupons + discount controls
- [x] POS (beyond the fixes already shipped)
- [x] Telecaller / lead bookings
- [x] Invoices
- [x] Settlements (linked to vendor-ledger fix 3)
- [x] Reports
- [x] Incharge dashboards
- [x] Track reports / Kart Reports
- [x] Event campaigns
- [x] Bookings state machine (cross-cutting)
- [x] Shifts / cashier checkout (already touched, do dedicated sweep)

---

## 1. Vendor share / GST / ledgers — audited 2026-05-12

### Pattern 1 — Idempotency / dedup
- ✅ Doc id scheme (`le-{bookingId}-{vendorId}`, `le-refund-{bookingId}-{vendorId}`) — clean.
- ⚠️ **MED** — `le-cancel-{transactionId}-{vendorId}` is **deleted** in [billing-firestore.ts:1547](src/pipeline/api/billing-firestore.ts#L1547) but **never written**. Dead doc-id-shape, leaves a collision risk if anyone re-introduces.
- ⚠️ **MED** — Cancellation tear-down uses `referenceId === bookingId` ([vendor-ledger-sync.js:138](functions/lib/vendor-ledger-sync.js#L138)); client-side cleanup uses `referenceId === transactionId` ([billing-firestore.ts:1554-1559](src/pipeline/api/billing-firestore.ts#L1554-L1559)). Same field, different value vocabularies.

### Pattern 2 — State-machine without validation
- ⚠️ **HIGH** — No enforced transition for `vendorInvoices` status (draft → locked → cheque issued → paid). Anyone with the write token can jump straight to paid.
- ⚠️ **HIGH** — Refund + cancel interaction: cancel deletes ALL ledger rows including refund debits, losing refund evidence.
- ⚠️ **MED** — `discrepancy_correction` / `manual_adjustment` entries have no "one per (booking, vendor)" guard.

### Pattern 3 — Cascade discipline ⚠️ CRITICAL
- ⚠️ **HIGH** — **Soft-delete leak.** Trigger checks `cancelled === true` only ([line 129](functions/lib/vendor-ledger-sync.js#L129)) — does NOT check `deletedAt`. Soft-deleted bookings still get credits.
- ⚠️ **HIGH** — `pickTransactionDate` falls back to `nowIso()` ([line 118](functions/lib/vendor-ledger-sync.js#L118)) — known cluster-stamping path that audit scripts catch but don't prevent.
- ⚠️ **MED** — `locationId` on ledger row written as-is ([line 711](functions/lib/vendor-ledger-sync.js#L711)) — fragments location-scoped reports.
- ⚠️ **MED** — `vendorIds` reconciliation only adds, never removes ([line 869-870](functions/lib/vendor-ledger-sync.js#L869-L870)).

### Pattern 4 — Cleanup / expiry
- ⚠️ **HIGH** — Soft-deleted booking → orphan credit rows (consequence of Pattern 3.1).
- ⚠️ **MED** — Deleted vendorDetails → orphan ledger rows referencing dead vendor.
- ⚠️ **MED** — No archive policy for paid vendorInvoices.

### Pattern 5 — Audit / observability
- ⚠️ **HIGH** — `merge: true` on every write means **previous values are lost** on overwrite. Append-only is the audit-grade pattern; we have merge-overwrite.
- ⚠️ **MED** — `pickInvoiceNumber` falls back to `bookingId` ([line 122](functions/lib/vendor-ledger-sync.js#L122)) — pollutes vendor invoicing.
- ⚠️ **MED** — Multiple `console.warn` catch blocks swallow errors silently.
- ⚠️ **MED** — No "reconciliation log" for `discrepancy_correction` entries.
- ⚠️ **MED** — 5-min cached matcher TTL — same-vendor-different-share changes go unreconciled.

### Pattern 6 — Server-side enforcement
- ⚠️ **HIGH** — vendorLedger + vendorInvoices writable client-side (intentional per project memory; auditor risk).
- ⚠️ **HIGH** — Settlements view re-derives from bookings, not the ledger. Two systems of truth → the recurring ledger-vs-settlements drift.
- ⚠️ **MED** — `accountingApi.createLedgerAdjustment` is client-side.

**Top 3 recommended fixes:** soft-delete cascade in trigger · drop bookingId fallback for invoiceNumber · pick one source of truth between vendorLedger and Settlements.

---

<!-- New subsystem audits appended below by the overnight loop -->

## 2. Go-Kart Scanner — audited 2026-05-12

### Pattern 1 — Idempotency / dedup
- ✅ `verifySerials`, `startRide`, `markRideDone` all use `runTransaction` ([scannerApi.ts:299, 379, 421](src/pipeline/features/track/scanner/services/scannerApi.ts#L299)) — atomic per-booking.
- ✅ `reserveSerials` uses `runTransaction` ([serial-counters.ts:83](src/pipeline/api/serial-counters.ts#L83)).
- ⚠️ **HIGH** — `reserveSerialsForItems` ledger writes use `addDoc` with auto IDs ([serial-counters.ts:142](src/pipeline/api/serial-counters.ts#L142)). If the caller retries (after a flaky network), two ledger entries get written for the same item — duplicate `serialLedger` rows. Should use a deterministic doc id like `sl-{documentId}-{idx}`.
- ⚠️ **MED** — `createPendingScan` uses `addDoc` ([firestoreScans.ts:22](src/pipeline/features/track/scanner/services/firestoreScans.ts#L22)). Re-scanning the same booking on the same day creates N pending scan docs. No `(bookingId, locationId, date)` dedup key.
- ⚠️ **MED** — `completeScan` accepts any `scanId` and overwrites it ([firestoreScans.ts:45](src/pipeline/features/track/scanner/services/firestoreScans.ts#L45)). No ownership check — anyone with the id can flip status.

### Pattern 2 — State-machine without validation
- ⚠️ **HIGH** — `markRideDone` ([scannerApi.ts:421](src/pipeline/features/track/scanner/services/scannerApi.ts#L421)) sets status to `completed` regardless of the current status. A serial can jump `pending → completed` without ever being `riding`. No transition guard.
- ⚠️ **MED** — `verifySerials` blocks re-verifying a `completed` serial ([line 334-336](src/pipeline/features/track/scanner/services/scannerApi.ts#L334)) but happily flips a `riding` serial to `completed`, losing the in-progress evidence.
- ⚠️ **MED** — `scans` collection's `status: pending → completed` has no reverse guard. `completeScan` is unconditional `updateDoc`.
- ⚠️ **MED** — `bookingStatus` check excludes `rescheduled` ([line 235-237](src/pipeline/features/track/scanner/services/scannerApi.ts#L235)). A rescheduled ticket on its new date can't be scanned.

### Pattern 3 — Cascade discipline ⚠️ CRITICAL
- ⚠️ **HIGH** — `lookupBill` does NOT check `deletedAt`. A soft-deleted booking can still be scanned and serials marked used. The booking is "dead" in admin views but burns inventory. Matches the global cascade-discipline gap.
- ⚠️ **HIGH** — `lookupBill` does NOT check `cancelled`. Cancelled bookings can still be scanned.
- ⚠️ **MED** — Past-date scanning unblocked: `sessionDateStr > today` rejects future tickets but accepts arbitrarily old ones ([line 259-261](src/pipeline/features/track/scanner/services/scannerApi.ts#L259)). A 6-month-old ticket scans clean.
- ⚠️ **MED** — No location enforcement: a Vizag-purchased ticket can be scanned at Kakinada with no warning. Could be intentional cross-branch but no audit signal.

### Pattern 4 — Cleanup / expiry
- ⚠️ **MED** — `scans` collection: no retention policy. Docs accumulate forever.
- ⚠️ **MED** — `serialLedger` collection: same — no purge.
- ⚠️ **MED** — Orphan pending scans: customer no-show leaves a `pending` scan that's never completed. No auto-expire after end-of-day.
- ⚠️ **LOW** — `serialCounters` docs for past dates stay in collection (small, but no archive).

### Pattern 5 — Audit / observability
- ⚠️ **HIGH** — **`verifySerials` does NOT write to `scans` collection.** The scans collection is populated by `createPendingScan`/`completeScan` only — a separate code path. The actual "mark serial used" action (`verifySerials`) leaves an embedded record on the booking doc and nothing in `scans`. Two parallel audit trails that may not agree.
- ⚠️ **MED** — `verifiedBy` stores `userName` (string), not userId. Two staff with similar names → unresolvable in audit.
- ⚠️ **MED** — `markRideDone` doesn't preserve `kartNumber` in audit if it was overwritten by another `startRide`. History lost.
- ⚠️ **MED** — Failed `lookupBill` attempts (invalid/forged QR) are not logged. Can't detect attempted fraud.
- ⚠️ **HIGH** — **QR checksum is mod-10000 ([line 148-153](src/pipeline/features/track/scanner/services/scannerApi.ts#L148))** — not signed, not cryptographic. Anyone who knows the format can forge a valid QR for any invoice number. The whole "checksum validation failed" message is theater against a casual attacker; a script with the algorithm bypasses it.

### Pattern 6 — Server-side enforcement
- ⚠️ **HIGH** — All scanner mutations are client-side transactions. Anyone with a Firestore write token can directly write `serials[i].status = "completed"` on a booking, bypassing `verifySerials` entirely.
- ⚠️ **HIGH** — `verifySerials` has no role check ([line 285](src/pipeline/features/track/scanner/services/scannerApi.ts#L285)). Any authenticated user can mark a ride as used. Should be Track Marshall / Cashier only.
- ⚠️ **MED** — `startRide` accepts any string for `kartNumber`. No validation against a karts collection or "is this kart in service" check.
- ⚠️ **MED** — Cross-branch verification not gated: a Vizag TM could mark serials for a Kakinada booking.

**Top recommended fixes:** soft-delete + cancelled checks in `lookupBill` · sign QRs (HMAC) instead of checksum · `verifySerials` writes a `scans` row so audit trail is unified · role check on `verifySerials`.

---

## 3. Customer-app bookings + Razorpay — audited 2026-05-12

### Pattern 1 — Idempotency / dedup
- ✅ Razorpay webhook signs raw body bytes ([razorpay.js:322-327](functions/api/razorpay.js#L322)) — correct HMAC verification.
- ✅ Helicopter counter has idempotency guard `helicopterCountIncremented` ([line 406, 527](functions/api/razorpay.js#L406)).
- ✅ Confirmation send has guard `interakt.outboundRequestedAt` ([line 430, 551](functions/api/razorpay.js#L430)).
- ✅ Online order amount tampering check ([online-order.js:78](functions/api/online-order.js#L78)) — client must send the exact expected paise.
- ⚠️ **MED** — Both `payment_link.paid` and `payment.captured` events flip `paymentStatus: 'completed'` and overwrite `paidAmount`. If both fire (Razorpay does sometimes send overlapping events), `paidAmount` ends up as whichever arrived last. Usually equal, but for partial captures / amount-mismatch edge it's lossy.
- ⚠️ **MED** — `interakt_message_requests` collection writes are unbounded ([line 280-287](functions/api/razorpay.js#L280)) — grows forever.

### Pattern 2 — State-machine without validation
- ⚠️ **HIGH** — `amount_mismatch` status terminus: when the webhook sees `paid < expected`, booking is marked `paymentStatus: 'amount_mismatch'` ([line 365](functions/api/razorpay.js#L365)) and returns 200. **No admin UI to resolve** — the booking sits in this state forever, no notification, no auto-retry.
- ⚠️ **HIGH** — `payment_link.expired` / `payment_link.cancelled` events only set `paymentLinkStatus`, NOT `paymentStatus` ([line 461-476](functions/api/razorpay.js#L461)). A booking can be `paymentStatus: 'pending'` + `paymentLinkStatus: 'cancelled'` indefinitely.
- ⚠️ **HIGH** — `pending` → `cancelled` flow doesn't release inventory: timeSlot reservations, kart slots, coupon usage counters all stay claimed.
- ⚠️ **MED** — Booking statuses `confirmed | pending | cancelled | rescheduled` per CLAUDE.md have no transition guard — anywhere `setDoc(..., {merge:true})` writes a new bookingStatus, it's accepted.

### Pattern 3 — Cascade discipline
- ⚠️ **HIGH** — `paidAmountPaise < expectedPaise` triggers mismatch ([line 360, 493](functions/api/razorpay.js#L360)), but `paidAmountPaise > expectedPaise` (overpayment) is **silently accepted**. Real overpayment revenue gets bucketed as the expected amount; the surplus disappears.
- ⚠️ **MED** — `walletAmountUsed` is read from the booking doc at webhook time. Race: customer modifies wallet between order creation and webhook receipt → expected paise drifts.
- ⚠️ **MED** — `source` field stamped only when missing AND `createdByAdminId` set ([line 380-386](functions/api/razorpay.js#L380)). Customer-app bookings missing `source` slip through; the mapper later defaults to `'POS'` (per CLAUDE.md), and the vendor-ledger-sync labels their credits as POS source.
- ⚠️ **MED** — `paidAmount` stored as `paidAmountPaise / 100` (lossy float division). For audit-grade money handling, store paise as integer.

### Pattern 4 — Cleanup / expiry
- ⚠️ **HIGH** — Pending bookings never expire. Abandoned-cart cron handles `cart` items but not standalone pending bookings (the cron's surface is `carts`, not `bookings`).
- ⚠️ **HIGH** — `amount_mismatch` bookings have no cleanup, alerting, or auto-reconciliation. They accumulate silently.
- ⚠️ **MED** — `interakt_message_requests` collection — no retention policy.
- ⚠️ **MED** — Wallet topup orders (`TOPUP-...`) — if Razorpay never confirms, the topup order doc is orphan.

### Pattern 5 — Audit / observability
- ⚠️ **HIGH** — `amount_mismatch` logged via `logger.error` ([line 361-363](functions/api/razorpay.js#L361)) but no admin notification, no Owner dashboard surface, no Discrepancies tab entry. Owner doesn't know about it.
- ⚠️ **MED** — `Post-payment processing error` ([line 458, 578](functions/api/razorpay.js#L458)) caught and logged but no retry, no surface to the customer. Confirmation failure is silent.
- ⚠️ **MED** — No "razorpay event audit log" — webhook events are processed but not persisted. Debugging "why is this booking in amount_mismatch?" requires sifting Cloud Logging.
- ⚠️ **LOW** — `paidAmount: paidAmountPaise / 100` — lossy display value. Store paise for audit precision.

### Pattern 6 — Server-side enforcement
- ✅ Webhook HMAC validation against raw body bytes ([line 322-329](functions/api/razorpay.js#L322)) — robust.
- ✅ `createOnlineOrder` requires Firebase ID token + matches client amount to server-computed expected ([line 30-40, 78](functions/api/online-order.js#L30)).
- ✅ `sendRazorpayPaymentLink` requires internal API key or admin token ([line 44-58](functions/api/razorpay.js#L44)).
- ⚠️ **MED** — Bookings can be created client-side directly via `createUnifiedBooking` with `paymentStatus: 'pending'`. Anyone with a Firestore write token can write a fake booking and downstream effects (vendor-ledger-sync trigger fires on every booking write, even pending — but only credits completed ones).
- ⚠️ **MED** — `walletAmountUsed` is computed client-side. Tamper-resistant only because the webhook re-reads it from the booking doc; but the client wrote that value, so the only check is that the same number was used during order creation.
- ⚠️ **MED** — Topup cap of ₹100,000 ([online-order.js comment line 53-56](functions/api/online-order.js#L53)) — soft cap, no rate-limit (one user could create N topups of ₹100k each).

**Top recommended fixes:** surface `amount_mismatch` bookings to Owner Discrepancies tab · auto-expire `pending` bookings after N hours · accept overpayments as a distinct status with explicit Owner action · release inventory on cancel/expire · persist Razorpay events to a debug-audit collection.

---

## 4. Coupons + discount controls — audited 2026-05-12

### Pattern 1 — Idempotency / dedup
- ⚠️ **HIGH** — **Validate-then-apply race.** `validateCouponForCart` ([validateCoupon.ts:72](src/pipeline/features/billing/validateCoupon.ts#L72)) reads `usedCount` and checks against `maxUsageCount`, then booking commit happens, then `markCouponAsUsed` increments `usedCount` ([couponService.ts:438-441](src/services/couponService.ts#L438)). Two concurrent redemptions both see `usedCount=N`, both pass validation, both increment → final `usedCount = N+2` past the cap. The `increment` is atomic, but the check/act gap isn't transactional.
- ⚠️ **HIGH** — `markCouponAsUsed` iterates the user's coupon subcollection and marks **every** doc with matching code as used ([couponService.ts:422-427](src/services/couponService.ts#L422)). If a user holds multiple coupons with the same code (the member_150 path issues many), one redemption invalidates all of them.
- ⚠️ **MED** — Coupon code generation: `Math.floor(1000 + Math.random() * 9000)` ([couponService.ts:384](src/services/couponService.ts#L384)) gives 9,000 possible suffixes. With thousands of generated coupons, collisions are statistically likely. No uniqueness check before write.
- ⚠️ **MED** — `generateUserCoupon` uses `addDoc` ([couponService.ts:406](src/services/couponService.ts#L406)) — no idempotency. Calling it twice for the same prize creates two coupons.

### Pattern 2 — State-machine without validation
- ⚠️ **HIGH** — Coupon `isUsed` boolean has no transition guard. A `setDoc(..., {isUsed: false}, {merge:true})` can flip a used coupon back to unused. No audit signal.
- ⚠️ **HIGH** — Global `usedCount` can be decremented or zeroed by any direct Firestore write. `increment` is atomic but only protects ordered increments.
- ⚠️ **MED** — `isActive` flag on coupons can flip freely. No audit log of activation/deactivation events.
- ⚠️ **MED** — Vendor coupon `allowedMobile` and `createdByVendorId` are client-validated only ([validateCoupon.ts:58-64, 197-208](src/pipeline/features/billing/validateCoupon.ts#L58)). A booking writer that doesn't call validate can apply the discount with any mobile.

### Pattern 3 — Cascade discipline
- ⚠️ **MED** — `validateCouponForCart` calls `asquareCouponsApi.listCoupons()` ([validateCoupon.ts:46](src/pipeline/features/billing/validateCoupon.ts#L46)) — fetches ALL coupons every validate call. No location/vendor filter, no caching. Slow + cross-branch leakage if a coupon's `applicableGames` is empty.
- ⚠️ **MED** — `fetchUserCoupons` filters by `isUsed === false` and expiry ([couponService.ts:282, 306](src/services/couponService.ts#L282)) but **NOT** by `isForHelicopterOnly`, location applicability, or `minAmount`. Customer sees coupons they can't actually use.
- ⚠️ **MED** — No `deletedAt` on coupons — hard delete only. A vendor coupon issued and deleted before use leaves orphan user-coupon entries.
- ⚠️ **LOW** — Coupon code is normalized to uppercase at read time ([couponService.ts:247](src/services/couponService.ts#L247)) but Firestore writes have inconsistent casing — `where('code', '==', ...)` may miss legacy lowercase codes ([couponService.ts:431-439](src/services/couponService.ts#L431) shows the retry fallback for exactly this).

### Pattern 4 — Cleanup / expiry
- ⚠️ **MED** — Expired coupons accumulate in `coupons` collection forever. No archive cron.
- ⚠️ **MED** — User-coupon subcollections accumulate per-user — `deleteAllUserCoupons` is a manual admin tool, not automated.
- ⚠️ **MED** — `deleteAllUserCoupons` uses a serial `for...await` loop ([couponService.ts:269-272](src/services/couponService.ts#L269)) — N round-trips for N coupons. Should batch.

### Pattern 5 — Audit / observability
- ⚠️ **HIGH** — `markCouponAsUsed` catches errors and just logs ([couponService.ts:443-445](src/services/couponService.ts#L443)). If the mark-used Firestore write fails, the booking is already committed with the discount applied → **revenue leak with no surface signal**.
- ⚠️ **MED** — No audit log for coupon CRUD (create/delete/activate). Admin actions are silent.
- ⚠️ **MED** — Only `usedCount` integer for redemption tracking — no per-redemption history. Can't answer "who redeemed coupon X on date Y for booking Z".
- ⚠️ **MED** — Vendor coupons (`createdByVendorId`) have no audit link from a redemption back to the vendor's own ledger / report.
- ⚠️ **LOW** — `cashback` coupon type exists in the type union but no validation/redemption code path treats it differently. Either dead code or silent gap.

### Pattern 6 — Server-side enforcement ⚠️ CRITICAL
- ⚠️ **HIGH** — **Coupon validation is purely client-side.** The booking writer (`createUnifiedBooking`) does NOT re-validate the coupon. A booking written directly via Firestore SDK can include `couponDiscount: 99999` with no actual coupon lookup.
- ⚠️ **HIGH** — `markCouponAsUsed` is called from client code after booking. A malicious user can complete a booking, then skip the markCouponAsUsed call (or fail it via offline) and keep the coupon unused for reuse.
- ⚠️ **HIGH** — Vendor coupon mobile-match (`allowedMobile`) check is client-only. Easily bypassed.
- ⚠️ **MED** — `usedCount` increment is client-side. Skippable.
- ⚠️ **MED** — No Cloud Function trigger validates coupon application against the booking on write. The vendor-ledger-sync trigger is the closest existing pattern but doesn't touch coupons.

**Top recommended fixes:** wrap validate→commit→mark-used in a Firestore transaction (atomic over usedCount) · move coupon validation server-side via a Cloud Function or onBookingWrite trigger · audit log every coupon redemption with `(couponId, bookingId, redeemedAt, amount)` · mark-used by **specific** user-coupon doc id, not by code-string match · uniqueness check on coupon code generation.

---

## 5. POS (beyond fixes already shipped) — audited 2026-05-12

Focuses on gaps not already covered under vendor-ledger or cashier-shifts. Touches `billing-firestore.ts` create / cancel / reschedule / wallet paths.

### Pattern 1 — Idempotency / dedup
- ✅ `assertNoZeroOutHack` ([line 959](src/pipeline/api/billing-firestore.ts#L959)) guards against subtract-to-zero exploits at the write boundary.
- ✅ `deductCustomerWallet` and `creditCustomerWallet` use `runTransaction` ([line 1432, 1356-1360](src/pipeline/api/billing-firestore.ts#L1432)).
- ✅ Wallet transaction log uses auto-ID `doc(collection(...))` ([line 1450](src/pipeline/api/billing-firestore.ts#L1450)) — millisecond-collision-safe.
- ⚠️ **MED** — Transaction ID: `POS-${Date.now().toString(36)}-${random6}` ([line 889](src/pipeline/api/billing-firestore.ts#L889)). On a busy branch with multiple POS tabs, same-ms generation + only ~2B random combos → collisions are plausible at peak.
- ⚠️ **MED** — Billing write ([line 960](src/pipeline/api/billing-firestore.ts#L960)) and vendor-ledger write ([line 962+](src/pipeline/api/billing-firestore.ts#L962)) are sequential, not in one transaction. If the ledger write fails after the booking commits, the booking exists without vendor credits — discoverable only via audit script.

### Pattern 2 — State-machine without validation ⚠️ CRITICAL DIVERGENCE
- ⚠️ **HIGH** — **Cancellation has two divergent code paths.** `cancelFirestoreBillingTransaction` sets `cancelled: true` but does NOT set `bookingStatus: 'cancelled'` ([line 1516-1523](src/pipeline/api/billing-firestore.ts#L1516)). The AllBookingsView "Cancel" path sets `bookingStatus: 'cancelled'` without `cancelled: true` (per the inline comment at [line 1600-1602](src/pipeline/api/billing-firestore.ts#L1600)). Anywhere consumer code checks only one signal, leak. The cashier checkout filter ([line 600-602](src/pipeline/api/billing-firestore.ts#L600)) correctly checks BOTH; many other aggregators probably don't.
- ⚠️ **HIGH** — `refundStatus: 'None' | 'Partial' | 'Full'` has no transition validation. `Partial → None` rewrite is technically allowed (loses refund evidence). `Full → Partial` should be illegal but isn't gated.
- ⚠️ **MED** — Reschedule preserves `originalVisitDate` only on first reschedule ([line 1481-1500](src/pipeline/api/billing-firestore.ts#L1481)) — subsequent reschedules overwrite and the original is lost.

### Pattern 3 — Cascade discipline
- ⚠️ **HIGH** — `deductCustomerWallet` does NOT check user `deletedAt` ([line 1383+](src/pipeline/api/billing-firestore.ts#L1383)). A soft-deleted user's wallet can still be debited if the phoneToUid index still resolves.
- ⚠️ **MED** — `phoneToUid` resolution at line 1399-1406 does NOT verify the resolved uid's `role` is empty (i.e. customer, not staff). The members fallback at line 1414-1418 does, but the index path is preferred and skips the check.
- ⚠️ **MED** — `cancelFirestoreBillingTransaction` deletes BOTH `le-` (credit), `le-refund-` (refund debit), AND `le-cancel-` ([line 1538-1561](src/pipeline/api/billing-firestore.ts#L1538)) — losing refund debits means any audit trying to reconstruct "what was refunded before cancellation" can't.

### Pattern 4 — Cleanup / expiry
- ⚠️ **MED** — POS billing transactions accumulate forever — no archive policy.
- ⚠️ **MED** — Reprint and refund approval records (separate collections) accumulate.
- ⚠️ **LOW** — `interakt_message_requests` from receipt-sent paths grows unbounded.

### Pattern 5 — Audit / observability
- ⚠️ **HIGH** — Mutations on bookings (refund, reprint, cancel, reschedule) all overwrite the booking doc rather than appending event entries. Reconstructing "what happened to booking X" requires combing `updatedAt` snapshots which aren't persisted.
- ⚠️ **MED** — `createdBy/createdByName` recorded on creation only ([line 932-933](src/pipeline/api/billing-firestore.ts#L932)). Subsequent mutators (cancelledBy, refundedBy, rescheduledBy) are stamped only on the respective fields, not a unified event timeline.
- ⚠️ **MED** — `Math.round((eligibleSubtotal * coupon.discount) / 100)` and other per-item splits use `Math.round` for paise — cumulative rounding error of ±1 per item across many items.

### Pattern 6 — Server-side enforcement
- ⚠️ **HIGH** — All POS writes are client-side via Firestore SDK. With write rules permissive, anyone with a token can write a booking with `paymentMethod: 'Cash'`, `cashEntered: 50000` to inflate cash totals.
- ⚠️ **MED** — `assertNoZeroOutHack` catches the specific known exploit. Other manipulation paths (negative `quantity`, NaN amounts cast to 0, swapped vendor/company splits) aren't guarded.
- ⚠️ **MED** — Wallet redeem flow: client computes the redeem amount, server `deductCustomerWallet` honors it. No upper bound check at write time (other than "wallet has enough balance"). Client could redeem all the way to ₹0 in one bad call.

**Top recommended fixes:** unify cancel state (single `cancelled: true` flag + `bookingStatus: 'cancelled'` written together) · enforce refundStatus transitions · audit-log every booking mutation as a separate event doc · check user.deletedAt + role in wallet debit · prepend `vendorLedger` writes inside the same transaction as billing write.

---

## 6. Telecaller / lead bookings — audited 2026-05-12

Examines `leads-firestore.ts`, `lead-auto-assign.ts`, `feedback-calls-firestore.ts` (referenced).

### Pattern 1 — Idempotency / dedup
- ✅ Dedup on create: `hasActiveLeadForPhone` ([leads-firestore.ts:128-139](src/pipeline/api/leads-firestore.ts#L128)) — blocks duplicate active leads for same phone.
- ✅ `claimFirestoreLead` is in a `runTransaction` ([leads-firestore.ts:327](src/pipeline/api/leads-firestore.ts#L327)) — atomic claim.
- ⚠️ **MED** — Create flow ([leads-firestore.ts:160-242](src/pipeline/api/leads-firestore.ts#L160)) is NOT in a transaction: dedup-check → `addDoc` are separate ops. Two concurrent creates with the same phone can both pass dedup, both write.
- ⚠️ **MED** — `writeTimelineEvent` ([line 107-124](src/pipeline/api/leads-firestore.ts#L107)) uses `addDoc` with auto ID. Mutation retries create duplicate timeline events.
- ⚠️ **MED** — Auto-assign at [line 227-239](src/pipeline/api/leads-firestore.ts#L227) runs AFTER create. **Local body mutation only** — line 232-235 sets `body.assignedTo` but never writes that back to Firestore. The function returns `mapLeadRecord(created.id, body)` — caller sees the auto-assigned value but Firestore doesn't have it. Caller's UI desyncs from the database.

### Pattern 2 — State-machine without validation
- ⚠️ **HIGH** — `updateFirestoreLead` ([line 290-312](src/pipeline/api/leads-firestore.ts#L290)) accepts arbitrary `Partial<LeadRecord>` and writes it. No transition guard. A lead can flip `converted → new → converted` freely. `convertedBookingId` can be set to any string with no verification that the booking exists.
- ⚠️ **MED** — `status` enum: `'new' | 'contacted' | 'callback' | 'converted' | 'closed' | 'lost'` — no transition graph enforced.
- ⚠️ **MED** — `consecutiveNoAnswer` counter has no reset path visible in this file. If `lead-notifications.ts` or elsewhere doesn't decrement on successful contact, it grows monotonically.

### Pattern 3 — Cascade discipline
- ⚠️ **MED** — Phone normalization: `normalizePhone` strips to 10 digits ([line 165](src/pipeline/api/leads-firestore.ts#L165), [line 129](src/pipeline/api/leads-firestore.ts#L129)). Legacy leads in Firestore may have been written with `+91` or country-code prefix — `hasActiveLeadForPhone` queries by the normalized form and misses them → duplicates.
- ⚠️ **MED** — `branchId` and `branchName` stamped from payload without validation. A lead with non-existent branchId silently writes.
- ⚠️ **MED** — `assignedTo` stamped from payload without verifying the userId exists or is an active telecaller. Lead can be assigned to a deleted user.

### Pattern 4 — Cleanup / expiry
- ⚠️ **MED** — Leads accumulate forever. `deleteFirestoreLead` exists ([line 314-318](src/pipeline/api/leads-firestore.ts#L314)) but no auto-archive of `closed`/`lost` leads after N months.
- ⚠️ **MED** — Timeline subcollection grows per-lead. No retention.
- ⚠️ **LOW** — Stale `callbackScheduledAt` past dates — no sweeper to reactivate or mark as missed.

### Pattern 5 — Audit / observability
- ✅ Timeline events for `created`, `claimed`, `assigned`.
- ⚠️ **HIGH** — `updateFirestoreLead` ([line 290](src/pipeline/api/leads-firestore.ts#L290)) writes Firestore but does NOT call `writeTimelineEvent`. Status changes, conversion stamps, feedback notes — all silent. Audit trail incomplete.
- ⚠️ **HIGH** — `deleteFirestoreLead` ([line 314](src/pipeline/api/leads-firestore.ts#L314)) — no timeline event. The deleted lead + its timeline subcollection vanish with no trail.
- ⚠️ **MED** — Lead score (`score`, `scoreLabel`, `scoreFactors`) recomputes over time but no audit log of changes.

### Pattern 6 — Server-side enforcement
- ✅ Role check on delete (`isPrivilegedRole` at [line 316](src/pipeline/api/leads-firestore.ts#L316)).
- ⚠️ **HIGH** — `updateFirestoreLead` has NO role check ([line 290-312](src/pipeline/api/leads-firestore.ts#L290)). Any authenticated user can mark any lead as converted with a fake `convertedBookingId` — inflates their telecaller stats. **Money/incentive impact** if commissions are paid on conversions.
- ⚠️ **HIGH** — `createFirestoreLead` has NO role check. Any authenticated user can create leads and pre-assign them to a specific telecaller — disrupting queue distribution / round-robin.
- ⚠️ **MED** — `convertedBookingId` not verified against the `bookings` collection. Telecaller commission calculations might trust this field blindly.
- ⚠️ **MED** — `assignFirestoreLead` ([line 345](src/pipeline/api/leads-firestore.ts#L345)) — need to check whether it role-gates — based on signature suggesting `(token, leadId, userId)` with no privilege check visible.

**Top recommended fixes:** role check on `updateFirestoreLead` (Telecaller can edit own leads only; Admin/Owner unrestricted) · timeline event on every mutation including delete · verify `convertedBookingId` against bookings before accepting · transaction-wrap create+dedup-check · phone normalization migration for legacy leads.

---

## 7. Invoices (vendor + company, weekly) — audited 2026-05-12

Examines `functions/lib/invoice-generation.js` (Admin SDK weekly cron + manual trigger).

### Pattern 1 — Idempotency / dedup
- ✅ Locked invoices never overwritten — explicit check at [line 398](functions/lib/invoice-generation.js#L398).
- ✅ Composite key `invoiceCompositeKey(vendorId, locationId)` for vendor-invoice doc identity.
- ⚠️ **MED** — Re-running generation on the same period over an existing draft: `existingDraftIds` lookup happens ([line 392-403](functions/lib/invoice-generation.js#L392)) but merge semantics aren't visible in this slice — need to verify draft is fully replaced (not partially merged with stale fields).

### Pattern 2 — State-machine without validation
- ⚠️ **HIGH** — Invoice status (`draft → locked → cheque issued → paid`) has NO enforced transitions. The `locked` check ([line 398](functions/lib/invoice-generation.js#L398)) only blocks regeneration over locked invoices. Direct `setDoc(..., {status: 'paid'})` on a draft skips the entire flow.
- ⚠️ **MED** — `cheque issued`-style intermediate states (per memory mention of cheque IDs like 001058) — not modeled in this file. Suggests status field is treated more like free-text than enum.

### Pattern 3 — Cascade discipline ⚠️ CRITICAL
- ✅ Filters `paymentStatus === 'completed'`, `refundStatus !== 'Full'`, `cancelled !== true` ([line 376-379](functions/lib/invoice-generation.js#L376)).
- ⚠️ **HIGH** — **DOES NOT filter `deletedAt` or `voidedAt`.** Same gap as vendor-ledger-sync. Soft-deleted bookings get included in vendor + company invoices.
- ⚠️ **HIGH** — `extractItemSplits(txn)` recomputes vendor amounts from booking item data. This is a **third source of truth** (alongside `vendorLedger` and Settlements view). If the booking's `billingItems[].vendorTotal` drifted from what the ledger has, the invoice diverges from both. This is the technical mechanism behind the SEERAMREDDY ₹792 diff and similar.
- ⚠️ **MED** — `transactionDate` range query uses `` upper bound ([line 304](functions/lib/invoice-generation.js#L304)) — string comparison, depends on transactionDate format consistency. Anything written with a non-ISO format (e.g. legacy date-only `YYYY-MM-DD`) might land outside the window.

### Pattern 4 — Cleanup / expiry
- ⚠️ **MED** — Old invoices accumulate. No archive policy.
- ⚠️ **MED** — Stale drafts from past weeks (never locked) — no cleanup. Future generation may re-find them.
- ⚠️ **LOW** — `companyInvoices` collection mirror — same retention concerns.

### Pattern 5 — Audit / observability
- ✅ Staleness check ([line 295-346](functions/lib/invoice-generation.js#L295)) — detects new txns or removed txns since last generation.
- ⚠️ **HIGH** — Invoice mutations (lock, status change, manual edit, cheque assignment) NOT audit-logged. Once locked, who locked it and when is in fields on the doc, but `paid` flip has no separate trail.
- ⚠️ **MED** — `extractItemSplits` divergence from `vendorLedger`: audit scripts catch it, but **no automated alerting** when divergence is detected.
- ⚠️ **MED** — The 2026-04-28 23-vendor audit found 22 had drift — auditor had to discover this manually. No "weekly invoice sanity check" cron.

### Pattern 6 — Server-side enforcement
- ✅ Cron-only generation path is server-controlled.
- ⚠️ **HIGH** — Invoice status flip is writable client-side per project's permissive-rules policy. Anyone with a token can mark any vendor invoice as `paid` (and trigger downstream payment workflows if they exist).
- ⚠️ **HIGH** — `cheque issued` writes (per memory mention) are client-side and trust the cheque number / amount fields blindly.
- ⚠️ **MED** — No cross-system validation: an invoice marked `paid` doesn't verify against a bank transaction record or external payment confirmation.

**Top recommended fixes:** filter `deletedAt`/`voidedAt` in invoice-generation (matches vendor-ledger-sync fix) · invoice status transitions in a Cloud Function (only `draft → locked → cheque → paid`) · stop using `extractItemSplits` as a third source — read from vendorLedger as proposed in vendor-ledger Fix 3 · audit-log every status change with actor/timestamp · weekly drift sanity check cron.

---

## 8. Settlements view — audited 2026-05-12

Examines `AccountingModule.tsx` Settlements tab + `accounting-firestore.ts:extractItemSplits` ([line 583-644](src/pipeline/api/accounting-firestore.ts#L583)). The "two systems of truth" gap is covered in vendor-ledger Fix 3 — this section logs Settlements-specific findings.

### Pattern 1 — Idempotency
- N/A — read-only view.

### Pattern 2 — State machine
- N/A — read-only.

### Pattern 3 — Cascade discipline
- ✅ `extractItemSplits` correctly zeros out `item.refunded === true` lines ([line 593-604](src/pipeline/api/accounting-firestore.ts#L593)) — good.
- ⚠️ **HIGH** — `extractItemSplits` does NOT check booking-level `deletedAt`, `voidedAt`, or `cancelled`. Relies on the **caller** to pre-filter. If any consumer forgets, soft-deleted bookings inflate Settlements totals.
- ⚠️ **HIGH** — Old-format synthesis path ([line 618-630](src/pipeline/api/accounting-firestore.ts#L618)) assumes a single `vendorId` and `vendorTotal` on the transaction. Multi-vendor combos written before per-item splits existed get misattributed to whichever vendorId ended up at the transaction level.
- ⚠️ **MED** — `extractItemSplits` is invoked at [line 803](src/pipeline/api/accounting-firestore.ts#L803) (settlements) AND [line 1361](src/pipeline/api/accounting-firestore.ts#L1361) (likely company invoices), AND it's mirrored in `functions/lib/invoice-generation.js`. Four locations to keep in sync. Any logic divergence between client/Admin SDK creates client-vs-trigger drift.

### Pattern 4 — Cleanup
- N/A.

### Pattern 5 — Audit / observability
- ⚠️ **HIGH** — Settlements view is the **second source of vendor-period totals** (vendorLedger being the first). Per project memory, 22 of 23 vendors had drift in the 2026-04-28 audit. This re-derivation pathway IS the divergence source. Without changing reads to flow through vendorLedger (vendor-ledger Fix 3), the drift will recur.
- ⚠️ **MED** — Performance: each Settlements view load scans every booking in the period × every item per booking. For a 4-branch week (typically 200-500 bookings × 1-5 items each) → 1k-2.5k items computed every view load. No caching.
- ⚠️ **LOW** — `extractItemSplits` is pure (good for testing), but no unit tests verify it stays in sync with `functions/lib/invoice-generation.js` mirror.

### Pattern 6 — Server-side enforcement
- Read-only view; the underlying writable booking data has the client-side enforcement gap already documented under vendor-ledger and POS.

**Top recommended fixes:** vendor-ledger Fix 3 (read settlements from vendorLedger, not via extractItemSplits) · while it lives, add `deletedAt` filter at every caller of extractItemSplits · merge the client and Admin SDK mirrors into one shared source (e.g. compile a TypeScript module to both targets).

---

## 9. Reports module — audited 2026-05-12

Examines `ReportsModule.tsx` (9 sub-reports: operations, revenue, shifts, callHistory, insights, bookingRevenue, gameRevenue, cashierDetails, daySales) + `asquare-revenue.ts`, `reports.ts` API.

### Pattern 1 — Idempotency / State machine
- N/A — reports are read-only views.

### Pattern 2 — N/A

### Pattern 3 — Cascade discipline ⚠️ CRITICAL
- ⚠️ **HIGH** — Revenue / booking / game / day-sales reports re-derive from `bookings`. Each is a separate aggregation path. **Each needs its own `deletedAt`/`voidedAt`/`cancelled` filter.** If even one of the 9 sub-reports forgets, soft-deleted bookings show up.
- ⚠️ **HIGH** — `sourceType === 'BILLING'` filter (the POS-only filter from the recent vendor-ledger gap) — verify each sub-report applies it appropriately. Day Sales should be POS-only; Booking Revenue might want online included. Wrong filter at any view fragments accounting.
- ⚠️ **MED** — Time-zone handling: reports use mixed IST helpers (`fmtDateTimeFullIST`, `todayIST`, `fmtDateIST`, `fmtDateTimeReportIST`). Inconsistent ISO-vs-IST date math at report boundaries can shift a booking from one day to the next.
- ⚠️ **MED** — `branchLocationRevenueColumns` and similar — relies on `getLocationShortName` for display. If a booking carries a non-canonical locationId (slug vs branchId vs display name), it lands in "Unknown" or fragments to a separate row.

### Pattern 4 — Cleanup / expiry
- ⚠️ **LOW** — Reports computed on-demand; no caching → repeated views re-scan thousands of docs.
- ⚠️ **MED** — `gameRevenueWeeklyReports` collection (referenced via `getWeeklyGameReport`) — generated every Friday, never archived.

### Pattern 5 — Audit / observability
- ⚠️ **HIGH** — **No audit log of report exports.** CSV / PDF downloads are unaudited. Compliance gap if any vendor / customer ever asks "who accessed my data on date X?".
- ⚠️ **MED** — `printDayReport` (per ReportsModule import at [line 6](src/pipeline/pages/modules/ReportsModule.tsx#L6)) is called on demand; no record of which Day Reports were printed when and by whom.
- ⚠️ **MED** — Reports surface `paidAmount` and `walletAmountUsed` together; no separation of "real money in" vs "wallet redemption" for accounting clarity.
- ⚠️ **MED** — Game revenue weekly cron fires Friday 23:30 IST. If it misses one week (function failure, deploy timing), there's a gap with no auto-retry.

### Pattern 6 — Server-side enforcement
- ⚠️ **HIGH** — All reports read raw `bookings` / `shifts` / `vendorLedger` client-side via Firestore SDK. With permissive rules, **any authenticated user can pull the full bookings dump** — including phone numbers, payment details, customer addresses (in some bookings). Privacy exposure is wider than the in-app role gate suggests.
- ⚠️ **MED** — No per-branch read isolation in queries. A staff scoped to Branch X reads all branches' bookings and filters client-side.

**Top recommended fixes:** central `bookingFilter` helper (deletedAt + voidedAt + cancelled + bookingStatus) used by all 9 sub-reports · audit-log every export with `(user, report, period, exportedAt)` · auto-cache last-computed report per period · server-side report endpoints (Cloud Function) for sensitive aggregations · per-branch read scope in Firestore queries.

---

## 10. Incharge dashboards — audited 2026-05-12

Examines `incharge-tasks-firestore.ts` (washroom, housekeeping, vehicle report) + `ticket-incharge-digest.js` (daily cron stub).

### Pattern 1 — Idempotency / dedup
- ✅ Deterministic doc id `{slug}_{date}` ([line 101](src/pipeline/api/incharge-tasks-firestore.ts#L101)) — re-submissions are idempotent at the doc level.
- ⚠️ **MED** — `completePhotoTask` overwrites the task field wholesale ([line 252-271](src/pipeline/api/incharge-tasks-firestore.ts#L252)). If the incharge re-submits with a different photo set, the previous photos are dropped — Storage URLs orphan in `firebase storage` with no GC.

### Pattern 2 — State-machine without validation
- ⚠️ **MED** — Tasks have a binary `completed: boolean` — no state machine. Can flip true → false → true freely. No audit log of reversal.
- ⚠️ **MED** — Vehicle report's `condition` enum (good/minor_issue/bad/engine_failure) has no escalation flow. A `bad` or `engine_failure` entry is just stored; no automatic ticket creation or owner notification.

### Pattern 3 — Cascade discipline
- ✅ Location slug normalization at write ([line 99, 248](src/pipeline/api/incharge-tasks-firestore.ts#L99)).
- ⚠️ **MED** — Photo URLs are absolute Storage URLs. If a record is deleted, the Storage objects orphan.

### Pattern 4 — Cleanup / expiry
- ⚠️ **MED** — Incharge daily docs accumulate forever — ~5 branches × 365 days = 1.8k docs/year. Small but unbounded.
- ⚠️ **MED** — Orphan photos in Storage (per the overwrite-not-merge issue) — no cleanup cron.
- ⚠️ **LOW** — Vehicle report entries grow per branch as fleet expands; no archive of old kart records.

### Pattern 5 — Audit / observability
- ✅ `completedBy/completedByName/completedAt` stamped per task.
- ⚠️ **MED** — Re-completing a task (false → true again) loses the prior completion stamps — they're overwritten in place.
- ⚠️ **HIGH** — `engine_failure` and `bad` conditions surface to the UI **but no automated escalation**. Owner doesn't get notified; no ticket auto-opened; no link to maintenance schedule.
- ⚠️ **MED** — `ticket-incharge-digest.js` cron is a stub per the index.js comment (`ticketInchargeDigest: daily 09:00 IST per-branch open-ticket snapshot (stub)`) — feature not implemented end-to-end.

### Pattern 6 — Server-side enforcement
- ⚠️ **MED** — All Incharge writes are client-side. Anyone with token can mark tasks complete on behalf of any branch.
- ⚠️ **MED** — Photo count check (`>= 3`) is client-side ([line 245-247](src/pipeline/api/incharge-tasks-firestore.ts#L245)). The cashier end-shift gate that reads this may trust the `completed: true` flag without verifying photo count server-side.
- ⚠️ **LOW** — `vehicleReport.entries[].kartId` is free-text. No validation against an actual karts inventory collection.

**Top recommended fixes:** auto-open maintenance ticket when vehicleReport has `bad`/`engine_failure` · merge (don't overwrite) photo arrays on resubmit · orphan-photo cleanup cron · server-side trigger to validate photo count + escalate to ticket queue · finish the `ticketInchargeDigest` cron.

---

## 11. Track reports / Kart Reports — audited 2026-05-12

Examines `kartReportService.ts` (kart report submission) + `trackEndOfDayStatus.ts` (deep-clean / end-shift-photos gate read by the cashier checkout flow).

### Pattern 1 — Idempotency / dedup
- ✅ Deterministic doc id `{locationDocId}_{date}` ([line 307](src/pipeline/features/track/services/kartReportService.ts#L307)).
- ✅ Submitted-status idempotency guard at [line 311-317](src/pipeline/features/track/services/kartReportService.ts#L311) — refuses overwrite of an already-submitted report.
- ✅ Report + kart updates committed in a single `writeBatch` ([line 351-366](src/pipeline/features/track/services/kartReportService.ts#L351)).
- ⚠️ **MED** — The idempotency guard is **check-then-write**, not a transaction. Two concurrent submits both pass `existing.exists() === false` (or both see `status: 'draft'`), then both batch-commit. Last write wins; first one's data is silently lost.

### Pattern 2 — State-machine without validation
- ✅ Reports have a clear `draft → submitted` transition (only one direction).
- ⚠️ **MED** — **No revision path.** If TM submits a report with wrong kart conditions, the only recourse is direct Firestore edit. No "amend with audit trail" surface.
- ⚠️ **MED** — Write-through to karts collection ([line 354-364](src/pipeline/features/track/services/kartReportService.ts#L354)) overwrites kart state with no revert path. A wrong condition update stays until the next day's report.

### Pattern 3 — Cascade discipline
- ✅ Slug resolution via `resolveLocationDocId` ([line 106-127](src/pipeline/features/track/services/kartReportService.ts#L106)) — handles the two-parallel-slug systems thoughtfully (static `SCANNER_LOCATION_DOC_IDS` vs live registry numeric IDs). Good awareness.
- ⚠️ **LOW** — Kart entries reference `kartId` + `kartNumber`. If a kart is renumbered or deleted from `locations/{id}/karts/`, the report still references the old IDs.

### Pattern 4 — Cleanup / expiry
- ⚠️ **MED** — Kart reports accumulate forever — ~5 branches × 365 days = ~1.8k docs/year. Small but unbounded.

### Pattern 5 — Audit / observability
- ✅ `submittedBy`, `submittedByUid`, `submittedAt` stamped per report.
- ⚠️ **HIGH** — `engineFail` and `critical` counts surface in the summary but **no automated escalation**. A report with 3 engine-failed karts gets submitted with `critical: 3` and the only signal to the Owner is the dashboard widget. No SMS, no ticket, no notification.
- ⚠️ **MED** — Inconsistent field naming: `entry.notes` on the report vs `complaint` on the kart doc ([line 361](src/pipeline/features/track/services/kartReportService.ts#L361)). Cross-collection joins between report and kart history fragment.
- ⚠️ **MED** — `submittedAt: serverTimestamp()` → great for accurate time, but the returned record at [line 376](src/pipeline/features/track/services/kartReportService.ts#L376) returns `submittedAt: null`. UI shows null until the doc reloads.

### Pattern 6 — Server-side enforcement
- ✅ `canSubmitKartReportRole` checks role ([line 76-79](src/pipeline/features/track/services/kartReportService.ts#L76)) — Owner/Admin/Developer/TrackMarshall.
- ⚠️ **HIGH** — Role check is **client-side only**. With permissive Firestore rules, **anyone with a token can write a fake submitted kartReport doc and unlock cashier check-in on a day TM hasn't actually inspected the karts**. This is the underlying weakness the Manager Override we just built sits next to — both paths can be bypassed by a script.
- ⚠️ **MED** — Cashier check-in gate reads `subscribeKartReport` for today's submission. Trusts the document blindly.
- ⚠️ **MED** — `trackEndOfDayStatus` (the cashier check-OUT gate — deep clean + 5 photos) likely has the same client-side trust pattern. Worth a dedicated audit before a separate fix.

**Top recommended fixes:** wrap the submit in a Firestore transaction (atomic over the idempotency guard) · auto-escalate critical/engine-fail karts to a ticket / WhatsApp notice · move the role check to a Cloud Function (or accept the trade-off per project policy) · field-name consistency between report.notes and kart.complaint.

---

## 12. Event campaigns — audited 2026-05-12

Examines `event-campaigns-firestore.ts` + the campaign-matching logic in the vendor-ledger trigger.

### Pattern 1 — Idempotency / dedup
- ✅ Caller-provided doc ids via `setDoc(doc(col, id))` — writes are idempotent.
- ⚠️ **MED** — `cleanEventData` strips `undefined` deeply ([line 57-86](src/pipeline/features/event-campaigns/event-campaigns-firestore.ts#L57)) but doesn't validate structure. A malformed `packages[]` write could corrupt the doc.

### Pattern 2 — State-machine without validation ⚠️ HIGH-IMPACT
- ⚠️ **HIGH** — Campaigns have an implicit lifecycle (`created → active period → expired`) driven only by `startDate` / `endDate`. **No transition guard.** An Owner can edit `endDate` of a closed campaign to extend it, retroactively making the trigger token-fallback path re-credit recent POS sales to the campaign vendor. This is the exact mechanism the Summer Vibes temporal-gate fix was designed to mitigate, but extending dates BYPASSES the gate (because the gate uses the campaign's NEW dates).
- ⚠️ **MED** — `applicability` flags (showOnline / enableInBooking / enableInBilling) can flip without audit. Toggling off `showOnline` mid-campaign hides the offer; toggling back on is silent.

### Pattern 3 — Cascade discipline
- ✅ `matchesLocation` ([line 25-33](src/pipeline/features/event-campaigns/event-campaigns-firestore.ts#L25)) handles slug-vs-branchId mismatch — good awareness of the parallel slug systems.
- ⚠️ **HIGH** — **Editing a campaign's vendor** in `packages[].items[].vendorId` doesn't trigger ledger reconciliation. Existing bookings stamped against the OLD vendor stay credited to the old vendor; new bookings credit the new one. Mid-week vendor swaps leave a money split.
- ⚠️ **HIGH** — **Changing `endDate`** invalidates the trigger's temporal gate. Bookings recorded just outside the original window get pulled in (or pushed out) of vendor attribution silently. The trigger only re-resolves vendorIds when the BOOKING is rewritten — campaign edits don't propagate to existing bookings.
- ⚠️ **MED** — 5-minute matcher cache TTL ([vendor-ledger-sync.js:249](functions/lib/vendor-ledger-sync.js#L249)) — campaign edits take up to 5 min to reach the trigger. POS sales in that window credit the OLD vendor.
- ⚠️ **MED** — Package discount type changes (`flat → buy_x_get_y`) don't recompute existing bookings' discount. Old bookings stamped with the old discount value.

### Pattern 4 — Cleanup / expiry
- ⚠️ **MED** — Old campaigns accumulate forever in `eventCampaigns`.
- ⚠️ **LOW** — `event-coupon-notifications` from past campaigns stay around — not archived.

### Pattern 5 — Audit / observability
- ⚠️ **HIGH** — **No audit log of campaign edits.** Date / vendor / price / discount changes silently affect downstream credit calculation. Owner reviewing the SEERAMREDDY ₹792 discrepancy can't ask "was the campaign edited mid-period?"
- ⚠️ **MED** — `__cleanEventDataForTest` exposed for testing ([line 54](src/pipeline/features/event-campaigns/event-campaigns-firestore.ts#L54)) — code-smell signal that the cleaning logic is complex / fragile.
- ⚠️ **MED** — Token-fallback matching in the trigger ([vendor-ledger-sync.js:474-501](functions/lib/vendor-ledger-sync.js#L474)) has the temporal gate but no log of "this booking was credited via token-fallback vs structured-id" — auditing structurally-attributed vs token-attributed credits requires inspecting individual ledger rows.

### Pattern 6 — Server-side enforcement
- ⚠️ **HIGH** — Campaign edits are client-side. Anyone with a Firestore write token can extend campaign dates retroactively, redirecting vendor credits. Money-impact gap.
- ⚠️ **MED** — `locationKey` is not normalized at write time — relies on `matchesLocation` at read. Storage drift between slug ("visakhapatnam") and branchId ("0") accumulates.

**Top recommended fixes:** audit-log every campaign edit (`startDate`, `endDate`, vendor swaps, price/discount changes) · block `endDate` extension server-side once campaign has ended · normalize `locationKey` to slug at write time · push trigger cache TTL down or invalidate on campaign write · auto-recompute ledger when a vendor swap is detected.

---

## 13. Bookings state machine (cross-cutting) — audited 2026-05-12

Examines the booking lifecycle across writers: `unified-booking.ts`, `bookingService.ts`, `billing-firestore.ts`, `razorpay.js` webhook, `AllBookingsView.tsx`, scanner verification.

### Pattern 2 — State-machine without validation ⚠️ THE BIGGEST CROSS-CUTTING GAP

The booking document carries **four orthogonal status signals**:
- `bookingStatus`: `'pending' | 'confirmed' | 'cancelled' | 'rescheduled'` per CLAUDE.md — but `'completed'` is also used by the scanner ([scannerApi.ts:235-237](src/pipeline/features/track/scanner/services/scannerApi.ts#L235)). **Undocumented fifth value silently accepted.**
- `paymentStatus`: `'pending' | 'completed' | 'failed' | 'amount_mismatch'`.
- `refundStatus`: `'None' | 'Partial' | 'Full'`.
- `cancelled`: `boolean` (legacy `cancelled: true` flag).
- `deletedAt`: ISO string (soft-delete).

These are written from **at least 7 different code paths**:
1. `createUnifiedBooking` (customer-app + POS pending)
2. `bookingService.ts` (confirm-after-payment + admin create — multiple branches)
3. Razorpay webhook (`payment_link.paid`, `payment.captured`, `qr_code.credited`)
4. `cancelFirestoreBillingTransaction` (sets `cancelled: true` but not `bookingStatus: 'cancelled'`)
5. AllBookingsView Cancel button (sets `bookingStatus: 'cancelled'` but not `cancelled: true`) — already documented under POS
6. Scanner `verifySerials` (no status writes, but bocks invalid statuses)
7. `delete-booking.js` Cloud Function (soft-delete + ledger tear-down)

**Concrete gaps:**

- ⚠️ **HIGH** — **No central transition guard.** Any of the 7+ writers can flip any status to any value via `setDoc(..., {merge:true})`. Some have informal awareness (`submitOrderToAPI no longer writes bookingStatus / paymentStatus` comment at [bookingService.ts:625](src/services/bookingService.ts#L625)) but it's documented-via-comment, not enforced.
- ⚠️ **HIGH** — **Cancelled state divergence** (already in POS audit): `cancelled: true` vs `bookingStatus: 'cancelled'` written by different code paths. Aggregators that check only one signal leak.
- ⚠️ **HIGH** — **`'completed'` is an undocumented bookingStatus value.** Scanner checks for it ([line 235-237](src/pipeline/features/track/scanner/services/scannerApi.ts#L235)) but no writer in the canonical flow sets it. Likely originated from a one-off backfill or admin tool — but the scanner trusts it.
- ⚠️ **HIGH** — Three "is this booking alive?" signals (`cancelled`, `deletedAt`, `bookingStatus`) need to be checked separately. The bug-finder skill explicitly scans for this; aggregators frequently miss one.
- ⚠️ **MED** — `paymentStatus` `pending → completed → failed → amount_mismatch` — no transition validation. `amount_mismatch → completed` is technically allowed (e.g. if Owner manually fixes the mismatch).
- ⚠️ **MED** — `refundStatus` `None → Partial → Full` — see POS audit; no transition guard.
- ⚠️ **MED** — `'rescheduled'` status: scanner explicitly rejects it ([line 235-237](src/pipeline/features/track/scanner/services/scannerApi.ts#L235)) so a rescheduled ticket CAN'T be scanned even on the new date. Either the status should be cleared post-reschedule (drop back to 'confirmed'), or the scanner should accept it.

### Pattern 3 — Cascade
- ⚠️ **HIGH** — Multiple writers can race. Example: razorpay webhook fires `payment.captured` while a POS cashier is editing the booking. Both `setDoc(..., merge:true)` — last-write-wins on overlapping fields.
- ⚠️ **MED** — `updatedAt` is the only "last touched" signal. No `updatedBy` per write (different actions stamp different `*By` fields).

### Pattern 5 — Audit / observability
- ⚠️ **HIGH** — No unified "booking lifecycle" event timeline. Reconstructing "this booking went pending → confirmed → cancelled → reactivated → rescheduled" requires interpreting:
  - `createdAt` / `createdBy`
  - `updatedAt`
  - `cancelledAt` / `cancelledBy` / `cancelledByName`
  - `rescheduledAt` / `rescheduledBy` / `rescheduledByName`
  - `originalVisitDate`
  - `paymentLinkPaidAt` / `paymentCapturedAt`
  - `helicopterCountIncremented` boolean
  - `interakt.outboundRequestedAt`
  - `amountMismatchAt`
  - `ledgerSkippedReason` (not yet introduced)
  
  No single read tells the story. Subsequent overwrites silently shadow earlier values.
- ⚠️ **MED** — No event subcollection. The leads module has `leads/{id}/timeline/{eventId}` — there's no equivalent for bookings.

### Pattern 6 — Server-side enforcement
- ⚠️ **HIGH** — No server-side transition validation. Per project policy, this is accepted, but the cumulative effect across 7 writers + 4 status fields is the source of most "why is this booking weird?" tickets.

**Top recommended fixes:** **single canonical `transitionBooking(bookingId, fromStatuses, toStatus, actor)` helper** that validates allowed transitions and writes a `bookings/{id}/events/{eventId}` audit row · unify `cancelled` and `bookingStatus: 'cancelled'` into one signal · document the `'completed'` bookingStatus value (or migrate away from it) · per-write `updatedBy` field · server-side trigger that detects illegal transitions and surfaces to Owner.

---

## 14. Shifts / cashier checkout — dedicated sweep — audited 2026-05-12

Covers what wasn't already touched in earlier session work (auto-close, force-close, kart-report gate, manager override). Focused on break tracking, shiftDate derivation, scale, and audit completeness.

### Pattern 1 — Idempotency / dedup
- ✅ `startFirestoreShift` checks for an existing active shift before creating ([line 379-382](src/pipeline/api/shifts-firestore.ts#L379)).
- ✅ Break start/end have "is one open?" guards ([line 436-439](src/pipeline/api/shifts-firestore.ts#L436)).
- ⚠️ **MED** — `addDoc(shiftsCollection, payload)` ([line 411](src/pipeline/api/shifts-firestore.ts#L411)) — auto ID. Race: two concurrent tabs both see no active shift, both `addDoc` → user ends up with two active shifts. The May-11 cluster might have this as one of its triggers (alongside the autoCloseExpiredShifts loop).
- ⚠️ **MED** — `startFirestoreShiftBreak` and `endFirestoreShiftBreak` mutate breaks array via `updateDoc` — no transaction. Concurrent break-start + break-end (e.g. two devices) can produce inconsistent state.

### Pattern 2 — State-machine without validation
- ✅ `endFirestoreShiftWithSettlement` is only callable on the caller's own active shift.
- ⚠️ **MED** — Shift lifecycle (`active → break → active → ended → settled → force-closed`) has no transition guard. A `force-closed` shift can be re-flipped to active via direct Firestore write.
- ⚠️ **MED** — `autoEnded: true` flag and `forceClosedBy` are independent. A shift can be both auto-ended AND force-closed — the force-close path explicitly preserves the existing endTime ([shifts-firestore.ts:669](src/pipeline/api/shifts-firestore.ts#L669) per our recent fix), so the audit trail shows both stamps.
- ⚠️ **MED** — Breaks: no max-break-count, no max-break-duration validation. A shift could have 1000 breaks for 30 seconds each — totalActiveHours computation handles it, but it's noise.

### Pattern 3 — Cascade discipline
- ✅ `normalizeLocationId(locationId)` at write time ([line 358](src/pipeline/api/shifts-firestore.ts#L358)).
- ✅ Location access enforced via `assertLocationAccess` ([line 364](src/pipeline/api/shifts-firestore.ts#L364)).
- ⚠️ **MED** — `shiftDate` derived from `toLocalDate(new Date(startTime))` ([line 397](src/pipeline/api/shifts-firestore.ts#L397)). `toLocalDate` uses the SERVER's local time (Cloud Functions: UTC; client: browser local), NOT IST. For a 11:59 PM IST shift start (= 18:29 UTC), shiftDate would be `today UTC` not `today IST` if computed client-side in a non-IST browser. **The kart-report doc id check below uses IST via `todayIST()` ([line 387](src/pipeline/api/shifts-firestore.ts#L387)) — so the two date computations can disagree on day boundaries.**

### Pattern 4 — Cleanup / expiry
- ⚠️ **HIGH** — `autoCloseExpiredShifts` ([line 126-167](src/pipeline/api/shifts-firestore.ts#L126)) **scans the FULL `shifts` collection on every list/start call** (`getDocs(shiftsCollection)` at line 135). With 1267 shifts already in the collection (per our duplicate-finder run), every list call reads 1267 docs. This is an O(N) cost that grows linearly with shift count. At 10k shifts the cost becomes a real Firestore bill.
- ⚠️ **MED** — `getLatestActiveShiftForUser` ([line 240-257](src/pipeline/api/shifts-firestore.ts#L240)) ALSO scans the full collection (`getDocs(shiftsCollection)`). Same O(N) cost.
- ⚠️ **MED** — Closed shifts accumulate forever. No archive.

### Pattern 5 — Audit / observability
- ✅ Force-close stamps `forceClosedBy`/`forceClosedByName`/`forceClosedAt`/`forceCloseReason` (just shipped).
- ⚠️ **MED** — `autoEnded: true` is written but never surfaced to the UI as a visible state. Owner reading the audit ledger can't tell "this shift was auto-closed at 1:30 AM, not properly checked out by the cashier" without inspecting the raw doc.
- ⚠️ **MED** — `endFirestoreShiftBreak` doesn't record WHY (e.g., emergency, scheduled, customer rush). Just timestamps.
- ⚠️ **MED** — `totalActiveHours` rounding: `toNonNegativeHours` floors negatives to 0 but accumulates float drift. For payroll-grade audit, store minutes as integers.

### Pattern 6 — Server-side enforcement
- ✅ `isPrivilegedRole` check on `endFirestoreShiftById` ([line 543](src/pipeline/api/shifts-firestore.ts#L543)) and on `forceCloseFirestoreShift` (just shipped).
- ✅ `assertLocationAccess` enforced at `startFirestoreShift` ([line 364](src/pipeline/api/shifts-firestore.ts#L364)).
- ⚠️ **MED** — Kart-report gate is checked at shift start ([line 386-394](src/pipeline/api/shifts-firestore.ts#L386)) — **server-side**, good. But the Manager Override flow we just built bypasses the cashier-dashboard preflight client-side; the server check above would block the gate again. Need to verify that the bypass flow goes through a path that re-validates the kart-report (or that the override is server-trusted via a kartReportBypassRequest doc).

**Top recommended fixes:** wrap `startFirestoreShift` in `runTransaction` to atomic-check active-shift uniqueness · index `shifts` by `userId` + `endTime` so `getLatestActiveShiftForUser` doesn't scan the full collection · use IST consistently for `shiftDate` (currently uses `toLocalDate` — server time) · surface `autoEnded: true` in the merged drawer as a distinct row badge · server-side check that `kartReportBypassRequest` is approved before allowing cashier shift start when no kart report exists.

---

## Cross-cutting summary — the 8 patterns that recur

Reading across all 14 audits, these patterns appear in >5 subsystems each:

1. **Client-side enforcement of role / business rules** (every subsystem). Project policy accepts this; mitigation is server-side audit Cloud Functions for the highest-value paths.
2. **Soft-delete cascade gap** (`deletedAt` not filtered) — vendor-ledger, invoices, scanner `lookupBill`, wallet debit, settlements, reports. Single highest-impact fix.
3. **State machines without enforced transitions** — bookings, refundStatus, paymentStatus, leads, invoices, shifts, kartReports, coupons. The `transitionBooking` helper pattern can be reused for each.
4. **Audit-via-overwrite instead of append-only event log** — bookings, leads, invoices, kart reports, shifts, vendor ledger. Reconstructing history requires inspecting `updatedAt` snapshots which aren't kept.
5. **Mutation triggers that re-derive instead of incremental update** — `extractItemSplits` re-runs every read; `autoCloseExpiredShifts` scans full collection every list. Cost grows linearly.
6. **Cache + write race** — vendor-ledger trigger's 5-min matcher cache, EventCampaign edits not propagating to existing bookings, Razorpay event ordering.
7. **Unbounded collections** — `interakt_message_requests`, `scans`, `serialLedger`, kart reports, incharge daily docs, leads timelines, vendor invoices. No archive policy anywhere.
8. **Cancellation tear-down loses evidence** — refund debit ledger rows are deleted alongside credit rows on cancel. Once a booking is cancelled-then-uncancelled, the refund history is gone.

## Highest-leverage cross-cutting fixes (single PR each)

1. **`bookingFilter` helper** that filters `deletedAt`, `voidedAt`, `cancelled === true`, `bookingStatus === 'cancelled'` — applied at every booking aggregation. Fixes pattern 2 across vendor-ledger, invoices, reports, settlements, scanner.
2. **`transitionStatus(docRef, validTransitions, toStatus, actor)` helper** — used by bookings / leads / invoices / shifts / kart reports. Writes an audit event subdoc + validates. Fixes pattern 3 and 4 together.
3. **`bookings/{id}/events/{eventId}` subcollection** — every mutation (status change, refund, reschedule, cancel, force-close) appends an event with actor + reason. Solves pattern 4.
4. **Cloud Function trigger that fans out cleanup-on-soft-delete** — on `bookings/{id}` write where `deletedAt` becomes set, delete vendor-ledger rows. Mirrors the existing cancellation tear-down for the soft-delete path.
5. **`autoCloseExpiredShifts` rewrite** — query `where('endTime', '==', null)` instead of scanning all shifts; index `userId+endTime`. Fixes pattern 5 for the shift system specifically.

---

# Gap audit complete.

---

# Overnight Fixes Shipped (2026-05-12)

Direct production-impacting changes made in this session, after the gap audit completed. All ship behind `tsc --noEmit` clean + unit tests green.

## Vendor-ledger Fix 1 — soft-delete cascade
- [`functions/lib/vendor-ledger-sync.js`](../../../functions/lib/vendor-ledger-sync.js) — new `isTerminated(booking)` helper checks `cancelled`, `deletedAt`, AND `voidedAt`. Trigger tears down ledger rows on any of the three (was: only `cancelled === true`).
- [`functions/test/vendor-ledger-sync.test.js`](../../../functions/test/vendor-ledger-sync.test.js) — +4 unit tests covering soft-delete and voided paths.
- One-off [`scripts/cleanup-ledger-for-soft-deleted-bookings.cjs`](../../../scripts/cleanup-ledger-for-soft-deleted-bookings.cjs) for backfill. Dry-run finds 0 phantom rows in current data — historical data is clean.

## Vendor-ledger Fix 2 — drop bookingId fallback for invoiceNumber
- [`functions/lib/vendor-ledger-sync.js`](../../../functions/lib/vendor-ledger-sync.js) — `pickInvoiceNumber` returns null instead of falling back to bookingId; trigger refuses to write credits and stamps `ledgerSkippedReason: "missing_invoice_number"` on the booking when there's no real invoice number.
- [`src/pipeline/api/reconciliation-firestore.ts`](../../../src/pipeline/api/reconciliation-firestore.ts) — `applyRefundCorrection` no longer falls back to `input.bookingId` for `invoiceNumber` (matches trigger contract).
- [`functions/test/vendor-ledger-sync.test.js`](../../../functions/test/vendor-ledger-sync.test.js) — +5 unit tests including legacy assertion rewritten.
- One-off [`scripts/repair-ledger-bookingid-as-invoicenumber.cjs`](../../../scripts/repair-ledger-bookingid-as-invoicenumber.cjs) — distinguishes canonical (`invoiceNumber === bookingId === id`, by design in `unified-booking.ts`) from truly broken fallback rows. Dry-run found 3,447 canonical + only **15 truly broken** out of 3,465 total ledger rows.

## Invoice generation — soft-delete filter
- [`functions/lib/invoice-generation.js`](../../../functions/lib/invoice-generation.js) — `mapTransactionRecord` now carries `deletedAt` / `voidedAt`; `generateWeeklyInvoices` filter chain excludes them; staleness-check `currentValidTxnIds` matches.

## Scanner — soft-delete + cancellation guard
- [`src/pipeline/features/track/scanner/services/scannerApi.ts`](../../../src/pipeline/features/track/scanner/services/scannerApi.ts) — `lookupBill` now refuses to return cancelled bookings, soft-deleted bookings, or voided bookings. Pre-fix a scanned QR for a cancelled ticket would still walk the verifySerials flow.

## Cross-cutting `bookingFilter` helper
- [`src/lib/booking-filter.ts`](../../../src/lib/booking-filter.ts) — TWO predicates with intentionally different semantics:
  - `isTerminatedBooking` (READ-side aggregators) — checks all 4 signals: `cancelled`, `bookingStatus === 'cancelled'`, `deletedAt`, `voidedAt`.
  - `isHardTerminatedBooking` (TRIGGER-side cleanup) — narrower: ONLY `cancelled`, `deletedAt`, `voidedAt`. **Excludes `bookingStatus === 'cancelled'` so the trigger doesn't race with AllBookingsView's manual reverse-credit flow** (see `useBookingsData.ts:49-84` — that flow deliberately writes `bookingStatus: 'cancelled'` without `cancelled: true` and reverses ledger credits client-side via `reverseVendorCreditsForBooking`).
- [`src/lib/booking-filter.test.ts`](../../../src/lib/booking-filter.test.ts) — 13 unit tests covering both predicates + null safety.
- Applied to:
  - [`src/pipeline/api/billing-firestore.ts`](../../../src/pipeline/api/billing-firestore.ts) — `listFilteredBillingTransactions` now uses helper (previously missed `deletedAt`/`voidedAt`).
  - [`src/pipeline/api/accounting-firestore.ts`](../../../src/pipeline/api/accounting-firestore.ts) — `isPayableTxn` + Pass 1 settlement loop now use helper.
  - [`src/pipeline/api/asquare-revenue.ts`](../../../src/pipeline/api/asquare-revenue.ts) — Revenue tab no longer counts cancelled/voided/bookingStatus-cancelled rows (previously only `deletedAt`).
  - [`src/pipeline/api/reports-firestore.ts`](../../../src/pipeline/api/reports-firestore.ts) — both `filterPaidBookings` (general rollup) and `filterGameRevenueBookings` (Game Revenue report) use helper.
  - [`src/pipeline/features/dashboard/dashboard-data.ts`](../../../src/pipeline/features/dashboard/dashboard-data.ts) — Owner dashboard "today" KPIs use helper.
- Admin SDK mirror: [`functions/lib/booking-filter.js`](../../../functions/lib/booking-filter.js) — identical predicate for Cloud Functions. Wired into:
  - [`functions/lib/vendor-ledger-sync.js`](../../../functions/lib/vendor-ledger-sync.js) — `isTerminated` now delegates to the shared module.
  - [`functions/lib/invoice-generation.js`](../../../functions/lib/invoice-generation.js) — both `generateWeeklyInvoices` filter chain and `staleness check` use helper.

## Test totals
- vendor-ledger-sync (functions): 14 → **24 tests, all green** (includes AllBookingsView-pattern regression test).
- booking-filter (new): **13 tests, all green** (covers both `isTerminatedBooking` + `isHardTerminatedBooking`).
- helicopterEarlyBird: 10 → **18 tests, all green** (covers all four guard branches of `decrementHelicopterCountForCancellation`).
- **Full `src/lib/` + `src/pipeline/api/` + `src/services/` suite — 562 tests across 51 files, 0 failures.**
- Fixed an unrelated pre-existing test mismatch: `vendor-ids-contract.test.ts` was asserting an old function name (`loadVendorGameNamesById`) that was refactored to `loadEventPackageMatchers`. Updated the assertion to match current code.
- `tsc --noEmit -p tsconfig.app.json` — **0 errors**.

## Files NOT yet using the helper (next-iteration follow-ups)
- `src/pipeline/api/asquare-bookings.ts` — list bookings APIs (intentionally show cancelled in UI; only hide deleted). NO change needed unless UI semantics shift.
- Scattered scripts under `scripts/audit-*.cjs` — audit-only, not aggregators.
- Dashboard sub-widgets (KPI grid sub-components) — pull from `transactions` already filtered, so safe; revisit if any reads raw bookings.

## Bonus subsystem audits (not in original 14)

### Wallet — `src/services/walletService.ts`

**Pattern 1 — Idempotency:** Excellent. Atomic `runTransaction`, idempotency-key support on `addBalance` ([line 165-203](../../../src/services/walletService.ts#L165)), auto-ID for non-idempotent debits avoiding the Date.now() collision the bug-finder skill flags.

**Pattern 2 — State machine:** ✅ `walletFrozen` + `locked` flags respected; `ownerOverride` opt-out documented.

**Pattern 3 — Cascade:** ✅ Root mirror (`users/{id}.walletBalance`) kept in lock-step via single-transaction writes.

**Pattern 5 — Audit / observability:**
- ⚠️ **MED** — `deductBalance` swallows the distinction between user-facing failures (frozen wallet / insufficient balance) and infrastructure failures (network / Firestore). All collapse to `return false`. Caller can't tell which retry strategy applies.
- ⚠️ **MED** — No `idempotencyKey` support on `deductBalance` (only on `addBalance`). Two-clicks could double-debit in theory; in practice mitigated by client-side button-disable but no server-side guarantee.

**Pattern 6 — Server-side enforcement:**
- ⚠️ **MED** — `walletFrozen` flag is checked on the user doc. With permissive Firestore rules anyone with a token can clear the flag. Server-side enforcement would require a Cloud Function bridge.

Overall: the wallet system is one of the better-designed parts of the platform. Minimal gaps.

### Tickets / SLA watcher — `functions/api/ticket-sla-watcher.js`

**Pattern 2 — State machine:**
- ⚠️ **MED** — SLA watcher only looks at `status: 'Open' | 'In Progress'` ([line 31](../../../functions/api/ticket-sla-watcher.js#L31)). Any custom / future status (e.g. `'Pending Approval'`, `'Pending Customer'`) is invisible to the watcher.

**Pattern 3 — Cascade:**
- ⚠️ **HIGH** — Escalation picks the first user with the next role; branch hit is preferred but **if no branch match exists, falls back to ANY user in that role** ([line 62-63](../../../functions/api/ticket-sla-watcher.js#L62)). A Vizag ticket could escalate to Kakinada Owner if Vizag has no user with the escalating role. Cross-branch leak.

**Pattern 4 — Cleanup:**
- ⚠️ **MED** — `limit(50)` per 5-min run ([line 33](../../../functions/api/ticket-sla-watcher.js#L33)). >50 simultaneous breaches → only 50 handled per run; the rest wait 5 more minutes.

**Pattern 5 — Audit:**
- ✅ `recordActivity` for breach events.
- ⚠️ **MED** — Escalation decision (which candidates were considered, why this one was chosen) not logged. Hard to audit "why did the Vizag-branch ticket end up with the Kakinada Owner?".

**Pattern 6 — Server-side enforcement:**
- ✅ Cloud Function-driven; server-controlled.
- ⚠️ **LOW** — `escalationChainRemaining` set at create time. Role rename / add / remove later doesn't propagate to existing tickets.

### Helicopter early-bird — `src/services/helicopterEarlyBird.ts`

**Pattern 1 — Idempotency:**
- ✅ Atomic counter via Firestore `increment`.
- ✅ Razorpay webhook guarded by `helicopterCountIncremented` flag.

**Pattern 2 — State machine:**
- ⚠️ **HIGH** — Early-bird limit (`ticketsSold < EARLY_BIRD_LIMIT`) is checked at READ time ([line 51](../../../src/services/helicopterEarlyBird.ts#L51)), not at increment. **50 concurrent online checkouts all see "early-bird available", all get the ₹3999 price even when the cumulative count would exceed 300.** Race window: read-then-write between getPricing call and webhook count-bump. Customer keeps the price they paid even past the cutoff.

**Pattern 3 — Cascade:**
- ⚠️ **HIGH** — **Cancellation decrement is path-inconsistent.** `functions/api/delete-booking.js` ([line 71-83](../../../functions/api/delete-booking.js#L71)) DOES decrement the counter. But `cancelFirestoreBillingTransaction` (POS Cancel Transaction) does NOT — it sets `cancelled: true` without touching the counter. Same for any AllBookingsView "Cancel" path. Result: POS-cancelled helicopter bookings leave the count inflated; early-bird "sold out" appears earlier than reality → some early-bird-eligible bookings get charged the ₹4999 regular price.
- ⚠️ **MED** — `syncHelicopterCount` ([line 64](../../../src/services/helicopterEarlyBird.ts#L64)) reads ALL bookings on every call. Same full-scan pattern as the shifts perf gap (now fixed for shifts; helicopter still O(N) per sync).

**Pattern 5 — Audit:**
- ⚠️ **MED** — No log of when the cutoff was crossed. Owner can't answer "when exactly did we leave early-bird mode?".

**Pattern 6 — Server-side:**
- ⚠️ **MED** — Counter writes go through `incrementHelicopterBookingCount` (and the webhook). With permissive rules, anyone could `setDoc(counters/helicopter_bookings, {count: 0})` and reset the early-bird limit.

**Top recommended fixes:** transaction-wrap the read-price + write-booking step so the limit is checked atomically · decrement counter on cancellation (with the `helicopterCountIncremented` guard moved to a `helicopterCountDecremented` companion) · audit-log the cutoff event when count first crosses 300.

## Shifts perf — full-scan eliminated
- [`src/pipeline/api/shifts-firestore.ts`](../../../src/pipeline/api/shifts-firestore.ts) — `autoCloseExpiredShifts` now uses `where('shiftDate', '<', todayIST)` instead of reading the full `shifts` collection. Pre-fix this scanned 1267 docs on every list-shifts AND start-shift call.
- Same file — `getLatestActiveShiftForUser` now uses `where('userId', '==', userId)` instead of full-scan. Cashier "do I already have an active shift" check goes from ~1267 reads to ~5–30.

## Not yet started
- Vendor-ledger Fix 3 (single source of truth — Settlements reads from vendorLedger) — HIGH risk per design doc, needs feature-flag approach.
- `transitionBooking(...)` helper for booking state machine — cross-cutting #2.
- `bookings/{id}/events/{eventId}` audit subcollection — cross-cutting #3.

## Backfill scripts NOT yet applied
Both scripts ran in dry-run mode only — no production writes. Output committed in this session's bash history above. Awaiting Owner approval before `--apply`:
- `cleanup-ledger-for-soft-deleted-bookings.cjs` — found 0 rows to clean (no harm in running).
- `repair-ledger-bookingid-as-invoicenumber.cjs` — found 15 truly broken rows to mark for manual review (safe: only stamps `pendingInvoiceNumberFix: true`).

---

## Wake-up summary (for Owner)

What changed in this overnight session, in priority order:

1. **Vendor-ledger trigger now respects soft-delete + voided.** Bookings in Trash no longer leave phantom credit rows for vendors. Forward-going from now; historical data was already clean (0 rows to backfill).

2. **Vendor-ledger trigger refuses to write credits without a real invoice number.** Was falling back to bookingId which polluted vendor invoicing aggregation. Dry-run identified **15 truly broken historical rows** (out of 3,465 total — the rest are canonical `invoiceNumber === bookingId` from `unified-booking.ts:852`, which is by design). The 15 rows are flagged for manual review via the repair script (safe to run with `--apply`).

3. **Scanner no longer accepts cancelled or deleted bookings.** Pre-fix a customer with a refunded ticket QR could walk up and have their serial marked used. Now blocked at `lookupBill`.

4. **Helicopter early-bird counter is partially fixed.** Cloud Function `delete-booking.js` already decrements (✓), but `cancelFirestoreBillingTransaction` (POS Cancel) and AllBookingsView's `cancelBooking` (Admin Cancel) do NOT. Documented as a HIGH gap; not yet fixed because the cancel paths span multiple files. Real money impact: early-bird "sold out" appears earlier than reality whenever a POS/admin cancel removes a helicopter ticket.

5. **Shifts collection scan eliminated.** `autoCloseExpiredShifts` and `getLatestActiveShiftForUser` previously read all ~1267 shift docs on every call (cashier check-in, scanner shift status, daily-reports load). Now use indexed `where(...)` queries. Big Firestore-bill win as the collection grows.

6. **One shared `bookingFilter` helper** centralizes the four-signals "is this booking dead?" check. Used by 5 read-side aggregators (billing, accounting, revenue, reports, dashboard). The trigger uses a narrower variant so it doesn't break AllBookingsView's intentional dual-flag cancel flow — that distinction is the most subtle landmine I caught and explicitly tested for.

**Tests:** 45+ passing, no regressions. **TypeScript:** clean.

**Open items needing Owner decision:**
- Apply the 15-row invoice-number fix script (`--apply` flag).
- Decide on vendor-ledger Fix 3 (single source of truth for Settlements) — design doc at `2026-05-12-vendor-ledger-integrity-design.md`.

## Helicopter cancellation decrement — SHIPPED

The money-impact gap is now closed. New helper [`src/services/helicopterEarlyBird.ts`](../../../src/services/helicopterEarlyBird.ts) — `decrementHelicopterCountForCancellation(bookingId, booking)`:
- Idempotent (`helicopterCountIncremented` precondition + `helicopterCountDecremented` marker stamp).
- Computes seats from booking items using the same `name`/`category` match the Razorpay webhook uses.
- Decrements the `counters/helicopter_bookings` doc + stamps the marker in two writes.

Wired into ALL THREE cancel paths so the counter stays consistent regardless of which surface cancelled the booking:
- `functions/api/delete-booking.js` ✓ (was already correct pre-session)
- [`src/pipeline/api/billing-firestore.ts`](../../../src/pipeline/api/billing-firestore.ts) `cancelFirestoreBillingTransaction` (POS Cancel) — just added
- [`src/pipeline/pages/modules/bookings/useBookingsData.ts`](../../../src/pipeline/pages/modules/bookings/useBookingsData.ts) `cancelBooking` (Admin Cancel) — just added

After this: early-bird "sold out" cutoff now reflects real net ticket count, not gross-of-cancellations.


