/**
 * For each ledger row of a given vendor in a date range, classify the
 * linked booking:
 *
 *   - claimed       : booking exists AND its vendorIds[] includes this vendor → legitimate
 *   - ghost         : booking exists, vendorIds[] does NOT include this vendor → over-credit candidate
 *   - missing       : referenceId set but the booking doc does not exist → broken link
 *   - unlinked      : ledger row has no referenceId at all → true orphan
 *
 * For each `ghost` row, also report whether the booking's billingItems[]
 * has any item for this vendor (which would justify keeping the credit)
 * or no item at all (definitively over-credit).
 *
 * Usage:
 *   node scripts/find-ghost-ledger-credits.cjs <vendorId> <fromYMD> <toYMD>
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';

const vendorId = process.argv[2];
const fromYMD = process.argv[3];
const toYMD = process.argv[4];
if (!vendorId || !fromYMD || !toYMD) {
  console.error('Usage: node scripts/find-ghost-ledger-credits.cjs <vendorId> <fromYMD> <toYMD>');
  process.exit(1);
}

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const dateOf = (d) => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d.toDate) return d.toDate().toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};
const inRange = (ymd) => ymd >= fromYMD && ymd <= toYMD;

(async () => {
  const snap = await db.collection('vendorLedger').where('vendorId', '==', vendorId).get();
  const rows = [];
  for (const doc of snap.docs) {
    const e = doc.data();
    const dt = dateOf(e.date || e.transactionDate || e.createdAt);
    if (!inRange(dt)) continue;
    rows.push({
      id: doc.id,
      date: dt,
      amount: num(e.amount),
      type: e.type || '',
      source: e.source || '',
      bookingRef: e.bookingId || e.referenceId || '',
    });
  }

  const classified = { claimed: [], ghost: [], missing: [], unlinked: [] };
  for (const r of rows) {
    if (!r.bookingRef) {
      classified.unlinked.push(r);
      continue;
    }
    const bSnap = await db.collection('bookings').doc(r.bookingRef).get();
    if (!bSnap.exists) {
      classified.missing.push(r);
      continue;
    }
    const b = bSnap.data();
    const vendorIds = Array.isArray(b.vendorIds) ? b.vendorIds : [];
    const billingItems = Array.isArray(b.billingItems) ? b.billingItems : [];
    const items = Array.isArray(b.items) ? b.items : [];
    const hasVendorIdTag = vendorIds.includes(vendorId);
    const hasItemForVendor =
      billingItems.some((bi) => bi?.vendorId === vendorId) ||
      items.some((it) => it?.vendorId === vendorId);

    if (hasVendorIdTag) {
      classified.claimed.push(r);
    } else {
      classified.ghost.push({
        ...r,
        cancelled: b.cancelled === true,
        deletedAt: b.deletedAt || null,
        vendorIds,
        hasItemForVendor,
        bookingTotal: b.totalAmount,
        bookingFinal: b.finalAmount,
        locationId: b.locationId,
      });
    }
  }

  const sumOf = (arr) => Math.round(arr.reduce((s, r) => s + r.amount, 0));

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Ghost-credit classification · ${vendorId} · ${fromYMD} → ${toYMD}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  console.log(`Total ledger rows: ${rows.length}, sum: ${sumOf(rows)}`);
  console.log(`  claimed  : ${classified.claimed.length} rows, sum ${sumOf(classified.claimed)}  (vendor tagged on booking — legitimate)`);
  console.log(`  ghost    : ${classified.ghost.length} rows, sum ${sumOf(classified.ghost)}  (booking exists but vendor NOT in vendorIds[])`);
  console.log(`  missing  : ${classified.missing.length} rows, sum ${sumOf(classified.missing)}  (referenceId points to non-existent booking)`);
  console.log(`  unlinked : ${classified.unlinked.length} rows, sum ${sumOf(classified.unlinked)}  (no referenceId)`);

  if (classified.ghost.length > 0) {
    console.log('\nGhost credits (rows pointing at bookings that do not claim this vendor):');
    console.log('  date        amount  bookingId             locationId        hasItem  cancelled  bookingVendorIds');
    for (const r of classified.ghost) {
      console.log(
        `  ${r.date}  ${String(r.amount).padStart(6)}  ${r.bookingRef.padEnd(22)}  ${String(r.locationId || '—').padEnd(16)}  ${String(r.hasItemForVendor).padEnd(7)}  ${String(r.cancelled).padEnd(8)}  [${r.vendorIds.join(', ')}]`,
      );
    }
  }

  if (classified.missing.length > 0) {
    console.log('\nMissing-booking ledger rows (broken referenceId):');
    for (const r of classified.missing) {
      console.log(`  ${r.date}  ${String(r.amount).padStart(6)}  ${r.bookingRef}`);
    }
  }

  process.exit(0);
})().catch((err) => {
  console.error('Inspect failed:', err);
  process.exit(1);
});
