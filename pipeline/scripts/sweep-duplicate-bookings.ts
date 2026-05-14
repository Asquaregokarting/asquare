/**
 * Sweep all bookings created in the last 30 days for duplicate clusters
 * — bookings that share the same `clientRequestId` (caller intent was a
 * single sale) but ended up as N distinct booking docs because the
 * writer's old read-only idempotency check raced.
 *
 * Reports:
 *   - cluster size (e.g., 5 bookings, 1 clientRequestId)
 *   - the cashier / branch / customer involved
 *   - the totals that need correction (₹extra)
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const keyPath = path.resolve('serviceAccountKey.json')
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore

;(async () => {
  const sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000
  const since = new Date(sinceMs).toISOString()

  // Pull every booking with a clientRequestId in the last 30 days.
  // The transactionDate field is the cleanest temporal anchor (set at
  // cart-build time, immune to write-time drift).
  const snap = await db.collection('bookings').where('transactionDate', '>=', since).get()
  console.log(`Scanning ${snap.size} bookings since ${since.slice(0, 10)}...\n`)

  const byCri = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>()
  let withCri = 0
  for (const doc of snap.docs) {
    const cri = doc.get('clientRequestId')
    if (typeof cri !== 'string' || !cri) continue
    withCri++
    const arr = byCri.get(cri) ?? []
    arr.push(doc)
    byCri.set(cri, arr)
  }
  console.log(`Bookings with clientRequestId: ${withCri}\n`)

  const dupClusters: Array<{
    clientRequestId: string
    docs: FirebaseFirestore.QueryDocumentSnapshot[]
  }> = []
  for (const [cri, docs] of byCri) {
    if (docs.length > 1) dupClusters.push({ clientRequestId: cri, docs })
  }

  if (dupClusters.length === 0) {
    console.log('No duplicate clusters found.')
    return
  }

  console.log(`Found ${dupClusters.length} duplicate cluster(s):\n`)
  let totalExtraBookings = 0
  let totalExtraAmount = 0
  for (const { clientRequestId, docs } of dupClusters.sort(
    (a, b) => b.docs.length - a.docs.length,
  )) {
    const first = docs[0].data() as Record<string, unknown>
    const extras = docs.length - 1
    const amount = Number(first.finalAmount ?? first.totalAmount ?? 0)
    totalExtraBookings += extras
    totalExtraAmount += extras * amount
    console.log(`  ${clientRequestId}  ×${docs.length}  (${extras} extra)`)
    console.log(
      `    customer=${String(first.customerPhone ?? '').slice(-10) || '?'}  branch=${first.locationId ?? '?'}  cashier=${first.createdBy ?? '?'}`,
    )
    console.log(
      `    txnDate=${String(first.transactionDate ?? '').slice(0, 19)}  amount=₹${amount}`,
    )
    console.log(`    booking ids:`)
    for (const d of docs) {
      const data = d.data() as Record<string, unknown>
      console.log(
        `      ${d.id}  createdAt=${String(data.createdAt ?? '?').slice(0, 24)}  paymentStatus=${data.paymentStatus ?? '?'}`,
      )
    }
    console.log()
  }
  console.log(`TOTAL extra bookings: ${totalExtraBookings}`)
  console.log(`TOTAL over-credited revenue: ₹${totalExtraAmount}`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
