/**
 * Repair the "subtract-to-zero" bookings — the two cases the sweep found
 * where a billingItem's itemBaseAmount/itemGstAmount were flipped negative
 * to make finalAmount=0 while the booking stayed confirmed and the line
 * items kept their real vendor stamps.
 *
 * Per-booking action:
 *   - Snapshot the current state to a `_priorState` field on the doc
 *   - Restore each negative billingItems[i].itemBaseAmount /
 *     itemGstAmount to the honest positive split derived from
 *     `unitPrice * quantity` (gross), using the GST rate inferred from
 *     the positive line in the same booking (falls back to 18% if no
 *     positive line is available)
 *   - Set `cancelled = true`, `paymentStatus = 'cancelled'`,
 *     `refundStatus = 'cancelled-data-fix'` so the booking is excluded
 *     from revenue + vendor accounting in a defensible way
 *   - Recompute `finalAmount` from the restored billingItems
 *   - Stamp `dataFix` audit metadata (reason, script, when, by)
 *
 * Default mode is --dry-run. Pass --apply to actually write.
 *
 * Usage:
 *   node scripts/fix-zero-out-bookings.cjs            # dry run (default)
 *   node scripts/fix-zero-out-bookings.cjs --apply    # writes changes
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const APPLY = process.argv.includes('--apply');
const DATABASE_ID = 'asquare-app-db';
const TARGETS = ['ASG260411235153111CP7L', 'ASG260502190314957WKJS'];

const keyPath = path.resolve('serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found in project root.');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID, ignoreUndefinedProperties: true });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const r2 = (n) => Math.round(n);

const inferGstRate = (billingItems) => {
  for (const it of billingItems) {
    const base = num(it.itemBaseAmount);
    const gst = num(it.itemGstAmount);
    if (base > 0 && gst > 0) {
      const rate = gst / base;
      if (rate > 0.01 && rate < 1) return rate;
    }
  }
  return 0.18;
};

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Zero-out bookings repair — mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  for (const id of TARGETS) {
    const ref = db.collection('bookings').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`✗ ${id} — not found, skipping`);
      continue;
    }
    const d = snap.data();
    const billingItems = Array.isArray(d.billingItems) ? d.billingItems : [];
    if (billingItems.length === 0) {
      console.log(`✗ ${id} — no billingItems, skipping`);
      continue;
    }
    const gstRate = inferGstRate(billingItems);
    const base1 = 1 + gstRate;

    console.log(`\n── ${id} ──`);
    console.log(`  before: paymentStatus=${d.paymentStatus} cancelled=${d.cancelled === true} refundStatus=${d.refundStatus}`);
    console.log(`  before: totalAmount=${d.totalAmount} finalAmount=${d.finalAmount}`);
    console.log(`  inferred GST rate: ${(gstRate * 100).toFixed(2)}%`);

    // The trustworthy anchors on each booking:
    //   - billingItems[i].quantity   (qty rung at POS — never flipped)
    //   - billingItems[i].unitPrice  (unit price rung at POS — never flipped)
    //   - billingItems[i].itemBaseAmount/itemGstAmount on POSITIVE lines
    //     (the ones the cashier didn't tamper with)
    //
    // The artificial flip is on a SUBSET of lines where base/gst were
    // overwritten negative to zero out finalAmount. We restore those by
    // making the booking's restored bill match its declared totalAmount:
    //
    //   target_for_negative_lines = totalAmount - Σ positive_gross
    //
    // If there are multiple negative lines we split that target across
    // them proportionally to qty × unitPrice. If the target ≤ 0, fall
    // back to qty × unitPrice per line (treats totalAmount as stale).
    const sumPositiveGross = billingItems.reduce((s, it) => {
      const base = num(it.itemBaseAmount);
      const gst = num(it.itemGstAmount);
      return base >= 0 && gst >= 0 ? s + base + gst : s;
    }, 0);
    const negativeLines = billingItems.filter(
      (it) => num(it.itemBaseAmount) < 0 || num(it.itemGstAmount) < 0,
    );
    const negativeUnitGrossSum = negativeLines.reduce((s, it) => {
      const qty = Math.max(1, Math.floor(num(it.quantity)) || 1);
      const unit = num(it.unitPrice);
      return s + qty * unit;
    }, 0);
    const target = Math.max(0, num(d.totalAmount) - sumPositiveGross);
    const useTotalAnchor = target > 0 && negativeUnitGrossSum > 0;

    console.log(
      `  sumPositiveGross=${sumPositiveGross}  target_for_negatives=${target}  (totalAmount − Σ positive)`,
    );
    console.log(
      `  negativeLines=${negativeLines.length}  Σ qty×unitPrice on negatives=${negativeUnitGrossSum}`,
    );
    if (useTotalAnchor && Math.abs(target - negativeUnitGrossSum) > 5) {
      console.log(
        `  ⚠ qty×unitPrice (${negativeUnitGrossSum}) differs from totalAmount-anchor (${target}) by ${target - negativeUnitGrossSum}. Using totalAmount-anchor for honest restore.`,
      );
    }

    const restoredBillingItems = billingItems.map((it) => {
      const base = num(it.itemBaseAmount);
      const gst = num(it.itemGstAmount);
      if (base >= 0 && gst >= 0) return it; // untouched positive line

      const qty = Math.max(1, Math.floor(num(it.quantity)) || 1);
      const unit = num(it.unitPrice);
      const unitGross = qty * unit;
      const gross = useTotalAnchor
        ? r2((unitGross / negativeUnitGrossSum) * target)
        : unitGross;
      const restoredBase = r2(gross / base1);
      const restoredGst = r2(gross - restoredBase);

      console.log(
        `    ${it.itemName}: base ${base} → ${restoredBase}, gst ${gst} → ${restoredGst} (gross ${gross}, qty×unit=${unitGross})`,
      );
      return { ...it, itemBaseAmount: restoredBase, itemGstAmount: restoredGst };
    });

    const nextFinalFromLines = restoredBillingItems.reduce(
      (s, it) => s + num(it.itemBaseAmount) + num(it.itemGstAmount),
      0,
    );

    const update = {
      billingItems: restoredBillingItems,
      // cancelled=true is the ACCOUNTING LEVER — it excludes the booking
      // from Game Revenue, vendor splits, and ledger reads. paymentStatus
      // stays as the original value (money DID come in at POS; we are
      // NOT claiming a refund happened). refundStatus is set to
      // 'unknown-investigate' so the doc is honest about the unresolved
      // question: comp/freebie vs. unrecorded physical refund.
      cancelled: true,
      paymentStatus: d.paymentStatus,
      refundStatus: 'unknown-investigate',
      finalAmount: 0,
      // Audit trail. Stays on the doc so anyone investigating later can
      // reconstruct what the script changed and why.
      dataFix: {
        appliedAt: new Date().toISOString(),
        script: 'scripts/fix-zero-out-bookings.cjs',
        reason:
          'Subtract-to-zero pattern detected: negative itemBaseAmount/itemGstAmount used to zero out finalAmount while booking stayed confirmed. Restored line items to honest positive values; set cancelled=true so reporting and vendor accounting exclude this booking. paymentStatus preserved (money came in at POS); refundStatus=unknown-investigate flags that the real-world money state — comp/freebie vs. unrecorded physical refund — needs cashier/staff confirmation.',
        priorState: {
          billingItems,
          cancelled: d.cancelled,
          paymentStatus: d.paymentStatus,
          refundStatus: d.refundStatus,
          finalAmount: d.finalAmount,
          totalAmount: d.totalAmount,
        },
      },
    };

    console.log(
      `  after : cancelled=true paymentStatus=${d.paymentStatus} (preserved) refundStatus=unknown-investigate`,
    );
    console.log(`  after : finalAmount=0  (sum of restored lines: ${nextFinalFromLines})`);
    console.log(`  totalAmount unchanged at ${d.totalAmount}`);

    if (APPLY) {
      await ref.set(update, { merge: true });
      console.log(`  ✓ APPLIED`);
    } else {
      console.log(`  ⏸  dry-run — pass --apply to write`);
    }
  }

  console.log('\nDone.\n');
  process.exit(0);
})().catch((err) => {
  console.error('Repair failed:', err);
  process.exit(1);
});
