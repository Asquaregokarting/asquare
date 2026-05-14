/**
 * Correction for the 2026-04-11 bulk refund of phone 9421779143 (SAI KUMAR).
 *
 * The previous run (scripts/bulk-refund-9421779143.cjs) credited ₹9,264 using
 * pro-rata combo pricing. The cashier has now confirmed the actual menu prices
 * for the four refunded activities, all GST-inclusive at 18%:
 *
 *   Cricket            ₹144   (qty 3  → ₹432)
 *   Rocket Ejecter     ₹240   (qty 25 → ₹6,000)
 *   Archery            ₹90    (qty 11 → ₹990)
 *   Bungee Trampoline  ₹144   (qty 11 → ₹1,584)
 *   ──────────────────────────────────────────
 *   Correct refund total            ₹9,006
 *
 * Required corrections:
 *   1. Rewrite per-item itemBaseAmount/itemGstAmount on every refunded line
 *      across the 35 booking docs touched yesterday, then update each doc's
 *      cumulative refundAmount to the new sum.
 *   2. Reduce booking ASG260411235153111CP7L (the customer's follow-up POS
 *      sale, paid 100% from the refund wallet) from totalAmount=9250 to 9006
 *      and walletRedeemed=9250 to 9006. Items unchanged.
 *   3. Set the offline_9421779143 wallet balance to ₹258 (was ₹14) and write
 *      a single audit entry tagged 'bulk-refund-correction-script'. The
 *      original ₹9,264 credit audit entry is left untouched (historical
 *      record). Net new credit written: ₹244.
 *
 * Phases:
 *   A. Discovery     — load + assert pre-state matches yesterday's snapshot
 *   B. Plan          — compute every patch, hard-fail on math drift
 *   C. Execute       — runTransaction per booking + POS booking + wallet
 *   D. Verify        — re-read everything and assert
 *
 * Usage:
 *   node scripts/correct-bulk-refund-9421779143.cjs           # dry-run
 *   node scripts/correct-bulk-refund-9421779143.cjs --confirm # apply
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── CLI ────────────────────────────────────────────────────────────────────
const CONFIRM = process.argv.includes('--confirm');
const DRY_RUN = !CONFIRM;
const tag = DRY_RUN ? '[DRY]' : '[RUN]';

// ─── Constants ──────────────────────────────────────────────────────────────
const PHONE = '9421779143';
const REFUND_DATE = '2026-04-11';
const REASON = 'Bulk refund — customer request'; // unchanged from original
const NEW_BOOKING_ID = 'ASG260411235153111CP7L';
const USER_ID = 'offline_9421779143';
const DATABASE_ID = 'asquare-app-db';
const BOOKINGS_COLLECTION = 'bookings';

// GST-inclusive menu prices (₹) per single slot.
const UNIT_PRICE = {
  cricket: 144,
  'rocket ejecter': 240,
  archery: 90,
  'bungee trampoline': 144,
};

const QUOTA = {
  cricket: 3,
  'rocket ejecter': 25,
  archery: 11,
  'bungee trampoline': 11,
};

// Strict prefix match — same as bulk-refund-9421779143.cjs.
const ACTIVITY_PATTERNS = [
  { activity: 'cricket', regex: /^CRICKET\b/i },
  { activity: 'rocket ejecter', regex: /^ROCKET\s+EJECT(?:OR|ER)\b/i },
  { activity: 'archery', regex: /^ARCHERY\b/i },
  { activity: 'bungee trampoline', regex: /^BUNGEE\s+TRAMPOLINE\b/i },
];

const TARGET_REFUND_TOTAL = 9006; // ₹
const EXPECTED_OLD_REFUND_SUM = 9264; // ₹
const EXPECTED_OLD_REDEMPTION = 9250; // ₹
const TARGET_BOOKING_TOTAL = 9006; // ₹
const EXPECTED_OLD_WALLET = 14; // ₹
const TARGET_WALLET_END = 258; // ₹
const CORRECTION_CREDIT = 244; // ₹  (258 − 14)
const TOL = 0.5; // ₹ rounding tolerance

// ─── Helpers ────────────────────────────────────────────────────────────────
const round2 = (n) => Math.round(n * 100) / 100;

const split = (price, qty) => {
  const total = price * qty;
  const base = total / 1.18;
  const gst = total - base;
  return { total: round2(total), base: round2(base), gst: round2(gst) };
};

const normalizePhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

const dateOf = (data) => {
  const grab = (v) => {
    if (!v) return null;
    if (typeof v === 'object' && typeof v.toDate === 'function') {
      try {
        return v.toDate().toISOString().slice(0, 10);
      } catch {
        return null;
      }
    }
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  };
  return grab(data.transactionDate) || grab(data.createdAt);
};

const canonicalActivity = (itemName) => {
  const name = String(itemName || '').trim();
  for (const { activity, regex } of ACTIVITY_PATTERNS) {
    if (regex.test(name)) return activity;
  }
  return null;
};

const nowIso = () => new Date().toISOString();

const die = (msg) => {
  console.error(`\nABORT: ${msg}\n`);
  process.exit(1);
};

// ─── Admin SDK setup ────────────────────────────────────────────────────────
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

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(
    `\n${DRY_RUN ? 'DRY-RUN' : 'REAL RUN'} — bulk refund correction\n` +
      `  phone:        ${PHONE}\n` +
      `  refund date:  ${REFUND_DATE}\n` +
      `  user uid:     ${USER_ID}\n` +
      `  new prices:   Cricket ₹144 / Rocket ₹240 / Archery ₹90 / Bungee ₹144\n` +
      `  target total: ₹${TARGET_REFUND_TOTAL}\n` +
      `  wallet end:   ₹${TARGET_WALLET_END}\n`,
  );
  if (CONFIRM) console.log('*** WRITES ENABLED ***\n');

  // ── Phase A — Discovery + pre-state assertions ──────────────────────────
  console.log(`${tag} Phase A — Discovery & pre-state guards`);
  console.log(`${tag}   loading ${BOOKINGS_COLLECTION} collection ...`);
  const snap = await db.collection(BOOKINGS_COLLECTION).get();
  console.log(`${tag}   total docs: ${snap.size}`);

  const refundedBookings = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    if (normalizePhone(data.customerPhone) !== PHONE) return;
    if (dateOf(data) !== REFUND_DATE) return;
    if (data.paymentStatus !== 'completed') return;
    if (data.cancelled === true) return;
    if (Number(data.refundAmount || 0) <= 0) return;
    if (doc.id === NEW_BOOKING_ID) return; // exclude the follow-up POS sale
    refundedBookings.push({ id: doc.id, data });
  });
  refundedBookings.sort((a, b) =>
    String(a.data.transactionDate || '').localeCompare(String(b.data.transactionDate || '')),
  );

  console.log(`${tag}   refunded bookings matched: ${refundedBookings.length}`);
  if (refundedBookings.length !== 35) {
    die(`expected exactly 35 refunded bookings, found ${refundedBookings.length}`);
  }

  // Slot tally + sum check
  const oldRefundSum = refundedBookings.reduce(
    (s, b) => s + Number(b.data.refundAmount || 0),
    0,
  );
  console.log(`${tag}   sum of existing refundAmounts: ₹${oldRefundSum.toFixed(2)}`);
  if (Math.abs(oldRefundSum - EXPECTED_OLD_REFUND_SUM) > TOL) {
    die(
      `sum of existing refundAmounts ₹${oldRefundSum.toFixed(2)} ≠ expected ₹${EXPECTED_OLD_REFUND_SUM}`,
    );
  }

  const slotTally = { cricket: 0, 'rocket ejecter': 0, archery: 0, 'bungee trampoline': 0 };
  let totalRefundedItems = 0;
  for (const b of refundedBookings) {
    const items = Array.isArray(b.data.items) ? b.data.items : [];
    for (const it of items) {
      if (!it.refunded) continue;
      const act = canonicalActivity(it.itemName);
      if (!act) {
        die(`booking ${b.id}: refunded item with unmatched activity name "${it.itemName}"`);
      }
      slotTally[act] += Number(it.quantity || 0);
      totalRefundedItems += 1;
    }
  }
  console.log(`${tag}   refunded items: ${totalRefundedItems}`);
  console.log(`${tag}   slot tally: ${JSON.stringify(slotTally)}`);
  for (const k of Object.keys(QUOTA)) {
    if (slotTally[k] !== QUOTA[k]) {
      die(`activity ${k}: expected ${QUOTA[k]} slots, found ${slotTally[k]}`);
    }
  }

  // POS booking pre-state
  console.log(`${tag}   loading ${NEW_BOOKING_ID} ...`);
  const posDoc = await db.collection(BOOKINGS_COLLECTION).doc(NEW_BOOKING_ID).get();
  if (!posDoc.exists) die(`${NEW_BOOKING_ID} not found`);
  const posData = posDoc.data();
  if (normalizePhone(posData.customerPhone) !== PHONE) {
    die(`${NEW_BOOKING_ID} customerPhone mismatch`);
  }
  if (posData.paymentStatus !== 'completed') {
    die(`${NEW_BOOKING_ID} paymentStatus ≠ completed (${posData.paymentStatus})`);
  }
  if (Number(posData.totalAmount || 0) !== EXPECTED_OLD_REDEMPTION) {
    die(
      `${NEW_BOOKING_ID} totalAmount ₹${posData.totalAmount} ≠ expected ₹${EXPECTED_OLD_REDEMPTION}`,
    );
  }
  if (Number(posData.walletRedeemed || 0) !== EXPECTED_OLD_REDEMPTION) {
    die(
      `${NEW_BOOKING_ID} walletRedeemed ₹${posData.walletRedeemed} ≠ expected ₹${EXPECTED_OLD_REDEMPTION}`,
    );
  }
  console.log(
    `${tag}   ✓ ${NEW_BOOKING_ID}: total=₹${posData.totalAmount} walletRedeemed=₹${posData.walletRedeemed}`,
  );

  // Wallet pre-state
  console.log(`${tag}   loading users/${USER_ID}/wallet/data ...`);
  const walletRef = db.doc(`users/${USER_ID}/wallet/data`);
  const walletDoc = await walletRef.get();
  if (!walletDoc.exists) die(`wallet doc users/${USER_ID}/wallet/data not found`);
  const walletBefore = Number(walletDoc.data().balance || 0);
  if (Math.abs(walletBefore - EXPECTED_OLD_WALLET) > 0.001) {
    die(`wallet balance ₹${walletBefore} ≠ expected ₹${EXPECTED_OLD_WALLET}`);
  }
  console.log(`${tag}   ✓ wallet balance: ₹${walletBefore}`);

  // ── Phase B — Plan ──────────────────────────────────────────────────────
  console.log(`\n${tag} Phase B — Plan`);

  const bookingPatches = [];
  let newGrandTotal = 0;

  for (const b of refundedBookings) {
    const items = Array.isArray(b.data.items) ? [...b.data.items] : [];
    const picks = [];
    let docNewRefund = 0;
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (!it || !it.refunded) continue;
      const act = canonicalActivity(it.itemName);
      const qty = Number(it.quantity || 0);
      const unit = UNIT_PRICE[act];
      const { total, base, gst } = split(unit, qty);
      docNewRefund += total;
      picks.push({ idx, activity: act, qty, unit, total, base, gst, name: it.itemName });
    }
    docNewRefund = round2(docNewRefund);
    newGrandTotal += docNewRefund;

    const oldRefund = round2(Number(b.data.refundAmount || 0));
    const totalAmt = Number(b.data.totalAmount || 0);
    const allRefunded = items.every((i) => i && i.refunded);
    const newStatus =
      allRefunded || docNewRefund + TOL >= totalAmt ? 'Full' : 'Partial';

    bookingPatches.push({
      id: b.id,
      invoiceNumber: b.data.invoiceNumber,
      totalAmount: totalAmt,
      oldRefund,
      newRefund: docNewRefund,
      newStatus,
      picks,
    });
  }
  newGrandTotal = round2(newGrandTotal);

  for (const p of bookingPatches) {
    const sign = p.newRefund > p.oldRefund ? '+' : p.newRefund < p.oldRefund ? '-' : '=';
    console.log(
      `${tag}   ${p.id}  refund: ₹${p.oldRefund.toFixed(2)} → ₹${p.newRefund.toFixed(2)} (${sign}₹${Math.abs(p.newRefund - p.oldRefund).toFixed(2)})  ${p.newStatus}`,
    );
    for (const pk of p.picks) {
      console.log(
        `${tag}     [${String(pk.idx).padStart(2, ' ')}] ${pk.activity.padEnd(18)} qty=${pk.qty}  ` +
          `unit=₹${pk.unit}  base=₹${pk.base.toFixed(2)}  gst=₹${pk.gst.toFixed(2)}  total=₹${pk.total.toFixed(2)}`,
      );
    }
  }
  console.log(`${tag}   ─────────`);
  console.log(`${tag}   booking patches:      ${bookingPatches.length}`);
  console.log(`${tag}   new grand total:      ₹${newGrandTotal.toFixed(2)}`);
  console.log(
    `${tag}   diff vs old refund:   ₹${(newGrandTotal - oldRefundSum).toFixed(2)}`,
  );
  if (Math.abs(newGrandTotal - TARGET_REFUND_TOTAL) > TOL) {
    die(
      `new grand total ₹${newGrandTotal.toFixed(2)} ≠ target ₹${TARGET_REFUND_TOTAL}`,
    );
  }

  console.log(
    `${tag}   POS booking ${NEW_BOOKING_ID}: total ₹${EXPECTED_OLD_REDEMPTION} → ₹${TARGET_BOOKING_TOTAL},  walletRedeemed ₹${EXPECTED_OLD_REDEMPTION} → ₹${TARGET_BOOKING_TOTAL}`,
  );
  console.log(
    `${tag}   wallet:                ₹${walletBefore} → ₹${TARGET_WALLET_END}  (correction credit ₹${CORRECTION_CREDIT})`,
  );

  if (DRY_RUN) {
    console.log('\n(dry-run — no writes performed. Re-run with --confirm to apply.)\n');
    process.exit(0);
  }

  // ── Phase C — Execute ───────────────────────────────────────────────────
  console.log(`\n${tag} Phase C — Execute`);

  // 1. Per-booking patches
  for (const p of bookingPatches) {
    const ref = db.collection(BOOKINGS_COLLECTION).doc(p.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error(`${p.id} disappeared`);
      const cur = snap.data();
      if (cur.cancelled === true) throw new Error(`${p.id} was cancelled`);
      if (Math.abs(Number(cur.refundAmount || 0) - p.oldRefund) > TOL) {
        throw new Error(
          `${p.id} refundAmount drift: expected ₹${p.oldRefund}, got ₹${cur.refundAmount}`,
        );
      }
      const items = Array.isArray(cur.items) ? [...cur.items] : [];
      for (const pk of p.picks) {
        const fresh = items[pk.idx];
        if (!fresh) throw new Error(`${p.id}: item ${pk.idx} missing`);
        if (!fresh.refunded) {
          throw new Error(`${p.id}: item ${pk.idx} no longer marked refunded`);
        }
        if (canonicalActivity(fresh.itemName) !== pk.activity) {
          throw new Error(
            `${p.id}: item ${pk.idx} activity drift (was ${pk.activity}, now ${fresh.itemName})`,
          );
        }
        items[pk.idx] = {
          ...fresh,
          refunded: true,
          itemBaseAmount: pk.base,
          itemGstAmount: pk.gst,
        };
      }
      tx.update(ref, {
        items,
        refundAmount: p.newRefund,
        refundStatus: p.newStatus,
        refundReason: REASON,
        updatedAt: nowIso(),
      });
    });
    console.log(
      `${tag}   ✓ ${p.id}  refundAmount=₹${p.newRefund.toFixed(2)}  status=${p.newStatus}`,
    );
  }

  // 2. POS booking patch
  const posRef = db.collection(BOOKINGS_COLLECTION).doc(NEW_BOOKING_ID);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(posRef);
    if (!snap.exists) throw new Error(`${NEW_BOOKING_ID} disappeared`);
    const cur = snap.data();
    if (Number(cur.totalAmount || 0) !== EXPECTED_OLD_REDEMPTION) {
      throw new Error(
        `${NEW_BOOKING_ID} totalAmount drift: expected ₹${EXPECTED_OLD_REDEMPTION}, got ₹${cur.totalAmount}`,
      );
    }
    if (Number(cur.walletRedeemed || 0) !== EXPECTED_OLD_REDEMPTION) {
      throw new Error(
        `${NEW_BOOKING_ID} walletRedeemed drift: expected ₹${EXPECTED_OLD_REDEMPTION}, got ₹${cur.walletRedeemed}`,
      );
    }
    tx.update(posRef, {
      totalAmount: TARGET_BOOKING_TOTAL,
      walletRedeemed: TARGET_BOOKING_TOTAL,
      updatedAt: nowIso(),
    });
  });
  console.log(
    `${tag}   ✓ ${NEW_BOOKING_ID}  totalAmount=₹${TARGET_BOOKING_TOTAL}  walletRedeemed=₹${TARGET_BOOKING_TOTAL}`,
  );

  // 3. Wallet correction
  const walletTxId = `correction-bulk-refund-1775931247077`;
  const walletTxRef = db.doc(`users/${USER_ID}/wallet_transactions/${walletTxId}`);
  const rootUserRef = db.doc(`users/${USER_ID}`);
  await db.runTransaction(async (tx) => {
    const wSnap = await tx.get(walletRef);
    const cur = wSnap.exists ? Number(wSnap.data().balance || 0) : 0;
    if (Math.abs(cur - EXPECTED_OLD_WALLET) > 0.001) {
      throw new Error(`wallet balance drift: expected ₹${EXPECTED_OLD_WALLET}, got ₹${cur}`);
    }
    tx.set(
      walletRef,
      {
        balance: TARGET_WALLET_END,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(rootUserRef, { walletBalance: TARGET_WALLET_END }, { merge: true });
    tx.set(walletTxRef, {
      type: 'credit',
      amount: CORRECTION_CREDIT,
      description:
        `Correction: 2026-04-11 bulk refund recomputed at menu prices ` +
        `(Cricket ₹144, Rocket ₹240, Archery ₹90, Bungee ₹144). ` +
        `Original credit ₹9,264 stands; redemption on ${NEW_BOOKING_ID} ` +
        `reduced ₹9,250 → ₹9,006. Wallet final ₹258.`,
      source: 'bulk-refund-correction-script',
      relatedBookings: [NEW_BOOKING_ID, ...bookingPatches.map((p) => p.id)],
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  console.log(
    `${tag}   ✓ wallet: ₹${walletBefore} → ₹${TARGET_WALLET_END}  audit=${walletTxId}`,
  );

  // ── Phase D — Verify ────────────────────────────────────────────────────
  console.log(`\n${tag} Phase D — Verify`);
  let failures = 0;
  let verifySum = 0;
  for (const p of bookingPatches) {
    const post = await db.collection(BOOKINGS_COLLECTION).doc(p.id).get();
    const d = post.data();
    let ok = true;
    if (Math.abs(Number(d.refundAmount) - p.newRefund) > TOL) {
      console.error(
        `${tag}   ✗ ${p.id} refundAmount expected ₹${p.newRefund} got ₹${d.refundAmount}`,
      );
      ok = false;
      failures++;
    }
    for (const pk of p.picks) {
      const it = d.items[pk.idx];
      if (!it || it.refunded !== true) {
        console.error(`${tag}   ✗ ${p.id} item[${pk.idx}] refunded flag missing`);
        ok = false;
        failures++;
      } else if (Math.abs(Number(it.itemBaseAmount) - pk.base) > TOL) {
        console.error(
          `${tag}   ✗ ${p.id} item[${pk.idx}] base expected ₹${pk.base} got ₹${it.itemBaseAmount}`,
        );
        ok = false;
        failures++;
      }
    }
    verifySum += Number(d.refundAmount || 0);
    if (ok) {
      console.log(
        `${tag}   ✓ ${p.id}  refundAmount=₹${Number(d.refundAmount).toFixed(2)}`,
      );
    }
  }
  console.log(`${tag}   verify sum: ₹${verifySum.toFixed(2)} (target ₹${TARGET_REFUND_TOTAL})`);
  if (Math.abs(verifySum - TARGET_REFUND_TOTAL) > TOL) {
    failures++;
  }

  const posPost = await db.collection(BOOKINGS_COLLECTION).doc(NEW_BOOKING_ID).get();
  const pp = posPost.data();
  if (Number(pp.totalAmount) === TARGET_BOOKING_TOTAL && Number(pp.walletRedeemed) === TARGET_BOOKING_TOTAL) {
    console.log(
      `${tag}   ✓ ${NEW_BOOKING_ID}  totalAmount=₹${pp.totalAmount}  walletRedeemed=₹${pp.walletRedeemed}`,
    );
  } else {
    console.error(`${tag}   ✗ ${NEW_BOOKING_ID} amounts wrong`);
    failures++;
  }

  const wPost = await walletRef.get();
  const wPostBal = wPost.exists ? Number(wPost.data().balance || 0) : 0;
  if (Math.abs(wPostBal - TARGET_WALLET_END) > 0.001) {
    console.error(`${tag}   ✗ wallet ₹${wPostBal} ≠ ₹${TARGET_WALLET_END}`);
    failures++;
  } else {
    console.log(`${tag}   ✓ wallet balance: ₹${wPostBal}`);
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} verification failure(s). INVESTIGATE.\n`);
    process.exit(2);
  }
  console.log('\n✓ Bulk refund correction complete and verified.\n');
})().catch((err) => {
  console.error('\ncorrect-bulk-refund script failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
