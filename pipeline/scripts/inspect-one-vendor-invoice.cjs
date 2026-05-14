/**
 * Dump a single vendorInvoice doc so we know the actual field shape.
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(fs.readFileSync(path.resolve('serviceAccountKey.json'), 'utf-8')),
  ),
});
const db = admin.firestore();
db.settings({ databaseId: 'asquare-app-db' });

(async () => {
  const snap = await db.collection('vendorInvoices').limit(3).get();
  console.log(`\n${snap.size} sample invoices:\n`);
  for (const d of snap.docs) {
    console.log(`-- ${d.id} --`);
    console.log(JSON.stringify(d.data(), null, 2));
    console.log('');
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
