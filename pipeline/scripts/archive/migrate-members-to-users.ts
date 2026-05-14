/**
 * Migration script: Merge members collection data into users collection.
 *
 * For each member document:
 *   - If a user with matching phone exists → merge memberData into that user doc
 *   - If no matching user → create users/member_{phone} with memberData + basic fields
 *   - Write phoneToUid/{phone} index entry in both cases
 *
 * Usage:
 *   npx tsx scripts/migrate-members-to-users.ts
 *
 * Options:
 *   --dry-run   Preview counts without writing anything
 *   --backup    Export members collection to JSON before migrating
 *   --phone=X   Migrate a single member by phone (10 digits) for testing
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DATABASE = 'asquare-app-db'
const BATCH_SIZE = 400

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const BACKUP = args.includes('--backup')
const singlePhoneArg = args.find((a) => a.startsWith('--phone='))
const SINGLE_PHONE = singlePhoneArg?.split('=')[1] ?? null

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

const normalizePhone = (raw: string): string => String(raw).replace(/\D/g, '').slice(-10)

interface MemberDoc {
  id: string
  mobile: string
  name: string
  email: string
  membership: string
  totalVisits: number
  totalBillAmount: number
  walletBalance: number
  starStatus: string | number
  coupons150Redeemed: number
  lastFollowup: unknown
  remarksHistory: unknown[]
  syncedAt: unknown
}

const parseMemberDoc = (id: string, data: Record<string, unknown>): MemberDoc => ({
  id,
  mobile: String(data.mobile ?? ''),
  name: String(data.name ?? ''),
  email: String(data.email ?? ''),
  membership: String(data.membership ?? ''),
  totalVisits: Number(data.totalVisits ?? 0),
  totalBillAmount: Number(data.totalBillAmount ?? 0),
  walletBalance: Number(data.walletBalance ?? 0),
  starStatus: data.starStatus ?? '0',
  coupons150Redeemed: Number(data.coupons150Redeemed ?? 0),
  lastFollowup: data.lastFollowup ?? null,
  remarksHistory: Array.isArray(data.remarksHistory) ? data.remarksHistory : [],
  syncedAt: data.syncedAt ?? null,
})

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

interface Stats {
  total: number
  matched: number
  memberOnly: number
  skipped: number
  errors: number
}

const run = async () => {
  initAdmin()
  const db = getFirestore(DATABASE)

  console.log(`\n${'='.repeat(60)}`)
  console.log(`  Members → Users Migration ${DRY_RUN ? '(DRY RUN)' : ''}`)
  console.log(`  Database: ${DATABASE}`)
  console.log(`${'='.repeat(60)}\n`)

  // Phase 0: Backup (optional)
  if (BACKUP) {
    console.log('Phase 0: Backing up members collection...')
    const membersSnap = await db.collection('members').get()
    const backupData: Record<string, unknown> = {}
    membersSnap.forEach((doc) => {
      backupData[doc.id] = doc.data()
    })
    const backupPath = path.resolve(
      `backups/members-backup-${new Date().toISOString().slice(0, 10)}.json`,
    )
    const backupDir = path.dirname(backupPath)
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2))
    console.log(`  Backed up ${membersSnap.size} members to ${backupPath}\n`)
  }

  // Phase 1: Build phone → UID map from users collection
  console.log('Phase 1: Building phone → UID map from users collection...')
  const usersSnap = await db.collection('users').get()
  const phoneToUid = new Map<string, string>()

  usersSnap.forEach((doc) => {
    const data = doc.data()
    const phone = normalizePhone(data.phone ?? data.phoneNumber ?? data.mobile ?? '')
    if (phone.length === 10) {
      phoneToUid.set(phone, doc.id)
    }
  })
  console.log(`  Found ${usersSnap.size} users, ${phoneToUid.size} with valid phone numbers.\n`)

  // Phase 2: Read members and migrate
  console.log('Phase 2: Migrating members...')
  let membersSnap: FirebaseFirestore.QuerySnapshot
  if (SINGLE_PHONE) {
    const digits = normalizePhone(SINGLE_PHONE)
    const candidates = [digits, `+91${digits}`, `91${digits}`]
    const docs: FirebaseFirestore.QueryDocumentSnapshot[] = []
    for (const id of candidates) {
      const snap = await db.collection('members').doc(id).get()
      if (snap.exists) docs.push(snap as FirebaseFirestore.QueryDocumentSnapshot)
    }
    // Create a mock snapshot-like object
    membersSnap = {
      docs,
      size: docs.length,
      empty: docs.length === 0,
    } as unknown as FirebaseFirestore.QuerySnapshot
    console.log(`  Single phone mode: found ${docs.length} member doc(s) for ${SINGLE_PHONE}`)
  } else {
    membersSnap = await db.collection('members').get()
    console.log(`  Found ${membersSnap.size} member documents.`)
  }

  const stats: Stats = { total: membersSnap.size, matched: 0, memberOnly: 0, skipped: 0, errors: 0 }

  // Process in batches
  const memberDocs = membersSnap.docs
  for (let i = 0; i < memberDocs.length; i += BATCH_SIZE) {
    const chunk = memberDocs.slice(i, i + BATCH_SIZE)
    const batch = db.batch()

    for (const memberSnap of chunk) {
      try {
        const member = parseMemberDoc(memberSnap.id, memberSnap.data() as Record<string, unknown>)
        const digits = normalizePhone(member.mobile)

        if (digits.length !== 10) {
          console.log(`  SKIP: ${member.id} — invalid phone "${member.mobile}"`)
          stats.skipped++
          continue
        }

        const memberData = {
          mobile: member.mobile,
          membership: member.membership,
          totalVisits: member.totalVisits,
          totalBillAmount: member.totalBillAmount,
          memberWalletBalance: member.walletBalance,
          starStatus: member.starStatus,
          coupons150Redeemed: member.coupons150Redeemed,
          lastFollowup: member.lastFollowup,
          remarksHistory: member.remarksHistory,
          syncedAt: member.syncedAt ?? FieldValue.serverTimestamp(),
        }

        const existingUid = phoneToUid.get(digits)

        if (existingUid) {
          // Matched: merge memberData into existing user doc
          const userRef = db.collection('users').doc(existingUid)
          batch.set(userRef, { memberData, memberPhoneId: member.id }, { merge: true })

          // Write phoneToUid index
          batch.set(db.collection('phoneToUid').doc(digits), {
            uid: existingUid,
            source: 'both',
          })

          stats.matched++
        } else {
          // Member-only: create synthetic user doc
          const syntheticId = `member_${digits}`
          const userRef = db.collection('users').doc(syntheticId)
          batch.set(
            userRef,
            {
              displayName: member.name,
              email: member.email,
              phone: member.mobile,
              memberData,
              memberPhoneId: member.id,
              createdAt: member.syncedAt ?? FieldValue.serverTimestamp(),
            },
            { merge: true },
          )

          // Write phoneToUid index
          batch.set(db.collection('phoneToUid').doc(digits), {
            uid: syntheticId,
            source: 'member',
          })

          stats.memberOnly++
        }
      } catch (err) {
        console.error(`  ERROR: ${memberSnap.id}:`, err)
        stats.errors++
      }
    }

    if (!DRY_RUN) {
      await batch.commit()
    }

    const progress = Math.min(i + chunk.length, memberDocs.length)
    console.log(`  ${DRY_RUN ? '[DRY RUN] ' : ''}Processed ${progress}/${memberDocs.length}`)
  }

  // Phase 3: Summary
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  Migration ${DRY_RUN ? '(DRY RUN) ' : ''}Summary`)
  console.log(`${'='.repeat(60)}`)
  console.log(`  Total members:    ${stats.total}`)
  console.log(`  Matched to user:  ${stats.matched}`)
  console.log(`  Member-only:      ${stats.memberOnly}`)
  console.log(`  Skipped:          ${stats.skipped}`)
  console.log(`  Errors:           ${stats.errors}`)
  console.log(`  phoneToUid entries: ${stats.matched + stats.memberOnly}`)
  if (DRY_RUN) {
    console.log(`\n  This was a dry run. No data was written.`)
    console.log(`  Re-run without --dry-run to execute the migration.`)
  }
  console.log()
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
