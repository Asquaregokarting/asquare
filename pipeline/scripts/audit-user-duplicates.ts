/**
 * Audit script: find duplicate user documents by normalized phone.
 *
 * Scans the entire `users` collection in asquare-app-db, groups docs by the
 * trailing-10-digit phone, and reports every phone with more than one
 * customer doc. For each group it also computes the proposed canonical doc
 * via the same `pickCanonical` algorithm used by the dedup script, so the
 * audit output is a preview of what the destructive run would do.
 *
 * This script is READ-ONLY. No writes, no deletes.
 *
 * Usage:
 *   npx tsx scripts/audit-user-duplicates.ts
 *
 * Options:
 *   --phone=9985590477   Report only this phone (10 digits). Still shows all
 *                        its duplicate docs even if there's only one.
 *   --min-count=2        Minimum number of docs required to report a phone
 *                        (default 2 — i.e. actual duplicates only).
 *   --out=report.json    Write the full report to a JSON file instead of
 *                        stdout. Stdout still shows a summary.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

import {
  normalizePhone,
  pickCanonical,
  type CandidateUserDoc,
  type PickCanonicalResult,
} from '../src/services/userMerge'

// ---------------------------------------------------------------------------
// Config + CLI
// ---------------------------------------------------------------------------

const DATABASE = 'asquare-app-db'

const args = process.argv.slice(2)
const SINGLE_PHONE = args.find((a) => a.startsWith('--phone='))?.split('=')[1] ?? null
const MIN_COUNT = Number(args.find((a) => a.startsWith('--min-count='))?.split('=')[1] ?? '2')
const OUT_PATH = args.find((a) => a.startsWith('--out='))?.split('=')[1] ?? null

// ---------------------------------------------------------------------------
// Firebase Admin setup (matches scripts/migrate-members-to-users.ts)
// ---------------------------------------------------------------------------

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
    console.log(`Using GOOGLE_APPLICATION_CREDENTIALS env var`)
    initializeApp()
  } else {
    console.error(
      '\nNo service account key found. Place one of these in the project root:\n' +
        '  - serviceAccountKey.json\n' +
        '  - service-account-key.json\n' +
        '  - firebase-admin-key.json\n' +
        '\nOr set the GOOGLE_APPLICATION_CREDENTIALS environment variable.\n',
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RawUserData = Record<string, unknown>

const toMillis = (value: unknown): number | null => {
  if (value == null) return null
  if (value instanceof Timestamp) return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (
    typeof value === 'object' &&
    value !== null &&
    '_seconds' in (value as Record<string, unknown>)
  ) {
    const s = (value as { _seconds?: number })._seconds
    if (typeof s === 'number') return s * 1000
  }
  return null
}

const toDateOrNull = (value: unknown): Date | null => {
  const ms = toMillis(value)
  return ms == null ? null : new Date(ms)
}

const asString = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (value == null) return null
  return String(value)
}

const extractWalletBalance = (data: RawUserData): number => {
  const direct = data.walletBalance
  if (typeof direct === 'number') return direct
  return 0
}

/**
 * Convert a raw Firestore user doc into a CandidateUserDoc. The wallet
 * balance comes from the root doc (which is what the legacy docs had) —
 * the script will also read the `wallet/data` subcollection for canonical
 * balance reporting, but that lookup happens lazily after grouping.
 */
const toCandidate = (id: string, data: RawUserData): CandidateUserDoc => {
  const role = asString(data.role)
  return {
    id,
    role,
    phone: asString(data.phone),
    phoneNumber: asString(data.phoneNumber),
    walletBalance: extractWalletBalance(data),
    createdAt: toDateOrNull(data.createdAt),
    updatedAt: toDateOrNull(data.updatedAt),
    lastLoginAt: toDateOrNull(data.lastLoginAt),
  }
}

