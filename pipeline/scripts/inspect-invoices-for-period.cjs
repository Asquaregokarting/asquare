/**
 * List every vendorInvoice for a given period with status + total, so
 * we can verify what the Pending Settlement page is summing.
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(fs.readFileSync(path.resolve('serviceAccountKey.json'), 'utf-8')),
  ),
});
const db = admin.firestore();
db.settings({ databaseId: 'asquare-app-db' });

const from = process.argv[2];
const to = process.argv[3];

(async () => {
  const snap = await db.collection('vendorInvoices').get();
  const rows = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const ps = String(d.periodStart || '').slice(0, 10);
    const pe = String(d.periodEnd || '').slice(0, 10);
    if (ps !== from || pe !== to) continue;
    rows.push({
      id: doc.id,
      vendor: d.vendorId,
      vendorName: d.vendorName,
      status: d.status || 'pending',
      total: d.totalAmount,
      txns: d.transactionCount,
      locationId: d.locationId,
    });
  }
  rows.sort((a, b) => (b.total || 0) - (a.total || 0));

  let lockedSum = 0,
    pendingSum = 0,
    lockedCount = 0,
    pendingCount = 0;
  for (const r of rows) {
    if (r.status === 'locked') {
      lockedSum += r.total || 0;
      lockedCount++;
    } else {
      pendingSum += r.total || 0;
      pendingCount++;
    }
  }
  console.log(`\nPeriod ${from} → ${to}`);
  console.log(`Total invoices: ${rows.length}`);
  console.log(`  Locked  : ${lockedCount} · sum ₹${Math.round(lockedSum).toLocaleString('en-IN')}`);
  console.log(`  Pending : ${pendingCount} · sum ₹${Math.round(pendingSum).toLocaleString('en-IN')}`);
  console.log(`  Combined: ₹${Math.round(lockedSum + pendingSum).toLocaleString('en-IN')}\n`);
  for (const r of rows) {
    console.log(
      `  [${r.status.padEnd(7)}] ${r.id.padEnd(50)}  vendor=${r.vendor}  loc=${r.locationId}  txns=${r.txns}  ₹${Math.round(r.total || 0)}`,
    );
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
