/**
 * Backfill `users/{id}.walletBalance` (root field) from the authoritative
 * subcollection doc `users/{id}/wallet/data.balance`.
 *
 * Why this exists:
 * Historically the customer app has always read/written balance through
 * `users/{id}/wallet/data.balance` (via `walletService.addBalance/deductBalance`
 * and the atomic `creditCustomerWallet` in billing-firestore.ts). The pipeline
 * admin UI has always read `users/{id}.walletBalance` (a root field) for its
 * customer/member list and detail views. Nothing in the customer app has ever
 * written the root field — it was only ever seeded by the legacy PHP migration,
 * occasional manual admin edits, and the unified-booking init path. So the
 * admin display has silently diverged from the real balance for every customer
 * whose wallet changed after migration — daily task rewards, game rewards,
 * refund credits, checkout debits, everything.
 *
 * The dedup sweep in scripts/dedup-users.ts explicitly cleared the root field
 * on the 40 merged canonical docs via `FieldValue.delete()`, which made the
 * divergence visible on the already-broken admin search for 9985590477 (it
 * used to show a stale ₹5,000 and now shows ₹0).
 *
 * This script fixes it in one pass:
 *   - Paginate through `users` (BATCH_SIZE docs at a time).
 *   - For each user, read `users/{id}/wallet/data.balance`.
 *   - If the root `walletBalance` field differs, write it via a merged set.
 *   - Staff docs (with a `role` field) are skipped so we don't confuse the
 *     admin layer with fake customer balances on accounts like `ironman`.
 *
 * Running this script is IDEMPOTENT — after the one-time backfill, every
 * ongoing change to `wallet/data.balance` from this PR onward also writes the
 * mirror in the same transaction (see walletService.ts and billing-firestore.ts
 * changes in this same branch), so the root field stays authoritative.
 *
 * Usage:
 *   # Scan only, no writes:
 *   npx tsx scripts/backfill-wallet-root-mirror.ts
 *
 *   # Real run:
 *   npx tsx scripts/backfill-wallet-root-mirror.ts --confirm
 *
 *   # Restrict to a single user (sanity check):
 *   npx tsx scripts/backfill-wallet-root-mirror.ts --user=kAlCvaGMbSh4S70fIU40rkEg4903 --confirm
 *
 *   # Cap total docs processed (safety during testing):
 *   npx tsx scripts/backfill-wallet-root-mirror.ts --limit=100
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

// ---------------------------------------------------------------------------
// Config + CLI
// ---------------------------------------------------------------------------

const DATABASE = 'asquare-app-db'
const BATCH_SIZE = 400

const args = process.argv.slice(2)
const readArg = (prefix: string): string | null => {
  const hit = args.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

const CONFIRM = args.includes('--confirm')
const DRY_RUN = !CONFIRM
const SINGLE_USER = readArg('--user=')
const LIMIT = Number(readArg('--limit=') ?? '0')

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
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

const initAdmin = () => {
  if (getApps().length > 0) return
  const keyPath = findServiceAccountKey()
  if (keyPath) {
    console.log(`Using service account key: ${keyPath}`)
    initializeApp({
      credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
    })
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Using GOOGLE_APPLICATION_CREDENTIALS env var')
    initializeApp()
  } else {
    console.error('No service account key found.')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const asNumber = (v: unknown): number => (typeof v === 'number' ? v : 0)

const walletBalanceForUser = async (db: Firestore, userId: string): Promise<number> => {
  const snap = await db.doc(`users/${userId}/wallet/data`).get()
  if (!snap.exists) return 0
  return asNumber(snap.data()?.balance)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Stats {
  scanned: number
  skippedStaff: number
  skippedNoChange: number
  wouldWrite: number
  wrote: number
  skippedNoWallet: number
}

async function processUser(
  db: Firestore,
  userId: string,
  rootData: Record<string, unknown>,
  stats: Stats,
): Promise<void> {
  stats.scanned++

  if (rootData.role) {
    stats.skippedStaff++
    return
  }

  const subBalance = await walletBalanceForUser(db, userId)
  const rootBalance = asNumber(rootData.walletBalance)

  if (subBalance === 0 && rootBalance === 0) {
    stats.skippedNoWallet++
    return
  }

  if (subBalance === rootBalance) {
    stats.skippedNoChange++
    return
  }

  if (DRY_RUN) {
    stats.wouldWrite++
    console.log(
      `[DRY] users/${userId}: root=${rootBalance} → sub=${subBalance} (delta=${
        subBalance - rootBalance
      })`,
    )
    return
  }

  await db.doc(`users/${userId}`).set({ walletBalance: subBalance }, { merge: true })
  stats.wrote++
  if (stats.wrote % 50 === 0) {
    console.log(`[RUN] wrote ${stats.wrote} so far...`)
  }
}

async function processAll(db: Firestore): Promise<Stats> {
  const stats: Stats = {
    scanned: 0,
    skippedStaff: 0,
    skippedNoChange: 0,
    wouldWrite: 0,
    wrote: 0,
    skippedNoWallet: 0,
  }

  if (SINGLE_USER) {
    const d = await db.doc(`users/${SINGLE_USER}`).get()
    if (!d.exists) {
      console.error(`users/${SINGLE_USER} does not exist.`)
      return stats
    }
    await processUser(db, SINGLE_USER, d.data() as Record<string, unknown>, stats)
    return stats
  }

  // Paginate the entire users collection.
  let lastDocId: string | null = null
  let pageIndex = 0
  while (true) {
    let q = db.collection('users').orderBy('__name__').limit(BATCH_SIZE)
    if (lastDocId) q = q.startAfter(lastDocId)
    const snap = await q.get()
    if (snap.empty) break

    for (const d of snap.docs) {
      await processUser(db, d.id, d.data() as Record<string, unknown>, stats)
      if (LIMIT > 0 && stats.scanned >= LIMIT) {
        console.log(`\nReached --limit=${LIMIT}, stopping.`)
        return stats
      }
    }

    lastDocId = snap.docs[snap.docs.length - 1].id
    pageIndex++
    if (pageIndex % 5 === 0) {
      console.log(
        `... paginated ${pageIndex * BATCH_SIZE} docs; stats so far: scanned=${stats.scanned} wouldWrite=${stats.wouldWrite} wrote=${stats.wrote}`,
      )
    }
  }

  return stats
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE)

  console.log(
    `\n${DRY_RUN ? 'DRY-RUN' : 'REAL RUN'} — wallet root-field backfill\n` +
      `database: ${DATABASE}\n` +
      (SINGLE_USER ? `user:     ${SINGLE_USER}\n` : '') +
      (LIMIT ? `limit:    ${LIMIT}\n` : ''),
  )
  if (!DRY_RUN) console.log('*** WRITES ENABLED ***\n')

  const stats = await processAll(db)

  console.log('\n' + '='.repeat(70))
  console.log('BACKFILL SUMMARY')
  console.log('='.repeat(70))
  console.log(`  scanned:             ${stats.scanned}`)
  console.log(`  skipped (staff):     ${stats.skippedStaff}`)
  console.log(`  skipped (no wallet): ${stats.skippedNoWallet}`)
  console.log(`  skipped (in sync):   ${stats.skippedNoChange}`)
  if (DRY_RUN) {
    console.log(`  would write:         ${stats.wouldWrite}`)
  } else {
    console.log(`  wrote:               ${stats.wrote}`)
  }
  console.log('='.repeat(70))
}

main().catch((err) => {
  console.error('backfill failed:', err)
  process.exit(1)
})
