/**
 * Backfill missing `gameId` / `subGameId` / `variantId` on booking items so
 * they stop showing up under "unknown" in the Game Revenue report.
 *
 * Identifier source of truth (discovered via inspect-catalog-and-orphans):
 *
 *   Every booking item carries its own `activity` object. The canonical IDs
 *   are encoded directly inside it:
 *
 *     activity.id  = "activity__{branchId}__{gameTypeId}__{category}__{variantApiId}"
 *     activity.gameTypeId   → real gameId   (e.g. "gokarting", "helicopter")
 *     activity.category     → real subGameId (e.g. "adult", "child", "DOUBLE KART")
 *     activity.apiId        → real variantId (e.g. "lap_12", "lap_8")
 *     activity.locationIds  → real branchId (fallback for orphan bookings)
 *
 *   POS `billingItems[]` don't carry `activity`, but their sibling `items[i]`
 *   at the same index does — so a single booking's two arrays share the
 *   same metadata and we can cross-fill. When even that is missing, we fall
 *   back to parsing the structured `itemName` (e.g. "GOKARTING • adult • 8
 *   laps").
 *
 * Strategy (per item, best-first):
 *   1. activity.id regex             → confidence 1.00, "activity-id"
 *   2. activity.gameTypeId+category  → confidence 1.00, "activity-fields"
 *   3. parallel items[idx] if this is billingItems → inherit, "parallel-item"
 *   4. itemName pattern "A • B • C"  → confidence 0.95, "name-bullet"
 *   5. itemName pattern "A — B — C"  → confidence 0.85, "name-emdash" (combos)
 *   6. no match                      → misc-fallback (0.00)
 *
 * Branch resolution for the "no-catalog" orphans (395 bookings whose
 * `locationId` is "rajahmundry" / "kakinada" / "visakhapatnam" / "vizag"):
 *   - Build a name→branchId map from every `locations/*` doc using docId,
 *     `name`, `branchId`, and `slug` fields.
 *   - Add well-known aliases (`"vizag"` → `"0"`).
 *   - Fall back to `item.activity.locationIds[0]` when the booking's own
 *     locationId can't be resolved.
 *
 * Safety:
 *   - Dry-run by default. Writes ONLY with --confirm.
 *   - --min-confidence (default 0.80) gates auto-apply. Below it, the item
 *     still lands in the report but is NOT auto-written unless it would be
 *     the Misc fallback (which is an explicit bucket, not a match).
 *   - Never overwrites a non-empty gameId / subGameId / variantId.
 *   - Never touches price, itemName, vendorId, refund state, or any
 *     booking-level field. Skips cancelled / fully-refunded bookings and
 *     refunded items.
 *   - Idempotent — already-mapped items are ignored on re-run.
 *
 * Usage:
 *   node scripts/backfill-unknown-games.cjs                          # dry-run
 *   node scripts/backfill-unknown-games.cjs --confirm                # apply
 *   node scripts/backfill-unknown-games.cjs --branch visakhapatnam   # scope
 *   node scripts/backfill-unknown-games.cjs --min-confidence 0.90    # tighten
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
const BRANCH_FILTER = argValue('--branch');
const MIN_CONFIDENCE = Number(argValue('--min-confidence')) || 0.8;

// ─── Constants ──────────────────────────────────────────────────────────────
const DATABASE_ID = 'asquare-app-db';
const BOOKINGS_COLLECTION = 'bookings';
const LOCATIONS_COLLECTION = 'locations';
const BATCH_SIZE = 400;

const MISC_GAME_ID = 'miscellaneous';
const MISC_GAME_NAME = 'Miscellaneous';
const MISC_SUBGAME_ID = 'custom';
const MISC_SUBGAME_NAME = 'Custom';
const MISC_VARIANT_ID = 'misc';
const MISC_VARIANT_LABEL = 'Miscellaneous';

// Well-known short-name aliases pointing at a real `locations/{id}` docId.
// Keep tightly scoped — every addition is a manual-trust decision.
const SLUG_ALIASES = {
  vizag: '0',
};

const REPORT_PATH = path.resolve('backfill-unknown-games-report.json');
const APPLIED_PATH = path.resolve('backfill-unknown-games-applied.json');

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

const norm = (s) => String(s ?? '').toLowerCase().trim();

function buildBranchResolver(locationsSnap) {
  // branchId → { hasMisc: bool, docId: string }
  const branchMeta = new Map();
  // Any accepted alias (lowercase) → docId used as branchId.
  const aliasToDocId = new Map();

  for (const locDoc of locationsSnap.docs) {
    const data = locDoc.data();
    const docId = locDoc.id;

    const games = Array.isArray(data.games) ? data.games : [];
    const hasMisc = games.some(
      (g) =>
        g &&
        g.id === MISC_GAME_ID &&
        Array.isArray(g.subGames) &&
        g.subGames.some(
          (sg) =>
            sg &&
            sg.id === MISC_SUBGAME_ID &&
            Array.isArray(sg.variants) &&
            sg.variants.some((v) => v && v.id === MISC_VARIANT_ID),
        ),
    );
    branchMeta.set(docId, { hasMisc, docId });

    const addAlias = (v) => {
      const key = norm(v);
      if (!key) return;
      if (!aliasToDocId.has(key)) aliasToDocId.set(key, docId);
    };

    addAlias(docId);
    addAlias(data.name);
    addAlias(data.displayName);
    addAlias(data.slug);
    addAlias(data.branchId);
  }

  for (const [alias, docId] of Object.entries(SLUG_ALIASES)) {
    if (branchMeta.has(docId)) aliasToDocId.set(alias, docId);
  }

  return {
    branchMeta,
    resolve(locationId, activityLocationIds) {
      const direct = aliasToDocId.get(norm(locationId));
      if (direct) return direct;
      const first = Array.isArray(activityLocationIds) ? activityLocationIds[0] : undefined;
      const viaActivity = first ? aliasToDocId.get(norm(first)) : undefined;
      return viaActivity ?? null;
    },
  };
}

/** Parse `activity__{branch}__{game}__{category}__{variant}`. */
function parseActivityId(id) {
  if (typeof id !== 'string') return null;
  const m = id.match(/^activity__([^_]+)__([^_]+)__([^_]+)__(.+)$/);
  if (!m) return null;
  const [, branchId, gameTypeId, category, variantApiId] = m;
  return { branchId, gameTypeId, category, variantApiId };
}

