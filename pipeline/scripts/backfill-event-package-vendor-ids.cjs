/**
 * Backfill `vendorIds[]` on bookings whose event-package items haven't
 * been attributed to their owning vendors.
 *
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 * Event-package items (Summer Vibes, Halloween, etc.) carry no `vendorId`
 * on `items[]` or `billingItems[]`. Vendor identity lives only in the
 * `EventCampaign.packages[].items[]` config. The earlier
 * `backfill-booking-vendor-ids.cjs` reads only item-level `vendorId`, so
 * event-package vendors were silently left out of `vendorIds[]` and
 * therefore invisible to the ThirdParty bookings query.
 *
 * This script:
 *   1. Loads every EventCampaign and builds vendorId → set(gameName).
 *   2. Scans every booking. For each item with no `vendorId`, tries to
 *      match its name against the configured game names; the matching
 *      vendor IDs are added to a derived expected set.
 *   3. The new `vendorIds` is the UNION of (a) IDs already stamped from
 *      flat-item vendors and (b) IDs derived from event-package matches.
 *      We never remove existing IDs.
 *   4. Writes the new array via `set({ vendorIds }, { merge: true })`.
 *
 * Read-only by default. Pass `--apply` to write.
 *
 * Usage:
 *   node scripts/backfill-event-package-vendor-ids.cjs                 # dry-run
 *   node scripts/backfill-event-package-vendor-ids.cjs --apply
 *   node scripts/backfill-event-package-vendor-ids.cjs --booking ASG... # spot-check
 *   node scripts/backfill-event-package-vendor-ids.cjs --batch 200
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
const BATCH_SIZE = Number(argValue('--batch') ?? '400');

if (!Number.isFinite(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > 500) {
  console.error('--batch must be 1..500');
  process.exit(1);
}

const DATABASE_ID = 'asquare-app-db';
const BOOKINGS_COLLECTION = 'bookings';
const EVENT_CAMPAIGNS_COLLECTION = 'eventCampaigns';

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

// Tokenise / match — must stay in sync with
// `audit-event-package-vendor-visibility.cjs` and the runtime resolution
// in `AccountingModule.tsx`.
const STOPWORDS = new Set(['the', 'and', 'or', 'of', 'a', 'an', 'with', 'free']);
const tokenise = (s) => {
  if (typeof s !== 'string') return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
};
const itemMatchesGameName = (itemName, gameName) => {
  const itemTokens = new Set(tokenise(itemName));
  const gameTokens = tokenise(gameName);
  if (itemTokens.size === 0 || gameTokens.length === 0) return false;
  for (const t of gameTokens) {
    if (!itemTokens.has(t)) return false;
  }
  return true;
};

(async () => {
  console.log(`\n┌─ event-package vendorIds backfill (${APPLY ? 'APPLY' : 'dry-run'}) ───┐`);
  if (SINGLE) console.log(`│ booking: ${SINGLE}`);
  console.log(`└──────────────────────────────────────────────────────────────────┘\n`);

  // 1. Load EventCampaigns.
  const campaignSnap = await db.collection(EVENT_CAMPAIGNS_COLLECTION).get();
  const vendorGameNamesById = new Map();
  campaignSnap.forEach((d) => {
    const c = d.data() || {};
    const packages = Array.isArray(c.packages) ? c.packages : [];
    for (const pkg of packages) {
      const items = Array.isArray(pkg && pkg.items) ? pkg.items : [];
      for (const it of items) {
        if (!it) continue;
        const vid = typeof it.vendorId === 'string' ? it.vendorId.trim() : '';
        const name = typeof it.name === 'string' ? it.name.trim() : '';
        if (!vid || !name) continue;
        const set = vendorGameNamesById.get(vid) ?? new Set();
        set.add(name);
        vendorGameNamesById.set(vid, set);
      }
    }
  });
  console.log(`Loaded ${vendorGameNamesById.size} vendor attributions across ${campaignSnap.size} campaigns.\n`);

  if (vendorGameNamesById.size === 0) {
    console.log('No vendor attributions in EventCampaigns. Nothing to backfill.');
    process.exit(0);
  }

  // 2. Scan bookings.
  let docs;
  if (SINGLE) {
    const snap = await db.collection(BOOKINGS_COLLECTION).doc(SINGLE).get();
    if (!snap.exists) { console.error(`Booking ${SINGLE} not found.`); process.exit(1); }
    docs = [snap];
  } else {
    docs = (await db.collection(BOOKINGS_COLLECTION).get()).docs;
  }
  console.log(`Loaded ${docs.length} booking${docs.length === 1 ? '' : 's'}.\n`);

  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  let noEventItems = 0;
  let errors = 0;
  const samples = [];

  let batch = db.batch();
  let pending = 0;

  for (const snap of docs) {
    scanned++;
    try {
      const data = snap.data() || {};
      const items = Array.isArray(data.items) ? data.items : [];

      // Existing vendorIds — never remove anything from here.
      const existing = new Set();
      if (Array.isArray(data.vendorIds)) {
        for (const v of data.vendorIds) {
          if (typeof v === 'string' && v.trim()) existing.add(v.trim());
        }
      }
      // Pull in flat-item vendor IDs too so we union over both sources.
      for (const it of items) {
        const vid = typeof it?.vendorId === 'string' ? it.vendorId.trim() : '';
        if (vid) existing.add(vid);
      }

      // Walk items with no vendorId, find vendor matches via campaign config.
      const fromEvent = new Set();
      let anyEventMatch = false;
      for (const it of items) {
        if (!it) continue;
        const vid = typeof it.vendorId === 'string' ? it.vendorId.trim() : '';
        if (vid) continue;
        const itemName = typeof it.itemName === 'string' ? it.itemName : '';
        const activityName =
          typeof (it.activity && it.activity.name) === 'string' ? it.activity.name : '';
        const candidate = itemName || activityName;
        if (!candidate) continue;
        for (const [vendorId, gameNames] of vendorGameNamesById.entries()) {
          for (const gn of gameNames) {
            if (itemMatchesGameName(candidate, gn)) {
              fromEvent.add(vendorId);
              anyEventMatch = true;
              break;
            }
          }
        }
      }

      if (!anyEventMatch) {
        noEventItems++;
        continue;
      }

      // Union: existing ∪ fromEvent.
      const next = new Set([...existing, ...fromEvent]);
      const nextArr = [...next].sort();
      const existingArr = [...existing].sort();

      if (nextArr.length === existingArr.length && nextArr.every((v, i) => v === existingArr[i])) {
        unchanged++;
        continue;
      }

      const added = nextArr.filter((v) => !existing.has(v));
      if (samples.length < 10) {
        samples.push({ id: snap.id, before: existingArr, after: nextArr, added });
      }

      if (APPLY) {
        batch.set(snap.ref, { vendorIds: nextArr }, { merge: true });
        pending++;
        if (pending >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          pending = 0;
        }
      }
      updated++;
    } catch (err) {
      errors++;
      console.error(`Error on ${snap.id}:`, err.message);
    }
  }

  if (APPLY && pending > 0) await batch.commit();

  console.log(`─── summary ─────────────────────────────────────────────`);
  console.log(`  scanned            : ${scanned}`);
  console.log(`  ${APPLY ? 'updated            ' : 'would update       '}: ${updated}`);
  console.log(`  unchanged          : ${unchanged}`);
  console.log(`  no event-pkg items : ${noEventItems}`);
  console.log(`  errors             : ${errors}`);

  if (samples.length > 0) {
    console.log(`\n─── sample changes (${samples.length} of ${updated}) ───────────────`);
    for (const s of samples) {
      console.log(`  ${s.id}`);
      console.log(`    before: ${JSON.stringify(s.before)}`);
      console.log(`    after : ${JSON.stringify(s.after)}`);
      console.log(`    added : ${JSON.stringify(s.added)}`);
    }
  }

  console.log(APPLY ? `\nApply complete.\n` : `\nDry-run complete. Re-run with --apply to write.\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
