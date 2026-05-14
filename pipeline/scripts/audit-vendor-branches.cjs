/**
 * Audit `vendorDetails` for branch / branchId mismatches.
 *
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 * Each vendor doc has two location fields:
 *   - `branch`    (required, free text from the registration form)
 *   - `branchId`  (canonical slug — only set when an Owner/Admin edits the
 *                  vendor; self-registered vendors do not have it)
 *
 * The AccountingModule used to fail with "No location assigned" whenever
 * `branchId` was absent. The runtime now falls back to resolving `branch`
 * via the locations registry, but a vendor whose `branch` string is
 * unparseable (typo, freeform "Branch 1", empty) still hits the error.
 *
 * This script lists every vendor whose `branch` does not resolve, so you
 * can either:
 *   (a) edit the vendor manually in AdminModule and pick a real branch, or
 *   (b) run scripts/backfill-vendor-branch-ids.cjs to stamp `branchId`
 *       wherever resolution does succeed (separate script).
 *
 * Read-only. Pass no flags.
 *
 * Usage:
 *   node scripts/audit-vendor-branches.cjs
 *   node scripts/audit-vendor-branches.cjs --csv reports/vendor-branch-audit.csv
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── CLI ────────────────────────────────────────────────────────────────────
const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const CSV_PATH = argValue('--csv');

// ─── Constants ──────────────────────────────────────────────────────────────
const DATABASE_ID = 'asquare-app-db';
const VENDOR_DETAILS_COLLECTION = 'vendorDetails';

// Mirror of FALLBACK_LOCATIONS + LEGACY_ALIASES in src/lib/locations.ts.
// Kept in sync manually because functions/scripts and src/ don't share a
// module graph.
const LOCATIONS = [
  { slug: 'visakhapatnam', branchId: '0', displayName: 'Visakhapatnam', shortName: 'Vizag' },
  { slug: 'kakinada', branchId: '1', displayName: 'Kakinada', shortName: 'Kakinada' },
  { slug: 'rajahmundry', branchId: '2', displayName: 'Rajahmundry', shortName: 'Rajahmundry' },
  { slug: 'srikakulam', branchId: '5', displayName: 'Srikakulam', shortName: 'Srikakulam' },
];
const LEGACY_ALIASES = {
  vizag: 'visakhapatnam',
  vskp: 'visakhapatnam',
  kkd: 'kakinada',
  rjy: 'rajahmundry',
};

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

/** Local copy of resolveLocation from src/lib/locations.ts. */
function resolveLocation(idOrSlugOrName) {
  if (typeof idOrSlugOrName !== 'string') return undefined;
  const trimmed = idOrSlugOrName.trim();
  if (!trimmed) return undefined;
  const key = trimmed.toLowerCase();

  // by slug (with legacy aliases)
  for (const loc of LOCATIONS) {
    if (loc.slug.toLowerCase() === key) return loc;
  }
  if (LEGACY_ALIASES[key]) {
    const target = LEGACY_ALIASES[key];
    return LOCATIONS.find((l) => l.slug === target);
  }
  // by branchId (case-sensitive on the original input)
  for (const loc of LOCATIONS) {
    if (loc.branchId === trimmed) return loc;
  }
  // by display name / short name
  for (const loc of LOCATIONS) {
    if (loc.displayName.toLowerCase() === key) return loc;
    if (loc.shortName.toLowerCase() === key) return loc;
  }
  return undefined;
}

