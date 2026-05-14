/**
 * Dedup script: merge duplicate users/{id} documents by phone.
 *
 * For each phone that owns more than one customer doc:
 *   1. Back up every affected doc (root + subcollections) to a JSON file.
 *   2. Pick the canonical doc via pickCanonical() (Firebase Auth UID wins).
 *   3. Merge root fields with "prefer canonical non-null, fall back to dup".
 *   4. SUM wallet balance across ALL duplicates (subcollection + legacy root
 *      `walletBalance` field) and write it to the canonical's wallet/data.
 *      Write a synthetic audit tx so support can trace the merge.
 *   5. Move wallet_transactions, tire_transactions, bookings (subcollection),
 *      and coupons to the canonical. Handle id collisions per plan rules.
 *   6. Rewrite top-level FKs (bookings.userId, deviceSessions.userId) to
 *      point at the canonical.
 *   7. Overwrite phoneToUid/{phone} to point at the canonical.
 *   8. Delete every duplicate's subcollection tree + the duplicate doc itself.
 *   9. Verify the merge invariants (wallet total, no residue).
 *  10. Write a ledger entry so re-runs skip already-verified phones.
 *
 * Usage:
 *   # Dry-run a single phone (SAFE, no writes):
 *   npx tsx scripts/dedup-users.ts --phone=9985590477 --dry-run
 *
 *   # Real run, single phone:
 *   npx tsx scripts/dedup-users.ts --phone=9985590477 --confirm
 *
 *   # Full sweep, dry:
 *   npx tsx scripts/dedup-users.ts --all --dry-run
 *
 *   # Full sweep, real (OFF-PEAK):
 *   npx tsx scripts/dedup-users.ts --all --confirm
 *
 * Flags:
 *   --phone=X          10-digit phone (required unless --all)
 *   --all              Process every phone with >1 customer doc
 *   --dry-run          Default. Logs intended writes but makes no changes.
 *   --confirm          Required to actually write. Must be combined with
 *                      --phone or --all.
 *   --limit=N          Stop after N phones (safety cap for --all)
 *   --backup-path=X    Override default backup file location
 *   --run-id=X         Override ledger run id (default: ISO timestamp)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type Firestore,
  type DocumentSnapshot,
  type DocumentReference,
} from 'firebase-admin/firestore'
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
const BATCH_SIZE = 400
const MOVABLE_SUBCOLLECTIONS = [
  'wallet_transactions',
  'tire_transactions',
  'bookings',
  'coupons',
] as const
const FK_COLLECTIONS = ['bookings', 'deviceSessions'] as const

const args = process.argv.slice(2)

const readArg = (prefix: string): string | null => {
  const hit = args.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

const SINGLE_PHONE = readArg('--phone=')
const ALL = args.includes('--all')
const CONFIRM = args.includes('--confirm')
const DRY_RUN = !CONFIRM // explicit opt-in for writes
const LIMIT = Number(readArg('--limit=') ?? '0')
const RUN_ID = readArg('--run-id=') ?? new Date().toISOString().replace(/[:.]/g, '-')
const BACKUP_PATH = readArg('--backup-path=') ?? `scripts/backups/dedup-${RUN_ID}.json`

if (!SINGLE_PHONE && !ALL) {
  console.error('Must pass either --phone=X or --all.')
  process.exit(1)
}
if (CONFIRM && !SINGLE_PHONE && !ALL) {
  console.error('--confirm requires --phone or --all.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Firebase Admin setup
// ---------------------------------------------------------------------------

const findServiceAccountKey = (): string | null => {
  const candidates = [
    path.resolve('serviceAccountKey.json'),
    path.resolve('service-account-key.json'),
    path.resolve('firebase-admin-key.json'),
    path.resolve('scripts/serviceAccountKey.json'),
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

const initAdmin = () => {
  if (getApps().length > 0) return
  const keyPath = findServiceAccountKey()
  if (keyPath) {
    console.log(`Using service account key: ${keyPath}`)
    initializeApp({
      credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
    })
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Using GOOGLE_APPLICATION_CREDENTIALS env var')
    initializeApp()
  } else {
    console.error('No service account key found.')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const log = (...parts: unknown[]) => console.log(`[${DRY_RUN ? 'DRY' : 'RUN'}]`, ...parts)
const warn = (...parts: unknown[]) => console.warn(`[${DRY_RUN ? 'DRY' : 'RUN'}][WARN]`, ...parts)

// ---------------------------------------------------------------------------
// Firestore helpers
// ---------------------------------------------------------------------------

type RawUserData = Record<string, unknown>

const toMillis = (value: unknown): number | null => {
  if (value == null) return null
  if (value instanceof Timestamp) return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return null
}

const asString = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (value == null) return null
  return String(value)
}

const asNumber = (value: unknown): number => {
  if (typeof value === 'number') return value
  return 0
}

const shortId = (id: string, len = 6): string =>
  id.replace(/[^A-Za-z0-9]/g, '').slice(0, len) || 'x'

const toCandidate = (id: string, data: RawUserData): CandidateUserDoc => ({
  id,
  role: asString(data.role),
  phone: asString(data.phone),
  phoneNumber: asString(data.phoneNumber),
  walletBalance: asNumber(data.walletBalance),
  createdAt: (() => {
    const ms = toMillis(data.createdAt)
    return ms == null ? null : new Date(ms)
  })(),
  updatedAt: (() => {
    const ms = toMillis(data.updatedAt)
    return ms == null ? null : new Date(ms)
  })(),
  lastLoginAt: (() => {
    const ms = toMillis(data.lastLoginAt)
    return ms == null ? null : new Date(ms)
  })(),
})

// ---------------------------------------------------------------------------
// Candidate discovery
// ---------------------------------------------------------------------------

interface LoadedDoc {
  id: string
  data: RawUserData
  candidate: CandidateUserDoc
}

async function loadCandidatesForPhone(db: Firestore, phone: string): Promise<LoadedDoc[]> {
  const clean = normalizePhone(phone)
  const variants = [clean, `+91${clean}`, `91${clean}`, `0${clean}`]
  const found = new Map<string, LoadedDoc>()

  // 1. Field lookups across common phone field names
  const fields = ['phone', 'phoneNumber', 'mobile']
  for (const field of fields) {
    for (const v of variants) {
      const snap = await db.collection('users').where(field, '==', v).get()
      snap.forEach((d) => {
        if (!found.has(d.id)) {
          const data = d.data() as RawUserData
          found.set(d.id, { id: d.id, data, candidate: toCandidate(d.id, data) })
        }
      })
    }
  }

  // 2. Doc-id lookups (phone-as-id, offline_<phone>, member_<phone>)
  const idCandidates = [clean, `offline_${clean}`, `member_${clean}`]
  for (const id of idCandidates) {
    if (found.has(id)) continue
    const d = await db.doc(`users/${id}`).get()
    if (d.exists) {
      const data = d.data() as RawUserData
      // Only include if the phone actually matches (avoid false positive
      // where a user with id "offline_<otherPhone>" has no phone field).
      const docPhone =
        normalizePhone(asString(data.phone)) ||
        normalizePhone(asString(data.phoneNumber)) ||
        normalizePhone(asString(data.mobile)) ||
        // If the id itself encodes a phone and there's no explicit field,
        // trust the id.
        (id === clean || id === `offline_${clean}` || id === `member_${clean}` ? clean : '')
      if (docPhone === clean) {
        found.set(d.id, { id: d.id, data, candidate: toCandidate(d.id, data) })
      }
    }
  }

  return Array.from(found.values())
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

type LedgerState =
  | 'started'
  | 'backed_up'
  | 'merged'
  | 'fk_rewritten'
  | 'deleted'
  | 'verified'
  | 'FAILED'
  | 'SKIPPED'

async function writeLedger(
  db: Firestore,
  runId: string,
  phone: string,
  state: LedgerState,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (DRY_RUN) return
  await db.doc(`_dedupRuns/${runId}/phones/${phone}`).set(
    {
      state,
      updatedAt: FieldValue.serverTimestamp(),
      ...extra,
    },
    { merge: true },
  )
}

async function readLedger(
  db: Firestore,
  runId: string,
  phone: string,
): Promise<LedgerState | null> {
  const snap = await db.doc(`_dedupRuns/${runId}/phones/${phone}`).get()
  if (!snap.exists) return null
  return (snap.data()?.state as LedgerState) ?? null
}

// ---------------------------------------------------------------------------
// Subcollection utilities
// ---------------------------------------------------------------------------

async function listSubcollectionDocs(
  db: Firestore,
  userId: string,
  subcol: string,
): Promise<DocumentSnapshot[]> {
  const snap = await db.collection(`users/${userId}/${subcol}`).get()
  return snap.docs
}

async function listAllSubcollectionsForUser(db: Firestore, userId: string): Promise<string[]> {
  const ref = db.doc(`users/${userId}`)
  const cols = await ref.listCollections()
  return cols.map((c) => c.id)
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

interface DocDump {
  path: string
  exists: boolean
  data: Record<string, unknown> | null
}

interface UserTreeDump {
  userId: string
  root: DocDump
  subcollections: Record<string, DocDump[]>
}

const dumpRef = async (ref: DocumentReference): Promise<DocDump> => {
  const snap = await ref.get()
  return {
    path: ref.path,
    exists: snap.exists,
    data: snap.exists ? (snap.data() as Record<string, unknown>) : null,
  }
}

async function dumpUserTree(db: Firestore, userId: string): Promise<UserTreeDump> {
  const rootRef = db.doc(`users/${userId}`)
  const root = await dumpRef(rootRef)
  const subs = await listAllSubcollectionsForUser(db, userId)
  const subcollections: Record<string, DocDump[]> = {}
  for (const sub of subs) {
    const docs = await listSubcollectionDocs(db, userId, sub)
    subcollections[sub] = docs.map((d) => ({
      path: d.ref.path,
      exists: true,
      data: d.data() as Record<string, unknown>,
    }))
  }
  return { userId, root, subcollections }
}

interface BackupRecord {
  runId: string
  phone: string
  timestamp: string
  canonicalId: string
  duplicateIds: string[]
  trees: UserTreeDump[]
}

function writeBackup(record: BackupRecord): void {
  const outDir = path.dirname(path.resolve(BACKUP_PATH))
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  // Append-safe: load existing, add this record, rewrite.
  let existing: { records: BackupRecord[] } = { records: [] }
  if (fs.existsSync(BACKUP_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf-8'))
      if (!existing.records) existing.records = []
    } catch {
      existing = { records: [] }
    }
  }
  existing.records.push(record)
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(existing, null, 2))
}

// ---------------------------------------------------------------------------
// Merge primitives
// ---------------------------------------------------------------------------

async function computeWalletTotals(
  db: Firestore,
  allDocs: LoadedDoc[],
): Promise<{
  expectedBalance: number
  breakdown: Array<{ id: string; sub: number; root: number }>
}> {
  const breakdown: Array<{ id: string; sub: number; root: number }> = []
  let total = 0
  for (const d of allDocs) {
    const root = asNumber(d.data.walletBalance)
    let sub = 0
    try {
      const snap = await db.doc(`users/${d.id}/wallet/data`).get()
      if (snap.exists) sub = asNumber(snap.data()?.balance)
    } catch {
      /* ignore */
    }
    breakdown.push({ id: d.id, sub, root })
    total += sub + root
  }
  return { expectedBalance: total, breakdown }
}

