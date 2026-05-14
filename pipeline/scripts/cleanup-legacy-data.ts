/**
 * One-off legacy-data cleanup for asquare-app-db.
 *
 * This script performs two destructive cleanups that the legacy-code
 * removal commit (2c24675) left behind as a data chore:
 *
 *   Step 1 — Delete `_dedupRuns` collection and all its subcollections.
 *            The per-phone ledger written by scripts/dedup-users.ts for
 *            resume support. The sweep (commit c5d0413) is verified
 *            complete; nothing reads the ledger anymore.
 *
 *   Step 2 — Strip the orphaned `memberData.memberWalletBalance` nested
 *            field from every users/{id} doc that has it. parseMemberFromUser
 *            no longer reads it (reads the root `walletBalance` mirror
 *            instead — see commit c5d0413) and creditCustomerWallet no
 *            longer writes it (commit 2c24675). The field is dead data.
 *
 * NOT performed here (intentionally):
 *   - The `members` collection is NOT deleted. It has live readers in
 *     asquare-members.ts, unified-booking.ts, coupon-outreach.ts, and the
 *     AdminModule Members tab. The collection stays.
 *   - The `pipeline` Firestore database deprovisioning is a separate
 *     manual operation (gcloud firestore databases delete) after a
 *     final grep of the functions/ directory.
 *
 * Usage:
 *   # Dry-run all steps (default, no writes):
 *   npx tsx scripts/cleanup-legacy-data.ts
 *
 *   # Run all steps for real:
 *   npx tsx scripts/cleanup-legacy-data.ts --confirm
 *
 *   # Run only step 1 (delete _dedupRuns):
 *   npx tsx scripts/cleanup-legacy-data.ts --step=1 --confirm
 *
 *   # Run only step 2 (strip memberWalletBalance field):
 *   npx tsx scripts/cleanup-legacy-data.ts --step=2 --confirm
 *
 *   # Cap scanned users (safety during testing):
 *   npx tsx scripts/cleanup-legacy-data.ts --limit=1000
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore'
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
const STEP = readArg('--step=') // '1' | '2' | null (= both)
const LIMIT = Number(readArg('--limit=') ?? '0')

if (STEP && STEP !== '1' && STEP !== '2') {
  console.error('--step must be 1 or 2.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Firebase Admin setup (matches scripts/dedup-users.ts and backfill script)
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

const tag = DRY_RUN ? '[DRY]' : '[RUN]'

// ---------------------------------------------------------------------------
// Step 1 — Delete `_dedupRuns` collection (incl. `phones` subcollection)
// ---------------------------------------------------------------------------

/**
 * Recursively delete a collection by paginating and batch-deleting. Used both
 * for the `_dedupRuns/{runId}` parent docs and for their `phones` child
 * subcollections. Runs until the collection is empty or the iteration cap is
 * hit (50 passes × BATCH_SIZE = 20k docs, well beyond any real ledger size).
 */
async function deleteCollection(db: Firestore, collectionPath: string): Promise<number> {
  let deleted = 0
  for (let iter = 0; iter < 50; iter++) {
    const snap = await db.collection(collectionPath).limit(BATCH_SIZE).get()
    if (snap.empty) break
    if (DRY_RUN) {
      return snap.size
    }
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
    deleted += snap.size
    if (snap.size < BATCH_SIZE) break
  }
  return deleted
}

async function runStep1(db: Firestore): Promise<void> {
  console.log(`\n${tag} Step 1 — delete _dedupRuns ledger`)
  const runsSnap = await db.collection('_dedupRuns').get()
  console.log(`${tag}   found ${runsSnap.size} run(s)`)

  let totalPhoneDocs = 0
  for (const runDoc of runsSnap.docs) {
    const phonesPath = `_dedupRuns/${runDoc.id}/phones`
    const phonesCount = await deleteCollection(db, phonesPath)
    totalPhoneDocs += phonesCount
    console.log(
      `${tag}   ${DRY_RUN ? 'would delete' : 'deleted'} ${phonesCount} phone ledger entries under ${runDoc.id}`,
    )
  }

  // Now delete the parent run docs themselves.
  const parentCount = await deleteCollection(db, '_dedupRuns')
  console.log(`${tag}   ${DRY_RUN ? 'would delete' : 'deleted'} ${parentCount} run parent doc(s)`)
  console.log(`${tag}   total ledger rows removed: ${totalPhoneDocs + parentCount}`)
}

