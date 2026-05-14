/**
 * One-shot backfill: walks the `users` collection and writes the
 * forward referral index at
 *
 *   users/{referrerUid}/referredCustomers/{referredUid}
 *
 * for every user whose document carries a `referredBy` field.
 *
 * Ongoing maintenance is handled by the `onUserCreateReferralIndex`
 * Cloud Function trigger — this script exists so pre-trigger referrals
 * are captured once.
 *
 * Usage:
 *   npx tsx scripts/backfill-referral-forward-index.ts
 *
 * Options:
 *   --dry-run            Print what would change, write nothing.
 *   --concurrency=N      Parallel writes per page (default 20).
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const DATABASE = 'asquare-app-db'
const PAGE_SIZE = 500

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const CONCURRENCY = Math.max(
  1,
  Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? '20'),
)

const findServiceAccountKey = (): string | null => {
  const candidates = [
    path.resolve('serviceAccountKey.json'),
    path.resolve('service-account-key.json'),
    path.resolve('firebase-admin-key.json'),
    path.resolve('scripts/serviceAccountKey.json'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const initAdmin = () => {
  if (getApps().length > 0) return
  const keyPath = findServiceAccountKey()
  if (keyPath) {
    console.log(`Using service account key: ${keyPath}`)
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'))
    initializeApp({ credential: cert(serviceAccount) })
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Using GOOGLE_APPLICATION_CREDENTIALS env var')
    initializeApp()
  } else {
    console.error('No service account key found.')
    process.exit(1)
  }
}

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function writeEdge(db: Firestore, doc: QueryDocumentSnapshot) {
  const data = doc.data()
  const referrer = String(data.referredBy || '').trim()
  if (!referrer || referrer === doc.id) return { skipped: true }

  const payload = {
    referredUid: doc.id,
    displayName: String(data.displayName || ''),
    phone: String(data.phone || ''),
    joinedAt: data.createdAt || new Date(),
    totalSpent: Number(data?.stats?.totalSpent) || 0,
  }

  if (DRY_RUN) {
    console.log(`[dry-run] users/${referrer}/referredCustomers/${doc.id} ←`, payload)
    return { wouldWrite: true }
  }

  await db
    .collection('users')
    .doc(referrer)
    .collection('referredCustomers')
    .doc(doc.id)
    .set(payload)
  return { written: true }
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE)

  let cursor: QueryDocumentSnapshot | undefined
  let total = 0
  let written = 0
  let skipped = 0

  while (true) {
    let q = db.collection('users').orderBy('__name__').limit(PAGE_SIZE)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break

    for (const batch of chunk(snap.docs, CONCURRENCY)) {
      const results = await Promise.all(batch.map((d) => writeEdge(db, d)))
      for (const r of results) {
        if (r.written || r.wouldWrite) written += 1
        else if (r.skipped) skipped += 1
      }
    }

    total += snap.size
    console.log(`processed ${total} (written=${written} skipped=${skipped})`)
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < PAGE_SIZE) break
  }

  console.log(
    `\nDone. total=${total} written=${written} skipped(no-referrer)=${skipped}${
      DRY_RUN ? ' [dry-run]' : ''
    }`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
