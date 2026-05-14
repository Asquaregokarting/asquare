/**
 * Repair: vendorLedger rows whose `invoiceNumber` is the result of the
 * pre-Fix-2 trigger fallback (bookingId-as-invoiceNumber) — but NOT the
 * canonical case where `unified-booking.ts` deliberately uses the ASG
 * order-number as both the booking id AND the invoice number.
 *
 * The pre-Fix-2 trigger fell back to bookingId when the booking carried
 * NEITHER `invoiceNumber` NOR `billingId`. We can only distinguish the
 * bug rows from the canonical rows by reading the source booking:
 *   - canonical: booking.invoiceNumber EXISTS and equals the ledger's
 *                invoiceNumber → leave alone (correct by design)
 *   - drift:     booking.invoiceNumber exists but DIFFERS from the
 *                ledger value → repair the ledger
 *   - fallback bug: booking has NO invoiceNumber/billingId at all but
 *                   the ledger row has invoiceNumber === referenceId →
 *                   stamp `pendingInvoiceNumberFix` for manual review
 *   - orphan:    booking does not exist → stamp pending
 *
 * Usage:
 *   node scripts/repair-ledger-bookingid-as-invoicenumber.cjs            # dry-run
 *   node scripts/repair-ledger-bookingid-as-invoicenumber.cjs --apply
 *
 * Idempotent — every iteration re-queries.
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
    ledgerRowsScanned: 0,
    rowsAffected: 0, // invoiceNumber === referenceId rows (candidates)
    rowsCanonical: 0, // booking.invoiceNumber matches — no-op (correct by design)
    rowsRepaired: 0, // booking has a different real invoiceNumber — ledger updated
    rowsMarkedPending: 0, // truly broken — fallback bug or orphan
    errors: [],
    repairedSamples: [],
    pendingSamples: [],
  }

  // Stream vendorLedger — there's no "where invoiceNumber == referenceId"
  // composite filter in Firestore, so we read pages and check client-side.
  const pageSize = 500
  let lastDoc = null
  while (true) {
    let q = db.collection('vendorLedger').orderBy('__name__').limit(pageSize)
    if (lastDoc) q = q.startAfter(lastDoc)
    const snap = await q.get()
    if (snap.empty) break

    for (const ledgerSnap of snap.docs) {
      summary.ledgerRowsScanned++
      const data = ledgerSnap.data()
      const inv = String(data.invoiceNumber ?? '')
      const ref = String(data.referenceId ?? '')
      // Only affected: invoiceNumber equals the referenceId AND the value
      // looks like a bookingId (i.e. NOT a real invoice number format).
      // The trigger's pre-fix fallback was unconditional, so any equality
      // is suspect. Skip equal-but-empty entries (no referenceId/invoice).
      if (!inv || !ref || inv !== ref) continue

      summary.rowsAffected++
      try {
        const bookingSnap = await db.collection('bookings').doc(ref).get()
        if (!bookingSnap.exists) {
          // Orphan ledger row — booking was hard-deleted. Mark for manual
          // review; don't touch the row data (preserves audit trail).
          if (APPLY) {
            await ledgerSnap.ref.set(
              { pendingInvoiceNumberFix: true, repairReason: 'booking_not_found' },
              { merge: true },
            )
          }
          summary.rowsMarkedPending++
          if (summary.pendingSamples.length < 5) {
            summary.pendingSamples.push({
              ledgerId: ledgerSnap.id,
              referenceId: ref,
              reason: 'booking_not_found',
            })
          }
          continue
        }
        const booking = bookingSnap.data()
        const bookingInvoice =
          (typeof booking.invoiceNumber === 'string' && booking.invoiceNumber.trim()) || ''
        const bookingBillingId =
          (typeof booking.billingId === 'string' && booking.billingId.trim()) || ''
        const realInvoice = bookingInvoice || bookingBillingId || ''

        if (!realInvoice) {
          // Booking has NO invoice number at all. Ledger row's
          // invoiceNumber === referenceId is the pre-Fix-2 fallback
          // signature. Stamp for manual review.
          if (APPLY) {
            await ledgerSnap.ref.set({ pendingInvoiceNumberFix: true }, { merge: true })
            await bookingSnap.ref.set({ ledgerInvoiceMissing: true }, { merge: true })
          }
          summary.rowsMarkedPending++
          if (summary.pendingSamples.length < 5) {
            summary.pendingSamples.push({
              ledgerId: ledgerSnap.id,
              referenceId: ref,
              reason: 'booking_has_no_invoice_number_pre_fix2_fallback',
            })
          }
          continue
        }

        if (realInvoice === inv) {
          // Canonical case: booking.invoiceNumber === ledger.invoiceNumber.
          // This is by design in unified-booking.ts (`const invoiceNumber
          // = id`). No-op.
          summary.rowsCanonical++
          continue
        }

        // Drift: booking has an invoice number that differs from the
        // ledger value. Update the ledger row.
        if (APPLY) {
          await ledgerSnap.ref.set({ invoiceNumber: realInvoice }, { merge: true })
        }
        summary.rowsRepaired++
        if (summary.repairedSamples.length < 10) {
          summary.repairedSamples.push({
            ledgerId: ledgerSnap.id,
            referenceId: ref,
            oldInvoiceNumber: inv,
            newInvoiceNumber: realInvoice,
          })
        }
        if (VERBOSE) {
          console.log(`repair: ${ledgerSnap.id} ${inv} -> ${realInvoice}`)
        }
      } catch (err) {
        summary.errors.push({
          ledgerId: ledgerSnap.id,
          referenceId: ref,
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
  console.error('repair-ledger-bookingid-as-invoicenumber failed:', err)
  process.exit(2)
})
