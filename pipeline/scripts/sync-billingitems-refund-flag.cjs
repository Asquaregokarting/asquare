/**
 * Sync `billingItems[].refunded` with `items[].refunded` on every booking
 * where the two arrays disagree.
 *
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 * The customer-app refund flow stamps `refunded: true` on `items[]` only;
 * `billingItems[]` is left as written at booking time. `mapTransactionRecord`
 * (src/pipeline/api/billing-firestore.ts) prefers `billingItems` when
 * present, so settlements / vendor reports / the BookingDetailsModal lose
 * the refunded flag — the booking shows as paid-and-not-refunded even when
 * a refund was issued.
 *
 * This script copies `items[i].refunded === true` onto `billingItems[j]`
 * where `billingItems[j].variantId === items[i].variantId`, then writes
 * the updated `billingItems` back to the booking doc.
 *
 * Read-only by default. Pass `--apply` to write.
 *
 * Usage:
 *   node scripts/sync-billingitems-refund-flag.cjs                  # dry-run
 *   node scripts/sync-billingitems-refund-flag.cjs --apply
 *   node scripts/sync-billingitems-refund-flag.cjs --booking ASG... # spot-check
 *   node scripts/sync-billingitems-refund-flag.cjs --batch 200      # commit batch size
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const APPLY = process.argv.includes('--apply');
const SINGLE = argValue('--booking');
const BATCH_SIZE = Number(argValue('--batch') ?? '400');

if (!Number.isFinite(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > 500) {
  console.error('--batch must be 1..500');
  process.exit(1);
}

const DATABASE_ID = 'asquare-app-db';
const BOOKINGS_COLLECTION = 'bookings';

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

(async () => {
  console.log(`\n┌─ billingItems refunded sync (${APPLY ? 'APPLY' : 'dry-run'}) ─────────┐`);
  if (SINGLE) console.log(`│ booking: ${SINGLE}`);
  console.log(`└──────────────────────────────────────────────────────────────┘\n`);

  let docs;
  if (SINGLE) {
    const snap = await db.collection(BOOKINGS_COLLECTION).doc(SINGLE).get();
    if (!snap.exists) { console.error(`Booking ${SINGLE} not found.`); process.exit(1); }
    docs = [snap];
  } else {
    docs = (await db.collection(BOOKINGS_COLLECTION).get()).docs;
  }

  console.log(`Loaded ${docs.length} booking${docs.length === 1 ? '' : 's'}.\n`);

  let touched = 0;
  let unchanged = 0;
  let skippedNoItems = 0;
  let skippedNoBilling = 0;
  let skippedNoRefund = 0;
  let errors = 0;
  const samples = [];

  let batch = db.batch();
  let pending = 0;

  for (const snap of docs) {
    try {
      const data = snap.data() || {};
      const items = Array.isArray(data.items) ? data.items : [];
      const billingItems = Array.isArray(data.billingItems) ? data.billingItems : [];

      if (items.length === 0) { skippedNoItems++; continue; }
      if (billingItems.length === 0) { skippedNoBilling++; continue; }

      // Build a set of variantIds whose items[] entry is refunded.
      const refundedVariants = new Set();
      let anyRefundFlag = false;
      for (const it of items) {
        if (it && it.refunded === true) {
          anyRefundFlag = true;
          const vid = String(it.variantId ?? '');
          if (vid) refundedVariants.add(vid);
        }
      }
      if (!anyRefundFlag) { skippedNoRefund++; continue; }

      // Patch billingItems[]: set refunded=true on the matching variant rows.
      // We only flip false→true, never the reverse, so an admin who manually
      // toggled refunded on billingItems can't be silently overwritten.
      let changed = false;
      const next = billingItems.map((bi) => {
        if (!bi) return bi;
        const vid = String(bi.variantId ?? '');
        const shouldBeRefunded = vid ? refundedVariants.has(vid) : false;
        if (shouldBeRefunded && bi.refunded !== true) {
          changed = true;
          return { ...bi, refunded: true };
        }
        return bi;
      });

      if (!changed) { unchanged++; continue; }

      if (samples.length < 10) {
        samples.push({
          id: snap.id,
          variants: [...refundedVariants],
        });
      }

      if (APPLY) {
        batch.update(snap.ref, { billingItems: next });
        pending++;
        if (pending >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          pending = 0;
        }
      }
      touched++;
    } catch (err) {
      errors++;
      console.error(`Error on ${snap.id}:`, err.message);
    }
  }

  if (APPLY && pending > 0) await batch.commit();

  console.log(`─── summary ─────────────────────────────────────────────`);
  console.log(`  scanned                 : ${docs.length}`);
  console.log(`  ${APPLY ? 'updated                 ' : 'would update            '}: ${touched}`);
  console.log(`  unchanged (already in sync): ${unchanged}`);
  console.log(`  skipped (no items[])    : ${skippedNoItems}`);
  console.log(`  skipped (no billingItems): ${skippedNoBilling}`);
  console.log(`  skipped (no refund flag): ${skippedNoRefund}`);
  console.log(`  errors                  : ${errors}`);

  if (samples.length > 0) {
    console.log(`\n─── sample changes (${samples.length} of ${touched}) ───────────────`);
    for (const s of samples) {
      console.log(`  ${s.id}  refunded variants: ${JSON.stringify(s.variants)}`);
    }
  }

  console.log(APPLY ? `\nApply complete.\n` : `\nDry-run complete. Re-run with --apply to write.\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
