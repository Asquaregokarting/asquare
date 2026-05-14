/**
 * Deep scan: comprehensive audit of ALL bookings for ThirdParty vendor
 * data integrity issues across all time.
 *
 * Categories scanned:
 *   A. Missing vendorId — vendor game booked but vendorId not on items
 *   B. Mismatched vendorId — vendorId differs from catalog or vendorDetails
 *   C. Completed but invisible — paymentStatus=completed, has vendor items,
 *      but vendorId missing so ThirdParty can't see them
 *   D. No billingItems — document only has items[] (no billing breakdown),
 *      so vendorId, splits, and revenue are all lost
 *   E. Vendor splits missing — vendorId present but vendorBase/vendorTotal = 0
 *   F. Vendor ledger gaps — booking has vendor splits but no vendorLedger entry
 *   G. Catalog coverage — vendor games without activityCatalog entries
 *
 * Usage:
 *   node scripts/deep-scan-thirdparty.cjs
 *   node scripts/deep-scan-thirdparty.cjs --json          (machine-readable output)
 *   node scripts/deep-scan-thirdparty.cjs --from 2026-03-01 --to 2026-04-14
 *
 * Requires serviceAccountKey.json in project root.
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const fromIdx = args.indexOf('--from');
const toIdx = args.indexOf('--to');
const FROM_DATE = fromIdx >= 0 ? args[fromIdx + 1] : null; // null = all time
const TO_DATE = toIdx >= 0 ? args[toIdx + 1] : null;

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(fs.readFileSync(path.resolve('serviceAccountKey.json'), 'utf-8')),
  ),
});
const db = admin.firestore();
db.settings({ databaseId: 'asquare-app-db' });

// ── Helpers ─────────────────────────────────────────────────────────────────
function toDateStr(raw) {
  if (!raw) return '';
  if (raw.toDate) {
    try { return raw.toDate().toISOString().slice(0, 10); } catch { return ''; }
  }
  const s = String(raw);
  if (s.includes('T')) return s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

function toFullIso(raw) {
  if (!raw) return '';
  if (raw.toDate) {
    try { return raw.toDate().toISOString(); } catch { return ''; }
  }
  return String(raw);
}

const log = (...a) => { if (!jsonMode) console.log(...a); };

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  const startTime = Date.now();
  log('\n══════════════════════════════════════════════════════════════');
  log('  DEEP SCAN: ThirdParty Vendor Data Integrity Audit');
  log('══════════════════════════════════════════════════════════════');
  if (FROM_DATE || TO_DATE) {
    log(`  Date filter: ${FROM_DATE || 'beginning'} → ${TO_DATE || 'now'}`);
  } else {
    log('  Scanning ALL bookings (no date filter)');
  }
  log();

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Load reference data
  // ═══════════════════════════════════════════════════════════════════════════

  // 1a. Vendor details
  const vendorSnap = await db.collection('vendorDetails').get();
  const vendorMap = new Map(); // vendorId → { name, branchId, revenueShare }
  vendorSnap.forEach((d) => {
    const data = d.data();
    vendorMap.set(d.id, {
      name: data.vendorName || data.companyName || d.id,
      branchId: data.branchId || '',
      revenueShare: data.revenueShare ?? 80,
      vendorType: data.vendorType || 'ThirdParty',
    });
  });
  log(`  Vendors registered:      ${vendorMap.size}`);

  // 1b. Activity catalog
  const catalogSnap = await db.collection('activityCatalog').get();
  const catalogById = new Map();
  const catalogByName = new Map();
  const vendorGamesInCatalog = new Map(); // vendorId → [gameNames]
  catalogSnap.forEach((d) => {
    const data = { ...d.data(), docId: d.id };
    catalogById.set(d.id, data);
    if (data.name) catalogByName.set(data.name.toLowerCase().trim(), data);
    if (data.bookingName) catalogByName.set(data.bookingName.toLowerCase().trim(), data);
    if (data.vendorId) {
      const list = vendorGamesInCatalog.get(data.vendorId) || [];
      list.push(data.name || d.id);
      vendorGamesInCatalog.set(data.vendorId, list);
    }
  });
  log(`  Activity catalog entries: ${catalogSnap.size}`);
  log(`  Catalog entries w/ vendor: ${Array.from(vendorGamesInCatalog.values()).reduce((s, l) => s + l.length, 0)}`);

  // 1c. Vendor ledger
  const ledgerSnap = await db.collection('vendorLedger').get();
  const ledgerByRef = new Map(); // referenceId → [entries]
  ledgerSnap.forEach((d) => {
    const data = d.data();
    const ref = data.referenceId || '';
    if (!ledgerByRef.has(ref)) ledgerByRef.set(ref, []);
    ledgerByRef.get(ref).push({ id: d.id, ...data });
  });
  log(`  Vendor ledger entries:   ${ledgerSnap.size}`);
  log();

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Scan ALL bookings
  // ═══════════════════════════════════════════════════════════════════════════
  log('  Loading bookings...');
  const bookingsSnap = await db.collection('bookings').get();
  log(`  Total bookings loaded:   ${bookingsSnap.size}\n`);

  // Accumulators
  let scanned = 0;
  let inRange = 0;
  const issues = {
    A_missingVendorId: [],
    B_mismatchedVendorId: [],
    C_completedButInvisible: [],
    D_noBillingItems: [],
    E_vendorSplitsMissing: [],
    F_ledgerGaps: [],
  };
  // Per-vendor stats
  const vendorStats = new Map(); // vendorId → { expected, found, missing, revenue }
  // Per-date stats
  const dateStats = new Map(); // YYYY-MM-DD → { total, withVendor, missingVendor }

  bookingsSnap.forEach((docSnap) => {
    scanned++;
    const d = docSnap.data();
    const txnDate = toDateStr(d.transactionDate) || toDateStr(d.createdAt);
    const bookingId = docSnap.id;

    // Date filter
    if (FROM_DATE && txnDate < FROM_DATE) return;
    if (TO_DATE && txnDate > TO_DATE) return;
    inRange++;

    const billingItems = Array.isArray(d.billingItems) ? d.billingItems : [];
    const items = Array.isArray(d.items) ? d.items : [];
    const source = d.source || 'unknown';
    const paymentStatus = d.paymentStatus || 'unknown';
    const cancelled = d.cancelled === true;
    const refundStatus = d.refundStatus || 'None';
    const locationId = d.locationId || '';
    const totalAmount = d.finalAmount || d.totalAmount || 0;
    const customerName = d.customerName || d.userDisplayName || d.userName || '—';
    const customerPhone = d.customerPhone || d.userPhone || d.mobile || '';

    // Initialize date stats
    if (!dateStats.has(txnDate)) {
      dateStats.set(txnDate, { total: 0, withVendor: 0, missingVendor: 0, revenue: 0 });
    }
    const ds = dateStats.get(txnDate);
    ds.total++;

    // The effective items for reading (same logic as mapTransactionRecord)
    const effectiveItems = billingItems.length > 0 ? billingItems : items;
    const hasBillingItems = billingItems.length > 0;

    // ─── Category D: No billingItems ────────────────────────────────────
    if (!hasBillingItems && items.length > 0) {
      // Check if any item SHOULD have vendor data
      let hasVendorGame = false;
      for (const item of items) {
        const activity = item.activity || {};
        const activityId = String(activity.id || '');
        const itemName = (item.itemName || activity.name || '').toLowerCase().trim();
        const entry = catalogById.get(activityId) || catalogByName.get(itemName);
        if (entry && entry.vendorId) {
          hasVendorGame = true;
          break;
        }
      }
      if (hasVendorGame) {
        issues.D_noBillingItems.push({
          bookingId, txnDate, source, paymentStatus, cancelled, totalAmount,
          customerName, customerPhone, locationId,
          itemCount: items.length,
        });
      }
    }

    // ─── Scan each effective item ───────────────────────────────────────
    effectiveItems.forEach((bi, idx) => {
      const itemName = (bi.itemName || '').trim();
      const itemNameLower = itemName.toLowerCase();
      const biVendorId = bi.vendorId || null;
      const biVendorTotal = bi.vendorTotal || 0;

      // Try to resolve expected vendor from catalog
      const activityId = items[idx]?.activity?.id ? String(items[idx].activity.id) : '';
      const catalogEntry = catalogById.get(activityId) || catalogByName.get(itemNameLower);
      const expectedVendorId = catalogEntry?.vendorId || null;

      const isVendorGame = !!expectedVendorId || !!biVendorId;
      if (!isVendorGame) return; // not a vendor game — skip

      const effectiveVendorId = biVendorId || expectedVendorId;

      // Track vendor stats
      if (!vendorStats.has(effectiveVendorId)) {
        vendorStats.set(effectiveVendorId, {
          name: vendorMap.get(effectiveVendorId)?.name || effectiveVendorId,
          expected: 0, found: 0, missing: 0,
          revenue: 0, missingRevenue: 0,
        });
      }
      const vs = vendorStats.get(effectiveVendorId);
      vs.expected++;

      // ─── Category A: Missing vendorId ──────────────────────────────
      if (!biVendorId && expectedVendorId) {
        vs.missing++;
        ds.missingVendor++;
        const revenue = bi.itemBaseAmount != null
          ? (bi.itemBaseAmount || 0) + (bi.itemGstAmount || 0)
          : (bi.unitPrice || 0) * (bi.quantity || 1);
        vs.missingRevenue += revenue;

        issues.A_missingVendorId.push({
          bookingId, txnDate, source, paymentStatus, cancelled,
          totalAmount, customerName, customerPhone, locationId,
          itemIdx: idx, itemName,
          expectedVendorId,
          expectedVendorName: vendorMap.get(expectedVendorId)?.name || expectedVendorId,
          catalogMatchKey: activityId || itemNameLower,
          hasBillingItems,
          estimatedItemRevenue: Math.round(revenue),
        });

        // ─── Category C: Completed but invisible ──────────────────────
        if (paymentStatus === 'completed' && !cancelled && refundStatus !== 'Full') {
          issues.C_completedButInvisible.push({
            bookingId, txnDate, source, totalAmount,
            customerName, customerPhone, locationId,
            itemIdx: idx, itemName,
            expectedVendorId,
            expectedVendorName: vendorMap.get(expectedVendorId)?.name || expectedVendorId,
            estimatedItemRevenue: Math.round(revenue),
          });
        }
        return;
      }

      // If we get here, vendorId IS present on the item
      vs.found++;
      ds.withVendor++;
      vs.revenue += biVendorTotal;
      ds.revenue += biVendorTotal;

      // ─── Category B: Mismatched vendorId ────────────────────────────
      if (biVendorId && expectedVendorId && biVendorId !== expectedVendorId) {
        issues.B_mismatchedVendorId.push({
          bookingId, txnDate, source, paymentStatus, cancelled,
          totalAmount, customerName, locationId,
          itemIdx: idx, itemName,
          actualVendorId: biVendorId,
          actualVendorName: vendorMap.get(biVendorId)?.name || biVendorId,
          expectedVendorId,
          expectedVendorName: vendorMap.get(expectedVendorId)?.name || expectedVendorId,
        });
      }

      // ─── Category E: Vendor splits missing ──────────────────────────
      if (biVendorId && !biVendorTotal && (bi.itemBaseAmount || bi.unitPrice)) {
        issues.E_vendorSplitsMissing.push({
          bookingId, txnDate, source, paymentStatus,
          itemIdx: idx, itemName,
          vendorId: biVendorId,
          vendorName: vendorMap.get(biVendorId)?.name || biVendorId,
          itemBaseAmount: bi.itemBaseAmount || 0,
          itemGstAmount: bi.itemGstAmount || 0,
          vendorBase: bi.vendorBase || 0,
          vendorGst: bi.vendorGst || 0,
          vendorTotal: bi.vendorTotal || 0,
        });
      }
    });

    // ─── Category F: Vendor ledger gaps ─────────────────────────────────
    if (paymentStatus === 'completed' && !cancelled) {
      const bookingVendorIds = new Set();
      effectiveItems.forEach((bi) => {
        if (bi.vendorId && (bi.vendorTotal || 0) > 0) bookingVendorIds.add(bi.vendorId);
      });
      if (bookingVendorIds.size > 0) {
        const ledgerEntries = ledgerByRef.get(bookingId) || [];
        const ledgerVendorIds = new Set(ledgerEntries.map((e) => e.vendorId));
        for (const vid of bookingVendorIds) {
          if (!ledgerVendorIds.has(vid)) {
            const vendorTotal = effectiveItems
              .filter((bi) => bi.vendorId === vid)
              .reduce((s, bi) => s + (bi.vendorTotal || 0), 0);
            issues.F_ledgerGaps.push({
              bookingId, txnDate, source, paymentStatus,
              vendorId: vid,
              vendorName: vendorMap.get(vid)?.name || vid,
              vendorTotal: Math.round(vendorTotal),
            });
          }
        }
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Category G: Catalog coverage — vendors without catalog entries
  // ═══════════════════════════════════════════════════════════════════════════
  const G_catalogGaps = [];
  for (const [vid, vInfo] of vendorMap) {
    if (!vendorGamesInCatalog.has(vid) || vendorGamesInCatalog.get(vid).length === 0) {
      G_catalogGaps.push({
        vendorId: vid,
        vendorName: vInfo.name,
        branchId: vInfo.branchId,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. JSON output mode
  // ═══════════════════════════════════════════════════════════════════════════
  if (jsonMode) {
    const report = {
      meta: {
        scanned,
        inRange,
        fromDate: FROM_DATE || 'all',
        toDate: TO_DATE || 'all',
        vendorsRegistered: vendorMap.size,
        catalogEntries: catalogSnap.size,
        ledgerEntries: ledgerSnap.size,
        scanDuration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      },
      issues: {
        A_missingVendorId: issues.A_missingVendorId,
        B_mismatchedVendorId: issues.B_mismatchedVendorId,
        C_completedButInvisible: issues.C_completedButInvisible,
        D_noBillingItems: issues.D_noBillingItems,
        E_vendorSplitsMissing: issues.E_vendorSplitsMissing,
        F_ledgerGaps: issues.F_ledgerGaps,
        G_catalogGaps,
      },
      vendorStats: Object.fromEntries(vendorStats),
      dateStats: Object.fromEntries(
        Array.from(dateStats.entries())
          .filter(([, v]) => v.missingVendor > 0)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Human-readable report
  // ═══════════════════════════════════════════════════════════════════════════
  const totalIssues =
    issues.A_missingVendorId.length +
    issues.B_mismatchedVendorId.length +
    issues.C_completedButInvisible.length +
    issues.D_noBillingItems.length +
    issues.E_vendorSplitsMissing.length +
    issues.F_ledgerGaps.length +
    G_catalogGaps.length;

  log('══════════════════════════════════════════════════════════════');
  log('  SCAN SUMMARY');
  log('══════════════════════════════════════════════════════════════');
  log(`  Total bookings scanned:      ${scanned}`);
  log(`  Bookings in date range:      ${inRange}`);
  log(`  Total issues found:          ${totalIssues}`);
  log();
  log(`  [A] Missing vendorId:        ${issues.A_missingVendorId.length} items`);
  log(`  [B] Mismatched vendorId:     ${issues.B_mismatchedVendorId.length} items`);
  log(`  [C] Completed but invisible: ${issues.C_completedButInvisible.length} items`);
  log(`  [D] No billingItems array:   ${issues.D_noBillingItems.length} bookings`);
  log(`  [E] Vendor splits = 0:       ${issues.E_vendorSplitsMissing.length} items`);
  log(`  [F] Vendor ledger gaps:      ${issues.F_ledgerGaps.length} entries`);
  log(`  [G] Catalog coverage gaps:   ${G_catalogGaps.length} vendors`);
  log();

  // ─── Per-vendor breakdown ─────────────────────────────────────────────────
  if (vendorStats.size > 0) {
    log('══════════════════════════════════════════════════════════════');
    log('  PER-VENDOR BREAKDOWN');
    log('══════════════════════════════════════════════════════════════');
    for (const [vid, vs] of vendorStats) {
      const pct = vs.expected > 0 ? ((vs.missing / vs.expected) * 100).toFixed(1) : '0';
      log(`\n  ${vs.name} (${vid})`);
      log(`    Items expected:      ${vs.expected}`);
      log(`    Items found (OK):    ${vs.found}`);
      log(`    Items MISSING:       ${vs.missing}  (${pct}% loss)`);
      log(`    Revenue tracked:     INR ${Math.round(vs.revenue).toLocaleString('en-IN')}`);
      log(`    Revenue MISSING:     INR ${Math.round(vs.missingRevenue).toLocaleString('en-IN')}`);
    }
    log();
  }

  // ─── Per-date breakdown (only dates with issues) ──────────────────────────
  const datesWithIssues = Array.from(dateStats.entries())
    .filter(([, v]) => v.missingVendor > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (datesWithIssues.length > 0) {
    log('══════════════════════════════════════════════════════════════');
    log('  DATES WITH MISSING VENDOR DATA');
    log('══════════════════════════════════════════════════════════════');
    log('  Date        | Total | With Vendor | Missing | Loss%');
    log('  ------------|-------|-------------|---------|------');
    for (const [date, st] of datesWithIssues) {
      const pct = ((st.missingVendor / (st.withVendor + st.missingVendor)) * 100).toFixed(0);
      log(`  ${date}  |  ${String(st.total).padStart(4)} |  ${String(st.withVendor).padStart(10)} |  ${String(st.missingVendor).padStart(6)} |  ${pct}%`);
    }
    log();
  }

  // ─── Category A detail ────────────────────────────────────────────────────
  if (issues.A_missingVendorId.length > 0) {
    log('══════════════════════════════════════════════════════════════');
    log('  [A] MISSING VENDOR ID — Items that should have vendorId');
    log('══════════════════════════════════════════════════════════════');
    for (const p of issues.A_missingVendorId) {
      log(`\n  ${p.bookingId}`);
      log(`    date: ${p.txnDate} | source: ${p.source} | payment: ${p.paymentStatus}${p.cancelled ? ' | CANCELLED' : ''}`);
      log(`    customer: ${p.customerName} | phone: ${p.customerPhone} | location: ${p.locationId}`);
      log(`    booking total: INR ${p.totalAmount} | hasBillingItems: ${p.hasBillingItems}`);
      log(`    item[${p.itemIdx}] "${p.itemName}"`);
      log(`      expected vendor: ${p.expectedVendorName} (${p.expectedVendorId})`);
      log(`      catalog key: "${p.catalogMatchKey}"`);
      log(`      estimated lost revenue: INR ${p.estimatedItemRevenue}`);
    }
    log();
  }

  // ─── Category B detail ────────────────────────────────────────────────────
  if (issues.B_mismatchedVendorId.length > 0) {
    log('══════════════════════════════════════════════════════════════');
    log('  [B] MISMATCHED VENDOR ID — vendorId differs from catalog');
    log('══════════════════════════════════════════════════════════════');
    for (const p of issues.B_mismatchedVendorId) {
      log(`\n  ${p.bookingId}`);
      log(`    date: ${p.txnDate} | source: ${p.source} | payment: ${p.paymentStatus}`);
      log(`    item[${p.itemIdx}] "${p.itemName}"`);
      log(`      actual:   ${p.actualVendorName} (${p.actualVendorId})`);
      log(`      expected: ${p.expectedVendorName} (${p.expectedVendorId})`);
    }
    log();
  }

  // ─── Category C detail ────────────────────────────────────────────────────
  if (issues.C_completedButInvisible.length > 0) {
    log('══════════════════════════════════════════════════════════════');
    log('  [C] COMPLETED BUT INVISIBLE TO THIRDPARTY');
    log('  These are paid, non-cancelled bookings that the vendor');
    log('  CANNOT see in their Game Revenue view.');
    log('══════════════════════════════════════════════════════════════');
    // Group by vendor for clearer reporting
    const byVendor = new Map();
    for (const p of issues.C_completedButInvisible) {
      if (!byVendor.has(p.expectedVendorId)) byVendor.set(p.expectedVendorId, []);
      byVendor.get(p.expectedVendorId).push(p);
    }
    for (const [vid, entries] of byVendor) {
      const vName = vendorMap.get(vid)?.name || vid;
      const totalLost = entries.reduce((s, e) => s + e.estimatedItemRevenue, 0);
      log(`\n  ── ${vName} (${vid}) — ${entries.length} invisible bookings, ~INR ${totalLost.toLocaleString('en-IN')} ──`);
      for (const p of entries) {
        log(`    ${p.bookingId} | ${p.txnDate} | ${p.source} | ${p.customerName} | INR ${p.totalAmount}`);
        log(`      item[${p.itemIdx}] "${p.itemName}" → ~INR ${p.estimatedItemRevenue}`);
      }
    }
    log();
  }

  // ─── Category D detail ────────────────────────────────────────────────────
  if (issues.D_noBillingItems.length > 0) {
    log('══════════════════════════════════════════════════════════════');
    log('  [D] NO billingItems ARRAY — vendor splits never computed');
    log('══════════════════════════════════════════════════════════════');
    for (const p of issues.D_noBillingItems) {
      log(`  ${p.bookingId} | ${p.txnDate} | ${p.source} | ${p.paymentStatus} | ${p.itemCount} items | INR ${p.totalAmount}`);
    }
    log();
  }

  // ─── Category E detail ────────────────────────────────────────────────────
  if (issues.E_vendorSplitsMissing.length > 0) {
    log('══════════════════════════════════════════════════════════════');
    log('  [E] VENDOR SPLITS = 0 — vendorId present but no revenue split');
    log('══════════════════════════════════════════════════════════════');
    for (const p of issues.E_vendorSplitsMissing) {
      log(`  ${p.bookingId} | ${p.txnDate} | item[${p.itemIdx}] "${p.itemName}"`);
      log(`    vendor: ${p.vendorName} | base: ${p.itemBaseAmount} | gst: ${p.itemGstAmount} | vBase: ${p.vendorBase} | vGst: ${p.vendorGst} | vTotal: ${p.vendorTotal}`);
    }
    log();
  }

  // ─── Category F detail ────────────────────────────────────────────────────
  if (issues.F_ledgerGaps.length > 0) {
    log('══════════════════════════════════════════════════════════════');
    log('  [F] VENDOR LEDGER GAPS — booking has splits but no ledger');
    log('══════════════════════════════════════════════════════════════');
    for (const p of issues.F_ledgerGaps) {
      log(`  ${p.bookingId} | ${p.txnDate} | ${p.vendorName} (${p.vendorId}) | INR ${p.vendorTotal}`);
    }
    log();
  }

  // ─── Category G detail ────────────────────────────────────────────────────
  if (G_catalogGaps.length > 0) {
    log('══════════════════════════════════════════════════════════════');
    log('  [G] CATALOG GAPS — vendors with NO activityCatalog entries');
    log('  These vendors\' games can NEVER be auto-resolved from');
    log('  Customer App bookings.');
    log('══════════════════════════════════════════════════════════════');
    for (const p of G_catalogGaps) {
      log(`  ${p.vendorName} (${p.vendorId}) — branch: ${p.branchId || '—'}`);
    }
    log();
  }

  // ─── Final ────────────────────────────────────────────────────────────────
  log('══════════════════════════════════════════════════════════════');
  if (totalIssues === 0) {
    log('  ✓ No vendor-attribution issues found.');
  } else {
    log(`  ${totalIssues} total issues found.`);
    log();
    log('  REMEDIATION PRIORITY:');
    if (issues.C_completedButInvisible.length > 0) {
      log(`  1. [CRITICAL] Patch ${issues.C_completedButInvisible.length} completed-but-invisible items`);
      log('     → backfill vendorId on billingItems, recompute splits, write ledger');
    }
    if (G_catalogGaps.length > 0) {
      log(`  2. [HIGH] Add catalog entries for ${G_catalogGaps.length} vendors`);
      log('     → prevents future APP_BOOKING items from losing vendor attribution');
    }
    if (issues.F_ledgerGaps.length > 0) {
      log(`  3. [MEDIUM] Write ${issues.F_ledgerGaps.length} missing vendor ledger entries`);
    }
    if (issues.E_vendorSplitsMissing.length > 0) {
      log(`  4. [MEDIUM] Recompute splits for ${issues.E_vendorSplitsMissing.length} items with zero splits`);
    }
  }
  log(`\n  Scan completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  log('══════════════════════════════════════════════════════════════\n');
  process.exit(0);
})();
