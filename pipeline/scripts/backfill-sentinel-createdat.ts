/**
 * One-shot backfill for the 24 bookings whose `createdAt` was stored as
 * the literal Web SDK `serverTimestamp()` sentinel object. Source of truth
 * for the real creation time is `transactionDate` (a clean ISO string set
 * in the same write — uncorrupted because it was already a string and not
 * a class instance, so the stripUndefined recursion didn't break it).
 *
 * Idempotent: skips any doc whose createdAt already parses to a real Date.
 *
 * Usage:
 *   npx tsx scripts/backfill-sentinel-createdat.ts --dry-run
 *   npx tsx scripts/backfill-sentinel-createdat.ts             # apply
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
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

const isSentinel = (v: unknown): boolean =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  typeof (v as { toDate?: unknown }).toDate !== 'function' &&
  !('_seconds' in (v as Record<string, unknown>)) &&
  '_methodName' in (v as Record<string, unknown>)

;(async () => {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== APPLYING ===')
  const snap = await db.collection('bookings').limit(20000).get()
  console.log(`Scanned ${snap.size} bookings.`)

  type Plan = { id: string; userId: string; from: string; to: Date }
  const plans: Plan[] = []
  let skipped = 0

  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    if (!isSentinel(data.createdAt)) continue

    const txn = String(data.transactionDate ?? '')
    const fromIdMatch = /^ASG(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})/.exec(d.id)
    let resolved: Date | null = null

    if (txn) {
      const t = new Date(txn)
      if (!isNaN(t.getTime()) && t.getTime() > 0) resolved = t
    }
    // Fallback: parse from the booking ID prefix (IST). Used only when
    // transactionDate is missing or unparseable. ID encodes IST wall time.
    if (!resolved && fromIdMatch) {
      const [, yy, mm, dd, hh, mi, ss, ms] = fromIdMatch
      // IST = UTC+05:30. Convert IST wall time to UTC instant.
      const istIso = `20${yy}-${mm}-${dd}T${hh}:${mi}:${ss}.${ms}+05:30`
      const t = new Date(istIso)
      if (!isNaN(t.getTime()) && t.getTime() > 0) resolved = t
    }

    if (!resolved) {
      console.warn(
        `  ${d.id}: no source for createdAt (no transactionDate, no ID match) — skipping`,
      )
      skipped++
      continue
    }

    plans.push({
      id: d.id,
      userId: String(data.userId ?? ''),
      from: 'sentinel',
      to: resolved,
    })
  }

  console.log(`\nFound ${plans.length} corrupt bookings to repair (skipped ${skipped}).`)
  for (const p of plans) {
    console.log(`  ${p.id}  →  ${p.to.toISOString()}`)
  }
  if (plans.length === 0) {
    console.log('Nothing to do.')
    return
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] No writes. Re-run without --dry-run to apply.')
    return
  }

  let written = 0
  for (const p of plans) {
    const ts = Timestamp.fromDate(p.to)
    try {
      await db.collection('bookings').doc(p.id).set({ createdAt: ts }, { merge: true })
      if (p.userId && !p.userId.startsWith('offline_')) {
        await db
          .collection('users')
          .doc(p.userId)
          .collection('bookings')
          .doc(p.id)
          .set({ createdAt: ts }, { merge: true })
          .catch(() => undefined)
      }
      written++
      console.log(`  ✓ ${p.id}`)
    } catch (err) {
      console.error(`  ✗ ${p.id}: ${(err as Error).message}`)
    }
  }
  console.log(`\nDone. Wrote ${written}/${plans.length} repairs.`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
