/**
 * Backfill event-package vendor credits to `vendorLedger`.
 *
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 * The trigger's old `aggregateByVendor` skipped any item without a
 * per-item `vendorId`. Event-package items (Summer Vibes etc.) carry no
 * vendorId on items[]/billingItems[] — vendor identity lives in
 * EventCampaign config. So vendors who only own event-package items on a
 * booking received no ledger credit row, even though the campaign
 * configures them as the owner.
 *
 * The trigger was patched (functions/lib/vendor-ledger-sync.js) so future
 * bookings merge flat-item AND event-package credits before writing. This
 * script does the same merge offline for every historical booking and
 * rewrites the canonical credit doc `le-{bookingId}-{vendorId}` with the
 * combined total. Idempotent.
 *
 * Read-only by default. Pass `--apply` to write.
 *
 * Usage:
 *   node scripts/backfill-event-package-vendor-credits.cjs
 *   node scripts/backfill-event-package-vendor-credits.cjs --apply
 *   node scripts/backfill-event-package-vendor-credits.cjs --booking ASG... # spot-check
 *   node scripts/backfill-event-package-vendor-credits.cjs --csv reports/event-credits-preview.csv
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
// By default we only ADD missing credits. Reducing an existing credit is
// risky — the customer-online helper writes credits using the campaign
// `price` field (not billingItems.unitPrice), and my computation may
// disagree with it. Reductions ship only when explicitly requested.
const INCLUDE_REDUCTIONS = process.argv.includes('--include-reductions');

const DATABASE_ID = 'asquare-app-db';
const BOOKINGS_COLLECTION = 'bookings';
const LEDGER_COLLECTION = 'vendorLedger';
const EVENT_CAMPAIGNS_COLLECTION = 'eventCampaigns';
const VENDOR_DETAILS_COLLECTION = 'vendorDetails';
const GST_PERCENT = 18;
const VENDOR_SHARE_DEFAULT = 80;

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

// Tokenisation must stay in sync with the trigger and audit script.
const STOPWORDS = new Set(['the', 'and', 'or', 'of', 'a', 'an', 'with', 'free']);
const eventTokenise = (s) => {
  if (typeof s !== 'string') return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
};

const findEventMatcher = (itemName, matchers) => {
  const itemTokens = new Set(eventTokenise(itemName));
  if (itemTokens.size === 0) return null;
  for (const m of matchers) {
    if (m.gameTokens.length === 0) continue;
    let ok = true;
    for (const t of m.gameTokens) {
      if (!itemTokens.has(t)) { ok = false; break; }
    }
    if (ok) return m;
  }
  return null;
};

const dateStr = (data) => {
  const raw = data.transactionDate ?? data.createdAt ?? data.sessionDate;
  if (!raw) return nowIso();
  if (typeof raw === 'object' && typeof raw.toDate === 'function') {
    try { return raw.toDate().toISOString(); } catch { return nowIso(); }
  }
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00.000Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? nowIso() : d.toISOString();
};

(async () => {
  console.log(`\n┌─ event-package vendor credit backfill (${APPLY ? 'APPLY' : 'dry-run'}) ─────┐`);
  if (SINGLE) console.log(`│ booking: ${SINGLE}`);
  console.log(`└──────────────────────────────────────────────────────────────────────┘\n`);

  // 1. Load event campaign matchers.
  const matchers = [];
  const campaignSnap = await db.collection(EVENT_CAMPAIGNS_COLLECTION).get();
  campaignSnap.forEach((d) => {
    const c = d.data() || {};
    const packages = Array.isArray(c.packages) ? c.packages : [];
    for (const pkg of packages) {
      const items = Array.isArray(pkg && pkg.items) ? pkg.items : [];
      for (const it of items) {
        if (!it) continue;
        const name = typeof it.name === 'string' ? it.name.trim() : '';
        if (!name) continue;
        matchers.push({
          vendorId: typeof it.vendorId === 'string' ? it.vendorId.trim() : '',
          gameTokens: eventTokenise(name),
          revenueShare: typeof it.revenueShare === 'boolean' ? it.revenueShare : true,
          type: typeof it.type === 'string' ? it.type : 'thirdParty',
          // Campaign-configured price is the vendor's agreed list price.
          // Customer-online checkouts write credits using THIS, not the
          // customer-facing allocated unitPrice. We mirror that here so
          // our computation lines up with the existing customer-online
          // credits and we don't wrongly reduce them.
          price: Number(it.price) || 0,
        });
      }
    }
  });
  console.log(`Loaded ${matchers.length} event-campaign matchers across ${campaignSnap.size} campaigns.\n`);
  if (matchers.length === 0) {
    console.log('No event-campaign matchers. Nothing to backfill.');
    process.exit(0);
  }

  // 2. Load vendor shares (one-time, all vendors).
  const vendorShares = new Map();
  const vendorSnap = await db.collection(VENDOR_DETAILS_COLLECTION).get();
  vendorSnap.forEach((d) => {
    const data = d.data() || {};
    const stored = typeof data.revenueShare === 'number' ? data.revenueShare : VENDOR_SHARE_DEFAULT;
    vendorShares.set(d.id, Math.min(100, Math.max(0, stored)));
  });

  // 3. Load bookings.
  let docs;
  if (SINGLE) {
    const snap = await db.collection(BOOKINGS_COLLECTION).doc(SINGLE).get();
    if (!snap.exists) { console.error(`Booking ${SINGLE} not found.`); process.exit(1); }
    docs = [snap];
  } else {
    docs = (await db.collection(BOOKINGS_COLLECTION).get()).docs;
  }
  console.log(`Loaded ${docs.length} booking${docs.length === 1 ? '' : 's'}.\n`);

  // 4. Compute per-booking deltas.
  const corrections = []; // { bookingId, vendorId, currentAmount, expectedAmount, delta }
  let bookingsTouched = 0;

  for (const snap of docs) {
    const data = snap.data() || {};
    const billingItems = Array.isArray(data.billingItems) ? data.billingItems : [];
    if (billingItems.length === 0) continue;

    // Compute event-package contribution per vendor.
    const eventByVendor = new Map();
    for (const bi of billingItems) {
      if (!bi) continue;
      const flatVendor = typeof bi.vendorId === 'string' ? bi.vendorId.trim() : '';
      if (flatVendor) continue;
      const itemName = typeof bi.itemName === 'string' ? bi.itemName : '';
      if (!itemName) continue;
      const m = findEventMatcher(itemName, matchers);
      if (!m || m.type !== 'thirdParty' || !m.vendorId) continue;

      const qty = Math.max(1, Math.floor(Number(bi.quantity) || 0));
      // Prefer the campaign-configured vendor price; fall back to the
      // customer-facing unitPrice only when the config has no price set.
      const configPrice = Number(m.price) || 0;
      const unitPrice = configPrice > 0 ? configPrice : (Number(bi.unitPrice) || 0);
      if (qty <= 0 || unitPrice <= 0) continue;
      const gross = unitPrice * qty;
      const base = Math.round((gross * 100) / (100 + GST_PERCENT));
      const gst = gross - base;
      const share =
        m.revenueShare === false ? 100 : (vendorShares.get(m.vendorId) ?? VENDOR_SHARE_DEFAULT);
      const vendorBase = Math.round((base * share) / 100);
      const vendorGst = Math.round((gst * share) / 100);
      const vendorTotal = vendorBase + vendorGst;
      if (vendorTotal <= 0) continue;
      const acc = eventByVendor.get(m.vendorId) || { vendorBase: 0, vendorGst: 0, vendorTotal: 0 };
      acc.vendorBase += vendorBase;
      acc.vendorGst += vendorGst;
      acc.vendorTotal += vendorTotal;
      eventByVendor.set(m.vendorId, acc);
    }
    if (eventByVendor.size === 0) continue;

    // Compute flat-item contribution (already in billingItems).
    const flatByVendor = new Map();
    for (const bi of billingItems) {
      if (!bi || !bi.vendorId) continue;
      const total = Number(bi.vendorTotal) || 0;
      if (total <= 0) continue;
      const acc = flatByVendor.get(bi.vendorId) || { vendorBase: 0, vendorGst: 0, vendorTotal: 0 };
      acc.vendorBase += Number(bi.vendorBase) || 0;
      acc.vendorGst += Number(bi.vendorGst) || 0;
      acc.vendorTotal += total;
      flatByVendor.set(bi.vendorId, acc);
    }

    // Merge.
    const merged = new Map();
    const addInto = (src) => {
      for (const [vid, acc] of src.entries()) {
        const e = merged.get(vid) || { vendorBase: 0, vendorGst: 0, vendorTotal: 0 };
        e.vendorBase += acc.vendorBase;
        e.vendorGst += acc.vendorGst;
        e.vendorTotal += acc.vendorTotal;
        merged.set(vid, e);
      }
    };
    addInto(flatByVendor);
    addInto(eventByVendor);

    // Read existing ledger entries to compare.
    const ledgerSnap = await db
      .collection(LEDGER_COLLECTION)
      .where('referenceId', '==', snap.id)
      .get();
    const existingByVendor = new Map();
    ledgerSnap.forEach((ld) => {
      const r = ld.data() || {};
      const vid = String(r.vendorId ?? '');
      if (!vid) return;
      if (r.type !== 'credit') return;
      const src = String(r.source ?? '');
      // Only consider canonical credit rows; skip refund-correction etc.
      if (src && src !== 'booking' && src !== 'POS' && src !== 'BILLING') return;
      const existing = existingByVendor.get(vid) || 0;
      existingByVendor.set(vid, existing + (Number(r.amount) || 0));
    });

    let bookingHasDelta = false;
    for (const [vid, expected] of merged.entries()) {
      const current = existingByVendor.get(vid) || 0;
      const delta = expected.vendorTotal - current;
      if (Math.abs(delta) < 1) continue; // tolerance for rounding
      // Skip reductions unless --include-reductions is passed. Existing
      // credits may have been written by the customer-online helper using
      // the campaign's `price` field, and disagreeing with that without a
      // human review is dangerous (we'd be unilaterally cutting payouts).
      if (delta < 0 && !INCLUDE_REDUCTIONS) continue;
      bookingHasDelta = true;
      corrections.push({
        bookingId: snap.id,
        vendorId: vid,
        currentAmount: current,
        expectedTotal: expected.vendorTotal,
        expectedBase: expected.vendorBase,
        expectedGst: expected.vendorGst,
        delta,
        date: dateStr(data),
        invoiceNumber:
          (typeof data.invoiceNumber === 'string' && data.invoiceNumber) ||
          (typeof data.billingId === 'string' && data.billingId) ||
          snap.id,
        locationId: data.locationId,
        source: data.source || 'booking',
      });
    }
    if (bookingHasDelta) bookingsTouched++;
  }

  console.log(`Found ${corrections.length} (booking, vendor) credit corrections across ${bookingsTouched} bookings.`);
  let totalAdded = 0;
  let totalReduced = 0;
  for (const c of corrections) {
    if (c.delta > 0) totalAdded += c.delta;
    else totalReduced += -c.delta;
  }
  console.log(`  Total credits to ADD     : ${inr(totalAdded)}`);
  console.log(`  Total credits to REDUCE  : ${inr(totalReduced)}`);
  console.log(`  Net credit shift         : ${inr(totalAdded - totalReduced)}\n`);

  // Top entries.
  const sorted = [...corrections].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log(`─── top ${Math.min(20, sorted.length)} corrections ─────────────────────`);
  for (const c of sorted.slice(0, 20)) {
    const dir = c.delta > 0 ? 'add' : 'reduce';
    console.log(
      `  ${c.bookingId}  vendor=${c.vendorId}  current=${inr(c.currentAmount)}  expected=${inr(c.expectedTotal)}  delta=${c.delta > 0 ? '+' : ''}${inr(c.delta)}  → ${dir}`
    );
  }

  if (CSV_PATH) {
    const dir = path.dirname(CSV_PATH);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = ['bookingId,vendorId,current,expectedTotal,expectedBase,expectedGst,delta'];
    for (const c of corrections) {
      lines.push(
        `${c.bookingId},${c.vendorId},${c.currentAmount},${c.expectedTotal},${c.expectedBase},${c.expectedGst},${c.delta}`
      );
    }
    fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf-8');
    console.log(`\nCSV written: ${CSV_PATH}`);
  }

  // Apply.
  if (APPLY && corrections.length > 0) {
    console.log(`\nApplying ${corrections.length} credit corrections…`);
    let written = 0;
    let failed = 0;
    let batch = db.batch();
    let pending = 0;
    const BATCH_SIZE = 400;
    for (const c of corrections) {
      const docId = `le-${c.bookingId}-${c.vendorId}`;
      const ref = db.collection(LEDGER_COLLECTION).doc(docId);
      const payload = {
        id: docId,
        vendorId: c.vendorId,
        vendorBase: c.expectedBase,
        vendorGst: c.expectedGst,
        amount: c.expectedTotal,
        type: 'credit',
        referenceId: c.bookingId,
        invoiceNumber: c.invoiceNumber,
        locationId: c.locationId,
        date: c.date,
        createdAt: nowIso(),
        source: c.source,
      };
      // Strip undefined.
      for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
      batch.set(ref, payload, { merge: true });
      pending++;
      if (pending >= BATCH_SIZE) {
        try { await batch.commit(); written += pending; } catch (e) {
          console.error('Batch failed:', e.message); failed += pending;
        }
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) {
      try { await batch.commit(); written += pending; } catch (e) {
        console.error('Final batch failed:', e.message); failed += pending;
      }
    }
    console.log(`Wrote ${written} ledger rows; ${failed} failed.`);
  }

  console.log(APPLY ? `\nApply complete.\n` : `\nDry-run complete. Re-run with --apply to write.\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
