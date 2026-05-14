/**
 * Bulk vendor audit for one accounting week. For every vendor that has
 * either a booking or a ledger entry in the range, compute:
 *
 *   A_total = Σ items[].qty × unitPrice (filtered by vendor)
 *   B_total = Σ billingItems[].(base+gst) (filtered by vendor)
 *   C_total = Σ billingItems[].vendorTotal (filtered by vendor)
 *   D_total = Σ vendorLedger.amount (filtered by vendor)
 *   D_no_bookingId = count of ledger rows missing the `bookingId` field
 *   C_gst_leak = count of bookings where this SubLease vendor got vendorGst > 0
 *   A_vs_B_rows = count of bookings where items[] gross ≠ billingItems[] gross
 *
 * Result: a vendor-by-vendor table that tells us whether the
 * orphan-ledger / over-credit / items-drift patterns are isolated to
 * one vendor or endemic across the roster.
 *
 * Usage:
 *   node scripts/audit-all-vendors-week.cjs 2026-05-02 2026-05-08
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const TOL = 2;

const fromYMD = process.argv[2];
const toYMD = process.argv[3];
if (!fromYMD || !toYMD) {
  console.error('Usage: node scripts/audit-all-vendors-week.cjs <fromYMD> <toYMD>');
  process.exit(1);
}

const keyPath = path.resolve('serviceAccountKey.json');
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
  console.log('\nLoading vendors, bookings, ledger… (may take ~30s)');
  const [vendorsSnap, ledgerSnap] = await Promise.all([
    db.collection('vendors').get(),
    db.collection('vendorLedger').get(),
  ]);

  // Vendor metadata index.
  const vendorById = new Map();
  for (const doc of vendorsSnap.docs) {
    const v = doc.data();
    vendorById.set(doc.id, {
      id: doc.id,
      name: v.name || '',
      branch: v.branch || '',
      vendorType: v.vendorType || '',
      revenueShare: num(v.revenueShare),
    });
  }

  // Per-vendor accumulator.
  const stat = new Map();
  const ensure = (id) => {
    let s = stat.get(id);
    if (!s) {
      s = {
        id,
        bookings: 0,
        A: 0,
        B: 0,
        C: 0,
        C_gst: 0,
        D: 0,
        ledgerRows: 0,
        ledgerNoBookingId: 0,
        A_vs_B_rows: 0,
        gst_leak_rows: 0,
      };
      stat.set(id, s);
    }
    return s;
  };

  // 1) Process ledger.
  for (const doc of ledgerSnap.docs) {
    const e = doc.data();
    const dt = dateOf(e.date || e.transactionDate || e.createdAt);
    if (!inRange(dt)) continue;
    const vId = e.vendorId || '';
    if (!vId) continue;
    const s = ensure(vId);
    const signed = e.type === 'debit' ? -num(e.amount) : num(e.amount);
    s.D += signed;
    s.ledgerRows++;
    if (!e.bookingId && !e.referenceId) s.ledgerNoBookingId++;
  }

  // 2) Process bookings — page by ID since we don't have a date index
  //    that lines up with our use (transactionDate is often stored as a
  //    Timestamp; this is the same pattern that worked in the sweep).
  let last = null;
  let scanned = 0;
  while (true) {
    let q = db.collection('bookings').orderBy('__name__').limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned++;
      const d = doc.data();
      if (d.cancelled === true) continue;
      if (d.deletedAt || d.voidedAt) continue;
      const dt = dateOf(d.transactionDate || d.visitDate || d.createdAt);
      if (!inRange(dt)) continue;

      const items = Array.isArray(d.items) ? d.items : [];
      const billing = Array.isArray(d.billingItems) ? d.billingItems : [];
      const vendorIdsOnBooking = new Set();

      const A_byVendor = new Map();
      for (const it of items) {
        const vId = it?.vendorId || '';
        if (!vId) continue;
        const qty = Math.max(1, Math.floor(num(it.quantity)) || 1);
        const unit = num(it.unitPrice ?? it.price);
        A_byVendor.set(vId, (A_byVendor.get(vId) || 0) + qty * unit);
        vendorIdsOnBooking.add(vId);
      }

      const B_byVendor = new Map();
      const C_byVendor = new Map();
      const C_gst_byVendor = new Map();
      for (const bi of billing) {
        const vId = bi?.vendorId || '';
        if (!vId) continue;
        const base = num(bi.itemBaseAmount);
        const gst = num(bi.itemGstAmount);
        const qty = Math.max(1, Math.floor(num(bi.quantity)) || 1);
        const unit = num(bi.unitPrice);
        const gross = base + gst > 0 ? base + gst : qty * unit;
        B_byVendor.set(vId, (B_byVendor.get(vId) || 0) + gross);
        C_byVendor.set(vId, (C_byVendor.get(vId) || 0) + num(bi.vendorTotal));
        C_gst_byVendor.set(vId, (C_gst_byVendor.get(vId) || 0) + num(bi.vendorGst));
        vendorIdsOnBooking.add(vId);
      }

      for (const vId of vendorIdsOnBooking) {
        const s = ensure(vId);
        s.bookings++;
        const a = A_byVendor.get(vId) || 0;
        const b = B_byVendor.get(vId) || 0;
        const c = C_byVendor.get(vId) || 0;
        const cGst = C_gst_byVendor.get(vId) || 0;
        s.A += a;
        s.B += b;
        s.C += c;
        s.C_gst += cGst;
        if (Math.abs(a - b) > TOL) s.A_vs_B_rows++;
        if (cGst > TOL) s.gst_leak_rows++;
      }
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 500) break;
    process.stderr.write(`  scanned ${scanned} bookings…\r`);
  }

  // Render.
  const rows = [...stat.values()].filter(
    (s) => s.bookings > 0 || s.ledgerRows > 0,
  );
  rows.sort((a, b) => Math.abs(b.C - b.D) - Math.abs(a.C - a.D));

  let issuesAny = 0;
  let issuesOver = 0;
  let issuesUnder = 0;
  let issuesOrphanLedger = 0;
  let issuesItemsDrift = 0;
  let issuesGstLeak = 0;
  let issuesNoCNoD = 0;

  for (const s of rows) {
    const v = vendorById.get(s.id) || { name: '', vendorType: '', revenueShare: 0 };
    const diffCD = s.C - s.D; // negative = ledger over-credit; positive = under
    if (Math.abs(diffCD) > TOL) {
      issuesAny++;
      if (diffCD < 0) issuesOver++;
      else issuesUnder++;
    }
    if (s.ledgerNoBookingId > 0 && s.ledgerRows > 0) issuesOrphanLedger++;
    if (s.A_vs_B_rows > 0) issuesItemsDrift++;
    if (s.gst_leak_rows > 0) issuesGstLeak++;
    if (s.C === 0 && s.D === 0) issuesNoCNoD++;
    s._diffCD = diffCD;
    s._name = v.name;
    s._type = v.vendorType;
    s._share = v.revenueShare;
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  All-vendor audit · ${fromYMD} → ${toYMD}`);
  console.log('══════════════════════════════════════════════════════════════\n');
  console.log(`Bookings scanned                           : ${scanned}`);
  console.log(`Vendors with any activity (bookings or ledger): ${rows.length}`);
  console.log(`Vendors with |C − D| drift (>₹${TOL})       : ${issuesAny}`);
  console.log(`  …of which ledger OVER-credit (D > C)     : ${issuesOver}`);
  console.log(`  …of which ledger UNDER-credit (C > D)    : ${issuesUnder}`);
  console.log(`Vendors with ledger rows missing bookingId : ${issuesOrphanLedger}`);
  console.log(`Vendors with items[] vs billingItems drift : ${issuesItemsDrift}`);
  console.log(`Vendors with SubLease GST leak (C_gst > 0) : ${issuesGstLeak}`);
  console.log(`Vendors with no C and no D (both zero)     : ${issuesNoCNoD}`);

  console.log('\nTop 30 vendors by |C − D| drift:');
  console.log(
    '  vendorId      type    share  name                                    bookings  A         B         C         D       C-D     orphan%   itemsDrift  gstLeak',
  );
  for (const s of rows.slice(0, 30)) {
    const orphanPct = s.ledgerRows > 0 ? Math.round((s.ledgerNoBookingId / s.ledgerRows) * 100) : 0;
    console.log(
      `  ${String(s.id).padEnd(12)}  ${String(s._type || '—').padEnd(7)} ${String(s._share || '').padStart(5)}  ${String(s._name || '').slice(0, 38).padEnd(38)}  ${String(s.bookings).padStart(7)}  ${String(r2(s.A)).padStart(7)}  ${String(r2(s.B)).padStart(7)}  ${String(r2(s.C)).padStart(7)}  ${String(r2(s.D)).padStart(7)}  ${String(r2(s._diffCD)).padStart(7)}  ${String(orphanPct).padStart(4)}%   ${String(s.A_vs_B_rows).padStart(7)}     ${String(s.gst_leak_rows).padStart(3)}`,
    );
  }

  process.exit(0);
})().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
