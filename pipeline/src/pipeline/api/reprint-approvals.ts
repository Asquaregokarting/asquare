/**
 * Reprint Approval System — non-Owner users must request Owner approval before reprinting.
 *
 * Collection: `reprintApprovals` in the pipeline Firestore database.
 */
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { nowIso } from './firestore-utils'
import type { ReprintApprovalRecord } from './types'

const COLLECTION = 'reprintApprovals'

const getCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, COLLECTION)
}

/** Create a pending reprint approval request. */
export const requestReprintApproval = async (params: {
  transactionId: string
  invoiceNumber: string
  customerName?: string
  customerPhone?: string
  amount: number
  locationId?: string
  requestedBy: string
  requestedByName: string
  requestedByRole: string
}): Promise<string> => {
  const col = getCollection()
  if (!col) throw new Error('Firestore is not configured.')
  const ref = await addDoc(col, {
    ...params,
    status: 'pending',
    requestedAt: nowIso(),
  })
  return ref.id
}

/** Check for an existing pending or approved reprint request for a transaction (prevents duplicates). */
export const getApprovalForTransaction = async (
  transactionId: string,
  requestedBy: string,
): Promise<ReprintApprovalRecord | null> => {
  const col = getCollection()
  if (!col) return null
  const snapshot = await getDocs(
    query(
      col,
      where('transactionId', '==', transactionId),
      where('requestedBy', '==', requestedBy),
    ),
  )
  // Return the first pending or approved request (most recent first)
  const active = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }) as ReprintApprovalRecord)
    .filter((r) => r.status === 'pending' || r.status === 'approved')
    .sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''))
  return active[0] ?? null
}

/** Fetch all pending reprint approval requests. */
export const listPendingReprintApprovals = async (): Promise<ReprintApprovalRecord[]> => {
  const col = getCollection()
  if (!col) return []
  // No orderBy — avoids composite index requirement. Sort client-side.
  const snapshot = await getDocs(query(col, where('status', '==', 'pending')))
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }) as ReprintApprovalRecord)
    .sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''))
}

/** Approve a reprint request. */
export const approveReprint = async (
  id: string,
  reviewer: { reviewedBy: string; reviewedByName: string },
): Promise<void> => {
  const col = getCollection()
  if (!col) throw new Error('Firestore is not configured.')
  await updateDoc(doc(col, id), {
    status: 'approved',
    reviewedBy: reviewer.reviewedBy,
    reviewedByName: reviewer.reviewedByName,
    reviewedAt: nowIso(),
  })
}

/** Reject a reprint request. */
export const rejectReprint = async (
  id: string,
  reviewer: { reviewedBy: string; reviewedByName: string },
): Promise<void> => {
  const col = getCollection()
  if (!col) throw new Error('Firestore is not configured.')
  await updateDoc(doc(col, id), {
    status: 'rejected',
    reviewedBy: reviewer.reviewedBy,
    reviewedByName: reviewer.reviewedByName,
    reviewedAt: nowIso(),
  })
}

/** Real-time subscription for pending reprint approvals (Owner view). Returns unsubscribe fn. */
export const subscribePendingReprintApprovals = (
  onData: (rows: ReprintApprovalRecord[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const col = getCollection()
  if (!col) {
    onData([])
    return () => {}
  }
  return onSnapshot(
    query(col, where('status', '==', 'pending')),
    (snapshot) => {
      const rows = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as ReprintApprovalRecord)
        .sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''))
      onData(rows)
    },
    onError,
  )
}

/** Real-time subscription for a cashier's own pending + approved reprint requests. */
export const subscribeUserReprintApprovals = (
  userId: string,
  onData: (rows: ReprintApprovalRecord[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const col = getCollection()
  if (!col) {
    onData([])
    return () => {}
  }
  return onSnapshot(
    query(col, where('requestedBy', '==', userId)),
    (snapshot) => {
      const rows = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as ReprintApprovalRecord)
        .filter((r) => r.status === 'pending' || r.status === 'approved')
      onData(rows)
    },
    onError,
  )
}

/** Real-time subscription for recent reprint approvals (all statuses). Returns unsubscribe fn. */
export const subscribeRecentReprintApprovals = (
  onData: (rows: ReprintApprovalRecord[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const col = getCollection()
  if (!col) {
    onData([])
    return () => {}
  }
  // IST-aware 4-day cutoff (today + 3 prior days)
  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() + 330)
  cutoff.setDate(cutoff.getDate() - 3)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setMinutes(cutoff.getMinutes() - 330)
  const cutoffISO = cutoff.toISOString()
  return onSnapshot(
    query(col, where('requestedAt', '>=', cutoffISO), orderBy('requestedAt', 'desc'), limit(20)),
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as ReprintApprovalRecord)
      onData(rows)
    },
    onError,
  )
}

/** Mark an approved reprint as completed (after cashier prints). */
export const completeReprint = async (id: string): Promise<void> => {
  const col = getCollection()
  if (!col) throw new Error('Firestore is not configured.')
  await updateDoc(doc(col, id), { status: 'completed', completedAt: nowIso() })
}