function mergeRootFields(
  canonical: RawUserData,
  dupes: RawUserData[],
  expectedBalance: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  // Prefer canonical non-null; fall back to first non-null dup value.
  const keys = new Set<string>()
  ;[canonical, ...dupes].forEach((d) => Object.keys(d).forEach((k) => keys.add(k)))

  for (const key of keys) {
    // Skip known computed/per-doc fields — we don't want to stamp them from a
    // duplicate on top of canonical.
    if (key === 'walletBalance') continue // handled below
    if (key === 'id') continue

    const canonicalVal = canonical[key]
    const canonicalHasValue =
      canonicalVal !== undefined && canonicalVal !== null && canonicalVal !== ''

    if (canonicalHasValue) {
      out[key] = canonicalVal
      continue
    }
    for (const d of dupes) {
      const v = d[key]
      if (v !== undefined && v !== null && v !== '') {
        out[key] = v
        break
      }
    }
  }

  // Bump createdAt backward to earliest across all docs.
  const allCreated = [canonical, ...dupes]
    .map((d) => toMillis(d.createdAt))
    .filter((v): v is number => v != null)
  if (allCreated.length > 0) {
    out.createdAt = Timestamp.fromMillis(Math.min(...allCreated))
  }
  out.updatedAt = FieldValue.serverTimestamp()

  // Root `walletBalance` is a denormalized mirror of
  // `users/{id}/wallet/data.balance` that the pipeline admin reads for its
  // list/detail views (see parseCustomer in asquare-customers.ts). Keep it
  // in sync with the merged total here so a future dedup run doesn't leave
  // the admin display stuck on ₹0. walletService and creditCustomerWallet
  // now maintain this mirror atomically on every ongoing change.
  out.walletBalance = expectedBalance

  return out
}

