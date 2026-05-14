/**
 * Delete vendorLedger credit rows whose vendor's branch does NOT match
 * the referenced booking's branch. These are the cross-branch matcher
 * false positives (Morampudi / V L N Varma / Manohar / Jagadish kkd
 * etc.) that the new branch gate in vendor-ledger-sync.js will block
 * going forward.
 *
 * Scope: all rows of type 'credit' across all dates. Pass --week to
 * limit to a specific accounting week.
 *
 * Safety:
 *   - Default is --dry-run; pass --apply to actually delete.
 *   - Before deletion, writes a JSON backup of every row to
 *     `backups/cross-branch-ghost-deletes-{timestamp}.json` so the
 *     operation is fully reversible.
 *   - Backups go to a local folder, NOT a Firestore collection — the
 *     production data is left clean (no `dataFix` markers).
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';

const APPLY = process.argv.includes('--apply');
const fromYMD = process.argv.includes('--week') ? process.argv[process.argv.indexOf('--week') + 1] : null;
const toYMD = process.argv.includes('--to') ? process.argv[process.argv.indexOf('--to') + 1] : null;

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID, ignoreUndefinedProperties: true });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const dateOf = (d) => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d.toDate) return d.toDate().toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

const canonBranch = (raw, locMap) => {
  if (raw == null) return '';
  const s = String(raw).toLowerCase().trim();
  if (!s) return '';
  return locMap.get(s) || s;
};

(async () => {
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (fromYMD) console.log(`Window: ${fromYMD} → ${toYMD || 'today'}`);

  const [ledgerSnap, locsSnap, vDetailsSnap] = await Promise.all([
    db.collection('vendorLedger').get(),
    db.collection('locations').get(),
    db.collection('vendorDetails').get(),
  ]);

  const locMap = new Map();
  for (const d of locsSnap.docs) {
    const data = d.data() || {};
    if (typeof data.name === 'string') locMap.set(data.name.toLowerCase().trim(), d.id);
    const aliases = Array.isArray(data.aliases) ? data.aliases : [];
    for (const a of aliases) if (typeof a === 'string') locMap.set(a.toLowerCase().trim(), d.id);
    locMap.set(d.id.toLowerCase().trim(), d.id);
  }

  const vendorBranch = new Map();
  for (const d of vDetailsSnap.docs) {
    const data = d.data() || {};
    const raw = data.branchId != null ? data.branchId : data.branch;
    const canon = canonBranch(raw, locMap);
    if (canon) vendorBranch.set(d.id, canon);
  }

  console.log(
    `\nLoaded: ${ledgerSnap.size} ledger rows, ${locMap.size} location aliases, ${vendorBranch.size} vendor branches`,
  );

  // Walk the ledger; classify each row.
  const toDelete = [];
  let scanned = 0;
  let skippedInsideWindow = 0;
  let skippedSameBranch = 0;
  let skippedNoRef = 0;
  let skippedDebit = 0;
  let skippedVendorBranchUnknown = 0;
  let skippedBookingMissing = 0;

  // Build bookingId→branch lookup lazily to avoid loading all bookings.
  const bookingBranchCache = new Map();
  const getBookingBranch = async (bId) => {
    if (bookingBranchCache.has(bId)) return bookingBranchCache.get(bId);
    const snap = await db.collection('bookings').doc(bId).get();
    const v = snap.exists ? canonBranch(snap.data().locationId, locMap) : null;
    bookingBranchCache.set(bId, v);
    return v;
  };

  for (const doc of ledgerSnap.docs) {
    scanned++;
    const e = doc.data();
    if (e.type === 'debit') {
      skippedDebit++;
      continue;
    }
    if (fromYMD) {
      const dt = dateOf(e.date || e.transactionDate || e.createdAt);
      if (dt < fromYMD || (toYMD && dt > toYMD)) {
        skippedInsideWindow++;
        continue;
      }
    }
    const ref = e.bookingId || e.referenceId || '';
    if (!ref) {
      skippedNoRef++;
      continue;
    }
    const vBr = vendorBranch.get(e.vendorId);
    if (!vBr) {
      skippedVendorBranchUnknown++;
      continue;
    }
    const bBr = await getBookingBranch(ref);
    if (!bBr) {
      skippedBookingMissing++;
      continue;
    }
    if (vBr === bBr) {
      skippedSameBranch++;
      continue;
    }
    toDelete.push({
      ledgerId: doc.id,
      vendorId: e.vendorId,
      vendorBranch: vBr,
      bookingId: ref,
      bookingBranch: bBr,
      amount: num(e.amount),
      date: dateOf(e.date || e.transactionDate || e.createdAt),
      raw: e,
    });
  }

  const totalAmount = toDelete.reduce((s, r) => s + r.amount, 0);
  console.log(`\nScanned ${scanned} ledger rows.`);
  console.log(`  Skipped debit                 : ${skippedDebit}`);
  console.log(`  Skipped outside window        : ${skippedInsideWindow}`);
  console.log(`  Skipped no referenceId        : ${skippedNoRef}`);
  console.log(`  Skipped vendor branch unknown : ${skippedVendorBranchUnknown}`);
  console.log(`  Skipped booking missing       : ${skippedBookingMissing}`);
  console.log(`  Skipped same-branch (kept)    : ${skippedSameBranch}`);
  console.log(`  Cross-branch (to delete)      : ${toDelete.length}  sum=₹${Math.round(totalAmount)}`);

  if (toDelete.length === 0) {
    console.log('\nNothing to delete. Exiting.');
    process.exit(0);
  }

  // Sample
  console.log('\nSample (first 20):');
  for (const r of toDelete.slice(0, 20)) {
    console.log(
      `  ${r.date}  ₹${String(r.amount).padStart(5)}  vendor=${r.vendorId} (br=${r.vendorBranch})  booking=${r.bookingId} (br=${r.bookingBranch})`,
    );
  }

  if (!APPLY) {
    console.log('\n⏸  dry run — pass --apply to delete.');
    process.exit(0);
  }

  // Backup before delete.
  const backupDir = path.resolve('backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `cross-branch-ghost-deletes-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      toDelete.map((r) => ({
        ledgerId: r.ledgerId,
        vendorId: r.vendorId,
        vendorBranch: r.vendorBranch,
        bookingId: r.bookingId,
        bookingBranch: r.bookingBranch,
        amount: r.amount,
        date: r.date,
        raw: r.raw,
      })),
      null,
      2,
    ),
  );
  console.log(`\n✓ Backup saved to ${backupPath}`);

  // Batched delete
  let deleted = 0;
  const BATCH_SIZE = 400;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const chunk = toDelete.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const r of chunk) {
      batch.delete(db.collection('vendorLedger').doc(r.ledgerId));
    }
    await batch.commit();
    deleted += chunk.length;
    process.stderr.write(`  deleted ${deleted}/${toDelete.length}\r`);
  }
  console.log(`\n✓ Deleted ${deleted} cross-branch ghost ledger rows (₹${Math.round(totalAmount)} recovered).`);
  process.exit(0);
})().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