function isTrustworthyGameTypeId(value, knownBranchIds) {
  const s = String(value ?? '').trim();
  if (!s) return false;
  // Pure-numeric strings are almost always a branch id mis-stored as gameTypeId.
  if (/^\d+$/.test(s)) return false;
  if (knownBranchIds.has(s)) return false;
  return true;
}

function matchFromActivity(activity, knownBranchIds) {
  if (!activity || typeof activity !== 'object') return null;

  const parsed = parseActivityId(activity.id || activity.apiId);
  if (parsed && isTrustworthyGameTypeId(parsed.gameTypeId, knownBranchIds)) {
    return {
      strategy: 'activity-id',
      confidence: 1.0,
      gameId: norm(parsed.gameTypeId),
      subGameId: norm(parsed.category),
      variantId: norm(parsed.variantApiId),
      variantLabel: activity.name || null,
    };
  }

  const gameTypeId = typeof activity.gameTypeId === 'string' ? activity.gameTypeId.trim() : '';
  const category = typeof activity.category === 'string' ? activity.category.trim() : '';
  if (gameTypeId && category && isTrustworthyGameTypeId(gameTypeId, knownBranchIds)) {
    return {
      strategy: 'activity-fields',
      confidence: 1.0,
      gameId: norm(gameTypeId),
      subGameId: norm(category),
      variantId:
        typeof activity.apiId === 'string' && activity.apiId.trim() ? norm(activity.apiId) : null,
      variantLabel: activity.name || null,
    };
  }

  if (gameTypeId && isTrustworthyGameTypeId(gameTypeId, knownBranchIds)) {
    return {
      strategy: 'activity-game-only',
      confidence: 0.7,
      gameId: norm(gameTypeId),
      subGameId: null,
      variantId: null,
      variantLabel: activity.name || null,
    };
  }

  return null;
}