async function writeCanonicalWalletAndAuditTx(
  db: Firestore,
  canonicalId: string,
  expectedBalance: number,
  breakdown: Array<{ id: string; sub: number; root: number }>,
): Promise<void> {
  if (DRY_RUN) {
    log(`  wallet/data on ${canonicalId} → balance=${expectedBalance}`, breakdown)
    return
  }

  await db.doc(`users/${canonicalId}/wallet/data`).set(
    {
      balance: expectedBalance,
      lastUpdated: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  // Synthetic audit transactions, one per non-canonical contributor with
  // non-zero balance.
  for (const entry of breakdown) {
    if (entry.id === canonicalId) continue
    const contributed = entry.sub + entry.root
    if (contributed <= 0) continue
    const txId = `merge-${RUN_ID}-${shortId(entry.id)}`
    await db.doc(`users/${canonicalId}/wallet_transactions/${txId}`).set({
      type: 'merge_credit',
      amount: contributed,
      description: `Merged ₹${contributed} from legacy doc ${entry.id}`,
      source: entry.id,
      timestamp: FieldValue.serverTimestamp(),
    })
  }
}

async function moveSubcollection(
  db: Firestore,
  canonicalId: string,
  oldId: string,
  subcol: string,
): Promise<number> {
  const docs = await listSubcollectionDocs(db, oldId, subcol)
  if (docs.length === 0) return 0

  // Figure out canonical's existing ids to detect collisions.
  const existingCanonical = new Set<string>()
  ;(await listSubcollectionDocs(db, canonicalId, subcol)).forEach((d) =>
    existingCanonical.add(d.id),
  )

  let moved = 0
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE)
    const batch = db.batch()
    for (const d of chunk) {
      let targetId = d.id
      const collides = existingCanonical.has(targetId)
      if (collides) {
        if (subcol === 'bookings') {
          // Canonical wins for bookings — skip the dup's copy entirely.
          continue
        }
        if (subcol === 'coupons') {
          // Pick higher usage_count/uses_remaining; if dup loses, skip.
          const oldData = d.data() ?? {}
          const canonicalDoc = await db.doc(`users/${canonicalId}/${subcol}/${d.id}`).get()
          const canonicalData = canonicalDoc.data() ?? {}
          const oldScore =
            asNumber((oldData as Record<string, unknown>).uses_remaining) +
            asNumber((oldData as Record<string, unknown>).usage_count)
          const canonicalScore =
            asNumber((canonicalData as Record<string, unknown>).uses_remaining) +
            asNumber((canonicalData as Record<string, unknown>).usage_count)
          if (canonicalScore >= oldScore) continue
          // Otherwise overwrite (dup wins) — fall through to write.
        } else {
          // wallet_transactions / tire_transactions: rename with merged suffix.
          targetId = `${d.id}-merged-${shortId(oldId)}`
        }
      }
      const target = db.doc(`users/${canonicalId}/${subcol}/${targetId}`)
      batch.set(target, d.data() ?? {}, { merge: false })
      moved++
    }
    if (!DRY_RUN) await batch.commit()
  }
  return moved
}

