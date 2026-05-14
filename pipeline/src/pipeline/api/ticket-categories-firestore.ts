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
  type Unsubscribe,
  writeBatch,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type { TicketCategory, CreateTicketCategoryPayload } from './types'
import { DEFAULT_TICKET_CATEGORIES } from './types'
import { logger } from '../../lib/logger'

const COLLECTION = 'pipeline-ticket-categories'

const getCol = () => collection(getAsquareFirestore(), COLLECTION)

function mapCategory(id: string, data: Record<string, unknown>): TicketCategory {
  return {
    id,
    label: String(data.label ?? id),
    priorityFloor: (data.priorityFloor as TicketCategory['priorityFloor']) ?? 'Normal',
    responseSlaSeconds:
      typeof data.responseSlaSeconds === 'number' ? data.responseSlaSeconds : null,
    resolveSlaSeconds:
      typeof data.resolveSlaSeconds === 'number' ? data.resolveSlaSeconds : 24 * 60 * 60,
    routingChain: Array.isArray(data.routingChain)
      ? (data.routingChain as TicketCategory['routingChain'])
      : ['Incharge'],
    active: data.active !== false,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 99,
  }
}

export const mapCategoryForTest = mapCategory

export async function ensureSeedCategories(): Promise<void> {
  const snap = await getDocs(getCol())
  if (snap.size > 0) return
  const batch = writeBatch(getAsquareFirestore())
  for (const c of DEFAULT_TICKET_CATEGORIES) {
    const ref = doc(getCol(), c.id)
    batch.set(ref, { ...c, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  }
  await batch.commit()
  logger.info('ticket_category.seeded', { count: DEFAULT_TICKET_CATEGORIES.length })
}

export function subscribeToTicketCategories(
  onData: (rows: TicketCategory[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(getCol(), orderBy('sortOrder', 'asc')),
    (snap) => onData(snap.docs.map((d) => mapCategory(d.id, d.data() as Record<string, unknown>))),
    onError,
  )
}

export async function upsertCategory(
  id: string,
  payload: CreateTicketCategoryPayload,
): Promise<void> {
  const ref = doc(getCol(), id)
  await setDoc(
    ref,
    {
      ...payload,
      active: payload.active ?? true,
      sortOrder: payload.sortOrder ?? 99,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function setCategoryActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(getCol(), id), { active, updatedAt: serverTimestamp() })
}
