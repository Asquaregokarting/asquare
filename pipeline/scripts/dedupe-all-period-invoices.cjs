/**
 * Same as scripts/dedupe-period-invoices.cjs, but iterates over EVERY
 * distinct (periodStart, periodEnd) tuple found in vendorInvoices.
 *
 * For each period, dedupe pending invoices against locked ones: keep
 * only entries that aren't already covered by a locked invoice, then
 * write one consolidated pending per vendor that still has unpaid
 * amounts. Locked invoices are never modified.
 *
 * Default --dry-run. Pass --apply to write.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const APPLY = process.argv.includes('--apply');

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

(async () => {
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('Loading vendorLedger, vendorInvoices, vendorDetails…');

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

  // Group invoices by period.
  const periodMap = new Map(); // "from::to" → { from, to, invoices: { vendorId: { locked, pending } } }
  for (const doc of invoicesSnap.docs) {
    const inv = doc.data();
    const ps = String(inv.periodStart || '').slice(0, 10);
    const pe = String(inv.periodEnd || '').slice(0, 10);
    if (!ps || !pe) continue;
    if (!inv.vendorId) continue;
    const k = `${ps}::${pe}`;
    let p = periodMap.get(k);
    if (!p) {
      p = { from: ps, to: pe, invoices: new Map() };
      periodMap.set(k, p);
    }
    const arr = p.invoices.get(inv.vendorId) ?? { locked: [], pending: [] };
    const status = String(inv.status || 'pending').toLowerCase();
    if (status === 'locked') arr.locked.push({ ref: doc.ref, id: doc.id, data: inv });
    else arr.pending.push({ ref: doc.ref, id: doc.id, data: inv });
    p.invoices.set(inv.vendorId, arr);
  }

  console.log(`Loaded ${ledgerSnap.size} ledger rows · ${invoicesSnap.size} invoices · ${periodMap.size} distinct periods\n`);

  // Group ledger by (vendor, period) — done lazily per period.
  const ledgerEntriesByVendorPeriod = (vid, from, to) => {
    const out = [];
    for (const doc of ledgerSnap.docs) {
      const e = doc.data();
      if (e.vendorId !== vid) continue;
      const dt = dateOf(e.date || e.transactionDate || e.createdAt);
      if (dt < from || dt > to) continue;
      out.push({
        id: doc.id,
        data: e,
        type: e.type || 'credit',
        amount: num(e.amount),
        base: num(e.vendorBase),
        gst: num(e.vendorGst),
        referenceId: e.referenceId || e.bookingId || '',
        date: dt,
      });
    }
    return out;
  };

  const periodKeys = [...periodMap.keys()].sort();
  let totalDeletedAcrossPeriods = 0;
  let totalCreatedAcrossPeriods = 0;
  let totalRemainingAcrossPeriods = 0;
  const allBackup = [];

  for (const k of periodKeys) {
    const period = periodMap.get(k);
    const { from, to, invoices } = period;
    const periodActions = [];
    for (const [vid, inv] of invoices) {
      const ledgerEntries = ledgerEntriesByVendorPeriod(vid, from, to);
      const lockedEntryIds = new Set();
      for (const li of inv.locked) {
        const entries = Array.isArray(li.data.entries) ? li.data.entries : [];
        for (const e of entries) if (e && typeof e.id === 'string') lockedEntryIds.add(e.id);
      }

      const remainingByRef = new Map();
      for (const le of ledgerEntries) {
        if (lockedEntryIds.has(le.id)) continue;
        const k2 = le.referenceId || le.id;
        const acc =
          remainingByRef.get(k2) ?? { base: 0, gst: 0, total: 0, ids: [] };
        const signed = le.type === 'debit' ? -1 : 1;
        acc.base += signed * le.base;
        acc.gst += signed * le.gst;
        acc.total += signed * le.amount;
        acc.ids.push(le.id);
        remainingByRef.set(k2, acc);
      }
      const remaining = [...remainingByRef.values()].filter((r) => r.total > 0);
      const remainingTotal = remaining.reduce((s, r) => s + r.total, 0);
      const remainingBase = remaining.reduce((s, r) => s + r.base, 0);
      const remainingGst = remaining.reduce((s, r) => s + r.gst, 0);

      periodActions.push({
        vid,
        meta: vendorMeta.get(vid) || { name: vid, type: 'ThirdParty', branchId: '' },
        pending: inv.pending,
        remaining,
        remainingTotal: r2(remainingTotal),
        remainingBase: r2(remainingBase),
        remainingGst: r2(remainingGst),
        remainingTxns: remaining.length,
        ledgerEntries,
        lockedEntryIds,
      });

      for (const p of inv.pending) allBackup.push({ period: k, id: p.id, data: p.data });
    }

    const sumPendingBefore = periodActions.reduce(
      (s, a) => s + a.pending.reduce((sa, p) => sa + num(p.data.totalAmount), 0),
      0,
    );
    const sumPendingDeleteCount = periodActions.reduce((s, a) => s + a.pending.length, 0);
    const sumRemaining = periodActions.reduce((s, a) => s + a.remainingTotal, 0);
    const newInvoicesCount = periodActions.filter((a) => a.remainingTotal > 0).length;

    if (sumPendingDeleteCount === 0 && newInvoicesCount === 0) continue; // nothing to do

    console.log(
      `── ${from} → ${to} · pending count=${sumPendingDeleteCount} sum=₹${r2(sumPendingBefore).toLocaleString('en-IN')} → real remaining=₹${r2(sumRemaining).toLocaleString('en-IN')} (${newInvoicesCount} new invoices)`,
    );

    if (APPLY) {
      for (const a of periodActions) {
        for (const p of a.pending) {
          await p.ref.delete();
          totalDeletedAcrossPeriods++;
        }
        if (a.remainingTotal <= 0) continue;
        const newId = `vi-${from}-${a.vid}-${a.meta.branchId || 'all'}-topup`;
        const entriesForInvoice = a.ledgerEntries
          .filter((le) => !a.lockedEntryIds.has(le.id))
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
          vendorName: a.meta.name,
          vendorType: a.meta.type,
          locationId: a.meta.branchId,
          periodStart: from,
          periodEnd: to,
          totalBase: a.remainingBase,
          totalGst: a.remainingGst,
          totalAmount: a.remainingTotal,
          transactionCount: a.remainingTxns,
          entries: entriesForInvoice,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        await db.collection('vendorInvoices').doc(newId).set(newInvoice);
        totalCreatedAcrossPeriods++;
      }
    }
    totalRemainingAcrossPeriods += sumRemaining;
  }

  if (APPLY && allBackup.length > 0) {
    const backupDir = path.resolve('backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `dedupe-all-periods-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(allBackup, null, 2));
    console.log(`\n✓ Backup of ${allBackup.length} pending invoices: ${backupPath}`);
  }

  console.log(`\nTotal real remaining payouts across all periods: ₹${r2(totalRemainingAcrossPeriods).toLocaleString('en-IN')}`);
  if (APPLY) {
    console.log(`Deleted ${totalDeletedAcrossPeriods} duplicate pending invoices.`);
    console.log(`Created ${totalCreatedAcrossPeriods} consolidated top-up invoices.`);
  } else {
    console.log('\n⏸  dry run — pass --apply to write.');
  }
  process.exit(0);
})().catch((err) => {
  console.error('Dedupe failed:', err);
  process.exit(1);
});
