/**
 * Find and delete vendorInvoices whose status is not 'locked' AND whose
 * entries[] reference ledger rows that no longer exist (or reference
 * bookings whose vendorIds[] doesn't include the invoice's vendor). The
 * cross-branch ghost cleanup deleted the underlying ledger rows but
 * left some draft invoices behind that still carry a frozen snapshot
 * of those rows — surfacing the wrong bookings on the Excel export.
 *
 * Locked invoices are never touched. A JSON backup of every deleted
 * invoice is saved before the deletes.
 *
 * Default --dry-run; pass --apply to write.
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DATABASE_ID = 'asquare-app-db';
const APPLY = process.argv.includes('--apply');

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(fs.readFileSync(path.resolve('serviceAccountKey.json'), 'utf-8')),
  ),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID, ignoreUndefinedProperties: true });

(async () => {
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const [invoicesSnap, ledgerSnap, bookingsSnap] = await Promise.all([
    db.collection('vendorInvoices').get(),
    db.collection('vendorLedger').get(),
    db.collection('bookings').get(),
  ]);

  // Build sets for quick existence lookup.
  const existingLedgerIds = new Set(ledgerSnap.docs.map((d) => d.id));
  const bookingVendorIds = new Map();
  for (const d of bookingsSnap.docs) {
    const data = d.data();
    bookingVendorIds.set(d.id, new Set(Array.isArray(data.vendorIds) ? data.vendorIds : []));
  }

  const toDelete = [];
  for (const doc of invoicesSnap.docs) {
    const inv = doc.data();
    const status = String(inv.status || 'pending').toLowerCase();
    if (status === 'locked') continue;

    const vendorId = inv.vendorId;
    const entries = Array.isArray(inv.entries) ? inv.entries : [];
    if (entries.length === 0) continue; // empty draft is harmless

    let stale = 0;
    let total = entries.length;
    for (const e of entries) {
      const ledgerId = typeof e.id === 'string' ? e.id : '';
      const ref = e.referenceId || e.bookingId || '';
      const ledgerGone = ledgerId && !existingLedgerIds.has(ledgerId);
      const bookingVendors = ref ? bookingVendorIds.get(ref) : null;
      const bookingDoesntClaim = bookingVendors ? !bookingVendors.has(vendorId) : false;
      if (ledgerGone || bookingDoesntClaim) stale++;
    }

    // Treat the invoice as fully stale only if EVERY entry is stale.
    // Partial stale (mixed) is rare; better to leave for manual review.
    if (stale === total) {
      toDelete.push({ id: doc.id, ref: doc.ref, data: inv, staleCount: stale, total });
    }
  }

  console.log(`Loaded ${invoicesSnap.size} invoices · ${ledgerSnap.size} ledger rows · ${bookingsSnap.size} bookings`);
  console.log(`Fully-stale non-locked invoices: ${toDelete.length}`);

  if (toDelete.length === 0) {
    console.log('Nothing to delete.');
    process.exit(0);
  }

  console.log('\nWill delete:');
  for (const r of toDelete) {
    console.log(
      `  ${r.id.padEnd(48)}  vendor=${r.data.vendorId}  status=${r.data.status}  loc=${r.data.locationId}  period=${r.data.periodStart}..${r.data.periodEnd}  total=₹${r.data.totalAmount}  entries=${r.total}`,
    );
  }

  if (!APPLY) {
    console.log('\n⏸  dry run — pass --apply to delete.');
    process.exit(0);
  }

  // Backup first
  const backupDir = path.resolve('backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `stale-draft-invoices-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(toDelete.map((r) => ({ id: r.id, data: r.data })), null, 2),
  );
  console.log(`\n✓ Backup saved: ${backupPath}`);

  // Batched deletes
  const BATCH = 400;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const chunk = toDelete.slice(i, i + BATCH);
    const batch = db.batch();
    for (const r of chunk) batch.delete(r.ref);
    await batch.commit();
    deleted += chunk.length;
  }
  console.log(`✓ Deleted ${deleted} stale invoices.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
