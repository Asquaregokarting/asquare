/**
 * Normalize shifts.locationId from numeric branch IDs / aliases to
 * the canonical slug form. Same shape as the bookings normalization
 * done on 2026-05-11, but for the `shifts` collection. Without this,
 * Daily Reports' branch rollups silently drop shifts (the tile map is
 * keyed by slug, shifts arrive with "0" / "1" / "2", so `Map.get`
 * returns undefined and the shifts vanish from the report).
 *
 * Mapping:
 *   "0" / "visakhapatnam" / "vizag" → "visakhapatnam"
 *   "1" / "kakinada"                → "kakinada"
 *   "2" / "rajahmundry"             → "rajahmundry"
 *   "5" / "srikakulam"              → "srikakulam"
 *
 * Idempotent — re-running is a no-op once normalized.
 * --dry-run prints intended changes without writing.
 */
const admin = require('firebase-admin')
admin.initializeApp({ credential: admin.credential.cert(require('../serviceAccountKey.json')) })
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const DRY_RUN = process.argv.includes('--dry-run')

const LOCATION_CANONICAL = {
  '0': 'visakhapatnam',
  visakhapatnam: 'visakhapatnam',
  vizag: 'visakhapatnam',
  '1': 'kakinada',
  kakinada: 'kakinada',
  '2': 'rajahmundry',
  rajahmundry: 'rajahmundry',
  '5': 'srikakulam',
  srikakulam: 'srikakulam',
}

const normalizeLocation = (raw) => {
  if (typeof raw !== 'string' || !raw) return raw
  const lc = raw.toLowerCase().trim()
  return LOCATION_CANONICAL[raw] || LOCATION_CANONICAL[lc] || raw
}

;(async () => {
  let cursor = null
  let scanned = 0
  const fixes = []
  while (true) {
    let q = db.collection('shifts').orderBy(admin.firestore.FieldPath.documentId()).limit(500)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break
    for (const d of snap.docs) {
      scanned++
      const loc = d.data().locationId
      const next = normalizeLocation(loc)
      if (next !== loc && typeof loc === 'string') {
        fixes.push({ id: d.id, from: loc, to: next })
      }
    }
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < 500) break
  }

  console.log(`${DRY_RUN ? 'DRY ' : ''}Scanned ${scanned} shifts`)
  console.log(`  shifts needing locationId normalization: ${fixes.length}`)
  const byMap = {}
  for (const f of fixes) {
    const k = `${JSON.stringify(f.from)} → ${JSON.stringify(f.to)}`
    byMap[k] = (byMap[k] || 0) + 1
  }
  Object.entries(byMap)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, c]) => console.log('    ' + k + ' × ' + c))

  if (!DRY_RUN) {
    let written = 0
    for (const f of fixes) {
      await db.collection('shifts').doc(f.id).update({
        locationId: f.to,
        locationIdCanonicalizedAt: admin.firestore.Timestamp.now(),
        locationIdCanonicalizedFrom: f.from,
      })
      written++
    }
    console.log(`Wrote: ${written}`)
  }
  process.exit(0)
})().catch((err) => { console.error(err); process.exit(1) })
