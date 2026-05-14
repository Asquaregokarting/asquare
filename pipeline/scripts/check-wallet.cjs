const admin = require('firebase-admin');
const key = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();
db.settings({ databaseId: 'asquare-app-db' });

(async () => {
  const phone = process.argv[2];
  if (!phone) { console.error('Usage: node check-wallet.cjs <phone>'); process.exit(1); }

  const variants = [phone, `+91${phone}`, `91${phone}`, `0${phone}`];
  const matches = new Map();

  // 1. Doc id lookups
  for (const v of variants) {
    const d = await db.doc(`users/${v}`).get();
    if (d.exists) matches.set(d.id, { reason: `doc-id=${v}`, data: d.data() });
  }

  // 2. Field lookups
  for (const field of ['phone', 'phoneNumber', 'mobile', 'phoneNo']) {
    for (const v of variants) {
      try {
        const snap = await db.collection('users').where(field, '==', v).get();
        snap.forEach(doc => {
          if (!matches.has(doc.id)) matches.set(doc.id, { reason: `${field}=${v}`, data: doc.data() });
        });
      } catch {}
    }
  }

  console.log(`\nFound ${matches.size} user doc(s) for ${phone}:\n`);

  for (const [id, info] of matches) {
    console.log('---');
    console.log('userId:', id, '| matched via:', info.reason);
    console.log('  name:', info.data.name || info.data.displayName);
    console.log('  phone fields:', { phone: info.data.phone, phoneNumber: info.data.phoneNumber, mobile: info.data.mobile });
    console.log('  createdAt:', info.data.createdAt);

    const walletSnap = await db.doc(`users/${id}/wallet/data`).get();
    if (walletSnap.exists) {
      console.log('  WALLET:', walletSnap.data());
    } else {
      console.log('  WALLET: (no doc at users/' + id + '/wallet/data)');
    }

    // Also check recent wallet transactions
    try {
      const txs = await db.collection(`users/${id}/wallet_transactions`)
        .orderBy('timestamp', 'desc').limit(5).get();
      if (!txs.empty) {
        console.log('  recent tx:');
        txs.forEach(t => {
          const d = t.data();
          console.log('   ', d.type, d.amount, '-', d.description, '@', d.timestamp?.toDate?.());
        });
      }
    } catch (e) {}
  }
})().catch(e => { console.error(e); process.exit(1); });
