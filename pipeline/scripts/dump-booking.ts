import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const ids = process.argv.slice(2)
if (ids.length === 0) {
  console.error('Usage: npx tsx scripts/dump-booking.ts <bookingId> [<bookingId>...]')
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
    const snap = await db.collection('bookings').doc(id).get()
    if (!snap.exists) {
      console.log(`\n[${id}] NOT FOUND`)
      continue
    }
    const data = snap.data()
    console.log(
      `\n[${id}] keys: ${Object.keys(data ?? {})
        .sort()
        .join(', ')}`,
    )
    console.log(JSON.stringify(data, null, 2))
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
