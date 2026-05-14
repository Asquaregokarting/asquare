/**
 * Audit which event-package vendors are missing from `vendorIds[]` on
 * historical bookings.
 *
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 * Multi-vendor combos that go through `unified-booking.ts` and
 * `billing-firestore.ts:recordTransaction` correctly stamp every vendor
 * onto each item's `vendorId`. Event-package bookings (Summer Vibes,
 * Halloween, etc.) do NOT — vendor attribution lives only in the
 * `EventCampaign.packages[].items[]` config (each item has `vendorId` +
 * `name`). The runtime resolves vendors at view-time by substring-matching
 * each booking item's name against the configured game names.
 *
 * Result: vendors who only own event-package items on a booking never
 * appear in `vendorIds[]`, so the ThirdParty bookings module's
 * `array-contains` query never surfaces those bookings to them.
 *
 * This script:
 *   1. Loads every EventCampaign and builds vendorId → set(gameName) map.
 *   2. Scans all bookings.
 *   3. For each booking item with no vendorId, checks if its name matches
 *      any vendor's configured game names (substring match, ANY token).
 *   4. Reports how many event-package vendor IDs each booking is missing
 *      from `vendorIds[]`, plus per-vendor totals.
 *
 * Read-only. No flags except optional `--csv`.
 *
 * Usage:
 *   node scripts/audit-event-package-vendor-visibility.cjs
 *   node scripts/audit-event-package-vendor-visibility.cjs --csv reports/event-vendor-visibility.csv
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const CSV_PATH = argValue('--csv');

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

const pad = (s, w) => String(s ?? '').padEnd(w);
const padR = (s, w) => String(s ?? '').padStart(w);

// Tokenise a string for substring matching: lowercase, split on
// non-alphanumeric, drop short stopwords, preserve order.
const STOPWORDS = new Set(['the', 'and', 'or', 'of', 'a', 'an', 'with', 'free']);
const tokenise = (s) => {
  if (typeof s !== 'string') return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
};

// True when `gameName` is "contained" in `itemName` per the AccountingModule
// memory note: ANY-token substring match — every token of gameName appears
// somewhere in itemName.
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
  console.log(`\n┌─ event-package vendor visibility audit (read-only) ─────────┐`);
  console.log(`│ database: ${DATABASE_ID}`);
  console.log(`└─────────────────────────────────────────────────────────────┘\n`);

  // 1. Load EventCampaigns → build vendor → set(gameName) map.
  const campaignSnap = await db.collection(EVENT_CAMPAIGNS_COLLECTION).get();
  const vendorGameNamesById = new Map(); // vendorId → Set<gameName>
  const allEventGameNames = new Map(); // gameNameLower → vendorId (single-vendor lookup; ambiguous → kept as Set)
  let pkgCount = 0;
  let pkgItemCount = 0;
  let attribCount = 0;

  campaignSnap.forEach((d) => {
    const c = d.data() || {};
    const packages = Array.isArray(c.packages) ? c.packages : [];
    for (const pkg of packages) {
      pkgCount++;
      const items = Array.isArray(pkg && pkg.items) ? pkg.items : [];
      for (const it of items) {
        pkgItemCount++;
        if (!it) continue;
        const vid = typeof it.vendorId === 'string' ? it.vendorId.trim() : '';
        const name = typeof it.name === 'string' ? it.name.trim() : '';
        if (!vid || !name) continue;
        attribCount++;
        const set = vendorGameNamesById.get(vid) ?? new Set();
        set.add(name);
        vendorGameNamesById.set(vid, set);
      }
    }
  });

  console.log(`Event campaigns: ${campaignSnap.size}`);
  console.log(`  packages           : ${pkgCount}`);
  console.log(`  package items      : ${pkgItemCount}`);
  console.log(`  vendor attributions: ${attribCount}`);
  console.log(`  unique vendors     : ${vendorGameNamesById.size}\n`);

  if (vendorGameNamesById.size === 0) {
    console.log('No vendor attributions found in EventCampaigns. Nothing to audit.');
    process.exit(0);
  }

  // 2. Scan bookings.
  const bookingsSnap = await db.collection(BOOKINGS_COLLECTION).get();
  console.log(`Loaded ${bookingsSnap.size} bookings.\n`);

  let totalEventBookings = 0;          // bookings with >=1 event-package item match
  let bookingsFullyVisible = 0;        // every expected vendor is in vendorIds[]
  let bookingsWithMissingVendors = 0;  // some expected vendor not in vendorIds[]
  let totalMissingPairs = 0;           // sum of (expected − present) across all bookings

  // Per-vendor: how many bookings they should appear on but don't.
  const missingByVendor = new Map(); // vendorId → count
  const sampleByVendor = new Map();  // vendorId → sample booking IDs

  bookingsSnap.forEach((d) => {
    const data = d.data() || {};
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) return;

    // Collect already-stamped vendor IDs (from items[].vendorId and the
    // top-level vendorIds[] field).
    const present = new Set();
    if (Array.isArray(data.vendorIds)) {
      for (const v of data.vendorIds) {
        if (typeof v === 'string' && v.trim()) present.add(v.trim());
      }
    }
    for (const it of items) {
      const vid = typeof it?.vendorId === 'string' ? it.vendorId.trim() : '';
      if (vid) present.add(vid);
    }

    // For each item with no vendorId, find which configured vendor's game
    // name matches the item's name. Multiple vendors may match if game
    // names overlap.
    const expectedFromEvent = new Set();
    let anyEventMatch = false;
    for (const it of items) {
      if (!it) continue;
      const vid = typeof it.vendorId === 'string' ? it.vendorId.trim() : '';
      if (vid) continue; // already attributed at item level
      const itemName = typeof it.itemName === 'string' ? it.itemName : '';
      const activityName =
        typeof (it.activity && it.activity.name) === 'string' ? it.activity.name : '';
      const candidate = itemName || activityName;
      if (!candidate) continue;
      for (const [vendorId, gameNames] of vendorGameNamesById.entries()) {
        for (const gn of gameNames) {
          if (itemMatchesGameName(candidate, gn)) {
            expectedFromEvent.add(vendorId);
            anyEventMatch = true;
            break;
          }
        }
      }
    }

    if (!anyEventMatch) return;
    totalEventBookings++;

    // Missing = expected ∖ present
    const missing = [];
    for (const vid of expectedFromEvent) {
      if (!present.has(vid)) missing.push(vid);
    }

    if (missing.length === 0) {
      bookingsFullyVisible++;
    } else {
      bookingsWithMissingVendors++;
      totalMissingPairs += missing.length;
      for (const vid of missing) {
        missingByVendor.set(vid, (missingByVendor.get(vid) ?? 0) + 1);
        const list = sampleByVendor.get(vid) ?? [];
        if (list.length < 5) list.push(d.id);
        sampleByVendor.set(vid, list);
      }
    }
  });

  console.log(`─── summary ─────────────────────────────────────────────`);
  console.log(`  Bookings with >=1 event-package match  : ${totalEventBookings}`);
  console.log(`  Fully visible (no vendor missing)      : ${bookingsFullyVisible}`);
  console.log(`  Missing >=1 event-package vendor       : ${bookingsWithMissingVendors}`);
  console.log(`  Total (booking, vendor) pairs missing  : ${totalMissingPairs}\n`);

  if (missingByVendor.size > 0) {
    console.log(`─── per-vendor: bookings they should see but don't ───────`);
    console.log(pad('vendorId', 14) + padR('missingFrom', 14) + '  sample booking ids');
    console.log('─'.repeat(80));
    const sorted = [...missingByVendor.entries()].sort((a, b) => b[1] - a[1]);
    for (const [vid, count] of sorted) {
      const samples = (sampleByVendor.get(vid) ?? []).slice(0, 5).join(', ');
      console.log(pad(vid, 14) + padR(count, 14) + '  ' + samples);
    }
  } else {
    console.log(`No event-package vendor visibility gaps detected.`);
  }

  if (CSV_PATH) {
    const dir = path.dirname(CSV_PATH);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = ['vendorId,bookingsMissing,sample1,sample2,sample3,sample4,sample5'];
    const sorted = [...missingByVendor.entries()].sort((a, b) => b[1] - a[1]);
    for (const [vid, count] of sorted) {
      const samples = sampleByVendor.get(vid) ?? [];
      lines.push([vid, count, ...samples, '', '', '', '', ''].slice(0, 7).join(','));
    }
    fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf-8');
    console.log(`\nCSV written: ${CSV_PATH}`);
  }

  console.log(`\nRead-only run complete.\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
