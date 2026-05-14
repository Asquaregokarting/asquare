# Vendor Ledger Integrity — Three Fixes

Date: 2026-05-12
Author: brainstorm with Owner

Three related fixes to the vendor-ledger pipeline ([functions/lib/vendor-ledger-sync.js](../../../functions/lib/vendor-ledger-sync.js) and consumers). They share the same trigger and converge on the same downstream view, so they ship as one design.

---

## Goals

1. **Stop writing phantom vendor credits for soft-deleted bookings** — close the `deletedAt` cascade gap in the trigger.
2. **Stop writing `invoiceNumber = bookingId` when an invoice number is missing** — the trigger has been polluting vendor-facing invoice aggregation with one-row "invoices" that are actually orphan bookings.
3. **Pick one source of truth between `vendorLedger` and the Settlements view** — eliminate the ~₹50k drift the 2026-04-28 audit found (and the still-open ₹792 diff for SEERAMREDDY).

## Non-goals

- `vendorDetails`, `eventCampaigns`, share-percent calculation — out of scope (working today).
- GST split logic in `computeRevenueSplit` — tested and stable.
- Firestore security rules — project's permissive-rules stance is intentional.

---

## Fix 1 — Soft-delete cascade in the trigger

### Current behavior

`vendor-ledger-sync.js` tears down ledger rows only when `cancelled === true`:

```js
// functions/lib/vendor-ledger-sync.js:129
function isCancelled(booking) {
  return booking && booking.cancelled === true;
}
// line 819:
if (isCancelled(after)) {
  result.deleted = await deleteAllLedgerForBooking(db, bookingId);
  return result;
}
```

`deletedAt` and `voidedAt` are never checked. Soft-deleted bookings keep their credit rows in `vendorLedger`, inflating vendor invoices.

### Fix

Introduce `isTerminated(booking)` that returns true for any of:
- `cancelled === true`
- `deletedAt` truthy (ISO string or Timestamp)
- `voidedAt` truthy

Replace the call at line 819. The tear-down logic stays identical (`deleteAllLedgerForBooking`).

```js
function isTerminated(booking) {
  if (!booking) return false;
  if (booking.cancelled === true) return true;
  if (booking.deletedAt) return true;
  if (booking.voidedAt) return true;
  return false;
}
```

### Backfill

Existing phantom rows must be cleaned. New script `scripts/cleanup-ledger-for-soft-deleted-bookings.cjs`:

1. Query bookings where `deletedAt != null` OR `voidedAt != null`.
2. For each: query `vendorLedger where referenceId == bookingId`.
3. If any rows found: log + delete (batched).
4. `--dry-run` prints what would be deleted.
5. `--apply` does the deletes.

Idempotent — safe to re-run.

### Risk

- LOW. Only affects soft-deleted bookings; their credits should never have been written. Worst case: a few "manually un-deleted" bookings get re-credited on the next trigger fire (handled — credits are idempotent).

### Testing

Add `functions/test/vendor-ledger-sync.test.js` case:
- Booking with `deletedAt` set → `syncVendorLedger` should call `deleteAllLedgerForBooking`, return `{ deleted: N }`.
- Booking with `voidedAt` set → same.
- Booking with neither → unchanged behavior.

---

## Fix 2 — Drop the bookingId fallback for invoiceNumber

### Current behavior

```js
// functions/lib/vendor-ledger-sync.js:122
function pickInvoiceNumber(booking, bookingId) {
  return booking.invoiceNumber || booking.billingId || bookingId;
}
```

When neither field is set, the ledger row's `invoiceNumber` becomes the bookingId. Downstream `vendorInvoices` aggregation then treats that bookingId as a one-row invoice — false invoice in the vendor's history.

### Fix

Two parts:

**A. Trigger refuses to write a credit row without a real invoice number.**

```js
function pickInvoiceNumber(booking) {
  const candidate = booking.invoiceNumber || booking.billingId;
  return (typeof candidate === 'string' && candidate.trim()) ? candidate.trim() : null;
}
```

