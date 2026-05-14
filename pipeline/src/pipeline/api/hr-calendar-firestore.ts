import {
  collection,
  doc,
  DocumentData,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  UpdateData,
  updateDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser } from './firestore-session'
import { nowIso, toOptionalString } from './firestore-utils'
import { HRCalendarEntry, HRCalendarKind, HRCalendarStatus } from './types'

const HR_CALENDAR_COLLECTION = 'hrCalendarEvents'

const toKind = (value: unknown): HRCalendarKind => {
  if (value === 'reminder' || value === 'todo') return value
  return 'event'
}

const toStatus = (value: unknown): HRCalendarStatus => {
  if (value === 'done' || value === 'cancelled') return value
  return 'open'
}

const toVisibility = (value: unknown): HRCalendarEntry['visibility'] => {
  if (value === 'private' || value === 'all') return value
  return 'hr'
}

const toRecurrence = (value: unknown): HRCalendarEntry['recurrence'] => {
  if (value === 'daily' || value === 'weekly' || value === 'monthly') return value
  return 'none'
}

const getCalendarCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, HR_CALENDAR_COLLECTION)
}

const mapEntry = (id: string, data: Record<string, unknown>): HRCalendarEntry => ({
  id,
  kind: toKind(data.kind),
  title: String(data.title ?? 'Untitled'),
  description: toOptionalString(data.description),
  startsAt: String(data.startsAt ?? nowIso()),
  endsAt: toOptionalString(data.endsAt),
  allDay: Boolean(data.allDay ?? false),
  status: toStatus(data.status),
  assignedTo: toOptionalString(data.assignedTo),
  assignedToName: toOptionalString(data.assignedToName),
  visibility: toVisibility(data.visibility),
  recurrence: toRecurrence(data.recurrence),
  reminderMinutesBefore:
    typeof data.reminderMinutesBefore === 'number' ? data.reminderMinutesBefore : undefined,
  branchId: toOptionalString(data.branchId),
  createdBy: String(data.createdBy ?? ''),
  createdByName: String(data.createdByName ?? ''),
  createdAt: String(data.createdAt ?? nowIso()),
  updatedAt: String(data.updatedAt ?? nowIso()),
  completedAt: toOptionalString(data.completedAt),
  deletedAt: toOptionalString(data.deletedAt),
})

export const listHRCalendarEntries = async (filter?: {
  kind?: HRCalendarKind
  status?: HRCalendarStatus
  assignedTo?: string
  fromIso?: string
  toIso?: string
}): Promise<HRCalendarEntry[]> => {
  const coll = getCalendarCollection()
  if (!coll) throw new Error('Firestore HR calendar is not configured.')

  const constraints = []
  if (filter?.kind) constraints.push(where('kind', '==', filter.kind))
  if (filter?.status) constraints.push(where('status', '==', filter.status))
  if (filter?.assignedTo) constraints.push(where('assignedTo', '==', filter.assignedTo))
  constraints.push(orderBy('startsAt', 'desc'))
  constraints.push(limit(500))

  const snapshot = await getDocs(query(coll, ...constraints))
  let entries = snapshot.docs.map((item) =>
    mapEntry(item.id, item.data() as Record<string, unknown>),
  )
  entries = entries.filter((entry) => !entry.deletedAt)
  if (filter?.fromIso) entries = entries.filter((entry) => entry.startsAt >= filter.fromIso!)
  if (filter?.toIso) entries = entries.filter((entry) => entry.startsAt <= filter.toIso!)
  return entries
}

export const createHRCalendarEntry = async (
  token: string,
  payload: {
    kind: HRCalendarKind
    title: string
    description?: string
    startsAt: string
    endsAt?: string
    allDay?: boolean
    assignedTo?: string
    assignedToName?: string
    visibility?: HRCalendarEntry['visibility']
    recurrence?: HRCalendarEntry['recurrence']
    reminderMinutesBefore?: number
    branchId?: string
  },
): Promise<HRCalendarEntry> => {
  const coll = getCalendarCollection()
  if (!coll) throw new Error('Firestore HR calendar is not configured.')

  const sessionUser = await getFirestoreSessionUser(token)
  const id = `hr-cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const now = nowIso()

  const entry: HRCalendarEntry = {
    id,
    kind: payload.kind,
    title: payload.title.trim() || 'Untitled',
    description: payload.description?.trim() || undefined,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    allDay: Boolean(payload.allDay),
    status: 'open',
    assignedTo: payload.assignedTo,
    assignedToName: payload.assignedToName,
    visibility: payload.visibility ?? 'hr',
    recurrence: payload.recurrence ?? 'none',
    reminderMinutesBefore: payload.reminderMinutesBefore,
    branchId: payload.branchId,
    createdBy: sessionUser.id,
    createdByName: sessionUser.name,
    createdAt: now,
    updatedAt: now,
  }

  await setDoc(doc(coll, id), entry)
  return entry
}

export const updateHRCalendarEntryStatus = async (
  entryId: string,
  status: HRCalendarStatus,
): Promise<void> => {
  const coll = getCalendarCollection()
  if (!coll) throw new Error('Firestore HR calendar is not configured.')
  const updates: Record<string, unknown> = { status, updatedAt: nowIso() }
  if (status === 'done') updates.completedAt = nowIso()
  await updateDoc(doc(coll, entryId), updates as UpdateData<DocumentData>)
}

export const softDeleteHRCalendarEntry = async (entryId: string): Promise<void> => {
  const coll = getCalendarCollection()
  if (!coll) throw new Error('Firestore HR calendar is not configured.')
  await updateDoc(doc(coll, entryId), { deletedAt: nowIso(), updatedAt: nowIso() })
}
