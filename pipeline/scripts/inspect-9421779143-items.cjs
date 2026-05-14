/**
 * Read-only diagnostic — dump the items[] arrays of today's bookings for
 * 9421779143 so we can understand the combo data model before refunding.
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

const PHONE = '9421779143';
const TARGET = '2026-04-11';

const normalizePhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

const dateOf = (data) => {
  const grab = (v) => {
    if (!v) return null;
    if (typeof v === 'object' && typeof v.toDate === 'function') {
      try { return v.toDate().toISOString().slice(0, 10); } catch { return null; }
    }
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  };
  return grab(data.transactionDate) || grab(data.createdAt);
};

(async () => {
  const snap = await db.collection('bookings').get();
  const matches = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    if (normalizePhone(d.customerPhone) !== PHONE) return;
    if (dateOf(d) !== TARGET) return;
    if (d.paymentStatus !== 'completed') return;
    if (d.cancelled === true) return;
    if (d.refundStatus === 'Full') return;
    matches.push({ id: doc.id, data: d });
  });
  matches.sort((a, b) =>
    String(a.data.transactionDate || '').localeCompare(String(b.data.transactionDate || '')),
  );

  console.log(`matched: ${matches.length}\n`);

  // Show full items[] for the first 3 distinct totalAmount buckets
  const seenBuckets = new Set();
  let shown = 0;
  for (const m of matches) {
    const bucket = `${m.data.totalAmount}-${(m.data.items || []).length}`;
    if (seenBuckets.has(bucket)) continue;
    seenBuckets.add(bucket);
    console.log('━'.repeat(80));
    console.log(`${m.id}  total=₹${m.data.totalAmount}  baseAmount=₹${m.data.baseAmount}  gst=₹${m.data.gstAmount}`);
    console.log(`  customerName=${m.data.customerName}  paymentMethod=${m.data.paymentMethod}`);
    console.log(`  items (${(m.data.items || []).length}):`);
    (m.data.items || []).forEach((it, i) => {
      console.log(
        `    [${i}] ${it.itemName}\n` +
        `        qty=${it.quantity} unitPrice=₹${it.unitPrice} ` +
        `itemBase=₹${it.itemBaseAmount ?? '∅'} itemGst=₹${it.itemGstAmount ?? '∅'} ` +
        `vendorTotal=₹${it.vendorTotal ?? '∅'} gameId=${it.gameId ?? '∅'} refunded=${it.refunded ?? false}`
      );
    });
    shown++;
    if (shown >= 5) break;
  }

  // Aggregate totals across all matched transactions
  let sumTotal = 0;
  for (const m of matches) sumTotal += Number(m.data.totalAmount || 0);
  console.log('\n━'.repeat(80));
  console.log(`AGGREGATE total of all ${matches.length} matched transactions: ₹${sumTotal.toFixed(2)}`);

  // Show the 56th outlier (₹2696, 2 items)
  const outlier = matches.find((m) => (m.data.items || []).length === 2);
  if (outlier) {
    console.log('\n━'.repeat(80));
    console.log(`OUTLIER (2 items): ${outlier.id}  total=₹${outlier.data.totalAmount}`);
    (outlier.data.items || []).forEach((it, i) => {
      console.log(`    [${i}] ${it.itemName}  qty=${it.quantity}  unitPrice=₹${it.unitPrice}  itemBase=₹${it.itemBaseAmount ?? '∅'}`);
    });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
