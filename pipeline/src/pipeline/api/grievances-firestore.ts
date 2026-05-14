/**
 * Grievances / Announcements — broadcast messages from Owner/Admin/Developer
 * to a specific pipeline user OR an entire role. Use cases:
 *   • "We hit a bug in Billing — fixed now, please refresh."
 *   • "Cashiers: end-of-day cash count form has changed."
 *   • Targeted DM to a single staff member with no DM channel elsewhere.
 *
 * Storage: `grievances` collection in asquare-app-db.
 *   - One document per message
 *   - `targetType` = 'user' | 'role' | 'all'
 *   - `targetUserId` (when targetType='user') or `targetRole` (when 'role')
 *   - `readBy[uid]` = ISO timestamp — empty until the recipient opens it
 *
 * Read model: each pipeline user queries `grievances` with three OR-able
 * predicates (their uid, their role, the 'all' bucket) and unions client-side.
 * Cheaper than a fan-out write per recipient and there's no per-user
 * notification subcollection to keep in sync.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import { nowIso } from './firestore-utils'
import { logger } from '../../lib/logger'
import type { Role } from './types'

const COLLECTION = 'grievances'

export type GrievanceSeverity = 'info' | 'success' | 'warning' | 'critical'

export type GrievanceTargetType = 'user' | 'role' | 'all'

export interface GrievanceRecord {
  id: string
  title: string
  body: string
  severity: GrievanceSeverity
  targetType: GrievanceTargetType
  /** Target user uid (when targetType === 'user'). */
  targetUserId?: string
  /** Display label for `targetUserId` so the outbox UI doesn't need a join. */
  targetUserName?: string
  /** Target role (when targetType === 'role'). */
  targetRole?: Role
  sentBy: { id: string; name: string; role: string }
  sentAt: string
  /** uid → ISO timestamp of when that user opened the message. */
  readBy: Record<string, string>
}

const parseRecord = (id: string, data: Record<string, unknown>): GrievanceRecord => ({
  id,
  title: String(data.title ?? ''),
  body: String(data.body ?? ''),
  severity: (data.severity as GrievanceSeverity) ?? 'info',
  targetType: (data.targetType as GrievanceTargetType) ?? 'all',
  targetUserId: data.targetUserId ? String(data.targetUserId) : undefined,
  targetUserName: data.targetUserName ? String(data.targetUserName) : undefined,
  targetRole: data.targetRole ? (String(data.targetRole) as Role) : undefined,
  sentBy:
    data.sentBy && typeof data.sentBy === 'object'
      ? (data.sentBy as { id: string; name: string; role: string })
      : { id: 'unknown', name: 'Unknown', role: 'unknown' },
  sentAt: String(data.sentAt ?? ''),
  readBy:
    data.readBy && typeof data.readBy === 'object' ? (data.readBy as Record<string, string>) : {},
})

/**
 * Send a new grievance. Caller must already be Owner/Admin/Developer — the UI
 * gates this, but Firestore rules are permissive so we add a defense-in-depth
 * role check inside the function.
 */
export const sendGrievance = async (params: {
  title: string
  body: string
  severity: GrievanceSeverity
  targetType: GrievanceTargetType
  targetUserId?: string
  targetUserName?: string
  targetRole?: Role
  sentBy: { id: string; name: string; role: string }
}): Promise<string> => {
  const allowedSenderRoles = ['Owner', 'Admin', 'Developer']
  if (!allowedSenderRoles.includes(params.sentBy.role)) {
    throw new Error(
      `Only Owner, Admin, or Developer can send grievances (current role: ${params.sentBy.role}).`,
    )
  }
  if (!params.title.trim()) throw new Error('Title is required.')
  if (!params.body.trim()) throw new Error('Message is required.')
  if (params.targetType === 'user' && !params.targetUserId) {
    throw new Error('Target user is required when sending to a single user.')
  }
  if (params.targetType === 'role' && !params.targetRole) {
    throw new Error('Target role is required when sending to a role.')
  }

  const firestore = getAsquareFirestore()
  const payload: Record<string, unknown> = {
    title: params.title.trim(),
    body: params.body.trim(),
    severity: params.severity,
    targetType: params.targetType,
    sentBy: params.sentBy,
    sentAt: nowIso(),
    readBy: {},
  }
  if (params.targetType === 'user') {
    payload.targetUserId = params.targetUserId
    if (params.targetUserName) payload.targetUserName = params.targetUserName
  }
  if (params.targetType === 'role') {
    payload.targetRole = params.targetRole
  }

  const ref = await addDoc(collection(firestore, COLLECTION), payload)
  logger.info('grievance.sent', {
    id: ref.id,
    targetType: params.targetType,
    targetUserId: params.targetUserId,
    targetRole: params.targetRole,
    sentByRole: params.sentBy.role,
  })
  return ref.id
}

