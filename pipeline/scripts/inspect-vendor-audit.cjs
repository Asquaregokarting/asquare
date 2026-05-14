/**
 * Per-booking audit dump for a single vendor across a date window.
 *
 * Reproduces the AuditTab page's headline math but per-booking so we can
 * see which bookings cause the A/B/C/D drift. Output is grouped by:
 *   - A_vs_B_drift   : items[] gross ≠ billingItems[] gross
 *   - C_vs_D_drift   : Σ billingItems[].vendorTotal ≠ ledger net for the vendor
 *   - GST_leak       : SubLease vendor got credited on GST as well as base
 *   - clean          : all three columns agree
 *
 * Usage:
 *   node scripts/inspect-vendor-audit.cjs <vendorId> <fromYMD> <toYMD>
 *   node scripts/inspect-vendor-audit.cjs 8712234222 2026-05-02 2026-05-08
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const TOL = 2;

const vendorId = process.argv[2];
const fromYMD = process.argv[3];
const toYMD = process.argv[4];
if (!vendorId || !fromYMD || !toYMD) {
  console.error('Usage: node scripts/inspect-vendor-audit.cjs <vendorId> <fromYMD> <toYMD>');
  process.exit(1);
}

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

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const r2 = (n) => Math.round(n);

const dateOf = (d) => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d.toDate) return d.toDate().toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};
const inRange = (ymd) => ymd >= fromYMD && ymd <= toYMD;

(async () => {
  // 1) Find all bookings where this vendor appears, then filter by date.
  const snap = await db
    .collection('bookings')
    .where('vendorIds', 'array-contains', vendorId)
    .get();

  // 2) Pull this vendor's full ledger for the range.
  const ledgerSnap = await db
    .collection('vendorLedger')
    .where('vendorId', '==', vendorId)
    .get();

  // Bucket ledger rows by bookingId for cross-reference.
  const ledgerByBooking = new Map();
  let ledgerNetForVendorInRange = 0;
  for (const doc of ledgerSnap.docs) {
    const e = doc.data();
    const bId = e.bookingId || e.referenceId || '';
    const dt = dateOf(e.date || e.transactionDate || e.createdAt);
    if (!inRange(dt)) continue;
    const arr = ledgerByBooking.get(bId) ?? [];
    arr.push({
      id: doc.id,
      date: dt,
      type: e.type || '',
      source: e.source || '',
      amount: num(e.amount),
      vendorBase: num(e.vendorBase),
      vendorGst: num(e.vendorGst),
      vendorTotal: num(e.vendorTotal),
    });
    ledgerByBooking.set(bId, arr);
    ledgerNetForVendorInRange += num(e.amount);
  }

  // 3) For each booking in range, compute the headline columns.
  let A_total = 0;
  let B_total = 0;
  let C_total = 0;
  const rows = [];
  let bookingCount = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.cancelled === true) continue;
    if (d.deletedAt || d.voidedAt) continue;
    const dt = dateOf(d.transactionDate || d.visitDate || d.createdAt);
    if (!inRange(dt)) continue;
    bookingCount++;

    // Vendor's share % is read from the booking's items[]/billingItems[]
    // for THIS vendor; we infer from the largest set we can find.
    const items = Array.isArray(d.items) ? d.items : [];
    const billing = Array.isArray(d.billingItems) ? d.billingItems : [];

    // A: gross from items[] (this vendor only)
    let A = 0;
    for (const it of items) {
      if ((it?.vendorId || '') !== vendorId) continue;
      const qty = Math.max(1, Math.floor(num(it.quantity)) || 1);
      const unit = num(it.unitPrice ?? it.price);
      A += qty * unit;
    }

    // B: gross from billingItems[] (this vendor only)
    let B = 0;
    for (const bi of billing) {
      if ((bi?.vendorId || '') !== vendorId) continue;
      const base = num(bi.itemBaseAmount);
      const gst = num(bi.itemGstAmount);
      // Gross = base + gst, but if those aren't present fall back to qty × unitPrice
      const altGross = Math.max(1, Math.floor(num(bi.quantity)) || 1) * num(bi.unitPrice);
      B += base + gst > 0 ? base + gst : altGross;
    }

    // C: Σ billingItems[].vendorTotal for this vendor
    let C_base = 0;
    let C_gst = 0;
    let C = 0;
    for (const bi of billing) {
      if ((bi?.vendorId || '') !== vendorId) continue;
      C += num(bi.vendorTotal);
      C_base += num(bi.vendorBase);
      C_gst += num(bi.vendorGst);
    }

    // D: ledger entries on this booking for this vendor
    const ledgerRows = ledgerByBooking.get(doc.id) ?? [];
    const D = ledgerRows.reduce((s, e) => s + e.amount, 0);

    A_total += A;
    B_total += B;
    C_total += C;

    // Classify
    const A_vs_B = A - B;
    const C_vs_D = C - D;
    const gstLeak = C_gst > TOL; // SubLease should never have vendorGst > 0
    const flags = [];
    if (Math.abs(A_vs_B) > TOL) flags.push('A_vs_B');
    if (Math.abs(C_vs_D) > TOL) flags.push('C_vs_D');
    if (gstLeak) flags.push('GST_leak');
    if (flags.length === 0) flags.push('clean');

    rows.push({
      id: doc.id,
      date: dt,
      A,
      B,
      C,
      D,
      C_base,
      C_gst,
      ledgerEntryCount: ledgerRows.length,
      flags,
    });
  }

  rows.sort((a, b) =>
    Math.abs(b.A - b.B) + Math.abs(b.C - b.D) + Math.abs(b.C_gst) -
    (Math.abs(a.A - a.B) + Math.abs(a.C - a.D) + Math.abs(a.C_gst)),
  );

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Vendor ${vendorId} · ${fromYMD} → ${toYMD}`);
  console.log('══════════════════════════════════════════════════════════════\n');
  console.log(`Bookings in range (not cancelled / not deleted): ${bookingCount}`);
  console.log(`A total (items[] gross, this vendor)            : ${r2(A_total)}`);
  console.log(`B total (billingItems[] gross, this vendor)     : ${r2(B_total)}`);
  console.log(`C total (Σ billingItems[].vendorTotal)          : ${r2(C_total)}`);
  console.log(`D total (ledger net for vendor in range)        : ${r2(ledgerNetForVendorInRange)}`);

  const flagCounts = {};
  for (const r of rows) {
    for (const f of r.flags) flagCounts[f] = (flagCounts[f] || 0) + 1;
  }
  console.log('\nFlag counts (rows can have multiple flags):');
  for (const [f, n] of Object.entries(flagCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f.padEnd(12)} ${n}`);
  }

  console.log('\nTop 25 rows by drift magnitude:');
  console.log(
    '  bookingId                              date        A         B         C         D     C_gst  flags',
  );
  for (const r of rows.slice(0, 25)) {
    console.log(
      `  ${r.id.padEnd(36)} ${r.date}  ${String(r2(r.A)).padStart(7)}  ${String(r2(r.B)).padStart(7)}  ${String(r2(r.C)).padStart(7)}  ${String(r2(r.D)).padStart(7)}  ${String(r2(r.C_gst)).padStart(5)}  ${r.flags.join(',')}`,
    );
  }

  // Show ledger entries NOT linked to any booking (manual adjustments).
  let orphanLedger = 0;
  let orphanLedgerCount = 0;
  for (const doc of ledgerSnap.docs) {
    const e = doc.data();
    const dt = dateOf(e.date || e.transactionDate || e.createdAt);
    if (!inRange(dt)) continue;
    const bId = e.bookingId || e.referenceId || '';
    if (!bId) {
      orphanLedger += num(e.amount);
      orphanLedgerCount++;
    }
  }
  if (orphanLedgerCount > 0) {
    console.log(`\nLedger rows with NO bookingId (manual adjustments): ${orphanLedgerCount}, sum=${r2(orphanLedger)}`);
  }

  process.exit(0);
})().catch((err) => {
  console.error('Inspection failed:', err);
  process.exit(1);
});
