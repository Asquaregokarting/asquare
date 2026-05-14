/**
 * For a single payout period, dedupe vendor invoices so the Pending
 * Settlement page shows only the *real* remaining payout (ledger owed
 * minus what locked invoices already covered).
 *
 * For each vendor with activity in the period:
 *   1. Collect every vendorLedger entry for the vendor in [from, to]
 *      that nets > 0 after debits (so a refund-cancelled credit doesn't
 *      get re-billed).
 *   2. Collect every entry id already covered by a LOCKED invoice for
 *      that vendor + period.
 *   3. `remainingEntries` = ledger entries whose id is NOT in the
 *      locked set. Their sum is the real remaining payout.
 *   4. Delete every PENDING invoice for the vendor + period (they're
 *      the branch-name-format duplicates that double-bill).
 *   5. If `remainingEntries.length > 0`, write one consolidated pending
 *      invoice with those entries. Otherwise no invoice is created —
 *      the vendor is fully paid for the period.
 *
 * Locked invoices are never touched. A backup of every deleted pending
 * invoice is saved to `backups/dedupe-period-invoices-{stamp}.json`.
 *
 * Default mode is --dry-run; pass --apply to write.
 *
 * Usage:
 *   node scripts/dedupe-period-invoices.cjs 2026-04-18 2026-04-24
 *   node scripts/dedupe-period-invoices.cjs 2026-04-18 2026-04-24 --apply
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const APPLY = process.argv.includes('--apply');
const fromYMD = process.argv[2];
const toYMD = process.argv[3];
if (!fromYMD || !toYMD) {
  console.error('Usage: node scripts/dedupe-period-invoices.cjs <fromYMD> <toYMD> [--apply]');
  process.exit(1);
}

const keyPath = path.resolve('serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID, ignoreUndefinedProperties: true });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const r2 = (n) => Math.round(n);
const dateOf = (d) => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d.toDate) return d.toDate().toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};
const inRange = (ymd) => ymd >= fromYMD && ymd <= toYMD;

(async () => {
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Period: ${fromYMD} → ${toYMD}\n`);

  const [ledgerSnap, invoicesSnap, vDetailsSnap] = await Promise.all([
    db.collection('vendorLedger').get(),
    db.collection('vendorInvoices').get(),
    db.collection('vendorDetails').get(),
  ]);

  const vendorMeta = new Map();
  for (const d of vDetailsSnap.docs) {
    const data = d.data() || {};
    vendorMeta.set(d.id, {
      name: data.userName || data.vendorName || d.id,
      type: data.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty',
      branchId: String(data.branchId ?? '').trim(),
    });
  }

  // Ledger entries for the period, grouped by vendor.
  // Treat refund-debits as offsets: subtract them, but track remaining
  // credit entries (those not yet covered by any locked invoice).
  const ledgerByVendor = new Map();
  for (const doc of ledgerSnap.docs) {
    const e = doc.data();
    const dt = dateOf(e.date || e.transactionDate || e.createdAt);
    if (!inRange(dt)) continue;
    if (!e.vendorId) continue;
    const arr = ledgerByVendor.get(e.vendorId) ?? [];
    arr.push({
      id: doc.id,
      data: e,
      type: e.type || 'credit',
      amount: num(e.amount),
      base: num(e.vendorBase),
      gst: num(e.vendorGst),
      referenceId: e.referenceId || e.bookingId || '',
      date: dt,
    });
    ledgerByVendor.set(e.vendorId, arr);
  }

  // Invoices by vendor for this period.
  const invByVendor = new Map();
  for (const doc of invoicesSnap.docs) {
    const inv = doc.data();
    const ps = String(inv.periodStart || '').slice(0, 10);
    const pe = String(inv.periodEnd || '').slice(0, 10);
    if (ps !== fromYMD || pe !== toYMD) continue;
    if (!inv.vendorId) continue;
    const arr = invByVendor.get(inv.vendorId) ?? { locked: [], pending: [] };
    const status = String(inv.status || 'pending').toLowerCase();
    if (status === 'locked') arr.locked.push({ ref: doc.ref, id: doc.id, data: inv });
    else arr.pending.push({ ref: doc.ref, id: doc.id, data: inv });
    invByVendor.set(inv.vendorId, arr);
  }

  const allVendors = new Set([...ledgerByVendor.keys(), ...invByVendor.keys()]);
  const backupRows = [];
  const actions = [];

  for (const vid of allVendors) {
    const ledgerEntries = ledgerByVendor.get(vid) ?? [];
    const inv = invByVendor.get(vid) ?? { locked: [], pending: [] };

    // Set of ledger entry IDs already covered by a locked invoice.
    const lockedEntryIds = new Set();
    for (const li of inv.locked) {
      const entries = Array.isArray(li.data.entries) ? li.data.entries : [];
      for (const e of entries) {
        if (e && typeof e.id === 'string') lockedEntryIds.add(e.id);
      }
    }

    // Remaining entries to bill = ledger entries not in any locked invoice.
    // Net the refund debits — a credit cancelled by a refund nets to 0
    // and shouldn't be in the new pending invoice.
    const remainingByRef = new Map();
    for (const le of ledgerEntries) {
      if (lockedEntryIds.has(le.id)) continue;
      const k = le.referenceId || le.id;
      const acc =
        remainingByRef.get(k) ??
        { base: 0, gst: 0, total: 0, ids: [], referenceId: le.referenceId, date: le.date };
      const signed = le.type === 'debit' ? -1 : 1;
      acc.base += signed * le.base;
      acc.gst += signed * le.gst;
      acc.total += signed * le.amount;
      acc.ids.push(le.id);
      acc.date = le.date;
      acc.referenceId = le.referenceId || acc.referenceId;
      remainingByRef.set(k, acc);
    }

    // Drop zero-or-negative-net refs (refund cancelled the credit).
    const remaining = [];
    for (const r of remainingByRef.values()) {
      if (r.total > 0) remaining.push(r);
    }
    const remainingTotal = remaining.reduce((s, r) => s + r.total, 0);
    const remainingBase = remaining.reduce((s, r) => s + r.base, 0);
    const remainingGst = remaining.reduce((s, r) => s + r.gst, 0);
    const remainingTxns = remaining.length;

    actions.push({
      vid,
      name: (vendorMeta.get(vid) || {}).name || vid,
      lockedCount: inv.locked.length,
      pendingCount: inv.pending.length,
      pendingSum: r2(inv.pending.reduce((s, p) => s + num(p.data.totalAmount), 0)),
      remainingTotal: r2(remainingTotal),
      remainingBase: r2(remainingBase),
      remainingGst: r2(remainingGst),
      remainingTxns,
      remaining,
      pending: inv.pending,
      vendorType: (vendorMeta.get(vid) || {}).type || 'ThirdParty',
      branchId: (vendorMeta.get(vid) || {}).branchId || '',
    });

    for (const p of inv.pending) {
      backupRows.push({ id: p.id, data: p.data });
    }
  }

  // Print summary
  actions.sort((a, b) => b.remainingTotal - a.remainingTotal);
  let totDeleted = 0;
  let totRemaining = 0;
  let totRemainingTxns = 0;
  for (const a of actions) {
    totDeleted += a.pendingCount;
    totRemaining += a.remainingTotal;
    totRemainingTxns += a.remainingTxns;
  }

  console.log(`Vendors with activity in period         : ${actions.length}`);
  console.log(`Pending invoices to delete (duplicates) : ${totDeleted}`);
  console.log(`Vendors needing a new pending invoice   : ${actions.filter((a) => a.remainingTotal > 0).length}`);
  console.log(`Total real remaining payout to write    : ₹${totRemaining.toLocaleString('en-IN')}`);
  console.log(`Total entries across new invoices       : ${totRemainingTxns}\n`);

  console.log(
    '  vendorId      name                            pending#  pendingSum  remaining  txns',
  );
  for (const a of actions) {
    console.log(
      `  ${a.vid.padEnd(12)}  ${a.name.slice(0, 30).padEnd(30)}  ${String(a.pendingCount).padStart(7)}  ₹${String(a.pendingSum).padStart(8)}  ₹${String(a.remainingTotal).padStart(8)}  ${String(a.remainingTxns).padStart(4)}`,
    );
  }

  if (!APPLY) {
    console.log('\n⏸  dry run — pass --apply to write.');
    process.exit(0);
  }

  // Backup pending invoices
  const backupDir = path.resolve('backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(
    backupDir,
    `dedupe-period-invoices-${fromYMD}-to-${toYMD}-${stamp}.json`,
  );
  fs.writeFileSync(backupPath, JSON.stringify(backupRows, null, 2));
  console.log(`\n✓ Backup of ${backupRows.length} pending invoices: ${backupPath}\n`);

  // Apply: delete pendings then create new consolidated pendings
  let deleted = 0;
  let created = 0;
  for (const a of actions) {
    // Delete every existing pending for this vendor + period
    for (const p of a.pending) {
      await p.ref.delete();
      deleted++;
    }
    if (a.remainingTotal <= 0) continue;

    // Build new consolidated pending invoice. Use the vendor's
    // branchId as the locationId to anchor on the canonical (numeric)
    // form so future regenerations don't create branch-name duplicates.
    const newId = `vi-${fromYMD}-${a.vid}-${a.branchId || 'all'}-topup`;
    const ledgerEntries = ledgerByVendor.get(a.vid) ?? [];
    const lockedEntryIds = new Set();
    for (const li of (invByVendor.get(a.vid) ?? { locked: [] }).locked) {
      const entries = Array.isArray(li.data.entries) ? li.data.entries : [];
      for (const e of entries) if (e && typeof e.id === 'string') lockedEntryIds.add(e.id);
    }
    const entriesForInvoice = ledgerEntries
      .filter((le) => !lockedEntryIds.has(le.id))
      .map((le) => ({
        id: le.id,
        vendorId: le.data.vendorId,
        vendorBase: num(le.data.vendorBase),
        vendorGst: num(le.data.vendorGst),
        amount: num(le.data.amount),
        type: le.data.type || 'credit',
        referenceId: le.data.referenceId || le.data.bookingId,
        invoiceNumber: le.data.invoiceNumber,
        locationId: le.data.locationId,
        date: le.data.date,
        createdAt: le.data.createdAt,
        source: le.data.source,
      }));

    const newInvoice = {
      id: newId,
      vendorId: a.vid,
      vendorName: a.name,
      vendorType: a.vendorType,
      locationId: a.branchId,
      periodStart: fromYMD,
      periodEnd: toYMD,
      totalBase: a.remainingBase,
      totalGst: a.remainingGst,
      totalAmount: a.remainingTotal,
      transactionCount: a.remainingTxns,
      entries: entriesForInvoice,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await db.collection('vendorInvoices').doc(newId).set(newInvoice);
    created++;
  }

  console.log(`✓ Deleted ${deleted} duplicate pending invoices.`);
  console.log(`✓ Created ${created} consolidated top-up invoices totaling ₹${totRemaining.toLocaleString('en-IN')}.`);
  process.exit(0);
})().catch((err) => {
  console.error('Dedupe failed:', err);
  process.exit(1);
});
