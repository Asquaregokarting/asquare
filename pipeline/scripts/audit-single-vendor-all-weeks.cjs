/**
 * Per-week audit for ONE vendor across every invoice (locked + pending +
 * draft) AND every distinct period found in the ledger.
 *
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 * `audit-locked-settlement-underpayments.cjs` only audits invoices whose
 * status === 'locked'. If a discrepancy lives in a draft/pending invoice
 * — or in a week that has ledger entries but no invoice generated yet —
 * it never appears. Use this when a specific vendor reports a number that
 * isn't in the locked CSV.
 *
 * Usage:
 *   node scripts/audit-single-vendor-all-weeks.cjs <vendorId>
 *   node scripts/audit-single-vendor-all-weeks.cjs 7777997226
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const VENDOR_ID = process.argv[2];
if (!VENDOR_ID) {
  console.error('Usage: node scripts/audit-single-vendor-all-weeks.cjs <vendorId>');
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
  console.log(`\n┌─ all-weeks audit for vendor ${VENDOR_ID} ─────────────────────┐\n`);

  const vSnap = await db.collection('vendorDetails').doc(VENDOR_ID).get();
  const vData = vSnap.exists ? vSnap.data() || {} : {};
  console.log(`Vendor: ${vData.vendorName || vData.userName || VENDOR_ID}`);
  console.log(`Type:   ${vData.vendorType || '?'}    Branch: ${vData.branch || '?'}    Share: ${vData.revenueShare ?? '?'}%\n`);

  // 1. Pull every vendorInvoice for this vendor.
  const invSnap = await db
    .collection('vendorInvoices')
    .where('vendorId', '==', VENDOR_ID)
    .get();
  const invoices = [];
  invSnap.forEach((d) => {
    const data = d.data() || {};
    invoices.push({
      id: d.id,
      status: String(data.status ?? 'draft'),
      periodStart: String(data.periodStart ?? ''),
      periodEnd: String(data.periodEnd ?? ''),
      totalAmount: Number(data.totalAmount) || 0,
      transactionCount: Number(data.transactionCount) || 0,
      chequeNumber: data.chequeNumber ? String(data.chequeNumber) : '',
      locationId: data.locationId ? String(data.locationId) : '',
      lockedAt: data.lockedAt ? String(data.lockedAt) : '',
      generatedAt: data.generatedAt ? String(data.generatedAt) : '',
    });
  });
  console.log(`Found ${invoices.length} vendorInvoice document(s).\n`);

  // 2. Pull every ledger row for this vendor.
  const ledSnap = await db
    .collection('vendorLedger')
    .where('vendorId', '==', VENDOR_ID)
    .get();
  const ledger = [];
  ledSnap.forEach((d) => {
    const r = d.data() || {};
    ledger.push({
      id: d.id,
      day: dateOnly(r.date),
      type: String(r.type ?? ''),
      amount: Number(r.amount) || 0,
      source: String(r.source ?? ''),
      referenceId: String(r.referenceId ?? ''),
      locationId: r.locationId ? String(r.locationId) : '',
    });
  });
  ledger.sort((a, b) => a.day.localeCompare(b.day));
  console.log(`Found ${ledger.length} vendorLedger row(s).\n`);

  // Helper: sum a window from the ledger, optionally narrowed by location.
  const sumWindow = (start, end, locationId) => {
    let credits = 0;
    let debits = 0;
    let creditCount = 0;
    for (const r of ledger) {
      if (!r.day || r.day < start || r.day > end) continue;
      if (locationId && r.locationId && r.locationId !== locationId) continue;
      if (r.type === 'credit') {
        credits += r.amount;
        creditCount++;
      } else if (r.type === 'debit') {
        debits += r.amount;
      }
    }
    return { credits, debits, net: credits - debits, creditCount };
  };

  // 3. Per-invoice deltas.
  invoices.sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.locationId.localeCompare(b.locationId));
  console.log(`─── per-invoice (any status) ───────────────────────────────────`);
  console.log(
    pad('period', 26) + pad('loc', 5) + pad('status', 9) + pad('cheque', 10) +
    padR('paid', 11) + padR('correct', 11) + padR('delta', 11)
  );
  console.log('─'.repeat(102));
  for (const inv of invoices) {
    const { net, creditCount } = sumWindow(inv.periodStart, inv.periodEnd, inv.locationId || undefined);
    const delta = net - inv.totalAmount;
    const tag = delta === 0 ? '' : delta > 0 ? ' under' : ' over';
    console.log(
      pad(`${inv.periodStart}..${inv.periodEnd}`, 26) +
      pad(inv.locationId || '-', 5) +
      pad(inv.status, 9) +
      pad(inv.chequeNumber || '-', 10) +
      padR(inr(inv.totalAmount), 11) +
      padR(inr(net), 11) +
      padR((delta > 0 ? '+' : '') + inr(delta), 11) +
      tag + ` (${creditCount} credits)`
    );
  }

  // 4. Ledger weeks NOT covered by any invoice.
  console.log(`\n─── ledger weeks with no invoice ───────────────────────────────`);
  const weekKey = (day) => {
    // Saturday-anchored week (matches existing settlements scheme — see
    // accounting-firestore.ts:getPeriodStart).
    const d = new Date(`${day}T00:00:00Z`);
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    const offset = (dow + 1) % 7; // days since Saturday
    d.setUTCDate(d.getUTCDate() - offset);
    const start = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 6);
    const end = d.toISOString().slice(0, 10);
    return { start, end };
  };
  const invoicedWeeks = new Set(invoices.map((i) => `${i.periodStart}::${i.periodEnd}::${i.locationId || ''}`));
  const weekTotals = new Map(); // key → { start, end, locationId, amount, count }
  for (const r of ledger) {
    if (!r.day) continue;
    const w = weekKey(r.day);
    const k = `${w.start}::${w.end}::${r.locationId || ''}`;
    const acc = weekTotals.get(k) ?? { start: w.start, end: w.end, locationId: r.locationId || '', amount: 0, count: 0 };
    if (r.type === 'credit') {
      acc.amount += r.amount;
      acc.count++;
    } else if (r.type === 'debit') {
      acc.amount -= r.amount;
    }
    weekTotals.set(k, acc);
  }
  const orphanWeeks = [...weekTotals.entries()].filter(([k]) => !invoicedWeeks.has(k));
  if (orphanWeeks.length === 0) {
    console.log('  (every ledger week is covered by an invoice)');
  } else {
    for (const [, w] of orphanWeeks.sort((a, b) => a[1].start.localeCompare(b[1].start))) {
      console.log(
        pad(`${w.start}..${w.end}`, 26) +
        pad(w.locationId || '-', 5) +
        pad('—', 9) + pad('—', 10) +
        padR('—', 11) +
        padR(inr(w.amount), 11) +
        '  ' + w.count + ' credits'
      );
    }
  }

  // 5. Look for any single delta that matches the ₹792 the user mentioned.
  console.log(`\n─── search: deltas matching ₹792 (target user flagged) ────────`);
  let foundMatch = false;
  for (const inv of invoices) {
    const { net } = sumWindow(inv.periodStart, inv.periodEnd, inv.locationId || undefined);
    const delta = net - inv.totalAmount;
    if (Math.abs(delta) === 792 || Math.abs(delta - 792) < 2) {
      foundMatch = true;
      console.log(`  invoice ${inv.id}  (${inv.periodStart}..${inv.periodEnd}, status=${inv.status}, loc=${inv.locationId})  delta=${inr(delta)}`);
    }
  }
  for (const [, w] of orphanWeeks) {
    if (Math.abs(w.amount) === 792 || Math.abs(w.amount - 792) < 2) {
      foundMatch = true;
      console.log(`  orphan week ${w.start}..${w.end}  loc=${w.locationId || '-'}  ledger total=${inr(w.amount)}`);
    }
  }
  if (!foundMatch) {
    console.log('  No invoice delta or orphan-week ledger total of ₹792. The ₹792 is likely:');
    console.log('   • a single ledger row (booking-level credit) — check the ledger above for a row with amount ≈ ₹792');
    console.log('   • or coming from a different report surface (e.g. settlements view re-derives totals from billingItems).');
  }

  // 6. Single-row ledger entries near 792.
  console.log(`\n─── ledger rows with amount near ₹792 ─────────────────────────`);
  const near792 = ledger.filter((r) => Math.abs(r.amount - 792) < 5 || Math.abs(r.amount + 792) < 5);
  if (near792.length === 0) console.log('  (none)');
  else {
    for (const r of near792) {
      console.log(
        pad(r.day, 12) + pad(r.type, 8) + pad(r.referenceId, 26) + pad(r.source, 18) + padR(inr(r.amount), 11)
      );
    }
  }

  console.log('\nRead-only run complete.\n');
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
