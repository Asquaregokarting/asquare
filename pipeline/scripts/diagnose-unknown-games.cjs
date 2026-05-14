/**
 * Diagnose "unknown" game names in the Game Revenue report.
 * Finds bookings where items are missing gameId/subGameId, causing
 * them to appear under "unknown" instead of their actual game.
 *
 * Usage:
 *   node scripts/diagnose-unknown-games.cjs
 *   node scripts/diagnose-unknown-games.cjs --date 2026-03-30
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const dateIdx = args.indexOf('--date');
const TARGET_DATE = dateIdx >= 0 ? args[dateIdx + 1] : null;

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(fs.readFileSync(path.resolve('serviceAccountKey.json'), 'utf-8')),
  ),
});
const db = admin.firestore();
db.settings({ databaseId: 'asquare-app-db' });

function toDateStr(raw) {
  if (!raw) return '';
  if (raw.toDate) { try { return raw.toDate().toISOString().slice(0, 10); } catch { return ''; } }
  const s = String(raw);
  if (s.includes('T')) return s.slice(0, 10);
  return s.slice(0, 10);
}

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  DIAGNOSE: "unknown" Game Names in Revenue Report');
  console.log('══════════════════════════════════════════════════════════════');
  if (TARGET_DATE) console.log(`  Filtering to date: ${TARGET_DATE}`);
  console.log();

  // 1. Load activities hierarchy to understand game→subGame→variant mapping
  const activitiesSnap = await db.collection('activities').get();
  const activityMap = new Map(); // id → { name, vendorId, ... }
  activitiesSnap.forEach((d) => {
    const data = d.data();
    activityMap.set(d.id, { name: data.name, vendorId: data.vendorId, ...data });
  });
  console.log(`  Activities loaded: ${activityMap.size}`);

  // Load locations → games hierarchy
  const locationsSnap = await db.collection('locations').get();
  const gamesByName = new Map(); // lowercase name → { gameId, locationId, vendorId }
  locationsSnap.forEach((locDoc) => {
    const locData = locDoc.data();
    const games = locData.games || [];
    games.forEach((g) => {
      if (g.name) gamesByName.set(g.name.toLowerCase().trim(), {
        gameId: g.id, locationId: locDoc.id, vendorId: g.vendorId || g.metadata?.vendorId,
        gameName: g.name,
      });
      const subGames = g.subGames || [];
      subGames.forEach((sg) => {
        if (sg.name) gamesByName.set(sg.name.toLowerCase().trim(), {
          gameId: g.id, subGameId: sg.id, locationId: locDoc.id,
          vendorId: g.vendorId || g.metadata?.vendorId,
          gameName: g.name, subGameName: sg.name,
        });
      });
    });
  });
  console.log(`  Game names indexed: ${gamesByName.size}`);

  // 2. Scan bookings
  const bookingsSnap = await db.collection('bookings').get();
  console.log(`  Total bookings: ${bookingsSnap.size}\n`);

  const unknownItems = [];
  const knownItemsSameGame = []; // items that DO have gameId for the same game name

  bookingsSnap.forEach((docSnap) => {
    const d = docSnap.data();
    const txnDate = toDateStr(d.transactionDate) || toDateStr(d.createdAt);
    if (TARGET_DATE && txnDate !== TARGET_DATE) return;

    const paymentStatus = d.paymentStatus || 'unknown';
    if (paymentStatus !== 'completed') return;
    if (d.cancelled === true) return;
    if (d.refundStatus === 'Full') return;

    const billingItems = Array.isArray(d.billingItems) ? d.billingItems : [];
    const items = Array.isArray(d.items) ? d.items : [];
    const effectiveItems = billingItems.length > 0 ? billingItems : items;

    effectiveItems.forEach((bi, idx) => {
      const itemName = (bi.itemName || '').trim();
      const gameId = bi.gameId || null;
      const subGameId = bi.subGameId || null;
      const variantId = bi.variantId || null;
      const vendorId = bi.vendorId || null;
      const vendorTotal = bi.vendorTotal || 0;

      // Also check the original items array for activity metadata
      const origItem = items[idx] || {};
      const activity = origItem.activity || {};

      const record = {
        bookingId: docSnap.id,
        txnDate,
        source: d.source || 'unknown',
        customerName: d.customerName || d.userDisplayName || '—',
        customerPhone: d.customerPhone || d.userPhone || '—',
        locationId: d.locationId || '—',
        totalAmount: d.finalAmount || d.totalAmount || 0,
        itemIdx: idx,
        itemName,
        gameId,
        subGameId,
        variantId,
        vendorId,
        vendorTotal,
        itemBaseAmount: bi.itemBaseAmount || 0,
        itemGstAmount: bi.itemGstAmount || 0,
        quantity: bi.quantity || 1,
        unitPrice: bi.unitPrice || 0,
        activityId: activity.id || null,
        activityName: activity.name || null,
        hasBillingItems: billingItems.length > 0,
        // Try to resolve what the gameId SHOULD be
        resolvedGame: gamesByName.get(itemName.toLowerCase()) || null,
      };

      if (!gameId || gameId === 'unknown') {
        unknownItems.push(record);
      } else if (itemName.toLowerCase().includes('smart bounce') ||
                 itemName.toLowerCase().includes('trampoline')) {
        knownItemsSameGame.push(record);
      }
    });
  });

  // 3. Report
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  ITEMS WITH MISSING gameId ("unknown"): ${unknownItems.length}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // Group by game name
  const byName = new Map();
  for (const item of unknownItems) {
    const key = item.itemName.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(item);
  }

  for (const [name, items] of Array.from(byName.entries()).sort((a, b) => b[1].length - a[1].length)) {
    const resolved = items[0].resolvedGame;
    const totalRevenue = items.reduce((s, i) => s + i.itemBaseAmount + i.itemGstAmount, 0);
    const vendorIds = [...new Set(items.map(i => i.vendorId).filter(Boolean))];

    console.log(`  "${items[0].itemName}" — ${items.length} items, ~INR ${Math.round(totalRevenue).toLocaleString('en-IN')}`);
    console.log(`    Sources: ${[...new Set(items.map(i => i.source))].join(', ')}`);
    console.log(`    vendorId on items: ${vendorIds.length > 0 ? vendorIds.join(', ') : 'NONE'}`);
    if (resolved) {
      console.log(`    SHOULD BE: gameId=${resolved.gameId}, subGameId=${resolved.subGameId || '—'}`);
      console.log(`      game: "${resolved.gameName}", vendor: ${resolved.vendorId || 'company-owned'}`);
    } else {
      console.log(`    Could NOT resolve from locations hierarchy`);
    }
    console.log();

    // Show individual bookings
    for (const item of items) {
      console.log(`    ${item.bookingId} | ${item.txnDate} | ${item.source} | ${item.customerName}`);
      console.log(`      gameId: ${item.gameId || 'NULL'} | subGameId: ${item.subGameId || 'NULL'} | variantId: ${item.variantId || 'NULL'}`);
      console.log(`      vendorId: ${item.vendorId || 'NULL'} | vendorTotal: INR ${item.vendorTotal}`);
      console.log(`      activityId: ${item.activityId || 'NULL'} | activityName: ${item.activityName || 'NULL'}`);
      console.log(`      hasBillingItems: ${item.hasBillingItems} | qty: ${item.quantity} | unit: INR ${item.unitPrice}`);
      console.log(`      revenue: INR ${Math.round(item.itemBaseAmount + item.itemGstAmount)}`);
      console.log();
    }
  }

  // Show matching known items (with gameId) for comparison
  if (knownItemsSameGame.length > 0) {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('  COMPARISON: Same game items that DO have gameId');
    console.log('══════════════════════════════════════════════════════════════\n');
    for (const item of knownItemsSameGame.slice(0, 10)) {
      console.log(`  ${item.bookingId} | ${item.txnDate} | ${item.source} | "${item.itemName}"`);
      console.log(`    gameId: ${item.gameId} | subGameId: ${item.subGameId} | vendorId: ${item.vendorId}`);
      console.log(`    activityId: ${item.activityId || 'NULL'} | hasBillingItems: ${item.hasBillingItems}`);
      console.log();
    }
  }

  // Summary: which sources produce unknown gameIds?
  const sourceBreakdown = new Map();
  for (const item of unknownItems) {
    const s = item.source;
    if (!sourceBreakdown.has(s)) sourceBreakdown.set(s, { count: 0, withVendor: 0, withoutVendor: 0 });
    const sb = sourceBreakdown.get(s);
    sb.count++;
    if (item.vendorId) sb.withVendor++; else sb.withoutVendor++;
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  SOURCE BREAKDOWN for "unknown" gameId items');
  console.log('══════════════════════════════════════════════════════════════');
  for (const [source, stats] of sourceBreakdown) {
    console.log(`  ${source}: ${stats.count} items (${stats.withVendor} with vendorId, ${stats.withoutVendor} without)`);
  }
  console.log();

  // Actionable summary
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  ROOT CAUSE ANALYSIS');
  console.log('══════════════════════════════════════════════════════════════');
  console.log();
  const appBookings = unknownItems.filter(i => i.source === 'APP_BOOKING');
  const posBookings = unknownItems.filter(i => i.source === 'POS');
  const adminBookings = unknownItems.filter(i => i.source === 'ADMIN_BOOKING');

  if (appBookings.length > 0) {
    console.log(`  APP_BOOKING items without gameId: ${appBookings.length}`);
    console.log('    → Customer App does not pass gameId/subGameId when creating bookings.');
    console.log('    → The catalog lookup in createUnifiedBooking failed to resolve them.');
    console.log('    → These items show as "unknown" and if they are vendor games,');
    console.log('      they are INVISIBLE to the ThirdParty vendor.\n');
  }
  if (posBookings.length > 0) {
    console.log(`  POS items without gameId: ${posBookings.length}`);
    console.log('    → POS billing should always set gameId from the activities hierarchy.');
    console.log('    → These are likely from old POS code before gameId was added.\n');
  }
  if (adminBookings.length > 0) {
    console.log(`  ADMIN_BOOKING items without gameId: ${adminBookings.length}`);
    console.log('    → Admin bookings should set gameId from the billing form.\n');
  }

  const vendorUnknowns = unknownItems.filter(i => i.vendorId);
  const noVendorUnknowns = unknownItems.filter(i => !i.vendorId && i.resolvedGame?.vendorId);

  if (vendorUnknowns.length > 0) {
    console.log(`  Items with vendorId but no gameId: ${vendorUnknowns.length}`);
    console.log('    → Vendor IS attributed but game shows as "unknown" in reports.');
    console.log('    → Revenue IS counted for the vendor but displayed incorrectly.\n');
  }
  if (noVendorUnknowns.length > 0) {
    console.log(`  Items without vendorId that SHOULD have one: ${noVendorUnknowns.length}`);
    console.log('    → These are vendor games INVISIBLE to ThirdParty vendors.');
    console.log('    → CRITICAL: Revenue is lost from vendor reports.\n');
  }

  console.log('Done.');
  process.exit(0);
})();
