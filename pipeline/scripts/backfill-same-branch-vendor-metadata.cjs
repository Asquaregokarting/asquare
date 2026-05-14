/**
 * Backfill missing vendor metadata on bookings that have legitimate
 * event-package ledger credits but lack the corresponding `vendorIds[]`
 * and per-item vendorId/vendorBase/vendorGst/vendorTotal stamps.
 *
 * For each candidate booking:
 *   - Re-run the matcher (same logic as functions/lib/vendor-ledger-sync.js
 *     `aggregateEventPackageCredits`) — branch-gated — to determine per-item
 *     vendor + per-item split numbers.
 *   - For matched items, stamp:
 *       items[i].vendorId
 *       billingItems[i].vendorId / vendorBase / vendorGst / vendorTotal
 *       vendorIds[] union of all per-item vendors
 *   - SubLease vendors keep vendorGst = 0 (mirrors the canonical writer).
 *
 * No `dataFix` marker fields are written to bookings — only the
 * metadata that should have been there in the first place.
 *
 * Default mode is --dry-run. Pass --apply to write.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const GST_PERCENT = 18;
const VENDOR_SHARE_DEFAULT = 80;
const EVENT_STOPWORDS = new Set(['the', 'and', 'or', 'of', 'a', 'an', 'with', 'free']);

const APPLY = process.argv.includes('--apply');

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID, ignoreUndefinedProperties: true });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const dateOf = (d) => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d.toDate) return d.toDate().toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};
const eventTokenise = (s) => {
  if (typeof s !== 'string') return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !EVENT_STOPWORDS.has(t));
};
const canonBranch = (raw, locMap) => {
  if (raw == null) return '';
  const s = String(raw).toLowerCase().trim();
  return locMap.get(s) || s;
};

const findMatcherForItem = (item, matchers, txnDate) => {
  if (!item || matchers.length === 0) return null;
  const candidate =
    (typeof item.itemName === 'string' ? item.itemName : '') ||
    (item.activity && typeof item.activity.name === 'string' ? item.activity.name : '');
  if (!candidate) return null;
  const itemTokens = new Set(eventTokenise(candidate));
  if (itemTokens.size === 0) return null;
  const day = typeof txnDate === 'string' && txnDate.length >= 10 ? txnDate.slice(0, 10) : '';
  for (const m of matchers) {
    if (!m.gameTokens.length) continue;
    let ok = true;
    for (const t of m.gameTokens) {
      if (!itemTokens.has(t)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (m.startDate && day && day < m.startDate) continue;
    if (m.endDate && day && day > m.endDate) continue;
    return m;
  }
  return null;
};

(async () => {
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const [campaignsSnap, locsSnap, vDetailsSnap, ledgerSnap] = await Promise.all([
    db.collection('eventCampaigns').get(),
    db.collection('locations').get(),
    db.collection('vendorDetails').get(),
    db.collection('vendorLedger').get(),
  ]);

  // Build matchers
  const matchers = [];
  for (const d of campaignsSnap.docs) {
    const c = d.data() || {};
    const packages = Array.isArray(c.packages) ? c.packages : [];
    for (const pkg of packages) {
      const items = Array.isArray(pkg && pkg.items) ? pkg.items : [];
      for (const it of items) {
        if (!it) continue;
        const vid = typeof it.vendorId === 'string' ? it.vendorId.trim() : '';
        const name = typeof it.name === 'string' ? it.name.trim() : '';
        if (!name) continue;
        matchers.push({
          campaignId: d.id,
          startDate: typeof c.startDate === 'string' ? c.startDate : '',
          endDate: typeof c.endDate === 'string' ? c.endDate : '',
          vendorId: vid,
          gameTokens: eventTokenise(name),
          revenueShare: typeof it.revenueShare === 'boolean' ? it.revenueShare : true,
          type: typeof it.type === 'string' ? it.type : 'thirdParty',
          price: Number(it.price) || 0,
        });
      }
    }
  }

  // Locations and vendor branches
  const locMap = new Map();
  for (const d of locsSnap.docs) {
    const data = d.data() || {};
    if (typeof data.name === 'string') locMap.set(data.name.toLowerCase().trim(), d.id);
    locMap.set(d.id.toLowerCase().trim(), d.id);
  }
  const vendorMeta = new Map();
  for (const d of vDetailsSnap.docs) {
    const data = d.data() || {};
    vendorMeta.set(d.id, {
      branchId: canonBranch(data.branchId != null ? data.branchId : data.branch, locMap),
      share: num(data.revenueShare) || VENDOR_SHARE_DEFAULT,
      type: data.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty',
    });
  }

  // Find candidate bookings: any booking referenced by a ledger row where
  // the booking's vendorIds[] doesn't include the credited vendor.
  const candidates = new Map(); // bookingId → Set(vendorId)
  for (const doc of ledgerSnap.docs) {
    const e = doc.data();
    if (e.type === 'debit') continue;
    const ref = e.bookingId || e.referenceId || '';
    if (!ref) continue;
    const vid = e.vendorId;
    if (!vid) continue;
    const arr = candidates.get(ref) ?? new Set();
    arr.add(vid);
    candidates.set(ref, arr);
  }

  console.log(`\nLedger touches ${candidates.size} distinct bookings.`);

  let processedBookings = 0;
  let updatedBookings = 0;
  let skippedAlreadyOk = 0;
  let skippedCrossBranch = 0;
  let totalItemsStamped = 0;
  const sample = [];

  for (const [bookingId, ledgerVendors] of candidates) {
    processedBookings++;
    if (processedBookings % 100 === 0) {
      process.stderr.write(`  processed ${processedBookings}/${candidates.size}\r`);
    }
    const bSnap = await db.collection('bookings').doc(bookingId).get();
    if (!bSnap.exists) continue;
    const b = bSnap.data();
    if (b.cancelled === true) continue;

    const bookingBranchId = canonBranch(b.locationId, locMap);
    const bookingVendorIds = new Set(Array.isArray(b.vendorIds) ? b.vendorIds : []);

    // Which credited vendors are missing from vendorIds AND same-branch?
    const missing = [];
    for (const vid of ledgerVendors) {
      if (bookingVendorIds.has(vid)) continue;
      const meta = vendorMeta.get(vid);
      if (!meta || !meta.branchId) continue; // unknown vendor branch → skip
      if (meta.branchId !== bookingBranchId) {
        skippedCrossBranch++;
        continue; // cross-branch ghost handled by the other script
      }
      missing.push(vid);
    }
    if (missing.length === 0) {
      skippedAlreadyOk++;
      continue;
    }

    // Re-run matcher to figure out per-item vendor + splits.
    const items = Array.isArray(b.items) ? b.items.map((it) => ({ ...it })) : [];
    const billingItems = Array.isArray(b.billingItems)
      ? b.billingItems.map((bi) => ({ ...bi }))
      : [];
    if (items.length === 0 || billingItems.length === 0) continue;

    const txnDate = b.transactionDate || b.visitDate || b.createdAt;
    const txnIso =
      typeof txnDate === 'string'
        ? txnDate
        : txnDate && txnDate.toDate
          ? txnDate.toDate().toISOString()
          : '';

    let stampedCount = 0;
    const stampedVendorSet = new Set(bookingVendorIds);

    for (let i = 0; i < billingItems.length; i++) {
      const bi = billingItems[i];
      const it = items[i] || null;
      if (bi.vendorId) continue; // already stamped — leave alone

      const m = findMatcherForItem(it || bi, matchers, txnIso);
      if (!m || m.type !== 'thirdParty' || !m.vendorId) continue;
      if (!missing.includes(m.vendorId)) continue; // matcher found a vendor we're not backfilling
      const meta = vendorMeta.get(m.vendorId);
      if (!meta || meta.branchId !== bookingBranchId) continue;

      const qty = Math.max(1, Math.floor(num(bi.quantity)) || 1);
      const configPrice = num(m.price);
      const unitPrice = configPrice > 0 ? configPrice : num(bi.unitPrice);
      if (unitPrice <= 0) continue;
      const gross = unitPrice * qty;
      const base = Math.round((gross * 100) / (100 + GST_PERCENT));
      const gst = gross - base;
      const share = m.revenueShare === false ? 100 : meta.share;
      const isSubLease = meta.type === 'SubLease';
      const vendorBase = Math.round((base * share) / 100);
      const vendorGst = isSubLease ? 0 : Math.round((gst * share) / 100);
      const vendorTotal = vendorBase + vendorGst;
      if (vendorTotal <= 0) continue;

      billingItems[i] = {
        ...bi,
        vendorId: m.vendorId,
        vendorBase,
        vendorGst,
        vendorTotal,
      };
      if (it) items[i] = { ...it, vendorId: m.vendorId };
      stampedVendorSet.add(m.vendorId);
      stampedCount++;
    }

    if (stampedCount === 0) continue;

    const nextVendorIds = [...stampedVendorSet].sort();
    if (sample.length < 8) {
      sample.push({ bookingId, stampedCount, nextVendorIds });
    }

    if (APPLY) {
      await db
        .collection('bookings')
        .doc(bookingId)
        .set(
          {
            items,
            billingItems,
            vendorIds: nextVendorIds,
          },
          { merge: true },
        );
    }
    updatedBookings++;
    totalItemsStamped += stampedCount;
  }

  console.log(`\n\nProcessed bookings           : ${processedBookings}`);
  console.log(`Skipped (already consistent) : ${skippedAlreadyOk}`);
  console.log(`Skipped (cross-branch ghost) : ${skippedCrossBranch}`);
  console.log(`Bookings to ${APPLY ? 'updated' : 'would update'}      : ${updatedBookings}`);
  console.log(`Items ${APPLY ? 'stamped' : 'would stamp'}             : ${totalItemsStamped}`);

  if (sample.length > 0) {
    console.log('\nSample bookings:');
    for (const s of sample) {
      console.log(`  ${s.bookingId}  +${s.stampedCount} items  vendorIds=[${s.nextVendorIds.join(', ')}]`);
    }
  }

  if (!APPLY) {
    console.log('\n⏸  dry run — pass --apply to write.');
  } else {
    console.log('\n✓ Applied.');
  }
  process.exit(0);
})().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
