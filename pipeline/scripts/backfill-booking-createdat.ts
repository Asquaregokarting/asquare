/**
 * One-shot backfill: repair bookings where `createdAt` is missing, null, or
 * stored as a string that can't be parsed (the historical bug surfaced by the
 * same-second-bookings audit on 2026-05-04).
 *
 * Strategy — in priority order:
 *   1. If `createdAt` is a valid Timestamp/Date → leave it alone.
 *   2. If `createdAt` is a string that parses → convert to Timestamp.
 *   3. Else fall back to the booking ID's embedded timestamp (current ASG
 *      format encodes YY MM DD HH mm SS — see generateOrderNumber()).
 *   4. Else fall back to `paymentCompletedAt` or `transactionDate`.
 *   5. Else log and skip — the document is too sparse to repair confidently.
 *
 * Usage:
 *   npx tsx scripts/backfill-booking-createdat.ts --dry-run
 *   npx tsx scripts/backfill-booking-createdat.ts            # apply
 *
 * Options:
 *   --dry-run            Print what would change, write nothing.
 *   --concurrency=N      Parallel writes per page (default 20).
 *   --limit=N            Stop after processing N bookings (smoke test).
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import {
  getFirestore,
  Timestamp,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const DATABASE = 'asquare-app-db'
const PAGE_SIZE = 500

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const CONCURRENCY = Math.max(
  1,
  Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? '20'),
)
const HARD_LIMIT = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '0')

const findServiceAccountKey = (): string | null => {
  const candidates = [
    path.resolve('serviceAccountKey.json'),
    path.resolve('service-account-key.json'),
    path.resolve('firebase-admin-key.json'),
    path.resolve('scripts/serviceAccountKey.json'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const initAdmin = () => {
  if (getApps().length > 0) return
  const keyPath = findServiceAccountKey()
  if (keyPath) {
    console.log(`Using service account key: ${keyPath}`)
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'))
    initializeApp({ credential: cert(serviceAccount) })
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Using GOOGLE_APPLICATION_CREDENTIALS env var')
    initializeApp()
  } else {
    console.error('No service account key found.')
    process.exit(1)
  }
}

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const isValidDate = (d: unknown): d is Date =>
  d instanceof Date && !isNaN(d.getTime()) && d.getTime() !== 0

/**
 * Recover the booking time from the embedded ASG-ID timestamp. Tries three
 * historical formats in order:
 *
 *   1. Modern (current generateOrderNumber, unified-booking.ts:265):
 *        ASG{YY}{MM}{DD}{HH}{mm}{SS}{CNT3}{RAND4}     — e.g. ASG2603271737381023K65
 *
 *   2. Legacy pre-random-suffix (Feb–Mar 2026):
 *        ASG{YY}{MM}{DD}{HH}{mm}{SS}{CNT}             — e.g. ASG260212210220101
 *      All-digit, 15–16 trailing digits, no letters.
 *
 *   3. Legacy hyphen format (Oct–Nov 2025 imports):
 *        ASG-{MM}{DD}{YYYY}{HH}{mm}{SS}{NN}           — e.g. ASG-1017202512444583
 *
 * All formats encode IST local time (the original writer used Date.getHours()
 * etc. on a server / device set to IST), so we construct in +05:30 and
 * convert to UTC.
 */
