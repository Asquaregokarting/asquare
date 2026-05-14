/**
 * One-off bulk refund: customer phone 9421779143, today's POS bookings.
 *
 * Refund quota (per-ride / per-token line items):
 *   Cricket             ×  3
 *   Rocket Ejecter      × 25
 *   Archery             × 11
 *   Bungee Trampoline   × 11
 *   ─────────────────────────
 *   Total               × 50 line items
 *
 * Refund destination: customer wallet credit (single aggregated credit at the
 * end). No Razorpay reverse, no manual cash. Mirrors the production refund
 * path in src/pipeline/api/billing-firestore.ts (`refundSelectedItems` +
 * `creditCustomerWallet`) but runs server-side via the Firebase Admin SDK so
 * it doesn't need to plumb through staff auth tokens.
 *
 * Phases:
 *   A. Discovery   — load today's bookings for the phone (read-only)
 *   B. Plan        — pick item indices, hard-fail if quota can't be met
 *   C. Execute     — runTransaction per booking + final wallet runTransaction
 *   D. Verify      — re-read everything and assert state matches
 *
 * Usage:
 *   node scripts/bulk-refund-9421779143.cjs                         # dry-run
 *   node scripts/bulk-refund-9421779143.cjs --confirm                # apply
 *   node scripts/bulk-refund-9421779143.cjs --date 2026-04-11        # override "today"
 *   node scripts/bulk-refund-9421779143.cjs --confirm --date 2026-04-10
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── CLI flags ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const DRY_RUN = !CONFIRM;
const dateFlagIdx = args.indexOf('--date');
const DATE_OVERRIDE = dateFlagIdx >= 0 ? args[dateFlagIdx + 1] : null;

// ─── Constants ──────────────────────────────────────────────────────────────
const PHONE = '9421779143';
const REASON = 'Bulk refund — customer request';

// Quota keyed by canonical activity name. Each unit = one "slot" (one
// person-play of that activity). A combo line with quantity=2 supplies 2 slots.
const REFUND_QUOTA = {
  cricket: 3,
  'rocket ejecter': 25,
  archery: 11,
  'bungee trampoline': 11,
};

// Strict prefix regex per activity to avoid false positives. Notably:
//   - "MINI TRAMPOLINE" must NOT match Bungee Trampoline.
//   - "ROCKET  EJECTOR" (double space) is the actual data — match \s+.
//   - "BYCYCLE ZIPLINE" must NOT match anything.
const ACTIVITY_PATTERNS = [
  { activity: 'cricket', regex: /^CRICKET\b/i },
  { activity: 'rocket ejecter', regex: /^ROCKET\s+EJECT(?:OR|ER)\b/i },
  { activity: 'archery', regex: /^ARCHERY\b/i },
  { activity: 'bungee trampoline', regex: /^BUNGEE\s+TRAMPOLINE\b/i },
];

const BOOKINGS_COLLECTION = 'bookings'; // BILLING_TRANSACTIONS_COLLECTION
const VENDOR_LEDGER_COLLECTION = 'vendorLedger';
const DATABASE_ID = 'asquare-app-db';

// ─── Helpers ────────────────────────────────────────────────────────────────
const tag = DRY_RUN ? '[DRY]' : '[RUN]';

const normalizePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const todayInIST = () => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // YYYY-MM-DD
};

const TARGET_DATE = DATE_OVERRIDE || todayInIST();
if (!/^\d{4}-\d{2}-\d{2}$/.test(TARGET_DATE)) {
  console.error(`ABORT: --date must be YYYY-MM-DD, got: ${TARGET_DATE}`);
  process.exit(1);
}

const canonicalActivity = (itemName) => {
  const name = String(itemName || '').trim();
  for (const { activity, regex } of ACTIVITY_PATTERNS) {
    if (regex.test(name)) return activity;
  }
  return null;
};

// Pro-rata price per "slot" (one person-play) for a transaction. The combo
// stores no per-item price — only baseAmount + gstAmount at the doc level —
// so we split the doc total evenly across all item-quantity slots.
const computeSlotPricing = (data) => {
  const items = Array.isArray(data.items) ? data.items : [];
  const totalSlots = items.reduce((s, it) => s + Number(it.quantity || 0), 0);
  if (totalSlots <= 0) return null;
  const base = Number(data.baseAmount || 0);
  const gst = Number(data.gstAmount || 0);
  const total = Number(data.totalAmount || 0);
  // Prefer base+gst (matches the production billing math); fall back to total.
  const grand = base + gst > 0 ? base + gst : total;
  return {
    totalSlots,
    basePerSlot: base / totalSlots,
    gstPerSlot: gst / totalSlots,
    pricePerSlot: grand / totalSlots,
  };
};

// Mirrors src/pipeline/api/billing-firestore.ts mapTransactionRecord — extracts
// a YYYY-MM-DD date string from heterogeneous transactionDate / createdAt fields.
const extractDateString = (data) => {
  const tryToDateString = (val) => {
    if (!val) return null;
    if (typeof val === 'object' && typeof val.toDate === 'function') {
      try {
        return val.toDate().toISOString().slice(0, 10);
      } catch {
        return null;
      }
    }
    const s = String(val);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  };
  return tryToDateString(data.transactionDate) || tryToDateString(data.createdAt);
};

// Refund amount for a single item line, computed from the doc's slot pricing
// (combos store no per-item price, so we have to derive it pro-rata).
const itemRefundAmount = (item, slotPricing) => {
  const qty = Number(item.quantity || 0);
  if (slotPricing && qty > 0) {
    return {
      base: slotPricing.basePerSlot * qty,
      gst: slotPricing.gstPerSlot * qty,
      total: slotPricing.pricePerSlot * qty,
    };
  }
  // Fallback: use the production formula if a real per-item price exists.
  const base = item.itemBaseAmount != null
    ? Number(item.itemBaseAmount)
    : Number(item.unitPrice || 0) * qty;
  const gst = item.itemGstAmount != null ? Number(item.itemGstAmount) : 0;
  return { base, gst, total: base + gst };
};

// ─── Firebase Admin SDK setup ───────────────────────────────────────────────
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
    `\n${DRY_RUN ? 'DRY-RUN' : 'REAL RUN'} — bulk refund\n` +
      `  phone:   ${PHONE}\n` +
      `  date:    ${TARGET_DATE}${DATE_OVERRIDE ? '' : ' (IST today)'}\n` +
      `  reason:  ${REASON}\n` +
      `  quota:   ${Object.entries(REFUND_QUOTA)
        .map(([k, v]) => `${k}×${v}`)
        .join(', ')}\n`,
  );
  if (CONFIRM) console.log('*** WRITES ENABLED ***\n');

  // ── Phase A — Discovery ──────────────────────────────────────────────────
  console.log(`${tag} Phase A — Discovery`);
  console.log(`${tag}   loading ${BOOKINGS_COLLECTION} collection ...`);
  const snap = await db.collection(BOOKINGS_COLLECTION).get();
  console.log(`${tag}   total docs: ${snap.size}`);

  const normalizedTarget = normalizePhone(PHONE);
  const candidates = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    if (normalizePhone(data.customerPhone) !== normalizedTarget) return;
    if (extractDateString(data) !== TARGET_DATE) return;
    if (data.paymentStatus !== 'completed') return;
    if (data.cancelled === true) return;
    if (data.refundStatus === 'Full') return;
    candidates.push({ id: doc.id, data });
  });
  // Oldest first — greedy quota fill walks chronologically.
  candidates.sort((a, b) => {
    const da = String(a.data.transactionDate || a.data.createdAt || '');
    const db_ = String(b.data.transactionDate || b.data.createdAt || '');
    return da.localeCompare(db_);
  });

  console.log(`${tag}   matching transactions: ${candidates.length}`);
  if (candidates.length === 0) {
    console.error(`\nABORT: no eligible transactions for ${PHONE} on ${TARGET_DATE}.`);
    process.exit(1);
  }

  for (const c of candidates) {
    const items = Array.isArray(c.data.items) ? c.data.items : [];
    const refundedCount = items.filter((i) => i.refunded).length;
    console.log(
      `${tag}   • ${c.id}  invoice=${c.data.invoiceNumber || '-'}  ` +
        `items=${items.length}  alreadyRefunded=${refundedCount}  ` +
        `refundStatus=${c.data.refundStatus || 'None'}  total=₹${c.data.totalAmount}`,
    );
  }

  // ── Phase B — Plan ───────────────────────────────────────────────────────
  console.log(`\n${tag} Phase B — Plan`);

  // Build availability per activity, walking transactions oldest → newest.
  // Each item line covers `quantity` slots; one slot = one refund unit.
  // Plan structure: Map<txnId, { id, data, slotPricing, picks: [...] }>
  const plan = new Map();
  const remaining = { ...REFUND_QUOTA };

  for (const c of candidates) {
    const items = Array.isArray(c.data.items) ? c.data.items : [];
    const slotPricing = computeSlotPricing(c.data);
    if (!slotPricing) continue; // doc with no priceable items

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (!item || item.refunded) continue;
      const qty = Number(item.quantity || 0);
      if (qty <= 0) continue;
      const activity = canonicalActivity(item.itemName);
      if (!activity) continue;
      if (!(activity in remaining) || remaining[activity] <= 0) continue;

      const refund = itemRefundAmount(item, slotPricing);
      if (!Number.isFinite(refund.total) || refund.total < 0) {
        console.error(`ABORT: item ${idx} in ${c.id} has invalid amount`);
        process.exit(1);
      }

      let entry = plan.get(c.id);
      if (!entry) {
        entry = { id: c.id, data: c.data, slotPricing, picks: [] };
        plan.set(c.id, entry);
      }
      // Whole-line refund: an item with qty=2 satisfies 2 slots and refunds
      // both slots' worth. May overshoot the quota by ≤(qty-1) — accept it.
      entry.picks.push({ idx, item, refund, activity, slots: qty });
      remaining[activity] -= qty;
      if (remaining[activity] < 0) remaining[activity] = 0;
    }
  }

  // Hard fail if any activity short.
  const shortfalls = Object.entries(remaining).filter(([, v]) => v > 0);
  if (shortfalls.length > 0) {
    console.error(`\nABORT: insufficient line items to fulfil quota.`);
    for (const [activity, missing] of shortfalls) {
      const requested = REFUND_QUOTA[activity];
      const filled = requested - missing;
      console.error(`  ${activity}: need ${requested}, found ${filled}, missing ${missing}`);
    }
    console.error(
      `\nDouble-check the activity name spellings in REFUND_QUOTA / NAME_ALIASES.\n` +
        `Item names actually present today (sample):`,
    );
    const seen = new Set();
    for (const c of candidates) {
      for (const it of Array.isArray(c.data.items) ? c.data.items : []) {
        if (it && it.itemName) seen.add(String(it.itemName));
      }
    }
    for (const name of seen) console.error(`  • ${name}`);
    process.exit(1);
  }

  // Plan summary.
  let grandTotal = 0;
  let grandSlots = 0;
  for (const entry of plan.values()) {
    console.log(
      `${tag}   ${entry.id}  invoice=${entry.data.invoiceNumber || '-'}  ` +
        `slot=₹${entry.slotPricing.pricePerSlot.toFixed(2)}`,
    );
    for (const p of entry.picks) {
      console.log(
        `${tag}     [${String(p.idx).padStart(2, ' ')}]  ${p.activity.padEnd(18)}  ` +
          `qty=${p.slots}  ₹${p.refund.total.toFixed(2)}  (${p.item.itemName})`,
      );
      grandTotal += p.refund.total;
      grandSlots += p.slots;
    }
  }
  const totalCount = [...plan.values()].reduce((n, e) => n + e.picks.length, 0);
  // Quota fill summary (slots picked vs requested).
  const filled = {};
  for (const entry of plan.values()) {
    for (const p of entry.picks) {
      filled[p.activity] = (filled[p.activity] || 0) + p.slots;
    }
  }
  console.log(`${tag}   ─────────`);
  console.log(`${tag}   transactions touched: ${plan.size}`);
  console.log(`${tag}   line items marked:    ${totalCount}`);
  console.log(`${tag}   slots refunded:       ${grandSlots}`);
  for (const k of Object.keys(REFUND_QUOTA)) {
    const got = filled[k] || 0;
    const want = REFUND_QUOTA[k];
    const flag = got >= want ? '✓' : '✗';
    console.log(`${tag}     ${flag} ${k.padEnd(18)} ${got}/${want}${got > want ? ` (overshoot +${got - want})` : ''}`);
  }
  console.log(`${tag}   GRAND TOTAL:          ₹${grandTotal.toFixed(2)}`);

  if (DRY_RUN) {
    console.log('\n(dry-run — no writes performed. Re-run with --confirm to apply.)\n');
    process.exit(0);
  }

  // ── Phase C — Execute ───────────────────────────────────────────────────
  console.log(`\n${tag} Phase C — Execute`);

  const ledgerWritesPerTxn = []; // {txnId, ledgerIds: []}

  for (const entry of plan.values()) {
    const txnRef = db.collection(BOOKINGS_COLLECTION).doc(entry.id);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(txnRef);
      if (!snap.exists) throw new Error(`Transaction ${entry.id} disappeared`);
      const cur = snap.data();
      if (cur.refundStatus === 'Full') {
        throw new Error(`${entry.id} is already fully refunded`);
      }
      if (cur.cancelled === true) {
        throw new Error(`${entry.id} was cancelled`);
      }
      const items = Array.isArray(cur.items) ? [...cur.items] : [];

      // Recompute slot pricing from the fresh doc — guards against the doc
      // having been edited between Phase B and now.
      const freshSlotPricing = computeSlotPricing(cur);
      if (!freshSlotPricing) {
        throw new Error(`${entry.id}: cannot compute slot pricing on fresh read`);
      }

      // Re-validate every pick against fresh state.
      let addedRefund = 0;
      const vendorAccum = new Map();
      const refundedItemNames = [];
      for (const p of entry.picks) {
        if (p.idx < 0 || p.idx >= items.length) {
          throw new Error(`${entry.id}: idx ${p.idx} out of range (items=${items.length})`);
        }
        const fresh = items[p.idx];
        if (!fresh) throw new Error(`${entry.id}: item ${p.idx} missing`);
        if (fresh.refunded) {
          throw new Error(`${entry.id}: item ${p.idx} (${fresh.itemName}) already refunded`);
        }
        if (canonicalActivity(fresh.itemName) !== p.activity) {
          throw new Error(
            `${entry.id}: item ${p.idx} activity drift (was ${p.activity}, now ${fresh.itemName})`,
          );
        }
        const refund = itemRefundAmount(fresh, freshSlotPricing);
        addedRefund += refund.total;
        // Persist the computed price into the item so the doc no longer shows
        // a phantom ₹0 line. Mirrors how a normal POS sale would store it.
        items[p.idx] = {
          ...fresh,
          refunded: true,
          itemBaseAmount: Number(refund.base.toFixed(2)),
          itemGstAmount: Number(refund.gst.toFixed(2)),
        };
        refundedItemNames.push(fresh.itemName);

        if (fresh.vendorId && Number(fresh.vendorTotal || 0) > 0) {
          const acc = vendorAccum.get(fresh.vendorId) || {
            vendorBase: 0,
            vendorGst: 0,
            vendorTotal: 0,
          };
          acc.vendorBase += Number(fresh.vendorBase || 0);
          acc.vendorGst += Number(fresh.vendorGst || 0);
          acc.vendorTotal += Number(fresh.vendorTotal || 0);
          vendorAccum.set(fresh.vendorId, acc);
        }
      }

      const totalRefund = Number(cur.refundAmount || 0) + addedRefund;
      const allRefunded = items.every((i) => i && i.refunded);
      const totalAmount = Number(cur.totalAmount || 0);
      const refundStatus = allRefunded || totalRefund >= totalAmount ? 'Full' : 'Partial';

      tx.update(txnRef, {
        items,
        refundAmount: totalRefund,
        refundStatus,
        refundReason: REASON,
        updatedAt: new Date().toISOString(),
      });

      // Vendor ledger debits — same shape as src/pipeline/api/billing-firestore.ts:1038.
      const ts = Date.now();
      const ledgerIds = [];
      for (const [vendorId, totals] of vendorAccum) {
        if (totals.vendorTotal <= 0) continue;
        const ledgerId = `le-refund-${entry.id}-${vendorId}-${ts}`;
        const ledgerRef = db.collection(VENDOR_LEDGER_COLLECTION).doc(ledgerId);
        tx.set(ledgerRef, {
          id: ledgerId,
          vendorId,
          vendorBase: totals.vendorBase,
          vendorGst: totals.vendorGst,
          amount: totals.vendorTotal,
          type: 'debit',
          referenceId: entry.id,
          invoiceNumber: cur.invoiceNumber,
          locationId: cur.locationId,
          date: cur.transactionDate,
          createdAt: new Date().toISOString(),
          source: 'refund',
        });
        ledgerIds.push(ledgerId);
      }

      return { addedRefund, totalRefund, refundStatus, refundedItemNames, ledgerIds };
    });

    console.log(
      `${tag}   ✓ ${entry.id}  +₹${result.addedRefund.toFixed(2)}  ` +
        `cumulative=₹${result.totalRefund.toFixed(2)}  status=${result.refundStatus}  ` +
        `ledgerEntries=${result.ledgerIds.length}`,
    );
    ledgerWritesPerTxn.push({ txnId: entry.id, ledgerIds: result.ledgerIds });
  }

  // ── Resolve customer userId via phoneToUid index ─────────────────────────
  console.log(`\n${tag} Resolving customer uid for ${PHONE} ...`);
  const indexSnap = await db.doc(`phoneToUid/${normalizedTarget}`).get();
  let userId = null;
  if (indexSnap.exists) {
    const mapped = indexSnap.data().uid;
    if (typeof mapped === 'string' && mapped.length > 0) userId = mapped;
  }
  if (!userId) {
    // Field-scan fallback, skipping any doc with a `role` field (staff guard).
    const variants = [normalizedTarget, `+91${normalizedTarget}`, `91${normalizedTarget}`];
    for (const v of variants) {
      if (userId) break;
      const q = await db.collection('users').where('phone', '==', v).get();
      for (const candidate of q.docs) {
        const data = candidate.data();
        if (data.role) continue;
        userId = candidate.id;
        break;
      }
    }
  }
  if (!userId) {
    console.error(
      `\nABORT (post-refund): customer uid not found for ${PHONE}. ` +
        `Bookings were refunded but wallet WAS NOT credited. Credit manually.`,
    );
    process.exit(2);
  }
  console.log(`${tag}   userId=${userId}`);

  // ── Final aggregated wallet credit ───────────────────────────────────────
  const walletRef = db.doc(`users/${userId}/wallet/data`);
  const rootUserRef = db.doc(`users/${userId}`);
  const walletTxId = `bulk-refund-${Date.now()}`;
  const walletTxRef = db.doc(`users/${userId}/wallet_transactions/${walletTxId}`);

  const walletResult = await db.runTransaction(async (tx) => {
    const wSnap = await tx.get(walletRef);
    const before = wSnap.exists ? Number(wSnap.data().balance || 0) : 0;
    const after = before + grandTotal;

    tx.set(
      walletRef,
      { balance: after, lastUpdated: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(rootUserRef, { walletBalance: after }, { merge: true });
    tx.set(walletTxRef, {
      type: 'credit',
      amount: grandTotal,
      description:
        `Bulk refund — Cricket×3, Rocket Ejecter×25, Archery×11, Bungee Trampoline×11`,
      source: 'bulk-refund-script',
      relatedBookings: [...plan.keys()],
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { before, after };
  });

  console.log(
    `${tag}   wallet: ₹${walletResult.before.toFixed(2)} → ₹${walletResult.after.toFixed(2)}  ` +
      `(+₹${grandTotal.toFixed(2)})  audit=${walletTxId}`,
  );

  // ── Phase D — Verify ────────────────────────────────────────────────────
  console.log(`\n${tag} Phase D — Verify`);
  let failures = 0;

  for (const entry of plan.values()) {
    const post = await db.collection(BOOKINGS_COLLECTION).doc(entry.id).get();
    const d = post.data();
    let ok = true;
    for (const p of entry.picks) {
      if (!d.items[p.idx] || d.items[p.idx].refunded !== true) {
        console.error(
          `${tag}   ✗ ${entry.id} item[${p.idx}] not marked refunded`,
        );
        ok = false;
        failures++;
      }
    }
    if (d.refundReason !== REASON) {
      console.error(`${tag}   ✗ ${entry.id} refundReason mismatch`);
      ok = false;
      failures++;
    }
    if (ok) {
      console.log(
        `${tag}   ✓ ${entry.id}  refundAmount=₹${Number(d.refundAmount).toFixed(2)}  status=${d.refundStatus}`,
      );
    }
  }

  const wPost = await walletRef.get();
  const wPostBalance = wPost.exists ? Number(wPost.data().balance || 0) : 0;
  if (Math.abs(wPostBalance - walletResult.after) > 0.01) {
    console.error(
      `${tag}   ✗ wallet balance mismatch: expected ₹${walletResult.after}, got ₹${wPostBalance}`,
    );
    failures++;
  } else {
    console.log(`${tag}   ✓ wallet balance verified: ₹${wPostBalance.toFixed(2)}`);
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} verification failure(s). INVESTIGATE BEFORE RE-RUNNING.\n`);
    process.exit(2);
  }
  console.log('\n✓ Bulk refund complete and verified.\n');
})().catch((err) => {
  console.error('\nbulk-refund script failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