/** Convert "5 Laps" / "12 LAPS" / "8 laps" → "lap_5" / "lap_12" / "lap_8". */
function slugifyVariant(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  const lap = s.match(/(\d+)\s*laps?/);
  if (lap) return `lap_${lap[1]}`;
  return s.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || null;
}

function matchFromItemName(itemName) {
  const s = String(itemName ?? '').trim();
  if (!s) return null;

  // Pattern A — "GAME • SUBGAME • VARIANT" (bullet-separated, canonical POS format).
  const bulletParts = s.split(/\s*•\s*/);
  if (bulletParts.length >= 3) {
    const [game, subGame, ...rest] = bulletParts;
    const variant = rest.join(' • ');
    return {
      strategy: 'name-bullet',
      confidence: 0.95,
      gameId: norm(game).replace(/\s+/g, ''),
      subGameId: norm(subGame),
      variantId: slugifyVariant(variant),
      variantLabel: s,
    };
  }

  // Pattern B — "SUMMER VIBES — COMBO N — ACTIVITY" (em-dash combo format).
  const dashParts = s.split(/\s*—\s*/);
  if (dashParts.length >= 3) {
    const [pack, combo, ...rest] = dashParts;
    const activity = rest.join(' — ');
    return {
      strategy: 'name-emdash',
      confidence: 0.85,
      gameId: norm(pack).replace(/\s+/g, '-'),
      subGameId: norm(combo).replace(/\s+/g, '-'),
      variantId: norm(activity).replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || null,
      variantLabel: s,
    };
  }

  return null;
}

function miscFallback() {
  return {
    strategy: 'misc-fallback',
    confidence: 0.0,
    gameId: MISC_GAME_ID,
    subGameId: MISC_SUBGAME_ID,
    variantId: null,
    variantLabel: MISC_VARIANT_LABEL,
  };
}

function matchItem(item, parallelItem, knownBranchIds) {
  // Prefer the item's own activity block, then the sibling items[idx] for
  // billingItems that don't carry activity metadata, then the itemName
  // shape. Every match preserves item.itemName / price etc. exactly —
  // we only attach IDs.
  return (
    matchFromActivity(item && item.activity, knownBranchIds) ??
    matchFromActivity(parallelItem && parallelItem.activity, knownBranchIds) ??
    matchFromItemName(item && item.itemName) ??
    null
  );
}

function isItemUnknown(item) {
  return !item || !item.gameId || !item.subGameId;
}

function isBookingEligible(data) {
  if (data.paymentStatus !== 'completed') return false;
  if (data.cancelled === true) return false;
  if (data.refundStatus === 'Full') return false;
  return true;
}

function applyMatchToItem(item, match) {
  // Never overwrite a non-empty field. Only fill missing slots.
  const next = { ...item };
  if (!next.gameId) next.gameId = match.gameId;
  if (!next.subGameId && match.subGameId) next.subGameId = match.subGameId;
  if (!next.variantId && match.variantId) next.variantId = match.variantId;
  return next;
}

