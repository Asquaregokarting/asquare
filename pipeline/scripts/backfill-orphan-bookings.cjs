/**
 * Backfill the orphan bookings discovered by
 * `inspect-unknown-bookings.cjs --sweep` — bookings with no gameId, no
 * vendorIds[], no billingItems[], and no vendorLedger entries.
 *
 * For each orphan:
 *   1. Walk every item's `itemName`, try to resolve via:
 *        a. activityCatalog (by name or bookingName)
 *        b. EventCampaign config (substring token match)
 *        c. heuristic keyword match for go-karting (company-only)
 *   2. Bucket the booking:
 *        - 'confident'    every item resolved AND any thirdParty items
 *                         have a vendorId (or company-only/event-package)
 *        - 'needs_review' some items resolved, some didn't
 *        - 'unknown'      no item resolved
 *   3. For 'confident' bookings, recompute billingItems with proper splits,
 *      stamp vendorIds, write ledger credits at `le-{id}-{vendorId}`.
 *   4. Tag the booking with `enrichmentSource: 'orphan-backfill'` so a
 *      future audit can find these.
 *
 * Read-only by default. Pass `--apply` to write.
 *
 * Usage:
 *   node scripts/backfill-orphan-bookings.cjs                           # dry-run
 *   node scripts/backfill-orphan-bookings.cjs --apply
 *   node scripts/backfill-orphan-bookings.cjs --booking ASG... --apply  # spot-fix one
 *   node scripts/backfill-orphan-bookings.cjs --csv reports/orphan-backfill-preview.csv
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

// Manual per-booking overrides for items neither the catalog nor the
// vendor-activity lookup can identify. Add an entry here when admin
// confirms a specific booking's true vendor + game.
//
// Each override: { bookingId, itemNameMatch (substring, lowercase),
//   gameId, subGameId?, variantId?, vendorId, type? }
// `itemNameMatch` is matched against the booking's items[i].itemName
// (lowercase, substring) so multi-item bookings can override individual
// rows. If `itemNameMatch` is omitted/empty, the override applies to ALL
// unmatched items in that booking.
const MANUAL_OVERRIDES = [
  // SINGLE PASS 10MIN at Rajahmundry — catalog-fuzzy wrongly matches this
  // to bungeetrampoline. It's actually MINI TRAMPOLINE → Prathyusha.
  {
    bookingId: 'ASG260425160501102V9FA',
    itemNameMatch: '',
    gameId: 'minitrampoline',
    subGameId: 'mini_trampoline',
    variantId: 'single_pass_10min',
    vendorId: '8884159566',
    vendorName: 'Prathyusha',
    type: 'thirdParty',
  },
  // SMART BOUNCE COMBO + SMART BOUNCE SINGLE PASS at Kakinada. Catalog
  // already resolves these to gameId='trampolinepark'; we only need to
  // attach the vendor.
  {
    bookingId: 'ASG260425160018101J71A',
    itemNameMatch: '',
    vendorId: '9985526034',
    vendorName: 'Manoja',
    type: 'thirdParty',
  },
  // 10 SHOT SINGLE PASS at Kakinada — archery, vendor DHARANEESH.
  {
    bookingId: 'ASG2604251601321012MZG',
    itemNameMatch: '',
    vendorId: '8790933732',
    vendorName: 'DHARANEESH',
    type: 'thirdParty',
  },
  // Add more rows here as admin identifies them.
];

const DATABASE_ID = 'asquare-app-db';
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
const pad = (s, w) => String(s ?? '').padEnd(w);
const padR = (s, w) => String(s ?? '').padStart(w);
const nowIso = () => new Date().toISOString();

const STOPWORDS = new Set(['the', 'and', 'or', 'of', 'a', 'an', 'with', 'free']);
const tokenise = (s) => {
  if (typeof s !== 'string') return [];
  return s.toLowerCase().split(/[^a-z0-9]+/).map((t) => t.trim()).filter((t) => t.length > 1 && !STOPWORDS.has(t));
};
const tokenSetMatches = (itemName, gameName) => {
  const itemTokens = new Set(tokenise(itemName));
  const gameTokens = tokenise(gameName);
  if (itemTokens.size === 0 || gameTokens.length === 0) return false;
  for (const t of gameTokens) if (!itemTokens.has(t)) return false;
  return true;
};

const isGoKarting = (n) => /gokart|go-kart|go kart|karting/i.test(String(n || ''));

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

const SLUG_TO_BRANCH_ID = {
  visakhapatnam: '0', vizag: '0',
  kakinada: '1',
  rajahmundry: '2', rjy: '2',
  srikakulam: '5',
};
const toBranchId = (loc) => {
  if (!loc) return '';
  const s = String(loc).toLowerCase();
  return SLUG_TO_BRANCH_ID[s] ?? String(loc);
};

(async () => {
  console.log(`\n┌─ orphan-bookings backfill (${APPLY ? 'APPLY' : 'dry-run'}) ─────────────┐`);
  if (SINGLE) console.log(`│ booking: ${SINGLE}`);
  console.log(`└──────────────────────────────────────────────────────────────────┘\n`);

  // Load activity catalog from the canonical hierarchy:
  //   locations/{branchId}/games/{gameId}/subgames/{subGameId}/variants/{variantId}
  // The flat `activityCatalog` collection is legacy and empty in this DB.
  // We walk every (branch, game, subgame, variant) and build:
  //   - direct lookups by variantId, name, bookingName (lowercased)
  //   - token-set fuzzy matchers on name + composed `game • sub • variant`
  const catalog = new Map(); // key (lowercase) → entry
  const fuzzyMatchers = []; // { tokens, entry }
  const addCatalogEntry = (entry) => {
    const keys = [];
    if (entry.variantId) keys.push(String(entry.variantId).toLowerCase());
    if (entry.name) keys.push(String(entry.name).toLowerCase());
    if (entry.bookingName) keys.push(String(entry.bookingName).toLowerCase());
    if (entry.composedName) keys.push(String(entry.composedName).toLowerCase());
    for (const k of keys) {
      if (!catalog.has(k)) catalog.set(k, entry);
    }
    // Add fuzzy matchers for the composed name + variant label.
    if (entry.composedName) {
      const tk = tokenise(entry.composedName);
      if (tk.length > 0) fuzzyMatchers.push({ tokens: tk, entry });
    }
    if (entry.name) {
      const tk = tokenise(entry.name);
      if (tk.length > 0) fuzzyMatchers.push({ tokens: tk, entry });
    }
  };

  const locationsSnap = await db.collection('locations').get();
  let catalogCount = 0;
  for (const locDoc of locationsSnap.docs) {
    const branchId = locDoc.id;
    const gamesSnap = await locDoc.ref.collection('games').get();
    for (const gameDoc of gamesSnap.docs) {
      const gameData = gameDoc.data() || {};
      const gameName = String(gameData.name || gameData.gameName || gameDoc.id);
      const subgamesSnap = await gameDoc.ref.collection('subgames').get();
      for (const subDoc of subgamesSnap.docs) {
        const subData = subDoc.data() || {};
        const subGameName = String(subData.name || subData.subGameName || subDoc.id);
        const variantsSnap = await subDoc.ref.collection('variants').get();
        for (const varDoc of variantsSnap.docs) {
          const varData = varDoc.data() || {};
          const variantLabel = String(varData.name || varData.variantLabel || varDoc.id);
          const composed = `${gameName} • ${subGameName} • ${variantLabel}`;
          const entry = {
            gameId: gameDoc.id,
            subGameId: subDoc.id,
            variantId: varDoc.id,
            vendorId: varData.vendorId || subData.vendorId || gameData.vendorId || '',
            name: variantLabel,
            bookingName: composed,
            composedName: composed,
            branchId,
            type:
              varData.vendorId || subData.vendorId || gameData.vendorId
                ? 'thirdParty'
                : 'company',
          };
          addCatalogEntry(entry);
          catalogCount++;
        }
      }
    }
  }
  console.log(`Loaded ${catalogCount} catalog entries (${fuzzyMatchers.length} fuzzy matchers, ${catalog.size} direct keys).`);

  // Load EventCampaign matchers.
  const eventMatchers = [];
  const campaignSnap = await db.collection('eventCampaigns').get();
  campaignSnap.forEach((d) => {
    const c = d.data() || {};
    const packages = Array.isArray(c.packages) ? c.packages : [];
    for (const pkg of packages) {
      const items = Array.isArray(pkg && pkg.items) ? pkg.items : [];
      for (const it of items) {
        if (!it || !it.name) continue;
        eventMatchers.push({
          campaignSlug: c.slug || d.id,
          packageName: pkg.name || pkg.id || '',
          gameName: it.name,
          gameTokens: tokenise(it.name),
          vendorId: typeof it.vendorId === 'string' ? it.vendorId.trim() : '',
          revenueShare: typeof it.revenueShare === 'boolean' ? it.revenueShare : true,
          type: typeof it.type === 'string' ? it.type : 'thirdParty',
          configPrice: Number(it.price) || 0,
        });
      }
    }
  });
  console.log(`Loaded ${eventMatchers.length} event-campaign item matchers.\n`);

  // Load vendor shares only. We deliberately do NOT do any token-based
  // fuzzy matching of `preferredActivity` against booking item names —
  // that produces false positives (e.g. multiple vendors share the
  // 'trampoline' token but at different branches with different games).
  // Vendor attribution must be EXPLICIT: either it's already on the
  // catalog entry's variant/subgame/game doc, or it's in MANUAL_OVERRIDES.
  const vendorShares = new Map();
  const vendorSnap = await db.collection('vendorDetails').get();
  vendorSnap.forEach((d) => {
    const data = d.data() || {};
    const stored = typeof data.revenueShare === 'number' ? data.revenueShare : VENDOR_SHARE_DEFAULT;
    vendorShares.set(d.id, Math.min(100, Math.max(0, stored)));
  });

  // Resolver order: gokart-heuristic → catalog (exact + fuzzy) → event-package
  // → unmatched. Manual overrides ENRICH the result at the end — they only
  // replace fields explicitly set on the override, so admin can supply a
  // vendorId without losing the catalog-resolved gameId/subGameId.
  const findOverride = (itemName, bookingId) => {
    const lc = String(itemName || '').toLowerCase().trim();
    for (const o of MANUAL_OVERRIDES) {
      if (o.bookingId !== bookingId) continue;
      const match = (o.itemNameMatch || '').toLowerCase();
      if (match && !lc.includes(match)) continue;
      return o;
    }
    return null;
  };

  const applyOverride = (base, override) => {
    if (!override) return base;
    const merged = {
      strategy: 'manual-override',
      gameId: override.gameId !== undefined ? override.gameId : base.gameId,
      subGameId: override.subGameId !== undefined ? override.subGameId : base.subGameId,
      variantId: override.variantId !== undefined ? override.variantId : base.variantId,
      vendorId: override.vendorId !== undefined ? override.vendorId : (base.vendorId || ''),
      type: override.type
        || (override.vendorId
          ? 'thirdParty'
          : (base.type || 'company')),
      revenueShare: override.revenueShare !== undefined
        ? override.revenueShare
        : (base.revenueShare !== undefined ? base.revenueShare : true),
      // Preserve the underlying strategy as a hint so the diagnostic shows
      // "manual-override (was catalog-fuzzy)" if catalog already partially
      // resolved.
      underlyingStrategy: base.strategy,
    };
    return merged;
  };

  const resolveItem = (itemName, branchId, bookingId) => {
    if (!itemName) {
      const ov = findOverride(itemName, bookingId);
      if (ov) return applyOverride({ strategy: 'unmatched' }, ov);
      return { strategy: 'unmatched', reason: 'empty itemName' };
    }
    const lc = String(itemName).toLowerCase().trim();

    const ov = findOverride(itemName, bookingId);

    // 0. Go-karting heuristic — company revenue, no vendor. Run first so a
    // booking item like "Gokarting Adult (12 Laps)" doesn't accidentally
    // get attributed to the Summer Vibes campaign.
    if (isGoKarting(itemName)) {
      return applyOverride({
        strategy: 'gokarting-heuristic',
        gameId: 'gokarting',
        subGameId: /\bdouble\b/i.test(itemName) ? 'double' : /\bchild\b|\bkid\b/i.test(itemName) ? 'child' : 'adult',
        vendorId: '',
        type: 'company',
        revenueShare: false,
      }, ov);
    }

    // 1. Catalog exact / fuzzy. Vendor only comes from the catalog entry
    // itself — no token bridges. If the catalog has no vendorId, the item
    // is reported with vendorId='' so admin sees it needs an override.
    if (catalog.has(lc)) {
      const e = catalog.get(lc);
      return applyOverride({
        strategy: 'catalog',
        gameId: e.gameId,
        subGameId: e.subGameId,
        variantId: e.variantId,
        vendorId: e.vendorId || '',
        type: e.vendorId ? 'thirdParty' : (e.type || 'company'),
        revenueShare: true,
      }, ov);
    }
    // Catalog fuzzy match against pre-built tokenised matchers.
    const itemTokens = new Set(tokenise(itemName));
    if (itemTokens.size > 0) {
      // Score each matcher: how many of its tokens appear in the item name?
      // Best match wins, but require at least one strong overlap to avoid
      // false positives.
      let best = null;
      let bestScore = 0;
      for (const m of fuzzyMatchers) {
        let hits = 0;
        for (const t of m.tokens) if (itemTokens.has(t)) hits++;
        // Require ALL tokens of the catalog name to be present (strong containment).
        if (hits === m.tokens.length && hits > bestScore) {
          best = m.entry;
          bestScore = hits;
        }
      }
      if (best) {
        return applyOverride({
          strategy: 'catalog-fuzzy',
          gameId: best.gameId,
          subGameId: best.subGameId,
          variantId: best.variantId,
          vendorId: best.vendorId || '',
          type: best.vendorId ? 'thirdParty' : (best.type || 'company'),
          revenueShare: true,
        }, ov);
      }
    }
    // 2. Event campaign match.
    for (const m of eventMatchers) {
      const itemTokens = new Set(tokenise(itemName));
      let ok = m.gameTokens.length > 0;
      for (const t of m.gameTokens) {
        if (!itemTokens.has(t)) { ok = false; break; }
      }
      if (ok) {
        return applyOverride({
          strategy: 'event-package',
          gameId: m.campaignSlug,
          subGameId: m.packageName,
          variantId: tokenise(m.gameName).join('_'),
          vendorId: m.vendorId,
          type: m.type,
          revenueShare: m.revenueShare,
          configPrice: m.configPrice,
        }, ov);
      }
    }
    return applyOverride({ strategy: 'unmatched' }, ov) || { strategy: 'unmatched' };
  };

  // Pull orphan bookings (or single).
  let docs;
  if (SINGLE) {
    const snap = await db.collection('bookings').doc(SINGLE).get();
    if (!snap.exists) { console.error(`Booking ${SINGLE} not found.`); process.exit(1); }
    docs = [snap];
  } else {
    const all = await db.collection('bookings').get();
    docs = [];
    all.forEach((d) => {
      const data = d.data() || {};
      if (data.cancelled === true) return;
      if (data.paymentStatus && data.paymentStatus !== 'completed') return;
      const items = Array.isArray(data.items) ? data.items : [];
      const billing = Array.isArray(data.billingItems) ? data.billingItems : [];
      const source = billing.length > 0 ? billing : items;
      let unknownCount = 0;
      for (const it of source) {
        if (!it) continue;
        if (!it.gameId || String(it.gameId).toLowerCase() === 'unknown') unknownCount++;
      }
      if (unknownCount > 0) docs.push(d);
    });
  }
  console.log(`Loaded ${docs.length} orphan booking(s).\n`);

  const previews = [];
  for (const snap of docs) {
    const data = snap.data() || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const finalAmount = Number(data.finalAmount ?? data.totalAmount ?? 0);
    const branchId = toBranchId(data.locationId);
    const txnDate = dateOnly(data.transactionDate ?? data.createdAt);

    // Extract a canonical itemName from each item. Some orphan bookings have
    // `itemName` populated; others only have `activity.name` (or
    // `activity.bookingName`). Prefer the most specific.
    const getItemName = (it) =>
      (typeof it?.itemName === 'string' && it.itemName.trim()) ||
      (typeof it?.activity?.name === 'string' && it.activity.name.trim()) ||
      (typeof it?.activity?.bookingName === 'string' && it.activity.bookingName.trim()) ||
      '';

    // Quantity: items[].quantity (default 1).
    const getQty = (it) => Math.max(1, Math.floor(Number(it?.quantity) || 1));

    // Per-item price: prefer item.unitPrice (POS), fall back to item.price /
    // qty (online), then activity.basePrice. If everything is zero AND
    // finalAmount > 0, split finalAmount equally across items as a last
    // resort.
    const getPerUnitPrice = (it) => {
      const qty = getQty(it);
      const direct = Number(it?.unitPrice);
      if (direct > 0) return direct;
      const lineTotal = Number(it?.price);
      if (lineTotal > 0 && qty > 0) return lineTotal / qty;
      const basePrice = Number(it?.activity?.basePrice);
      if (basePrice > 0) return basePrice;
      return 0;
    };

    const itemSubtotals = items.map((it) => getQty(it) * getPerUnitPrice(it));
    const totalSubtotal = itemSubtotals.reduce((a, b) => a + b, 0);
    const useFinalAmountSplit = totalSubtotal === 0 && finalAmount > 0 && items.length > 0;
    const perItemFromFinal = useFinalAmountSplit ? Math.round(finalAmount / items.length) : 0;

    const resolutions = items.map((it, idx) => {
      const itemName = getItemName(it);
      const qty = getQty(it);
      const r = resolveItem(itemName, branchId, snap.id);
      const sub = useFinalAmountSplit ? perItemFromFinal : itemSubtotals[idx];
      const unitPrice = useFinalAmountSplit ? perItemFromFinal / qty : getPerUnitPrice(it);
      const base = Math.round((sub * 100) / (100 + GST_PERCENT));
      const gst = sub - base;
      let vendorBase = 0, vendorGst = 0, vendorTotal = 0;
      if (r.vendorId && r.type === 'thirdParty') {
        const share = r.revenueShare === false ? 100 : (vendorShares.get(r.vendorId) ?? VENDOR_SHARE_DEFAULT);
        vendorBase = Math.round((base * share) / 100);
        vendorGst = Math.round((gst * share) / 100);
        vendorTotal = vendorBase + vendorGst;
      }
      return {
        itemName,
        strategy: r.strategy,
        gameId: r.gameId,
        subGameId: r.subGameId,
        variantId: r.variantId,
        vendorId: r.vendorId || '',
        type: r.type || '',
        unitPrice: Math.round(unitPrice),
        quantity: qty,
        base, gst, vendorBase, vendorGst, vendorTotal,
      };
    });

    // Bucket rules (strict):
    //   confident    → every item is unambiguous (manual-override OR
    //                  gokarting-heuristic OR catalog match where vendor
    //                  is known OR catalog match for a company-only game)
    //   needs_review → at least one item resolved a gameId but vendor
    //                  attribution is missing (admin must add override)
    //   unknown      → no item matched anything
    const isItemConfident = (r) => {
      if (r.strategy === 'unmatched') return false;
      if (r.strategy === 'manual-override') return true;
      if (r.strategy === 'gokarting-heuristic') return true; // company by design
      // Catalog hit: confident only when type='company' OR vendorId is set.
      if (r.strategy === 'catalog' || r.strategy === 'catalog-fuzzy') {
        return r.type === 'company' || Boolean(r.vendorId);
      }
      // event-package: confident only if vendorId resolved.
      if (r.strategy === 'event-package') return Boolean(r.vendorId);
      return false;
    };
    const allConfident = resolutions.every(isItemConfident);
    const anyMatched = resolutions.some((r) => r.strategy !== 'unmatched');
    const bucket = allConfident ? 'confident' : anyMatched ? 'needs_review' : 'unknown';

    // Aggregate per vendor.
    const ledgerByVendor = new Map();
    for (const r of resolutions) {
      if (!r.vendorId || r.vendorTotal <= 0) continue;
      const acc = ledgerByVendor.get(r.vendorId) ?? { vendorBase: 0, vendorGst: 0, vendorTotal: 0 };
      acc.vendorBase += r.vendorBase;
      acc.vendorGst += r.vendorGst;
      acc.vendorTotal += r.vendorTotal;
      ledgerByVendor.set(r.vendorId, acc);
    }
    const vendorIds = [...ledgerByVendor.keys()].sort();
    const totalVendorCredit = [...ledgerByVendor.values()].reduce((s, a) => s + a.vendorTotal, 0);

    previews.push({
      id: snap.id,
      branchId,
      txnDate,
      finalAmount,
      bucket,
      resolutions,
      vendorIds,
      ledgerByVendor,
      totalVendorCredit,
    });
  }

  // Print preview table.
  console.log(`─── per-booking preview ──────────────────────────────────────`);
  for (const p of previews) {
    console.log(`\n  ${p.id}    bucket=${p.bucket}    branch=${p.branchId}    date=${p.txnDate}    finalAmount=${inr(p.finalAmount)}`);
    for (const r of p.resolutions) {
      console.log(`    [${r.strategy}] ${(r.itemName || '').slice(0, 50)}`);
      console.log(`        gameId=${r.gameId || '?'}  vendorId=${r.vendorId || '(company)'}  unit=${inr(r.unitPrice)} qty=${r.quantity}  vendorTotal=${inr(r.vendorTotal)}`);
    }
    if (p.vendorIds.length > 0) {
      console.log(`    → will credit: ${p.vendorIds.join(', ')}    total ${inr(p.totalVendorCredit)}`);
    } else {
      console.log(`    → no vendor credits (company revenue or unmatched)`);
    }
  }

  // Summary.
  const confident = previews.filter((p) => p.bucket === 'confident');
  const needsReview = previews.filter((p) => p.bucket === 'needs_review');
  const unknown = previews.filter((p) => p.bucket === 'unknown');
  const totalCredit = previews.reduce((s, p) => s + p.totalVendorCredit, 0);
  console.log(`\n─── summary ─────────────────────────────────────────`);
  console.log(`  bookings scanned   : ${previews.length}`);
  console.log(`  confident          : ${confident.length}  (will write)`);
  console.log(`  needs_review       : ${needsReview.length}  (partial — will write resolved items only)`);
  console.log(`  unknown            : ${unknown.length}  (no item resolved — skipped, needs admin)`);
  console.log(`  total vendor credit: ${inr(totalCredit)}`);

  // CSV.
  if (CSV_PATH) {
    const dir = path.dirname(CSV_PATH);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = ['bookingId,bucket,branch,date,finalAmount,itemName,strategy,gameId,vendorId,unitPrice,quantity,vendorTotal'];
    const cell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    for (const p of previews) {
      for (const r of p.resolutions) {
        lines.push([p.id, p.bucket, p.branchId, p.txnDate, p.finalAmount, cell(r.itemName), r.strategy, r.gameId || '', r.vendorId || '', r.unitPrice, r.quantity, r.vendorTotal].join(','));
      }
    }
    fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf-8');
    console.log(`\nCSV written: ${CSV_PATH}`);
  }

  // Apply.
  if (APPLY) {
    console.log(`\nApplying to confident + needs_review bookings...`);
    let applied = 0, skipped = 0;
    for (const p of previews) {
      if (p.bucket === 'unknown') { skipped++; continue; }
      // Build billingItems from resolutions.
      const billingItems = p.resolutions
        .filter((r) => r.strategy !== 'unmatched')
        .map((r) => ({
          itemName: r.itemName,
          gameId: r.gameId,
          subGameId: r.subGameId,
          variantId: r.variantId,
          vendorId: r.vendorId || undefined,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          itemBaseAmount: r.base,
          itemGstAmount: r.gst,
          vendorBase: r.vendorBase || undefined,
          vendorGst: r.vendorGst || undefined,
          vendorTotal: r.vendorTotal || undefined,
          companyBase: r.vendorId ? 0 : r.base,
          companyGst: r.vendorId ? 0 : r.gst,
          companyTotal: r.vendorId ? 0 : r.base + r.gst,
        }));

      // Update booking doc.
      const patch = {
        billingItems,
        vendorIds: p.vendorIds,
        enrichmentSource: 'orphan-backfill',
        enrichmentBackfilledAt: nowIso(),
      };
      // Strip undefined.
      const clean = JSON.parse(JSON.stringify(patch));
      try {
        await db.collection('bookings').doc(p.id).set(clean, { merge: true });
      } catch (err) {
        console.error(`  ${p.id} booking update failed:`, err.message);
        skipped++;
        continue;
      }

      // Write ledger credits.
      for (const [vid, acc] of p.ledgerByVendor.entries()) {
        if (acc.vendorTotal <= 0) continue;
        const ledgerId = `le-${p.id}-${vid}`;
        try {
          await db.collection('vendorLedger').doc(ledgerId).set({
            id: ledgerId,
            vendorId: vid,
            vendorBase: acc.vendorBase,
            vendorGst: acc.vendorGst,
            amount: acc.vendorTotal,
            type: 'credit',
            referenceId: p.id,
            invoiceNumber: p.id,
            locationId: p.branchId,
            date: p.txnDate ? `${p.txnDate}T12:00:00.000Z` : nowIso(),
            createdAt: nowIso(),
            source: 'orphan-backfill',
          }, { merge: true });
        } catch (err) {
          console.error(`  ${p.id} ledger ${vid} failed:`, err.message);
        }
      }
      applied++;
    }
    console.log(`\nApplied ${applied} bookings; skipped ${skipped}.`);
  }

  console.log(APPLY ? `\nApply complete.\n` : `\nDry-run complete. Re-run with --apply to write.\n`);
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
