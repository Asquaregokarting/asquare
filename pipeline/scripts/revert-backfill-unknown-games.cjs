/**
 * Revert the writes made by backfill-unknown-games.cjs --confirm.
 *
 * Reads `backfill-unknown-games-applied.json` (the audit log produced by the
 * commit run) and, for every patched item, clears gameId / subGameId /
 * variantId back to null on the live `bookings/{id}` doc.
 *
 * Safety:
 *   - Dry-run by default. Writes ONLY with --confirm.
 *   - For each item, clears a field ONLY if its current value equals what the
 *     backfill proposed. This means any manual fix done after the backfill
 *     (an operator remapping to a real game) is preserved untouched.
 *   - Never touches price, itemName, vendorId, refund state, or any
 *     booking-level field.
 *
 * Usage:
 *   node scripts/revert-backfill-unknown-games.cjs            # dry-run
 *   node scripts/revert-backfill-unknown-games.cjs --confirm  # apply
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── CLI ────────────────────────────────────────────────────────────────────
const CONFIRM = process.argv.includes('--confirm');
const DRY_RUN = !CONFIRM;
const tag = DRY_RUN ? '[DRY]' : '[RUN]';

// ─── Constants ──────────────────────────────────────────────────────────────
const DATABASE_ID = 'asquare-app-db';
const BOOKINGS_COLLECTION = 'bookings';
const APPLIED_PATH = path.resolve('backfill-unknown-games-applied.json');
const BATCH_SIZE = 400;

// ─── Admin SDK setup ────────────────────────────────────────────────────────
const keyPath = path.resolve('serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found in project root.');
  process.exit(1);
}
if (!fs.existsSync(APPLIED_PATH)) {
  console.error(`Applied log not found at ${APPLIED_PATH}.`);
  console.error('This script only reverts a previous --confirm run.');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

// ─── Helpers ────────────────────────────────────────────────────────────────

function revertField(currentValue, proposedValue) {
  // Clear the field only if the live value equals what the backfill set.
  // Anything else is a post-backfill manual fix and must be preserved.
  if (currentValue == null || currentValue === '') return { shouldClear: false, newValue: currentValue };
  if (currentValue === proposedValue) return { shouldClear: true, newValue: null };
  return { shouldClear: false, newValue: currentValue };
}

function revertItem(item, proposed) {
  const next = { ...item };
  let touched = false;

  const gi = revertField(next.gameId, proposed.gameId);
  if (gi.shouldClear) {
    next.gameId = null;
    touched = true;
  }
  const si = revertField(next.subGameId, proposed.subGameId);
  if (si.shouldClear) {
    next.subGameId = null;
    touched = true;
  }
  if (proposed.variantId) {
    const vi = revertField(next.variantId, proposed.variantId);
    if (vi.shouldClear) {
      next.variantId = null;
      touched = true;
    }
  }

  return { next, touched };
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  ${tag} Revert backfill-unknown-games writes`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Applied log : ${APPLIED_PATH}`);

  const log = JSON.parse(fs.readFileSync(APPLIED_PATH, 'utf-8'));
  const patches = Array.isArray(log.patches) ? log.patches : [];
  console.log(`  Bookings    : ${patches.length}\n`);

  const summary = {
    bookingsPlanned: 0,
    itemsPlanned: 0,
    bookingsSkippedPostManual: 0,
    itemsSkippedPostManual: 0,
    bookingsCommitted: 0,
    itemsCommitted: 0,
  };

  const pending = []; // { bookingId, update }

  for (const entry of patches) {
    const ref = db.collection(BOOKINGS_COLLECTION).doc(entry.bookingId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const data = snap.data();

    const itemPatches = new Map();
    const billingPatches = new Map();
    for (const p of entry.patches) {
      if (p.source === 'items') itemPatches.set(p.itemIndex, p);
      else billingPatches.set(p.itemIndex, p);
    }

    const update = {};
    let touchedAny = false;
    let skippedAny = false;

    const processArray = (arr, patchMap, key) => {
      const next = arr.map((item, idx) => {
        const p = patchMap.get(idx);
        if (!p) return item;
        const { next: nextItem, touched } = revertItem(item, p.proposed);
        if (touched) {
          summary.itemsPlanned++;
          touchedAny = true;
          return nextItem;
        }
        summary.itemsSkippedPostManual++;
        skippedAny = true;
        return item;
      });
      if (patchMap.size > 0) update[key] = next;
    };

    if (itemPatches.size > 0) {
      const items = Array.isArray(data.items) ? data.items : [];
      processArray(items, itemPatches, 'items');
    }
    if (billingPatches.size > 0) {
      const bi = Array.isArray(data.billingItems) ? data.billingItems : [];
      processArray(bi, billingPatches, 'billingItems');
    }

    if (!touchedAny) {
      summary.bookingsSkippedPostManual++;
      console.log(`  ⏭  ${entry.bookingId} — all items already re-mapped manually, skipping`);
      continue;
    }

    summary.bookingsPlanned++;
    console.log(
      `  ${DRY_RUN ? '•' : '↩'}  ${entry.bookingId} — will revert ${itemPatches.size + billingPatches.size} item(s)${skippedAny ? ' (some preserved due to manual fix)' : ''}`,
    );
    pending.push({ bookingId: entry.bookingId, update });
  }

  if (DRY_RUN) {
    console.log('\n──────────────────────────────────────────────────────────────');
    console.log('  Summary (dry run)');
    console.log('──────────────────────────────────────────────────────────────');
    console.log(`  Bookings to revert           : ${summary.bookingsPlanned}`);
    console.log(`  Items to clear               : ${summary.itemsPlanned}`);
    console.log(`  Bookings skipped (post-edit) : ${summary.bookingsSkippedPostManual}`);
    console.log(`  Items skipped (post-edit)    : ${summary.itemsSkippedPostManual}`);
    console.log('\n  Re-run with --confirm to apply.');
    process.exit(0);
  }

  // Commit in batches.
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const slice = pending.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { bookingId, update } of slice) {
      batch.update(db.collection(BOOKINGS_COLLECTION).doc(bookingId), update);
    }
    await batch.commit();
    summary.bookingsCommitted += slice.length;
    summary.itemsCommitted = summary.itemsPlanned;
    console.log(`  Committed batch : ${Math.min(i + BATCH_SIZE, pending.length)} / ${pending.length}`);
  }

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('  Summary');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  Bookings reverted : ${summary.bookingsCommitted}`);
  console.log(`  Items cleared     : ${summary.itemsCommitted}`);
  console.log(`  Post-edit skipped : ${summary.bookingsSkippedPostManual} bookings / ${summary.itemsSkippedPostManual} items`);
  console.log('\n  Done.');

  process.exit(0);
})().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