// ---------------------------------------------------------------------------
// Step 2 — Strip orphaned `memberData.memberWalletBalance` field
// ---------------------------------------------------------------------------

/**
 * Paginate through every users/{id} doc. For each one that has
 * `memberData.memberWalletBalance !== undefined`, write
 * `memberData.memberWalletBalance: FieldValue.delete()` via a merged set. This
 * uses Firestore's nested-field delete sentinel, so the rest of `memberData`
 * (mobile, totalVisits, totalBillAmount, membership, starStatus,
 * coupons150Redeemed) stays intact.
 */
async function runStep2(db: Firestore): Promise<void> {
  console.log(`\n${tag} Step 2 — strip memberData.memberWalletBalance`)

  let scanned = 0
  let wouldStrip = 0
  let stripped = 0
  let skippedNoField = 0
  let lastDocId: string | null = null

  while (true) {
    let q = db.collection('users').orderBy('__name__').limit(BATCH_SIZE)
    if (lastDocId) q = q.startAfter(lastDocId)
    const snap = await q.get()
    if (snap.empty) break

    // Collect writes for this page, then commit one batch.
    const pageWrites: Array<{ id: string }> = []
    for (const d of snap.docs) {
      scanned++
      if (LIMIT > 0 && scanned > LIMIT) break

      const data = d.data() as Record<string, unknown>
      const md = data.memberData as Record<string, unknown> | undefined
      if (!md || md.memberWalletBalance === undefined) {
        skippedNoField++
        continue
      }
      pageWrites.push({ id: d.id })
    }

    if (pageWrites.length > 0) {
      if (DRY_RUN) {
        wouldStrip += pageWrites.length
      } else {
        const batch = db.batch()
        for (const w of pageWrites) {
          batch.set(
            db.doc(`users/${w.id}`),
            { memberData: { memberWalletBalance: FieldValue.delete() } },
            { merge: true },
          )
        }
        await batch.commit()
        stripped += pageWrites.length
      }
    }

    lastDocId = snap.docs[snap.docs.length - 1].id
    if (LIMIT > 0 && scanned >= LIMIT) {
      console.log(`${tag}   reached --limit=${LIMIT}, stopping`)
      break
    }
    if (scanned % 2000 === 0) {
      console.log(
        `${tag}   ... scanned ${scanned} so far (${DRY_RUN ? 'wouldStrip' : 'stripped'}=${DRY_RUN ? wouldStrip : stripped})`,
      )
    }
  }

  console.log(`${tag}   scanned:         ${scanned}`)
  console.log(`${tag}   skipped no-field: ${skippedNoField}`)
  if (DRY_RUN) {
    console.log(`${tag}   would strip:     ${wouldStrip}`)
  } else {
    console.log(`${tag}   stripped:        ${stripped}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE)

  console.log(
    `\n${DRY_RUN ? 'DRY-RUN' : 'REAL RUN'} — cleanup-legacy-data\n` +
      `database: ${DATABASE}\n` +
      `step:     ${STEP ?? 'all'}\n` +
      (LIMIT ? `limit:    ${LIMIT}\n` : ''),
  )
  if (!DRY_RUN) console.log('*** WRITES ENABLED ***\n')

  if (!STEP || STEP === '1') await runStep1(db)
  if (!STEP || STEP === '2') await runStep2(db)

  console.log('\n' + '='.repeat(70))
  console.log('CLEANUP COMPLETE')
  console.log('='.repeat(70))
}

main().catch((err) => {
  console.error('cleanup-legacy-data failed:', err)
  process.exit(1)
})
