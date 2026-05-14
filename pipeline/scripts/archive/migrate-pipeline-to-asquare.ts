/**
 * One-time migration script: Copy all data from the "pipeline" database
 * to the "asquare-app-db" database.
 *
 * Usage:
 *   npx tsx scripts/migrate-pipeline-to-asquare.ts
 *
 * Options:
 *   --dry-run     Preview what would be copied without writing anything
 *   --collection  Migrate a single collection (e.g. --collection=vendorDetails)
 *
 * This script:
 *  - Reads every document from every collection in the "pipeline" database
 *  - Writes them to the same collection path in "asquare-app-db"
 *  - Handles subcollections (leads/timeline, tasks/messages, etc.)
 *  - Skips documents that already exist in the target (safe to re-run)
 *  - Logs progress and totals
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SOURCE_DATABASE = 'pipeline'
const TARGET_DATABASE = 'asquare-app-db'

// Top-level collections to migrate (from firestore.pipeline.rules)
const TOP_LEVEL_COLLECTIONS = [
  'users',
  'userProfiles',
  'userSensitiveProfiles',
  'billingTransactions',
  'serialCounters',
  'serialLedger',
  'invoiceAuditLogs',
  'printLogs',
  'helicopterActivities',
  'helicopterPayments',
  'vendorDetails',
  'vendorLedger',
  'vendorRegistrations',
  'vendorInvoices',
  'companyInvoices',
  'shifts',
  'shiftIssues',
  'trackMarshallShifts',
  'leaveRequests',
  'overtimeRequests',
  'leads',
  'leadConfig',
  'leadImportBatches',
  'contacts',
  'superfoneEvents',
  'tasks',
  'taskNotifications',
  'todos',
  'telecallerMonthlyPlans',
  'locations',
  'files',
  'workspaces',
  'notifications',
  'eventCouponNotifications',
  'members',
  'Activities',
  'activityCatalog',
]

// Known subcollections to traverse
const SUBCOLLECTION_MAP: Record<string, string[]> = {
  leads: ['timeline'],
  tasks: ['messages', 'typing', 'readReceipts'],
  // locations subcollections are handled recursively
}

// Locations have a deep hierarchy: locations/{id}/games/{id}/subgames/{id}/variants
const LOCATION_SUBCOLLECTION_CHAIN = ['games', 'subgames', 'variants']

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const singleCollectionArg = args.find((a) => a.startsWith('--collection='))
const SINGLE_COLLECTION = singleCollectionArg?.split('=')[1] ?? null

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
        '\nOr set the GOOGLE_APPLICATION_CREDENTIALS environment variable.\n' +
        '\nDownload from: Firebase Console → Project Settings → Service Accounts → Generate New Private Key\n',
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Migration logic
// ---------------------------------------------------------------------------

interface MigrationStats {
  copied: number
  skipped: number
  errors: number
}

const stats: MigrationStats = { copied: 0, skipped: 0, errors: 0 }

const BATCH_SIZE = 400 // Firestore batch write limit is 500, leave margin

const migrateCollection = async (
  sourceDb: FirebaseFirestore.Firestore,
  targetDb: FirebaseFirestore.Firestore,
  collectionPath: string,
  subcollections?: string[],
): Promise<void> => {
  console.log(`\n📂 ${collectionPath}`)

  const sourceRef = sourceDb.collection(collectionPath)
  const snapshot = await sourceRef.get()

  if (snapshot.empty) {
    console.log(`   (empty — skipping)`)
    return
  }

  console.log(`   ${snapshot.size} documents found`)

  // Write in batches
  let batch = targetDb.batch()
  let batchCount = 0

  for (const doc of snapshot.docs) {
    const targetRef = targetDb.doc(`${collectionPath}/${doc.id}`)

    // Check if target already exists
    const existing = await targetRef.get()
    if (existing.exists) {
      stats.skipped++
      continue
    }

    if (!DRY_RUN) {
      batch.set(targetRef, doc.data())
      batchCount++

      if (batchCount >= BATCH_SIZE) {
        await batch.commit()
        console.log(`   ✓ committed batch of ${batchCount}`)
        batch = targetDb.batch()
        batchCount = 0
      }
    }
    stats.copied++
  }

  // Commit remaining
  if (batchCount > 0 && !DRY_RUN) {
    await batch.commit()
    console.log(`   ✓ committed batch of ${batchCount}`)
  }

  console.log(`   → ${stats.copied} copied so far, ${stats.skipped} skipped`)

  // Handle subcollections
  if (subcollections && subcollections.length > 0) {
    for (const doc of snapshot.docs) {
      for (const sub of subcollections) {
        const subPath = `${collectionPath}/${doc.id}/${sub}`
        await migrateCollection(sourceDb, targetDb, subPath)
      }
    }
  }
}

const migrateLocationHierarchy = async (
  sourceDb: FirebaseFirestore.Firestore,
  targetDb: FirebaseFirestore.Firestore,
  basePath: string,
  chainIndex: number,
): Promise<void> => {
  if (chainIndex >= LOCATION_SUBCOLLECTION_CHAIN.length) return

  const subcollectionName = LOCATION_SUBCOLLECTION_CHAIN[chainIndex]
  const sourceRef = sourceDb.collection(basePath)
  const snapshot = await sourceRef.get()

  if (snapshot.empty) return

  // Copy documents at this level
  let batch = targetDb.batch()
  let batchCount = 0

  for (const doc of snapshot.docs) {
    const targetRef = targetDb.doc(`${basePath}/${doc.id}`)
    const existing = await targetRef.get()

    if (!existing.exists) {
      if (!DRY_RUN) {
        batch.set(targetRef, doc.data())
        batchCount++
        if (batchCount >= BATCH_SIZE) {
          await batch.commit()
          batch = targetDb.batch()
          batchCount = 0
        }
      }
      stats.copied++
    } else {
      stats.skipped++
    }

    // Recurse into next level of the hierarchy
    const nextPath = `${basePath}/${doc.id}/${subcollectionName}`
    await migrateLocationHierarchy(sourceDb, targetDb, nextPath, chainIndex + 1)
  }

  if (batchCount > 0 && !DRY_RUN) {
    await batch.commit()
  }
}

const migrateLocations = async (
  sourceDb: FirebaseFirestore.Firestore,
  targetDb: FirebaseFirestore.Firestore,
): Promise<void> => {
  console.log(`\n📂 locations (with deep subcollections)`)

  const sourceRef = sourceDb.collection('locations')
  const snapshot = await sourceRef.get()

  if (snapshot.empty) {
    console.log(`   (empty — skipping)`)
    return
  }

  console.log(`   ${snapshot.size} location documents found`)

  // Copy the top-level location documents
  let batch = targetDb.batch()
  let batchCount = 0

  for (const doc of snapshot.docs) {
    const targetRef = targetDb.doc(`locations/${doc.id}`)
    const existing = await targetRef.get()

    if (!existing.exists) {
      if (!DRY_RUN) {
        batch.set(targetRef, doc.data())
        batchCount++
        if (batchCount >= BATCH_SIZE) {
          await batch.commit()
          batch = targetDb.batch()
          batchCount = 0
        }
      }
      stats.copied++
    } else {
      stats.skipped++
    }

    // Recurse: locations/{id}/games → games/{id}/subgames → subgames/{id}/variants
    const gamesPath = `locations/${doc.id}/games`
    await migrateLocationHierarchy(sourceDb, targetDb, gamesPath, 1) // start at index 1 (subgames)

    // Also migrate the games level itself
    const gamesSnapshot = await sourceDb.collection(gamesPath).get()
    if (!gamesSnapshot.empty) {
      for (const gameDoc of gamesSnapshot.docs) {
        const gameTargetRef = targetDb.doc(`${gamesPath}/${gameDoc.id}`)
        const gameExisting = await gameTargetRef.get()
        if (!gameExisting.exists) {
          if (!DRY_RUN) {
            batch.set(gameTargetRef, gameDoc.data())
            batchCount++
            if (batchCount >= BATCH_SIZE) {
              await batch.commit()
              batch = targetDb.batch()
              batchCount = 0
            }
          }
          stats.copied++
        } else {
          stats.skipped++
        }
      }
    }
  }

  if (batchCount > 0 && !DRY_RUN) {
    await batch.commit()
  }

  console.log(`   → locations hierarchy migrated`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  Pipeline → Asquare-App-DB Migration Script            ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`\nSource: ${SOURCE_DATABASE}`)
  console.log(`Target: ${TARGET_DATABASE}`)
  if (DRY_RUN) console.log('⚠️  DRY RUN — no data will be written\n')
  if (SINGLE_COLLECTION) console.log(`Migrating single collection: ${SINGLE_COLLECTION}\n`)

  initAdmin()

  const sourceDb = getFirestore(SOURCE_DATABASE)
  const targetDb = getFirestore(TARGET_DATABASE)

  const collections = SINGLE_COLLECTION ? [SINGLE_COLLECTION] : TOP_LEVEL_COLLECTIONS

  for (const collectionName of collections) {
    try {
      if (collectionName === 'locations') {
        await migrateLocations(sourceDb, targetDb)
      } else {
        const subs = SUBCOLLECTION_MAP[collectionName]
        await migrateCollection(sourceDb, targetDb, collectionName, subs)
      }
    } catch (error) {
      stats.errors++
      console.error(
        `   ❌ Error migrating ${collectionName}:`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  console.log('\n══════════════════════════════════════════════════════════')
  console.log('Migration complete!')
  console.log(`  Copied:  ${stats.copied}`)
  console.log(`  Skipped: ${stats.skipped} (already exist in target)`)
  console.log(`  Errors:  ${stats.errors}`)
  if (DRY_RUN) console.log('\n⚠️  This was a DRY RUN — no data was actually written.')
  console.log('══════════════════════════════════════════════════════════\n')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
