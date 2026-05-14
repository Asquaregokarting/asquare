/**
 * For each vendor, look for ledger rows that share (vendorId, date,
 * amount). True duplicates show as count >= 2 in the same group. This
 * tells us whether the over-credit pattern is from duplicate trigger
 * writes vs. some other cause.
 *
 * Usage:
 *   node scripts/inspect-ledger-duplicates.cjs <vendorId> <fromYMD> <toYMD>
 *   node scripts/inspect-ledger-duplicates.cjs 8712234222 2026-05-02 2026-05-08
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';

const vendorId = process.argv[2];
const fromYMD = process.argv[3];
const toYMD = process.argv[4];
if (!vendorId || !fromYMD || !toYMD) {
  console.error('Usage: node scripts/inspect-ledger-duplicates.cjs <vendorId> <fromYMD> <toYMD>');
  process.exit(1);
}

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
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
      amount: num(e.amount),
      type: e.type || '',
      source: e.source || '',
      bookingId: e.bookingId || '',
      createdAt: e.createdAt ? (typeof e.createdAt === 'string' ? e.createdAt : (e.createdAt.toDate && e.createdAt.toDate().toISOString())) : '',
    });
  }

  // Group by (date, amount) — duplicates would have same date and same amount
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.date}::${r.amount}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  const dupes = [];
  let singletons = 0;
  for (const [k, arr] of groups) {
    if (arr.length >= 2) dupes.push({ key: k, rows: arr });
    else singletons++;
  }

  const totalSurplus = dupes.reduce(
    (s, g) => s + (g.rows.length - 1) * g.rows[0].amount,
    0,
  );

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Ledger duplicates for ${vendorId} · ${fromYMD} → ${toYMD}`);
  console.log('══════════════════════════════════════════════════════════════\n');
  console.log(`Total rows: ${rows.length}`);
  console.log(`Unique (date+amount) groups: ${groups.size}`);
  console.log(`Singletons: ${singletons}`);
  console.log(`Duplicate groups (count >= 2): ${dupes.length}`);
  console.log(
    `If we kept only 1 per duplicate group, surplus removed would be: ₹${Math.round(totalSurplus)}`,
  );

  if (dupes.length > 0) {
    console.log('\nDuplicate groups (date::amount → all matching ledger row IDs):');
    dupes.sort((a, b) => b.rows.length - a.rows.length || b.rows[0].amount - a.rows[0].amount);
    for (const g of dupes.slice(0, 30)) {
      const [date, amount] = g.key.split('::');
      console.log(
        `  ${date}  ₹${amount.padStart(5)}  ×${g.rows.length}  IDs: ${g.rows.map((r) => r.id).join(', ').slice(0, 110)}${g.rows.length > 4 ? '…' : ''}`,
      );
    }
  }

  process.exit(0);
})().catch((err) => {
  console.error('Inspect failed:', err);
  process.exit(1);
});