async function rewriteForeignKey(
  db: Firestore,
  collection: string,
  oldId: string,
  canonicalId: string,
): Promise<number> {
  const snap = await db.collection(collection).where('userId', '==', oldId).get()
  if (snap.empty) return 0

  let updated = 0
  const docs = snap.docs
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE)
    const batch = db.batch()
    for (const d of chunk) {
      batch.update(d.ref, {
        userId: canonicalId,
        userIdMergedFrom: oldId,
        userIdMergedAt: FieldValue.serverTimestamp(),
      })
      updated++
    }
    if (!DRY_RUN) await batch.commit()
  }
  return updated
}

async function deleteCollection(db: Firestore, collectionPath: string): Promise<number> {
  let deleted = 0
  // Loop until the collection is empty — pagination safety.
  // Cap at 50 iterations to avoid runaway loops.
  for (let iter = 0; iter < 50; iter++) {
    const snap = await db.collection(collectionPath).limit(BATCH_SIZE).get()
    if (snap.empty) break
    if (DRY_RUN) {
      return snap.size // approximate
    }
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
    deleted += snap.size
    if (snap.size < BATCH_SIZE) break
  }
  return deleted
}

async function deleteUserTree(db: Firestore, userId: string): Promise<void> {
  const subs = await listAllSubcollectionsForUser(db, userId)
  for (const sub of subs) {
    await deleteCollection(db, `users/${userId}/${sub}`)
  }
  if (DRY_RUN) {
    log(`  (dry) would delete users/${userId}`)
    return
  }
  await db.doc(`users/${userId}`).delete()
}

