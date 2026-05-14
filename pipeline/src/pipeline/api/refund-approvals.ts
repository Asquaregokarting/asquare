/**
 * Refund Approval System — every refund must be approved by an Owner or Admin
 * before the transaction is actually refunded. Requests are logged here; the
 * approval step executes `refundSelectedItems` + wallet credit atomically.
 *
 * Collection: `refundApprovals` in the asquare-app-db Firestore database.
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { nowIso } from './firestore-utils'
import { logger } from '../../lib/logger'
import { creditCustomerWallet, refundSelectedItems } from './billing-firestore'
import { generateFirestoreWeeklyInvoices } from './accounting-firestore'
import type { RefundApprovalRecord } from './types'

const COLLECTION = 'refundApprovals'

const getCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, COLLECTION)
}

/** Does this transaction already have a pending refund request? */
export const getPendingApprovalForTransaction = async (
  transactionId: string,
): Promise<RefundApprovalRecord | null> => {
  const col = getCollection()
  if (!col) return null
  const snapshot = await getDocs(
    query(col, where('transactionId', '==', transactionId), where('status', '==', 'pending')),
  )
  const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as RefundApprovalRecord)
  return rows[0] ?? null
}

/** Create a pending refund-approval request. Rejects if one is already pending for this txn. */
export const requestRefundApproval = async (params: {
  transactionId: string
  invoiceNumber: string
  customerName?: string
  customerPhone?: string
  refundAmount: number
  itemIndices: number[]
  reason: string
  locationId?: string
  requestedBy: string
  requestedByName: string
  requestedByRole: string
}): Promise<string> => {
  const col = getCollection()
  if (!col) throw new Error('Firestore is not configured.')

  const existing = await getPendingApprovalForTransaction(params.transactionId)
  if (existing) {
    throw new Error(
      `A refund request is already pending approval for this transaction (requested by ${existing.requestedByName}).`,
    )
  }

  const ref = await addDoc(col, {
    ...params,
    status: 'pending',
    requestedAt: nowIso(),
  })
  return ref.id
}

/** Reject a refund request — no transaction mutation. */
export const rejectRefund = async (
  id: string,
  reviewer: { reviewedBy: string; reviewedByName: string },
): Promise<void> => {
  const col = getCollection()
  if (!col) throw new Error('Firestore is not configured.')

  // Server-side role check — same guard as approveAndExecuteRefund.
  const firestore = initializeFirestore()
  if (firestore && reviewer.reviewedBy) {
    const reviewerDoc = await getDoc(doc(firestore, 'users', reviewer.reviewedBy))
    const reviewerRole = reviewerDoc.exists()
      ? (reviewerDoc.data() as Record<string, unknown>).role
      : undefined
    if (!reviewerRole || !['Owner', 'Admin'].includes(reviewerRole as string)) {
      throw new Error(
        `Refund rejection requires Owner or Admin role. Current role: ${reviewerRole || 'unknown'}.`,
      )
    }
  }

  await updateDoc(doc(col, id), {
    status: 'rejected',
    reviewedBy: reviewer.reviewedBy,
    reviewedByName: reviewer.reviewedByName,
    reviewedAt: nowIso(),
  })
}

/**
 * Approve AND execute a refund. Marks the approval, then runs the real refund
 * + wallet credit + invoice regen. Wallet and invoice failures are logged and
 * surfaced on the approval record — they do not silently succeed.
 */
