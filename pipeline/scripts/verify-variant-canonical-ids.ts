/**
 * Smoke-test verification: list every variant under
 * Visakhapatnam → GOKARTING → adult and confirm both `5 LAPS` and the
 * newly-created `laps 5` exist as distinct Firestore docs.
 *
 * Pre-fix, the writer would derive both labels to `lap_5` and silently
 * collapse them. Post-fix, the existing one keeps `lap_5` and the new
 * one gets an opaque `var_*` id.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const keyPath = path.resolve('serviceAccountKey.json')
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found.')
  process.exit(1)
}
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore

;(async () => {
  const variantsRef = db
    .collection('locations')
    .doc('0')
    .collection('games')
    .doc('gokarting')
    .collection('subgames')
    .doc('adult')
    .collection('variants')

  const snap = await variantsRef.get()
  console.log(`adult/variants count: ${snap.size}\n`)
  for (const doc of snap.docs) {
    const d = doc.data()
    console.log(
      `  ${doc.id.padEnd(28)}  label="${d.label}"  laps=${d.laps ?? '-'}  price=${d.price ?? '-'}`,
    )
  }

  // Verify: both `5 LAPS` (existing) and `laps 5` (new) are present.
  const labels = snap.docs.map((d) =>
    String(d.data().label ?? '')
      .trim()
      .toLowerCase(),
  )
  const has5Laps = labels.includes('5 laps')
  const hasLaps5 = labels.includes('laps 5')

  console.log()
  console.log('Smoke-test result:')
  console.log(`  "5 laps"   present: ${has5Laps}`)
  console.log(`  "laps 5"   present: ${hasLaps5}`)
  if (has5Laps && hasLaps5) {
    console.log('  ✓ Distinct variants persisted with the same token bag — bug fixed.')
  } else {
    console.log('  ✗ One of the variants is missing — fix did not land.')
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
