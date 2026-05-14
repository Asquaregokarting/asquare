/**
 * Seed a canonical "Miscellaneous / Custom / Miscellaneous" catalog entry on
 * every `locations/{id}` document. This entry is the safe escape hatch for
 * ad-hoc items (e.g. snack sales, one-off charges) and the fallback bucket
 * used by the backfill-unknown-games script when an item can't be matched to
 * a real game.
 *
 * The IDs are namespaced to avoid collision with real games:
 *
 *   gameId:    'miscellaneous'
 *   subGameId: 'custom'
 *   variantId: 'misc'
 *
 * Idempotent — running twice is a no-op. The script only writes when the
 * canonical entry is missing.
 *
 * Usage:
 *   node scripts/seed-misc-catalog-entry.cjs             # dry-run
 *   node scripts/seed-misc-catalog-entry.cjs --confirm   # apply
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── CLI ────────────────────────────────────────────────────────────────────
const CONFIRM = process.argv.includes('--confirm');
const DRY_RUN = !CONFIRM;
const tag = DRY_RUN ? '[DRY]' : '[RUN]';

// ─── Constants ──────────────────────────────────────────────────────────────
const DATABASE_ID = 'asquare-app-db';
const LOCATIONS_COLLECTION = 'locations';

const MISC_GAME_ID = 'miscellaneous';
const MISC_GAME_NAME = 'Miscellaneous';
const MISC_SUBGAME_ID = 'custom';
const MISC_SUBGAME_NAME = 'Custom';
const MISC_VARIANT_ID = 'misc';
const MISC_VARIANT_LABEL = 'Miscellaneous';

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

function buildMiscGame() {
  return {
    id: MISC_GAME_ID,
    name: MISC_GAME_NAME,
    status: 'Active',
    subGames: [
      {
        id: MISC_SUBGAME_ID,
        name: MISC_SUBGAME_NAME,
        variants: [
          {
            id: MISC_VARIANT_ID,
            label: MISC_VARIANT_LABEL,
            price: 0,
            active: true,
          },
        ],
      },
    ],
  };
}

function ensureMiscSubGameShape(game) {
  const subGames = Array.isArray(game.subGames) ? [...game.subGames] : [];
  const existingSgIdx = subGames.findIndex((sg) => sg && sg.id === MISC_SUBGAME_ID);
  if (existingSgIdx < 0) {
    subGames.push(buildMiscGame().subGames[0]);
    return { subGames, changed: true };
  }

  const sg = { ...subGames[existingSgIdx] };
  const variants = Array.isArray(sg.variants) ? [...sg.variants] : [];
  const hasVariant = variants.some((v) => v && v.id === MISC_VARIANT_ID);
  if (!hasVariant) {
    variants.push(buildMiscGame().subGames[0].variants[0]);
    sg.variants = variants;
    subGames[existingSgIdx] = sg;
    return { subGames, changed: true };
  }

  return { subGames, changed: false };
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  ${tag} Seed Miscellaneous catalog entry`);
  console.log('══════════════════════════════════════════════════════════════\n');

  const locationsSnap = await db.collection(LOCATIONS_COLLECTION).get();
  console.log(`  Locations loaded: ${locationsSnap.size}\n`);

  const summary = { alreadyPresent: 0, willSeed: 0, seeded: 0, skippedInactive: 0 };

  for (const locDoc of locationsSnap.docs) {
    const locData = locDoc.data();
    const locLabel = `${locDoc.id} (${locData.displayName ?? locData.name ?? '—'})`;

    if (locData.disabled === true || locData.enabled === false) {
      summary.skippedInactive++;
      console.log(`  ⏭  ${locLabel} — disabled location, skipping`);
      continue;
    }

    const games = Array.isArray(locData.games) ? [...locData.games] : [];
    const existingIdx = games.findIndex((g) => g && g.id === MISC_GAME_ID);

    let changed = false;
    let nextGames;

    if (existingIdx < 0) {
      nextGames = [...games, buildMiscGame()];
      changed = true;
    } else {
      const existing = { ...games[existingIdx] };
      const { subGames, changed: sgChanged } = ensureMiscSubGameShape(existing);
      if (sgChanged || existing.status === 'Inactive' || existing.name !== MISC_GAME_NAME) {
        existing.subGames = subGames;
        existing.status = 'Active';
        existing.name = MISC_GAME_NAME;
        nextGames = [...games];
        nextGames[existingIdx] = existing;
        changed = true;
      }
    }

    if (!changed) {
      summary.alreadyPresent++;
      console.log(`  ✓  ${locLabel} — already present`);
      continue;
    }

    summary.willSeed++;
    console.log(`  ${DRY_RUN ? '•' : '✍'}  ${locLabel} — will seed Miscellaneous entry`);

    if (!DRY_RUN) {
      await locDoc.ref.update({ games: nextGames });
      summary.seeded++;
    }
  }

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('  Summary');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  Already present : ${summary.alreadyPresent}`);
  console.log(`  Will seed       : ${summary.willSeed}`);
  console.log(`  Seeded (applied): ${summary.seeded}`);
  console.log(`  Skipped (off)   : ${summary.skippedInactive}`);
  console.log();
  if (DRY_RUN && summary.willSeed > 0) {
    console.log('  Dry run — re-run with --confirm to apply.');
  } else if (!DRY_RUN) {
    console.log('  Done.');
  } else {
    console.log('  Nothing to do.');
  }

  process.exit(0);
})().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
