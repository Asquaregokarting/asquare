import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const findKey = (): string | null => {
  for (const c of [
    'serviceAccountKey.json',
    'service-account-key.json',
    'firebase-admin-key.json',
    'scripts/serviceAccountKey.json',
  ]) {
    const p = path.resolve(c)
    if (fs.existsSync(p)) return p
  }
  return null
}
const k = findKey()
if (!k) {
  console.error('No key.')
  process.exit(1)
}
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(k, 'utf-8'))) })
const db = getFirestore('asquare-app-db')

;(async () => {
  console.log('=== legacy activityCatalog collection ===')
  const snap = await db.collection('activityCatalog').get()
  console.log(`Total docs: ${snap.size}`)
  if (snap.size === 0) {
    console.log('(empty)')
    return
  }
  // Look for cricket-related activities
  const cricketDocs: Array<{ id: string; data: Record<string, unknown> }> = []
  const sampleByVendorId: Record<string, number> = {}
  let withVendor = 0,
    withoutVendor = 0
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    if (typeof data.vendorId === 'string' && data.vendorId) withVendor++
    else withoutVendor++
    const vid = String(data.vendorId ?? 'NO_VENDOR')
    sampleByVendorId[vid] = (sampleByVendorId[vid] || 0) + 1
    const name = String(data.name ?? data.bookingName ?? '').toLowerCase()
    const gameId = String(data.gameId ?? '').toLowerCase()
    if (name.includes('cricket') || gameId === 'cricket') {
      cricketDocs.push({ id: d.id, data })
    }
  }
  console.log(`Docs with vendorId: ${withVendor}`)
  console.log(`Docs without vendorId: ${withoutVendor}`)
  console.log(`\nTop vendor stamps (count of docs):`)
  for (const [vid, n] of Object.entries(sampleByVendorId)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)) {
    console.log(`  ${vid}: ${n}`)
  }
  console.log(`\nCricket-related docs (${cricketDocs.length}):`)
  for (const d of cricketDocs.slice(0, 10)) {
    console.log(
      `  ${d.id}: vendorId=${d.data.vendorId ?? '(none)'} gameId=${d.data.gameId ?? '?'} name=${d.data.name ?? d.data.bookingName ?? '?'} branchId=${d.data.branchId ?? d.data.locationId ?? '?'}`,
    )
  }

  // Specifically check the activity ID used by the user's booking
  console.log('\n=== specific lookup: activity__0__cricket__cricket__single_pass_5_overs ===')
  const targetId = 'activity__0__cricket__cricket__single_pass_5_overs'
  const target = await db.collection('activityCatalog').doc(targetId).get()
  if (target.exists) {
    console.log(JSON.stringify(target.data(), null, 2))
  } else {
    console.log('(not in activityCatalog)')
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
