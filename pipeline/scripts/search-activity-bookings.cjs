/**
 * Read-only Firestore search for any booking whose items reference a
 * specific activity name / variant / description. Case-insensitive.
 *
 * Scans the `bookings` collection (eligible + ineligible), looks at each
 * item's `itemName`, `activity.name`, `activity.description`, and
 * `activity.category`. Prints a short summary + a per-booking list.
 *
 * Usage:
 *   node scripts/search-activity-bookings.cjs "3VS3 50BULLETS EACH"
 *   node scripts/search-activity-bookings.cjs "3VS3"
 *   node scripts/search-activity-bookings.cjs "50 bullets each" "3vs3"
 *
 * Provide 1+ search terms. A booking matches if ANY of its items match
 * ANY of the provided terms (substring, case-insensitive).
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const terms = process.argv.slice(2).map((t) => t.toLowerCase()).filter(Boolean);
if (terms.length === 0) {
  console.error('Usage: node scripts/search-activity-bookings.cjs "<search term>" [more terms...]');
  process.exit(1);
}

const DATABASE_ID = 'asquare-app-db';

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

const includesAny = (haystack, needles) => {
  const s = String(haystack ?? '').toLowerCase();
  return s ? needles.some((n) => s.includes(n)) : false;
};

const INR = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  SEARCH: bookings referencing activity');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Terms: ${terms.map((t) => `"${t}"`).join(', ')}\n`);

  const snap = await db.collection('bookings').get();
  console.log(`  Bookings scanned : ${snap.size}`);

  const hits = [];
  for (const docSnap of snap.docs) {
    const d = docSnap.data();
    const arrays = [
      ['items', Array.isArray(d.items) ? d.items : []],
      ['billingItems', Array.isArray(d.billingItems) ? d.billingItems : []],
    ];

    const matchedItems = [];
    for (const [arrName, arr] of arrays) {
      arr.forEach((it, idx) => {
        if (!it || typeof it !== 'object') return;
        const a = it.activity || {};
        const candidates = [
          it.itemName,
          a.name,
          a.description,
          a.category,
          a.id,
        ];
        if (candidates.some((c) => includesAny(c, terms))) {
          matchedItems.push({
            source: arrName,
            idx,
            itemName: it.itemName || '',
            activityName: a.name || '',
            activityId: a.id || '',
            quantity: it.quantity,
            price: it.price ?? it.unitPrice,
          });
        }
      });
    }

    if (matchedItems.length === 0) continue;
    hits.push({
      id: docSnap.id,
      transactionDate: String(d.transactionDate ?? d.createdAt ?? '').slice(0, 19),
      paymentStatus: d.paymentStatus,
      cancelled: d.cancelled === true,
      refundStatus: d.refundStatus,
      locationId: d.locationId,
      totalAmount: d.finalAmount ?? d.totalAmount ?? 0,
      customerName: d.customerName || d.userDisplayName || '',
      customerPhone: d.customerPhone || d.userPhone || '',
      matchedItems,
    });
  }

  console.log(`  Matching bookings: ${hits.length}\n`);

  if (hits.length === 0) {
    console.log('  No bookings reference that activity.\n');
    process.exit(0);
  }

  // Summary
  const completed = hits.filter(
    (h) => h.paymentStatus === 'completed' && !h.cancelled && h.refundStatus !== 'Full',
  );
  const revenue = completed.reduce((s, h) => s + Number(h.totalAmount || 0), 0);
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  Completed (eligible revenue) : ${completed.length}   ${INR(revenue)}`);
  console.log(`  Cancelled / refunded         : ${hits.filter((h) => h.cancelled || h.refundStatus === 'Full').length}`);
  console.log(`  Pending / failed             : ${hits.filter((h) => h.paymentStatus !== 'completed' && !h.cancelled).length}`);
  console.log('──────────────────────────────────────────────────────────────\n');

  hits.sort((a, b) => String(b.transactionDate).localeCompare(String(a.transactionDate)));

  for (const h of hits) {
    const status = h.cancelled
      ? 'CANCELLED'
      : h.refundStatus === 'Full'
        ? 'REFUNDED'
        : (h.paymentStatus || 'unknown').toUpperCase();
    console.log(
      `  ${h.transactionDate}  ${h.id}  [${status}]  ${INR(h.totalAmount)}  ${h.locationId || '—'}  ${h.customerName}  ${h.customerPhone}`,
    );
    for (const m of h.matchedItems) {
      const label = m.itemName || m.activityName || m.activityId || '(no label)';
      console.log(`      - ${m.source}[${m.idx}] x${m.quantity ?? 1}  ${label}`);
    }
  }

  console.log('\nDone.\n');
  process.exit(0);
})().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
