/**
 * Backfill `vendorIds: string[]` on every booking document.
 *
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 * ThirdParty vendors used to be scoped via `where('vendorId','==', X)` on the
 * top-level booking field, but that field only holds the FIRST vendor on a
 * multi-vendor combo invoice and is undefined on event-package bookings. So
 * any vendor whose item was not the primary line silently never saw the
 * booking in their list.
 *
 * The fix (in code) adds `vendorIds: string[]` on every new booking write
 * and switches the scoped query to `array-contains`. This script back-fills
 * the same field on existing bookings so vendors can see their historical
 * orders.
 *
 * What the script does
 *   1. Streams every doc in `bookings` (no orderBy → catches App bookings
 *      without `transactionDate`, same scan strategy as listAllBookings).
 *   2. Derives the unique set of vendor ids from items[]/billingItems[].
 *   3. Compares against the existing `vendorIds` field if any.
 *   4. Skips the doc if already correct, otherwise writes the new array via
 *      `set({ vendorIds }, { merge: true })`.
 *   5. Reports counters: scanned, updated, unchanged, item-less, errors.
 *
 * Usage
 *   node scripts/backfill-booking-vendor-ids.cjs                # dry run
 *   node scripts/backfill-booking-vendor-ids.cjs --apply        # actually write
 *   node scripts/backfill-booking-vendor-ids.cjs --apply --booking ASG260410174826320L0F1
 *   node scripts/backfill-booking-vendor-ids.cjs --batch 200    # commit batch size (default 400)
 *
 * Read-only by default. Pass `--apply` to write. Idempotent.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── CLI ────────────────────────────────────────────────────────────────────
const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const APPLY = process.argv.includes('--apply');
const SINGLE_BOOKING = argValue('--booking');
const BATCH_SIZE = Number(argValue('--batch') ?? '400');

if (!Number.isFinite(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > 500) {
  console.error('--batch must be 1..500 (Firestore batch limit).');
  process.exit(1);
}

// ─── Constants ──────────────────────────────────────────────────────────────
const DATABASE_ID = 'asquare-app-db';
const BOOKINGS_COLLECTION = 'bookings';

// ─── Admin SDK setup ────────────────────────────────────────────────────────
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

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Mirror of src/pipeline/api/firestore-utils.ts `deriveVendorIds`. */
const deriveVendorIds = (items) => {
  if (!Array.isArray(items)) return [];
  const ids = new Set();
  for (const item of items) {
    const vid = item && item.vendorId;
    if (typeof vid === 'string' && vid.trim().length > 0) ids.add(vid.trim());
  }
  return Array.from(ids);
};

const arraysEqualUnordered = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
};

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n┌─ booking vendorIds backfill (${APPLY ? 'APPLY' : 'dry-run'}) ─────────────┐`);
  if (SINGLE_BOOKING) console.log(`│ booking: ${SINGLE_BOOKING}`);
  console.log(`│ batch size: ${BATCH_SIZE}`);
  console.log(`└──────────────────────────────────────────────────────────────────┘\n`);

  let docs;
  if (SINGLE_BOOKING) {
    const snap = await db.collection(BOOKINGS_COLLECTION).doc(SINGLE_BOOKING).get();
    if (!snap.exists) {
      console.error(`Booking ${SINGLE_BOOKING} not found.`);
      process.exit(1);
    }
    docs = [snap];
  } else {
    const snapshot = await db.collection(BOOKINGS_COLLECTION).get();
    docs = snapshot.docs;
  }

  console.log(`Loaded ${docs.length} booking${docs.length === 1 ? '' : 's'}.\n`);

  let updated = 0;
  let unchanged = 0;
  let itemless = 0;
  let noVendors = 0;
  let errors = 0;
  const samplesUpdated = [];
  const samplesItemless = [];
  const samplesUnchanged = [];

  let batch = db.batch();
  let pendingInBatch = 0;

  for (const snap of docs) {
    try {
      const data = snap.data() || {};
      // Prefer billingItems (canonical for vendor attribution post-April 2026
      // fixes) and fall back to items[] for older bookings that never had
      // billingItems materialised.
      const items = Array.isArray(data.billingItems) && data.billingItems.length
        ? data.billingItems
        : Array.isArray(data.items)
          ? data.items
          : [];

      if (items.length === 0) {
        itemless++;
        if (samplesItemless.length < 5) samplesItemless.push(snap.id);
        continue;
      }

      const next = deriveVendorIds(items);
      const current = Array.isArray(data.vendorIds) ? data.vendorIds : null;

      // No vendor on any item is a legitimate state (gokarting-only bookings,
      // company-only lines). Don't stamp `vendorIds: []` because:
      //  (a) it's a wasted write,
      //  (b) `array-contains` won't match either way, so the empty array
      //      adds no scoping value over leaving the field absent,
      //  (c) future backfills (e.g. after vendor attribution corrections)
      //      can distinguish "never derived" from "derived as empty".
      if (next.length === 0) {
        if (current === null || current.length === 0) {
          noVendors++;
          continue;
        }
        // Existing field is non-empty but we now derive empty — that's a
        // regression on the items array, not a backfill case. Leave alone.
        unchanged++;
        continue;
      }

      if (current && arraysEqualUnordered(current, next)) {
        if (samplesUnchanged.length < 5) {
          samplesUnchanged.push({ id: snap.id, vendorIds: current });
        }
        unchanged++;
        continue;
      }

      if (samplesUpdated.length < 10) {
        samplesUpdated.push({ id: snap.id, before: current, after: next });
      }

      if (APPLY) {
        batch.set(snap.ref, { vendorIds: next }, { merge: true });
        pendingInBatch++;
        if (pendingInBatch >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          pendingInBatch = 0;
        }
      }
      updated++;
    } catch (err) {
      errors++;
      console.error(`Error on ${snap.id}:`, err.message);
    }
  }

  if (APPLY && pendingInBatch > 0) {
    await batch.commit();
  }

  console.log(`\n─── summary ─────────────────────────────────────────────────────`);
  console.log(`  scanned     : ${docs.length}`);
  console.log(`  ${APPLY ? 'updated     ' : 'would update'}: ${updated}`);
  console.log(`  unchanged   : ${unchanged}`);
  console.log(`  no-vendors  : ${noVendors} (items had no vendorId; vendorIds left absent)`);
  console.log(`  itemless    : ${itemless} (no items[] or billingItems[]; vendorIds left absent)`);
  console.log(`  errors      : ${errors}`);

  if (samplesUpdated.length > 0) {
    console.log(`\n─── sample changes (${Math.min(samplesUpdated.length, 10)} of ${updated}) ───────────────`);
    for (const s of samplesUpdated) {
      console.log(`  ${s.id}: ${JSON.stringify(s.before)} → ${JSON.stringify(s.after)}`);
    }
  }

  if (samplesItemless.length > 0) {
    console.log(`\n─── sample itemless booking ids (${Math.min(samplesItemless.length, 5)} of ${itemless}) ───────────────`);
    for (const id of samplesItemless) console.log(`  ${id}`);
  }

  if (samplesUnchanged.length > 0) {
    console.log(`\n─── sample unchanged docs (${Math.min(samplesUnchanged.length, 5)} of ${unchanged}) ───────────────`);
    for (const s of samplesUnchanged) {
      console.log(`  ${s.id}: vendorIds = ${JSON.stringify(s.vendorIds)}`);
    }
  }

  if (!APPLY) {
    console.log(`\nDry-run complete. Re-run with --apply to write.\n`);
  } else {
    console.log(`\nBackfill complete.\n`);
  }
  process.exit(0);
})().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
