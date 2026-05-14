/**
 * For one vendor, one week: list every (booking, billingItem) row that
 * carries the vendor's id, and dump the per-line numbers — qty,
 * unitPrice, itemBaseAmount, itemGstAmount, vendorBase, vendorGst,
 * vendorTotal — so we can see WHY their settlement totals look the
 * way they do.
 *
 * Usage:
 *   node scripts/inspect-vendor-week-splits.cjs <vendorId> <fromYMD> <toYMD>
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

const vendorId = process.argv[2];
const from = process.argv[3];
const to = process.argv[4];
if (!vendorId || !from || !to) {
  console.error('Usage: node scripts/inspect-vendor-week-splits.cjs <vendorId> <fromYMD> <toYMD>');
  process.exit(1);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const r2 = (n) => Math.round(n);
const dateOf = (d) => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d.toDate) return d.toDate().toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

(async () => {
  console.log(`\nVendor ${vendorId} · ${from} → ${to}\n`);
  const snap = await db
    .collection('bookings')
    .where('vendorIds', 'array-contains', vendorId)
    .get();

  const rows = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.cancelled === true) continue;
    if (d.deletedAt || d.voidedAt) continue;
    const dt = dateOf(d.transactionDate || d.visitDate || d.createdAt);
    if (dt < from || dt > to) continue;

    const billing = Array.isArray(d.billingItems) ? d.billingItems : [];
    let lineNo = 0;
    for (const bi of billing) {
      lineNo++;
      if (bi?.vendorId !== vendorId) continue;
      rows.push({
        bookingId: doc.id,
        dt,
        loc: d.locationId,
        lineNo,
        item: (bi.itemName || '').slice(0, 50),
        qty: num(bi.quantity),
        unitPrice: num(bi.unitPrice),
        base: num(bi.itemBaseAmount),
        gst: num(bi.itemGstAmount),
        vBase: num(bi.vendorBase),
        vGst: num(bi.vendorGst),
        vTotal: num(bi.vendorTotal),
      });
    }
  }

  // Frequency of vendorBase values
  const freq = new Map();
  for (const r of rows) freq.set(r.vBase, (freq.get(r.vBase) || 0) + 1);
  const sortedFreq = [...freq.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`Total tagged line rows: ${rows.length}`);
  console.log('vendorBase value frequency (top 10):');
  for (const [val, count] of sortedFreq.slice(0, 10)) {
    console.log(`  ₹${String(val).padStart(6)}  × ${count}`);
  }

  console.log('\nSample lines (first 25):');
  console.log(
    '  date        loc  bk                       line  qty  unitPrice  base  gst  vBase  vGst  vTotal  item',
  );
  for (const r of rows.slice(0, 25)) {
    console.log(
      `  ${r.dt}  ${String(r.loc || '').padEnd(3)}  ${r.bookingId.padEnd(22)}  ${String(r.lineNo).padStart(3)}  ${String(r.qty).padStart(3)}  ${String(r.unitPrice).padStart(8)}  ${String(r.base).padStart(5)}  ${String(r.gst).padStart(4)}  ${String(r.vBase).padStart(5)}  ${String(r.vGst).padStart(4)}  ${String(r.vTotal).padStart(6)}  ${r.item}`,
    );
  }

  // Sums
  const totalVTotal = rows.reduce((s, r) => s + r.vTotal, 0);
  const totalVBase = rows.reduce((s, r) => s + r.vBase, 0);
  const totalVGst = rows.reduce((s, r) => s + r.vGst, 0);
  console.log(`\nΣ vendorBase  : ₹${r2(totalVBase)}`);
  console.log(`Σ vendorGst   : ₹${r2(totalVGst)}`);
  console.log(`Σ vendorTotal : ₹${r2(totalVTotal)}`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
