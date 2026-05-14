/**
 * Verify that all data from the "pipeline" database exists in "asquare-app-db".
 *
 * Usage:
 *   npx tsx scripts/verify-migration.ts
 *
 * This script compares document counts and checks for any documents in "pipeline"
 * that are missing from "asquare-app-db".
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const SOURCE_DATABASE = 'pipeline'
const TARGET_DATABASE = 'asquare-app-db'

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

const SUBCOLLECTION_MAP: Record<string, string[]> = {
  leads: ['timeline'],
  tasks: ['messages', 'typing', 'readReceipts'],
}

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
    console.log(`Using service account key: ${keyPath}\n`)
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
  } else {
    console.error('No service account key found. See migrate script for instructions.')
    process.exit(1)
  }
}

interface CollectionResult {
  collection: string
  sourceCount: number
  targetCount: number
  missingIds: string[]
}

const verifyCollection = async (
  sourceDb: FirebaseFirestore.Firestore,
  targetDb: FirebaseFirestore.Firestore,
  collectionPath: string,
): Promise<CollectionResult> => {
  const sourceSnap = await sourceDb.collection(collectionPath).get()
  const targetSnap = await targetDb.collection(collectionPath).get()

  const targetIds = new Set(targetSnap.docs.map((d) => d.id))
  const missingIds = sourceSnap.docs.filter((d) => !targetIds.has(d.id)).map((d) => d.id)

  return {
    collection: collectionPath,
    sourceCount: sourceSnap.size,
    targetCount: targetSnap.size,
    missingIds,
  }
}

const main = async () => {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  Migration Verification: pipeline → asquare-app-db     ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  initAdmin()

  const sourceDb = getFirestore(SOURCE_DATABASE)
  const targetDb = getFirestore(TARGET_DATABASE)

  let totalMissing = 0
  let totalSource = 0
  let totalTarget = 0
  const issues: CollectionResult[] = []

  for (const name of TOP_LEVEL_COLLECTIONS) {
    try {
      const result = await verifyCollection(sourceDb, targetDb, name)
      totalSource += result.sourceCount
      totalTarget += result.targetCount

      const status = result.missingIds.length === 0 ? '✅' : '❌'
      const extra = result.missingIds.length > 0 ? ` — ${result.missingIds.length} MISSING` : ''

      console.log(
        `${status} ${name.padEnd(30)} pipeline: ${String(result.sourceCount).padStart(5)}  asquare-app-db: ${String(result.targetCount).padStart(5)}${extra}`,
      )

      if (result.missingIds.length > 0) {
        totalMissing += result.missingIds.length
        issues.push(result)
      }

      // Check subcollections
      const subs = SUBCOLLECTION_MAP[name]
      if (subs) {
        const sourceSnap = await sourceDb.collection(name).get()
        for (const doc of sourceSnap.docs) {
          for (const sub of subs) {
            const subPath = `${name}/${doc.id}/${sub}`
            const subResult = await verifyCollection(sourceDb, targetDb, subPath)
            if (subResult.sourceCount > 0) {
              totalSource += subResult.sourceCount
              totalTarget += subResult.targetCount
              const subStatus = subResult.missingIds.length === 0 ? '  ✅' : '  ❌'
              if (subResult.missingIds.length > 0 || subResult.sourceCount > 0) {
                console.log(
                  `${subStatus} └─ ${subPath.padEnd(28)} pipeline: ${String(subResult.sourceCount).padStart(5)}  asquare-app-db: ${String(subResult.targetCount).padStart(5)}${subResult.missingIds.length > 0 ? ` — ${subResult.missingIds.length} MISSING` : ''}`,
                )
              }
              if (subResult.missingIds.length > 0) {
                totalMissing += subResult.missingIds.length
                issues.push(subResult)
              }
            }
          }
        }
      }
    } catch (error) {
      console.log(`⚠️  ${name.padEnd(30)} Error: ${error instanceof Error ? error.message : error}`)
    }
  }

  console.log('\n══════════════════════════════════════════════════════════')
  console.log(`Total documents in pipeline:       ${totalSource}`)
  console.log(`Total documents in asquare-app-db: ${totalTarget}`)
  console.log(`Missing from target:               ${totalMissing}`)

  if (issues.length === 0) {
    console.log('\n🎉 ALL DATA VERIFIED — Every document in pipeline exists in asquare-app-db.')
    console.log('   It is safe to delete the pipeline database.\n')
  } else {
    console.log(`\n⚠️  ${issues.length} collection(s) have missing documents:\n`)
    for (const issue of issues) {
      console.log(`   ${issue.collection}: ${issue.missingIds.length} missing`)
      if (issue.missingIds.length <= 10) {
        for (const id of issue.missingIds) {
          console.log(`     - ${id}`)
        }
      } else {
        for (const id of issue.missingIds.slice(0, 5)) {
          console.log(`     - ${id}`)
        }
        console.log(`     ... and ${issue.missingIds.length - 5} more`)
      }
    }
    console.log('\nRun the migration script again to copy missing documents:')
    console.log('  npx tsx scripts/migrate-pipeline-to-asquare.ts\n')
  }
  console.log('══════════════════════════════════════════════════════════\n')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
