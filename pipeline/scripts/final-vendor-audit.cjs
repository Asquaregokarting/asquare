/**
 * Final comprehensive audit: scan EVERY booking across ALL time for ANY
 * vendor game that is missing vendorId, gameId, or has broken data.
 * Covers ALL vendors, ALL sources, ALL dates.
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
  // Load vendor details
  const vendorSnap = await db.collection('vendorDetails').get();
  const vendorMap = new Map();
  vendorSnap.forEach(d => {
    const data = d.data();
    vendorMap.set(d.id, {
      name: data.vendorName || data.companyName || d.id,
      branchId: data.branchId || '',
      revenueShare: data.revenueShare ?? 80,
    });
  });

  // Load full activity hierarchy to know which games belong to which vendor
  const locSnap = await db.collection('locations').get();
  // Build: activityId → { gameId, subGameId, variantId, vendorId, gameName }
  // Also: itemName (lowercase) → same
  const activityLookup = new Map();
  const gameVendorMap = new Map(); // gameId → vendorId (from metadata)
  locSnap.forEach(locDoc => {
    const loc = locDoc.data();
    const games = loc.games || [];
    for (const game of games) {
      const meta = game.metadata || {};
      const vid = meta.vendorId || meta.vendorUserId || game.vendorId || null;
      if (vid) gameVendorMap.set(game.id, vid);
      const subGames = game.subGames || [];
      for (const sg of subGames) {
        const variants = sg.variants || [];
        for (const v of variants) {
          const entry = {
            gameId: game.id,
            subGameId: sg.id,
            variantId: v.id,
            vendorId: vid,
            gameName: game.name,
            subGameName: sg.name,
            variantLabel: v.label || v.name,
          };
          // Key by composite activityId pattern
          activityLookup.set(`${game.id}-${sg.id}-${v.id}`, entry);
          // Also by variant label (lowercase)
          if (v.label) activityLookup.set(v.label.toLowerCase().trim(), entry);
          if (v.name) activityLookup.set(v.name.toLowerCase().trim(), entry);
          // Full display name
          const fullName = `${game.name} — ${sg.name} — ${v.label || v.name}`.toLowerCase().trim();
          activityLookup.set(fullName, entry);
        }
      }
    }
  });

  // Scan ALL bookings
  const bookingsSnap = await db.collection('bookings').get();

  // Track ALL issues per vendor
  const vendorIssues = new Map(); // vendorId → { vendorName, issues: [...] }
  // Track non-vendor unknowns too
  const companyUnknowns = [];

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
      const gameId = bi.gameId || null;
      const vendorId = bi.vendorId || null;

      // Determine if this item SHOULD belong to a vendor
      const origItem = items[idx] || {};
      const activity = origItem.activity || {};
      const activityId = String(activity.id || '');

      // Try multiple lookup strategies
      let expectedEntry = null;
      if (activityId) expectedEntry = activityLookup.get(activityId);
      if (!expectedEntry && itemName) expectedEntry = activityLookup.get(itemName.toLowerCase().trim());
      if (!expectedEntry && gameId) {
        // Check if this gameId belongs to a vendor
        const vid = gameVendorMap.get(gameId);
        if (vid) expectedEntry = { vendorId: vid, gameName: gameId };
      }

      const expectedVendorId = expectedEntry?.vendorId || null;

      // Case 1: Item has vendorId → it's tracked correctly (or check mismatch)
      if (vendorId) {
        if (expectedVendorId && vendorId !== expectedVendorId) {
          // Mismatch
          if (!vendorIssues.has(expectedVendorId)) {
            vendorIssues.set(expectedVendorId, { issues: [] });
          }
          vendorIssues.get(expectedVendorId).issues.push({
            type: 'mismatch',
            bookingId: docSnap.id, istDate, source: d.source || 'unknown',
            locationId: d.locationId || '', itemName,
            customerName: d.customerName || d.userDisplayName || '—',
            customerPhone: d.customerPhone || d.userPhone || '',
            actualVendorId: vendorId, expectedVendorId,
            revenue: safeNum(bi.itemBaseAmount) + safeNum(bi.itemGstAmount) || safeNum(bi.unitPrice) * safeNum(bi.quantity),
          });
        }
        return; // Has vendorId, tracked OK
      }

      // Case 2: No vendorId, but SHOULD have one
      if (expectedVendorId) {
        if (!vendorIssues.has(expectedVendorId)) {
          vendorIssues.set(expectedVendorId, { issues: [] });
        }
        const revenue = safeNum(bi.itemBaseAmount) + safeNum(bi.itemGstAmount) || safeNum(bi.unitPrice) * safeNum(bi.quantity);
        vendorIssues.get(expectedVendorId).issues.push({
          type: 'missing_vendor',
          bookingId: docSnap.id, istDate, source: d.source || 'unknown',
          locationId: d.locationId || '', itemName,
          customerName: d.customerName || d.userDisplayName || '—',
          customerPhone: d.customerPhone || d.userPhone || '',
          gameId, expectedVendorId,
          revenue: Math.round(revenue),
          hasGameId: !!gameId,
        });
        return;
      }

      // Case 3: No vendorId AND not a vendor game, but gameId is missing
      if (!gameId) {
        const revenue = safeNum(bi.itemBaseAmount) + safeNum(bi.itemGstAmount) || safeNum(bi.unitPrice) * safeNum(bi.quantity);
        if (revenue > 0) {
          companyUnknowns.push({
            bookingId: docSnap.id, istDate, source: d.source || 'unknown',
            locationId: d.locationId || '', itemName,
            revenue: Math.round(revenue),
          });
        }
      }
    });
  });

  // Output report
  const report = {
    totalBookings: bookingsSnap.size,
    totalVendors: vendorMap.size,
    affectedVendors: [],
    unaffectedVendors: [],
    companyGameUnknowns: companyUnknowns.length,
  };

  for (const [vid, vInfo] of vendorMap) {
    const issues = vendorIssues.get(vid)?.issues || [];
    if (issues.length > 0) {
      const totalLostRevenue = issues
        .filter(i => i.type === 'missing_vendor')
        .reduce((s, i) => s + i.revenue, 0);
      report.affectedVendors.push({
        vendorId: vid,
        vendorName: vInfo.name,
        branchId: vInfo.branchId,
        issueCount: issues.length,
        missingVendorItems: issues.filter(i => i.type === 'missing_vendor').length,
        mismatchedItems: issues.filter(i => i.type === 'mismatch').length,
        totalLostRevenue,
        issues,
      });
    } else {
      report.unaffectedVendors.push({
        vendorId: vid,
        vendorName: vInfo.name,
        branchId: vInfo.branchId,
      });
    }
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
})();
