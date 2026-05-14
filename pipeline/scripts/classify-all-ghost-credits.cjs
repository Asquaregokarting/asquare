/**
 * For every over-credited vendor in the week, classify each ghost
 * ledger row as:
 *   - same-branch     : vendor.branchId matches booking.locationId → likely a metadata bug (vendorIds not stamped on booking)
 *   - cross-branch    : vendor.branchId differs from booking.locationId → true over-credit (matcher false positive across branches)
 *   - branch-unknown  : either side lacks branch info
 *
 * Output: per-vendor breakdown so we can decide whether the right fix
 * is metadata backfill (same-branch) or matcher branch-gate (cross-branch).
 *
 * Usage:
 *   node scripts/classify-all-ghost-credits.cjs 2026-05-02 2026-05-08
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';

const fromYMD = process.argv[2];
const toYMD = process.argv[3];
if (!fromYMD || !toYMD) {
  console.error('Usage: node scripts/classify-all-ghost-credits.cjs <fromYMD> <toYMD>');
  process.exit(1);
}

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const dateOf = (d) => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d.toDate) return d.toDate().toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};
const inRange = (ymd) => ymd >= fromYMD && ymd <= toYMD;

(async () => {
  const [ledgerSnap, locsSnap, vendorDetailsSnap] = await Promise.all([
    db.collection('vendorLedger').get(),
    db.collection('locations').get(),
    db.collection('vendorDetails').get(),
  ]);

  // Build locations id↔name map. Booking.locationId can be either a
  // numeric branchId like "2" or a name like "rajahmundry". Vendor's
  // branchId is always the numeric form. Normalise both to numeric.
  const nameToId = new Map(); // lowercased name → id
  for (const doc of locsSnap.docs) {
    const d = doc.data();
    if (typeof d.name === 'string') nameToId.set(d.name.toLowerCase().trim(), doc.id);
    if (Array.isArray(d.aliases)) {
      for (const a of d.aliases) {
        if (typeof a === 'string') nameToId.set(a.toLowerCase().trim(), doc.id);
      }
    }
    nameToId.set(doc.id.toLowerCase().trim(), doc.id); // identity
  }
  const canonBranch = (raw) => {
    if (!raw) return '';
    const s = String(raw).toLowerCase().trim();
    return nameToId.get(s) || s;
  };

  // Vendor branchId lookup
  const vendorBranchById = new Map();
  for (const doc of vendorDetailsSnap.docs) {
    const d = doc.data();
    const branchId = canonBranch(d.branchId ?? d.branch ?? d.locationId ?? '');
    vendorBranchById.set(doc.id, {
      branchId,
      branchName: d.branch || '',
      type: d.vendorType || '',
      share: num(d.revenueShare),
      name: d.userName || d.vendorName || '',
    });
  }

  // Group ledger rows in range by vendor
  const ledgerByVendor = new Map();
  for (const doc of ledgerSnap.docs) {
    const e = doc.data();
    const dt = dateOf(e.date || e.transactionDate || e.createdAt);
    if (!inRange(dt)) continue;
    const vid = e.vendorId;
    if (!vid) continue;
    const arr = ledgerByVendor.get(vid) ?? [];
    arr.push({
      id: doc.id,
      date: dt,
      amount: num(e.amount),
      type: e.type || '',
      bookingRef: e.bookingId || e.referenceId || '',
    });
    ledgerByVendor.set(vid, arr);
  }

  // For each vendor, classify each ledger row
  const summary = [];
  for (const [vid, rows] of ledgerByVendor.entries()) {
    const vendor = vendorBranchById.get(vid) || {};
    const vendorBranchId = vendor.branchId || '';

    let claimed = 0;
    let sumClaimed = 0;
    let sameBranchGhost = 0;
    let sumSameBranchGhost = 0;
    let crossBranchGhost = 0;
    let sumCrossBranchGhost = 0;
    let branchUnknownGhost = 0;
    let sumBranchUnknownGhost = 0;

    for (const r of rows) {
      if (!r.bookingRef) continue;
      const bSnap = await db.collection('bookings').doc(r.bookingRef).get();
      if (!bSnap.exists) continue;
      const b = bSnap.data();
      const bookingVendorIds = Array.isArray(b.vendorIds) ? b.vendorIds : [];
      if (bookingVendorIds.includes(vid)) {
        claimed++;
        sumClaimed += r.amount;
        continue;
      }
      // Ghost — classify by branch
      const bookingBranchId = canonBranch(b.locationId);
      if (!vendorBranchId || !bookingBranchId) {
        branchUnknownGhost++;
        sumBranchUnknownGhost += r.amount;
      } else if (vendorBranchId === bookingBranchId) {
        sameBranchGhost++;
        sumSameBranchGhost += r.amount;
      } else {
        crossBranchGhost++;
        sumCrossBranchGhost += r.amount;
      }
    }

    summary.push({
      vid,
      name: vendor.name || '',
      vendorBranchId,
      claimed,
      sumClaimed,
      sameBranchGhost,
      sumSameBranchGhost,
      crossBranchGhost,
      sumCrossBranchGhost,
      branchUnknownGhost,
      sumBranchUnknownGhost,
    });
  }

  summary.sort(
    (a, b) =>
      b.sumSameBranchGhost + b.sumCrossBranchGhost - (a.sumSameBranchGhost + a.sumCrossBranchGhost),
  );

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Ghost-credit branch classification · ${fromYMD} → ${toYMD}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  console.log(
    '  vendorId      name                            vbr  claimed    sameBranchGhost   crossBranchGhost   unknownGhost',
  );
  let totSame = 0;
  let totCross = 0;
  let totUnk = 0;
  for (const s of summary) {
    if (s.sameBranchGhost === 0 && s.crossBranchGhost === 0 && s.branchUnknownGhost === 0) continue;
    console.log(
      `  ${s.vid.padEnd(12)}  ${s.name.slice(0, 30).padEnd(30)}  ${String(s.vendorBranchId).padEnd(4)} ${String(s.claimed).padStart(3)}/₹${String(Math.round(s.sumClaimed)).padStart(6)}   ${String(s.sameBranchGhost).padStart(3)}/₹${String(Math.round(s.sumSameBranchGhost)).padStart(6)}    ${String(s.crossBranchGhost).padStart(3)}/₹${String(Math.round(s.sumCrossBranchGhost)).padStart(6)}    ${String(s.branchUnknownGhost).padStart(3)}/₹${String(Math.round(s.sumBranchUnknownGhost)).padStart(5)}`,
    );
    totSame += s.sumSameBranchGhost;
    totCross += s.sumCrossBranchGhost;
    totUnk += s.sumBranchUnknownGhost;
  }
  console.log('\nTotals:');
  console.log(`  same-branch ghost  (metadata bug): ₹${Math.round(totSame)}`);
  console.log(`  cross-branch ghost (matcher bug) : ₹${Math.round(totCross)}`);
  console.log(`  branch-unknown ghost              : ₹${Math.round(totUnk)}`);

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
