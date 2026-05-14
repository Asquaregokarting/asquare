import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  serverTimestamp,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type { TicketKbArticle, TicketKbVisibility, CreateTicketKbArticlePayload } from './types'

const COLLECTION = 'pipeline-ticket-kb'

const getCol = () => collection(getAsquareFirestore(), COLLECTION)

function asISO(val: unknown): string {
  if (typeof val === 'string') return val
  if (val && typeof val === 'object' && 'toDate' in val)
    return (val as { toDate: () => Date }).toDate().toISOString()
  return new Date().toISOString()
}

function mapKbArticle(id: string, data: Record<string, unknown>): TicketKbArticle {
  return {
    id,
    title: String(data.title ?? id),
    body: String(data.body ?? ''),
    tags: Array.isArray(data.tags)
      ? data.tags.filter((x): x is string => typeof x === 'string')
      : [],
    visibility: data.visibility === 'customer' ? 'customer' : 'internal',
    active: data.active !== false,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 99,
    createdAt: asISO(data.createdAt),
    updatedAt: asISO(data.updatedAt),
  }
}

export const mapKbArticleForTest = mapKbArticle

export interface KbArticleFilters {
  visibility?: TicketKbVisibility
  activeOnly?: boolean
}

export function subscribeToTicketKbArticles(
  filters: KbArticleFilters | undefined,
  onData: (rows: TicketKbArticle[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(getCol(), orderBy('sortOrder', 'asc')),
    (snap) => {
      const rows = snap.docs.map((d) => mapKbArticle(d.id, d.data() as Record<string, unknown>))
      const filtered = rows.filter((r) => {
        if (filters?.visibility && r.visibility !== filters.visibility) return false
        if (filters?.activeOnly && !r.active) return false
        return true
      })
      onData(filtered)
    },
    onError,
  )
}

export async function upsertKbArticle(
  id: string,
  payload: CreateTicketKbArticlePayload,
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

export async function setKbArticleActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(getCol(), id), { active, updatedAt: serverTimestamp() })
}

export async function getCustomerKbArticles(): Promise<TicketKbArticle[]> {
  const snap = await getDocs(
    query(
      getCol(),
      where('visibility', '==', 'customer'),
      where('active', '==', true),
      orderBy('sortOrder', 'asc'),
    ),
  )
  return snap.docs.map((d) => mapKbArticle(d.id, d.data() as Record<string, unknown>))
}
