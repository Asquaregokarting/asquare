/**
 * Compute a vendor's correct ledger credit for a date range, after all
 * applied corrections. Compare against a known paid amount to surface
 * any underpayment from a locked settlement.
 *
 * Usage:
 *   node scripts/inspect-vendor-week-credit.cjs <vendorId> <fromYYYY-MM-DD> <toYYYY-MM-DD> [paidAmount]
 *
 * Example:
 *   node scripts/inspect-vendor-week-credit.cjs 9985526034 2026-04-04 2026-04-10 46247
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const [, , VENDOR_ID, FROM, TO, PAID_RAW] = process.argv;
if (!VENDOR_ID || !FROM || !TO) {
  console.error('Usage: node scripts/inspect-vendor-week-credit.cjs <vendorId> <from> <to> [paid]');
  process.exit(1);
}
const PAID = PAID_RAW ? Number(PAID_RAW) : null;

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
  console.log(`\n┌─ vendor week credit audit ────────────────────────────────────┐`);
  console.log(`│ vendor:    ${VENDOR_ID}`);
  console.log(`│ window:    ${FROM} to ${TO}`);
  if (PAID !== null) console.log(`│ paid:      ${inr(PAID)}`);
  console.log(`└────────────────────────────────────────────────────────────────┘\n`);

  // Vendor metadata
  const vSnap = await db.collection('vendorDetails').doc(VENDOR_ID).get();
  const vData = vSnap.exists ? vSnap.data() || {} : {};
  console.log(`Vendor: ${vData.vendorName || vData.userName || '(unknown)'}  type=${vData.vendorType || '?'}  branch=${vData.branch || '?'}\n`);

  const ledgerSnap = await db
    .collection('vendorLedger')
    .where('vendorId', '==', VENDOR_ID)
    .get();

  const credits = [];
  const debits = [];
  let creditTotal = 0;
  let creditBase = 0;
  let creditGst = 0;
  let debitTotal = 0;
  ledgerSnap.forEach((d) => {
    const r = d.data() || {};
    const day = dateOnly(r.date);
    if (!day || day < FROM || day > TO) return;
    const amount = Number(r.amount) || 0;
    if (r.type === 'credit') {
      credits.push({ id: d.id, day, amount, base: Number(r.vendorBase)||0, gst: Number(r.vendorGst)||0, source: r.source || '', referenceId: r.referenceId || '' });
      creditTotal += amount;
      creditBase += Number(r.vendorBase)||0;
      creditGst += Number(r.vendorGst)||0;
    } else if (r.type === 'debit') {
      debits.push({ id: d.id, day, amount, source: r.source || '', referenceId: r.referenceId || '' });
      debitTotal += amount;
    }
  });

  credits.sort((a, b) => a.day.localeCompare(b.day) || a.referenceId.localeCompare(b.referenceId));
  debits.sort((a, b) => a.day.localeCompare(b.day) || a.referenceId.localeCompare(b.referenceId));

  console.log(`─── credits (${credits.length} rows) ─────────────────────`);
  console.log(pad('date', 12) + pad('booking', 25) + padR('base', 10) + padR('gst', 10) + padR('total', 12) + '  source');
  console.log('─'.repeat(85));
  for (const c of credits) {
    console.log(pad(c.day, 12) + pad(c.referenceId, 25) + padR(inr(c.base), 10) + padR(inr(c.gst), 10) + padR(inr(c.amount), 12) + '  ' + c.source);
  }
  console.log('─'.repeat(85));
  console.log(pad('TOTAL', 12) + pad('', 25) + padR(inr(creditBase), 10) + padR(inr(creditGst), 10) + padR(inr(creditTotal), 12));

  if (debits.length > 0) {
    console.log(`\n─── debits (${debits.length} rows) ─────────────────────`);
    for (const d of debits) {
      console.log(pad(d.day, 12) + pad(d.referenceId, 25) + padR(inr(d.amount), 12) + '  ' + d.source);
    }
    console.log('─'.repeat(50));
    console.log(pad('TOTAL', 12) + pad('', 25) + padR(inr(debitTotal), 12));
  }

  const net = creditTotal - debitTotal;
  console.log(`\n─── summary ─────────────────────────────────────────`);
  console.log(`  Credits        : ${inr(creditTotal)}`);
  console.log(`  Debits         : ${inr(debitTotal)}`);
  console.log(`  Net (correct)  : ${inr(net)}`);

  if (PAID !== null) {
    const delta = net - PAID;
    console.log(`  Paid (cheque)  : ${inr(PAID)}`);
    console.log(`  ────────────────────────────────`);
    if (delta > 0) {
      console.log(`  UNDERPAID by   : ${inr(delta)}  ← owe vendor`);
    } else if (delta < 0) {
      console.log(`  OVERPAID by    : ${inr(-delta)}  ← deduct from next payout`);
    } else {
      console.log(`  Settled exactly`);
    }
  }

  console.log('\n');
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