function buildPatchedArray(original, patchByIdx, applyFn) {
  return original.map((item, idx) => {
    const patch = patchByIdx.get(idx);
    if (!patch) return item;
    return applyFn(item, patch);
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  ${tag} Backfill unknown-game items`);
  console.log('══════════════════════════════════════════════════════════════');
  if (BRANCH_FILTER) console.log(`  Branch filter    : ${BRANCH_FILTER}`);
  console.log(`  Min confidence   : ${MIN_CONFIDENCE}`);
  console.log(`  Report path      : ${REPORT_PATH}`);
  console.log();

  const locationsSnap = await db.collection(LOCATIONS_COLLECTION).get();
  const { branchMeta, resolve: resolveBranch } = buildBranchResolver(locationsSnap);
  const knownBranchIds = new Set(branchMeta.keys());
  console.log(`  Known branches   : ${[...branchMeta.keys()].join(', ')}`);

  if (!DRY_RUN) {
    const missing = [];
    for (const [branchId, meta] of branchMeta.entries()) {
      if (BRANCH_FILTER && branchId !== BRANCH_FILTER) continue;
      if (!meta.hasMisc) missing.push(branchId);
    }
    if (missing.length > 0) {
      console.error(
        `\n[ABORT] Miscellaneous catalog entry is missing in branches: ${missing.join(', ')}`,
      );
      console.error('        Run:  node scripts/seed-misc-catalog-entry.cjs --confirm  first.');
      process.exit(1);
    }
  }

  const bookingsSnap = await db.collection(BOOKINGS_COLLECTION).get();
  console.log(`  Bookings loaded  : ${bookingsSnap.size}\n`);

  const proposals = [];
  const stats = {
    'activity-id': 0,
    'activity-fields': 0,
    'activity-game-only': 0,
    'name-bullet': 0,
    'name-emdash': 0,
    'misc-fallback': 0,
    skippedNoBranch: 0,
    skippedIneligible: 0,
  };

  for (const docSnap of bookingsSnap.docs) {
    const data = docSnap.data();
    if (!isBookingEligible(data)) {
      stats.skippedIneligible++;
      continue;
    }

    const rawLocationId = String(data.locationId ?? data.branchId ?? '').trim();
    const items = Array.isArray(data.items) ? data.items : [];
    const billingItems = Array.isArray(data.billingItems) ? data.billingItems : [];

    // Use the first non-refunded item's activity.locationIds as fallback.
    const activityLocationIds =
      items.find((i) => i && i.activity && Array.isArray(i.activity.locationIds))?.activity
        ?.locationIds;

    const resolvedBranchId = resolveBranch(rawLocationId, activityLocationIds);
    if (!resolvedBranchId) {
      stats.skippedNoBranch++;
      continue;
    }
    if (BRANCH_FILTER && resolvedBranchId !== BRANCH_FILTER) continue;

    const itemPatches = new Map();
    const billingPatches = new Map();

    items.forEach((item, idx) => {
      if (!item || item.refunded === true) return;
      if (!isItemUnknown(item)) return;
      const match = matchItem(item, null, knownBranchIds) ?? miscFallback();
      itemPatches.set(idx, match);
    });

    billingItems.forEach((item, idx) => {
      if (!item || item.refunded === true) return;
      if (!isItemUnknown(item)) return;
      const parallel = items[idx] ?? null;
      const match = matchItem(item, parallel, knownBranchIds) ?? miscFallback();
      billingPatches.set(idx, match);
    });

    if (itemPatches.size === 0 && billingPatches.size === 0) continue;

    const surface = (sourceName, patchMap, sourceArr) => {
      for (const [idx, match] of patchMap.entries()) {
        const original = sourceArr[idx] ?? {};
        stats[match.strategy] = (stats[match.strategy] ?? 0) + 1;
        proposals.push({
          bookingId: docSnap.id,
          rawLocationId,
          resolvedBranchId,
          source: sourceName,
          itemIndex: idx,
          itemName: String(original.itemName ?? '').trim(),
          current: {
            gameId: original.gameId ?? null,
            subGameId: original.subGameId ?? null,
            variantId: original.variantId ?? null,
          },
          proposed: {
            gameId: match.gameId,
            subGameId: match.subGameId,
            variantId: match.variantId,
            variantLabel: match.variantLabel,
          },
          confidence: match.confidence,
          strategy: match.strategy,
        });
      }
    };
    surface('items', itemPatches, items);
    surface('billingItems', billingPatches, billingItems);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: DRY_RUN ? 'dry-run' : 'commit',
    branchFilter: BRANCH_FILTER ?? null,
    minConfidence: MIN_CONFIDENCE,
    totalBookingsScanned: bookingsSnap.size,
    unknownItemsFound: proposals.length,
    stats,
    proposals,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`  Report written   : ${REPORT_PATH}`);
  console.log(`  Proposals        : ${proposals.length}`);
  console.log(`    activity-id       : ${stats['activity-id']}`);
  console.log(`    activity-fields   : ${stats['activity-fields']}`);
  console.log(`    activity-game-only: ${stats['activity-game-only']}`);
  console.log(`    name-bullet       : ${stats['name-bullet']}`);
  console.log(`    name-emdash       : ${stats['name-emdash']}`);
  console.log(`    misc-fallback     : ${stats['misc-fallback']}`);
  console.log(
    `  Skipped          : ineligible=${stats.skippedIneligible}, unresolved-branch=${stats.skippedNoBranch}`,
  );

  if (DRY_RUN) {
    console.log(`\n  Dry run — review ${path.basename(REPORT_PATH)}, then re-run with --confirm.`);
    process.exit(0);
  }

  const byBooking = new Map();
  for (const p of proposals) {
    if (p.confidence < MIN_CONFIDENCE && p.strategy !== 'misc-fallback') continue;
    if (!byBooking.has(p.bookingId)) byBooking.set(p.bookingId, []);
    byBooking.get(p.bookingId).push(p);
  }

  console.log(`\n  Will update ${byBooking.size} bookings...`);
  const applied = [];
  const bookingIds = Array.from(byBooking.keys());

  for (let i = 0; i < bookingIds.length; i += BATCH_SIZE) {
    const slice = bookingIds.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const bookingId of slice) {
      const ref = db.collection(BOOKINGS_COLLECTION).doc(bookingId);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const data = snap.data();
      if (!isBookingEligible(data)) continue;

      const proposalsForBooking = byBooking.get(bookingId);
      const itemPatches = new Map();
      const billingPatches = new Map();
      for (const p of proposalsForBooking) {
        if (p.source === 'items') itemPatches.set(p.itemIndex, p);
        else billingPatches.set(p.itemIndex, p);
      }

      const update = {};
      if (itemPatches.size > 0) {
        update.items = buildPatchedArray(
          Array.isArray(data.items) ? data.items : [],
          itemPatches,
          (item, p) => applyMatchToItem(item, p.proposed),
        );
      }
      if (billingPatches.size > 0) {
        update.billingItems = buildPatchedArray(
          Array.isArray(data.billingItems) ? data.billingItems : [],
          billingPatches,
          (item, p) => applyMatchToItem(item, p.proposed),
        );
      }
      if (Object.keys(update).length === 0) continue;

      batch.update(ref, update);

      applied.push({
        bookingId,
        patches: proposalsForBooking.map((p) => ({
          source: p.source,
          itemIndex: p.itemIndex,
          itemName: p.itemName,
          strategy: p.strategy,
          confidence: p.confidence,
          proposed: p.proposed,
        })),
      });
    }

    await batch.commit();
    console.log(`  Committed batch  : ${Math.min(i + BATCH_SIZE, bookingIds.length)} / ${bookingIds.length}`);
  }

  fs.writeFileSync(
    APPLIED_PATH,
    JSON.stringify(
      {
        appliedAt: new Date().toISOString(),
        minConfidence: MIN_CONFIDENCE,
        bookingsUpdated: applied.length,
        patches: applied,
      },
      null,
      2,
    ),
  );
  console.log(`\n  Applied log      : ${APPLIED_PATH}`);
  console.log(`  Bookings updated : ${applied.length}`);
  console.log('  Done.');

  process.exit(0);
})().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
