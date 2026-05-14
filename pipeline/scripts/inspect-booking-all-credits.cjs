/**
 * For a single booking, list every vendorLedger credit row that
 * references it. Use to confirm whether multi-vendor combo bookings
 * are split correctly (sum of credits ≈ vendor share of totalAmount)
 * or if vendors are double-credited.
 *
 * Usage:
 *   node scripts/inspect-booking-all-credits.cjs <bookingId>
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const bookingId = process.argv[2];
if (!bookingId) {
  console.error('Usage: node scripts/inspect-booking-all-credits.cjs <bookingId>');
  process.exit(1);
}

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

(async () => {
  const [bSnap, lSnap] = await Promise.all([
    db.collection('bookings').doc(bookingId).get(),
    db.collection('vendorLedger').where('referenceId', '==', bookingId).get(),
  ]);

  if (!bSnap.exists) {
    console.log('Booking not found.');
    process.exit(1);
  }
  const b = bSnap.data();
  console.log(`\n── Booking ${bookingId} ──`);
  console.log(`  locationId   : ${b.locationId}`);
  console.log(`  totalAmount  : ${b.totalAmount}`);
  console.log(`  finalAmount  : ${b.finalAmount}`);
  console.log(`  cancelled    : ${b.cancelled === true}`);
  console.log(`  vendorIds[]  : [${(b.vendorIds || []).join(', ')}]`);
  console.log(`  items count  : ${(b.items || []).length}`);
  console.log(`  billing count: ${(b.billingItems || []).length}`);

  const items = b.items || [];
  console.log('\nItems:');
  for (const it of items.slice(0, 12)) {
    console.log(
      `  qty=${it.quantity}  unitPrice=${it.unitPrice ?? it.price ?? '—'}  vendorId=${it.vendorId || '—'}  name=${it.itemName || it.activity?.name || '—'}`,
    );
  }

  const ledger = lSnap.docs.map((d) => d.data());
  let totalCredits = 0;
  for (const e of ledger) totalCredits += num(e.amount) * (e.type === 'debit' ? -1 : 1);

  console.log(`\n${ledger.length} ledger rows total. Net credits: ${Math.round(totalCredits)}`);
  for (const e of ledger.sort((a, b) => num(b.amount) - num(a.amount))) {
    console.log(
      `  ${e.vendorId.padEnd(12)} ${String(e.type).padEnd(6)} amount=${String(num(e.amount)).padStart(6)} source=${e.source || '—'} date=${(e.date || '').slice(0, 10)}`,
    );
  }

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
