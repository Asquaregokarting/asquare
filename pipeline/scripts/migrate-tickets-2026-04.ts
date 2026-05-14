import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const COLLECTION = 'pipeline-tickets'

export interface RawTicket {
  schemaVersion?: number
  issue?: string
  title?: string
  description?: string
  categoryId?: string
  priority?: string
  tags?: string[]
  status?: string
  role?: string
  raisedBy?: string
  raisedByName?: string
  raisedByKind?: string
  location?: string
  locationDisplayName?: string
  branchId?: string
  branchDisplayName?: string
  assignedToId?: string
  assignedToName?: string
  assigneeId?: string
  assigneeName?: string
  assigneeRole?: string
  watcherIds?: string[]
  attachments?: unknown[]
  linkedEntities?: unknown[]
  autoContext?: unknown
  slaSnapshot?: unknown
  responseDueAt?: unknown
  resolveDueAt?: unknown
  firstResponseAt?: unknown
  resolvedAt?: unknown
  resolutionNote?: unknown
  rootCauseTag?: unknown
  escalationLevel?: number
  mergedInto?: unknown
  reopenedFrom?: unknown
}

export interface V2Patch {
  schemaVersion: 2
  title: string
  description: string
  categoryId: string
  priority: 'Normal'
  tags: string[]
  raisedByKind: 'staff' | 'customer'
  branchId: string
  branchDisplayName: string
  assigneeId: string
  assigneeRole: 'Developer'
  assigneeName: string
  watcherIds: string[]
  attachments: unknown[]
  linkedEntities: unknown[]
  autoContext: Record<string, unknown>
  slaSnapshot: null
  responseDueAt: null
  resolveDueAt: null
  firstResponseAt: null
  resolvedAt: null
  resolutionNote: null
  rootCauseTag: null
  escalationLevel: number
  mergedInto: null
  reopenedFrom: null
}

export function buildV2Patch(doc: RawTicket): V2Patch | null {
  if (doc.schemaVersion === 2) return null

  const issue = typeof doc.issue === 'string' ? doc.issue : ''
  const title =
    (typeof doc.title === 'string' && doc.title) || issue.slice(0, 80) || 'Untitled ticket'
  const description = (typeof doc.description === 'string' && doc.description) || issue

  const branchId = (typeof doc.branchId === 'string' && doc.branchId) || (doc.location ?? '')
  const branchDisplayName =
    (typeof doc.branchDisplayName === 'string' && doc.branchDisplayName) ||
    (doc.locationDisplayName ?? '')

  return {
    schemaVersion: 2,
    title,
    description,
    categoryId: doc.categoryId ?? 'other',
    priority: 'Normal',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    raisedByKind: doc.raisedByKind === 'customer' ? 'customer' : 'staff',
    branchId,
    branchDisplayName,
    assigneeId: doc.assigneeId ?? doc.assignedToId ?? '',
    assigneeRole: 'Developer',
    assigneeName: doc.assigneeName ?? doc.assignedToName ?? 'Developer',
    watcherIds: Array.isArray(doc.watcherIds) ? doc.watcherIds : [],
    attachments: Array.isArray(doc.attachments) ? doc.attachments : [],
    linkedEntities: Array.isArray(doc.linkedEntities) ? doc.linkedEntities : [],
    autoContext:
      typeof doc.autoContext === 'object' && doc.autoContext !== null
        ? (doc.autoContext as Record<string, unknown>)
        : {},
    slaSnapshot: null,
    responseDueAt: null,
    resolveDueAt: null,
    firstResponseAt: null,
    resolvedAt: null,
    resolutionNote: null,
    rootCauseTag: null,
    escalationLevel: typeof doc.escalationLevel === 'number' ? doc.escalationLevel : 0,
    mergedInto: null,
    reopenedFrom: null,
  }
}

async function main() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path.')
    process.exit(1)
  }
  const serviceAccount = JSON.parse(readFileSync(resolve(credPath), 'utf8'))
  const dryRun = process.argv.includes('--dry-run')

  if (getApps().length === 0) {
    initializeApp({ credential: cert(serviceAccount) })
  }
  const db = getFirestore('asquare-app-db')

  const snap = await db.collection(COLLECTION).get()
  let migrated = 0
  let skipped = 0

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as RawTicket
    const patch = buildV2Patch(data)
    if (!patch) {
      skipped += 1
      continue
    }
    if (dryRun) {
      console.log(`[dry-run] would migrate ${docSnap.id} → schemaVersion=2`)
    } else {
      // updatedAt is intentionally NOT bumped — preserve original "last activity" time.
      await docSnap.ref.update(patch as Record<string, unknown>)
    }
    migrated += 1
  }

  console.log(
    `migrate-tickets-2026-04: migrated=${migrated} skipped=${skipped} total=${snap.size} dryRun=${dryRun}`,
  )
}

if (process.argv[1] && process.argv[1].endsWith('migrate-tickets-2026-04.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
