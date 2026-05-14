import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

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
  console.error('No key.')
  process.exit(1)
}
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(k, 'utf-8'))) })
const db = getFirestore('asquare-app-db')

const args = process.argv.slice(2)
const branchId = args[0] || '0'
const gameId = args[1] || 'cricket'

;(async () => {
  console.log(`Walking locations/${branchId}/games/${gameId}/subgames/*/variants/*…`)
  const subgames = await db
    .collection('locations')
    .doc(branchId)
    .collection('games')
    .doc(gameId)
    .collection('subgames')
    .get()
  for (const sg of subgames.docs) {
    console.log(`\n  subgame: ${sg.id}  data: ${JSON.stringify(sg.data())}`)
    const variants = await sg.ref.collection('variants').get()
    for (const v of variants.docs) {
      const d = v.data() as Record<string, unknown>
      console.log(`    variant: ${v.id}`)
      console.log(
        `      vendorId=${d.vendorId ?? '(none)'} vendorBranchId=${d.vendorBranchId ?? '(none)'} price=${d.price ?? '?'} status=${d.status ?? '?'}`,
      )
    }
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
