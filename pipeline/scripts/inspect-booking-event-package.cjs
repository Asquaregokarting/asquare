/**
 * Dump a booking's event-package vendor attribution.
 *
 * Existing `inspect-booking.cjs` doesn't show `__eventPackage.items[]`,
 * which is where vendor IDs live for event-package bookings (Summer Vibes,
 * Halloween, etc). This script prints:
 *   - The booking's top-level `vendorId` and `vendorIds`
 *   - The flat `items[]` vendor IDs
 *   - The `billingItems[]` vendor IDs
 *   - The `__eventPackage.items[]` if present (the canonical vendor
 *     attribution for event packages)
 *
 * Usage:
 *   node scripts/inspect-booking-event-package.cjs <bookingId>
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const bookingId = process.argv[2];
if (!bookingId) {
  console.error('Usage: node scripts/inspect-booking-event-package.cjs <bookingId>');
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

const collectVendors = (arr) => {
  if (!Array.isArray(arr)) return [];
  const ids = new Set();
  for (const item of arr) {
    if (!item) continue;
    const vid = item.vendorId;
    if (typeof vid === 'string' && vid.trim()) ids.add(vid.trim());
  }
  return [...ids];
};

(async () => {
  const snap = await db.collection('bookings').doc(bookingId).get();
  if (!snap.exists) {
    console.error(`Booking ${bookingId} not found.`);
    process.exit(1);
  }
  const data = snap.data() || {};

  console.log(`\n══ ${bookingId} ══════════════════════════════════════════════\n`);
  console.log(`source                : ${data.source ?? '(none)'}`);
  console.log(`paymentStatus         : ${data.paymentStatus ?? '(none)'}`);
  console.log(`locationId            : ${data.locationId ?? '(none)'}`);
  console.log(`top-level vendorId    : ${data.vendorId ?? '(none)'}`);
  console.log(`top-level vendorIds[] : ${JSON.stringify(data.vendorIds ?? null)}`);

  const itemsVendors = collectVendors(data.items);
  const billingVendors = collectVendors(data.billingItems);
  console.log(`\nitems[] vendor IDs        : ${JSON.stringify(itemsVendors)} (count=${itemsVendors.length})`);
  console.log(`billingItems[] vendor IDs : ${JSON.stringify(billingVendors)} (count=${billingVendors.length})`);

  // Walk all top-level keys to find anything event-package-shaped
  const eventPackageKeys = Object.keys(data).filter(
    (k) => k === '__eventPackage' || k.toLowerCase().includes('eventpackage') || k.toLowerCase().includes('event_package'),
  );

  if (eventPackageKeys.length === 0) {
    console.log(`\n__eventPackage*       : (no event-package field on this booking)`);
  } else {
    for (const key of eventPackageKeys) {
      console.log(`\n── ${key} ──`);
      const ep = data[key];
      console.log(JSON.stringify(ep, null, 2));
      if (ep && Array.isArray(ep.items)) {
        const epVendors = collectVendors(ep.items);
        console.log(`\n${key}.items[] vendor IDs : ${JSON.stringify(epVendors)} (count=${epVendors.length})`);
      }
    }
  }

  // Print every other top-level key so we don't miss a vendor-ish hint
  const otherKeys = Object.keys(data).filter(
    (k) =>
      !['items', 'billingItems', 'vendorId', 'vendorIds', 'source', 'paymentStatus', 'locationId', '__eventPackage'].includes(k) &&
      !k.toLowerCase().includes('eventpackage'),
  );
  console.log(`\n── other top-level keys (names only) ──`);
  console.log(otherKeys.sort().join(', '));

  // Also dump every key whose name contains "vendor" anywhere on the doc
  const vendorishKeys = Object.keys(data).filter((k) => k.toLowerCase().includes('vendor'));
  if (vendorishKeys.length > 0) {
    console.log(`\n── all "vendor"-named keys on the booking ──`);
    for (const k of vendorishKeys) {
      const v = data[k];
      const display = typeof v === 'object' ? JSON.stringify(v) : String(v);
      console.log(`  ${k}: ${display.slice(0, 200)}${display.length > 200 ? '…' : ''}`);
    }
  }

  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
