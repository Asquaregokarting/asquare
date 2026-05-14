/**
 * Reverses the Fix #6 game-level vendor backfill — deletes the 5
 * `recon-game-vendor-*` entries written today. The user's call:
 * the underlying code path (toBookableCatalogActivity + loadActivityCatalog)
 * is already fixed so future bookings won't have the bug; the 5
 * historical ones stay as they were stamped at sale time, no
 * retrospective vendor credit needed.
 *
 * Idempotent — re-running after entries are already deleted is a no-op.
 *
 * Usage:
 *   npx tsx scripts/delete-game-level-backfill.ts --dry-run
 *   npx tsx scripts/delete-game-level-backfill.ts             # apply
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

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
  // Find every ledger entry whose doc id starts with `recon-game-vendor-`.
  // Avoids hardcoding the 5 ids — picks them up by source/createdBy too if
  // someone re-ran the backfill with different ids.
  const snap = await db
    .collection('vendorLedger')
    .where('createdBy', '==', 'system-backfill-game-level-vendor')
    .get()

  console.log(`Found ${snap.size} game-level backfill entries to delete:`)
  let total = 0
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    console.log(`  ${d.id} → vendor ${data.vendorId} amount=₹${data.amount} (${data.referenceId})`)
    total += Number(data.amount) || 0
  }
  console.log(`Total credit being reversed: ₹${total}`)

  if (DRY_RUN) {
    console.log('\n[dry-run] No deletes performed.')
    return
  }
  if (snap.size === 0) {
    console.log('\nNothing to delete.')
    return
  }
  console.log(`\nDeleting ${snap.size} entries…`)
  const batch = db.batch()
  for (const d of snap.docs) batch.delete(d.ref)
  await batch.commit()
  console.log('Done.')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
