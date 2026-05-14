/**
 * Diagnose why specific bookings show under "unknown" on GameRevenue,
 * and check whether any vendor was credited for them.
 *
 * "Unknown" classification fires in `aggregateGameRevenue` when an
 * item's `gameId` field is missing/empty — the aggregator falls back to
 * the literal string `'unknown'`. Vendor-side aggregation also relies on
 * `item.vendorId`, which is independent: a booking can be (a) classified
 * as 'unknown' by the aggregator yet still have vendor credits, or
 * (b) classified correctly yet have no credits, or both.
 *
 * Usage:
 *   node scripts/inspect-unknown-bookings.cjs <bookingId> [<bookingId> ...]
 *   node scripts/inspect-unknown-bookings.cjs --sweep                # find every booking with at least one unknown item
 *   node scripts/inspect-unknown-bookings.cjs --sweep --csv reports/unknown-bookings.csv
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const SWEEP = process.argv.includes('--sweep');
const CSV_PATH = argValue('--csv');
// Walk argv keeping only true positional args. Skip flags (--sweep) AND the
// VALUES that follow value-bearing flags (--csv <path>) so they don't get
// mistaken for booking IDs.
const VALUE_FLAGS = new Set(['--csv']);
const ids = [];
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a)) i++; // skip the value too
      continue;
    }
    ids.push(a);
  }
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

const isUnknown = (v) => {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'unknown';
};

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

const inspectBooking = async (id) => {
  const snap = await db.collection('bookings').doc(id).get();
  if (!snap.exists) {
    console.log(`\n══ ${id} ══════════════════════════════════════════════`);
    console.log('  Booking not found.');
    return null;
  }
  const data = snap.data() || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const billingItems = Array.isArray(data.billingItems) ? data.billingItems : [];

  console.log(`\n══ ${id} ══════════════════════════════════════════════`);
  console.log(`  date: ${dateOnly(data.transactionDate ?? data.createdAt)}    source: ${data.source ?? '?'}    location: ${data.locationId ?? '?'}    paymentStatus: ${data.paymentStatus ?? '?'}`);
  console.log(`  finalAmount: ${inr(Number(data.finalAmount ?? data.totalAmount ?? 0))}    top-level vendorId: ${data.vendorId ?? '(none)'}    vendorIds: ${JSON.stringify(data.vendorIds ?? null)}`);

  console.log(`\n  items[] (${items.length}):`);
  console.log('    ' + pad('itemName', 50) + pad('gameId', 18) + pad('subGameId', 18) + pad('variantId', 22) + 'vendorId');
  console.log('    ' + '─'.repeat(120));
  let unknownItemCount = 0;
  for (const it of items) {
    if (!it) continue;
    const itemName = (typeof it.itemName === 'string' ? it.itemName : (it.activity?.name ?? '')).slice(0, 48);
    const gameId = it.gameId ?? '';
    if (isUnknown(gameId)) unknownItemCount++;
    console.log('    ' + pad(itemName, 50) + pad(gameId || '(none)', 18) + pad(it.subGameId || '(none)', 18) + pad(it.variantId || '(none)', 22) + (it.vendorId || '(none)'));
  }

  console.log(`\n  billingItems[] (${billingItems.length}):`);
  console.log('    ' + pad('itemName', 50) + pad('gameId', 18) + pad('vendorId', 14) + padR('qty', 6) + padR('unit', 9) + padR('vendorTotal', 12));
  console.log('    ' + '─'.repeat(110));
  for (const bi of billingItems) {
    if (!bi) continue;
    console.log('    ' + pad((bi.itemName ?? '').slice(0, 48), 50) + pad(bi.gameId || '(none)', 18) + pad(bi.vendorId || '(none)', 14) + padR(bi.quantity ?? 0, 6) + padR(inr(Number(bi.unitPrice) || 0), 9) + padR(inr(Number(bi.vendorTotal) || 0), 12));
  }

  // Ledger entries for this booking.
  const ledgerSnap = await db.collection('vendorLedger').where('referenceId', '==', id).get();
  if (ledgerSnap.empty) {
    console.log(`\n  vendorLedger: NO entries for this booking. NO vendor was credited.`);
  } else {
    console.log(`\n  vendorLedger entries (${ledgerSnap.size}):`);
    console.log('    ' + pad('vendorId', 14) + pad('type', 8) + pad('source', 18) + padR('amount', 12));
    console.log('    ' + '─'.repeat(70));
    ledgerSnap.forEach((d) => {
      const r = d.data() || {};
      console.log('    ' + pad(r.vendorId ?? '?', 14) + pad(r.type ?? '?', 8) + pad(r.source ?? '?', 18) + padR(inr(Number(r.amount) || 0), 12));
    });
  }

  return { id, unknownItemCount, totalItems: items.length, hasLedger: !ledgerSnap.empty, ledgerCount: ledgerSnap.size };
};

(async () => {
  console.log(`\n┌─ unknown-bookings diagnostic (read-only) ───────────────────┐\n`);

  if (ids.length > 0) {
    for (const id of ids) {
      await inspectBooking(id);
    }
  }

  if (SWEEP) {
    console.log(`\n══ SWEEP — every booking with >=1 'unknown' item ══════════════\n`);
    const snap = await db.collection('bookings').get();
    const findings = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      if (data.cancelled === true) return;
      if (data.paymentStatus && data.paymentStatus !== 'completed') return;
      const items = Array.isArray(data.items) ? data.items : [];
      const billing = Array.isArray(data.billingItems) ? data.billingItems : [];
      const source = billing.length > 0 ? billing : items;
      let unknownCount = 0;
      const unknownNames = [];
      for (const it of source) {
        if (!it) continue;
        if (isUnknown(it.gameId)) {
          unknownCount++;
          if (unknownNames.length < 3) unknownNames.push((it.itemName ?? it.activity?.name ?? '').slice(0, 30));
        }
      }
      if (unknownCount === 0) return;
      findings.push({
        id: d.id,
        date: dateOnly(data.transactionDate ?? data.createdAt),
        source: data.source ?? '',
        finalAmount: Number(data.finalAmount ?? data.totalAmount ?? 0),
        unknownCount,
        totalItems: source.length,
        unknownNames,
        vendorIds: Array.isArray(data.vendorIds) ? data.vendorIds : [],
      });
    });

    findings.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`Found ${findings.length} bookings with at least one 'unknown' item.\n`);

    // Cross-reference with vendorLedger for each.
    console.log(pad('bookingId', 26) + pad('date', 12) + pad('source', 8) + padR('final', 11) + padR('unknown/total', 16) + pad('vendorIds', 35) + 'sample item');
    console.log('─'.repeat(140));
    for (const f of findings.slice(0, 80)) {
      const sample = f.unknownNames[0] || '';
      const vidStr = f.vendorIds.length > 0 ? f.vendorIds.slice(0, 2).join(',') + (f.vendorIds.length > 2 ? `,+${f.vendorIds.length - 2}` : '') : '(none)';
      console.log(
        pad(f.id, 26) + pad(f.date, 12) + pad(f.source, 8) +
        padR(inr(f.finalAmount), 11) + padR(`${f.unknownCount}/${f.totalItems}`, 16) +
        pad(vidStr.slice(0, 33), 35) + sample
      );
    }
    if (findings.length > 80) console.log(`  ... ${findings.length - 80} more`);

    // Per-vendor + completely-unattributed counts.
    let unattributed = 0;
    const perVendor = new Map();
    for (const f of findings) {
      if (f.vendorIds.length === 0) {
        unattributed++;
      } else {
        for (const vid of f.vendorIds) {
          perVendor.set(vid, (perVendor.get(vid) ?? 0) + 1);
        }
      }
    }
    console.log(`\n─── breakdown ──────────────────────────────────────────`);
    console.log(`  bookings with no vendorIds at all : ${unattributed} (these are TRULY orphaned — no vendor will ever see them)`);
    console.log(`  bookings with ≥1 vendor          : ${findings.length - unattributed}`);
    if (perVendor.size > 0) {
      const sorted = [...perVendor.entries()].sort((a, b) => b[1] - a[1]);
      console.log(`\n  unknown-item bookings PER VENDOR (these will appear under 'unknown' on that vendor's GameRevenue page):`);
      for (const [vid, n] of sorted) console.log(`    ${vid}: ${n} bookings`);
    }

    if (CSV_PATH) {
      const dir = path.dirname(CSV_PATH);
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const lines = ['bookingId,date,source,finalAmount,unknownCount,totalItems,vendorIds,sampleItem'];
      const cell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      for (const f of findings) {
        lines.push([
          f.id, f.date, f.source, f.finalAmount, f.unknownCount, f.totalItems,
          cell(f.vendorIds.join('|')), cell(f.unknownNames.join(' | '))
        ].join(','));
      }
      fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf-8');
      console.log(`\nCSV written: ${CSV_PATH}`);
    }
  }

  console.log('\nRead-only run complete.\n');
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
