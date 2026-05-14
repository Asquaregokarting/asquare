import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  doc,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type { TicketNotification, TicketNotificationKind, TicketPriority } from './types'

const COLLECTION = 'pipeline-ticket-notifications'

const getCol = () => collection(getAsquareFirestore(), COLLECTION)

function mapNotification(id: string, data: Record<string, unknown>): TicketNotification {
  const toISO = (val: unknown): string => {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && 'toDate' in val)
      return (val as { toDate: () => Date }).toDate().toISOString()
    return new Date().toISOString()
  }
  return {
    id,
    recipientId: String(data.recipientId ?? ''),
    ticketId: String(data.ticketId ?? ''),
    ticketTitle: String(data.ticketTitle ?? ''),
    kind: (data.kind as TicketNotificationKind) ?? 'status_changed',
    priority: (data.priority as TicketPriority) ?? 'Normal',
    body: String(data.body ?? ''),
    read: data.read === true,
    createdAt: toISO(data.createdAt),
  }
}

export const mapNotificationForTest = mapNotification

export interface CreateNotificationInput {
  recipientId: string
  ticketId: string
  ticketTitle: string
  kind: TicketNotificationKind
  priority: TicketPriority
  body: string
}

export async function createTicketNotification(input: CreateNotificationInput): Promise<string> {
  const ref = await addDoc(getCol(), {
    ...input,
    read: false,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export function subscribeToMyTicketNotifications(
  userId: string,
  onData: (rows: TicketNotification[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(getCol(), where('recipientId', '==', userId), orderBy('createdAt', 'desc'), limit(50)),
    (snap) =>
      onData(snap.docs.map((d) => mapNotification(d.id, d.data() as Record<string, unknown>))),
    onError,
  )
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(getCol(), id), { read: true })
}

export async function markAllRead(userIds: ReadonlyArray<string>): Promise<void> {
  // Caller passes a list of unread notification ids (not user ids — the param name is misleading).
  // Kept simple: callers just iterate updateDoc.
  for (const id of userIds) await markNotificationRead(id)
}
