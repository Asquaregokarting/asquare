/**
 * Find every booking item named "SMART BOUNCE" or "Gokarting Adult"
 * and show how the aggregator would bucket them. Identifies why some
 * land in "unknown" while others land in "TRAMPOLINE PARK".
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

function toIstDateStr(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const g = (type) => parts.find(p => p.type === type)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function rawToDate(raw) {
  if (!raw) return null;
  if (raw.toDate) try { return raw.toDate(); } catch { return null; }
  const d = new Date(String(raw));
  return isNaN(d.getTime()) ? null : d;
}

function safeNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  TRACE: "SMART BOUNCE" & "Gokarting Adult" item analysis');
  console.log('══════════════════════════════════════════════════════════════\n');

  const vendorSnap = await db.collection('vendorDetails').get();
  const vendorNames = new Map();
  vendorSnap.forEach(d => vendorNames.set(d.id, d.data().vendorName || d.data().companyName || d.id));

  const bookingsSnap = await db.collection('bookings').get();
  console.log(`  Total bookings: ${bookingsSnap.size}\n`);

  const matches = [];

  bookingsSnap.forEach(docSnap => {
    const d = docSnap.data();
    if (d.paymentStatus !== 'completed') return;
    if (d.cancelled === true) return;
    if (d.refundStatus === 'Full') return;

    const rawDate = d.transactionDate || d.createdAt;
    const dateObj = rawToDate(rawDate);
    const istDate = dateObj ? toIstDateStr(dateObj) : '';

    const billingItems = Array.isArray(d.billingItems) ? d.billingItems : [];
    const items = Array.isArray(d.items) ? d.items : [];
    const effectiveItems = billingItems.length > 0 ? billingItems : items;

    effectiveItems.forEach((bi, idx) => {
      const itemName = (bi.itemName || '').trim();
      const lower = itemName.toLowerCase();
      if (!lower.includes('smart bounce') && !lower.includes('gokarting adult') &&
          !lower.includes('gokarting — adult')) return;

      const origItem = items[idx] || {};
      const activity = origItem.activity || {};

      matches.push({
        bookingId: docSnap.id,
        istDate,
        source: d.source || 'unknown',
        customerName: d.customerName || d.userDisplayName || '—',
        customerPhone: d.customerPhone || d.userPhone || '—',
        locationId: d.locationId || '—',
        totalAmount: d.finalAmount || d.totalAmount || 0,
        itemIdx: idx,
        itemName,
        gameId: bi.gameId || null,
        subGameId: bi.subGameId || null,
        variantId: bi.variantId || null,
        vendorId: bi.vendorId || null,
        vendorName: bi.vendorId ? (vendorNames.get(bi.vendorId) || bi.vendorId) : null,
        itemBaseAmount: safeNum(bi.itemBaseAmount),
        itemGstAmount: safeNum(bi.itemGstAmount),
        unitPrice: safeNum(bi.unitPrice),
        quantity: safeNum(bi.quantity),
        hasBillingItems: billingItems.length > 0,
        activityId: activity.id || null,
        activityName: activity.name || null,
        // What the aggregator would bucket this as:
        aggregatorGameId: bi.gameId || 'unknown',
      });
    });
  });

  // Sort by date
  matches.sort((a, b) => a.istDate.localeCompare(b.istDate));

  // Split into "unknown" vs proper gameId
  const unknownItems = matches.filter(m => !m.gameId);
  const knownItems = matches.filter(m => m.gameId);

  console.log(`  Total matching items: ${matches.length}`);
  console.log(`  With gameId (proper): ${knownItems.length}`);
  console.log(`  WITHOUT gameId (→ "unknown"): ${unknownItems.length}\n`);

  // ── Unknown items detail ──────────────────────────────────────────────────
  if (unknownItems.length > 0) {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('  ITEMS THAT APPEAR AS "unknown" (no gameId)');
    console.log('══════════════════════════════════════════════════════════════\n');

    for (const item of unknownItems) {
      const revenue = item.itemBaseAmount + item.itemGstAmount || item.unitPrice * item.quantity;
      console.log(`  ${item.bookingId} | ${item.istDate} | ${item.source}`);
      console.log(`    customer: ${item.customerName} | phone: ${item.customerPhone}`);
      console.log(`    location: ${item.locationId}`);
      console.log(`    itemName: "${item.itemName}"`);
      console.log(`    gameId: NULL | subGameId: ${item.subGameId || 'NULL'} | variantId: ${item.variantId || 'NULL'}`);
      console.log(`    vendorId: ${item.vendorId || 'NULL'} (${item.vendorName || '—'})`);
      console.log(`    hasBillingItems: ${item.hasBillingItems}`);
      console.log(`    activityId: ${item.activityId || 'NULL'} | activityName: "${item.activityName || ''}"`);
      console.log(`    revenue: INR ${Math.round(revenue)}`);
      console.log();
    }

    // Group by date
    console.log('  ── By date ──');
    const byDate = new Map();
    for (const item of unknownItems) {
      if (!byDate.has(item.istDate)) byDate.set(item.istDate, []);
      byDate.get(item.istDate).push(item);
    }
    for (const [date, items] of Array.from(byDate.entries()).sort()) {
      const rev = items.reduce((s, i) => s + (i.itemBaseAmount + i.itemGstAmount || i.unitPrice * i.quantity), 0);
      console.log(`    ${date}: ${items.length} items, INR ${Math.round(rev).toLocaleString('en-IN')} [${[...new Set(items.map(i => i.source))].join(', ')}]`);
    }
    console.log();

    // Group by source
    console.log('  ── By source ──');
    const bySource = new Map();
    for (const item of unknownItems) {
      if (!bySource.has(item.source)) bySource.set(item.source, 0);
      bySource.set(item.source, bySource.get(item.source) + 1);
    }
    for (const [source, count] of bySource) {
      console.log(`    ${source}: ${count} items`);
    }
    console.log();
  }

  // ── Comparison: known items ───────────────────────────────────────────────
  if (knownItems.length > 0) {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('  SAME ITEMS WITH gameId (showing correctly)');
    console.log('══════════════════════════════════════════════════════════════\n');

    // Just show summary + a few examples
    const byGameId = new Map();
    for (const item of knownItems) {
      if (!byGameId.has(item.gameId)) byGameId.set(item.gameId, []);
      byGameId.get(item.gameId).push(item);
    }
    for (const [gameId, items] of byGameId) {
      console.log(`  gameId "${gameId}": ${items.length} items, sources: ${[...new Set(items.map(i => i.source))].join(', ')}`);
      // Show first 3
      for (const item of items.slice(0, 3)) {
        console.log(`    ${item.bookingId} | ${item.istDate} | "${item.itemName}" | vendorId: ${item.vendorId || 'NULL'}`);
      }
      if (items.length > 3) console.log(`    ... and ${items.length - 3} more`);
      console.log();
    }
  }

  console.log('Done.');
  process.exit(0);
})();
