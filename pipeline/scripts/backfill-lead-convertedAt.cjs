/**
 * Backfill `convertedAt` on every lead currently in status='booked' that
 * lacks the field. Uses `lastActivityAt` as the proxy for "when the
 * conversion happened" — that timestamp was set by updateLeadStatus
 * when the lead was clicked into 'booked', so it matches the click
 * moment.
 *
 * Without this field, getLeadPerformanceMetrics can't credit any
 * historical conversion, so the Conversion % KPI stays at 0 even
 * though the leads ARE marked booked.
 *
 * Default --dry-run; pass --apply to write.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const APPLY = process.argv.includes('--apply');

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID, ignoreUndefinedProperties: true });

(async () => {
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const snap = await db.collection('leads').where('status', '==', 'booked').get();
  console.log(`Booked leads found: ${snap.size}`);

  const stamps = [];
  let alreadyHas = 0;
  let noFallback = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (typeof d.convertedAt === 'string' && d.convertedAt.length > 0) {
      alreadyHas++;
      continue;
    }
    const fallback = d.lastActivityAt || d.updatedAt || d.createdAt;
    if (!fallback) {
      noFallback++;
      continue;
    }
    stamps.push({ id: doc.id, ref: doc.ref, ts: fallback, name: d.customerName, phone: d.customerPhone });
  }

  console.log(`Already has convertedAt           : ${alreadyHas}`);
  console.log(`Missing convertedAt, will backfill: ${stamps.length}`);
  console.log(`Missing AND no fallback timestamp : ${noFallback}\n`);

  if (stamps.length === 0) {
    console.log('Nothing to backfill.');
    process.exit(0);
  }

  console.log('Sample (first 15):');
  for (const s of stamps.slice(0, 15)) {
    console.log(`  ${s.id}  ${s.name || '(no name)'} ${s.phone || ''}  → convertedAt=${s.ts}`);
  }

  if (!APPLY) {
    console.log('\n⏸  dry run — pass --apply to write.');
    process.exit(0);
  }

  // Batched updates
  let written = 0;
  const BATCH_SIZE = 400;
  for (let i = 0; i < stamps.length; i += BATCH_SIZE) {
    const chunk = stamps.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const s of chunk) batch.update(s.ref, { convertedAt: s.ts });
    await batch.commit();
    written += chunk.length;
    process.stderr.write(`  written ${written}/${stamps.length}\r`);
  }
  console.log(`\n✓ Backfilled convertedAt on ${written} leads.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
