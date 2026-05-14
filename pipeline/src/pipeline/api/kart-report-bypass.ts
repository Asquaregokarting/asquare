/**
 * Kart-Report Bypass Approvals — cashiers raise a request, Owner approves.
 *
 * Used when Track Marshall hasn't submitted today's kart report but a
 * cashier needs to Check In anyway (e.g. closing a stuck prior-day shift,
 * TM on leave). Mirrors the reprint-approvals pattern: cashier writes a
 * pending doc, Owner's dashboard subscribes via onSnapshot, approve /
 * reject flips status, cashier's popup live-subscribes and grants the
 * session-local override only after `status === 'approved'`.
 *
 * Collection: `kartReportBypassRequests` in `asquare-app-db`.
 */
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { nowIso } from './firestore-utils'
import type { KartReportBypassRequest } from './types'

const COLLECTION = 'kartReportBypassRequests'

const getBypassCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, COLLECTION)
}

/** Cashier raises a pending bypass request. Returns the new request id. */
export const requestKartReportBypass = async (params: {
  locationId: string
  requestedBy: string
  requestedByName: string
  requestedByRole: string
  reason: string
}): Promise<string> => {
  const col = getBypassCollection()
  if (!col) throw new Error('Firestore is not configured.')
  const ref = await addDoc(col, {
    ...params,
    reason: params.reason.trim(),
    status: 'pending' as const,
    requestedAt: nowIso(),
  })
  return ref.id
}

/** Owner approves a pending request. */
export const approveKartReportBypass = async (
  id: string,
  reviewer: { reviewedBy: string; reviewedByName: string; reviewNote?: string },
): Promise<void> => {
  const col = getBypassCollection()
  if (!col) throw new Error('Firestore is not configured.')
  const note = reviewer.reviewNote?.trim()
  await updateDoc(doc(col, id), {
    status: 'approved',
    reviewedBy: reviewer.reviewedBy,
    reviewedByName: reviewer.reviewedByName,
    reviewedAt: nowIso(),
    ...(note ? { reviewNote: note } : {}),
  })
}

/** Owner rejects a pending request. */
export const rejectKartReportBypass = async (
  id: string,
  reviewer: { reviewedBy: string; reviewedByName: string; reviewNote?: string },
): Promise<void> => {
  const col = getBypassCollection()
  if (!col) throw new Error('Firestore is not configured.')
  const note = reviewer.reviewNote?.trim()
  await updateDoc(doc(col, id), {
    status: 'rejected',
    reviewedBy: reviewer.reviewedBy,
    reviewedByName: reviewer.reviewedByName,
    reviewedAt: nowIso(),
    ...(note ? { reviewNote: note } : {}),
  })
}

/**
 * Cashier cancels their own pending request (e.g. closing the popup
 * before Owner responds). Status flips to 'cancelled' so it disappears
 * from the Owner approval queue.
 */
export const cancelKartReportBypass = async (id: string): Promise<void> => {
  const col = getBypassCollection()
  if (!col) throw new Error('Firestore is not configured.')
  await updateDoc(doc(col, id), { status: 'cancelled', reviewedAt: nowIso() })
}

/** Live feed of pending requests for the Owner approval queue. */
export const subscribePendingKartReportBypasses = (
  onData: (rows: KartReportBypassRequest[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const col = getBypassCollection()
  if (!col) {
    onData([])
    return () => {}
  }
  return onSnapshot(
    query(col, where('status', '==', 'pending')),
    (snapshot) => {
      const rows = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as KartReportBypassRequest)
        .sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''))
      onData(rows)
    },
    onError,
  )
}

/**
 * Cashier subscribes to a single request doc to react when the Owner
 * approves or rejects. The popup uses this to flip its state and
 * grant the session-local override only when status === 'approved'.
 */
export const subscribeKartReportBypassRequest = (
  id: string,
  onData: (record: KartReportBypassRequest | null) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const col = getBypassCollection()
  if (!col) {
    onData(null)
    return () => {}
  }
  return onSnapshot(
    doc(col, id),
    (snap) => {
      if (!snap.exists()) {
        onData(null)
        return
      }
      onData({ id: snap.id, ...snap.data() } as KartReportBypassRequest)
    },
    onError,
  )
}
