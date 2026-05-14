/**
 * Read-only post-refund report for the SAI KUMAR / 9421779143 bulk refund
 * executed on 2026-04-11. Pulls the wallet audit entry, current wallet
 * balance, and the per-booking refund state so we can give a full breakdown.
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

const PHONE = '9421779143';
const REFUND_DATE = '2026-04-11';
const USER_ID = 'offline_9421779143';

const normalizePhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

const dateOf = (data) => {
  const grab = (v) => {
    if (!v) return null;
    if (typeof v === 'object' && typeof v.toDate === 'function') {
      try { return v.toDate().toISOString().slice(0, 10); } catch { return null; }
    }
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  };
  return grab(data.transactionDate) || grab(data.createdAt);
};

(async () => {
  // 1. Wallet doc
  const wallet = await db.doc(`users/${USER_ID}/wallet/data`).get();
  const rootUser = await db.doc(`users/${USER_ID}`).get();
  console.log('━━━ WALLET ━━━');
  console.log(`  doc: users/${USER_ID}/wallet/data`);
  console.log(`  exists: ${wallet.exists}`);
  if (wallet.exists) {
    const w = wallet.data();
    console.log(`  balance: ₹${Number(w.balance || 0).toFixed(2)}`);
    console.log(`  lastUpdated: ${w.lastUpdated && w.lastUpdated.toDate ? w.lastUpdated.toDate().toISOString() : w.lastUpdated}`);
  }
  if (rootUser.exists) {
    console.log(`  root.walletBalance: ₹${Number(rootUser.data().walletBalance || 0).toFixed(2)}`);
  }

  // 2. Most recent wallet_transactions
  console.log('\n━━━ WALLET AUDIT ENTRIES (last 5) ━━━');
  const txns = await db
    .collection(`users/${USER_ID}/wallet_transactions`)
    .orderBy('timestamp', 'desc')
    .limit(5)
    .get();
  txns.forEach((d) => {
    const t = d.data();
    console.log(`  ${d.id}`);
    console.log(`    type: ${t.type}  amount: ₹${Number(t.amount || 0).toFixed(2)}`);
    console.log(`    description: ${t.description}`);
    console.log(`    source: ${t.source ?? '∅'}`);
    if (t.relatedBookings) console.log(`    relatedBookings: ${t.relatedBookings.length} ids`);
    console.log(`    timestamp: ${t.timestamp && t.timestamp.toDate ? t.timestamp.toDate().toISOString() : t.timestamp}`);
  });

  // 3. Per-booking refund state for the SAI KUMAR bookings refunded on 2026-04-11
  console.log('\n━━━ REFUNDED BOOKINGS ━━━');
  const snap = await db.collection('bookings').get();
  const matched = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    if (normalizePhone(data.customerPhone) !== PHONE) return;
    if (dateOf(data) !== REFUND_DATE) return;
    if ((data.refundAmount || 0) <= 0) return;
    matched.push({ id: doc.id, data });
  });
  matched.sort((a, b) =>
    String(a.data.transactionDate || '').localeCompare(String(b.data.transactionDate || '')),
  );

  // Group by combo type using totalAmount
  const byCombo = new Map();
  let totalRefund = 0;
  let totalGross = 0;
  let totalBase = 0;
  let totalGst = 0;
  let totalRefundedItems = 0;

  for (const m of matched) {
    const refunded = (m.data.items || []).filter((i) => i.refunded);
    let docRefundBase = 0;
    let docRefundGst = 0;
    for (const it of refunded) {
      docRefundBase += Number(it.itemBaseAmount || 0);
      docRefundGst += Number(it.itemGstAmount || 0);
    }
    const refundAmt = Number(m.data.refundAmount || 0);
    const gross = Number(m.data.totalAmount || 0);
    const baseGross = Number(m.data.baseAmount || 0);
    const gstGross = Number(m.data.gstAmount || 0);

    totalRefund += refundAmt;
    totalGross += gross;
    totalBase += docRefundBase;
    totalGst += docRefundGst;
    totalRefundedItems += refunded.length;

    const key = gross === 1824 ? 'Child Navy x2 (₹1824)'
      : gross === 912 ? 'Child Navy (₹912)'
      : gross === 1224 ? 'Adult Navy (₹1224)'
      : `Other (₹${gross})`;
    if (!byCombo.has(key)) {
      byCombo.set(key, { count: 0, refundSum: 0, grossSum: 0, baseSum: 0, gstSum: 0, items: 0 });
    }
    const bucket = byCombo.get(key);
    bucket.count += 1;
    bucket.refundSum += refundAmt;
    bucket.grossSum += gross;
    bucket.baseSum += docRefundBase;
    bucket.gstSum += docRefundGst;
    bucket.items += refunded.length;
  }

  console.log(`  matched: ${matched.length} bookings`);
  console.log(`  total refunded items: ${totalRefundedItems}`);
  console.log(`  gross of these bookings (totalAmount sum): ₹${totalGross.toFixed(2)}`);
  console.log(`  refund amount sum: ₹${totalRefund.toFixed(2)}`);
  console.log(`  refund base sum:   ₹${totalBase.toFixed(2)}`);
  console.log(`  refund gst sum:    ₹${totalGst.toFixed(2)}`);
  console.log(`  base+gst check:    ₹${(totalBase + totalGst).toFixed(2)}`);

  console.log('\n━━━ BY COMBO TYPE ━━━');
  for (const [key, b] of byCombo) {
    console.log(`  ${key}`);
    console.log(`    bookings: ${b.count}  items refunded: ${b.items}`);
    console.log(`    gross of bookings: ₹${b.grossSum.toFixed(2)}`);
    console.log(`    refund total: ₹${b.refundSum.toFixed(2)}  (base ₹${b.baseSum.toFixed(2)} + gst ₹${b.gstSum.toFixed(2)})`);
  }

  // Per-activity breakdown by walking refunded items
  console.log('\n━━━ BY ACTIVITY ━━━');
  const ACTIVITY_PATTERNS = [
    { activity: 'Cricket', regex: /^CRICKET\b/i },
    { activity: 'Rocket Ejecter', regex: /^ROCKET\s+EJECT(?:OR|ER)\b/i },
    { activity: 'Archery', regex: /^ARCHERY\b/i },
    { activity: 'Bungee Trampoline', regex: /^BUNGEE\s+TRAMPOLINE\b/i },
  ];
  const canon = (n) => {
    const s = String(n || '').trim();
    for (const { activity, regex } of ACTIVITY_PATTERNS) {
      if (regex.test(s)) return activity;
    }
    return 'Other';
  };
  const byAct = new Map();
  for (const m of matched) {
    for (const it of m.data.items || []) {
      if (!it.refunded) continue;
      const act = canon(it.itemName);
      if (!byAct.has(act)) byAct.set(act, { items: 0, slots: 0, base: 0, gst: 0, total: 0 });
      const a = byAct.get(act);
      a.items += 1;
      a.slots += Number(it.quantity || 0);
      a.base += Number(it.itemBaseAmount || 0);
      a.gst += Number(it.itemGstAmount || 0);
      a.total += Number(it.itemBaseAmount || 0) + Number(it.itemGstAmount || 0);
    }
  }
  for (const [act, a] of byAct) {
    console.log(`  ${act.padEnd(20)} items=${String(a.items).padStart(2)}  slots=${String(a.slots).padStart(2)}  ` +
      `base=₹${a.base.toFixed(2).padStart(8)}  gst=₹${a.gst.toFixed(2).padStart(7)}  total=₹${a.total.toFixed(2).padStart(8)}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
