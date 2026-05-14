/**
 * Backfill: re-stamp `visitDate` from `sessionDate` (IST day) on bookings
 * where the two diverged because createUnifiedBooking previously fell back
 * to `transactionDate` (today) instead of the session day.
 *
 * Caused future-dated admin/customer bookings to land in the wrong day
 * bucket on the dashboard (e.g. ASG26051119121011573EH — sessionDate
 * Sat 17 May, visitDate Sun 11 May — never appeared under 17 May).
 *
 * Scans the last 90 days of bookings, computes IST session day from
 * `sessionDate`, and rewrites `visitDate` only when they disagree.
 * Idempotent — re-runs are no-ops on already-fixed bookings.
 *
 * --dry-run prints proposed changes without writing.
 */
const admin = require('firebase-admin')
admin.initializeApp({ credential: admin.credential.cert(require('../serviceAccountKey.json')) })
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const DRY_RUN = process.argv.includes('--dry-run')

const sessionToIstYmd = (sessionDate) => {
  if (!sessionDate) return null
  let dt
  if (sessionDate._seconds) dt = new Date(sessionDate._seconds * 1000)
  else if (typeof sessionDate === 'string') dt = new Date(sessionDate)
  else if (sessionDate instanceof Date) dt = sessionDate
  else return null
  if (isNaN(dt.getTime())) return null
  // en-CA gives YYYY-MM-DD which matches the visitDate field format.
  return dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

// Optional --since-days=N flag (default: all history). Pass --since-days=90
// to limit scan to last 90 days for quick re-runs.
const sinceDaysArg = process.argv.find((a) => a.startsWith('--since-days='))
const sinceDays = sinceDaysArg ? Number(sinceDaysArg.split('=')[1]) : null

;(async () => {
  let baseQuery = db.collection('bookings').limit(15000)
  if (sinceDays != null && Number.isFinite(sinceDays)) {
    const since = new Date(Date.now() - sinceDays * 86400 * 1000)
    baseQuery = db.collection('bookings').where('createdAt', '>=', since).limit(15000)
  }
  const snap = await baseQuery.get()

  const updates = []
  for (const d of snap.docs) {
    const b = d.data()
    const sessionYmd = sessionToIstYmd(b.sessionDate)
    if (!sessionYmd) continue
    const currentVisit = b.visitDate || null
    if (currentVisit === sessionYmd) continue
    updates.push({
      id: d.id,
      source: b.source || '',
      from: currentVisit,
      to: sessionYmd,
      finalAmount: b.finalAmount,
    })
  }

  console.log(`${DRY_RUN ? 'DRY ' : ''}Found ${updates.length} bookings with visitDate != IST sessionDate`)
  for (const u of updates) {
    console.log(`  ${u.id} [${u.source || '?'}] visitDate ${u.from || '(none)'} → ${u.to}`)
  }

  if (!DRY_RUN) {
    let userMirrorWrites = 0
    for (const u of updates) {
      const writePayload = {
        visitDate: u.to,
        visitDateBackfilledAt: new Date(),
        visitDateBackfilledFrom: u.from,
        visitDateBackfilledReason: 'session-day-mismatch',
      }
      await db.collection('bookings').doc(u.id).set(writePayload, { merge: true })

      // Mirror to users/{userId}/bookings/{id} — the customer-app's MyBookings
      // reads from this subcollection. Without mirroring, parent had the
      // corrected visitDate but the customer still saw the old wrong date.
      try {
        const parent = await db.collection('bookings').doc(u.id).get()
        const userId = parent.exists ? String(parent.data().userId || '') : ''
        if (userId && !userId.startsWith('offline_')) {
          const subRef = db.collection('users').doc(userId).collection('bookings').doc(u.id)
          const subSnap = await subRef.get()
          if (subSnap.exists) {
            await subRef.set(writePayload, { merge: true })
            userMirrorWrites++
          }
        }
      } catch (err) {
        console.error(`  subcollection mirror failed for ${u.id}: ${err.message}`)
      }
    }
    console.log(`Wrote ${updates.length} updates (+ ${userMirrorWrites} user-subcollection mirrors).`)
  }
  process.exit(0)
})().catch(err => { console.error(err); process.exit(1) })
