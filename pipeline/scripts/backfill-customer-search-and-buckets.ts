/**
 * One-shot backfill for the Customer 360 list-page enhancements.
 *
 * Populates the following fields on every customer document in
 * `asquare-app-db/users/{uid}`:
 *   displayNameLower, emailLower          (prefix-search indexes)
 *   spendBucket, bookingBucket            (filter buckets)
 *   hasWalletBalance, hasTires, hasUnredeemedCoupons150
 *   lastBookingAt                         (max sessionDate across subcollection)
 *   branchPreferred                       (most-booked-at locationId)
 *
 * Staff accounts (role ∈ PIPELINE_ROLES) are skipped.
 *
 * Ongoing maintenance for most fields is handled by the Cloud Function
 * triggers `onUserWriteCustomerBuckets` and `onBookingWriteSyncCustomerStats`.
 * `branchPreferred` is backfill-only — refresh periodically by re-running
 * this script.
 *
 * Usage:
 *   npx tsx scripts/backfill-customer-search-and-buckets.ts
 *
 * Options:
 *   --dry-run            Print what would change, write nothing.
 *   --uid=<id>           Process only this user.
 *   --concurrency=N      Parallel writes per page (default 10).
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

import {
  computeCustomerBuckets,
  type BucketSourceFields,
} from '../src/pipeline/api/customer-buckets'

const DATABASE = 'asquare-app-db'
const PAGE_SIZE = 500

const PIPELINE_ROLES = new Set([
  'Owner',
  'Admin',
  'Telecaller',
  'Cashier',
  'TrackMarshall',
  'Editor',
  'Developer',
  'Backend',
  'ThirdParty',
  'Incharge',
])

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const SINGLE_UID = args.find((a) => a.startsWith('--uid='))?.split('=')[1] ?? null
const CONCURRENCY = Math.max(
  1,
  Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? '10'),
)

// ---------------------------------------------------------------------------
// Firebase Admin setup
// ---------------------------------------------------------------------------

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
    console.error(
      '\nNo service account key found. Place one of these in the project root:\n' +
        '  - serviceAccountKey.json\n' +
        '  - service-account-key.json\n' +
        '  - firebase-admin-key.json\n' +
        '\nOr set the GOOGLE_APPLICATION_CREDENTIALS environment variable.\n',
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Per-user computation
// ---------------------------------------------------------------------------

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return Number.isFinite(d.getTime()) ? d : null
  }
  return null
}

interface ComputedUserFields {
  displayNameLower: string
  emailLower: string
  spendBucket: string
  bookingBucket: string
  hasWalletBalance: boolean
  hasTires: boolean
  hasUnredeemedCoupons150: boolean
  lastBookingAt: Date | null
  branchPreferred: string | null
}

const computeForUser = async (
  db: Firestore,
  doc: QueryDocumentSnapshot,
): Promise<ComputedUserFields | null> => {
  const data = doc.data()
  const role = String(data.role ?? '')
  if (role && PIPELINE_ROLES.has(role)) return null

  const source: BucketSourceFields = {
    totalSpent: Number(data?.stats?.totalSpent ?? 0),
    bookingCount: Number(data?.stats?.bookingCount ?? 0),
    walletBalance: Number(data?.walletBalance ?? 0),
    tires: Number(data?.tires ?? 0),
    coupons150Available: Number(data?.coupons150Available ?? 0),
  }
  const buckets = computeCustomerBuckets(source)

  let lastBookingAt: Date | null = null
  const locCounts = new Map<string, number>()
  const bookings = await doc.ref
    .collection('bookings')
    .select('sessionDate', 'locationId', 'bookingStatus')
    .get()
  for (const b of bookings.docs) {
    if (String(b.get('bookingStatus') ?? '').toLowerCase() === 'cancelled') continue
    const sd = toDate(b.get('sessionDate'))
    if (sd && (!lastBookingAt || sd > lastBookingAt)) lastBookingAt = sd
    const loc = b.get('locationId')
    if (loc) locCounts.set(String(loc), (locCounts.get(String(loc)) ?? 0) + 1)
  }
  let branchPreferred: string | null = null
  let topCount = 0
  for (const [loc, n] of locCounts) {
    if (n > topCount) {
      branchPreferred = loc
      topCount = n
    }
  }

  return {
    displayNameLower: String(data.displayName ?? '').toLowerCase(),
    emailLower: String(data.email ?? '').toLowerCase(),
    ...buckets,
    lastBookingAt,
    branchPreferred,
  }
}

const hasDrift = (current: Record<string, unknown>, next: ComputedUserFields): boolean => {
  const keys: (keyof ComputedUserFields)[] = [
    'displayNameLower',
    'emailLower',
    'spendBucket',
    'bookingBucket',
    'hasWalletBalance',
    'hasTires',
    'hasUnredeemedCoupons150',
    'branchPreferred',
  ]
  for (const k of keys) {
    if (current[k as string] !== next[k]) return true
  }
  const currentLast = toDate(current.lastBookingAt)?.getTime() ?? null
  const nextLast = next.lastBookingAt?.getTime() ?? null
  return currentLast !== nextLast
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function processDoc(db: Firestore, doc: QueryDocumentSnapshot) {
  const computed = await computeForUser(db, doc)
  if (!computed) return { skipped: true }

  const data = doc.data()
  if (!hasDrift(data, computed)) return { noop: true }

  if (DRY_RUN) {
    console.log(
      `[dry-run] ${doc.id} would update:`,
      Object.fromEntries(
        Object.entries(computed).filter(([k, v]) => (data as Record<string, unknown>)[k] !== v),
      ),
    )
    return { wouldUpdate: true }
  }

  await doc.ref.set(
    {
      ...computed,
      ...(computed.lastBookingAt ? { lastBookingAt: computed.lastBookingAt } : {}),
    },
    { merge: true },
  )
  return { updated: true }
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE)

  if (SINGLE_UID) {
    const snap = await db.collection('users').doc(SINGLE_UID).get()
    if (!snap.exists) {
      console.error(`User ${SINGLE_UID} not found`)
      process.exit(2)
    }
    const result = await processDoc(db, snap as QueryDocumentSnapshot)
    console.log(`done:`, result)
    return
  }

  let cursor: QueryDocumentSnapshot | undefined
  let total = 0
  let updated = 0
  let skipped = 0
  let noop = 0

  while (true) {
    let q = db.collection('users').orderBy('__name__').limit(PAGE_SIZE)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break

    for (const batch of chunk(snap.docs, CONCURRENCY)) {
      const results = await Promise.all(batch.map((d) => processDoc(db, d)))
      for (const r of results) {
        if (r.updated || r.wouldUpdate) updated += 1
        else if (r.skipped) skipped += 1
        else if (r.noop) noop += 1
      }
    }

    total += snap.size
    console.log(`processed ${total} (updated=${updated} skipped=${skipped} noop=${noop})`)
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < PAGE_SIZE) break
  }

  console.log(
    `\nDone. total=${total} updated=${updated} skipped(staff)=${skipped} noop=${noop}${
      DRY_RUN ? ' [dry-run]' : ''
    }`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
