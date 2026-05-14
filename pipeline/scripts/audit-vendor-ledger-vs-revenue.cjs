/**
 * Side-by-side audit of one vendor's ledger total vs derived Game Revenue
 * (gross × revenueShare%) for a date range. Surfaces every (booking,
 * source-of-row) so you can pinpoint exactly which rows account for the
 * gap between the two numbers.
 *
 * Usage:
 *   node scripts/audit-vendor-ledger-vs-revenue.cjs <vendorId> <fromYYYY-MM-DD> <toYYYY-MM-DD>
 *
 * Example (Manoja, 29-Mar to 24-Apr 2026):
 *   node scripts/audit-vendor-ledger-vs-revenue.cjs 9985526034 2026-03-29 2026-04-24
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const [, , VENDOR_ID, FROM, TO] = process.argv;
if (!VENDOR_ID || !FROM || !TO) {
  console.error('Usage: node scripts/audit-vendor-ledger-vs-revenue.cjs <vendorId> <from> <to>');
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

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pad = (s, w) => String(s ?? '').padEnd(w);
const padR = (s, w) => String(s ?? '').padStart(w);
const dateOnly = (raw) => {
  if (!raw) return '';
  if (typeof raw === 'object' && typeof raw.toDate === 'function') {
    try { return raw.toDate().toISOString().slice(0, 10); } catch { return ''; }
  }
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

(async () => {
  console.log(`\n┌─ vendor ledger vs revenue audit ─────────────────────────────┐`);
  console.log(`│ vendor: ${VENDOR_ID}    window: ${FROM}..${TO}`);
  console.log(`└──────────────────────────────────────────────────────────────┘\n`);

  const vSnap = await db.collection('vendorDetails').doc(VENDOR_ID).get();
  const vData = vSnap.exists ? vSnap.data() || {} : {};
  const sharePct = typeof vData.revenueShare === 'number' ? vData.revenueShare : 80;
  console.log(`Vendor: ${vData.vendorName || vData.userName || VENDOR_ID}`);
  console.log(`Type: ${vData.vendorType || '?'}    Branch: ${vData.branch || '?'}    Share: ${sharePct}%\n`);

  // 1. Sum ledger entries in window for this vendor.
  const ledSnap = await db.collection('vendorLedger').where('vendorId', '==', VENDOR_ID).get();
  const ledger = []; // { id, day, type, source, amount, referenceId }
  ledSnap.forEach((d) => {
    const r = d.data() || {};
    const day = dateOnly(r.date);
    if (!day || day < FROM || day > TO) return;
    ledger.push({
      id: d.id,
      day,
      type: String(r.type ?? ''),
      source: String(r.source ?? ''),
      amount: Number(r.amount) || 0,
      referenceId: String(r.referenceId ?? ''),
    });
  });
  ledger.sort((a, b) => a.day.localeCompare(b.day));

  // Group ledger contributions by source.
  const bySource = new Map();
  let credits = 0, debits = 0;
  for (const r of ledger) {
    const k = `${r.type}/${r.source || '(no source)'}`;
    const acc = bySource.get(k) ?? { count: 0, total: 0 };
    acc.count++;
    if (r.type === 'credit') {
      credits += r.amount;
      acc.total += r.amount;
    } else if (r.type === 'debit') {
      debits += r.amount;
      acc.total -= r.amount;
    }
    bySource.set(k, acc);
  }
  const ledgerNet = credits - debits;

  // 2. Walk bookings in window. For each, compute four numbers:
  //    (a) Gross from items[].vendorId match (× unitPrice × qty)
  //    (b) Gross from billingItems[].vendorId match (× unitPrice × qty)
  //    (c) Sum of billingItems[i].vendorTotal where vendorId matches
  //    (d) Ledger net (set later from ledgerByBooking)
  //
  // Match scope: a booking is considered "contributing" if the vendor
  // appears in items[] OR billingItems[] OR top-level vendorId OR
  // top-level vendorIds[]. Older bookings often have the vendor only in
  // billingItems (POS path), newer ones in items (online/unified path).
  const bSnap = await db.collection('bookings').get();
  let bookingCount = 0;
  let totalGrossItems = 0;
  let totalGrossBilling = 0;
  let totalVendorTotalSum = 0;
  const perBooking = [];
  bSnap.forEach((d) => {
    const data = d.data() || {};
    if (data.cancelled === true) return;
    if (data.paymentStatus && data.paymentStatus !== 'completed') return;
    if (data.refundStatus === 'Full') return;
    const day = dateOnly(data.transactionDate ?? data.createdAt);
    if (!day || day < FROM || day > TO) return;

    const items = Array.isArray(data.items) ? data.items : [];
    const billing = Array.isArray(data.billingItems) ? data.billingItems : [];
    const topVendorId = String(data.vendorId ?? '');
    const vendorIds = Array.isArray(data.vendorIds) ? data.vendorIds.map(String) : [];

    let grossItems = 0;
    for (const it of items) {
      if (!it || it.vendorId !== VENDOR_ID) continue;
      const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
      const unit = Number(it.unitPrice ?? it.price) || 0;
      grossItems += qty * unit;
    }
    let grossBilling = 0;
    let vendorTotalSum = 0;
    for (const bi of billing) {
      if (!bi || bi.vendorId !== VENDOR_ID) continue;
      const qty = Math.max(1, Math.floor(Number(bi.quantity) || 1));
      const unit = Number(bi.unitPrice ?? bi.price) || 0;
      grossBilling += qty * unit;
      vendorTotalSum += Number(bi.vendorTotal) || 0;
    }
    const matched =
      grossItems > 0 ||
      grossBilling > 0 ||
      topVendorId === VENDOR_ID ||
      vendorIds.includes(VENDOR_ID);
    if (!matched) return;

    bookingCount++;
    totalGrossItems += grossItems;
    totalGrossBilling += grossBilling;
    totalVendorTotalSum += vendorTotalSum;
    perBooking.push({
      id: d.id,
      day,
      grossItems,
      grossBilling,
      vendorTotalSum,
      derivedShare: Math.round((grossItems * sharePct) / 100),
      derivedShareBilling: Math.round((grossBilling * sharePct) / 100),
    });
  });

  // 3. Per-booking ledger sum (credits − debits) for diff drilldown.
  const ledgerByBooking = new Map();
  for (const r of ledger) {
    if (!r.referenceId) continue;
    const acc = ledgerByBooking.get(r.referenceId) ?? 0;
    ledgerByBooking.set(
      r.referenceId,
      acc + (r.type === 'credit' ? r.amount : r.type === 'debit' ? -r.amount : 0),
    );
  }
  for (const b of perBooking) b.ledgerSum = ledgerByBooking.get(b.id) ?? 0;

  // 4. Print four-way headline.
  const derivedFromItems = Math.round((totalGrossItems * sharePct) / 100);
  const derivedFromBilling = Math.round((totalGrossBilling * sharePct) / 100);
  console.log(`─── headline (4-way) ───────────────────────────────────────`);
  console.log(`  Bookings contributing                 : ${bookingCount}`);
  console.log(`                                          (matched on items / billingItems / top-level / vendorIds[])`);
  console.log(``);
  console.log(`  A. Gross from items[]                 : ${inr(totalGrossItems)}`);
  console.log(`     × ${sharePct}% (items basis)              : ${inr(derivedFromItems)}`);
  console.log(`  B. Gross from billingItems[]          : ${inr(totalGrossBilling)}`);
  console.log(`     × ${sharePct}% (billingItems basis)        : ${inr(derivedFromBilling)}`);
  console.log(`  C. Sum of billingItems[].vendorTotal  : ${inr(totalVendorTotalSum)}    ← what the trigger writes to ledger`);
  console.log(`  D. Ledger net (credits − debits)      : ${inr(ledgerNet)}    ← Vendor Ledger page`);
  console.log(``);
  console.log(`  C − D (per-item sum vs ledger)        : ${inr(totalVendorTotalSum - ledgerNet)}    (expect ≈ 0; non-zero = manual adjustments / refund corrections / drift)`);
  console.log(`  Game Revenue page reported            : ₹2,07,326 (from your screenshot)`);
  console.log(`  ─ which formula matches the page? ─`);
  console.log(`     A × 82% = ${inr(derivedFromItems)}`);
  console.log(`     B × 82% = ${inr(derivedFromBilling)}`);
  console.log(`     The one closest to 2,07,326 is the formula GameRevenue uses.\n`);

  console.log(`─── ledger composition (where the ledger total comes from) ──`);
  console.log(pad('type/source', 36) + padR('count', 8) + padR('net total', 14));
  console.log('─'.repeat(60));
  for (const [k, v] of [...bySource.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total))) {
    console.log(pad(k, 36) + padR(v.count, 8) + padR(inr(v.total), 14));
  }
  console.log('─'.repeat(60));
  console.log(pad('TOTAL', 36) + padR(ledger.length, 8) + padR(inr(ledgerNet), 14));

  for (const b of perBooking) b.ledgerSum = ledgerByBooking.get(b.id) ?? 0;

  // 5. Per-booking diff: ledger vs sum-of-billingItems-vendorTotal. This
  // is the ground-truth comparison — the trigger writes ledger directly
  // from billingItems[i].vendorTotal, so any non-zero diff is a manual
  // adjustment, refund correction, or stale data.
  const billingDiffs = perBooking
    .map((b) => ({ ...b, billingDiff: b.ledgerSum - b.vendorTotalSum }))
    .filter((b) => Math.abs(b.billingDiff) > 0)
    .sort((a, b) => Math.abs(b.billingDiff) - Math.abs(a.billingDiff));
  console.log(`─── per-booking: ledger vs billingItems vendorTotal sum ──`);
  console.log(`  ${billingDiffs.length} of ${bookingCount} bookings have non-zero diff.`);
  console.log(`  Sum of all diffs: ${inr(billingDiffs.reduce((s, b) => s + b.billingDiff, 0))}\n`);
  if (billingDiffs.length > 0) {
    console.log(
      pad('booking', 26) + pad('date', 12) +
      padR('Σ vendorTotal', 14) + padR('ledger', 11) + padR('diff', 11),
    );
    console.log('─'.repeat(82));
    for (const b of billingDiffs.slice(0, 30)) {
      console.log(
        pad(b.id, 26) + pad(b.day, 12) +
        padR(inr(b.vendorTotalSum), 14) +
        padR(inr(b.ledgerSum), 11) +
        padR((b.billingDiff > 0 ? '+' : '') + inr(b.billingDiff), 11),
      );
    }
    if (billingDiffs.length > 30) console.log(`  ... and ${billingDiffs.length - 30} more`);
  }

  // 6. Per-booking diff: derived (gross × share%) vs ledger. Reveals
  // bookings where the page's reported share is wildly different from
  // what the vendor actually got — usually combo bookings where items[]
  // has full per-seat price but vendor only owns a sub-component.
  const shareDiffs = perBooking
    .map((b) => ({
      ...b,
      shareDiffItems: b.ledgerSum - b.derivedShare,
      shareDiffBilling: b.ledgerSum - b.derivedShareBilling,
    }))
    .filter((b) => b.derivedShare > 0 || b.derivedShareBilling > 0)
    .sort(
      (a, b) => Math.abs(b.shareDiffBilling) - Math.abs(a.shareDiffBilling),
    );
  console.log(`\n─── per-booking: ledger vs (gross × share%) ──`);
  console.log(`  Top 30 by abs diff against billingItems-derived share.\n`);
  console.log(
    pad('booking', 26) + pad('date', 12) +
    padR('items×%', 11) + padR('billing×%', 12) +
    padR('ledger', 11) + padR('diff(items)', 12) + padR('diff(bill)', 11),
  );
  console.log('─'.repeat(94));
  for (const b of shareDiffs.slice(0, 30)) {
    console.log(
      pad(b.id, 26) + pad(b.day, 12) +
      padR(inr(b.derivedShare), 11) + padR(inr(b.derivedShareBilling), 12) +
      padR(inr(b.ledgerSum), 11) +
      padR((b.shareDiffItems > 0 ? '+' : '') + inr(b.shareDiffItems), 12) +
      padR((b.shareDiffBilling > 0 ? '+' : '') + inr(b.shareDiffBilling), 11),
    );
  }

  // 7. Bookings WITHOUT any ledger entry (vendor earned revenue but ledger has nothing).
  const orphans = perBooking.filter((b) => Math.abs(b.ledgerSum) < 1);
  if (orphans.length > 0) {
    console.log(`\n─── bookings with revenue but no ledger entry (${orphans.length}) ─`);
    for (const b of orphans.slice(0, 15)) {
      console.log(
        `  ${pad(b.id, 26)} ${b.day}  vendorTotalSum=${inr(b.vendorTotalSum)} derivedItems=${inr(b.derivedShare)}`,
      );
    }
    if (orphans.length > 15) console.log(`  ... and ${orphans.length - 15} more`);
  }

  // 7. Ledger entries WITHOUT a matching booking in the window.
  const bookingIdsInWindow = new Set(perBooking.map((b) => b.id));
  const orphanLedger = ledger.filter((r) => r.referenceId && !bookingIdsInWindow.has(r.referenceId));
  if (orphanLedger.length > 0) {
    console.log(`\n─── ledger rows referencing bookings outside the gross-revenue set (${orphanLedger.length}) ─`);
    console.log(`  Could be: refunded-out, cancelled, or pre-window booking that's still in this window's ledger.`);
    let orphanLedgerNet = 0;
    for (const r of orphanLedger) {
      orphanLedgerNet += r.type === 'credit' ? r.amount : r.type === 'debit' ? -r.amount : 0;
    }
    console.log(`  Net contribution: ${inr(orphanLedgerNet)}`);
    for (const r of orphanLedger.slice(0, 15)) {
      console.log(`  ${pad(r.day, 12)} ${pad(r.type, 8)} ${pad(r.source || '-', 20)} ref=${pad(r.referenceId, 26)} ${inr(r.type === 'credit' ? r.amount : -r.amount)}`);
    }
    if (orphanLedger.length > 15) console.log(`  ... and ${orphanLedger.length - 15} more`);
  }

  console.log('\nRead-only run complete.\n');
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
