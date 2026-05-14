/**
 * Headline historical-mismatch audit for vendor data.
 *
 * Three classes are reported:
 *
 *   A. Visibility — bookings that under the legacy `where('vendorId','==', X)`
 *      query were invisible to non-primary vendors. The new `vendorIds`
 *      array + `array-contains` query (already shipped + backfilled) makes
 *      every vendor visible. This audit just quantifies what was hidden.
 *
 *   B. Refund debit drift — bookings whose `items[].refunded === true` items
 *      do not match the ledger refund-debit rows for the same booking.
 *      `reports/refund-reconciliation.csv` (from
 *      `scripts/reconcile-vendor-refund-debits.cjs`) is the authoritative
 *      detail; this audit reports counts only.
 *
 *   C. items[].refunded vs billingItems[].refunded drift — bookings where the
 *      two arrays disagree on which items are refunded. `mapTransactionRecord`
 *      prefers `billingItems`, so a refunded `items[]` flag is silently lost
 *      from settlements / reports / vendor displays.
 *
 * Read-only. No flags.
 *
 * Usage:
 *   node scripts/audit-vendor-mismatches-historical.cjs
 *   node scripts/audit-vendor-mismatches-historical.cjs --csv reports/historical-mismatches.csv
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const CSV_PATH = argValue('--csv');

const DATABASE_ID = 'asquare-app-db';
const BOOKINGS_COLLECTION = 'bookings';
const LEDGER_COLLECTION = 'vendorLedger';
const REFUND_DEBIT_SOURCES = new Set(['refund', 'refund-correction', 'refund-correction-reversal']);

const keyPath = path.resolve('serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found in project root.');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

const deriveVendorIds = (items) => {
  if (!Array.isArray(items)) return [];
  const ids = new Set();
  for (const item of items) {
    const vid = item && item.vendorId;
    if (typeof vid === 'string' && vid.trim().length > 0) ids.add(vid.trim());
  }
  return Array.from(ids);
};

const refundedSetFromItems = (items) => {
  if (!Array.isArray(items)) return new Set();
  const out = new Set();
  for (let i = 0; i < items.length; i++) {
    if (items[i] && items[i].refunded === true) {
      const variantId = String((items[i] || {}).variantId ?? '');
      out.add(variantId || `idx:${i}`);
    }
  }
  return out;
};

(async () => {
  console.log(`\n┌─ historical vendor-mismatch audit (read-only) ───────────────┐`);
  console.log(`│ database: ${DATABASE_ID}`);
  console.log(`└──────────────────────────────────────────────────────────────┘\n`);

  const snapshot = await db.collection(BOOKINGS_COLLECTION).get();
  console.log(`Loaded ${snapshot.size} bookings.\n`);

  // ─── Class A: visibility ────────────────────────────────────────────────────
  let multiVendor = 0;
  let singleVendor = 0;
  let zeroVendor = 0;
  let totalSecondaryAppearances = 0;
  const secondaryByVendor = new Map(); // vendorId → count of bookings where they were NOT the primary vendor
  const sampleMultiVendor = [];

  // ─── Class C: items vs billingItems refund drift ────────────────────────────
  let refundFlagDrift = 0;
  const sampleRefundDrift = [];

  // Pre-collect refunded booking IDs for class B
  const refundedBookings = []; // { id, refundAmount, items, billingItems }

  snapshot.forEach((d) => {
    const data = d.data() || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const billingItems = Array.isArray(data.billingItems) ? data.billingItems : [];
    const sourceForVendor = billingItems.length > 0 ? billingItems : items;
    const vendorIds = deriveVendorIds(sourceForVendor);
    const primary = typeof data.vendorId === 'string' ? data.vendorId.trim() : '';

    if (vendorIds.length === 0) {
      zeroVendor++;
    } else if (vendorIds.length === 1) {
      singleVendor++;
    } else {
      multiVendor++;
      // Every vendor on the booking who is NOT the primary was hidden by the
      // legacy query. (If the legacy primary is unknown / missing, count
      // every vendor as a secondary appearance.)
      for (const vid of vendorIds) {
        if (primary && vid === primary) continue;
        totalSecondaryAppearances++;
        secondaryByVendor.set(vid, (secondaryByVendor.get(vid) ?? 0) + 1);
      }
      if (sampleMultiVendor.length < 5) {
        sampleMultiVendor.push({ id: d.id, vendorIds, primary });
      }
    }

    // Class C: items vs billingItems disagree on refunded set
    const itemsRefunded = refundedSetFromItems(items);
    const billingRefunded = refundedSetFromItems(billingItems);
    if (itemsRefunded.size !== billingRefunded.size) {
      refundFlagDrift++;
      if (sampleRefundDrift.length < 5) {
        sampleRefundDrift.push({
          id: d.id,
          itemsRefunded: [...itemsRefunded],
          billingRefunded: [...billingRefunded],
        });
      }
    } else {
      let same = true;
      for (const k of itemsRefunded) if (!billingRefunded.has(k)) { same = false; break; }
      if (!same) {
        refundFlagDrift++;
        if (sampleRefundDrift.length < 5) {
          sampleRefundDrift.push({
            id: d.id,
            itemsRefunded: [...itemsRefunded],
            billingRefunded: [...billingRefunded],
          });
        }
      }
    }

    // Collect refunded bookings for Class B
    const refundStatus = String(data.refundStatus ?? 'None');
    const refundAmount = Number(data.refundAmount ?? 0);
    if ((refundStatus === 'Partial' || refundStatus === 'Full') && refundAmount > 0) {
      refundedBookings.push({
        id: d.id,
        refundAmount,
        items,
        billingItems,
      });
    }
  });

  // ─── Class B: refund debit drift (compare items[].refunded → expected debit
  //              vs vendorLedger refund-debit rows) ────────────────────────────
  let bookingsWithDebitDrift = 0;
  let totalAbsoluteDebitDelta = 0;
  const sampleDebitDrift = [];

  for (const b of refundedBookings) {
    // Expected per-vendor debit = sum of vendorTotal over items[] where refunded === true.
    // Falls back to billingItems by variantId when items[] lacks vendor fields.
    const billingByVariant = new Map();
    for (const bi of b.billingItems) {
      if (!bi) continue;
      const variantId = String(bi.variantId ?? '');
      if (!variantId) continue;
      billingByVariant.set(variantId, {
        vendorId: String(bi.vendorId ?? ''),
        vendorTotal: Number(bi.vendorTotal ?? 0),
      });
    }
    const expected = new Map(); // vendorId → vendorTotal sum
    let refundedItemCount = 0;
    for (const it of b.items) {
      if (!it || it.refunded !== true) continue;
      refundedItemCount++;
      let vid = String(it.vendorId ?? '');
      let total = Number(it.vendorTotal ?? 0);
      if (!vid || total <= 0) {
        const fallback = billingByVariant.get(String(it.variantId ?? ''));
        if (fallback) {
          vid = fallback.vendorId;
          total = fallback.vendorTotal;
        }
      }
      if (!vid || total <= 0) continue;
      expected.set(vid, (expected.get(vid) ?? 0) + total);
    }
    if (refundedItemCount === 0) continue;

    // Actual per-vendor debit = sum of refund-debit ledger rows for this booking.
    const ledgerSnap = await db
      .collection(LEDGER_COLLECTION)
      .where('referenceId', '==', b.id)
      .get();
    const actual = new Map();
    ledgerSnap.forEach((ld) => {
      const r = ld.data() || {};
      const vid = String(r.vendorId ?? '');
      if (!vid) return;
      const isRefundDebit = r.type === 'debit' && REFUND_DEBIT_SOURCES.has(String(r.source ?? ''));
      const isReversal = r.type === 'credit' && String(r.source ?? '') === 'refund-correction-reversal';
      if (isRefundDebit) actual.set(vid, (actual.get(vid) ?? 0) + Number(r.amount ?? 0));
      else if (isReversal) actual.set(vid, (actual.get(vid) ?? 0) - Number(r.amount ?? 0));
    });

    const allVids = new Set([...expected.keys(), ...actual.keys()]);
    let bookingDelta = 0;
    for (const v of allVids) {
      const delta = (expected.get(v) ?? 0) - (actual.get(v) ?? 0);
      bookingDelta += Math.abs(delta);
    }
    if (bookingDelta > 0) {
      bookingsWithDebitDrift++;
      totalAbsoluteDebitDelta += bookingDelta;
      if (sampleDebitDrift.length < 5) {
        sampleDebitDrift.push({ id: b.id, expected: [...expected], actual: [...actual] });
      }
    }
  }

  // ─── Print summary ──────────────────────────────────────────────────────────
  console.log(`─── A. Visibility (multi-vendor bookings) ────────────────────`);
  console.log(`  Multi-vendor bookings (>=2 distinct vendors)  : ${multiVendor}`);
  console.log(`  Single-vendor bookings                        : ${singleVendor}`);
  console.log(`  Zero-vendor bookings (company-only / no items): ${zeroVendor}`);
  console.log(`  Secondary-vendor appearances (the # of vendor/booking pairs hidden by the old query)`);
  console.log(`                                                : ${totalSecondaryAppearances}`);
  if (secondaryByVendor.size > 0) {
    const top = [...secondaryByVendor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`  Top vendors by secondary appearances:`);
    for (const [vid, n] of top) console.log(`    ${vid}: ${n} bookings`);
  }
  if (sampleMultiVendor.length > 0) {
    console.log(`  Samples:`);
    for (const s of sampleMultiVendor) {
      console.log(`    ${s.id}  primary=${s.primary || '(none)'}  vendors=${JSON.stringify(s.vendorIds)}`);
    }
  }

  console.log(`\n─── B. Refund debit drift (vs ledger refund debits) ───────────`);
  console.log(`  Refunded bookings scanned                     : ${refundedBookings.length}`);
  console.log(`  Bookings with vendor debit drift              : ${bookingsWithDebitDrift}`);
  console.log(`  Total absolute |delta| across drifted bookings: ${inr(totalAbsoluteDebitDelta)}`);
  if (sampleDebitDrift.length > 0) {
    console.log(`  Samples:`);
    for (const s of sampleDebitDrift) {
      console.log(`    ${s.id}`);
      console.log(`      expected: ${JSON.stringify(s.expected)}`);
      console.log(`      actual:   ${JSON.stringify(s.actual)}`);
    }
  }

  console.log(`\n─── C. items[].refunded vs billingItems[].refunded drift ───────`);
  console.log(`  Bookings where the two arrays disagree         : ${refundFlagDrift}`);
  if (sampleRefundDrift.length > 0) {
    console.log(`  Samples:`);
    for (const s of sampleRefundDrift) {
      console.log(`    ${s.id}`);
      console.log(`      items[].refunded:        ${JSON.stringify(s.itemsRefunded)}`);
      console.log(`      billingItems[].refunded: ${JSON.stringify(s.billingRefunded)}`);
    }
  }

  if (CSV_PATH) {
    const dir = path.dirname(CSV_PATH);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = ['metric,value'];
    lines.push(`multi_vendor_bookings,${multiVendor}`);
    lines.push(`single_vendor_bookings,${singleVendor}`);
    lines.push(`zero_vendor_bookings,${zeroVendor}`);
    lines.push(`secondary_appearances,${totalSecondaryAppearances}`);
    lines.push(`refunded_bookings_scanned,${refundedBookings.length}`);
    lines.push(`bookings_with_debit_drift,${bookingsWithDebitDrift}`);
    lines.push(`total_abs_debit_delta_inr,${Math.round(totalAbsoluteDebitDelta)}`);
    lines.push(`items_vs_billing_refund_flag_drift,${refundFlagDrift}`);
    fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf-8');
    console.log(`\nCSV written: ${CSV_PATH}`);
  }

  console.log(`\nRead-only run complete.\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