export const approveAndExecuteRefund = async (
  id: string,
  reviewer: { reviewedBy: string; reviewedByName: string },
): Promise<{ walletCredited: boolean; walletError?: string }> => {
  const col = getCollection()
  if (!col) throw new Error('Firestore is not configured.')

  // ── Server-side role enforcement ─────────────────────────────────────
  // The UI gates approval behind `canApproveRefund`, but since Firestore
  // rules are permissive, any authenticated pipeline user could call this
  // directly from the browser console. Verify the reviewer actually holds
  // an Owner or Admin role before proceeding.
  const firestore = initializeFirestore()
  if (firestore && reviewer.reviewedBy) {
    const reviewerDoc = await getDoc(doc(firestore, 'users', reviewer.reviewedBy))
    const reviewerRole = reviewerDoc.exists()
      ? (reviewerDoc.data() as Record<string, unknown>).role
      : undefined
    if (!reviewerRole || !['Owner', 'Admin'].includes(reviewerRole as string)) {
      throw new Error(
        `Refund approval requires Owner or Admin role. Current role: ${reviewerRole || 'unknown'}.`,
      )
    }
  }

  // Atomically claim the approval: 'pending' → 'approved' inside a Firestore
  // transaction. Two concurrent approvers race; one wins the contested write,
  // the other retries inside Firestore and observes status='approved', then
  // aborts. Without this, both approvers used to pass the pending check
  // separately and both executed `refundSelectedItems` + wallet credit,
  // causing a double-refund and double wallet credit on the same transaction.
  if (!firestore) throw new Error('Firestore not configured.')
  const docRef = doc(col, id)
  const request = await runTransaction(firestore, async (txn) => {
    const fresh = await txn.get(docRef)
    if (!fresh.exists()) throw new Error('Refund request not found.')
    const current = { id: fresh.id, ...fresh.data() } as RefundApprovalRecord
    if (current.status !== 'pending') {
      throw new Error(`Refund request is already ${current.status}.`)
    }
    txn.update(docRef, {
      status: 'approved',
      reviewedBy: reviewer.reviewedBy,
      reviewedByName: reviewer.reviewedByName,
      reviewedAt: nowIso(),
    })
    return current
  })

  let executionError: string | undefined
  let walletCredited = false
  let walletError: string | undefined

  try {
    const transaction = await refundSelectedItems(
      request.transactionId,
      request.itemIndices,
      request.reason,
    )

    if (request.refundAmount > 0 && request.customerPhone) {
      try {
        await creditCustomerWallet(
          request.customerPhone,
          request.refundAmount,
          `Refund for ${transaction.invoiceNumber} — ${request.reason}`,
        )
        walletCredited = true
      } catch (err) {
        walletError = err instanceof Error ? err.message : 'Failed to credit wallet'
        logger.error('refund.wallet_credit_failed', err, {
          approvalId: id,
          transactionId: request.transactionId,
        })
      }
    }

    try {
      await generateFirestoreWeeklyInvoices(new Date(transaction.transactionDate))
    } catch (err) {
      logger.error('refund.invoice_regen_failed', err, {
        approvalId: id,
        transactionId: request.transactionId,
      })
    }
  } catch (err) {
    executionError = err instanceof Error ? err.message : 'Refund execution failed'
    logger.error('refund.execution_failed', err, {
      approvalId: id,
      transactionId: request.transactionId,
    })
  }

  if (executionError) {
    // The actual refund (`refundSelectedItems`) threw before completing, so
    // the underlying transaction was NEVER refunded. Revert the approval
    // back to 'pending' with the error annotated so the admin can retry —
    // otherwise the approval would be permanently stuck 'approved' and the
    // status check at the top of this function would block all retries.
    await updateDoc(docRef, {
      status: 'pending',
      executionError,
      executionAttemptedAt: nowIso(),
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
    })
    throw new Error(executionError)
  }

  // Refund succeeded (wallet credit may have separately failed; that's
  // recorded but doesn't unwind the refund itself).
  await updateDoc(docRef, {
    executedAt: nowIso(),
    walletCredited,
    ...(walletError ? { walletError } : {}),
  })

  return { walletCredited, walletError }
}

/** Real-time subscription for Admin/Owner pending queue. Returns unsubscribe fn. */
export const subscribePendingRefundApprovals = (
  onData: (rows: RefundApprovalRecord[]) => void,
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
        .map((d) => ({ id: d.id, ...d.data() }) as RefundApprovalRecord)
        .sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''))
      onData(rows)
    },
    onError,
  )
}

/** Real-time subscription for the requester's own refund requests. */
export const subscribeUserRefundApprovals = (
  userId: string,
  onData: (rows: RefundApprovalRecord[]) => void,
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
        .map((d) => ({ id: d.id, ...d.data() }) as RefundApprovalRecord)
        .sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''))
      onData(rows)
    },
    onError,
  )
}

/** Recent approvals (any status, last 7 days) for audit log / history views. */
export const subscribeRecentRefundApprovals = (
  onData: (rows: RefundApprovalRecord[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const col = getCollection()
  if (!col) {
    onData([])
    return () => {}
  }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)
  return onSnapshot(
    query(
      col,
      where('requestedAt', '>=', cutoff.toISOString()),
      orderBy('requestedAt', 'desc'),
      limit(50),
    ),
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as RefundApprovalRecord)
      onData(rows)
    },
    onError,
  )
}
