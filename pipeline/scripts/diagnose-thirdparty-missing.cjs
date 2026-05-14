/**
 * Diagnostic script: find bookings from March 28 – April 1, 2026 where
 * vendor games are missing vendorId on items — causing them to be invisible
 * in the ThirdParty Game Revenue view.
 *
 * Usage:
 *   node scripts/diagnose-thirdparty-missing.cjs
 *
 * Requires serviceAccountKey.json in project root.
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

// Date range to scan (IST dates as ISO prefixes for comparison)
const FROM_DATE = '2026-03-28';
const TO_DATE = '2026-04-01';

/** Extract YYYY-MM-DD from an ISO string or Firestore Timestamp. */
function toDateStr(raw) {
  if (!raw) return '';
  if (raw.toDate) return raw.toDate().toISOString().slice(0, 10);
  const s = String(raw);
  if (s.includes('T')) return s.slice(0, 10);
  return s.slice(0, 10);
}

(async () => {
  console.log(`\n━━━ ThirdParty Missing Data Diagnostic ━━━`);
  console.log(`Scanning bookings from ${FROM_DATE} to ${TO_DATE}\n`);

  // 1. Load all vendor details to know which vendorIds exist
  const vendorSnap = await db.collection('vendorDetails').get();
  const vendorIds = new Set();
  const vendorNames = new Map();
  vendorSnap.forEach((d) => {
    vendorIds.add(d.id);
    vendorNames.set(d.id, d.data().vendorName || d.data().companyName || d.id);
  });
  console.log(`Found ${vendorIds.size} registered vendors\n`);

  // 2. Load activity catalog to check lookup coverage
  const catalogSnap = await db.collection('activityCatalog').get();
  const catalogById = new Map();
  const catalogByName = new Map();
  let catalogWithVendor = 0;
  catalogSnap.forEach((d) => {
    const data = d.data();
    catalogById.set(d.id, data);
    if (data.name) catalogByName.set(data.name.toLowerCase(), data);
    if (data.bookingName) catalogByName.set(data.bookingName.toLowerCase(), data);
    if (data.vendorId) catalogWithVendor++;
  });
  console.log(`Activity catalog: ${catalogSnap.size} entries, ${catalogWithVendor} with vendorId\n`);

  // 3. Scan bookings in the date range
  const bookingsSnap = await db.collection('bookings').get();
  let total = 0;
  let inRange = 0;
  let missingVendorId = 0;
  let itemsWithoutVendorId = 0;
  let itemsWithVendorId = 0;
  const problems = [];

  bookingsSnap.forEach((docSnap) => {
    total++;
    const d = docSnap.data();
    const txnDate = toDateStr(d.transactionDate) || toDateStr(d.createdAt);
    if (txnDate < FROM_DATE || txnDate > TO_DATE) return;
    inRange++;

    // Check billingItems (primary source for mapTransactionRecord)
    const billingItems = d.billingItems || [];
    const items = d.items || [];
    const source = d.source || 'unknown';
    const paymentStatus = d.paymentStatus || 'unknown';

    // Check each billing item for vendor data
    const problemItems = [];
    billingItems.forEach((bi, idx) => {
      if (bi.vendorId) {
        itemsWithVendorId++;
      } else {
        // Check if this SHOULD have a vendorId by looking up catalog
        const activityId = items[idx]?.activity?.id || '';
        const itemName = (bi.itemName || '').toLowerCase();
        const catalogEntry = catalogById.get(activityId) || catalogByName.get(itemName);
        if (catalogEntry && catalogEntry.vendorId) {
          // Catalog says this game has a vendor, but billingItem is missing vendorId
          itemsWithoutVendorId++;
          problemItems.push({
            idx,
            itemName: bi.itemName,
            expectedVendor: vendorNames.get(catalogEntry.vendorId) || catalogEntry.vendorId,
            catalogVendorId: catalogEntry.vendorId,
            catalogKey: activityId || itemName,
          });
        }
      }
    });

    // Also check: billingItems missing entirely (fallback to items without vendorId)
    if (billingItems.length === 0 && items.length > 0) {
      items.forEach((item, idx) => {
        const activity = item.activity || {};
        const activityId = activity.id || '';
        const itemName = (item.itemName || activity.name || '').toLowerCase();
        const catalogEntry = catalogById.get(activityId) || catalogByName.get(itemName);
        if (catalogEntry && catalogEntry.vendorId && !item.vendorId) {
          itemsWithoutVendorId++;
          problemItems.push({
            idx,
            itemName: item.itemName || activity.name,
            expectedVendor: vendorNames.get(catalogEntry.vendorId) || catalogEntry.vendorId,
            catalogVendorId: catalogEntry.vendorId,
            catalogKey: activityId || itemName,
            noBillingItems: true,
          });
        }
      });
    }

    if (problemItems.length > 0) {
      missingVendorId++;
      problems.push({
        bookingId: docSnap.id,
        txnDate,
        source,
        paymentStatus,
        customerName: d.customerName || d.userDisplayName || '—',
        totalAmount: d.finalAmount || d.totalAmount || 0,
        hasBillingItems: billingItems.length > 0,
        problemItems,
      });
    }
  });

  // 4. Report
  console.log(`━━━ SUMMARY ━━━`);
  console.log(`Total bookings scanned: ${total}`);
  console.log(`Bookings in date range (${FROM_DATE} – ${TO_DATE}): ${inRange}`);
  console.log(`Items with vendorId:    ${itemsWithVendorId}`);
  console.log(`Items MISSING vendorId: ${itemsWithoutVendorId}`);
  console.log(`Bookings affected:      ${missingVendorId}`);
  console.log();

  if (problems.length === 0) {
    console.log('✓ No vendor-attribution issues found in this date range.');
    console.log('\nIf data is still missing, check:');
    console.log('  1. paymentStatus — only "completed" bookings appear in Game Revenue');
    console.log('  2. Activity catalog — games might not have vendorId entries');
    console.log('  3. The vendor user ID may not match the vendorId on catalog entries');
  } else {
    console.log(`━━━ AFFECTED BOOKINGS (${problems.length}) ━━━\n`);
    for (const p of problems) {
      console.log(`  ${p.bookingId}`);
      console.log(`    date: ${p.txnDate} | source: ${p.source} | status: ${p.paymentStatus}`);
      console.log(`    customer: ${p.customerName} | amount: INR ${p.totalAmount}`);
      console.log(`    hasBillingItems: ${p.hasBillingItems}`);
      for (const item of p.problemItems) {
        console.log(`    ❌ item[${item.idx}] "${item.itemName}"`);
        console.log(`       expected vendor: ${item.expectedVendor} (${item.catalogVendorId})`);
        console.log(`       catalog match key: "${item.catalogKey}"`);
        if (item.noBillingItems) console.log(`       ⚠ no billingItems array — using fallback items`);
      }
      console.log();
    }

    console.log(`━━━ REMEDIATION ━━━`);
    console.log(`To fix these bookings, run a patch script that:`);
    console.log(`  1. Reads the activityCatalog to resolve vendorId for each item`);
    console.log(`  2. Updates billingItems[].vendorId on the affected booking documents`);
    console.log(`  3. Recomputes vendor splits (vendorBase, vendorGst, vendorTotal)`);
    console.log(`  4. Writes corresponding vendorLedger entries for the corrected amounts`);
  }

  console.log('\nDone.');
  process.exit(0);
})();
