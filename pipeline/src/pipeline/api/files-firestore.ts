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
import { getFirestoreSessionUser } from './firestore-session'
import { nowIso, toOptionalString } from './firestore-utils'
import { FileRecord, TaskRecord } from './types'

const FILES_COLLECTION = 'files'
const TASKS_COLLECTION = 'tasks'
const USE_FIRESTORE_FILES = import.meta.env.VITE_USE_FIRESTORE_FILES !== 'false'

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

const getFilesCollection = () => {
  if (!USE_FIRESTORE_FILES) {
    return null
  }
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return collection(firestore, FILES_COLLECTION)
}

const getTaskRef = (taskId: string) => {
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return doc(firestore, TASKS_COLLECTION, taskId)
}

const mapFileRecord = (id: string, data: Record<string, unknown>): FileRecord => ({
  id,
  fileName: String(data.fileName ?? 'File'),
  mimeType: String(data.mimeType ?? 'application/octet-stream'),
  sizeBytes: Math.max(0, Math.round(toNumber(data.sizeBytes))),
  storageProvider: 'GoogleDrive',
  uploadedAt: String(data.uploadedAt ?? nowIso()),
  revokedAt: toOptionalString(data.revokedAt),
  taskId: String(data.taskId ?? ''),
  workspaceId: String(data.workspaceId ?? ''),
  downloadPath: String(data.downloadPath ?? '#'),
  driveFileId: toOptionalString(data.driveFileId),
  uploaderId: toOptionalString(data.uploaderId),
  uploaderName: toOptionalString(data.uploaderName),
  folderPath: toOptionalString(data.folderPath),
  visibility: 'view-only',
  notes: toOptionalString(data.notes),
})

const updateTaskAttachments = async (taskId: string, attachment: FileRecord): Promise<void> => {
  const taskRef = getTaskRef(taskId)
  if (!taskRef) {
    throw new Error('Firestore tasks is not configured.')
  }

  const snapshot = await getDoc(taskRef)
  if (!snapshot.exists()) {
    return
  }

  const task = snapshot.data() as TaskRecord & { attachments?: TaskRecord['attachments'] }
  const attachments = Array.isArray(task.attachments) ? [...task.attachments] : []
  const nextAttachment = {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    storageProvider: 'GoogleDrive' as const,
    downloadPath: attachment.downloadPath,
    uploadedAt: attachment.uploadedAt,
    revokedAt: attachment.revokedAt,
  }
  const existingIndex = attachments.findIndex((item) => item.id === attachment.id)
  if (existingIndex >= 0) {
    attachments[existingIndex] = nextAttachment
  } else {
    attachments.unshift(nextAttachment)
  }

  await updateDoc(taskRef, {
    attachments,
    updatedAt: nowIso(),
  })
}

export const isFirestoreFilesActive = (): boolean => Boolean(getFilesCollection())

export const listFirestoreFiles = async (queryFilter?: {
  workspaceId?: string
  taskId?: string
}): Promise<FileRecord[]> => {
  const filesCollection = getFilesCollection()
  if (!filesCollection) {
    throw new Error('Firestore files is not configured.')
  }

  // Push workspaceId / taskId filters into the Firestore query instead of
  // fetching 1000 global docs and filtering in JS. These are single-field
  // equality filters so Firestore auto-indexes them (no composite needed
  // alongside the uploadedAt orderBy since single-field indexes compose).
  const constraints = []
  if (queryFilter?.workspaceId) {
    constraints.push(where('workspaceId', '==', queryFilter.workspaceId))
  }
  if (queryFilter?.taskId) {
    constraints.push(where('taskId', '==', queryFilter.taskId))
  }
  constraints.push(orderBy('uploadedAt', 'desc'))
  constraints.push(limit(1000))

  const snapshot = await getDocs(query(filesCollection, ...constraints))
  return snapshot.docs.map((item) => mapFileRecord(item.id, item.data() as Record<string, unknown>))
}

export const createFirestoreFileRecord = async (
  token: string,
  payload: {
    taskId: string
    workspaceId: string
    fileName: string
    mimeType: string
    sizeBytes: number
    downloadPath: string
    driveFileId?: string
    folderPath?: string
    notes?: string
  },
): Promise<FileRecord> => {
  const filesCollection = getFilesCollection()
  if (!filesCollection) {
    throw new Error('Firestore files is not configured.')
  }

  const sessionUser = await getFirestoreSessionUser(token)
  const uploadedAt = nowIso()
  const nextId = `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const nextFile: FileRecord = {
    id: nextId,
    fileName: payload.fileName.trim() || 'File',
    mimeType: payload.mimeType.trim() || 'application/octet-stream',
    sizeBytes: Math.max(1, Math.round(payload.sizeBytes)),
    storageProvider: 'GoogleDrive',
    uploadedAt,
    taskId: payload.taskId.trim(),
    workspaceId: payload.workspaceId.trim(),
    downloadPath: payload.downloadPath.trim(),
    driveFileId: toOptionalString(payload.driveFileId),
    uploaderId: sessionUser.id,
    uploaderName: sessionUser.name,
    folderPath: toOptionalString(payload.folderPath),
    visibility: 'view-only',
    notes: toOptionalString(payload.notes),
  }

  await setDoc(doc(filesCollection, nextId), nextFile)
  if (nextFile.taskId) {
    await updateTaskAttachments(nextFile.taskId, nextFile)
  }
  return nextFile
}

export const revokeFirestoreFileRecord = async (fileId: string): Promise<FileRecord> => {
  const filesCollection = getFilesCollection()
  if (!filesCollection) {
    throw new Error('Firestore files is not configured.')
  }

  const fileRef = doc(filesCollection, fileId)
  const snapshot = await getDoc(fileRef)
  if (!snapshot.exists()) {
    throw new Error('File not found.')
  }
  const existing = mapFileRecord(snapshot.id, snapshot.data() as Record<string, unknown>)
  const revokedAt = nowIso()
  await updateDoc(fileRef, { revokedAt })
  const nextFile = { ...existing, revokedAt }
  if (nextFile.taskId) {
    await updateTaskAttachments(nextFile.taskId, nextFile)
  }
  return nextFile
}

export const findFirestoreFilesByTaskId = async (taskId: string): Promise<FileRecord[]> => {
  const filesCollection = getFilesCollection()
  if (!filesCollection) {
    throw new Error('Firestore files is not configured.')
  }
  const snapshot = await getDocs(
    query(
      filesCollection,
      where('taskId', '==', taskId),
      orderBy('uploadedAt', 'desc'),
      limit(200),
    ),
  )
  return snapshot.docs.map((item) => mapFileRecord(item.id, item.data() as Record<string, unknown>))
}
