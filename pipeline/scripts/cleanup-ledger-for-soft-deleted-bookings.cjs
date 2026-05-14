/**
 * Backfill: delete vendorLedger rows for bookings that are soft-deleted
 * (`deletedAt` set) or voided (`voidedAt` set) but where the rows survived
 * because the pre-Fix-1 vendor-ledger-sync trigger only tore down on
 * `cancelled === true`.
 *
 * After Fix 1 (functions/lib/vendor-ledger-sync.js — isTerminated) ships,
 * the trigger will keep new soft-deletes clean. This one-off pass cleans
 * the historical pile.
 *
 * Usage:
 *   node scripts/cleanup-ledger-for-soft-deleted-bookings.cjs            # dry-run by default
 *   node scripts/cleanup-ledger-for-soft-deleted-bookings.cjs --apply    # actually delete
 *
 * Output: JSON summary per booking with rows-deleted counts. Exit 0 on
 * success, 1 if any ledger queries failed.
 *
 * Safe to re-run — every iteration re-queries Firestore, so a partial
 * apply (e.g. transient network failure) just leaves the unprocessed
 * bookings for the next run.
 */
const admin = require('firebase-admin')
admin.initializeApp({ credential: admin.credential.cert(require('../serviceAccountKey.json')) })
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const APPLY = process.argv.includes('--apply')
const VERBOSE = process.argv.includes('--verbose')

const main = async () => {
  const summary = {
    apply: APPLY,
    bookingsScanned: 0,
    bookingsWithGhostLedger: 0,
    rowsToDelete: 0,
    rowsDeleted: 0,
    errors: [],
    samples: [],
  }

  // Stream the bookings collection — too large for a single .get().
  // Filter by deletedAt OR voidedAt presence client-side because
  // Firestore doesn't support "field exists" queries without an index.
  // The collection is bounded by data volume; iterate in batches.
  const pageSize = 500
  let lastDoc = null
  while (true) {
    let q = db.collection('bookings').orderBy('__name__').limit(pageSize)
    if (lastDoc) q = q.startAfter(lastDoc)
    const snap = await q.get()
    if (snap.empty) break

    for (const docSnap of snap.docs) {
      summary.bookingsScanned++
      const data = docSnap.data()
      const isSoftDeleted = Boolean(data.deletedAt) || Boolean(data.voidedAt)
      if (!isSoftDeleted) continue

      // Find every vendorLedger row that references this booking.
      try {
        const rows = await db
          .collection('vendorLedger')
          .where('referenceId', '==', docSnap.id)
          .get()

        if (rows.empty) continue

        summary.bookingsWithGhostLedger++
        summary.rowsToDelete += rows.size

        if (summary.samples.length < 10) {
          summary.samples.push({
            bookingId: docSnap.id,
            deletedAt: data.deletedAt ?? null,
            voidedAt: data.voidedAt ?? null,
            rows: rows.docs.map((r) => ({
              id: r.id,
              vendorId: r.data().vendorId,
              amount: r.data().amount,
              type: r.data().type,
            })),
          })
        }

        if (VERBOSE) {
          console.log(
            `${docSnap.id}: ${rows.size} ghost ledger rows (deletedAt=${data.deletedAt || ''} voidedAt=${data.voidedAt || ''})`,
          )
        }

        if (APPLY) {
          // Use a batched delete — Firestore caps at 500 ops per batch.
          // Each booking's ledger rows are well under that in practice.
          const batch = db.batch()
          rows.docs.forEach((r) => batch.delete(r.ref))
          await batch.commit()
          summary.rowsDeleted += rows.size
        }
      } catch (err) {
        summary.errors.push({
          bookingId: docSnap.id,
          error: String(err.message || err),
        })
      }
    }

    lastDoc = snap.docs[snap.docs.length - 1]
    if (snap.size < pageSize) break
  }

  console.log(JSON.stringify(summary, null, 2))
  process.exit(summary.errors.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('cleanup-ledger-for-soft-deleted-bookings failed:', err)
  process.exit(2)
})