const pad = (s, w) => String(s ?? '').padEnd(w);

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n┌─ vendorDetails branch audit (read-only) ─────────────────┐`);
  console.log(`│ collection: ${VENDOR_DETAILS_COLLECTION}`);
  console.log(`│ database:   ${DATABASE_ID}`);
  console.log(`└──────────────────────────────────────────────────────────┘\n`);

  const snapshot = await db.collection(VENDOR_DETAILS_COLLECTION).get();
  console.log(`Loaded ${snapshot.size} vendor doc${snapshot.size === 1 ? '' : 's'}.\n`);

  // Bucketing reflects what the AccountingModule actually checks.
  // Post-fix: vendor sees "Not available" only when BOTH branchId is empty
  // AND resolveLocation(branch) returns nothing.
  const buckets = {
    bothFieldsAgree: [],      // branchId set; branch resolves to the same id (clean)
    branchIdOnlyOk: [],       // branchId set; branch is missing OR unrecognizable text — still works (branchId wins)
    branchResolves: [],       // branchId missing; branch resolves (runtime fallback OK; permanent backfill recommended)
    branchUnresolvable: [],   // both missing OR neither field resolves — vendor TRULY blocked
    fieldsConflict: [],       // branchId set; branch ALSO resolves but to a DIFFERENT id (admin should reconcile)
  };

  snapshot.forEach((d) => {
    const data = d.data() || {};
    const userId = d.id;
    const vendorName = String(data.vendorName ?? data.userName ?? '').trim() || '(no name)';
    const vendorType = data.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty';
    const branch = typeof data.branch === 'string' ? data.branch.trim() : '';
    const branchId = typeof data.branchId === 'string' ? data.branchId.trim() : '';
    const resolved = branch ? resolveLocation(branch) : undefined;
    const resolvedId = resolved ? resolved.branchId : '';

    const row = {
      userId,
      vendorName,
      vendorType,
      branch,
      branchId,
      resolvedId,
      resolvedSlug: resolved ? resolved.slug : '',
    };

    if (branchId && resolvedId && branchId === resolvedId) {
      buckets.bothFieldsAgree.push(row);
    } else if (branchId && resolvedId && branchId !== resolvedId) {
      buckets.fieldsConflict.push(row);
    } else if (branchId && !resolvedId) {
      // branchId is what AccountingModule keys off; branch being unparseable
      // is cosmetic only.
      buckets.branchIdOnlyOk.push(row);
    } else if (!branchId && resolvedId) {
      buckets.branchResolves.push(row);
    } else {
      buckets.branchUnresolvable.push(row);
    }
  });

  const print = (label, rows) => {
    if (rows.length === 0) return;
    console.log(`\n─── ${label} (${rows.length}) ───────────────`);
    console.log(
      pad('userId', 30) + pad('vendor', 28) + pad('type', 11) +
      pad('branch', 22) + pad('branchId', 10) + 'resolved'
    );
    console.log('─'.repeat(112));
    for (const r of rows) {
      console.log(
        pad(r.userId, 30) + pad(r.vendorName.slice(0, 26), 28) + pad(r.vendorType, 11) +
        pad(r.branch.slice(0, 20), 22) + pad(r.branchId, 10) +
        (r.resolvedId ? `${r.resolvedId} (${r.resolvedSlug})` : '—')
      );
    }
  };

  const totalWorking =
    buckets.bothFieldsAgree.length +
    buckets.branchIdOnlyOk.length +
    buckets.branchResolves.length +
    buckets.fieldsConflict.length;

  console.log(`─── summary ─────────────────────────────────────────────`);
  console.log(`  Healthy (branchId + branch agree)  : ${buckets.bothFieldsAgree.length}`);
  console.log(`  branchId set, branch unrecognised  : ${buckets.branchIdOnlyOk.length} (cosmetic, no user impact)`);
  console.log(`  branchId missing, branch resolves  : ${buckets.branchResolves.length} (runtime fallback unblocks)`);
  console.log(`  CONFLICT (branchId vs branch)      : ${buckets.fieldsConflict.length} (wrong branch routed)`);
  console.log(`  TRULY BLOCKED                      : ${buckets.branchUnresolvable.length}`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  Vendors NOT seeing "Not available" : ${totalWorking} of ${snapshot.size}`);

  print('TRULY BLOCKED — vendor sees "Not available"', buckets.branchUnresolvable);
  print('CONFLICT — branchId disagrees with branch (admin should reconcile)', buckets.fieldsConflict);
  print('RUNTIME FALLBACK — works now; backfill recommended', buckets.branchResolves);
  print('branchId set, branch unrecognised — cosmetic only', buckets.branchIdOnlyOk);

  if (CSV_PATH) {
    const dir = path.dirname(CSV_PATH);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = ['bucket,userId,vendorName,vendorType,branch,branchId,resolvedId,resolvedSlug'];
    const emit = (bucket, rows) => {
      for (const r of rows) {
        const v = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
        lines.push(
          `${bucket},${v(r.userId)},${v(r.vendorName)},${v(r.vendorType)},${v(r.branch)},${v(r.branchId)},${v(r.resolvedId)},${v(r.resolvedSlug)}`
        );
      }
    };
    emit('bothFieldsAgree', buckets.bothFieldsAgree);
    emit('branchIdOnlyOk', buckets.branchIdOnlyOk);
    emit('branchResolves', buckets.branchResolves);
    emit('fieldsConflict', buckets.fieldsConflict);
    emit('branchUnresolvable', buckets.branchUnresolvable);
    fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf-8');
    console.log(`\nCSV written: ${CSV_PATH}`);
  }

  console.log(`\nRead-only run complete.\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
