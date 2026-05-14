/**
 * Catch-up cascade: stamp `voidedAt` on any vendorLedger entry whose
 * source booking was trashed BEFORE softDeleteBooking learned how to
 * cascade (cascade shipped 2026-05-07; bookings trashed earlier left
 * their ledger entries un-voided).
 *
 * DRY-RUN by default. Pass `--apply` to actually write.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const APPLY = process.argv.includes('--apply')

const keyPath = path.resolve('serviceAccountKey.json')
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore

;(async () => {
  console.log(`Mode: ${APPLY ? 'APPLY (live writes)' : 'DRY-RUN (no writes)'}\n`)

  // Pull every soft-deleted booking. Iterating the full bookings
  // collection is cheaper than a where('deletedAt', '!=', null) query
  // for the small percentage that's trashed.
  const bSnap = await db.collection('bookings').get()
  const trashedIds: string[] = []
  for (const d of bSnap.docs) {
    const data = d.data() as Record<string, unknown>
    if (data.deletedAt) trashedIds.push(d.id)
  }
  console.log(`Trashed bookings:    ${trashedIds.length}`)

  if (trashedIds.length === 0) return

  // Look up vendorLedger entries for each, collect ones missing voidedAt.
  const unvoidedRefs: FirebaseFirestore.DocumentReference[] = []
  let alreadyVoided = 0
  let totalAmountToVoid = 0
  for (let i = 0; i < trashedIds.length; i += 30) {
    const batch = trashedIds.slice(i, i + 30)
    const lSnap = await db.collection('vendorLedger').where('referenceId', 'in', batch).get()
    for (const d of lSnap.docs) {
      const data = d.data() as Record<string, unknown>
      if (data.voidedAt) {
        alreadyVoided++
        continue
      }
      unvoidedRefs.push(d.ref)
      totalAmountToVoid += Number(data.amount ?? 0)
    }
  }

  console.log(`Ledger entries already voided: ${alreadyVoided}`)
  console.log(`Ledger entries pending void:   ${unvoidedRefs.length}`)
  console.log(`Total amount to void:          ₹${totalAmountToVoid}`)

  if (unvoidedRefs.length === 0) return

  console.log('\nFirst 10 ledger entries to void:')
  for (const ref of unvoidedRefs.slice(0, 10)) {
    console.log(`  ${ref.id}`)
  }

  if (!APPLY) {
    console.log('\nDry-run only. Pass --apply to write.')
    return
  }

  const voidedAt = new Date().toISOString()
  console.log(`\nApplying voidedAt=${voidedAt} ...`)
  let done = 0
  for (let i = 0; i < unvoidedRefs.length; i += 400) {
    const slice = unvoidedRefs.slice(i, i + 400)
    const batch = db.batch()
    for (const ref of slice) {
      batch.set(ref, { voidedAt }, { merge: true })
    }
    await batch.commit()
    done += slice.length
    console.log(`  ${done}/${unvoidedRefs.length}`)
  }
  console.log(`\nDone. Voided ${done} ledger entries.`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
