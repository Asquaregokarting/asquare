/**
 * Read-only diagnostic for the Game Revenue backfill.
 *
 * Prints:
 *   1. The actual game / subGame / variant names in every `locations/*` doc,
 *      so we can see how catalog names are spelled vs. how item names are
 *      spelled on bookings.
 *   2. A sample of 10 "orphan" bookings — eligible bookings whose
 *      `locationId` does not match any `locations/{docId}`. These are the
 *      395 that the backfill skipped. Shows their locationId, source,
 *      and first few items so we can figure out how to map them to a real
 *      branch.
 *   3. A handful of the still-unknown items grouped by name, with the exact
 *      shape of the item document — confirms what my matcher is working
 *      with.
 *
 * Read-only. Never writes to Firestore.
 *
 * Usage:
 *   node scripts/inspect-catalog-and-orphans.cjs
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

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

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  INSPECT: catalog shape & orphan bookings');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ─── 1. Catalog shape ────────────────────────────────────────────────────
  const locationsSnap = await db.collection('locations').get();
  console.log(`Locations: ${locationsSnap.size} docs\n`);

  const knownBranchIds = new Set(locationsSnap.docs.map((d) => d.id));

  for (const locDoc of locationsSnap.docs) {
    const loc = locDoc.data();
    console.log(`─── locations/${locDoc.id} ───`);
    console.log(`  displayName : ${loc.displayName ?? '(none)'}`);
    console.log(`  name        : ${loc.name ?? '(none)'}`);
    console.log(`  slug        : ${loc.slug ?? '(none)'}`);
    console.log(`  branchId    : ${loc.branchId ?? '(none)'}`);
    console.log(`  disabled    : ${loc.disabled ?? false}`);
    const games = Array.isArray(loc.games) ? loc.games : [];
    console.log(`  games[]     : ${games.length} entries`);
    for (const g of games) {
      const status = g.status ?? 'Active';
      const sgs = Array.isArray(g.subGames) ? g.subGames : [];
      console.log(`    ├─ id="${g.id}" name="${g.name}" status=${status}  (subGames: ${sgs.length})`);
      for (const sg of sgs) {
        const vs = Array.isArray(sg.variants) ? sg.variants : [];
        console.log(`    │    ├─ id="${sg.id}" name="${sg.name}"  (variants: ${vs.length})`);
        for (const v of vs) {
          const active = v.active !== false;
          console.log(
            `    │    │    └─ id="${v.id}" label="${v.label}" price=${v.price ?? '?'} active=${active}`,
          );
        }
      }
    }
    console.log();
  }

  // ─── 2. Orphan bookings ──────────────────────────────────────────────────
  const bookingsSnap = await db.collection('bookings').get();
  console.log('─── Orphan bookings (eligible but locationId not in locations/*) ───');

  const orphans = [];
  const orphanLocationIds = new Map(); // locationId → count
  const blankLocationIds = [];

  for (const docSnap of bookingsSnap.docs) {
    const d = docSnap.data();
    if (d.paymentStatus !== 'completed') continue;
    if (d.cancelled === true) continue;
    if (d.refundStatus === 'Full') continue;

    const locationId = String(d.locationId ?? d.branchId ?? '').trim();
    if (!locationId) {
      blankLocationIds.push({ id: docSnap.id, source: d.source, createdAt: d.createdAt });
      continue;
    }

    if (knownBranchIds.has(locationId)) continue;

    orphans.push({
      bookingId: docSnap.id,
      locationId,
      branchId: d.branchId ?? null,
      source: d.source,
      createdByRole: d.createdByRole,
      sampleItemNames: (Array.isArray(d.items) ? d.items : [])
        .slice(0, 3)
        .map((it) => String(it.itemName ?? '')),
    });
    orphanLocationIds.set(locationId, (orphanLocationIds.get(locationId) ?? 0) + 1);
  }

  console.log(`  Total orphans        : ${orphans.length}`);
  console.log(`  Blank locationId     : ${blankLocationIds.length}`);
  console.log(`\n  LocationId frequency (top 10):`);
  const sorted = [...orphanLocationIds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [lid, n] of sorted) console.log(`    ${String(n).padStart(4)} × "${lid}"`);

  console.log('\n  Sample orphan bookings (first 10):');
  for (const o of orphans.slice(0, 10)) {
    console.log(`    ${o.bookingId}`);
    console.log(`      locationId = "${o.locationId}", branchId = ${JSON.stringify(o.branchId)}`);
    console.log(`      source = ${o.source}, createdByRole = ${o.createdByRole ?? '-'}`);
    console.log(`      items[0..2]: ${JSON.stringify(o.sampleItemNames)}`);
  }

  // ─── 3. Sample item shape ────────────────────────────────────────────────
  console.log('\n─── Sample items that went to Miscellaneous ───');
  const reportPath = path.resolve('backfill-unknown-games-report.json');
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    const seenNames = new Set();
    let shown = 0;
    for (const p of report.proposals) {
      if (p.strategy !== 'misc-fallback') continue;
      const key = `${p.branchId}::${p.itemName}`;
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      if (shown >= 10) break;

      // Re-read the item to see its actual shape in Firestore
      const snap = await db.collection('bookings').doc(p.bookingId).get();
      if (!snap.exists) continue;
      const arr = Array.isArray(snap.data()[p.source]) ? snap.data()[p.source] : [];
      const item = arr[p.itemIndex];
      if (!item) continue;

      console.log(
        `\n  branch=${p.branchId}  bookingId=${p.bookingId}  ${p.source}[${p.itemIndex}]:`,
      );
      console.log(`    ${JSON.stringify(item, null, 2).split('\n').join('\n    ')}`);
      shown++;
    }
  } else {
    console.log('  (no backfill-unknown-games-report.json present — skip this section)');
  }

  console.log('\nDone.\n');
  process.exit(0);
})().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
