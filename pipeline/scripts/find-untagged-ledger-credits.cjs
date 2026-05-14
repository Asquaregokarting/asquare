/**
 * For each (booking, vendor) pair where the ledger has a credit but the
 * booking's billingItems has NO item tagged for that vendor, report
 * details. These are the bookings the reconcile script skipped with
 * "no tagged items". They need either: (a) the vendor stamped on an
 * item, or (b) the ledger row deleted because the vendor doesn't
 * appear on the booking at all.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

(async () => {
  const ledgerSnap = await db.collection('vendorLedger').get();
  const pairs = new Map();
  for (const doc of ledgerSnap.docs) {
    const e = doc.data();
    if (e.type === 'debit') continue;
    const ref = e.bookingId || e.referenceId || '';
    if (!ref || !e.vendorId) continue;
    const k = `${ref}::${e.vendorId}`;
    const acc = pairs.get(k) ?? { bookingId: ref, vendorId: e.vendorId, amount: 0 };
    acc.amount += num(e.amount);
    pairs.set(k, acc);
  }

  const cases = [];
  for (const p of pairs.values()) {
    const snap = await db.collection('bookings').doc(p.bookingId).get();
    if (!snap.exists) continue;
    const b = snap.data();
    if (b.cancelled === true) continue;
    const billing = Array.isArray(b.billingItems) ? b.billingItems : [];
    const items = Array.isArray(b.items) ? b.items : [];
    const taggedInBilling = billing.some((bi) => bi.vendorId === p.vendorId);
    const taggedInItems = items.some((it) => it.vendorId === p.vendorId);
    if (taggedInBilling || taggedInItems) continue;
    cases.push({
      bookingId: p.bookingId,
      vendorId: p.vendorId,
      amount: p.amount,
      locationId: b.locationId,
      itemNames: items.map((it) => it.itemName || (it.activity && it.activity.name)).slice(0, 5),
    });
  }

  cases.sort((a, b) => b.amount - a.amount);
  console.log(`\n${cases.length} (booking, vendor) pairs have a ledger credit but no item tagged.\n`);
  for (const c of cases) {
    console.log(
      `  vendor=${c.vendorId}  ₹${c.amount}  booking=${c.bookingId}  loc=${c.locationId}\n     items: ${c.itemNames.join(' | ')}`,
    );
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