async function writePhoneToUid(
  db: Firestore,
  phone: string,
  canonicalId: string,
  mergedFrom: string[],
): Promise<void> {
  if (DRY_RUN) {
    log(`  phoneToUid/${phone} → ${canonicalId} (merged from ${mergedFrom.join(', ')})`)
    return
  }
  await db.doc(`phoneToUid/${phone}`).set(
    {
      uid: canonicalId,
      source: 'dedup',
      mergedAt: FieldValue.serverTimestamp(),
      mergedFrom,
    },
    { merge: true },
  )
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

interface VerifyResult {
  ok: boolean
  errors: string[]
}

async function verifyMerge(
  db: Firestore,
  phone: string,
  canonicalId: string,
  oldIds: string[],
  expectedBalance: number,
): Promise<VerifyResult> {
  const errors: string[] = []

  const canonicalSnap = await db.doc(`users/${canonicalId}`).get()
  if (!canonicalSnap.exists) {
    errors.push(`canonical users/${canonicalId} does not exist`)
  }

  const walletSnap = await db.doc(`users/${canonicalId}/wallet/data`).get()
  const actualBalance = walletSnap.exists ? asNumber(walletSnap.data()?.balance) : 0
  if (actualBalance !== expectedBalance) {
    errors.push(`wallet balance mismatch: expected ${expectedBalance}, got ${actualBalance}`)
  }

  for (const oldId of oldIds) {
    const snap = await db.doc(`users/${oldId}`).get()
    if (snap.exists) errors.push(`users/${oldId} still exists`)
    const subs = await listAllSubcollectionsForUser(db, oldId)
    if (subs.length > 0) {
      errors.push(`users/${oldId} has residual subcollections: ${subs.join(', ')}`)
    }
  }

  for (const col of FK_COLLECTIONS) {
    for (const oldId of oldIds) {
      const s = await db.collection(col).where('userId', '==', oldId).limit(1).get()
      if (!s.empty) {
        errors.push(`${col} still has userId==${oldId}`)
      }
    }
  }

  const indexSnap = await db.doc(`phoneToUid/${phone}`).get()
  if (!indexSnap.exists || indexSnap.data()?.uid !== canonicalId) {
    errors.push(
      `phoneToUid/${phone} is ${indexSnap.data()?.uid ?? 'missing'}, expected ${canonicalId}`,
    )
  }

  return { ok: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Per-phone orchestrator
// ---------------------------------------------------------------------------

async function processPhone(db: Firestore, rawPhone: string): Promise<'ok' | 'skipped' | 'error'> {
  const phone = normalizePhone(rawPhone)
  if (!phone) {
    warn(`skip invalid phone: ${rawPhone}`)
    return 'skipped'
  }

  const prior = await readLedger(db, RUN_ID, phone)
  if (prior === 'verified') {
    log(`phone ${phone} already verified in run ${RUN_ID}, skipping`)
    return 'skipped'
  }

  log(`\n=== phone ${phone} ===`)
  await writeLedger(db, RUN_ID, phone, 'started')

  const loaded = await loadCandidatesForPhone(db, phone)
  if (loaded.length === 0) {
    warn(`no docs found for phone ${phone}`)
    await writeLedger(db, RUN_ID, phone, 'SKIPPED', { reason: 'no-docs' })
    return 'skipped'
  }

  log(`  loaded ${loaded.length} doc(s): ${loaded.map((d) => d.id).join(', ')}`)

  const result: PickCanonicalResult = pickCanonical(loaded.map((d) => d.candidate))
  switch (result.kind) {
    case 'skip-no-customers':
    case 'skip-staff-only':
      log(`  → ${result.kind}, skipping`)
      await writeLedger(db, RUN_ID, phone, 'SKIPPED', { reason: result.kind })
      return 'skipped'
    case 'error-role-has-wallet':
      warn(`  → ERROR: staff doc with wallet: ${result.offenders.map((o) => o.id).join(', ')}`)
      await writeLedger(db, RUN_ID, phone, 'FAILED', {
        reason: 'role-has-wallet',
        offenders: result.offenders.map((o) => o.id),
      })
      return 'error'
    case 'picked':
      break
  }

  const canonicalId = result.canonical.id
  const canonicalLoaded = loaded.find((d) => d.id === canonicalId)
  if (!canonicalLoaded) {
    warn(`canonical ${canonicalId} missing from loaded set — internal error`)
    return 'error'
  }

  // Duplicates = non-staff, non-canonical docs (staff docs are skipped
  // entirely, customer dups are merged).
  const dupsLoaded = loaded.filter((d) => d.id !== canonicalId && !d.data.role)
  const staffLoaded = loaded.filter((d) => !!d.data.role)
  if (staffLoaded.length > 0) {
    log(
      `  staff docs present (will NOT touch): ${staffLoaded
        .map((d) => `${d.id}(${d.data.role})`)
        .join(', ')}`,
    )
  }

  // Compute wallet sum across canonical + all customer duplicates
  const walletContributors = [canonicalLoaded, ...dupsLoaded]
  const { expectedBalance, breakdown } = await computeWalletTotals(db, walletContributors)
  log(`  expected merged wallet balance: ₹${expectedBalance}`, breakdown)

  if (dupsLoaded.length === 0) {
    log('  no customer duplicates to merge; ensuring phoneToUid is set')
    await writePhoneToUid(db, phone, canonicalId, [])
    await writeLedger(db, RUN_ID, phone, 'verified', { noop: true })
    return 'ok'
  }

  // 1. Back up
  log(`  backing up ${loaded.length} user trees to ${BACKUP_PATH}`)
  if (!DRY_RUN) {
    const trees: UserTreeDump[] = []
    for (const d of loaded) {
      trees.push(await dumpUserTree(db, d.id))
    }
    writeBackup({
      runId: RUN_ID,
      phone,
      timestamp: new Date().toISOString(),
      canonicalId,
      duplicateIds: dupsLoaded.map((d) => d.id),
      trees,
    })
  }
  await writeLedger(db, RUN_ID, phone, 'backed_up')

  // 2. Merge root fields (passes `expectedBalance` so the denormalized
  // `walletBalance` root mirror is set alongside the subcollection write).
  const mergedRoot = mergeRootFields(
    canonicalLoaded.data,
    dupsLoaded.map((d) => d.data),
    expectedBalance,
  )
  log(`  writing merged root fields to users/${canonicalId}`)
  if (!DRY_RUN) {
    await db.doc(`users/${canonicalId}`).set(mergedRoot, { merge: true })
  }

  // 3. Write canonical wallet + synthetic audit tx
  await writeCanonicalWalletAndAuditTx(db, canonicalId, expectedBalance, breakdown)

  // 4. Move subcollection contents
  for (const dup of dupsLoaded) {
    for (const sub of MOVABLE_SUBCOLLECTIONS) {
      const moved = await moveSubcollection(db, canonicalId, dup.id, sub)
      if (moved > 0) log(`  moved ${moved} ${sub} doc(s) from ${dup.id}`)
    }
  }
  await writeLedger(db, RUN_ID, phone, 'merged')

  // 5. Rewrite top-level FKs
  for (const dup of dupsLoaded) {
    for (const col of FK_COLLECTIONS) {
      const n = await rewriteForeignKey(db, col, dup.id, canonicalId)
      if (n > 0) log(`  rewrote ${n} ${col}.userId from ${dup.id} → ${canonicalId}`)
    }
  }
  await writeLedger(db, RUN_ID, phone, 'fk_rewritten')

  // 6. phoneToUid index
  await writePhoneToUid(
    db,
    phone,
    canonicalId,
    dupsLoaded.map((d) => d.id),
  )

  // 7. Delete duplicate trees
  for (const dup of dupsLoaded) {
    log(`  deleting users/${dup.id} and all subcollections`)
    await deleteUserTree(db, dup.id)
  }
  await writeLedger(db, RUN_ID, phone, 'deleted')

  // 8. Verify (skip in dry-run — nothing actually changed)
  if (DRY_RUN) {
    log('  (dry) skipping verification')
    return 'ok'
  }

  const verifyRes = await verifyMerge(
    db,
    phone,
    canonicalId,
    dupsLoaded.map((d) => d.id),
    expectedBalance,
  )
  if (verifyRes.ok) {
    log('  ✓ verified')
    await writeLedger(db, RUN_ID, phone, 'verified', {
      canonicalId,
      mergedFrom: dupsLoaded.map((d) => d.id),
      expectedBalance,
    })
    return 'ok'
  }
  warn(`  verification FAILED: ${verifyRes.errors.join('; ')}`)
  await writeLedger(db, RUN_ID, phone, 'FAILED', {
    reason: 'verification',
    errors: verifyRes.errors,
  })
  return 'error'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function resolvePhoneList(db: Firestore): Promise<string[]> {
  if (SINGLE_PHONE) return [normalizePhone(SINGLE_PHONE)]

  // --all mode: scan users once and return phones that have >=2 docs
  // (same logic as audit, inlined to avoid re-reading the audit JSON).
  console.log('Scanning users for duplicate phones...')
  const snap = await db.collection('users').get()
  const byPhone = new Map<string, number>()
  for (const d of snap.docs) {
    const data = d.data() as RawUserData
    const raw = asString(data.phone) ?? asString(data.phoneNumber) ?? asString(data.mobile)
    const phone = normalizePhone(raw)
    if (!phone || phone.length !== 10) continue
    byPhone.set(phone, (byPhone.get(phone) ?? 0) + 1)
  }
  const dups = Array.from(byPhone.entries())
    .filter(([, n]) => n >= 2)
    .map(([p]) => p)
    .sort()
  console.log(`Found ${dups.length} phones with >1 doc (includes staff-collisions).\n`)
  return dups
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE)

  console.log(
    `\n${DRY_RUN ? 'DRY-RUN' : 'REAL RUN'} — run id: ${RUN_ID}\n` +
      `database: ${DATABASE}\n` +
      `backup:   ${BACKUP_PATH}\n`,
  )
  if (!DRY_RUN) {
    console.log('*** WRITES ENABLED — --confirm was passed ***\n')
  }

  const phones = await resolvePhoneList(db)
  const limited = LIMIT > 0 && phones.length > LIMIT ? phones.slice(0, LIMIT) : phones

  const stats = { ok: 0, skipped: 0, error: 0 }
  for (const phone of limited) {
    try {
      const r = await processPhone(db, phone)
      stats[r]++
    } catch (err) {
      console.error(`processPhone(${phone}) threw:`, err)
      stats.error++
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('DEDUP SUMMARY')
  console.log('='.repeat(70))
  console.log(`  run id:   ${RUN_ID}`)
  console.log(`  mode:     ${DRY_RUN ? 'DRY-RUN' : 'REAL RUN'}`)
  console.log(`  phones:   ${limited.length}`)
  console.log(`  ok:       ${stats.ok}`)
  console.log(`  skipped:  ${stats.skipped}`)
  console.log(`  errors:   ${stats.error}`)
  if (!DRY_RUN) console.log(`  backup:   ${BACKUP_PATH}`)
  console.log('='.repeat(70))

  if (stats.error > 0) process.exit(2)
}

main().catch((err) => {
  console.error('dedup-users failed:', err)
  process.exit(1)
})
