/**
 * Reverse of the same-branch backfill. After the cross-branch ghost
 * ledger cleanup ran, some bookings still have items stamped with a
 * vendor whose branch doesn't match the booking — those stamps were
 * written before the matcher had a branch gate. Now they're orphan
 * stamps (no ledger entry references them).
 *
 * For each billingItem (and items[] mirror) where:
 *   - vendorId is set
 *   - vendor's branchId differs from booking's locationId
 *   - no vendorLedger row credits this vendor for this booking
 * → clear vendorId / vendorBase / vendorGst / vendorTotal so the audit
 *   C column drops back to zero on that vendor.
 *
 * Default --dry-run; pass --apply to write.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const APPLY = process.argv.includes('--apply');

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID, ignoreUndefinedProperties: true });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const canonBranch = (raw, locMap) => {
  if (raw == null) return '';
  const s = String(raw).toLowerCase().trim();
  return locMap.get(s) || s;
};

(async () => {
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const [bookingsSnap, locsSnap, vDetailsSnap, ledgerSnap] = await Promise.all([
    db.collection('bookings').get(),
    db.collection('locations').get(),
    db.collection('vendorDetails').get(),
    db.collection('vendorLedger').get(),
  ]);

  const locMap = new Map();
  for (const d of locsSnap.docs) {
    const data = d.data() || {};
    if (typeof data.name === 'string') locMap.set(data.name.toLowerCase().trim(), d.id);
    locMap.set(d.id.toLowerCase().trim(), d.id);
  }

  const vendorBranch = new Map();
  for (const d of vDetailsSnap.docs) {
    const data = d.data() || {};
    const raw = data.branchId != null ? data.branchId : data.branch;
    const canon = canonBranch(raw, locMap);
    if (canon) vendorBranch.set(d.id, canon);
  }

  // Which (booking, vendor) pairs DO have a ledger credit?
  const ledgerPairs = new Set();
  for (const doc of ledgerSnap.docs) {
    const e = doc.data();
    if (e.type === 'debit') continue;
    const ref = e.bookingId || e.referenceId || '';
    if (!ref || !e.vendorId) continue;
    ledgerPairs.add(`${ref}::${e.vendorId}`);
  }

  let scanned = 0;
  let updated = 0;
  let itemsCleared = 0;
  const sample = [];

  for (const doc of bookingsSnap.docs) {
    scanned++;
    if (scanned % 500 === 0) process.stderr.write(`  scanned ${scanned}\r`);
    const b = doc.data();
    if (b.cancelled === true) continue;
    const bookingBranch = canonBranch(b.locationId, locMap);
    if (!bookingBranch) continue;

    const items = Array.isArray(b.items) ? b.items.map((it) => ({ ...it })) : [];
    const billing = Array.isArray(b.billingItems) ? b.billingItems.map((bi) => ({ ...bi })) : [];
    if (billing.length === 0) continue;

    let modified = false;
    const remainingVendorIds = new Set();

    for (let i = 0; i < billing.length; i++) {
      const bi = billing[i];
      const vid = bi.vendorId;
      if (!vid) continue;
      const vBranch = vendorBranch.get(vid);
      const hasLedger = ledgerPairs.has(`${doc.id}::${vid}`);
      if (!vBranch || vBranch === bookingBranch || hasLedger) {
        remainingVendorIds.add(vid);
        continue;
      }
      // Cross-branch stamp without ledger backing — clear.
      billing[i] = {
        ...bi,
        vendorId: undefined,
        vendorBase: undefined,
        vendorGst: undefined,
        vendorTotal: undefined,
      };
      if (items[i] && items[i].vendorId === vid) {
        items[i] = { ...items[i], vendorId: undefined };
      }
      modified = true;
      itemsCleared++;
      if (sample.length < 10) {
        sample.push({
          booking: doc.id,
          vendor: vid,
          vBranch,
          bookingBranch,
          itemName: bi.itemName,
        });
      }
    }

    // Also walk items[] for any cross-branch vendorIds the billingItems
    // loop above didn't catch (paranoid cleanup).
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const vid = it.vendorId;
      if (!vid) continue;
      const vBranch = vendorBranch.get(vid);
      const hasLedger = ledgerPairs.has(`${doc.id}::${vid}`);
      if (!vBranch || vBranch === bookingBranch || hasLedger) {
        remainingVendorIds.add(vid);
        continue;
      }
      items[i] = { ...it, vendorId: undefined };
      modified = true;
    }

    if (!modified) continue;

    if (APPLY) {
      await db
        .collection('bookings')
        .doc(doc.id)
        .set(
          {
            items,
            billingItems: billing,
            vendorIds: [...remainingVendorIds].sort(),
          },
          { merge: true },
        );
    }
    updated++;
  }

  console.log(`\nScanned bookings : ${scanned}`);
  console.log(`Bookings updated : ${updated}`);
  console.log(`Items cleared    : ${itemsCleared}`);
  if (sample.length > 0) {
    console.log('\nSample:');
    for (const s of sample) {
      console.log(
        `  ${s.booking}  vendor=${s.vendor} (br=${s.vBranch}, booking br=${s.bookingBranch})  "${s.itemName}"`,
      );
    }
  }
  if (!APPLY) console.log('\n⏸  dry run — pass --apply.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
