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
const subGameId = args[2] || 'cricket'

;(async () => {
  console.log(`\n=== locations/${branchId}/games/${gameId} (game doc) ===`)
  const g = await db.collection('locations').doc(branchId).collection('games').doc(gameId).get()
  if (g.exists) console.log(JSON.stringify(g.data(), null, 2))
  else console.log('(does not exist)')

  console.log(`\n=== locations/${branchId}/games/${gameId}/subgames/${subGameId} (subgame doc) ===`)
  const sg = await db
    .collection('locations')
    .doc(branchId)
    .collection('games')
    .doc(gameId)
    .collection('subgames')
    .doc(subGameId)
    .get()
  if (sg.exists) console.log(JSON.stringify(sg.data(), null, 2))
  else console.log('(does not exist)')

  console.log(
    `\n=== locations/${branchId}/games/${gameId}/subgames/${subGameId}/variants/* (full variant docs) ===`,
  )
  const variants = await db
    .collection('locations')
    .doc(branchId)
    .collection('games')
    .doc(gameId)
    .collection('subgames')
    .doc(subGameId)
    .collection('variants')
    .get()
  for (const v of variants.docs) {
    console.log(`\n  --- variant: ${v.id} ---`)
    console.log(JSON.stringify(v.data(), null, 2))
  }

  // Also try the legacy 'activities' collection
  console.log(`\n=== legacy 'activities' collection (looking for cricket@${branchId}) ===`)
  try {
    const legacyActsSnap = await db.collection('Activities').get()
    for (const d of legacyActsSnap.docs) {
      const data = d.data() as Record<string, unknown>
      const matchGame = String(data.gameId ?? data.category ?? '')
        .toLowerCase()
        .includes('cricket')
      const matchBranch = String(data.locationId ?? data.branchId ?? '') === branchId
      if (matchGame && matchBranch) {
        console.log(`  ${d.id}: vendorId=${data.vendorId} price=${data.price ?? '?'}`)
      }
    }
  } catch (_e) {
    console.log('  (Activities collection not present or empty)')
  }

  // Also try vendorDetails to see if any cricket activities are listed there
  console.log(`\n=== vendorDetails — vendor 7777997226 (SEERAMREDDY) ===`)
  const vd = await db.collection('vendorDetails').doc('7777997226').get()
  if (vd.exists) {
    const data = vd.data() as Record<string, unknown>
    // Show only the parts likely to be relevant
    const summary = {
      keys: Object.keys(data).sort(),
      vendorName: data.vendorName,
      branch: data.branch,
      branchId: data.branchId,
      gameId: data.gameId,
      games: data.games,
      activities: data.activities,
    }
    console.log(JSON.stringify(summary, null, 2))
  } else console.log('  (vendor doc not found)')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
