/**
 * Sweep all bookings for the "subtract-to-zero" pattern where a billingItem
 * was given a NEGATIVE itemBaseAmount/itemGstAmount to manually zero out
 * finalAmount instead of using a proper cancel/refund path.
 *
 * Output:
 *   - Total bookings scanned
 *   - Bookings with at least one negative billingItems[*].itemBaseAmount
 *   - Bookings with at least one negative billingItems[*].itemGstAmount
 *   - Bookings where the negative line exactly cancels a positive line
 *     (signature of the manual "free this booking" hack)
 *   - Breakdown by branch and month
 *   - Sample of 20 offending booking IDs for spot-check
 *
 * Usage:
 *   node scripts/sweep-negative-billing-items.cjs
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const PAGE_SIZE = 500;

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

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const month = (d) => {
  if (!d) return 'unknown';
  const s = typeof d === 'string' ? d : (d.toDate ? d.toDate().toISOString() : String(d));
  return s.slice(0, 7);
};

(async () => {
  let total = 0;
  let withNegBase = 0;
  let withNegGst = 0;
  let withZeroFinal = 0;
  let withSubtractToZero = 0;
  const byBranch = new Map();
  const byMonth = new Map();
  const samples = [];

  let last = null;
  while (true) {
    let q = db.collection('bookings').orderBy('__name__').limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      total++;
      const d = doc.data();
      const items = Array.isArray(d.billingItems) ? d.billingItems : [];
      if (items.length === 0) continue;

      const negBase = items.filter((it) => num(it.itemBaseAmount) < 0);
      const negGst = items.filter((it) => num(it.itemGstAmount) < 0);

      if (negBase.length === 0 && negGst.length === 0) continue;

      if (negBase.length > 0) withNegBase++;
      if (negGst.length > 0) withNegGst++;

      const isZeroFinal = Math.abs(num(d.finalAmount)) < 1;
      if (isZeroFinal) withZeroFinal++;

      // Subtract-to-zero signature: items have a positive line whose
      // base + gst exactly equals abs(negative line's base + gst).
      const lineNet = items.map((it) => num(it.itemBaseAmount) + num(it.itemGstAmount));
      const posLines = lineNet.filter((n) => n > 0);
      const negLines = lineNet.filter((n) => n < 0);
      const posSum = posLines.reduce((a, b) => a + b, 0);
      const negSum = negLines.reduce((a, b) => a + b, 0);
      const isSubtractToZero =
        posLines.length > 0 &&
        negLines.length > 0 &&
        Math.abs(posSum + negSum) < 1; // sum near zero
      if (isSubtractToZero) withSubtractToZero++;

      const branchId = d.locationId == null ? 'unknown' : String(d.locationId);
      byBranch.set(branchId, (byBranch.get(branchId) || 0) + 1);
      const mk = month(d.transactionDate || d.visitDate || d.createdAt);
      byMonth.set(mk, (byMonth.get(mk) || 0) + 1);

      if (samples.length < 20) {
        samples.push({
          id: doc.id,
          branch: branchId,
          date: d.transactionDate || d.visitDate || '—',
          paymentStatus: d.paymentStatus || '—',
          cancelled: d.cancelled === true,
          refundStatus: d.refundStatus || '—',
          totalAmount: d.totalAmount || 0,
          finalAmount: d.finalAmount || 0,
          posSum: Math.round(posSum),
          negSum: Math.round(negSum),
          subtractToZero: isSubtractToZero,
        });
      }
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
    process.stderr.write(`  scanned ${total}…\r`);
  }

  console.log('\n═════════════════════════════════════════════════════════════');
  console.log('  Negative billingItems[] sweep — A Square bookings');
  console.log('═════════════════════════════════════════════════════════════\n');
  console.log(`Total bookings scanned                : ${total}`);
  console.log(`Bookings with NEG itemBaseAmount      : ${withNegBase}`);
  console.log(`Bookings with NEG itemGstAmount       : ${withNegGst}`);
  console.log(`  …of which finalAmount === 0         : ${withZeroFinal}`);
  console.log(`  …matching subtract-to-zero pattern  : ${withSubtractToZero}`);

  console.log('\nBy branch (any negative line):');
  for (const [b, n] of [...byBranch.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  branch ${b.padEnd(8)} ${n}`);
  }

  console.log('\nBy month (any negative line):');
  for (const [m, n] of [...byMonth.entries()].sort()) {
    console.log(`  ${m}  ${n}`);
  }

  console.log('\nFirst 20 sample bookings:');
  for (const s of samples) {
    console.log(
      `  ${s.id}  branch=${s.branch}  date=${String(s.date).slice(0, 10)}  ` +
        `pay=${s.paymentStatus}  cancelled=${s.cancelled}  refund=${s.refundStatus}  ` +
        `total=${s.totalAmount}  final=${s.finalAmount}  ` +
        `pos=${s.posSum} neg=${s.negSum} zeroHack=${s.subtractToZero}`,
    );
  }

  process.exit(0);
})().catch((err) => {
  console.error('Sweep failed:', err);
  process.exit(1);
});
