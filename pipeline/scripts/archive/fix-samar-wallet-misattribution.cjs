/**
 * One-off data fix: transfer ₹750 from staff wallet `samar` to customer
 * `PnpkQvfgIYMlqkb5Z1NEaZ8qWf83` (phone 8106669154).
 *
 * Background: a refund for booking ASG260328210720101OZCD was mistakenly
 * credited to the admin's session user (`samar`, role=Admin) instead of the
 * customer who made the booking. The dedup audit flagged this as a
 * `role-has-wallet` error and refused to auto-merge it — correctly, since
 * this is a data-correction task, not a duplicate merge.
 *
 * This script:
 *   1. Confirms the current state (samar=750, customer wallet missing/0)
 *   2. In a Firestore transaction:
 *      - Sets customer wallet/data.balance = previous + 750 (init if missing)
 *      - Sets samar wallet/data.balance = 0
 *      - Writes an audit credit tx on the customer pointing back at samar
 *      - Writes an audit debit tx on samar explaining the correction
 *   3. Re-reads both docs to verify
 *
 * Usage:
 *   node scripts/fix-samar-wallet-misattribution.cjs             # dry-run
 *   node scripts/fix-samar-wallet-misattribution.cjs --confirm   # apply
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const CONFIRM = process.argv.includes('--confirm');
const DRY_RUN = !CONFIRM;

const SAMAR_ID = 'samar';
const CUSTOMER_ID = 'PnpkQvfgIYMlqkb5Z1NEaZ8qWf83';
const CUSTOMER_PHONE = '8106669154';
const AMOUNT = 750;
const BOOKING_REF = 'ASG260328210720101OZCD';

const keyPath = path.resolve('serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found in project root.');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: 'asquare-app-db' });

const tag = DRY_RUN ? '[DRY]' : '[RUN]';

(async () => {
  console.log(
    `\n${DRY_RUN ? 'DRY-RUN' : 'REAL RUN'} — samar wallet misattribution fix\n` +
      `  from: users/${SAMAR_ID} (staff, Admin)\n` +
      `  to:   users/${CUSTOMER_ID} (phone ${CUSTOMER_PHONE})\n` +
      `  amount: ₹${AMOUNT}\n` +
      `  booking: ${BOOKING_REF}\n`,
  );
  if (CONFIRM) console.log('*** WRITES ENABLED ***\n');

  const samarRef = db.doc(`users/${SAMAR_ID}/wallet/data`);
  const customerRef = db.doc(`users/${CUSTOMER_ID}/wallet/data`);

  // Pre-state
  const samarPre = await samarRef.get();
  const customerPre = await customerRef.get();
  const samarBalanceBefore = samarPre.exists ? Number(samarPre.data().balance || 0) : 0;
  const customerBalanceBefore = customerPre.exists
    ? Number(customerPre.data().balance || 0)
    : 0;

  console.log(`${tag} samar wallet BEFORE: ₹${samarBalanceBefore}`);
  console.log(`${tag} customer wallet BEFORE: ₹${customerBalanceBefore} (exists=${customerPre.exists})`);

  if (samarBalanceBefore !== AMOUNT) {
    console.error(
      `\nABORT: samar balance is ₹${samarBalanceBefore}, expected ₹${AMOUNT}. ` +
        `Something changed since the audit — aborting to avoid data loss.`,
    );
    process.exit(1);
  }

  const customerBalanceAfter = customerBalanceBefore + AMOUNT;
  console.log(
    `${tag} samar wallet AFTER:    ₹0`,
  );
  console.log(
    `${tag} customer wallet AFTER: ₹${customerBalanceAfter}`,
  );

  if (DRY_RUN) {
    console.log('\n(dry-run — no writes performed. Re-run with --confirm to apply.)\n');
    process.exit(0);
  }

  const ts = Date.now();
  const customerTxId = `correction-${ts}-from-samar`;
  const samarTxId = `correction-${ts}-to-${CUSTOMER_ID.slice(0, 6)}`;

  await db.runTransaction(async (tx) => {
    // Re-read inside the tx to guard against concurrent writes.
    const samarInTx = await tx.get(samarRef);
    const customerInTx = await tx.get(customerRef);
    const samarNow = samarInTx.exists ? Number(samarInTx.data().balance || 0) : 0;
    if (samarNow !== AMOUNT) {
      throw new Error(
        `samar balance changed mid-transaction: expected ${AMOUNT}, got ${samarNow}`,
      );
    }
    const customerNow = customerInTx.exists
      ? Number(customerInTx.data().balance || 0)
      : 0;

    tx.set(
      samarRef,
      {
        balance: 0,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(
      customerRef,
      {
        balance: customerNow + AMOUNT,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(db.doc(`users/${SAMAR_ID}/wallet_transactions/${samarTxId}`), {
      type: 'debit',
      amount: -AMOUNT,
      description:
        `Correction: ₹${AMOUNT} refund for booking ${BOOKING_REF} was ` +
        `mistakenly credited to admin session (${SAMAR_ID}); transferred to ` +
        `customer ${CUSTOMER_ID} (phone ${CUSTOMER_PHONE}).`,
      relatedUser: CUSTOMER_ID,
      booking: BOOKING_REF,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.set(db.doc(`users/${CUSTOMER_ID}/wallet_transactions/${customerTxId}`), {
      type: 'credit',
      amount: AMOUNT,
      description: `Refund for booking ${BOOKING_REF} (correction from admin account)`,
      source: SAMAR_ID,
      booking: BOOKING_REF,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  // Verify
  const samarPost = await samarRef.get();
  const customerPost = await customerRef.get();
  const samarBalanceAfter = samarPost.exists ? Number(samarPost.data().balance || 0) : 0;
  const customerBalanceAfterReal = customerPost.exists
    ? Number(customerPost.data().balance || 0)
    : 0;

  console.log(`\n${tag} VERIFY samar wallet:    ₹${samarBalanceAfter}`);
  console.log(`${tag} VERIFY customer wallet: ₹${customerBalanceAfterReal}`);

  if (samarBalanceAfter === 0 && customerBalanceAfterReal === customerBalanceAfter) {
    console.log('\n✓ Transfer complete and verified.\n');
  } else {
    console.error('\n✗ Verification failed — read values do not match expected.');
    process.exit(2);
  }
})().catch((err) => {
  console.error('fix script failed:', err);
  process.exit(1);
});
