/**
 * Reproduce what the cashier checkout flow sees for Rajahmundry on
 * 2026-05-07. The day-report aggregator (`aggregateDayReport`) calls
 * `listFilteredBillingTransactions({ from: date, to: date })` which now
 * runs through the deletedAt filter. Confirm the canonical kept booking
 * (ASG260507155215493FW8B, ₹1800) IS still visible while the four
 * trashed siblings are excluded.
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
  // Mirror listFirestoreBillingTransactions: full collection, filter
  // deletedAt, then mirror listFilteredBillingTransactions filtering
  // for date + cancelled + completed.
  const snap = await db.collection('bookings').get()
  console.log(`Total docs in bookings/: ${snap.size}`)

  let kept = 0
  let droppedDeleted = 0
  let droppedCancelled = 0
  let droppedNotCompleted = 0
  let outOfDate = 0
  const matched: Array<Record<string, unknown>> = []

  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    if (data.deletedAt) {
      droppedDeleted++
      continue
    }
    if (data.cancelled === true || data.bookingStatus === 'cancelled') {
      droppedCancelled++
      continue
    }
    const ps = String(data.paymentStatus ?? '')
    if (ps === 'pending' || ps === 'failed') {
      droppedNotCompleted++
      continue
    }
    // Pull date and locationId.
    const txnRaw = data.transactionDate
    let txnIso = ''
    if (txnRaw && typeof txnRaw === 'object' && 'toDate' in (txnRaw as object)) {
      txnIso = (txnRaw as { toDate(): Date }).toDate().toISOString()
    } else if (typeof txnRaw === 'string') {
      txnIso = txnRaw
    }
    const day = txnIso.slice(0, 10)
    if (day !== '2026-05-07') {
      outOfDate++
      continue
    }
    const loc = String(data.locationId ?? '')
    if (loc !== 'rajahmundry' && loc !== '2') continue
    kept++
    matched.push({ id: d.id, finalAmount: data.finalAmount, locationId: data.locationId, txnIso })
  }

  console.log(`\nFiltered to rajahmundry on 2026-05-07:`)
  console.log(`  kept: ${kept}`)
  console.log(`  dropped (deletedAt): ${droppedDeleted}`)
  console.log(`  dropped (cancelled): ${droppedCancelled}`)
  console.log(`  dropped (not completed): ${droppedNotCompleted}`)
  console.log(`  dropped (other date): ${outOfDate}`)
  console.log()
  for (const m of matched) {
    console.log(`  ${m.id}  ₹${m.finalAmount}  ${m.txnIso}`)
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
