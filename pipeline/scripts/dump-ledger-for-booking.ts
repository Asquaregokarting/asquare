import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const ids = process.argv.slice(2)
if (ids.length === 0) {
  console.error('Usage: npx tsx scripts/dump-ledger-for-booking.ts <bookingId> [<bookingId>...]')
  process.exit(1)
}

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
  console.error('No service account key.')
  process.exit(1)
}
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(k, 'utf-8'))) })
const db = getFirestore('asquare-app-db')

;(async () => {
  for (const id of ids) {
    console.log(`\n[${id}] vendorLedger entries (any referenceId match):`)
    const byRefId = await db.collection('vendorLedger').where('referenceId', '==', id).get()
    const byBookingId = await db.collection('vendorLedger').where('bookingId', '==', id).get()
    const byInvoice = await db.collection('vendorLedger').where('invoiceNumber', '==', id).get()
    // Also try linkedBookingIds (used for discrepancy_correction entries)
    const byLinked = await db
      .collection('vendorLedger')
      .where('linkedBookingIds', 'array-contains', id)
      .get()

    const all = new Map<string, FirebaseFirestore.DocumentSnapshot>()
    for (const d of byRefId.docs) all.set(d.id, d)
    for (const d of byBookingId.docs) all.set(d.id, d)
    for (const d of byInvoice.docs) all.set(d.id, d)
    for (const d of byLinked.docs) all.set(d.id, d)

    if (all.size === 0) {
      console.log(`  (none)`)
      continue
    }
    for (const [docId, snap] of all) {
      const d = snap.data() ?? {}
      console.log(`  ${docId}:`)
      console.log(
        `    vendorId=${d.vendorId} type=${d.type} amount=${d.amount} entryType=${d.entryType ?? 'sale'} source=${d.source ?? '?'}`,
      )
      console.log(
        `    referenceId=${d.referenceId} invoiceNumber=${d.invoiceNumber} date=${d.date}`,
      )
      if (d.reason) console.log(`    reason=${d.reason}`)
    }
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
