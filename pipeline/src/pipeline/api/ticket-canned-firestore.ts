import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type { TicketCannedResponse, CreateTicketCannedPayload } from './types'

const COLLECTION = 'pipeline-ticket-canned-responses'

const getCol = () => collection(getAsquareFirestore(), COLLECTION)

function asISO(val: unknown): string {
  if (typeof val === 'string') return val
  if (val && typeof val === 'object' && 'toDate' in val)
    return (val as { toDate: () => Date }).toDate().toISOString()
  return new Date().toISOString()
}

function mapCanned(id: string, data: Record<string, unknown>): TicketCannedResponse {
  return {
    id,
    title: String(data.title ?? id),
    body: String(data.body ?? ''),
    categoryIds: Array.isArray(data.categoryIds)
      ? data.categoryIds.filter((x): x is string => typeof x === 'string')
      : [],
    active: data.active !== false,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 99,
    createdAt: asISO(data.createdAt),
    updatedAt: asISO(data.updatedAt),
  }
}

export const mapCannedForTest = mapCanned

export function subscribeToCannedResponses(
  onData: (rows: TicketCannedResponse[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(getCol(), orderBy('sortOrder', 'asc')),
    (snap) => onData(snap.docs.map((d) => mapCanned(d.id, d.data() as Record<string, unknown>))),
    onError,
  )
}

export async function upsertCannedResponse(
  id: string,
  payload: CreateTicketCannedPayload,
): Promise<void> {
  const ref = doc(getCol(), id)
  await setDoc(
    ref,
    {
      ...payload,
      active: payload.active ?? true,
      sortOrder: payload.sortOrder ?? 99,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function setCannedResponseActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(getCol(), id), { active, updatedAt: serverTimestamp() })
}
