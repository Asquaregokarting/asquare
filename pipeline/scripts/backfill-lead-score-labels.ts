/**
 * Backfill `scoreLabel` and `score` on legacy leads that were imported
 * from Superfone / RecentLogin / other pre-pipeline sources without
 * those fields. Runs the LeadScoreBadge component crash-prone path to
 * proper data — the component's defensive fallback (renders an
 * "Unscored" pill) handles the missing-field case, but having real
 * values keeps the queue / sort / kanban behaviour predictable.
 *
 *   score      → 0 when not finite
 *   scoreLabel → 'cold' when not in {hot, warm, cold} — matches the
 *                fallback already used by `sortLeadsByCallQueue`.
 *
 * Status field is intentionally NOT touched — the legacy values
 * ('Assigned', 'Pending', 'Completed', 'NotInterested') need
 * business-side mapping decisions before they can be normalised to
 * the new enum (new / contacted / interested / etc.).
 *
 * DRY RUN by default. Pass `--apply` to actually write.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const APPLY = process.argv.includes('--apply')

const keyPath = path.resolve('serviceAccountKey.json')
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found.')
  process.exit(1)
}
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore

const VALID_SCORE_LABELS = new Set(['hot', 'warm', 'cold'])

;(async () => {
  console.log(`Mode: ${APPLY ? 'APPLY (live writes)' : 'DRY-RUN (no writes)'}\n`)

  const snap = await db.collection('leads').get()
  console.log(`Scanning ${snap.size} leads...\n`)

  type Patch = { id: string; sets: Record<string, unknown>; before: Record<string, unknown> }
  const patches: Patch[] = []
  let alreadyOk = 0

  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    const sets: Record<string, unknown> = {}

    const score = d.score
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      sets.score = 0
    }

    const sl = typeof d.scoreLabel === 'string' ? d.scoreLabel : ''
    if (!VALID_SCORE_LABELS.has(sl)) {
      sets.scoreLabel = 'cold'
    }

    if (Object.keys(sets).length === 0) {
      alreadyOk++
      continue
    }
    patches.push({
      id: doc.id,
      sets,
      before: { score: d.score, scoreLabel: d.scoreLabel },
    })
  }

  console.log(`Already OK:    ${alreadyOk}`)
  console.log(`Need backfill: ${patches.length}`)

  if (patches.length === 0) {
    console.log('\nNothing to do.')
    return
  }

  console.log('\nFirst 10 patches:')
  for (const p of patches.slice(0, 10)) {
    console.log(`  ${p.id}  before=${JSON.stringify(p.before)}  sets=${JSON.stringify(p.sets)}`)
  }

  if (!APPLY) {
    console.log('\nDry-run only. Pass --apply to write.')
    return
  }

  // Apply in batches of 400 (Firestore writeBatch limit is 500).
  console.log('\nApplying writes...')
  let done = 0
  for (let i = 0; i < patches.length; i += 400) {
    const batch = db.batch()
    const slice = patches.slice(i, i + 400)
    for (const p of slice) {
      batch.set(db.collection('leads').doc(p.id), p.sets, { merge: true })
    }
    await batch.commit()
    done += slice.length
    console.log(`  ${done}/${patches.length}`)
  }
  console.log(`\nDone. Backfilled ${done} leads.`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
