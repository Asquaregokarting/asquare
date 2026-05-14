/**
 * Read-only dump of the Staff Monitor collections.
 *
 * Prints:
 *   1. Every `staffPresence/*` doc with its branchId, role, loginAt,
 *      lastSeenAt, and derived age (how long since last heartbeat).
 *   2. Last 10 `staffSessionLog/*` rows (most recent by loginAt).
 *
 * Use this to diagnose an empty Monitor page:
 *   - 0 presence docs → nobody monitored has signed in since deploy, OR the
 *     heartbeat is silently failing on write.
 *   - Presence docs exist but branchId is a slug ('visakhapatnam', 'vizag')
 *     → the pre-fix data model is still on disk. Delete or wait for the
 *     scheduled cleanup to rotate them out.
 *   - Presence docs with branchIds ('0', '1', '2', 'srikakulam') but Monitor
 *     still empty → the viewer's `enabledLocations` doesn't include that
 *     branch, so it's filtered out. Check the viewer's `allowedLocations`
 *     on their user doc.
 *
 * Usage:
 *   node scripts/inspect-staff-presence.cjs
 */
const admin = require('firebase-admin')
const path = require('path')
const fs = require('fs')

const DATABASE_ID = 'asquare-app-db'

const keyPath = path.resolve('serviceAccountKey.json')
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found in project root.')
  process.exit(1)
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
})
const db = admin.firestore()
db.settings({ databaseId: DATABASE_ID })

function ageMinutes(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY
  return Math.round((Date.now() - t) / 60000)
}

;(async () => {
  console.log('\n══════════════════════════════════════════════════════════════')
  console.log('  INSPECT: staffPresence + staffSessionLog')
  console.log('══════════════════════════════════════════════════════════════\n')

  // ── Presence ──────────────────────────────────────────────────────────
  const presSnap = await db.collection('staffPresence').get()
  console.log(`staffPresence/* — ${presSnap.size} doc(s)\n`)
  if (presSnap.empty) {
    console.log('  (none)\n')
  } else {
    presSnap.forEach((d) => {
      const p = d.data()
      const age = ageMinutes(p.lastSeenAt)
      const freshness = age < 2 ? 'ONLINE' : age < 5 ? 'IDLE' : 'STALE (will be swept)'
      console.log(`  userId        : ${d.id}`)
      console.log(`    userName    : ${p.userName}`)
      console.log(`    role        : ${p.role}`)
      console.log(`    branchId    : "${p.branchId}"`)
      console.log(`    sessionId   : ${p.sessionId}`)
      console.log(`    loginAt     : ${p.loginAt}`)
      console.log(`    lastSeenAt  : ${p.lastSeenAt}  (${age}m ago — ${freshness})`)
      console.log()
    })
  }

  // Flag suspicious branch IDs
  const suspicious = presSnap.docs
    .map((d) => d.data().branchId)
    .filter((b) => b && !['0', '1', '2', '3', 'srikakulam'].includes(b))
  if (suspicious.length > 0) {
    console.log(
      `  ⚠  Non-canonical branchId values found: ${JSON.stringify([...new Set(suspicious)])}`,
    )
    console.log('     These are the pre-fix slug values. The UI will NOT show them.\n')
  }

  // ── History ───────────────────────────────────────────────────────────
  const histSnap = await db
    .collection('staffSessionLog')
    .orderBy('loginAt', 'desc')
    .limit(10)
    .get()
  console.log(`staffSessionLog/* — latest ${histSnap.size} (of unknown total):`)
  if (histSnap.empty) {
    console.log('  (none)\n')
  } else {
    histSnap.forEach((d) => {
      const h = d.data()
      const durH = Math.floor((h.durationMinutes ?? 0) / 60)
      const durM = (h.durationMinutes ?? 0) % 60
      console.log(
        `  ${h.loginAt.slice(0, 16)} → ${h.logoutAt.slice(11, 16)}  ${String(h.role).padEnd(14)} ${String(
          `"${h.branchId}"`,
        ).padEnd(18)} ${h.userName.padEnd(24)} ${durH}h ${durM}m  [${h.endReason}]`,
      )
    })
    console.log()
  }

  console.log('Done.\n')
  process.exit(0)
})().catch((err) => {
  console.error('\n[FATAL]', err)
  process.exit(1)
})
