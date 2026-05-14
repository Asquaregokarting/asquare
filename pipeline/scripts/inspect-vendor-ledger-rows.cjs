/**
 * Dump every ledger row for a vendor in a date window so we can see
 * what type/source each row is, what amount, and whether it's linked
 * to a bookingId. Use when the vendor-audit script reports orphan
 * manual adjustments — this tells you what those adjustments actually
 * are.
 *
 * Usage:
 *   node scripts/inspect-vendor-ledger-rows.cjs 8712234222 2026-05-02 2026-05-08
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';

const vendorId = process.argv[2];
const fromYMD = process.argv[3];
const toYMD = process.argv[4];
if (!vendorId || !fromYMD || !toYMD) {
  console.error('Usage: node scripts/inspect-vendor-ledger-rows.cjs <vendorId> <fromYMD> <toYMD>');
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
  const snap = await db.collection('vendorLedger').where('vendorId', '==', vendorId).get();
  const rows = [];
  for (const doc of snap.docs) {
    const e = doc.data();
    const dt = dateOf(e.date || e.transactionDate || e.createdAt);
    if (!inRange(dt)) continue;
    rows.push({
      id: doc.id,
      date: dt,
      type: e.type || '',
      source: e.source || '',
      bookingId: e.bookingId || e.referenceId || '',
      amount: num(e.amount),
      reason: e.reason || '',
      vendorBase: num(e.vendorBase),
      vendorGst: num(e.vendorGst),
      createdAt: e.createdAt,
      createdBy: e.createdBy || e.createdByName || '',
    });
  }
  rows.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

  // Group by (type, source) for the headline summary.
  const byClass = new Map();
  for (const r of rows) {
    const k = `${r.type || '(no type)'} / ${r.source || '(no source)'}`;
    const acc = byClass.get(k) ?? { count: 0, sum: 0, withBooking: 0 };
    acc.count++;
    acc.sum += r.amount;
    if (r.bookingId) acc.withBooking++;
    byClass.set(k, acc);
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Vendor ${vendorId} · ledger rows · ${fromYMD} → ${toYMD}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  console.log(`Total rows: ${rows.length}, sum: ${r2(rows.reduce((s, r) => s + r.amount, 0))}\n`);
  console.log('By type/source:');
  for (const [k, v] of [...byClass.entries()].sort((a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum))) {
    console.log(
      `  ${k.padEnd(50)}  count=${String(v.count).padStart(3)}  sum=${String(r2(v.sum)).padStart(8)}  withBooking=${v.withBooking}`,
    );
  }

  console.log('\nFirst 30 rows:');
  console.log(
    '  date        type                     source                              amount    bookingId            reason',
  );
  for (const r of rows.slice(0, 30)) {
    console.log(
      `  ${r.date}  ${String(r.type).padEnd(22)} ${String(r.source).padEnd(34)} ${String(r2(r.amount)).padStart(7)}   ${String(r.bookingId || '—').padEnd(20)} ${(r.reason || '').slice(0, 60)}`,
    );
  }
  process.exit(0);
})().catch((err) => {
  console.error('Inspect failed:', err);
  process.exit(1);
});
