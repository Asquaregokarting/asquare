/**
 * Audit every locked vendor invoice — compare what was paid against what
 * the corrected ledger says it should have been.
 *
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 * Today's backfill (`backfill-event-package-vendor-credits.cjs`) added
 * historical event-package credits to `vendorLedger`. Some of those
 * credits land in date windows that have ALREADY been settled and locked
 * (cheque issued). For each locked invoice, we now want to know:
 *
 *   "If we re-ran the settlement today using the corrected ledger,
 *    would the cheque be the same? Or did the vendor get short-changed?"
 *
 * For each `vendorInvoices` doc with `status === 'locked'`:
 *   1. Sum every `vendorLedger` row for that (vendorId, periodStart..periodEnd)
 *      currently in Firestore: credits − debits.
 *   2. Compare to the doc's stored `totalAmount` (= paid amount).
 *   3. Print + CSV every (vendor, week) where the corrected total exceeds
 *      paid. These are top-up cheques you owe.
 *
 * Read-only. No flags except optional `--csv`.
 *
 * Usage:
 *   node scripts/audit-locked-settlement-underpayments.cjs
 *   node scripts/audit-locked-settlement-underpayments.cjs --csv reports/locked-underpayments.csv
 *   node scripts/audit-locked-settlement-underpayments.cjs --tolerance 1
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const CSV_PATH = argValue('--csv');
const TOLERANCE = Number(argValue('--tolerance') ?? '0');

const DATABASE_ID = 'asquare-app-db';
const VENDOR_INVOICES_COLLECTION = 'vendorInvoices';
const VENDOR_LEDGER_COLLECTION = 'vendorLedger';
const VENDOR_DETAILS_COLLECTION = 'vendorDetails';

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
  console.log(`\n┌─ locked settlement underpayment audit (read-only) ──────────────┐`);
  console.log(`│ database: ${DATABASE_ID}`);
  if (TOLERANCE > 0) console.log(`│ tolerance: ${inr(TOLERANCE)}`);
  console.log(`└─────────────────────────────────────────────────────────────────┘\n`);

  // 1. Load locked vendor invoices.
  const invoicesSnap = await db
    .collection(VENDOR_INVOICES_COLLECTION)
    .where('status', '==', 'locked')
    .get();
  console.log(`Loaded ${invoicesSnap.size} locked vendor invoice${invoicesSnap.size === 1 ? '' : 's'}.\n`);

  if (invoicesSnap.empty) {
    console.log('No locked invoices to audit.');
    process.exit(0);
  }

  // 2. Load vendor names.
  const vendorMeta = new Map();
  const vendorSnap = await db.collection(VENDOR_DETAILS_COLLECTION).get();
  vendorSnap.forEach((d) => {
    const data = d.data() || {};
    vendorMeta.set(d.id, {
      name: data.vendorName || data.userName || d.id,
      type: data.vendorType || 'ThirdParty',
      branch: data.branch || '',
    });
  });

  // 3. Load every ledger row once, group by vendorId.
  const allLedger = await db.collection(VENDOR_LEDGER_COLLECTION).get();
  const ledgerByVendor = new Map();
  allLedger.forEach((d) => {
    const r = d.data() || {};
    const vid = String(r.vendorId ?? '');
    if (!vid) return;
    const list = ledgerByVendor.get(vid) ?? [];
    list.push({
      day: dateOnly(r.date),
      amount: Number(r.amount) || 0,
      type: r.type,
      source: String(r.source ?? ''),
      referenceId: String(r.referenceId ?? ''),
    });
    ledgerByVendor.set(vid, list);
  });

  // 4. For each locked invoice, recompute the ledger total in its window.
  const findings = []; // { invoiceId, vendorId, vendorName, periodStart, periodEnd, paid, corrected, delta, chequeNumber, locationId }
  const matched = []; // ones that match exactly, for the ok summary
  invoicesSnap.forEach((d) => {
    const inv = d.data() || {};
    const vid = String(inv.vendorId ?? '');
    const periodStart = String(inv.periodStart ?? '');
    const periodEnd = String(inv.periodEnd ?? '');
    const paid = Number(inv.totalAmount) || 0;
    if (!vid || !periodStart || !periodEnd) return;

    const list = ledgerByVendor.get(vid) ?? [];
    let credits = 0;
    let debits = 0;
    let creditCount = 0;
    for (const row of list) {
      if (!row.day || row.day < periodStart || row.day > periodEnd) continue;
      if (row.type === 'credit') {
        credits += row.amount;
        creditCount++;
      } else if (row.type === 'debit') {
        debits += row.amount;
      }
    }
    const corrected = credits - debits;
    const delta = corrected - paid;

    if (Math.abs(delta) <= TOLERANCE) {
      matched.push({ vendorId: vid, periodStart, periodEnd, paid, corrected });
      return;
    }

    findings.push({
      invoiceId: d.id,
      vendorId: vid,
      vendorName: vendorMeta.get(vid)?.name ?? vid,
      branch: vendorMeta.get(vid)?.branch ?? '',
      periodStart,
      periodEnd,
      paid,
      corrected,
      delta,
      creditCount,
      paidCount: Number(inv.transactionCount) || 0,
      chequeNumber: inv.chequeNumber ? String(inv.chequeNumber) : '',
      locationId: inv.locationId ? String(inv.locationId) : '',
      lockedAt: inv.lockedAt ? String(inv.lockedAt) : '',
    });
  });

  // 5. Sort underpayments first (positive delta), then overpayments.
  findings.sort((a, b) => {
    if ((a.delta > 0) !== (b.delta > 0)) return a.delta > 0 ? -1 : 1;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });

  let totalUnderpaid = 0;
  let totalOverpaid = 0;
  let underpaidCount = 0;
  let overpaidCount = 0;
  for (const f of findings) {
    if (f.delta > 0) {
      totalUnderpaid += f.delta;
      underpaidCount++;
    } else {
      totalOverpaid += -f.delta;
      overpaidCount++;
    }
  }

  // 6. Per-vendor rollup of underpayments.
  const perVendor = new Map();
  for (const f of findings) {
    if (f.delta <= 0) continue;
    const acc = perVendor.get(f.vendorId) ?? { name: f.vendorName, branch: f.branch, weeks: 0, total: 0 };
    acc.weeks++;
    acc.total += f.delta;
    perVendor.set(f.vendorId, acc);
  }
  const vendorRows = [...perVendor.entries()].sort((a, b) => b[1].total - a[1].total);

  // 7. Print.
  console.log(`─── summary ─────────────────────────────────────────────`);
  console.log(`  Locked invoices audited        : ${invoicesSnap.size}`);
  console.log(`  Settled exactly                : ${matched.length}`);
  console.log(`  UNDERPAID (vendor owed money)  : ${underpaidCount}  total ${inr(totalUnderpaid)}`);
  console.log(`  OVERPAID  (vendor over-paid)   : ${overpaidCount}  total ${inr(totalOverpaid)}`);
  console.log(`  Net company exposure           : ${inr(totalUnderpaid - totalOverpaid)}\n`);

  if (vendorRows.length > 0) {
    console.log(`─── per-vendor underpayment rollup ──────────────────────`);
    console.log(pad('vendor', 28) + pad('id', 13) + pad('branch', 14) + padR('weeks', 7) + padR('owed', 12));
    console.log('─'.repeat(76));
    for (const [vid, acc] of vendorRows) {
      console.log(
        pad(acc.name.slice(0, 26), 28) + pad(vid, 13) + pad(acc.branch.slice(0, 12), 14) +
        padR(acc.weeks, 7) + padR(inr(acc.total), 12)
      );
    }
    console.log('─'.repeat(76));
    console.log(pad('TOTAL', 28) + pad('', 13) + pad('', 14) + padR(underpaidCount, 7) + padR(inr(totalUnderpaid), 12));
  }

  // 8. Per-row detail (top N).
  const SHOW_N = 50;
  console.log(`\n─── top ${Math.min(SHOW_N, findings.length)} per-week deltas ────────────────────`);
  console.log(
    pad('vendor', 24) + pad('week', 26) + pad('cheque', 10) +
    padR('paid', 11) + padR('correct', 11) + padR('delta', 11) + '  note'
  );
  console.log('─'.repeat(120));
  for (const f of findings.slice(0, SHOW_N)) {
    const note = f.delta > 0 ? `under (${f.creditCount} credits vs ${f.paidCount} paid)` : `over`;
    console.log(
      pad(f.vendorName.slice(0, 22), 24) +
      pad(`${f.periodStart}..${f.periodEnd}`, 26) +
      pad(f.chequeNumber, 10) +
      padR(inr(f.paid), 11) +
      padR(inr(f.corrected), 11) +
      padR((f.delta > 0 ? '+' : '') + inr(f.delta), 11) + '  ' + note
    );
  }
  if (findings.length > SHOW_N) {
    console.log(`  … and ${findings.length - SHOW_N} more rows (see CSV with --csv).`);
  }

  // 9. CSV export.
  if (CSV_PATH) {
    const dir = path.dirname(CSV_PATH);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = [
      'invoiceId,vendorId,vendorName,branch,locationId,periodStart,periodEnd,chequeNumber,paid,correctedTotal,delta,direction,paidBookings,correctedBookings,lockedAt',
    ];
    const cell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    for (const f of findings) {
      lines.push(
        [
          cell(f.invoiceId),
          f.vendorId,
          cell(f.vendorName),
          cell(f.branch),
          cell(f.locationId),
          f.periodStart,
          f.periodEnd,
          cell(f.chequeNumber),
          f.paid,
          f.corrected,
          f.delta,
          f.delta > 0 ? 'underpaid' : 'overpaid',
          f.paidCount,
          f.creditCount,
          cell(f.lockedAt),
        ].join(','),
      );
    }
    fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf-8');
    console.log(`\nCSV written: ${CSV_PATH}`);
  }

  console.log('\nRead-only run complete.\n');
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
