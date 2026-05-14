import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const keyPath = path.resolve('serviceAccountKey.json')
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore

;(async () => {
  for (const id of ['ironman', 'kAlCvaGMbSh4S70fIU40rkEg4903']) {
    const snap = await db.collection('users').doc(id).get()
    if (!snap.exists) {
      console.log(`${id}: NOT FOUND`)
      continue
    }
    const d = snap.data() as Record<string, unknown>
    console.log(`\n══ ${id} ══`)
    const fields = [
      'phone',
      'displayName',
      'name',
      'email',
      'isVerified',
      'role',
      'isAdmin',
      'isStaff',
      'tier',
      'tires',
      'walletBalance',
      'authProvider',
      'firebaseAuthUid',
      'createdAt',
      'lastLoginAt',
      'createdBy',
      'createdByAdminId',
    ]
    for (const k of fields) {
      const v = d[k]
      if (v === undefined) continue
      const out =
        v && typeof v === 'object' && 'toDate' in (v as object)
          ? (v as { toDate(): Date }).toDate().toISOString()
          : JSON.stringify(v)
      console.log(`  ${k}: ${out}`)
    }
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
