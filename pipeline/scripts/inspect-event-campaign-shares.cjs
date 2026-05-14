/**
 * Inspect each EventCampaign package item — vendor, share flag, type.
 *
 * Lets you confirm the per-item `revenueShare` flag is set the way you
 * expect before the trigger / backfill computes credits with it.
 *
 * `revenueShare === false` means 100% of the item's amount goes to the
 * vendor (no company share). Anything else (true or unset) means the
 * vendor's stored `vendorDetails.revenueShare` is used (default 80%).
 *
 * Usage:
 *   node scripts/inspect-event-campaign-shares.cjs
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

const pad = (s, w) => String(s ?? '').padEnd(w);

(async () => {
  const snap = await db.collection('eventCampaigns').get();
  console.log(`\nLoaded ${snap.size} campaign(s).\n`);

  snap.forEach((d) => {
    const c = d.data() || {};
    console.log(`══ ${d.id} : ${c.name ?? '(no name)'} ──────────────────`);
    console.log(`   slug: ${c.slug ?? '(no slug)'}   status: ${c.status ?? '(no status)'}\n`);
    const packages = Array.isArray(c.packages) ? c.packages : [];
    for (const pkg of packages) {
      console.log(`  Package: ${pkg.name ?? pkg.id ?? '(no name)'}`);
      const items = Array.isArray(pkg.items) ? pkg.items : [];
      console.log(
        '    ' +
          pad('item name', 50) +
          pad('vendorId', 13) +
          pad('type', 13) +
          pad('revenueShare', 14) +
          'effective'
      );
      console.log('    ' + '─'.repeat(102));
      for (const it of items) {
        const vid = it.vendorId ?? '—';
        const type = it.type ?? '—';
        const rs = typeof it.revenueShare === 'boolean' ? String(it.revenueShare) : '(unset)';
        const effective =
          type === 'thirdParty' && it.revenueShare === false
            ? '100% to vendor'
            : type === 'thirdParty'
              ? 'split per vendorDetails.revenueShare'
              : 'company';
        console.log(
          '    ' +
            pad((it.name ?? '').slice(0, 48), 50) +
            pad(vid, 13) +
            pad(type, 13) +
            pad(rs, 14) +
            effective
        );
      }
      console.log('');
    }
  });

  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
