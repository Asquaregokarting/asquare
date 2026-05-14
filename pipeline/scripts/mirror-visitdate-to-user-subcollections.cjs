/**
 * One-shot mirror: copy the corrected `visitDate` from `bookings/{id}` down
 * to `users/{userId}/bookings/{id}` for every booking that was processed
 * by backfill-visitdate-from-sessiondate.cjs.
 *
 * The first run of that backfill wrote only to the parent collection,
 * leaving 301 customer-app MyBookings reads showing stale dates.
 */
const admin = require('firebase-admin')
admin.initializeApp({ credential: admin.credential.cert(require('../serviceAccountKey.json')) })
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const DRY_RUN = process.argv.includes('--dry-run')

;(async () => {
  const snap = await db
    .collection('bookings')
    .where('visitDateBackfilledAt', '!=', null)
    .limit(2000)
    .get()

  let mirrored = 0
  let skippedOffline = 0
  let skippedNoSub = 0
  let alreadyOk = 0

  for (const d of snap.docs) {
    const b = d.data()
    if (!b.userId || b.userId.startsWith('offline_')) {
      skippedOffline++
      continue
    }
    const subRef = db.collection('users').doc(b.userId).collection('bookings').doc(d.id)
    const subSnap = await subRef.get()
    if (!subSnap.exists) {
      skippedNoSub++
      continue
    }
    const subData = subSnap.data() || {}
    if (subData.visitDate === b.visitDate) {
      alreadyOk++
      continue
    }
    if (!DRY_RUN) {
      await subRef.set(
        {
          visitDate: b.visitDate,
          visitDateBackfilledAt: b.visitDateBackfilledAt,
          visitDateBackfilledFrom: b.visitDateBackfilledFrom,
          visitDateBackfilledReason: b.visitDateBackfilledReason,
        },
        { merge: true },
      )
    }
    mirrored++
  }

  console.log(`${DRY_RUN ? 'DRY ' : ''}Mirror summary:`)
  console.log(`  ${snap.size} backfilled bookings scanned`)
  console.log(`  ${mirrored} subcollection mirrors ${DRY_RUN ? 'would be' : 'were'} updated`)
  console.log(`  ${alreadyOk} already in sync`)
  console.log(`  ${skippedOffline} skipped (offline_* userId)`)
  console.log(`  ${skippedNoSub} skipped (no subcollection doc)`)
  process.exit(0)
})().catch(err => { console.error(err); process.exit(1) })
