import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type { TicketActivity, TicketActivityType } from './types'

const COLLECTION = 'pipeline-ticket-activity'

const getCol = () => collection(getAsquareFirestore(), COLLECTION)

function mapActivity(id: string, data: Record<string, unknown>): TicketActivity {
  const toISO = (val: unknown): string => {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && 'toDate' in val)
      return (val as { toDate: () => Date }).toDate().toISOString()
    return new Date().toISOString()
  }
  return {
    id,
    ticketId: String(data.ticketId ?? ''),
    type: (data.type as TicketActivityType) ?? 'created',
    actorId: String(data.actorId ?? ''),
    actorName: String(data.actorName ?? ''),
    payload: (data.payload as Record<string, unknown>) ?? {},
    createdAt: toISO(data.createdAt),
  }
}

export const mapActivityForTest = mapActivity

export interface RecordActivityInput {
  ticketId: string
  type: TicketActivityType
  actorId: string
  actorName: string
  payload?: Record<string, unknown>
}

export async function recordActivity(input: RecordActivityInput): Promise<string> {
  const ref = await addDoc(getCol(), {
    ticketId: input.ticketId,
    type: input.type,
    actorId: input.actorId,
    actorName: input.actorName,
    payload: input.payload ?? {},
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export function subscribeToTicketActivity(
  ticketId: string,
  onData: (rows: TicketActivity[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(getCol(), where('ticketId', '==', ticketId), orderBy('createdAt', 'asc')),
    (snap) => onData(snap.docs.map((d) => mapActivity(d.id, d.data() as Record<string, unknown>))),
    onError,
  )
}
