/**
 * Read-only dump of a single booking's Firestore document.
 *
 * Use this when a booking doesn't show where you expect it — the output
 * tells you why: eligibility flags (paymentStatus, cancelled, refundStatus),
 * date ranges, locationId, and the full items + billingItems arrays so you
 * can see whether `gameId` / `subGameId` / `variantId` are populated.
 *
 * Usage:
 *   node scripts/inspect-booking.cjs ASG260424192645114EW2B
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const bookingId = process.argv[2];
if (!bookingId) {
  console.error('Usage: node scripts/inspect-booking.cjs <bookingId>');
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

(async () => {
  const snap = await db.collection('bookings').doc(bookingId).get();
  if (!snap.exists) {
    console.log(`\nNo booking found with id "${bookingId}".\n`);
    process.exit(0);
  }
  const d = snap.data();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  BOOKING: ${bookingId}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // Top-level eligibility summary for the Game Revenue report
  console.log('Eligibility (for Game Revenue report):');
  console.log(`  paymentStatus   : ${d.paymentStatus ?? '—'}`);
  console.log(`  cancelled       : ${d.cancelled === true}`);
  console.log(`  refundStatus    : ${d.refundStatus ?? '—'}`);
  console.log(`  source          : ${d.source ?? '—'}`);
  console.log(`  sourceType      : ${d.sourceType ?? '—'}`);
  console.log(`  transactionDate : ${d.transactionDate ?? '—'}`);
  console.log(`  visitDate       : ${d.visitDate ?? '—'}`);
  console.log(`  sessionDate     : ${d.sessionDate ?? '—'}`);
  console.log(`  locationId      : ${d.locationId ?? '—'}`);
  console.log(`  totalAmount     : ${d.totalAmount ?? '—'}`);
  console.log(`  finalAmount     : ${d.finalAmount ?? '—'}`);
  console.log();

  const eligible =
    d.paymentStatus === 'completed' && d.cancelled !== true && d.refundStatus !== 'Full';
  console.log(`  → Eligible for Game Revenue: ${eligible ? 'YES' : 'NO'}`);
  if (!eligible) {
    const reasons = [];
    if (d.paymentStatus !== 'completed') reasons.push(`paymentStatus="${d.paymentStatus}"`);
    if (d.cancelled === true) reasons.push('cancelled');
    if (d.refundStatus === 'Full') reasons.push('fully refunded');
    console.log(`    Reason(s): ${reasons.join(', ')}`);
  }
  console.log();

  // Items
  const items = Array.isArray(d.items) ? d.items : [];
  console.log(`items[] (${items.length}):`);
  items.forEach((it, i) => {
    const a = (it && it.activity) || {};
    console.log(`  [${i}]`);
    console.log(`    itemName       : ${it.itemName ?? '—'}`);
    console.log(`    gameId         : ${it.gameId ?? '—'}`);
    console.log(`    subGameId      : ${it.subGameId ?? '—'}`);
    console.log(`    variantId      : ${it.variantId ?? '—'}`);
    console.log(`    vendorId       : ${it.vendorId ?? '—'}`);
    console.log(`    quantity       : ${it.quantity ?? '—'}`);
    console.log(`    refunded       : ${it.refunded === true}`);
    console.log(`    activity.id    : ${a.id ?? '—'}`);
    console.log(`    activity.name  : ${a.name ?? '—'}`);
    console.log(`    activity.description : ${a.description ?? '—'}`);
    console.log(`    activity.gameTypeId : ${a.gameTypeId ?? '—'}`);
    console.log(`    activity.category   : ${a.category ?? '—'}`);
    console.log(`    activity.locationIds: ${JSON.stringify(a.locationIds ?? [])}`);
    if (a.__eventPackage) {
      console.log(`    activity.__eventPackage:`);
      console.log(`      campaignId   : ${a.__eventPackage.campaignId ?? '—'}`);
      console.log(`      packageId    : ${a.__eventPackage.packageId ?? '—'}`);
      console.log(`      locationKey  : ${a.__eventPackage.locationKey ?? '—'}`);
      const pkgItems = Array.isArray(a.__eventPackage.items) ? a.__eventPackage.items : [];
      console.log(`      items[] (${pkgItems.length}):`);
      pkgItems.forEach((pi, j) => {
        console.log(`        [${j}] ${pi.name ?? '—'} (qty ${pi.quantity ?? 1}, ₹${pi.price ?? 0}) type=${pi.type ?? '—'} vendor=${pi.vendorId ?? '—'} printIndividualTokens=${pi.printIndividualTokens === true}`);
      });
    }
    console.log();
  });

  // BillingItems
  const billingItems = Array.isArray(d.billingItems) ? d.billingItems : [];
  console.log(`billingItems[] (${billingItems.length}):`);
  billingItems.forEach((it, i) => {
    console.log(`  [${i}]`);
    console.log(`    itemName        : ${it.itemName ?? '—'}`);
    console.log(`    gameId          : ${it.gameId ?? '—'}`);
    console.log(`    subGameId       : ${it.subGameId ?? '—'}`);
    console.log(`    variantId       : ${it.variantId ?? '—'}`);
    console.log(`    vendorId        : ${it.vendorId ?? '—'}`);
    console.log(`    quantity        : ${it.quantity ?? '—'}`);
    console.log(`    unitPrice       : ${it.unitPrice ?? '—'}`);
    console.log(`    itemBaseAmount  : ${it.itemBaseAmount ?? '—'}`);
    console.log(`    itemGstAmount   : ${it.itemGstAmount ?? '—'}`);
    console.log(`    refunded        : ${it.refunded === true}`);
    console.log();
  });

  process.exit(0);
})().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