/** Subscribe to grievances visible to a given user (DM + role + all). */
export const subscribeMyGrievances = (
  user: { id: string; role: Role },
  onData: (rows: GrievanceRecord[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const firestore = getAsquareFirestore()
  const base = collection(firestore, COLLECTION)

  const queries = [
    query(base, where('targetUserId', '==', user.id)),
    query(base, where('targetRole', '==', user.role)),
    query(base, where('targetType', '==', 'all')),
  ]

  // Three concurrent listeners, deduped + sorted on the client.
  const buckets: GrievanceRecord[][] = [[], [], []]
  const emit = () => {
    const merged = new Map<string, GrievanceRecord>()
    for (const bucket of buckets) {
      for (const row of bucket) merged.set(row.id, row)
    }
    const list = [...merged.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    onData(list)
  }

  const unsubs = queries.map((q, idx) =>
    onSnapshot(
      q,
      (snap) => {
        buckets[idx] = snap.docs.map((d) => parseRecord(d.id, d.data() as Record<string, unknown>))
        emit()
      },
      onError,
    ),
  )

  return () => {
    for (const u of unsubs) u()
  }
}

/** Subscribe to grievances sent by `userId` (outbox view). */
export const subscribeMyOutbox = (
  userId: string,
  onData: (rows: GrievanceRecord[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const firestore = getAsquareFirestore()
  const q = query(
    collection(firestore, COLLECTION),
    where('sentBy.id', '==', userId),
    orderBy('sentAt', 'desc'),
    limit(100),
  )
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => parseRecord(d.id, d.data() as Record<string, unknown>))
      onData(rows)
    },
    onError,
  )
}

/** Mark a grievance as read by `userId`. Idempotent. */
export const markGrievanceRead = async (id: string, userId: string): Promise<void> => {
  if (!id || !userId) return
  const firestore = getAsquareFirestore()
  try {
    await updateDoc(doc(firestore, COLLECTION, id), {
      [`readBy.${userId}`]: nowIso(),
    })
  } catch (err) {
    logger.error('grievance.mark_read_failed', err, { id, userId })
  }
}

/** One-shot fetch (used by full module page). */
export const listMyGrievances = async (user: {
  id: string
  role: Role
}): Promise<GrievanceRecord[]> => {
  const firestore = getAsquareFirestore()
  const base = collection(firestore, COLLECTION)
  const queries = [
    query(base, where('targetUserId', '==', user.id)),
    query(base, where('targetRole', '==', user.role)),
    query(base, where('targetType', '==', 'all')),
  ]
  const merged = new Map<string, GrievanceRecord>()
  for (const q of queries) {
    const snap = await getDocs(q)
    for (const d of snap.docs) {
      merged.set(d.id, parseRecord(d.id, d.data() as Record<string, unknown>))
    }
  }
  return [...merged.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt))
}

/** Sender deletes their own grievance. */
export const deleteGrievance = async (id: string, requestedBy: string): Promise<void> => {
  if (!id) return
  const firestore = getAsquareFirestore()
  // Fetch first to enforce ownership at the application layer.
  const ref = doc(firestore, COLLECTION, id)
  const snap = await getDocs(query(collection(firestore, COLLECTION), where('__name__', '==', id)))
  if (snap.empty) return
  const data = snap.docs[0].data() as Record<string, unknown>
  const sentBy = (data.sentBy as { id?: string } | undefined) ?? {}
  if (sentBy.id !== requestedBy) {
    throw new Error('Only the sender can delete this message.')
  }
  await deleteDoc(ref)
}

/** Used by tests + admin tools. Not called from UI. */
export const _setGrievanceReadByForTest = async (
  id: string,
  readBy: Record<string, string>,
): Promise<void> => {
  const firestore = getAsquareFirestore()
  await setDoc(doc(firestore, COLLECTION, id), { readBy }, { merge: true })
}
