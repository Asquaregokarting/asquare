/**
 * Apply per-vendor refund-debit corrections derived from item-level truth.
 *
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 * `backfill-refund-vendor-debits.cjs` debited every vendor proportionally
 * to refundAmount, but the live refund path correctly attributes refunds
 * by walking `items[].refunded === true` and summing per-vendor totals.
 *
 * `scripts/reconcile-vendor-refund-debits.cjs` already prints the deltas:
 *   - positive delta → vendor was UNDER-debited → DEDUCT from next payout
 *   - negative delta → vendor was OVER-debited  → ADD to next payout
 *
 * This script writes those corrections to `vendorLedger` as a single
 * `refund-correction` entry per (booking, vendor), idempotent by composite
 * doc id `lc-{bookingId}-{vendorId}`. A second run with the same deltas
 * sees the existing doc and rewrites the same data (effectively a no-op).
 * Re-running after the underlying booking changes simply rewrites the doc
 * to reflect current truth.
 *
 * Read-only by default. Pass `--apply` to write.
 *
 * Usage:
 *   node scripts/apply-vendor-refund-corrections.cjs                  # dry-run
 *   node scripts/apply-vendor-refund-corrections.cjs --apply
 *   node scripts/apply-vendor-refund-corrections.cjs --booking ASG... # one booking only
 *   node scripts/apply-vendor-refund-corrections.cjs --tolerance 1    # |delta| <= 1 → ignore
 *   node scripts/apply-vendor-refund-corrections.cjs --csv reports/refund-corrections-applied.csv
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const APPLY = process.argv.includes('--apply');
const SINGLE = argValue('--booking');
const CSV_PATH = argValue('--csv');
const TOLERANCE = Number(argValue('--tolerance') ?? '0');

const DATABASE_ID = 'asquare-app-db';
const BOOKINGS_COLLECTION = 'bookings';
const LEDGER_COLLECTION = 'vendorLedger';
const REFUND_DEBIT_SOURCES = new Set([
  'refund',
  'refund-correction',
  'refund-correction-reversal',
]);

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
const nowIso = () => new Date().toISOString();

const dateStr = (data) => {
  const raw = data.transactionDate ?? data.createdAt ?? data.sessionDate;
  if (!raw) return nowIso();
  if (typeof raw === 'object' && typeof raw.toDate === 'function') {
    try {
      return raw.toDate().toISOString();
    } catch {
      return nowIso();
    }
  }
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00.000Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? nowIso() : d.toISOString();
};

// Compute correct per-vendor debit for a booking. Mirrors logic in
// reconcile-vendor-refund-debits.cjs.
const computeCorrectDebits = (booking) => {
  const items = Array.isArray(booking.items) ? booking.items : [];
  const billingItems = Array.isArray(booking.billingItems) ? booking.billingItems : [];

  const attribution = new Map();
  for (const b of billingItems) {
    if (!b) continue;
    const variantId = String(b.variantId ?? '');
    if (!variantId) continue;
    attribution.set(variantId, {
      vendorId: String(b.vendorId ?? ''),
      vendorBase: Number(b.vendorBase ?? 0),
      vendorGst: Number(b.vendorGst ?? 0),
      vendorTotal: Number(b.vendorTotal ?? 0),
    });
  }

  const debits = new Map();
  for (const item of items) {
    if (item?.refunded !== true) continue;
    let vendorId = String(item.vendorId ?? '');
    let vendorBase = Number(item.vendorBase ?? 0);
    let vendorGst = Number(item.vendorGst ?? 0);
    let vendorTotal = Number(item.vendorTotal ?? 0);
    if (!vendorId || vendorTotal <= 0) {
      const attr = attribution.get(String(item.variantId ?? ''));
      if (attr) {
        vendorId = attr.vendorId;
        vendorBase = attr.vendorBase;
        vendorGst = attr.vendorGst;
        vendorTotal = attr.vendorTotal;
      }
    }
    if (!vendorId || vendorTotal <= 0) continue;
    const acc = debits.get(vendorId) ?? { vendorBase: 0, vendorGst: 0, vendorTotal: 0 };
    acc.vendorBase += vendorBase;
    acc.vendorGst += vendorGst;
    acc.vendorTotal += vendorTotal;
    debits.set(vendorId, acc);
  }
  return debits;
};

(async () => {
  console.log(`\n┌─ refund-debit corrections (${APPLY ? 'APPLY' : 'dry-run'}) ─────────┐`);
  if (SINGLE) console.log(`│ booking: ${SINGLE}`);
  if (TOLERANCE > 0) console.log(`│ tolerance: ${TOLERANCE}`);
  console.log(`└──────────────────────────────────────────────────────────────┘\n`);

  let docs;
  if (SINGLE) {
    const snap = await db.collection(BOOKINGS_COLLECTION).doc(SINGLE).get();
    if (!snap.exists) { console.error(`Booking ${SINGLE} not found.`); process.exit(1); }
    docs = [{ id: snap.id, data: snap.data() }];
  } else {
    const [partialSnap, fullSnap] = await Promise.all([
      db.collection(BOOKINGS_COLLECTION).where('refundStatus', '==', 'Partial').get(),
      db.collection(BOOKINGS_COLLECTION).where('refundStatus', '==', 'Full').get(),
    ]);
    docs = [];
    for (const s of [partialSnap, fullSnap]) {
      s.forEach((d) => {
        const data = d.data();
        if (!(Number(data.refundAmount ?? 0) > 0)) return;
        docs.push({ id: d.id, data });
      });
    }
  }
  console.log(`Loaded ${docs.length} refunded booking${docs.length === 1 ? '' : 's'}.\n`);

  const corrections = []; // { bookingId, vendorId, delta, expected, actual }
  for (const { id, data } of docs) {
    const correct = computeCorrectDebits(data);
    const ledgerSnap = await db
      .collection(LEDGER_COLLECTION)
      .where('referenceId', '==', id)
      .get();

    const actual = new Map();
    ledgerSnap.forEach((ld) => {
      const r = ld.data();
      const vid = String(r.vendorId ?? '');
      if (!vid) return;
      const isRefundDebit = r.type === 'debit' && REFUND_DEBIT_SOURCES.has(String(r.source ?? ''));
      const isReversal = r.type === 'credit' && String(r.source ?? '') === 'refund-correction-reversal';
      if (isRefundDebit) actual.set(vid, (actual.get(vid) ?? 0) + Number(r.amount ?? 0));
      else if (isReversal) actual.set(vid, (actual.get(vid) ?? 0) - Number(r.amount ?? 0));
    });

    const allVids = new Set([...correct.keys(), ...actual.keys()]);
    for (const vid of allVids) {
      const expected = correct.get(vid)?.vendorTotal ?? 0;
      const actualAmt = actual.get(vid) ?? 0;
      const delta = expected - actualAmt;
      if (Math.abs(delta) <= TOLERANCE) continue;
      corrections.push({
        bookingId: id,
        vendorId: vid,
        delta,
        expected,
        actual: actualAmt,
        bookingDate: dateStr(data),
        invoiceNumber:
          (typeof data.invoiceNumber === 'string' && data.invoiceNumber) ||
          (typeof data.billingId === 'string' && data.billingId) ||
          id,
        locationId: data.locationId,
      });
    }
  }

  console.log(`Found ${corrections.length} (booking, vendor) corrections to apply.`);
  let totalDeduct = 0;
  let totalAdd = 0;
  for (const c of corrections) {
    if (c.delta > 0) totalDeduct += c.delta;
    else totalAdd += -c.delta;
  }
  console.log(`  Total to DEDUCT from future payouts: ${inr(totalDeduct)}`);
  console.log(`  Total to ADD    to future payouts  : ${inr(totalAdd)}`);
  console.log(`  Net company impact                 : ${inr(totalDeduct - totalAdd)}\n`);

  // Write corrections.
  let written = 0;
  let failed = 0;

  if (APPLY && corrections.length > 0) {
    let batch = db.batch();
    let pending = 0;
    const BATCH_SIZE = 400;
    for (const c of corrections) {
      const docId = `lc-${c.bookingId}-${c.vendorId}`;
      const ref = db.collection(LEDGER_COLLECTION).doc(docId);
      // delta > 0 → vendor under-debited → add MORE debit (type=debit, source=refund-correction)
      // delta < 0 → vendor over-debited  → reverse some debit (type=credit, source=refund-correction-reversal)
      const isDebit = c.delta > 0;
      const payload = {
        id: docId,
        vendorId: c.vendorId,
        amount: Math.abs(Math.round(c.delta)),
        type: isDebit ? 'debit' : 'credit',
        source: isDebit ? 'refund-correction' : 'refund-correction-reversal',
        referenceId: c.bookingId,
        invoiceNumber: c.invoiceNumber,
        locationId: c.locationId,
        date: c.bookingDate,
        createdAt: nowIso(),
        note: 'Item-level refund truth correction (proportional backfill drift)',
      };
      batch.set(ref, payload, { merge: true });
      pending++;
      if (pending >= BATCH_SIZE) {
        try {
          await batch.commit();
          written += pending;
        } catch (err) {
          console.error('Batch commit failed:', err.message);
          failed += pending;
        }
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) {
      try {
        await batch.commit();
        written += pending;
      } catch (err) {
        console.error('Final batch failed:', err.message);
        failed += pending;
      }
    }
    console.log(`Wrote ${written} ledger corrections; ${failed} failed.`);
  }

  // Print top entries.
  const sorted = [...corrections].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log(`\n─── top ${Math.min(20, sorted.length)} corrections ─────────────────────`);
  for (const c of sorted.slice(0, 20)) {
    const note = c.delta > 0 ? 'add MORE debit' : 'reverse some debit';
    console.log(
      `  ${c.bookingId}  vendor=${c.vendorId}  expected=${inr(c.expected)}  actual=${inr(c.actual)}  delta=${c.delta > 0 ? '+' : ''}${inr(c.delta)}  → ${note}`
    );
  }

  if (CSV_PATH) {
    const dir = path.dirname(CSV_PATH);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = ['bookingId,vendorId,expected,actual,delta,direction'];
    for (const c of corrections) {
      lines.push(
        `${c.bookingId},${c.vendorId},${c.expected},${c.actual},${c.delta},${c.delta > 0 ? 'add-debit' : 'reverse-debit'}`
      );
    }
    fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf-8');
    console.log(`\nCSV written: ${CSV_PATH}`);
  }

  console.log(APPLY ? `\nApply complete.\n` : `\nDry-run complete. Re-run with --apply to write.\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
