/**
 * Stamp the remaining (booking, vendor) pairs where a ledger credit
 * exists but no billingItem is tagged. For each pair:
 *   - load all of the vendor's matchers across eventCampaigns
 *   - find the billingItem in the booking whose tokens best match any
 *     of those matchers (highest token-overlap count wins)
 *   - stamp vendorId on items[i] + billingItems[i]
 *   - set vendorBase/vendorGst/vendorTotal so they sum to the ledger
 *     amount (single item gets the whole credit since this is a
 *     fallback path)
 *   - add the vendor to vendorIds[]
 *
 * Default --dry-run; pass --apply to write.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const APPLY = process.argv.includes('--apply');
const EVENT_STOPWORDS = new Set(['the', 'and', 'or', 'of', 'a', 'an', 'with', 'free']);

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID, ignoreUndefinedProperties: true });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const eventTokenise = (s) => {
  if (typeof s !== 'string') return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !EVENT_STOPWORDS.has(t));
};

(async () => {
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const [campaignsSnap, vDetailsSnap, ledgerSnap] = await Promise.all([
    db.collection('eventCampaigns').get(),
    db.collection('vendorDetails').get(),
    db.collection('vendorLedger').get(),
  ]);

  // Build vendor → matcher names lookup
  const vendorMatcherNames = new Map(); // vendorId → [{tokens, name}]
  for (const d of campaignsSnap.docs) {
    const c = d.data() || {};
    const packages = Array.isArray(c.packages) ? c.packages : [];
    for (const pkg of packages) {
      const items = Array.isArray(pkg.items) ? pkg.items : [];
      for (const it of items) {
        if (!it) continue;
        const vid = typeof it.vendorId === 'string' ? it.vendorId.trim() : '';
        const name = typeof it.name === 'string' ? it.name.trim() : '';
        if (!vid || !name) continue;
        const arr = vendorMatcherNames.get(vid) ?? [];
        arr.push({ name, tokens: new Set(eventTokenise(name)) });
        vendorMatcherNames.set(vid, arr);
      }
    }
  }

  const vendorType = new Map();
  for (const d of vDetailsSnap.docs) {
    const data = d.data() || {};
    vendorType.set(d.id, data.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty');
  }

  // Build ledger pairs
  const pairs = new Map();
  for (const doc of ledgerSnap.docs) {
    const e = doc.data();
    if (e.type === 'debit') continue;
    const ref = e.bookingId || e.referenceId || '';
    if (!ref || !e.vendorId) continue;
    const k = `${ref}::${e.vendorId}`;
    const acc = pairs.get(k) ?? { bookingId: ref, vendorId: e.vendorId, amount: 0 };
    acc.amount += num(e.amount);
    pairs.set(k, acc);
  }

  // For each pair, check if untagged in booking; if so, score best item match
  const bookingCache = new Map();
  let stamped = 0;
  let skipped = 0;
  const sample = [];

  for (const p of pairs.values()) {
    let state = bookingCache.get(p.bookingId);
    if (!state) {
      const snap = await db.collection('bookings').doc(p.bookingId).get();
      if (!snap.exists) continue;
      const data = snap.data();
      state = {
        data,
        items: Array.isArray(data.items) ? data.items.map((it) => ({ ...it })) : [],
        billingItems: Array.isArray(data.billingItems)
          ? data.billingItems.map((bi) => ({ ...bi }))
          : [],
        vendorIds: new Set(Array.isArray(data.vendorIds) ? data.vendorIds : []),
        modified: false,
      };
      bookingCache.set(p.bookingId, state);
    }
    if (state.data.cancelled === true) continue;
    const alreadyTagged =
      state.billingItems.some((bi) => bi.vendorId === p.vendorId) ||
      state.items.some((it) => it.vendorId === p.vendorId);
    if (alreadyTagged) continue;

    const matcherNames = vendorMatcherNames.get(p.vendorId) || [];
    if (matcherNames.length === 0) {
      skipped++;
      continue;
    }

    // Score each untagged billing item by max token-overlap with any of
    // the vendor's matcher names.
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < state.billingItems.length; i++) {
      const bi = state.billingItems[i];
      if (bi.vendorId) continue;
      const itName = bi.itemName || (state.items[i] && state.items[i].itemName) || '';
      const itTokens = new Set(eventTokenise(itName));
      if (itTokens.size === 0) continue;
      let score = 0;
      for (const m of matcherNames) {
        let s = 0;
        for (const t of m.tokens) if (itTokens.has(t)) s++;
        if (s > score) score = s;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1 || bestScore <= 0) {
      skipped++;
      continue;
    }

    const target = Math.round(p.amount);
    const isSubLease = vendorType.get(p.vendorId) === 'SubLease';
    const vendorTotal = target;
    const vendorBase = isSubLease ? vendorTotal : Math.round((vendorTotal * 100) / 118);
    const vendorGst = isSubLease ? 0 : vendorTotal - vendorBase;

    state.billingItems[bestIdx] = {
      ...state.billingItems[bestIdx],
      vendorId: p.vendorId,
      vendorBase,
      vendorGst,
      vendorTotal,
    };
    if (state.items[bestIdx]) {
      state.items[bestIdx] = { ...state.items[bestIdx], vendorId: p.vendorId };
    }
    state.vendorIds.add(p.vendorId);
    state.modified = true;
    stamped++;

    if (sample.length < 12) {
      sample.push({
        booking: p.bookingId,
        vendor: p.vendorId,
        item:
          state.billingItems[bestIdx].itemName ||
          (state.items[bestIdx] && state.items[bestIdx].itemName) ||
          '—',
        amount: target,
        score: bestScore,
      });
    }
  }

  let writes = 0;
  for (const [bId, state] of bookingCache) {
    if (!state.modified) continue;
    if (APPLY) {
      await db
        .collection('bookings')
        .doc(bId)
        .set(
          {
            items: state.items,
            billingItems: state.billingItems,
            vendorIds: [...state.vendorIds].sort(),
          },
          { merge: true },
        );
    }
    writes++;
  }

  console.log(`\nStamped pairs : ${stamped}`);
  console.log(`Skipped pairs : ${skipped}`);
  console.log(`Bookings ${APPLY ? 'updated' : 'would update'} : ${writes}`);
  if (sample.length > 0) {
    console.log('\nSample:');
    for (const s of sample) {
      console.log(
        `  ${s.booking}  vendor=${s.vendor}  ₹${s.amount}  → "${s.item}" (token score ${s.score})`,
      );
    }
  }
  if (!APPLY) console.log('\n⏸  dry run — pass --apply.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
