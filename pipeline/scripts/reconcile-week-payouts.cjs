/**
 * For a single accounting week, list per vendor:
 *   - ledgerOwed     : net credit in vendorLedger for this period (truth)
 *   - lockedInvoices : sum of vendorInvoices with status=locked    (already paid)
 *   - pendingInvoices: sum of vendorInvoices with status!=locked   (not yet paid)
 *   - invoiceTotal   : lockedInvoices + pendingInvoices            (what we'll cheque)
 *   - gap            : invoiceTotal - ledgerOwed                   (overpay if +, under if -)
 *
 * Use this when invoices were generated before a cleanup pass and you
 * need to know what the actual payout should be NOW.
 *
 * Usage:
 *   node scripts/reconcile-week-payouts.cjs 2026-04-18 2026-04-24
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const fromYMD = process.argv[2];
const toYMD = process.argv[3];
if (!fromYMD || !toYMD) {
  console.error('Usage: node scripts/reconcile-week-payouts.cjs <fromYMD> <toYMD>');
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
  const [ledgerSnap, invoicesSnap, vDetailsSnap] = await Promise.all([
    db.collection('vendorLedger').get(),
    db.collection('vendorInvoices').get(),
    db.collection('vendorDetails').get(),
  ]);

  // Ledger net per vendor (signed: debits subtract).
  const ledgerByVendor = new Map();
  for (const doc of ledgerSnap.docs) {
    const e = doc.data();
    const dt = dateOf(e.date || e.transactionDate || e.createdAt);
    if (!inRange(dt)) continue;
    const signed = e.type === 'debit' ? -num(e.amount) : num(e.amount);
    ledgerByVendor.set(e.vendorId, (ledgerByVendor.get(e.vendorId) || 0) + signed);
  }

  // Vendor invoices per (vendorId, location).
  const invoicesByVendor = new Map();
  for (const doc of invoicesSnap.docs) {
    const inv = doc.data();
    const fromInv = String(inv.periodStart || '').slice(0, 10);
    const toInv = String(inv.periodEnd || '').slice(0, 10);
    if (fromInv !== fromYMD || toInv !== toYMD) continue;
    const vid = inv.vendorId;
    if (!vid) continue;
    const status = String(inv.status || 'pending').toLowerCase();
    const total = num(inv.totalAmount);
    const txns = num(inv.transactionCount) || (Array.isArray(inv.entries) ? inv.entries.length : 0);
    const acc = invoicesByVendor.get(vid) ?? { locked: 0, pending: 0, rows: [] };
    if (status === 'locked') acc.locked += total;
    else acc.pending += total;
    acc.rows.push({
      id: doc.id,
      status,
      total,
      txns,
      location: inv.locationId || '—',
    });
    invoicesByVendor.set(vid, acc);
  }

  // Vendor metadata for name display.
  const vendorName = new Map();
  for (const d of vDetailsSnap.docs) {
    const data = d.data() || {};
    vendorName.set(d.id, data.userName || data.vendorName || d.id);
  }

  // Union of vendors with either ledger or invoices in range.
  const allVendors = new Set([...ledgerByVendor.keys(), ...invoicesByVendor.keys()]);

  const rows = [];
  for (const vid of allVendors) {
    const owed = r2(ledgerByVendor.get(vid) || 0);
    const inv = invoicesByVendor.get(vid) ?? { locked: 0, pending: 0, rows: [] };
    const invTotal = r2(inv.locked + inv.pending);
    rows.push({
      vid,
      name: vendorName.get(vid) || vid,
      owed,
      locked: r2(inv.locked),
      pending: r2(inv.pending),
      invTotal,
      gap: invTotal - owed,
      invoiceRows: inv.rows,
    });
  }
  rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

  let totOwed = 0,
    totLocked = 0,
    totPending = 0;
  for (const r of rows) {
    totOwed += r.owed;
    totLocked += r.locked;
    totPending += r.pending;
  }

  console.log(
    `\n══════════════════════════════════════════════════════════════════════`,
  );
  console.log(`  Week payout reconciliation · ${fromYMD} → ${toYMD}`);
  console.log(
    `══════════════════════════════════════════════════════════════════════\n`,
  );
  console.log(`Ledger says you owe vendors this week : ₹${totOwed.toLocaleString('en-IN')}`);
  console.log(`Already locked (paid)                 : ₹${totLocked.toLocaleString('en-IN')}`);
  console.log(`Pending invoices                      : ₹${totPending.toLocaleString('en-IN')}`);
  console.log(`Invoice total (locked + pending)      : ₹${(totLocked + totPending).toLocaleString('en-IN')}`);
  console.log(
    `Net adjustment (invoice − owed)       : ₹${(totLocked + totPending - totOwed).toLocaleString('en-IN')}  ← positive means overpay`,
  );

  console.log('\nPer-vendor breakdown (sorted by gap magnitude):');
  console.log(
    '  vendorId      name                            owed     locked   pending  invTotal  gap     status',
  );
  for (const r of rows) {
    const tag =
      Math.abs(r.gap) <= 2
        ? 'OK'
        : r.gap > 0
          ? `OVER by ₹${r.gap}`
          : `UNDER by ₹${-r.gap}`;
    console.log(
      `  ${r.vid.padEnd(12)}  ${r.name.slice(0, 30).padEnd(30)}  ₹${String(r.owed).padStart(6)}  ₹${String(r.locked).padStart(6)}  ₹${String(r.pending).padStart(6)}  ₹${String(r.invTotal).padStart(6)}  ₹${String(r.gap).padStart(6)}  ${tag}`,
    );
    for (const inv of r.invoiceRows) {
      console.log(
        `     └─ invoice ${inv.id}  status=${inv.status}  loc=${inv.location}  total=₹${r2(inv.total)}  txns=${inv.txns}`,
      );
    }
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
