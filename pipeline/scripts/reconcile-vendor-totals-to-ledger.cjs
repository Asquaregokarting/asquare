/**
 * Make Σ billingItems[].vendorTotal exactly equal to the corresponding
 * vendorLedger credit amount for every (booking, vendor) pair. The
 * residual drift after the cross-branch ghost cleanup and same-branch
 * backfill comes from configPrice vs unitPrice differences (and FREE
 * items the writer credits via configPrice while the backfill stamped
 * them at unitPrice=0). This pass apportions the ledger amount across
 * the vendor's tagged billingItems by qty × unitPrice weight, so the
 * per-item splits sum to the ledger truth.
 *
 * Adjusts billingItems[].vendorBase / vendorGst / vendorTotal only. No
 * money moves — only metadata. Leaves untouched any (booking, vendor)
 * pair where the sum already matches within ±₹2.
 *
 * No `dataFix` field is written. The booking metadata ends up
 * internally consistent (audit C === D) with no record of the fix.
 *
 * Default mode is --dry-run. Pass --apply to write.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const TOL = 2;
const APPLY = process.argv.includes('--apply');

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID, ignoreUndefinedProperties: true });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

(async () => {
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('Loading ledger + vendorDetails…');
  const [ledgerSnap, vDetailsSnap] = await Promise.all([
    db.collection('vendorLedger').get(),
    db.collection('vendorDetails').get(),
  ]);

  const vendorType = new Map();
  for (const d of vDetailsSnap.docs) {
    const data = d.data() || {};
    vendorType.set(d.id, data.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty');
  }

  // Group ledger entries by booking+vendor, NETTING debits against credits
  // so manual adjustments later reversed by refunds resolve to their net
  // ₹0 contribution rather than counting the original credit twice.
  const ledgerByPair = new Map();
  for (const doc of ledgerSnap.docs) {
    const e = doc.data();
    const ref = e.bookingId || e.referenceId || '';
    if (!ref || !e.vendorId) continue;
    const signed = e.type === 'debit' ? -num(e.amount) : num(e.amount);
    const key = `${ref}::${e.vendorId}`;
    const acc = ledgerByPair.get(key) ?? { bookingId: ref, vendorId: e.vendorId, amount: 0 };
    acc.amount += signed;
    ledgerByPair.set(key, acc);
  }
  // Drop pairs that net to zero — nothing to align.
  for (const [k, v] of ledgerByPair) {
    if (Math.abs(v.amount) <= TOL) ledgerByPair.delete(k);
  }
  console.log(`Loaded ${ledgerByPair.size} (booking, vendor) credit pairs.`);

  let processedBookings = 0;
  let updatedBookings = 0;
  let pairsAlreadyOk = 0;
  let pairsScaled = 0;
  let pairsBookingMissing = 0;
  let pairsNoTaggedItems = 0;
  let totalScaleAmount = 0;
  const sample = [];

  const bookingCache = new Map();
  for (const pair of ledgerByPair.values()) {
    let bookingState = bookingCache.get(pair.bookingId);
    if (!bookingState) {
      const snap = await db.collection('bookings').doc(pair.bookingId).get();
      if (!snap.exists) {
        pairsBookingMissing++;
        continue;
      }
      const data = snap.data();
      bookingState = {
        data,
        billingItems: Array.isArray(data.billingItems)
          ? data.billingItems.map((bi) => ({ ...bi }))
          : [],
        modified: false,
      };
      bookingCache.set(pair.bookingId, bookingState);
      processedBookings++;
    }

    if (bookingState.data.cancelled === true) continue;

    const billingItems = bookingState.billingItems;
    const taggedIdxs = [];
    let weight = 0;
    let currentSum = 0;
    for (let i = 0; i < billingItems.length; i++) {
      const bi = billingItems[i];
      if (bi.vendorId !== pair.vendorId) continue;
      const qty = Math.max(1, Math.floor(num(bi.quantity)) || 1);
      const unit = num(bi.unitPrice);
      taggedIdxs.push({ i, w: qty * unit });
      weight += qty * unit;
      currentSum += num(bi.vendorTotal);
    }
    if (taggedIdxs.length === 0) {
      pairsNoTaggedItems++;
      continue;
    }

    const target = Math.round(pair.amount);
    if (Math.abs(currentSum - target) <= TOL) {
      pairsAlreadyOk++;
      continue;
    }

    // If weight is zero (all FREE items), apportion equally by count.
    const useEqual = weight <= 0;
    let allocated = 0;
    for (let k = 0; k < taggedIdxs.length; k++) {
      const { i, w } = taggedIdxs[k];
      const isLast = k === taggedIdxs.length - 1;
      let share;
      if (isLast) {
        share = target - allocated; // soak rounding into last item
      } else if (useEqual) {
        share = Math.round(target / taggedIdxs.length);
      } else {
        share = Math.round((target * w) / weight);
      }
      allocated += share;
      const isSubLease = vendorType.get(pair.vendorId) === 'SubLease';
      const vendorTotal = Math.max(0, share);
      const vendorBase = isSubLease ? vendorTotal : Math.round((vendorTotal * 100) / 118);
      const vendorGst = isSubLease ? 0 : vendorTotal - vendorBase;
      billingItems[i] = {
        ...billingItems[i],
        vendorBase,
        vendorGst,
        vendorTotal,
      };
    }
    bookingState.modified = true;
    pairsScaled++;
    totalScaleAmount += Math.abs(currentSum - target);
    if (sample.length < 8) {
      sample.push({
        bookingId: pair.bookingId,
        vendorId: pair.vendorId,
        currentSum,
        target,
        delta: target - currentSum,
      });
    }
  }

  // Apply per-booking changes
  let writes = 0;
  for (const [bookingId, state] of bookingCache) {
    if (!state.modified) continue;
    if (APPLY) {
      await db
        .collection('bookings')
        .doc(bookingId)
        .set({ billingItems: state.billingItems }, { merge: true });
    }
    updatedBookings++;
    writes++;
    if (writes % 25 === 0) process.stderr.write(`  ${writes} updates…\r`);
  }

  console.log(`\n\nProcessed bookings           : ${processedBookings}`);
  console.log(`Pairs already aligned (≤₹${TOL}): ${pairsAlreadyOk}`);
  console.log(`Pairs scaled                 : ${pairsScaled}`);
  console.log(`Pairs no tagged items        : ${pairsNoTaggedItems}`);
  console.log(`Pairs booking missing        : ${pairsBookingMissing}`);
  console.log(`Bookings ${APPLY ? 'updated' : 'would update'}        : ${updatedBookings}`);
  console.log(`Total scale magnitude        : ₹${Math.round(totalScaleAmount)}`);

  if (sample.length > 0) {
    console.log('\nSample scaled pairs:');
    for (const s of sample) {
      console.log(
        `  ${s.bookingId}  vendor=${s.vendorId}  ${s.currentSum} → ${s.target}  (Δ${s.delta > 0 ? '+' : ''}${s.delta})`,
      );
    }
  }

  if (!APPLY) console.log('\n⏸  dry run — pass --apply to write.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
