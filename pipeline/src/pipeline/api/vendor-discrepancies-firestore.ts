/**
 * Firestore I/O for the `vendorDiscrepancies` collection.
 *
 * One document per vendor-attribution incident — surfaced in the Owner
 * Discrepancies tab, used to generate the public report at /r/disc-:ref,
 * and linked to a `discrepancy_correction` vendorLedger entry once the
 * vendor has been credited.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { nowIso, stripUndefined } from './firestore-utils'
import type { VendorDiscrepancyRecord } from './types'

const COLLECTION = 'vendorDiscrepancies'

const getFs = () => initializeFirestore()

const toNumber = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

const mapRecord = (id: string, data: Record<string, unknown>): VendorDiscrepancyRecord => ({
  id,
  reference: String(data.reference ?? id),
  vendorId: String(data.vendorId ?? ''),
  vendorName: String(data.vendorName ?? ''),
  vendorPhone: data.vendorPhone ? String(data.vendorPhone) : undefined,
  branchId: String(data.branchId ?? ''),
  branchDisplayName: data.branchDisplayName ? String(data.branchDisplayName) : undefined,
  gameLabel: String(data.gameLabel ?? ''),
  affectedBookings: Array.isArray(data.affectedBookings)
    ? (data.affectedBookings as Array<Record<string, unknown>>).map((b) => ({
        bookingId: String(b.bookingId ?? ''),
        transactionDate: String(b.transactionDate ?? ''),
        items: Array.isArray(b.items)
          ? (b.items as Array<Record<string, unknown>>).map((it) => ({
              itemName: String(it.itemName ?? ''),
              quantity: toNumber(it.quantity),
              amount: toNumber(it.amount),
            }))
          : [],
      }))
    : [],
  grossAmount: toNumber(data.grossAmount),
  status:
    data.status === 'resolved' ? 'resolved' : data.status === 'notified' ? 'notified' : 'pending',
  detectedAt: String(data.detectedAt ?? nowIso()),
  notifiedAt: data.notifiedAt ? String(data.notifiedAt) : undefined,
  resolvedAt: data.resolvedAt ? String(data.resolvedAt) : undefined,
  ledgerEntryId: data.ledgerEntryId ? String(data.ledgerEntryId) : undefined,
  notes: data.notes ? String(data.notes) : undefined,
  createdBy: String(data.createdBy ?? 'system'),
  createdByName: String(data.createdByName ?? 'System'),
})

/** List all discrepancies, newest first. */
export const listDiscrepancies = async (): Promise<VendorDiscrepancyRecord[]> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  const snap = await getDocs(query(collection(fs, COLLECTION), orderBy('detectedAt', 'desc')))
  return snap.docs.map((d) => mapRecord(d.id, d.data() as Record<string, unknown>))
}

/** Vendor-scoped read used by public `/r/disc-:ref` route. */
export const getDiscrepancyByReference = async (
  reference: string,
): Promise<VendorDiscrepancyRecord | null> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  const snap = await getDocs(query(collection(fs, COLLECTION), where('reference', '==', reference)))
  if (snap.empty) return null
  const d = snap.docs[0]
  return mapRecord(d.id, d.data() as Record<string, unknown>)
}

export interface CreateDiscrepancyInput {
  vendorId: string
  vendorName: string
  vendorPhone?: string
  branchId: string
  branchDisplayName?: string
  gameLabel: string
  affectedBookings: VendorDiscrepancyRecord['affectedBookings']
  grossAmount: number
  notes?: string
  createdBy: string
  createdByName: string
}

const generateReference = (when: Date): string => {
  const y = when.getFullYear()
  const m = String(when.getMonth() + 1).padStart(2, '0')
  const d = String(when.getDate()).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return `DISC-${y}-${m}${d}-${seq}`
}

export const createDiscrepancy = async (
  input: CreateDiscrepancyInput,
): Promise<VendorDiscrepancyRecord> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  if (!input.vendorId) throw new Error('vendorId is required')
  if (input.grossAmount <= 0) throw new Error('grossAmount must be positive')
  const reference = generateReference(new Date())
  const id = reference
  const payload = stripUndefined({
    reference,
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    vendorPhone: input.vendorPhone,
    branchId: input.branchId,
    branchDisplayName: input.branchDisplayName,
    gameLabel: input.gameLabel,
    affectedBookings: input.affectedBookings,
    grossAmount: Math.round(input.grossAmount),
    status: 'pending',
    detectedAt: nowIso(),
    notes: input.notes,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
  })
  await setDoc(doc(fs, COLLECTION, id), payload)
  return mapRecord(id, payload)
}

export const markDiscrepancyNotified = async (id: string): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  await updateDoc(doc(fs, COLLECTION, id), {
    status: 'notified',
    notifiedAt: nowIso(),
  })
}

export const markDiscrepancyResolved = async (id: string, ledgerEntryId: string): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  await updateDoc(doc(fs, COLLECTION, id), {
    status: 'resolved',
    resolvedAt: nowIso(),
    ledgerEntryId,
  })
}

export const getDiscrepancyById = async (id: string): Promise<VendorDiscrepancyRecord | null> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')
  const snap = await getDoc(doc(fs, COLLECTION, id))
  if (!snap.exists()) return null
  return mapRecord(snap.id, snap.data() as Record<string, unknown>)
}
