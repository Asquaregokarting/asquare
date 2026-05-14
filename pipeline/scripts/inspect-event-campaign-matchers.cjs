/**
 * Dump every eventCampaign matcher (campaign × package × item), with the
 * gameTokens that the vendor-ledger-sync matcher uses. Use this to find
 * vendors whose matcher tokens are dangerously loose (1 token, generic
 * word) and would false-positive match items that don't belong to them.
 *
 * Usage:
 *   node scripts/inspect-event-campaign-matchers.cjs            # all
 *   node scripts/inspect-event-campaign-matchers.cjs 8712234222 # filter
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';

const filterVendor = process.argv[2];

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

const EVENT_STOPWORDS = new Set(['the', 'and', 'or', 'of', 'a', 'an', 'with', 'free']);
function eventTokenise(s) {
  if (typeof s !== 'string') return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !EVENT_STOPWORDS.has(t));
}

(async () => {
  const snap = await db.collection('eventCampaigns').get();

  const matchers = [];
  for (const d of snap.docs) {
    const c = d.data() || {};
    const packages = Array.isArray(c.packages) ? c.packages : [];
    const startDate = c.startDate || '';
    const endDate = c.endDate || '';
    for (const pkg of packages) {
      const items = Array.isArray(pkg && pkg.items) ? pkg.items : [];
      for (const it of items) {
        if (!it) continue;
        const vid = typeof it.vendorId === 'string' ? it.vendorId.trim() : '';
        const name = typeof it.name === 'string' ? it.name.trim() : '';
        if (!name) continue;
        const tokens = eventTokenise(name);
        matchers.push({
          campaignId: d.id,
          campaignName: c.name || '',
          startDate,
          endDate,
          packageId: pkg.id || '',
          packageName: pkg.name || '',
          itemName: name,
          vendorId: vid,
          type: it.type || 'thirdParty',
          revenueShare: it.revenueShare,
          price: Number(it.price) || 0,
          tokens,
          tokenCount: tokens.length,
        });
      }
    }
  }

  const filtered = filterVendor
    ? matchers.filter((m) => m.vendorId === filterVendor)
    : matchers;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  EventCampaign matchers${filterVendor ? ` for ${filterVendor}` : ''}`);
  console.log('══════════════════════════════════════════════════════════════\n');
  console.log(`Total matcher rows: ${matchers.length} (filtered: ${filtered.length})\n`);

  // Find weak matchers: 1 token, AND not unique to this combination
  const tokenKey = (m) => m.tokens.slice().sort().join('+');
  const tokenCount = new Map();
  for (const m of matchers) {
    const k = tokenKey(m);
    tokenCount.set(k, (tokenCount.get(k) || 0) + 1);
  }

  // Sort: weakest first (fewest tokens, then most collisions)
  const sorted = filtered.slice().sort((a, b) => a.tokens.length - b.tokens.length);

  console.log('  vendorId      campaign            window               package       itemName                              tokens                       danger');
  for (const m of sorted) {
    const overlap = tokenCount.get(tokenKey(m)) || 1;
    const dangerLevel =
      m.tokens.length === 0
        ? 'EMPTY!'
        : m.tokens.length === 1
          ? overlap > 1
            ? 'WEAK+SHARED'
            : 'WEAK'
          : overlap > 3
            ? 'SHARED'
            : 'ok';
    console.log(
      `  ${(m.vendorId || '—').padEnd(12)}  ${String(m.campaignName).slice(0, 18).padEnd(18)}  ${String(m.startDate).slice(0, 10)}→${String(m.endDate).slice(0, 10)}  ${String(m.packageName).slice(0, 12).padEnd(12)}  ${String(m.itemName).slice(0, 38).padEnd(38)}  [${m.tokens.join(', ')}]`.padEnd(170) +
        `  ${dangerLevel}`,
    );
  }

  process.exit(0);
})().catch((err) => {
  console.error('Inspect failed:', err);
  process.exit(1);
});
