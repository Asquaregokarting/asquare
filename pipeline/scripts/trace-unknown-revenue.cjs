/**
 * Trace exactly which bookings produce the "unknown" game bucket
 * in the Game Revenue report by simulating the aggregator logic.
 *
 * Usage:
 *   node scripts/trace-unknown-revenue.cjs --from 2026-03-28 --to 2026-04-01
 *   node scripts/trace-unknown-revenue.cjs --date 2026-03-30
 *   node scripts/trace-unknown-revenue.cjs --vendor 9985526034 --from 2026-03-28 --to 2026-04-01
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const toIdx = args.indexOf('--to');
const dateIdx = args.indexOf('--date');
const vendorIdx = args.indexOf('--vendor');
const FROM_DATE = dateIdx >= 0 ? args[dateIdx + 1] : (fromIdx >= 0 ? args[fromIdx + 1] : '2026-03-28');
const TO_DATE = dateIdx >= 0 ? args[dateIdx + 1] : (toIdx >= 0 ? args[toIdx + 1] : '2026-04-01');
const VENDOR_ID = vendorIdx >= 0 ? args[vendorIdx + 1] : null;

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

function safeNumber(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  TRACE: Which bookings produce "unknown" in Game Revenue');
  console.log(`  Date range: ${FROM_DATE} → ${TO_DATE}`);
  if (VENDOR_ID) console.log(`  Vendor filter: ${VENDOR_ID}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // Load catalog from activity-catalog-firestore (same as GameRevenueModule)
  // GameRevenueModule uses listBranchActivityCatalog which reads from locations
  const locSnap = await db.collection('locations').get();
  const catalogMap = new Map(); // `gameId::subGameId::variantId` → labels
  locSnap.forEach(locDoc => {
    const loc = locDoc.data();
    const games = loc.games || [];
    for (const game of games) {
      const subGames = game.subGames || [];
      for (const sg of subGames) {
        const variants = sg.variants || [];
        for (const v of variants) {
          const key = `${game.id}::${sg.id}::${v.id}`;
          catalogMap.set(key, {
            gameName: game.name,
            subGameName: sg.name,
            variantLabel: v.label || v.name,
          });
        }
      }
    }
  });
  console.log(`  Catalog entries from locations: ${catalogMap.size}`);

  // Load vendor details
  const vendorSnap = await db.collection('vendorDetails').get();
  const vendorNames = new Map();
  vendorSnap.forEach(d => vendorNames.set(d.id, d.data().vendorName || d.data().companyName || d.id));

  // Load bookings
  const bookingsSnap = await db.collection('bookings').get();
  console.log(`  Total bookings: ${bookingsSnap.size}\n`);

  // Simulate aggregator
  const gameBuckets = new Map(); // gameName → { items: [...], revenue, ... }
  let skipped = 0;
  let contributed = 0;

  bookingsSnap.forEach(docSnap => {
    const d = docSnap.data();

    // Eligibility (same as aggregator)
    if (d.paymentStatus !== 'completed') { skipped++; return; }
    if (d.cancelled === true) { skipped++; return; }
    if (d.refundStatus === 'Full') { skipped++; return; }

    // Date filter (IST-correct, same as aggregator)
    const rawDate = d.transactionDate || d.createdAt;
    const dateObj = rawToDate(rawDate);
    const istDate = dateObj ? toIstDateStr(dateObj) : '';
    if (!istDate || istDate < FROM_DATE || istDate > TO_DATE) { skipped++; return; }

    const billingItems = Array.isArray(d.billingItems) ? d.billingItems : [];
    const items = Array.isArray(d.items) ? d.items : [];
    const effectiveItems = billingItems.length > 0 ? billingItems : items;

    // Compute item revenues (same logic as aggregator)
    const hasItemLevelBreakdown = effectiveItems.some(i => i.itemBaseAmount != null || i.itemGstAmount != null);
    let itemRevenues;
    if (hasItemLevelBreakdown) {
      itemRevenues = effectiveItems.map(i => {
        if (i.refunded === true) return 0;
        return safeNumber(i.itemBaseAmount) + safeNumber(i.itemGstAmount);
      });
    } else {
      const finalAmount = safeNumber(d.finalAmount || d.totalAmount);
      const lineSubs = effectiveItems.map(i => safeNumber(i.unitPrice) * safeNumber(i.quantity));
      const subSum = lineSubs.reduce((a, b) => a + b, 0);
      if (finalAmount > 0 && subSum > 0) {
        itemRevenues = effectiveItems.map((i, idx) => {
          if (i.refunded === true) return 0;
          return (lineSubs[idx] / subSum) * finalAmount;
        });
      } else {
        itemRevenues = effectiveItems.map((i, idx) => i.refunded === true ? 0 : lineSubs[idx]);
      }
    }

    effectiveItems.forEach((item, idx) => {
      if (item.refunded === true) return;
      if (VENDOR_ID && item.vendorId !== VENDOR_ID) return;

      const revenue = itemRevenues[idx] ?? 0;
      if (revenue <= 0) return;

      const rawGameId = item.gameId || 'unknown';
      const rawSubGameId = item.subGameId || 'unknown';
      const rawVariantId = item.variantId || item.itemName || 'unknown';

      const lookup = catalogMap.get(`${rawGameId}::${rawSubGameId}::${rawVariantId}`);
      const gameName = lookup?.gameName?.trim() || rawGameId;
      const subGameName = lookup?.subGameName?.trim() || rawSubGameId;
      const variantName = lookup?.variantLabel?.trim() || item.itemName?.trim() || rawVariantId;

      if (!gameBuckets.has(gameName)) {
        gameBuckets.set(gameName, { revenue: 0, count: 0, items: [] });
      }
      const bucket = gameBuckets.get(gameName);
      bucket.revenue += revenue;
      bucket.count++;
      bucket.items.push({
        bookingId: docSnap.id,
        istDate,
        source: d.source || 'unknown',
        customerName: d.customerName || d.userDisplayName || '—',
        customerPhone: d.customerPhone || d.userPhone || '—',
        locationId: d.locationId || '—',
        itemName: item.itemName || '—',
        rawGameId,
        rawSubGameId,
        rawVariantId,
        resolvedGameName: gameName,
        resolvedSubGameName: subGameName,
        resolvedVariantName: variantName,
        gameId: item.gameId || null,
        subGameId: item.subGameId || null,
        variantId: item.variantId || null,
        vendorId: item.vendorId || null,
        vendorName: item.vendorId ? (vendorNames.get(item.vendorId) || item.vendorId) : null,
        revenue: Math.round(revenue),
        catalogKey: `${rawGameId}::${rawSubGameId}::${rawVariantId}`,
        catalogHit: !!lookup,
      });
      contributed++;
    });
  });

  // Sort buckets by revenue desc
  const sorted = Array.from(gameBuckets.entries()).sort((a, b) => b[1].revenue - a[1].revenue);

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  GAME BUCKETS (as they appear in the report)');
  console.log('══════════════════════════════════════════════════════════════\n');

  for (const [gameName, bucket] of sorted) {
    const isUnknown = gameName === 'unknown' || gameName.includes('unknown');
    const marker = isUnknown ? ' ⚠ UNKNOWN' : '';
    console.log(`  ${gameName}${marker} — ${bucket.count} items, INR ${Math.round(bucket.revenue).toLocaleString('en-IN')}`);

    // Group items by subGame for readability
    const bySubGame = new Map();
    for (const item of bucket.items) {
      const key = item.resolvedSubGameName;
      if (!bySubGame.has(key)) bySubGame.set(key, []);
      bySubGame.get(key).push(item);
    }

    for (const [sgName, sgItems] of bySubGame) {
      const sgRevenue = sgItems.reduce((s, i) => s + i.revenue, 0);
      console.log(`    └─ ${sgName} — ${sgItems.length} items, INR ${sgRevenue.toLocaleString('en-IN')}`);

      // Group by variant
      const byVariant = new Map();
      for (const item of sgItems) {
        const key = item.resolvedVariantName;
        if (!byVariant.has(key)) byVariant.set(key, []);
        byVariant.get(key).push(item);
      }

      for (const [vName, vItems] of byVariant) {
        const vRevenue = vItems.reduce((s, i) => s + i.revenue, 0);
        console.log(`       └─ ${vName} — ${vItems.length} items, INR ${vRevenue.toLocaleString('en-IN')}`);
      }
    }
    console.log();
  }

  // Detail unknown items
  const unknownBucket = gameBuckets.get('unknown');
  if (unknownBucket && unknownBucket.items.length > 0) {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('  DETAIL: Every item in the "unknown" game bucket');
    console.log('══════════════════════════════════════════════════════════════\n');

    for (const item of unknownBucket.items) {
      console.log(`  ${item.bookingId} | ${item.istDate} | ${item.source}`);
      console.log(`    customer: ${item.customerName} | phone: ${item.customerPhone} | loc: ${item.locationId}`);
      console.log(`    itemName: "${item.itemName}"`);
      console.log(`    gameId: ${item.gameId || 'NULL'} | subGameId: ${item.subGameId || 'NULL'} | variantId: ${item.variantId || 'NULL'}`);
      console.log(`    vendorId: ${item.vendorId || 'NULL'} (${item.vendorName || 'no vendor'})`);
      console.log(`    catalogKey: "${item.catalogKey}" → hit: ${item.catalogHit}`);
      console.log(`    revenue: INR ${item.revenue}`);
      console.log();
    }
  }

  // Also find items with same itemName in different buckets (the split problem)
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  SPLIT DETECTION: Same itemName appearing in multiple games');
  console.log('══════════════════════════════════════════════════════════════\n');

  const itemNameToBuckets = new Map();
  for (const [gameName, bucket] of gameBuckets) {
    for (const item of bucket.items) {
      const key = item.itemName.toLowerCase().trim();
      if (!itemNameToBuckets.has(key)) itemNameToBuckets.set(key, new Map());
      const gm = itemNameToBuckets.get(key);
      if (!gm.has(gameName)) gm.set(gameName, { count: 0, revenue: 0, items: [] });
      const g = gm.get(gameName);
      g.count++;
      g.revenue += item.revenue;
      g.items.push(item);
    }
  }

  let splitCount = 0;
  for (const [itemName, gameMap] of itemNameToBuckets) {
    if (gameMap.size <= 1) continue;
    splitCount++;
    console.log(`  "${itemName}" appears in ${gameMap.size} game buckets:`);
    for (const [gameName, stats] of gameMap) {
      console.log(`    → "${gameName}" — ${stats.count} items, INR ${Math.round(stats.revenue).toLocaleString('en-IN')}`);
      for (const item of stats.items.slice(0, 3)) {
        console.log(`      ${item.bookingId} | gameId: ${item.gameId || 'NULL'} | vendorId: ${item.vendorId || 'NULL'} | catalogKey: "${item.catalogKey}" hit=${item.catalogHit}`);
      }
      if (stats.items.length > 3) console.log(`      ... and ${stats.items.length - 3} more`);
    }
    console.log();
  }

  if (splitCount === 0) {
    console.log('  No splits found — each itemName maps to exactly one game bucket.\n');
  }

  console.log(`  Summary: ${contributed} items contributed, ${skipped} skipped.`);
  console.log('Done.');
  process.exit(0);
})();