const parseAsgIdTimestamp = (id: string): Date | null => {
  // Format 1: modern with random suffix.
  const modern = /^ASG(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d{3}[A-Z0-9]{4}$/.exec(id)
  if (modern) {
    const [, yy, mm, dd, hh, min, ss] = modern
    const d = new Date(`20${yy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`)
    return isValidDate(d) ? d : null
  }

  // Format 2: legacy all-digit, no random suffix.
  const legacyDigits = /^ASG(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d{1,4}$/.exec(id)
  if (legacyDigits) {
    const [, yy, mm, dd, hh, min, ss] = legacyDigits
    const d = new Date(`20${yy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`)
    return isValidDate(d) ? d : null
  }

  // Format 3: legacy hyphen with MM-DD-YYYY layout.
  const hyphen = /^ASG-(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})(\d{2})\d+$/.exec(id)
  if (hyphen) {
    const [, mm, dd, yyyy, hh, min, ss] = hyphen
    const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`)
    return isValidDate(d) ? d : null
  }

  return null
}

const tryParseDate = (raw: unknown): Date | null => {
  if (raw == null) return null
  if (raw instanceof Date) return isValidDate(raw) ? raw : null
  if (raw instanceof Timestamp) return raw.toDate()
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof obj.toDate === 'function') {
      try {
        return obj.toDate()
      } catch {
        /* fall through */
      }
    }
    if (typeof obj.seconds === 'number') return new Date(obj.seconds * 1000)
    if (typeof obj._seconds === 'number') return new Date(obj._seconds * 1000)
  }
  if (typeof raw === 'string' && raw.length > 0) {
    const d = new Date(raw)
    return isValidDate(d) ? d : null
  }
  if (typeof raw === 'number') {
    const d = new Date(raw)
    return isValidDate(d) ? d : null
  }
  return null
}

interface RepairOutcome {
  ok: boolean
  reason:
    | 'already_valid'
    | 'fixed_from_string'
    | 'fixed_from_id'
    | 'fixed_from_payment'
    | 'unrepairable'
  resolved?: Date
  rawCreatedAt?: unknown
}

const planRepair = (id: string, data: Record<string, unknown>): RepairOutcome => {
  const existing = tryParseDate(data.createdAt)
  if (existing && existing.getFullYear() > 1971) {
    return { ok: true, reason: 'already_valid', resolved: existing }
  }

  // Strategy 2: parse string-typed createdAt that wasn't auto-converted.
  if (typeof data.createdAt === 'string') {
    const parsed = tryParseDate(data.createdAt)
    if (parsed && parsed.getFullYear() > 1971) {
      return {
        ok: true,
        reason: 'fixed_from_string',
        resolved: parsed,
        rawCreatedAt: data.createdAt,
      }
    }
  }

  // Strategy 3: derive from ASG ID timestamp.
  const fromId = parseAsgIdTimestamp(id)
  if (fromId) {
    return { ok: true, reason: 'fixed_from_id', resolved: fromId, rawCreatedAt: data.createdAt }
  }

  // Strategy 4: fall back to paymentCompletedAt / transactionDate.
  const fromPayment =
    tryParseDate(data.paymentCompletedAt) ||
    tryParseDate(data.transactionDate) ||
    tryParseDate(data.updatedAt)
  if (fromPayment && fromPayment.getFullYear() > 1971) {
    return {
      ok: true,
      reason: 'fixed_from_payment',
      resolved: fromPayment,
      rawCreatedAt: data.createdAt,
    }
  }

  return { ok: false, reason: 'unrepairable', rawCreatedAt: data.createdAt }
}

async function repairOne(db: Firestore, doc: QueryDocumentSnapshot): Promise<RepairOutcome> {
  const plan = planRepair(doc.id, doc.data())
  if (plan.reason === 'already_valid' || !plan.resolved) return plan

  if (DRY_RUN) {
    console.log(
      `[dry-run] bookings/${doc.id}: ${plan.reason} → ${plan.resolved.toISOString()} (was: ${JSON.stringify(plan.rawCreatedAt)})`,
    )
    return plan
  }

  const ts = Timestamp.fromDate(plan.resolved)
  await db.collection('bookings').doc(doc.id).update({ createdAt: ts })

  // Mirror to user subcollection if present (best-effort; not all bookings
  // have a user subcollection mirror — the original write paths skip
  // offline_ users).
  const userId = String(doc.data().userId ?? '')
  if (userId && !userId.startsWith('offline_')) {
    try {
      const userRef = db.collection('users').doc(userId).collection('bookings').doc(doc.id)
      const userSnap = await userRef.get()
      if (userSnap.exists) await userRef.update({ createdAt: ts })
    } catch {
      /* non-critical */
    }
  }
  return plan
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE)

  let cursor: QueryDocumentSnapshot | undefined
  let total = 0
  const counts: Record<RepairOutcome['reason'], number> = {
    already_valid: 0,
    fixed_from_string: 0,
    fixed_from_id: 0,
    fixed_from_payment: 0,
    unrepairable: 0,
  }
  const unrepairable: string[] = []

  while (true) {
    let q = db.collection('bookings').orderBy('__name__').limit(PAGE_SIZE)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break

    for (const batch of chunk(snap.docs, CONCURRENCY)) {
      const results = await Promise.all(batch.map((d) => repairOne(db, d)))
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        counts[r.reason] += 1
        if (r.reason === 'unrepairable') unrepairable.push(batch[i].id)
      }
    }

    total += snap.size
    console.log(
      `processed=${total} valid=${counts.already_valid} string→${counts.fixed_from_string} id→${counts.fixed_from_id} pay→${counts.fixed_from_payment} unrepairable=${counts.unrepairable}`,
    )
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < PAGE_SIZE) break
    if (HARD_LIMIT && total >= HARD_LIMIT) break
  }

  console.log(`\nDone${DRY_RUN ? ' [dry-run]' : ''}. total=${total}`)
  console.log(JSON.stringify(counts, null, 2))
  if (unrepairable.length > 0) {
    console.log(`\nUnrepairable IDs (${unrepairable.length}):`)
    for (const id of unrepairable) console.log(`  ${id}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
