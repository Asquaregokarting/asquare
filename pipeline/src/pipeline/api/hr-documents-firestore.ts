import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { uploadPipelineFile } from '../lib/firebase-storage'
import { getFirestoreSessionUser } from './firestore-session'
import { nowIso, toOptionalString } from './firestore-utils'
import { HRDocument, HRDocumentType } from './types'

const HR_DOCUMENTS_COLLECTION = 'hrDocuments'

const validDocumentTypes: HRDocumentType[] = [
  'identity',
  'address',
  'education',
  'experience',
  'offer',
  'contract',
  'payslip',
  'medical',
  'other',
]

const toDocumentType = (value: unknown): HRDocumentType => {
  if (typeof value === 'string' && validDocumentTypes.includes(value as HRDocumentType)) {
    return value as HRDocumentType
  }
  return 'other'
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

const getHRDocumentsCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, HR_DOCUMENTS_COLLECTION)
}

const mapHRDocument = (id: string, data: Record<string, unknown>): HRDocument => ({
  id,
  employeeId: String(data.employeeId ?? ''),
  employeeName: String(data.employeeName ?? ''),
  title: String(data.title ?? 'Document'),
  documentType: toDocumentType(data.documentType),
  fileUrl: String(data.fileUrl ?? ''),
  fileName: String(data.fileName ?? ''),
  fileSize: Math.max(0, Math.round(toNumber(data.fileSize))),
  mimeType: String(data.mimeType ?? 'application/octet-stream'),
  uploadedBy: String(data.uploadedBy ?? ''),
  uploadedByName: String(data.uploadedByName ?? ''),
  uploadedAt: String(data.uploadedAt ?? nowIso()),
  branchId: toOptionalString(data.branchId),
  notes: toOptionalString(data.notes),
  expiresAt: toOptionalString(data.expiresAt),
  tags: Array.isArray(data.tags) ? data.tags.map((t) => String(t)) : undefined,
  deletedAt: toOptionalString(data.deletedAt),
})

export const listFirestoreHRDocuments = async (filter?: {
  employeeId?: string
  documentType?: HRDocumentType
  branchId?: string
  includeDeleted?: boolean
}): Promise<HRDocument[]> => {
  const coll = getHRDocumentsCollection()
  if (!coll) throw new Error('Firestore HR documents is not configured.')

  const constraints = []
  if (filter?.employeeId) constraints.push(where('employeeId', '==', filter.employeeId))
  if (filter?.documentType) constraints.push(where('documentType', '==', filter.documentType))
  if (filter?.branchId) constraints.push(where('branchId', '==', filter.branchId))
  constraints.push(orderBy('uploadedAt', 'desc'))
  constraints.push(limit(500))

  const snapshot = await getDocs(query(coll, ...constraints))
  return snapshot.docs
    .map((item) => mapHRDocument(item.id, item.data() as Record<string, unknown>))
    .filter((document) => filter?.includeDeleted || !document.deletedAt)
}

export const createFirestoreHRDocument = async (
  token: string,
  payload: {
    employeeId: string
    employeeName: string
    title: string
    documentType: HRDocumentType
    file: File
    branchId?: string
    notes?: string
    expiresAt?: string
    tags?: string[]
  },
): Promise<HRDocument> => {
  const coll = getHRDocumentsCollection()
  if (!coll) throw new Error('Firestore HR documents is not configured.')

  const sessionUser = await getFirestoreSessionUser(token)
  const docId = `hr-doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const safeEmployeeId = payload.employeeId.trim() || 'general'
  const safeBranch = (payload.branchId ?? 'unassigned').replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
  const storagePath = `hr-documents/${safeBranch}/${safeEmployeeId}/${docId}-${payload.file.name}`

  const upload = await uploadPipelineFile(storagePath, payload.file, 'files')

  const record: HRDocument = {
    id: docId,
    employeeId: safeEmployeeId,
    employeeName: payload.employeeName.trim() || 'Employee',
    title: payload.title.trim() || payload.file.name,
    documentType: payload.documentType,
    fileUrl: upload.downloadUrl,
    fileName: payload.file.name,
    fileSize: payload.file.size,
    mimeType: payload.file.type || 'application/octet-stream',
    uploadedBy: sessionUser.id,
    uploadedByName: sessionUser.name,
    uploadedAt: nowIso(),
    branchId: payload.branchId || undefined,
    notes: payload.notes?.trim() || undefined,
    expiresAt: payload.expiresAt || undefined,
    tags: payload.tags && payload.tags.length > 0 ? payload.tags : undefined,
  }

  await setDoc(doc(coll, docId), record)
  return record
}

export const softDeleteFirestoreHRDocument = async (documentId: string): Promise<void> => {
  const coll = getHRDocumentsCollection()
  if (!coll) throw new Error('Firestore HR documents is not configured.')
  await updateDoc(doc(coll, documentId), { deletedAt: nowIso() })
}

export const restoreFirestoreHRDocument = async (documentId: string): Promise<void> => {
  const coll = getHRDocumentsCollection()
  if (!coll) throw new Error('Firestore HR documents is not configured.')
  await updateDoc(doc(coll, documentId), { deletedAt: null })
}

export const getFirestoreHRDocument = async (documentId: string): Promise<HRDocument | null> => {
  const coll = getHRDocumentsCollection()
  if (!coll) return null
  const snapshot = await getDoc(doc(coll, documentId))
  if (!snapshot.exists()) return null
  return mapHRDocument(snapshot.id, snapshot.data() as Record<string, unknown>)
}
