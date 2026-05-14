/**
 * Detect clusters of same-day shift docs for the same cashier+branch.
 *
 * Each cluster is the residue of repeated Check-In / Check-Out attempts
 * that failed before completing settlement (the 2026-05-11 online-booking
 * inflation bug being the main culprit). The DailyReportsHub now display-
 * merges them, but the underlying docs stay in Firestore — this script
 * surfaces any NEW clusters so we know when to investigate the trigger.
 *
 * Usage:
 *   node scripts/find-duplicate-shifts.cjs            # last 7 days
 *   node scripts/find-duplicate-shifts.cjs --date 2026-05-11
 *   node scripts/find-duplicate-shifts.cjs --days 14  # last 14 days
 *   node scripts/find-duplicate-shifts.cjs --json     # JSON output
 *
 * Exit code is 0 when no clusters found, 1 when one or more clusters
 * exist — that way a /loop runner can act on the exit code if desired.
 */
const admin = require('firebase-admin')
admin.initializeApp({ credential: admin.credential.cert(require('../serviceAccountKey.json')) })
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const args = process.argv.slice(2)
const flag = (name) => {
  const idx = args.indexOf(`--${name}`)
  if (idx === -1) return null
  return args[idx + 1] ?? true
}
const wantJson = args.includes('--json')
const dateArg = typeof flag('date') === 'string' ? flag('date') : null
const daysArg = Number(flag('days')) || 7

const toIsoDate = (d) => {
  const istOffset = 5.5 * 60 * 60 * 1000
  const ist = new Date(d.getTime() + istOffset)
  return ist.toISOString().slice(0, 10)
}

const targetDates = (() => {
  if (dateArg) return [dateArg]
  const out = []
  for (let i = 0; i < daysArg; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    out.push(toIsoDate(d))
  }
  return out
})()

const main = async () => {
  const snap = await db.collection('shifts').get()

  // Group shifts by userId::locationId::shiftDate within the target window.
  const groups = new Map()
  for (const doc of snap.docs) {
    const data = doc.data()
    const shiftDate = String(
      data.shiftDate ?? (data.startTime ? String(data.startTime).slice(0, 10) : ''),
    )
    if (!targetDates.includes(shiftDate)) continue

    const userId = String(data.userId ?? '')
    const locationId = String(data.locationId ?? '')
    if (!userId || !locationId || !shiftDate) continue

    const key = `${userId}::${locationId}::${shiftDate}`
    const entry = groups.get(key) ?? {
      key,
      userId,
      locationId,
      shiftDate,
      shifts: [],
    }
    entry.shifts.push({
      id: doc.id,
      startTime: data.startTime ?? '',
      endTime: data.endTime ?? '',
      role: data.role ?? '',
      hasSettlement: Boolean(data.settlement),
      totalTransactions: data.settlement?.totalTransactions ?? 0,
    })
    groups.set(key, entry)
  }

  const clusters = [...groups.values()]
    .filter((g) => g.shifts.length > 1)
    .map((g) => ({
      ...g,
      shifts: g.shifts.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime))),
    }))
    .sort(
      (a, b) =>
        b.shifts.length - a.shifts.length ||
        a.shiftDate.localeCompare(b.shiftDate) ||
        a.locationId.localeCompare(b.locationId),
    )

  if (wantJson) {
    console.log(JSON.stringify({ window: targetDates, clusterCount: clusters.length, clusters }, null, 2))
  } else {
    console.log(`Window: ${targetDates[targetDates.length - 1]} → ${targetDates[0]}`)
    console.log(`Shifts scanned: ${snap.size} · clusters (>=2 shifts per cashier+branch+date): ${clusters.length}`)
    if (clusters.length === 0) {
      console.log('No duplicate clusters in window.')
    } else {
      console.log('')
      for (const c of clusters) {
        console.log(`  ${c.shiftDate}  ${c.locationId}  ${c.userId}  × ${c.shifts.length}`)
        for (const s of c.shifts) {
          const settled = s.hasSettlement ? `${s.totalTransactions} txn` : 'no settlement'
          console.log(`    ${s.id}  ${s.startTime} → ${s.endTime || '(open)'}  ${settled}`)
        }
      }
    }
  }

  process.exit(clusters.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('find-duplicate-shifts failed:', err)
  process.exit(2)
})
