/**
 * Confirm the 5 duplicate bookings for 9502617044 actually carry the
 * `deletedAt` marker. If not, the user moved them via a path that
 * didn't stamp the field — and the dashboard / billing / vendor reads
 * have no way to filter them out.
 */
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
    if (!snap.exists) {
      console.log(`${id}  NOT FOUND`)
      continue
    }
    const d = snap.data()!
    const deletedAt = d.deletedAt
    const deletedBy =
      d.deletedBy && typeof d.deletedBy === 'object'
        ? (d.deletedBy as Record<string, unknown>).name
        : null
    const ledgerSnap = await db.collection('vendorLedger').where('referenceId', '==', id).get()
    const voidedCount = ledgerSnap.docs.filter((l) => l.data().voidedAt).length
    console.log(
      `${id}  deletedAt=${deletedAt ? (typeof deletedAt === 'object' && 'toDate' in deletedAt ? (deletedAt as { toDate(): Date }).toDate().toISOString() : String(deletedAt)).slice(0, 24) : '(NONE)'}  deletedBy=${deletedBy ?? '-'}  ledgerEntries=${ledgerSnap.size}  voidedEntries=${voidedCount}`,
    )
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