In `writeCreditEntries` ([line 689](../../../functions/lib/vendor-ledger-sync.js#L689)):

```js
const invoiceNumber = pickInvoiceNumber(booking);
if (!invoiceNumber) {
  console.error(
    '[vendor-ledger-sync] booking has no invoiceNumber — refusing to write credits to avoid polluting vendorInvoices aggregation',
    { bookingId }
  );
  // Stamp a marker on the booking so reconciliation can find it.
  await db.collection('bookings').doc(bookingId).set(
    { ledgerSkippedReason: 'missing_invoice_number', ledgerSkippedAt: nowIso() },
    { merge: true }
  );
  return 0;
}
```

**B. Booking writers stamp invoiceNumber at completion time.**

Every code path that flips `paymentStatus` to `'completed'` must also ensure `invoiceNumber` is set. Audit and patch:
- `src/lib/unified-booking.ts` — already generates one via `generateOrderNumber()`.
- `src/services/bookingService.ts` — verify.
- `functions/api/razorpay.js` webhook handler — verify.
- `functions/api/booking-confirmation.js` — verify.
- POS billing flow — verify.

Add a unit test asserting that every booking written through these paths carries `invoiceNumber`.

### Backfill

Script `scripts/repair-ledger-bookingid-as-invoicenumber.cjs`:
1. Query `vendorLedger` where `invoiceNumber === referenceId` (the smoke-test for the bug).
2. For each: look up the source booking; if it has a real `invoiceNumber` / `billingId` now → update the ledger row. Else → mark the ledger row with `pendingInvoiceNumberFix: true` and surface in an audit.
3. `--dry-run` / `--apply`.

### Risk

- MED. Tightens the trigger; some legacy bookings without invoice numbers may stop being credited (was happening, just silently). The error log + booking marker makes the reconciliation path explicit.

### Testing

- Trigger test: booking without invoiceNumber → no credits written, `ledgerSkippedReason` stamped, returns `{ credits: 0, skipped: true }`.
- Trigger test: booking with invoiceNumber → credits written normally.

---

## Fix 3 — Single source of truth (vendorLedger as the canonical read)

### Current behavior

Two systems compute vendor totals independently:

- **`vendorLedger`** — written by `vendor-ledger-sync` trigger on every booking write. Source of truth for what's been credited.
- **Settlements view** — re-derives from `bookings` via `extractItemSplits`, then *overlays* non-`sale` ledger entries (`manual_adjustment`, `discrepancy_correction`).

The 2026-04-28 audit found 22 of 23 vendors had ledger-vs-settlements gaps (~₹50k drift across one week). The current mitigation is audit scripts. The cost: every audit week starts with a reconciliation pass.

### Fix

**Make `vendorLedger` the single read path.**

Settlements view reads only from `vendorLedger`, summed by `(vendorId, period)`. The `extractItemSplits` inline computation is removed. Manual adjustments still write to `vendorLedger` directly (already do, via `accountingApi.createLedgerAdjustment`).

The trigger remains the canonical writer for sale credits + refund debits. Manual paths (corrections, adjustments) remain owner-driven writes.

### What this changes

1. **`AccountingModule.tsx` Settlements view** — replace `extractItemSplits(...) + overlay manual adjustments` with `groupBy(vendorLedger, vendorId)` for the period.
2. **`itemsForLedgerEntry` helper** stays (resolves billing items per ledger row for display).
3. **Audit scripts** focus on one contract: "vendorLedger == sum of bookings' vendor credits + manual adjustments". If it diverges, the trigger is failing — investigate the trigger, not the view.
4. **Performance** — Settlements view goes from O(bookings × items) to O(ledger rows) per period. Usually 10-50x fewer rows.

### Migration

1. **Rebuild vendorLedger** for the audit window (e.g. last 6 months) using `functions/scripts/backfill-vendor-ledger.js`. Run with `--verify` mode first to compare current vs rebuilt; resolve any inconsistencies.
2. **Switch Settlements view** to read from vendorLedger. Keep the old code path behind a feature flag (`VITE_LEDGER_AS_SOT`) for one week to compare.
3. **Remove the old code path** once a full accounting week passes without divergence.

### Risk

- HIGH. Architectural change. Mitigated by:
  - Backfill + verify before switching the view.
  - Feature flag fallback.
  - The trigger has been the canonical writer since April 2026 — vendorLedger is already mostly correct.

### Testing

- Unit test: `groupVendorLedgerByPeriod` returns same totals as `extractItemSplits + overlay` for a known week.
- Integration: enable the flag in staging, run for one accounting week, compare exports.

---

## Migration order

1. Ship Fix 1 (low-risk, immediate audit hygiene win).
2. Run the soft-delete backfill — clean phantom rows.
3. Ship Fix 2 (gates the trigger; tighten + audit booking writers in same PR).
4. Run the invoiceNumber backfill.
5. Ship Fix 3 behind a feature flag.
6. Verify for one accounting week.
7. Remove the old Settlements computation.

Expected timeline: Fixes 1+2 in one PR (~1 day each). Fix 3 over the following week.

---

## Open questions for owner

- **Voided vs deleted** — does the project use `voidedAt` as well as `deletedAt`? If only `deletedAt`, simplify `isTerminated` accordingly.
- **`ledgerSkippedReason` surface** — should this show up as a row in the Owner Discrepancies tab so missing-invoice bookings are visible?
- **The SEERAMREDDY ₹792** — once Fix 1's backfill runs, re-check the vendor's total. The ₹792 may resolve automatically if a soft-deleted booking was the cause. If not, escalate to a targeted investigation.

---

## Spec self-review

- ✅ No `TODO` / `TBD` placeholders.
- ✅ Each fix has Current → Fix → Backfill → Risk → Testing sections.
- ✅ Internally consistent — Fix 3 explicitly depends on Fix 1's cleanup (otherwise ledger has phantom rows).
- ✅ Scope: three discrete fixes, sized for one implementation plan.
- ⚠️ Ambiguity flagged in "Open questions" — voided vs deleted, ledgerSkippedReason surfacing.

Ready for implementation planning.
