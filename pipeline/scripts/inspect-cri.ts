import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const ids = [
  'ASG260507155215493FW8B',
  'ASG260507155215494GUOP',
  'ASG260507155215495WC70',
  'ASG2605071552154962CI0',
  'ASG2605071552154974MTW',
]

const keyPath = path.resolve('serviceAccountKey.json')
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore

;(async () => {
  for (const id of ids) {
    const snap = await db.collection('bookings').doc(id).get()
    if (!snap.exists) continue
    const d = snap.data()!
    console.log(
      `${id}  clientRequestId=${String(d.clientRequestId ?? '(none)')}  createdAt=${String(d.createdAt ?? '?').slice(0, 24)}`,
    )
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
