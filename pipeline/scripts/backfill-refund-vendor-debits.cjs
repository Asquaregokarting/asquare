/**
 * Backfill missing `type: debit` entries in the `vendorLedger` collection for
 * historical partial/full refunds.
 *
 * Why this is needed:
 *   billing-firestore.ts#refundSelectedItems only writes debit entries when
 *   item.vendorId and item.vendorTotal are present on the refunded item.
 *   Combo/group bookings don't carry those fields, so every refund on such a
 *   booking silently skipped debit writing. The result: vendor invoice totals
 *   for impacted weeks are overstated by the vendor share of refunded items.
 *
 * What this script does:
 *   1. Loads every booking with refundStatus in ['Partial','Full'] and
 *      refundAmount > 0.
 *   2. For each, reads existing `type: credit` ledger entries for that
 *      referenceId.
 *   3. Computes the debit per vendor using refundRatio = refundAmount /
 *      totalAmount, applied to each credit's vendorBase/vendorGst/amount.
 *   4. Skips any (transactionId, vendorId) pair that already has a
 *      `type: debit, source: refund` entry (idempotent — safe to re-run).
 *   5. Dry-runs by default. Pass --confirm to actually write.
 *
 * Usage:
 *   node scripts/backfill-refund-vendor-debits.cjs            # dry-run
 *   node scripts/backfill-refund-vendor-debits.cjs --confirm  # apply
 *
 * Optional scoping flags (match the deployed accounting week window):
 *   --from 2026-04-11 --to 2026-04-17
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── CLI ────────────────────────────────────────────────────────────────────
const CONFIRM = process.argv.includes('--confirm');
const DRY_RUN = !CONFIRM;
const tag = DRY_RUN ? '[DRY]' : '[RUN]';

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const FROM = argValue('--from'); // inclusive YYYY-MM-DD
const TO = argValue('--to');     // inclusive YYYY-MM-DD

// ─── Constants ──────────────────────────────────────────────────────────────
const DATABASE_ID = 'asquare-app-db';
const BOOKINGS_COLLECTION = 'bookings';
const LEDGER_COLLECTION = 'vendorLedger';

// ─── Admin SDK setup ────────────────────────────────────────────────────────
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

// ─── Helpers ────────────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString();

const dateStr = (data) => {
  const raw = data.transactionDate;
  if (!raw) return null;
  if (typeof raw === 'object' && typeof raw.toDate === 'function') {
    try { return raw.toDate().toISOString().slice(0, 10); } catch { return null; }
  }
  const s = String(raw);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const inRange = (d) => {
  if (!d) return !FROM && !TO;
  if (FROM && d < FROM) return false;
  if (TO && d > TO) return false;
  return true;
};

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n${DRY_RUN ? 'DRY-RUN' : 'REAL RUN'} — backfill vendor-ledger refund debits`);
  if (FROM || TO) console.log(`  scope: ${FROM ?? '-∞'} .. ${TO ?? '+∞'}`);
  console.log();

  // 1. Load every booking with a non-trivial refund.
  const [partialSnap, fullSnap] = await Promise.all([
    db.collection(BOOKINGS_COLLECTION).where('refundStatus', '==', 'Partial').get(),
    db.collection(BOOKINGS_COLLECTION).where('refundStatus', '==', 'Full').get(),
  ]);

  const bookings = [];
  for (const snap of [partialSnap, fullSnap]) {
    snap.forEach((d) => {
      const data = d.data();
      const refundAmount = Number(data.refundAmount ?? 0);
      const totalAmount = Number(data.totalAmount ?? 0);
      if (!(refundAmount > 0) || !(totalAmount > 0)) return;
      if (!inRange(dateStr(data))) return;
      bookings.push({ id: d.id, data });
    });
  }

  console.log(`Loaded ${bookings.length} refunded bookings in scope.`);

  // 2. Examine each booking's existing ledger entries, plan debits.
  const plan = []; // { bookingId, vendorId, vendorBase, vendorGst, amount, locationId, date, invoiceNumber }
  let alreadyBackfilledCount = 0;
  let noCreditCount = 0;

  for (const { id, data } of bookings) {
    const refundAmount = Number(data.refundAmount ?? 0);
    const totalAmount = Number(data.totalAmount ?? 0);
    const refundRatio = refundAmount / totalAmount;

    const ledgerSnap = await db
      .collection(LEDGER_COLLECTION)
      .where('referenceId', '==', id)
      .get();

    const creditsByVendor = new Map(); // vid → { vendorBase, vendorGst, amount }
    const existingDebitVids = new Set();

    ledgerSnap.forEach((ld) => {
      const row = ld.data();
      const vid = String(row.vendorId ?? '');
      if (!vid) return;
      if (row.type === 'credit') {
        const acc = creditsByVendor.get(vid) ?? { vendorBase: 0, vendorGst: 0, amount: 0 };
        acc.vendorBase += Number(row.vendorBase ?? 0);
        acc.vendorGst  += Number(row.vendorGst  ?? 0);
        acc.amount     += Number(row.amount     ?? 0);
        creditsByVendor.set(vid, acc);
      } else if (row.type === 'debit' && row.source === 'refund') {
        existingDebitVids.add(vid);
      }
    });

    if (creditsByVendor.size === 0) {
      noCreditCount++;
      continue;
    }

    for (const [vid, totals] of creditsByVendor) {
      if (existingDebitVids.has(vid)) { alreadyBackfilledCount++; continue; }
      const vendorBase  = Math.round(totals.vendorBase * refundRatio);
      const vendorGst   = Math.round(totals.vendorGst  * refundRatio);
      const vendorTotal = Math.round(totals.amount     * refundRatio);
      if (vendorTotal <= 0) continue;
      plan.push({
        bookingId: id,
        vendorId: vid,
        vendorBase,
        vendorGst,
        amount: vendorTotal,
        locationId: String(data.locationId ?? ''),
        date: String(data.transactionDate ?? ''),
        invoiceNumber: String(data.invoiceNumber ?? id),
      });
    }
  }

  // 3. Summary.
  console.log(`\nPlanned debit writes: ${plan.length}`);
  console.log(`Already-backfilled (vid,txn) pairs skipped: ${alreadyBackfilledCount}`);
  console.log(`Bookings with no credit entries (cannot backfill): ${noCreditCount}`);

  const perVendor = new Map();
  let grandTotal = 0;
  for (const p of plan) {
    perVendor.set(p.vendorId, (perVendor.get(p.vendorId) ?? 0) + p.amount);
    grandTotal += p.amount;
  }

  console.log(`\nTotal debit amount to write: ₹${grandTotal.toLocaleString('en-IN')}`);
  console.log(`\nPer-vendor debit totals:`);
  const sortedVendors = [...perVendor.entries()].sort((a, b) => b[1] - a[1]);
  for (const [vid, amt] of sortedVendors) {
    console.log(`  ${vid.padEnd(14)}  ₹${amt.toLocaleString('en-IN').padStart(8)}`);
  }

  if (DRY_RUN) {
    console.log(`\n${tag} dry-run complete. Re-run with --confirm to write.`);
    process.exit(0);
  }

  // 4. Execute.
  console.log(`\n${tag} writing ${plan.length} ledger debit entries...`);
  const timestamp = Date.now();
  let written = 0;
  for (const p of plan) {
    const ledgerId = `le-refund-${p.bookingId}-${p.vendorId}-${timestamp}`;
    await db.collection(LEDGER_COLLECTION).doc(ledgerId).set({
      id: ledgerId,
      vendorId: p.vendorId,
      vendorBase: p.vendorBase,
      vendorGst: p.vendorGst,
      amount: p.amount,
      type: 'debit',
      referenceId: p.bookingId,
      invoiceNumber: p.invoiceNumber,
      locationId: p.locationId,
      date: p.date,
      createdAt: nowIso(),
      source: 'refund',
      backfilledBy: 'backfill-refund-vendor-debits.cjs',
    });
    written++;
    if (written % 25 === 0) console.log(`  ...${written}/${plan.length}`);
  }

  console.log(`\n${tag} done. Wrote ${written} debit entries totalling ₹${grandTotal.toLocaleString('en-IN')}.`);
  console.log(`\nNext: open the Accounting module — checkInvoicesStale will detect the new debits`);
  console.log(`and regenerate pending invoices. Locked invoices are immutable by design.`);
  process.exit(0);
})().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
