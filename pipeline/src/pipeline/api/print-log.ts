/**
 * Print Audit Log — tracks every ticket/receipt print and reprint.
 *
 * Collection: `printLogs` in the pipeline Firestore database.
 * Each document records who printed, what was printed, when, and whether
 * it was a first print or a reprint.
 *
 * Admins can query this to detect misuse (unauthorized reprints).
 */
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  doc,
  deleteDoc,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'

export interface PrintLogEntry {
  /** Firestore document ID — used for admin edit/delete */
  id?: string
  /** Booking ID or Invoice number */
  documentId: string
  /** "booking" or "billing" */
  source: 'booking' | 'billing'
  /** First print or reprint */
  type: 'print' | 'reprint'
  /** How many times this document has been printed (including this one) */
  printCount: number
  /** Who printed */
  printedBy: string
  printedByName: string
  printedByRole: string
  /** When */
  printedAt: Date
  /** Customer details for quick reference */
  customerName?: string
  customerPhone?: string
  /** Amount on the ticket */
  amount?: number
  /** Location */
  locationId?: string
}

const COLLECTION = 'printLogs'

/**
 * Log a print event and return the print count (how many times this document has been printed).
 * If printCount > 1, this is a reprint.
 */
export const logPrint = async (entry: {
  documentId: string
  source: 'booking' | 'billing'
  printedBy: string
  printedByName: string
  printedByRole: string
  customerName?: string
  customerPhone?: string
  amount?: number
  locationId?: string
}): Promise<{ printCount: number; isReprint: boolean }> => {
  const firestore = initializeFirestore()
  if (!firestore) return { printCount: 0, isReprint: false }

  // Count existing prints for this document
  const existingQuery = query(
    collection(firestore, COLLECTION),
    where('documentId', '==', entry.documentId),
    where('source', '==', entry.source),
  )
  const existing = await getDocs(existingQuery)
  const printCount = existing.size + 1
  const isReprint = printCount > 1

  const logEntry: PrintLogEntry = {
    ...entry,
    type: isReprint ? 'reprint' : 'print',
    printCount,
    printedAt: new Date(),
  }

  await addDoc(collection(firestore, COLLECTION), logEntry)

  return { printCount, isReprint }
}

/**
 * Read-only check: how many times a document has been printed, without creating a new log entry.
 * Use this to decide whether to show reprint flow BEFORE committing a log.
 */
export const checkPrintCount = async (
  documentId: string,
  source: 'booking' | 'billing',
): Promise<{ printCount: number; isReprint: boolean }> => {
  const firestore = initializeFirestore()
  if (!firestore) return { printCount: 0, isReprint: false }

  const existingQuery = query(
    collection(firestore, COLLECTION),
    where('documentId', '==', documentId),
    where('source', '==', source),
  )
  const existing = await getDocs(existingQuery)
  return { printCount: existing.size, isReprint: existing.size > 0 }
}

/**
 * Get print history for a specific document (booking or invoice).
 */
export const getPrintHistory = async (documentId: string): Promise<PrintLogEntry[]> => {
  const firestore = initializeFirestore()
  if (!firestore) return []

  const q = query(
    collection(firestore, COLLECTION),
    where('documentId', '==', documentId),
    orderBy('printedAt', 'desc'),
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => {
    const data = d.data()
    return {
      ...data,
      id: d.id,
      printedAt: data.printedAt?.toDate?.() ?? new Date(data.printedAt),
    } as PrintLogEntry
  })
}

/**
 * List all print logs, most recent first. Owner-only view.
 */
export const listPrintLogs = async (maxResults = 200): Promise<PrintLogEntry[]> => {
  const firestore = initializeFirestore()
  if (!firestore) return []

  const q = query(
    collection(firestore, COLLECTION),
    orderBy('printedAt', 'desc'),
    limit(maxResults),
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => {
    const data = d.data()
    return {
      ...data,
      id: d.id,
      printedAt: data.printedAt?.toDate?.() ?? new Date(data.printedAt),
    } as PrintLogEntry
  })
}

/**
 * Get all reprints (printCount > 1) for admin review, most recent first.
 */
export const getReprints = async (maxResults = 100): Promise<PrintLogEntry[]> => {
  const firestore = initializeFirestore()
  if (!firestore) return []

  const q = query(
    collection(firestore, COLLECTION),
    where('type', '==', 'reprint'),
    orderBy('printedAt', 'desc'),
    limit(maxResults),
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => {
    const data = d.data()
    return {
      ...data,
      id: d.id,
      printedAt: data.printedAt?.toDate?.() ?? new Date(data.printedAt),
    } as PrintLogEntry
  })
}

/**
 * Delete a single print log entry. Owner-only — reduces the derived print count by 1.
 */
export const deletePrintLogEntry = async (entryId: string): Promise<void> => {
  const firestore = initializeFirestore()
  if (!firestore) return
  await deleteDoc(doc(firestore, COLLECTION, entryId))
}

/**
 * Set the print count for a document to an exact target value.
 *
 * - If current count > target: deletes the most recent (newest) entries until count matches.
 * - If current count < target: appends manual adjustment entries so future prints are numbered correctly.
 *
 * Returns the new count after the adjustment.
 */
export const adjustPrintCount = async (params: {
  documentId: string
  source: 'booking' | 'billing'
  targetCount: number
  admin: {
    id: string
    name: string
    role: string
  }
  customerName?: string
  customerPhone?: string
  amount?: number
  locationId?: string
}): Promise<{ previousCount: number; newCount: number }> => {
  const firestore = initializeFirestore()
  if (!firestore) return { previousCount: 0, newCount: 0 }

  const targetCount = Math.max(0, Math.floor(params.targetCount))

  const existingQuery = query(
    collection(firestore, COLLECTION),
    where('documentId', '==', params.documentId),
    where('source', '==', params.source),
    orderBy('printedAt', 'desc'),
  )
  const existing = await getDocs(existingQuery)
  const previousCount = existing.size

  if (targetCount < previousCount) {
    const toDelete = existing.docs.slice(0, previousCount - targetCount)
    await Promise.all(toDelete.map((d) => deleteDoc(d.ref)))
  } else if (targetCount > previousCount) {
    const additions = targetCount - previousCount
    for (let i = 0; i < additions; i += 1) {
      const nextIndex = previousCount + i + 1
      const stub: PrintLogEntry = {
        documentId: params.documentId,
        source: params.source,
        type: nextIndex > 1 ? 'reprint' : 'print',
        printCount: nextIndex,
        printedBy: params.admin.id,
        printedByName: `${params.admin.name} (manual adjustment)`,
        printedByRole: params.admin.role,
        printedAt: new Date(),
        customerName: params.customerName,
        customerPhone: params.customerPhone,
        amount: params.amount,
        locationId: params.locationId,
      }
      await addDoc(collection(firestore, COLLECTION), stub)
    }
  }

  return { previousCount, newCount: targetCount }
}
