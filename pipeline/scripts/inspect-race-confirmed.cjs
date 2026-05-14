/**
 * Read-only fetch of a booking + render the race_confirmed WhatsApp body.
 *
 * Usage:
 *   node scripts/inspect-race-confirmed.cjs ASG26050815300010490XZ
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const bookingId = process.argv[2];
if (!bookingId) {
  console.error('Usage: node scripts/inspect-race-confirmed.cjs <bookingId>');
  process.exit(1);
}

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

const BRANCH_NAMES = {
  '0': 'Vizag',
  '1': 'Kakinada',
  '2': 'Rajahmundry',
  '5': 'Srikakulam',
};

function fmtDate(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v.toDate) {
    const d = v.toDate();
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return String(v);
}

function fmtTime(v) {
  if (!v) return '';
  return String(v);
}

(async () => {
  const snap = await db.collection('bookings').doc(bookingId).get();
  if (!snap.exists) {
    console.log(`\nNo booking found with id "${bookingId}".\n`);
    process.exit(0);
  }
  const d = snap.data();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  BOOKING: ${bookingId}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  const customerName = d.userDisplayName || d.name || d.customerName || 'Racer';
  const phone = d.userPhone || d.mobile || d.phone || '';
  const date = fmtDate(d.sessionDate || d.visitDate || d.transactionDate);
  const time = fmtTime(d.sessionTime || d.startTime || d.slotTime);
  const items = Array.isArray(d.items) ? d.items : [];
  const slots = items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0) || 1;
  const branchId = String(d.locationId ?? d.branchId ?? '');
  const venue = BRANCH_NAMES[branchId] || d.branchName || d.locationName || '';
  const supportPhone = '8499888872';

  console.log('Resolved values:');
  console.log(`  customerName : ${customerName}`);
  console.log(`  phone        : ${phone}`);
  console.log(`  date         : ${date}`);
  console.log(`  time         : ${time}`);
  console.log(`  slots        : ${slots}`);
  console.log(`  venue        : ${venue} (locationId=${branchId})`);
  console.log(`  raceNumber   : ${bookingId}`);
  console.log(`  supportPhone : ${supportPhone}`);
  console.log();

  console.log('Items summary:');
  items.forEach((it, i) => {
    console.log(`  [${i}] ${it.itemName ?? '—'}  qty=${it.quantity ?? '—'}`);
  });
  console.log();

  console.log('Raw key fields:');
  console.log(`  paymentStatus : ${d.paymentStatus ?? '—'}`);
  console.log(`  cancelled     : ${d.cancelled === true}`);
  console.log(`  finalAmount   : ${d.finalAmount ?? '—'}`);
  console.log(`  sessionDate   : ${d.sessionDate ?? '—'}`);
  console.log(`  sessionTime   : ${d.sessionTime ?? '—'}`);
  console.log(`  startTime     : ${d.startTime ?? '—'}`);
  console.log(`  slotTime      : ${d.slotTime ?? '—'}`);
  console.log();

  // Also print stored interakt_message_requests if present
  const reqs = await db
    .collection('interakt_message_requests')
    .where('type', '==', 'race_confirmed')
    .limit(50)
    .get();

  let matched = null;
  reqs.forEach((doc) => {
    const data = doc.data();
    const cb = data?.requestPayload?.callbackData;
    if (typeof cb === 'string' && cb.includes(bookingId)) matched = data;
    if (cb && typeof cb === 'object' && cb.raceNumber === bookingId) matched = data;
  });
  if (matched) {
    console.log('Found stored interakt_message_requests payload:');
    console.log(JSON.stringify(matched.requestPayload?.template?.bodyValues, null, 2));
    console.log();
  } else {
    console.log('No prior interakt_message_requests doc found for this booking.\n');
  }

  process.exit(0);
})().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
