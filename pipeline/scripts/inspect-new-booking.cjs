// Read-only: dump booking ASG260411235153111CP7L so we can plan the
// gokarting-replacement reconciliation.
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

const BOOKING_ID = 'ASG260411235153111CP7L';

(async () => {
  const doc = await db.collection('bookings').doc(BOOKING_ID).get();
  if (!doc.exists) {
    console.log(`NOT FOUND: ${BOOKING_ID}`);
    return;
  }
  const d = doc.data();
  console.log('━━━ BOOKING ━━━');
  console.log(`  id: ${doc.id}`);
  console.log(`  invoiceNumber: ${d.invoiceNumber}`);
  console.log(`  customerName: ${d.customerName}`);
  console.log(`  customerPhone: ${d.customerPhone}`);
  console.log(`  transactionDate: ${d.transactionDate}`);
  console.log(`  paymentStatus: ${d.paymentStatus}`);
  console.log(`  paymentMethod: ${d.paymentMethod}`);
  console.log(`  totalAmount: ₹${d.totalAmount}`);
  console.log(`  baseAmount: ₹${d.baseAmount}`);
  console.log(`  gstAmount: ₹${d.gstAmount}`);
  console.log(`  walletRedeemed: ₹${d.walletRedeemed ?? '∅'}`);
  console.log(`  walletDeducted: ₹${d.walletDeducted ?? '∅'}`);
  console.log(`  cashAmount: ₹${d.cashAmount ?? '∅'}`);
  console.log(`  splitCash: ₹${d.splitCash ?? '∅'}  splitUpi: ₹${d.splitUpi ?? '∅'}  splitCard: ₹${d.splitCard ?? '∅'}  splitWallet: ₹${d.splitWallet ?? '∅'}`);
  console.log(`  refundStatus: ${d.refundStatus}`);
  console.log(`  refundAmount: ₹${d.refundAmount ?? 0}`);
  console.log(`  cancelled: ${d.cancelled}`);
  console.log(`  locationId: ${d.locationId}`);
  console.log(`  items (${(d.items || []).length}):`);
  (d.items || []).forEach((it, i) => {
    console.log(
      `    [${i}] ${it.itemName}\n` +
      `        gameId=${it.gameId ?? '∅'} qty=${it.quantity} unitPrice=₹${it.unitPrice ?? '∅'} ` +
      `itemBase=₹${it.itemBaseAmount ?? '∅'} itemGst=₹${it.itemGstAmount ?? '∅'} ` +
      `vendorTotal=₹${it.vendorTotal ?? '∅'} refunded=${it.refunded ?? false}`
    );
  });

  // Dump every top-level key for completeness
  console.log('\n  raw keys:', Object.keys(d).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
