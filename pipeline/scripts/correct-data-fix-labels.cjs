/**
 * Correct the data-fix labels applied earlier to ASG260411235153111CP7L
 * and ASG260502190314957WKJS.
 *
 * The earlier pass set paymentStatus='cancelled' and refundStatus=
 * 'cancelled-data-fix'. Those labels imply the money was returned to
 * the customer — which we cannot verify. Money came in at POS; whether
 * it was kept (comp/freebie) or physically refunded (cash back at
 * counter) is unknown without staff investigation.
 *
 * Correct shape:
 *   - cancelled = true          (the accounting lever, stays as-is)
 *   - paymentStatus = the ORIGINAL value (from dataFix.priorState.paymentStatus)
 *   - refundStatus  = 'unknown-investigate'
 *   - dataFix.note  = explicit ambiguity acknowledgment
 *
 * Reads each booking's dataFix.priorState to recover the original
 * paymentStatus, so the original truth is restored verbatim.
 *
 * Default mode is --dry-run. Pass --apply to write.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const APPLY = process.argv.includes('--apply');
const DATABASE_ID = 'asquare-app-db';
const TARGETS = ['ASG260411235153111CP7L', 'ASG260502190314957WKJS'];

const keyPath = path.resolve('serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found in project root.');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID, ignoreUndefinedProperties: true });

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Correct data-fix labels — mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  for (const id of TARGETS) {
    const ref = db.collection('bookings').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`✗ ${id} — not found, skipping`);
      continue;
    }
    const d = snap.data();
    const prior = d.dataFix && d.dataFix.priorState ? d.dataFix.priorState : null;
    if (!prior) {
      console.log(`✗ ${id} — no dataFix.priorState, skipping (was it already corrected?)`);
      continue;
    }
    const originalPaymentStatus = prior.paymentStatus || 'completed';

    console.log(`\n── ${id} ──`);
    console.log(`  current : paymentStatus=${d.paymentStatus}  refundStatus=${d.refundStatus}`);
    console.log(`  original: paymentStatus=${prior.paymentStatus}  refundStatus=${prior.refundStatus}`);
    console.log(`  →       : paymentStatus=${originalPaymentStatus}  refundStatus=unknown-investigate`);
    console.log(`  cancelled stays: true  (accounting exclusion lever)`);

    const update = {
      paymentStatus: originalPaymentStatus,
      refundStatus: 'unknown-investigate',
      // Replace the prior dataFix.reason with one that's honest about the
      // remaining ambiguity. Keep priorState (audit trail) untouched so
      // we never lose the original snapshot.
      'dataFix.note':
        'Line items restored from negative-flip to honest positive values, and cancelled=true so accounting excludes this booking. ' +
        'paymentStatus reverted to the original value because money DID come in at the POS terminal. ' +
        'Real-world money state after the original ring-up is UNKNOWN: customer may have played as a comp/freebie (business kept the money) ' +
        'or received a physical refund at the counter (cash back) that was never recorded. ' +
        'INVESTIGATE with cashier/staff who closed the booking before assuming refund status.',
      'dataFix.labelCorrectionAt': new Date().toISOString(),
    };

    if (APPLY) {
      await ref.update(update);
      console.log(`  ✓ APPLIED`);
    } else {
      console.log(`  ⏸  dry-run — pass --apply to write`);
    }
  }

  console.log('\nDone.\n');
  process.exit(0);
})().catch((err) => {
  console.error('Correction failed:', err);
  process.exit(1);
});
