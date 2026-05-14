/**
 * Dump a single vendor's vendorDetails record and all location records,
 * so we know what branch field shape to use in the branch-gate fix.
 *
 * Usage:
 *   node scripts/inspect-vendor-and-locations.cjs 8712234222
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const vendorId = process.argv[2] || '8712234222';

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

(async () => {
  const [vSnap, vDetailsSnap, locsSnap] = await Promise.all([
    db.collection('vendors').doc(vendorId).get(),
    db.collection('vendorDetails').doc(vendorId).get(),
    db.collection('locations').get(),
  ]);

  console.log(`\n── vendors/${vendorId} ──`);
  console.log(vSnap.exists ? JSON.stringify(vSnap.data(), null, 2) : 'NOT FOUND');

  console.log(`\n── vendorDetails/${vendorId} ──`);
  console.log(vDetailsSnap.exists ? JSON.stringify(vDetailsSnap.data(), null, 2) : 'NOT FOUND');

  console.log(`\n── locations (${locsSnap.size} docs) ──`);
  for (const doc of locsSnap.docs) {
    const d = doc.data();
    console.log(
      `  ${doc.id.padEnd(20)}  name=${(d.name || '').padEnd(25)}  aliases=${JSON.stringify(d.aliases || d.alternativeNames || [])}`,
    );
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
