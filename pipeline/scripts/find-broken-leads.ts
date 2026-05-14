/**
 * Scan all leads for fields that would crash the LeadScoreBadge / kanban
 * card render path:
 *   - score is not a finite number (NaN / null / undefined / string)
 *   - scoreLabel is not in {hot, warm, cold}
 *   - status / source are not in their expected enums
 *
 * The browser-side ErrorBoundary fallback ("We hit an unexpected error")
 * trips when the kanban includes any lead whose `scoreLabel` is missing
 * from `SCORE_LABEL_CONFIG` — accessing `.color` on `undefined` throws.
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

const VALID_SCORE_LABELS = new Set(['hot', 'warm', 'cold'])
const VALID_STATUSES = new Set([
  'new',
  'contacted',
  'interested',
  'follow_up_pending',
  'booked',
  'closed',
  'lost',
])
const VALID_SOURCES = new Set([
  'inquiry_whatsapp',
  'inquiry_call',
  'inquiry_website',
  'interakt',
  'abandoned_cart',
  'landing_page',
  'exit_intent',
  'webhook',
  'manual',
  'import',
])

;(async () => {
  const snap = await db.collection('leads').get()
  console.log(`Scanning ${snap.size} leads...\n`)

  type Issue = { id: string; field: string; value: unknown; cardWillCrash: boolean }
  const issues: Issue[] = []
  const counts = {
    badScore: 0,
    badScoreLabel: 0,
    badStatus: 0,
    badSource: 0,
    cardWillCrash: 0,
  }

  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>

    const score = d.score
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      issues.push({ id: doc.id, field: 'score', value: score, cardWillCrash: false })
      counts.badScore++
    }

    const sl = typeof d.scoreLabel === 'string' ? d.scoreLabel : ''
    if (!VALID_SCORE_LABELS.has(sl)) {
      const cardWillCrash = true
      issues.push({ id: doc.id, field: 'scoreLabel', value: d.scoreLabel, cardWillCrash })
      counts.badScoreLabel++
      if (cardWillCrash) counts.cardWillCrash++
    }

    const st = typeof d.status === 'string' ? d.status : ''
    if (!VALID_STATUSES.has(st)) {
      issues.push({ id: doc.id, field: 'status', value: d.status, cardWillCrash: false })
      counts.badStatus++
    }

    const sr = typeof d.source === 'string' ? d.source : ''
    if (!VALID_SOURCES.has(sr)) {
      issues.push({ id: doc.id, field: 'source', value: d.source, cardWillCrash: false })
      counts.badSource++
    }
  }

  console.log('Issue counts:')
  console.log(`  bad score:          ${counts.badScore}`)
  console.log(`  bad scoreLabel:     ${counts.badScoreLabel}  ← crashes LeadScoreBadge`)
  console.log(`  bad status:         ${counts.badStatus}`)
  console.log(`  bad source:         ${counts.badSource}`)
  console.log(`  card-will-crash:    ${counts.cardWillCrash}`)

  if (issues.length > 0) {
    console.log('\nFirst 30 issues:')
    for (const i of issues.slice(0, 30)) {
      console.log(`  ${i.id.padEnd(28)}  ${i.field.padEnd(11)} = ${JSON.stringify(i.value)}`)
    }
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
