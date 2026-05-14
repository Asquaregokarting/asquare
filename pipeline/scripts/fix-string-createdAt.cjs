/**
 * Fix mixed-type createdAt corruption on bookings.
 *
 * Some legacy writers stored `createdAt` as an ISO string ("2026-03-22T...")
 * while modern writers store it as a Firestore Timestamp. Firestore's
 * mixed-type sort orders strings AFTER timestamps for ascending —
 * meaning strings come FIRST in `orderBy('createdAt','desc')`. This
 * caused the dashboard "Recent bookings" widget to show 50-day-old
 * March entries above today's POS bookings.
 *
 * Converts every string `createdAt` to a Firestore Timestamp via
 * `admin.firestore.Timestamp.fromDate(new Date(stringValue))`.
 *
 * Mirrors the change down to `users/{uid}/bookings/{id}` so the
 * customer-app MyBookings view also sorts correctly.
 *
 * --dry-run prints intended changes without writing.
 */
const admin = require('firebase-admin')
admin.initializeApp({ credential: admin.credential.cert(require('../serviceAccountKey.json')) })
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const DRY_RUN = process.argv.includes('--dry-run')

;(async () => {
  // Scan in pages to avoid loading the whole collection.
  let cursor = null
  const fixes = []
  let scanned = 0
  while (true) {
    let q = db.collection('bookings').orderBy(admin.firestore.FieldPath.documentId()).limit(500)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break
    for (const d of snap.docs) {
      scanned++
      const ca = d.data().createdAt
      if (typeof ca === 'string') {
        const dt = new Date(ca)
        if (!isNaN(dt.getTime())) {
          fixes.push({ id: d.id, from: ca, to: dt.toISOString(), userId: d.data().userId })
        }
      }
    }
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < 500) break
  }

  console.log(`${DRY_RUN ? 'DRY ' : ''}Scanned ${scanned} bookings`)
  console.log(`  string createdAt fields to convert: ${fixes.length}`)
  fixes.slice(0, 20).forEach((f) =>
    console.log(`  ${f.id}: "${f.from}" → Timestamp(${f.to})`),
  )
  if (fixes.length > 20) console.log(`  ...and ${fixes.length - 20} more`)

  if (!DRY_RUN) {
    let mirrored = 0
    for (const f of fixes) {
      const ts = admin.firestore.Timestamp.fromDate(new Date(f.from))
      await db.collection('bookings').doc(f.id).update({
        createdAt: ts,
        createdAtTypeBackfilledAt: admin.firestore.Timestamp.now(),
        createdAtTypeBackfilledFrom: 'string',
      })
      if (f.userId && !String(f.userId).startsWith('offline_')) {
        try {
          const subRef = db
            .collection('users')
            .doc(String(f.userId))
            .collection('bookings')
            .doc(f.id)
          const subSnap = await subRef.get()
          if (subSnap.exists && typeof subSnap.data().createdAt === 'string') {
            await subRef.update({ createdAt: ts })
            mirrored++
          }
        } catch (err) {
          console.error(`  subcollection mirror failed for ${f.id}: ${err.message}`)
        }
      }
    }
    console.log(`Wrote ${fixes.length} updates (+ ${mirrored} subcollection mirrors).`)
  }
  process.exit(0)
})().catch(err => { console.error(err); process.exit(1) })
