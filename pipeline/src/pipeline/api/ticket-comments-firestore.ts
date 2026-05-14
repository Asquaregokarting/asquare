import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type { TicketComment, CreateTicketCommentPayload } from './types'
import { recordActivity } from './ticket-activity-firestore'

const COLLECTION = 'pipeline-ticket-comments'
const TICKETS_COLLECTION = 'pipeline-tickets'

const getCol = () => collection(getAsquareFirestore(), COLLECTION)

function mapComment(id: string, data: Record<string, unknown>): TicketComment {
  const toISO = (val: unknown): string => {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && 'toDate' in val)
      return (val as { toDate: () => Date }).toDate().toISOString()
    return new Date().toISOString()
  }
  return {
    id,
    ticketId: String(data.ticketId ?? ''),
    authorId: String(data.authorId ?? ''),
    authorName: String(data.authorName ?? ''),
    authorKind: (data.authorKind as TicketComment['authorKind']) ?? 'staff',
    body: String(data.body ?? ''),
    internal: data.internal === true,
    mentions: Array.isArray(data.mentions)
      ? data.mentions.filter((x): x is string => typeof x === 'string')
      : [],
    createdAt: toISO(data.createdAt),
    updatedAt: toISO(data.updatedAt),
  }
}

export const mapCommentForTest = mapComment

export async function addTicketComment(payload: CreateTicketCommentPayload): Promise<string> {
  const ref = await addDoc(getCol(), {
    ...payload,
    mentions: payload.mentions ?? [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  // Sync mentioned users into the parent ticket's watcherIds so future
  // comments also notify them. The Phase-5 onTicketCommentCreate trigger
  // continues to read `data.mentions` and create the actual notifications.
  if (payload.mentions && payload.mentions.length > 0) {
    const ticketRef = doc(getAsquareFirestore(), TICKETS_COLLECTION, payload.ticketId)
    await updateDoc(ticketRef, {
      watcherIds: arrayUnion(...payload.mentions),
      updatedAt: serverTimestamp(),
    })
  }

  await recordActivity({
    ticketId: payload.ticketId,
    type: 'comment_added',
    actorId: payload.authorId,
    actorName: payload.authorName,
    payload: { commentId: ref.id, internal: payload.internal },
  })
  return ref.id
}

export function subscribeToTicketComments(
  ticketId: string,
  onData: (rows: TicketComment[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(getCol(), where('ticketId', '==', ticketId), orderBy('createdAt', 'asc')),
    (snap) => onData(snap.docs.map((d) => mapComment(d.id, d.data() as Record<string, unknown>))),
    onError,
  )
}
