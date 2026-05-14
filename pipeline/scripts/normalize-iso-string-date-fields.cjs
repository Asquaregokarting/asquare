/**
 * Unified date-field type normalizer.
 *
 * Some legacy writers stored ISO-string values in fields that other code
 * paths populate as Firestore Timestamps. Mixed types in the same field
 * break `orderBy(field)` (Firestore puts strings AFTER timestamps in
 * asc → BEFORE timestamps in desc) and break `where(field, '>=', date)`
 * range filters. The `createdAt` strings already bit the dashboard
 * Recent Bookings widget; this script preempts the same class of bug
 * on every other mixed-type field surfaced by the audit.
 *
 * Targets (one Firestore round-trip per fix):
 *   bookings/{id}              updatedAt
 *   users/{uid}                createdAt, updatedAt, lastLoginAt
 *
 * Idempotent: only converts when `typeof value === 'string'`.
 * --dry-run prints intended changes without writing.
 */
const admin = require('firebase-admin')
admin.initializeApp({ credential: admin.credential.cert(require('../serviceAccountKey.json')) })
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const DRY_RUN = process.argv.includes('--dry-run')

const COLLECTIONS = {
  bookings: ['updatedAt'],
  users: ['createdAt', 'updatedAt', 'lastLoginAt'],
}

const normalizeCollection = async (collection, fields) => {
  console.log(`\n=== ${collection} ===`)
  let cursor = null
  let scanned = 0
  let fixes = []
  while (true) {
    let q = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(500)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break
    for (const d of snap.docs) {
      scanned++
      const data = d.data()
      const updates = {}
      for (const f of fields) {
        const v = data[f]
        if (typeof v === 'string') {
          const dt = new Date(v)
          if (!isNaN(dt.getTime())) {
            updates[f] = admin.firestore.Timestamp.fromDate(dt)
          }
        }
      }
      if (Object.keys(updates).length > 0) {
        fixes.push({ id: d.id, updates })
      }
    }
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < 500) break
  }
  console.log(`  scanned: ${scanned}`)
  console.log(`  docs with string date fields to fix: ${fixes.length}`)
  fixes.slice(0, 5).forEach((f) => {
    const fieldsList = Object.keys(f.updates).join(', ')
    console.log(`    ${f.id}: ${fieldsList}`)
  })
  if (fixes.length > 5) console.log(`    ...and ${fixes.length - 5} more`)
  if (!DRY_RUN) {
    let written = 0
    for (const f of fixes) {
      await db.collection(collection).doc(f.id).update({
        ...f.updates,
        dateTypeBackfilledAt: admin.firestore.Timestamp.now(),
        dateTypeBackfilledFields: Object.keys(f.updates),
      })
      written++
    }
    console.log(`  wrote: ${written}`)
  }
  return fixes.length
}

;(async () => {
  let totalFixes = 0
  for (const [col, fields] of Object.entries(COLLECTIONS)) {
    totalFixes += await normalizeCollection(col, fields)
  }
  console.log(`\n${DRY_RUN ? 'DRY ' : ''}Total fixes across all collections: ${totalFixes}`)
  process.exit(0)
})().catch((err) => { console.error(err); process.exit(1) })