const walletBalanceFromSubcollection = async (db: Firestore, userId: string): Promise<number> => {
  try {
    const snap = await db.doc(`users/${userId}/wallet/data`).get()
    if (!snap.exists) return 0
    const data = snap.data()
    const balance = data?.balance
    return typeof balance === 'number' ? balance : 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface DuplicateGroupReport {
  phone: string
  totalDocs: number
  customerDocs: number
  staffDocs: number
  docs: Array<{
    id: string
    role: string | null
    name: string | null
    walletRoot: number
    walletSubcollection: number
    createdAt: string | null
    updatedAt: string | null
    lastLoginAt: string | null
  }>
  proposedCanonical: string | null
  proposedMerges: string[]
  notes: string[]
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE)

  console.log(
    `\nScanning users collection in ${DATABASE}` +
      (SINGLE_PHONE ? ` (filtered to phone=${SINGLE_PHONE})` : '') +
      `...\n`,
  )

  const snapshot = await db.collection('users').get()
  console.log(`Read ${snapshot.size} user docs.\n`)

  // Group by normalized phone
  const groups = new Map<
    string,
    Array<{ id: string; data: RawUserData; candidate: CandidateUserDoc }>
  >()
  let skippedNoPhone = 0

  for (const userDoc of snapshot.docs) {
    const data = userDoc.data() as RawUserData
    const rawPhone = asString(data.phone) ?? asString(data.phoneNumber) ?? asString(data.mobile)
    const phone = normalizePhone(rawPhone)

    if (!phone || phone.length !== 10) {
      skippedNoPhone++
      continue
    }
    if (SINGLE_PHONE && phone !== normalizePhone(SINGLE_PHONE)) continue

    const candidate = toCandidate(userDoc.id, data)
    const bucket = groups.get(phone) ?? []
    bucket.push({ id: userDoc.id, data, candidate })
    groups.set(phone, bucket)
  }

  console.log(`Grouped ${groups.size} distinct phones (${skippedNoPhone} docs had no phone).\n`)

  const reports: DuplicateGroupReport[] = []

  for (const [phone, bucket] of groups) {
    if (!SINGLE_PHONE && bucket.length < MIN_COUNT) continue

    // Fetch subcollection wallet balance for each candidate (this is what the
    // live site reads, so it's the interesting number).
    const docsWithWallets = await Promise.all(
      bucket.map(async (entry) => {
        const walletSub = await walletBalanceFromSubcollection(db, entry.id)
        return { ...entry, walletSub }
      }),
    )

    // Use the subcollection balance (live source of truth) when picking canonical.
    const candidates: CandidateUserDoc[] = docsWithWallets.map((e) => ({
      ...e.candidate,
      walletBalance: e.walletSub || e.candidate.walletBalance || 0,
    }))

    const result: PickCanonicalResult = pickCanonical(candidates)

    const staffDocs = candidates.filter((c) => !!c.role).length
    const customerDocs = candidates.length - staffDocs

    const notes: string[] = []
    let proposedCanonical: string | null = null
    let proposedMerges: string[] = []

    switch (result.kind) {
      case 'picked':
        proposedCanonical = result.canonical.id
        proposedMerges = result.duplicates.map((d) => d.id)
        break
      case 'skip-staff-only':
        notes.push('All docs are staff — no merge.')
        break
      case 'skip-no-customers':
        notes.push('No candidates to merge.')
        break
      case 'error-role-has-wallet':
        notes.push(
          `ERROR: staff doc(s) with non-zero wallet balance: ${result.offenders
            .map((o) => o.id)
            .join(', ')}. Halt for manual review.`,
        )
        break
    }

    reports.push({
      phone,
      totalDocs: candidates.length,
      customerDocs,
      staffDocs,
      docs: docsWithWallets.map((e) => ({
        id: e.id,
        role: asString(e.data.role),
        name: asString(e.data.name) ?? asString(e.data.displayName),
        walletRoot: extractWalletBalance(e.data),
        walletSubcollection: e.walletSub,
        createdAt: toDateOrNull(e.data.createdAt)?.toISOString() ?? null,
        updatedAt: toDateOrNull(e.data.updatedAt)?.toISOString() ?? null,
        lastLoginAt: toDateOrNull(e.data.lastLoginAt)?.toISOString() ?? null,
      })),
      proposedCanonical,
      proposedMerges,
      notes,
    })
  }

  // Sort: errors first, then highest duplicate count
  reports.sort((a, b) => {
    const aHasError = a.notes.some((n) => n.startsWith('ERROR'))
    const bHasError = b.notes.some((n) => n.startsWith('ERROR'))
    if (aHasError !== bHasError) return aHasError ? -1 : 1
    return b.totalDocs - a.totalDocs
  })

  // Summary
  const totalDupPhones = reports.filter((r) => r.customerDocs > 1).length
  const totalExtraCustomerDocs = reports.reduce(
    (sum, r) => sum + Math.max(0, r.customerDocs - 1),
    0,
  )
  const totalErrors = reports.filter((r) => r.notes.some((n) => n.startsWith('ERROR'))).length

  console.log('='.repeat(70))
  console.log('AUDIT SUMMARY')
  console.log('='.repeat(70))
  console.log(`  Phones scanned:              ${groups.size}`)
  console.log(`  Phones with >1 customer doc: ${totalDupPhones}`)
  console.log(`  Customer docs to merge away: ${totalExtraCustomerDocs}`)
  console.log(`  Errors (staff with wallet):  ${totalErrors}`)
  console.log(`  Docs without a phone field:  ${skippedNoPhone}`)
  console.log('='.repeat(70))
  console.log('')

  if (SINGLE_PHONE || reports.length <= 10) {
    for (const r of reports) {
      console.log(`phone ${r.phone}  (${r.totalDocs} docs, ${r.staffDocs} staff)`)
      for (const d of r.docs) {
        const walletNote =
          d.walletSubcollection !== d.walletRoot
            ? ` [sub=${d.walletSubcollection}, root=${d.walletRoot}]`
            : ` [wallet=${d.walletSubcollection}]`
        const roleNote = d.role ? ` role=${d.role}` : ''
        const nameNote = d.name ? ` "${d.name}"` : ''
        console.log(`  - ${d.id}${nameNote}${roleNote}${walletNote}`)
      }
      if (r.proposedCanonical) {
        console.log(`  → canonical: ${r.proposedCanonical}`)
        if (r.proposedMerges.length > 0) {
          console.log(`  → merge:     ${r.proposedMerges.join(', ')}`)
        }
      }
      for (const note of r.notes) {
        console.log(`  ${note}`)
      }
      console.log('')
    }
  } else {
    console.log(`(${reports.length} groups — pass --out=report.json for full details)\n`)
  }

  if (OUT_PATH) {
    const outDir = path.dirname(path.resolve(OUT_PATH))
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
    const payload = {
      generatedAt: new Date().toISOString(),
      database: DATABASE,
      filter: SINGLE_PHONE ? { phone: SINGLE_PHONE } : null,
      minCount: MIN_COUNT,
      summary: {
        phonesScanned: groups.size,
        phonesWithDuplicates: totalDupPhones,
        extraCustomerDocs: totalExtraCustomerDocs,
        errors: totalErrors,
        docsWithoutPhone: skippedNoPhone,
      },
      reports,
    }
    fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2))
    console.log(`Wrote full report to ${OUT_PATH}`)
  }
}

main().catch((err) => {
  console.error('audit failed:', err)
  process.exit(1)
})
