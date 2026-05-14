import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore'
import type { UpdateData, DocumentData } from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { nowIso, toOptionalString } from './firestore-utils'
import {
  Priority,
  Role,
  TaskConversationActivityRecord,
  TaskConversationSnapshot,
  TaskMessageRecord,
  TaskMessageType,
  TaskOutgoingMessagePayload,
  TaskNotificationRecord,
  TaskNotificationType,
  TaskPollOptionRecord,
  TaskPollRecord,
  TaskPollVoteRecord,
  TaskReadReceiptRecord,
  TaskRecord,
  TaskTypingRecord,
  WorkspaceRecord,
} from './types'

const USE_FIRESTORE_TASKS = import.meta.env.VITE_USE_FIRESTORE_TASKS !== 'false'
const WORKSPACES_COLLECTION = 'workspaces'
const TASKS_COLLECTION = 'tasks'
const TASK_MESSAGES_SUBCOLLECTION = 'messages'
const TASK_TYPING_SUBCOLLECTION = 'typing'
const TASK_READ_RECEIPTS_SUBCOLLECTION = 'readReceipts'
const TASK_NOTIFICATIONS_COLLECTION = 'taskNotifications'
const VALID_VISIBILITY: WorkspaceRecord['visibility'][] = ['Private', 'Organization-wide']
const VALID_PRIORITY: Priority[] = ['Low', 'Medium', 'High', 'Urgent']
const TASK_ACTIVITY_PREFIX = '[[activity]] '
const MAX_NOTIFICATION_PREVIEW_LENGTH = 180
const VALID_TASK_MESSAGE_TYPES: TaskMessageType[] = ['text', 'image', 'file', 'poll', 'poll-vote']
type TaskCommentRecord = {
  id: string
  userId: string
  comment: string
  timestamp: string
}
type TaskAttachmentRecord = {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  storageProvider: 'GoogleDrive'
  downloadPath: string
  uploadedAt: string
  revokedAt?: string
}

const randomId = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

const toTaskDocIdBase = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'task'
}

const isRole = (value: unknown): value is Role =>
  typeof value === 'string' &&
  [
    'Owner',
    'Admin',
    'Telecaller',
    'Cashier',
    'TrackMarshall',
    'Editor',
    'Developer',
    'Backend',
    'ThirdParty',
  ].includes(value)

const isVisibility = (value: unknown): value is WorkspaceRecord['visibility'] =>
  typeof value === 'string' && VALID_VISIBILITY.includes(value as WorkspaceRecord['visibility'])

const isPriority = (value: unknown): value is Priority =>
  typeof value === 'string' && VALID_PRIORITY.includes(value as Priority)

const isDataUrl = (value: string): boolean => /^data:/i.test(String(value ?? '').trim())

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)
}

const normalizeTaskMessageType = (value: unknown): TaskMessageType => {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase() as TaskMessageType
  return VALID_TASK_MESSAGE_TYPES.includes(raw) ? raw : 'text'
}

const mapTaskPollOption = (value: unknown): TaskPollOptionRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const row = value as UpdateData<DocumentData>
  const id = String(row.id ?? '').trim()
  const label = String(row.label ?? '').trim()
  if (!id || !label) {
    return null
  }
  return { id, label }
}

const mapTaskPollRecord = (value: unknown): TaskPollRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const row = value as UpdateData<DocumentData>
  const pollId = String(row.pollId ?? '').trim()
  const question = String(row.question ?? '').trim()
  const options = Array.isArray(row.options)
    ? row.options
        .map(mapTaskPollOption)
        .filter((item): item is TaskPollOptionRecord => Boolean(item))
    : []
  if (!pollId || !question || options.length < 2) {
    return null
  }
  return { pollId, question, options }
}

const mapTaskPollVoteRecord = (value: unknown): TaskPollVoteRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const row = value as UpdateData<DocumentData>
  const pollId = String(row.pollId ?? '').trim()
  const optionId = String(row.optionId ?? '').trim()
  if (!pollId || !optionId) {
    return null
  }
  return { pollId, optionId }
}

const mapWorkspaceRecord = (id: string, data: Record<string, unknown>): WorkspaceRecord => ({
  id,
  workspaceName: String(data.workspaceName ?? 'Workspace'),
  memberIds: toStringArray(data.memberIds),
  visibility: isVisibility(data.visibility) ? data.visibility : 'Private',
  boardRole: isRole(data.boardRole) ? data.boardRole : undefined,
  boardRoles: Array.isArray(data.boardRoles)
    ? (data.boardRoles as unknown[]).filter((v): v is Role => isRole(v))
    : undefined,
  excludedMemberIds: toStringArray(data.excludedMemberIds),
  isDeleted: Boolean(data.isDeleted),
  deletedAt: toOptionalString(data.deletedAt),
  deletedBy: toOptionalString(data.deletedBy),
})

const mapTaskComment = (value: unknown): TaskCommentRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const row = value as UpdateData<DocumentData>
  const id = String(row.id ?? '').trim()
  const userId = String(row.userId ?? '').trim()
  const comment = String(row.comment ?? '').trim()
  const timestamp = String(row.timestamp ?? nowIso())
  if (!id || !userId || !comment) {
    return null
  }

  return { id, userId, comment, timestamp }
}

const mapTaskAttachment = (value: unknown): TaskAttachmentRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const row = value as UpdateData<DocumentData>
  const id = String(row.id ?? '').trim()
  const fileName = String(row.fileName ?? '').trim()
  const mimeType = String(row.mimeType ?? '').trim()
  const sizeBytes = Number(row.sizeBytes ?? 0)
  const downloadPath = String(row.downloadPath ?? '').trim()
  const uploadedAt = String(row.uploadedAt ?? nowIso())
  const revokedAt = toOptionalString(row.revokedAt)
  if (!id || !fileName || !mimeType || !Number.isFinite(sizeBytes) || !downloadPath) {
    return null
  }

  return {
    id,
    fileName,
    mimeType,
    sizeBytes,
    storageProvider: 'GoogleDrive',
    downloadPath,
    uploadedAt,
    revokedAt,
  }
}

const mapTaskRecord = (id: string, data: Record<string, unknown>): TaskRecord => {
  const updatedAt = String(data.updatedAt ?? nowIso())
  const comments = Array.isArray(data.comments)
    ? data.comments
        .map(mapTaskComment)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : []
  const attachments = Array.isArray(data.attachments)
    ? data.attachments
        .map(mapTaskAttachment)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : []

  return {
    id,
    workspaceId: String(data.workspaceId ?? ''),
    taskName: String(data.taskName ?? 'Task'),
    priority: isPriority(data.priority) ? data.priority : 'Medium',
    status: String(data.status ?? 'Todo'),
    assignedTo: String(data.assignedTo ?? ''),
    dueDate: String(data.dueDate ?? updatedAt),
    updatedAt,
    isDeleted: Boolean(data.isDeleted),
    deletedAt: toOptionalString(data.deletedAt),
    deletedBy: toOptionalString(data.deletedBy),
    description: toOptionalString(data.description),
    comments,
    attachments,
  }
}

const isActivityComment = (value: string): boolean => value.startsWith(TASK_ACTIVITY_PREFIX)
const fromActivityComment = (value: string): string =>
  isActivityComment(value) ? value.slice(TASK_ACTIVITY_PREFIX.length).trim() : value
const toActivityComment = (value: string): string => `${TASK_ACTIVITY_PREFIX}${value}`

const getTaskMessagesCollection = (taskId: string) => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    return null
  }
  return collection(doc(tasksCollection, taskId), TASK_MESSAGES_SUBCOLLECTION)
}

const getTaskTypingCollection = (taskId: string) => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    return null
  }
  return collection(doc(tasksCollection, taskId), TASK_TYPING_SUBCOLLECTION)
}

const getTaskReadReceiptsCollection = (taskId: string) => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    return null
  }
  return collection(doc(tasksCollection, taskId), TASK_READ_RECEIPTS_SUBCOLLECTION)
}

const normalizeTimestamp = (value: unknown): string => {
  const text = String(value ?? '').trim()
  if (!text) {
    return nowIso()
  }
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) {
    return nowIso()
  }
  return parsed.toISOString()
}

const sortTaskMessages = (messages: TaskMessageRecord[]): TaskMessageRecord[] =>
  [...messages].sort((left, right) => {
    const leftKey = left.createdAt || left.clientCreatedAt || ''
    const rightKey = right.createdAt || right.clientCreatedAt || ''
    if (leftKey === rightKey) {
      return left.id.localeCompare(right.id)
    }
    return leftKey.localeCompare(rightKey)
  })

const sortTaskActivities = (
  activities: TaskConversationActivityRecord[],
): TaskConversationActivityRecord[] =>
  [...activities].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

const mapTaskMessageRecord = (
  taskId: string,
  messageId: string,
  data: Record<string, unknown>,
): TaskMessageRecord | null => {
  const senderId = String(data.senderId ?? '').trim()
  if (!senderId) {
    return null
  }

  const messageType = normalizeTaskMessageType(data.messageType)
  const text = String(data.text ?? '').trim()
  const createdAt = normalizeTimestamp(data.createdAt)
  const clientCreatedAtRaw = String(data.clientCreatedAt ?? '').trim()
  const clientCreatedAt = clientCreatedAtRaw ? normalizeTimestamp(clientCreatedAtRaw) : undefined
  const imageUrl = toOptionalString(data.imageUrl)
  const fileName = toOptionalString(data.fileName)
  const fileUrl = toOptionalString(data.fileUrl)
  const fileMimeType = toOptionalString(data.fileMimeType)
  const fileSizeRaw = data.fileSizeBytes
  const fileSizeBytes =
    typeof fileSizeRaw === 'number' && Number.isFinite(fileSizeRaw) && fileSizeRaw > 0
      ? fileSizeRaw
      : undefined
  const poll = mapTaskPollRecord(data.poll)
  const pollVote = mapTaskPollVoteRecord(data.pollVote)

  if (messageType === 'image' && !imageUrl) {
    return null
  }
  if (messageType === 'file' && (!fileUrl || !fileName)) {
    return null
  }
  if (messageType === 'poll' && !poll) {
    return null
  }
  if (messageType === 'poll-vote' && !pollVote) {
    return null
  }

  const fallbackText =
    messageType === 'image'
      ? 'Image'
      : messageType === 'file'
        ? (fileName ?? 'File')
        : messageType === 'poll'
          ? (poll?.question ?? 'Poll')
          : messageType === 'poll-vote'
            ? 'Voted on poll'
            : ''

  return {
    id: messageId,
    taskId,
    text: text || fallbackText,
    senderId,
    createdAt,
    messageType,
    imageUrl,
    fileName,
    fileUrl,
    fileMimeType,
    fileSizeBytes,
    poll: poll ?? undefined,
    pollVote: pollVote ?? undefined,
    clientCreatedAt,
    source: 'message',
    deliveryState: 'sent',
  }
}

const mapTaskTypingRecord = (data: Record<string, unknown>): TaskTypingRecord | null => {
  const userId = String(data.userId ?? '').trim()
  if (!userId) {
    return null
  }
  return {
    userId,
    isTyping: Boolean(data.isTyping),
    updatedAt: normalizeTimestamp(data.updatedAt),
  }
}

const mapTaskReadReceiptRecord = (data: Record<string, unknown>): TaskReadReceiptRecord | null => {
  const userId = String(data.userId ?? '').trim()
  if (!userId) {
    return null
  }
  const lastReadAt = normalizeTimestamp(data.lastReadAt)
  const lastReadMessageId = toOptionalString(data.lastReadMessageId)
  return {
    userId,
    lastReadAt,
    lastReadMessageId,
    updatedAt: normalizeTimestamp(data.updatedAt),
  }
}

const mapTaskNotificationRecord = (
  id: string,
  data: Record<string, unknown>,
): TaskNotificationRecord | null => {
  const userId = String(data.userId ?? '').trim()
  const taskId = String(data.taskId ?? '').trim()
  const workspaceId = String(data.workspaceId ?? '').trim()
  const taskName = String(data.taskName ?? '').trim()
  const senderId = String(data.senderId ?? '').trim()
  if (!userId || !taskId || !workspaceId || !taskName || !senderId) {
    return null
  }

  const typeRaw = String(data.type ?? 'task-message').trim()
  const type: TaskNotificationType = typeRaw === 'task-assigned' ? 'task-assigned' : 'task-message'
  const createdAt = normalizeTimestamp(data.createdAt)
  const readAtRaw = toOptionalString(data.readAt)
  const readAt = readAtRaw ? normalizeTimestamp(readAtRaw) : undefined

  return {
    id,
    userId,
    taskId,
    workspaceId,
    taskName,
    senderId,
    senderName: String(data.senderName ?? senderId).trim() || senderId,
    type,
    messagePreview: String(data.messagePreview ?? '').trim(),
    createdAt,
    readAt,
  }
}

const buildLegacyTaskConversation = (
  task: TaskRecord,
): { messages: TaskMessageRecord[]; activities: TaskConversationActivityRecord[] } => {
  const comments = task.comments ?? []
  const messages: TaskMessageRecord[] = []
  const activities: TaskConversationActivityRecord[] = []

  for (const comment of comments) {
    if (isActivityComment(comment.comment)) {
      activities.push({
        id: comment.id,
        taskId: task.id,
        userId: comment.userId,
        message: fromActivityComment(comment.comment),
        createdAt: normalizeTimestamp(comment.timestamp),
      })
      continue
    }

    messages.push({
      id: comment.id,
      taskId: task.id,
      text: comment.comment,
      senderId: comment.userId,
      createdAt: normalizeTimestamp(comment.timestamp),
      clientCreatedAt: normalizeTimestamp(comment.timestamp),
      messageType: 'text',
      source: 'legacy-comment',
      deliveryState: 'sent',
    })
  }

  return {
    messages: sortTaskMessages(messages),
    activities: sortTaskActivities(activities),
  }
}

const getWorkspacesCollection = () => {
  if (!USE_FIRESTORE_TASKS) {
    return null
  }
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return collection(firestore, WORKSPACES_COLLECTION)
}

const getTasksCollection = () => {
  if (!USE_FIRESTORE_TASKS) {
    return null
  }
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return collection(firestore, TASKS_COLLECTION)
}

const getTaskNotificationsCollection = () => {
  if (!USE_FIRESTORE_TASKS) {
    return null
  }
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return collection(firestore, TASK_NOTIFICATIONS_COLLECTION)
}

const deleteTaskRealtimeCollections = async (taskId: string): Promise<void> => {
  const messagesCollection = getTaskMessagesCollection(taskId)
  const typingCollection = getTaskTypingCollection(taskId)
  const readReceiptsCollection = getTaskReadReceiptsCollection(taskId)

  const [messagesSnapshot, typingSnapshot, readReceiptsSnapshot] = await Promise.all([
    messagesCollection ? getDocs(messagesCollection) : Promise.resolve(null),
    typingCollection ? getDocs(typingCollection) : Promise.resolve(null),
    readReceiptsCollection ? getDocs(readReceiptsCollection) : Promise.resolve(null),
  ])

  const deletes: Promise<void>[] = []
  if (messagesSnapshot) {
    for (const row of messagesSnapshot.docs) {
      deletes.push(deleteDoc(row.ref))
    }
  }
  if (typingSnapshot) {
    for (const row of typingSnapshot.docs) {
      deletes.push(deleteDoc(row.ref))
    }
  }
  if (readReceiptsSnapshot) {
    for (const row of readReceiptsSnapshot.docs) {
      deletes.push(deleteDoc(row.ref))
    }
  }

  if (deletes.length > 0) {
    await Promise.all(deletes)
  }
}

const deleteTaskNotificationsByTaskId = async (taskId: string): Promise<void> => {
  const notificationsCollection = getTaskNotificationsCollection()
  if (!notificationsCollection) {
    return
  }

  const snapshot = await getDocs(query(notificationsCollection, where('taskId', '==', taskId)))
  if (snapshot.empty) {
    return
  }
  await Promise.all(snapshot.docs.map((row) => deleteDoc(row.ref)))
}

const deleteTaskCascadeById = async (taskId: string): Promise<void> => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    throw new Error('Firestore tasks is not configured.')
  }

  await Promise.all([
    deleteTaskRealtimeCollections(taskId),
    deleteTaskNotificationsByTaskId(taskId),
  ])
  await deleteDoc(doc(tasksCollection, taskId))
}

const sortTaskNotifications = (rows: TaskNotificationRecord[]): TaskNotificationRecord[] =>
  [...rows].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return right.id.localeCompare(left.id)
    }
    return right.createdAt.localeCompare(left.createdAt)
  })

const toNotificationPreview = (value: string): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'New activity in this task.'
  }
  if (normalized.length <= MAX_NOTIFICATION_PREVIEW_LENGTH) {
    return normalized
  }
  return `${normalized.slice(0, MAX_NOTIFICATION_PREVIEW_LENGTH - 3)}...`
}

const collectTaskParticipantIds = (task: TaskRecord, workspace: WorkspaceRecord): string[] => {
  const unique = new Set<string>()
  const candidates = [...workspace.memberIds, task.assignedTo]
  for (const value of candidates) {
    const normalized = String(value ?? '').trim()
    if (!normalized) continue
    unique.add(normalized)
  }
  return [...unique]
}

const createTaskNotificationsForRecipients = async (payload: {
  recipientIds: string[]
  task: TaskRecord
  senderId: string
  senderName: string
  type: TaskNotificationType
  messagePreview: string
}): Promise<void> => {
  const notificationsCollection = getTaskNotificationsCollection()
  if (!notificationsCollection) {
    return
  }

  const recipients = Array.from(
    new Set(
      payload.recipientIds
        .map((item) => String(item ?? '').trim())
        .filter((item) => item.length > 0),
    ),
  )
  if (recipients.length === 0) {
    return
  }

  const createdAt = nowIso()
  const messagePreview = toNotificationPreview(payload.messagePreview)
  await Promise.all(
    recipients.map(async (recipientId) => {
      await addDoc(notificationsCollection, {
        userId: recipientId,
        taskId: payload.task.id,
        workspaceId: payload.task.workspaceId,
        taskName: payload.task.taskName,
        senderId: payload.senderId,
        senderName: payload.senderName,
        type: payload.type,
        messagePreview,
        createdAt,
      })
    }),
  )
}

const safeCreateTaskNotificationsForRecipients = async (payload: {
  recipientIds: string[]
  task: TaskRecord
  senderId: string
  senderName: string
  type: TaskNotificationType
  messagePreview: string
}): Promise<void> => {
  try {
    await createTaskNotificationsForRecipients(payload)
  } catch {
    // Keep task operations resilient even if notification writes fail.
  }
}

const canUserAccessWorkspace = (
  user: Awaited<ReturnType<typeof getFirestoreSessionUser>>,
  workspace: WorkspaceRecord,
): boolean => {
  if ((workspace.excludedMemberIds ?? []).includes(user.id)) {
    return false
  }
  if (isPrivilegedRole(user.role)) {
    return true
  }
  if ((workspace.memberIds ?? []).includes(user.id)) {
    return true
  }
  if (workspace.boardRoles && workspace.boardRoles.length > 0) {
    return workspace.boardRoles.includes(user.role as Role)
  }
  if (!workspace.boardRole) {
    return true
  }
  return user.role === workspace.boardRole
}

const getWorkspaceForUser = async (
  token: string,
  workspaceId: string,
): Promise<{
  user: Awaited<ReturnType<typeof getFirestoreSessionUser>>
  workspace: WorkspaceRecord
}> => {
  const workspacesCollection = getWorkspacesCollection()
  if (!workspacesCollection) {
    throw new Error('Firestore workspaces is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const workspaceRef = doc(workspacesCollection, workspaceId)
  const snapshot = await getDoc(workspaceRef)
  if (!snapshot.exists()) {
    throw new Error('Workspace not found.')
  }

  const workspace = mapWorkspaceRecord(snapshot.id, snapshot.data() as UpdateData<DocumentData>)
  if (!canUserAccessWorkspace(user, workspace)) {
    throw new Error('You are not allowed to access this board.')
  }

  return { user, workspace }
}

const sortWorkspaces = (workspaces: WorkspaceRecord[]): WorkspaceRecord[] =>
  [...workspaces].sort((left, right) => left.workspaceName.localeCompare(right.workspaceName))

const sortTasks = (tasks: TaskRecord[]): TaskRecord[] =>
  [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

const filterWorkspacesByDeletedState = (
  workspaces: WorkspaceRecord[],
  queryFilter?: {
    includeDeleted?: boolean
    deletedOnly?: boolean
  },
): WorkspaceRecord[] => {
  if (queryFilter?.deletedOnly) {
    return workspaces.filter((workspace) => Boolean(workspace.isDeleted))
  }
  if (queryFilter?.includeDeleted) {
    return workspaces
  }
  return workspaces.filter((workspace) => !workspace.isDeleted)
}

const filterTasksByDeletedState = (
  tasks: TaskRecord[],
  queryFilter?: {
    includeDeleted?: boolean
    deletedOnly?: boolean
  },
): TaskRecord[] => {
  if (queryFilter?.deletedOnly) {
    return tasks.filter((task) => Boolean(task.isDeleted))
  }
  if (queryFilter?.includeDeleted) {
    return tasks
  }
  return tasks.filter((task) => !task.isDeleted)
}

export const isFirestoreTasksActive = (): boolean =>
  Boolean(getWorkspacesCollection()) && Boolean(getTasksCollection())

export const listFirestoreWorkspaces = async (
  token: string,
  queryFilter?: {
    includeDeleted?: boolean
    deletedOnly?: boolean
  },
): Promise<WorkspaceRecord[]> => {
  const workspacesCollection = getWorkspacesCollection()
  if (!workspacesCollection) {
    throw new Error('Firestore workspaces is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const snapshot = await getDocs(workspacesCollection)
  const workspaces = snapshot.docs.map((item) =>
    mapWorkspaceRecord(item.id, item.data() as UpdateData<DocumentData>),
  )
  return sortWorkspaces(
    filterWorkspacesByDeletedState(
      workspaces.filter((workspace) => canUserAccessWorkspace(user, workspace)),
      queryFilter,
    ),
  )
}

export const getFirestoreWorkspaceById = async (
  token: string,
  workspaceId: string,
): Promise<WorkspaceRecord> => {
  const { workspace } = await getWorkspaceForUser(token, workspaceId)
  if (workspace.isDeleted) {
    throw new Error('Workspace not found.')
  }
  return workspace
}

export const createFirestoreWorkspace = async (
  token: string,
  payload: {
    workspaceName: string
    memberIds?: string[]
    visibility?: 'Private' | 'Organization-wide'
    boardRole?: Role
    boardRoles?: Role[]
  },
): Promise<WorkspaceRecord> => {
  const workspacesCollection = getWorkspacesCollection()
  if (!workspacesCollection) {
    throw new Error('Firestore workspaces is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(user.role)) {
    throw new Error('Only Owner or Admin can create boards.')
  }

  const workspaceName = payload.workspaceName.trim()
  if (!workspaceName) {
    throw new Error('Workspace name is required.')
  }

  const createdAt = nowIso()
  const memberIds = toStringArray(payload.memberIds)
  const nextMemberIds = memberIds.length > 0 ? memberIds : [user.id]
  const workspaceDocument = {
    workspaceName,
    memberIds: nextMemberIds,
    visibility: isVisibility(payload.visibility) ? payload.visibility : 'Private',
    boardRole: isRole(payload.boardRole) ? payload.boardRole : 'Telecaller',
    boardRoles: Array.isArray(payload.boardRoles)
      ? payload.boardRoles.filter((v): v is Role => isRole(v))
      : [],
    excludedMemberIds: [],
    isDeleted: false,
    createdAt,
    updatedAt: createdAt,
    createdBy: user.id,
  }

  const created = await addDoc(workspacesCollection, workspaceDocument)
  return mapWorkspaceRecord(created.id, workspaceDocument)
}

export const removeFirestoreWorkspace = async (
  token: string,
  workspaceId: string,
): Promise<void> => {
  const workspacesCollection = getWorkspacesCollection()
  const tasksCollection = getTasksCollection()
  if (!workspacesCollection || !tasksCollection) {
    throw new Error('Firestore workspaces is not configured.')
  }

  const { user } = await getWorkspaceForUser(token, workspaceId)
  if (!isPrivilegedRole(user.role)) {
    throw new Error('Only Owner or Admin can delete boards.')
  }

  const taskSnapshot = await getDocs(
    query(tasksCollection, where('workspaceId', '==', workspaceId)),
  )
  for (const taskDoc of taskSnapshot.docs) {
    await deleteTaskCascadeById(taskDoc.id)
  }

  const workspaceRef = doc(workspacesCollection, workspaceId)
  await deleteDoc(workspaceRef)
}

export const updateFirestoreWorkspace = async (
  token: string,
  workspaceId: string,
  payload: Partial<
    Pick<
      WorkspaceRecord,
      | 'workspaceName'
      | 'memberIds'
      | 'visibility'
      | 'boardRole'
      | 'boardRoles'
      | 'excludedMemberIds'
      | 'isDeleted'
      | 'deletedAt'
      | 'deletedBy'
    >
  >,
): Promise<WorkspaceRecord> => {
  const workspacesCollection = getWorkspacesCollection()
  if (!workspacesCollection) {
    throw new Error('Firestore workspaces is not configured.')
  }

  const { user } = await getWorkspaceForUser(token, workspaceId)
  if (!isPrivilegedRole(user.role)) {
    throw new Error('Only Owner or Admin can update boards.')
  }

  const updatePayload: Record<string, unknown> = {
    updatedAt: nowIso(),
  }

  if (typeof payload.workspaceName === 'string' && payload.workspaceName.trim()) {
    updatePayload.workspaceName = payload.workspaceName.trim()
  }
  if (Array.isArray(payload.memberIds)) {
    updatePayload.memberIds = toStringArray(payload.memberIds)
  }
  if (isVisibility(payload.visibility)) {
    updatePayload.visibility = payload.visibility
  }
  if (isRole(payload.boardRole)) {
    updatePayload.boardRole = payload.boardRole
  }
  if (Array.isArray(payload.boardRoles)) {
    updatePayload.boardRoles = payload.boardRoles.filter((v): v is Role => isRole(v))
  }
  if (Array.isArray(payload.excludedMemberIds)) {
    updatePayload.excludedMemberIds = toStringArray(payload.excludedMemberIds)
  }
  if (payload.isDeleted !== undefined) {
    updatePayload.isDeleted = Boolean(payload.isDeleted)
  }
  if (payload.deletedAt !== undefined) {
    const normalized = toOptionalString(payload.deletedAt)
    if (normalized) {
      updatePayload.deletedAt = normalized
    }
  }
  if (payload.deletedBy !== undefined) {
    const normalized = toOptionalString(payload.deletedBy)
    if (normalized) {
      updatePayload.deletedBy = normalized
    }
  }

  const workspaceRef = doc(workspacesCollection, workspaceId)
  await updateDoc(workspaceRef, updatePayload as UpdateData<DocumentData>)
  const updated = await getDoc(workspaceRef)
  if (!updated.exists()) {
    throw new Error('Workspace not found.')
  }

  return mapWorkspaceRecord(updated.id, updated.data() as UpdateData<DocumentData>)
}

export const listFirestoreWorkspaceTasks = async (
  token: string,
  workspaceId: string,
  queryFilter?: {
    includeDeleted?: boolean
    deletedOnly?: boolean
  },
): Promise<TaskRecord[]> => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    throw new Error('Firestore tasks is not configured.')
  }

  await getWorkspaceForUser(token, workspaceId)
  const snapshot = await getDocs(query(tasksCollection, where('workspaceId', '==', workspaceId)))
  const tasks = snapshot.docs.map((item) =>
    mapTaskRecord(item.id, item.data() as UpdateData<DocumentData>),
  )
  return sortTasks(filterTasksByDeletedState(tasks, queryFilter))
}

export const listFirestoreTasks = async (
  token: string,
  queryFilter?: {
    workspaceId?: string
    assignedTo?: string
    status?: TaskRecord['status']
    includeDeleted?: boolean
    deletedOnly?: boolean
  },
): Promise<TaskRecord[]> => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    throw new Error('Firestore tasks is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const accessibleWorkspaces = await listFirestoreWorkspaces(token, {
    includeDeleted: Boolean(queryFilter?.includeDeleted || queryFilter?.deletedOnly),
  })
  const accessibleWorkspaceIds = new Set(accessibleWorkspaces.map((workspace) => workspace.id))

  if (queryFilter?.workspaceId && !accessibleWorkspaceIds.has(queryFilter.workspaceId)) {
    return []
  }

  const snapshot = queryFilter?.workspaceId
    ? await getDocs(query(tasksCollection, where('workspaceId', '==', queryFilter.workspaceId)))
    : await getDocs(tasksCollection)

  const tasks = snapshot.docs
    .map((item) => mapTaskRecord(item.id, item.data() as UpdateData<DocumentData>))
    .filter((task) => accessibleWorkspaceIds.has(task.workspaceId))
    .filter((task) => {
      if (queryFilter?.assignedTo && task.assignedTo !== queryFilter.assignedTo) {
        return false
      }
      if (queryFilter?.status && task.status !== queryFilter.status) {
        return false
      }
      if (
        !isPrivilegedRole(user.role) &&
        queryFilter?.assignedTo &&
        queryFilter.assignedTo !== user.id
      ) {
        return false
      }
      return true
    })

  return sortTasks(filterTasksByDeletedState(tasks, queryFilter))
}

export const getFirestoreTaskById = async (token: string, taskId: string): Promise<TaskRecord> => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    throw new Error('Firestore tasks is not configured.')
  }

  const taskRef = doc(tasksCollection, taskId)
  const snapshot = await getDoc(taskRef)
  if (!snapshot.exists()) {
    throw new Error('Task not found.')
  }

  const task = mapTaskRecord(snapshot.id, snapshot.data() as UpdateData<DocumentData>)
  await getWorkspaceForUser(token, task.workspaceId)
  return task
}

export const createFirestoreTask = async (
  token: string,
  payload: {
    workspaceId: string
    taskName: string
    description: string
    dueDate: string
    assignedTo: string
    priority?: TaskRecord['priority']
    status?: TaskRecord['status']
  },
): Promise<TaskRecord> => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    throw new Error('Firestore tasks is not configured.')
  }

  const { user } = await getWorkspaceForUser(token, payload.workspaceId)
  const taskName = payload.taskName.trim()
  if (!taskName) {
    throw new Error('Task name is required.')
  }

  const updatedAt = nowIso()
  const taskDocument: Omit<TaskRecord, 'id'> & { createdAt: string; createdBy: string } = {
    workspaceId: payload.workspaceId,
    taskName,
    description: payload.description.trim(),
    dueDate: payload.dueDate,
    assignedTo: payload.assignedTo.trim(),
    priority: isPriority(payload.priority) ? payload.priority : 'Medium',
    status: String(payload.status ?? 'Todo'),
    isDeleted: false,
    updatedAt,
    comments: [],
    attachments: [],
    createdAt: updatedAt,
    createdBy: user.id,
  }

  const baseDocId = toTaskDocIdBase(taskName)
  let nextDocId = baseDocId
  let suffix = 2
  // Keep task document IDs deterministic and task-name-based instead of random IDs.
  while ((await getDoc(doc(tasksCollection, nextDocId))).exists()) {
    nextDocId = `${baseDocId}-${suffix}`
    suffix += 1
  }

  await setDoc(doc(tasksCollection, nextDocId), taskDocument)
  const createdTask = mapTaskRecord(nextDocId, taskDocument)
  await safeCreateTaskNotificationsForRecipients({
    recipientIds: createdTask.assignedTo ? [createdTask.assignedTo] : [],
    task: createdTask,
    senderId: user.id,
    senderName: user.name,
    type: 'task-assigned',
    messagePreview: `${user.name} assigned you a task.`,
  })
  return createdTask
}

export const updateFirestoreTask = async (
  token: string,
  taskId: string,
  payload: Partial<TaskRecord>,
): Promise<TaskRecord> => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    throw new Error('Firestore tasks is not configured.')
  }

  const current = await getFirestoreTaskById(token, taskId)
  const taskRef = doc(tasksCollection, taskId)
  const updatePayload: Record<string, unknown> = {
    updatedAt: nowIso(),
  }

  if (payload.taskName !== undefined) updatePayload.taskName = payload.taskName.trim()
  if (payload.description !== undefined) updatePayload.description = payload.description.trim()
  if (payload.dueDate !== undefined) updatePayload.dueDate = payload.dueDate
  if (payload.assignedTo !== undefined) updatePayload.assignedTo = payload.assignedTo.trim()
  if (payload.priority !== undefined)
    updatePayload.priority = isPriority(payload.priority) ? payload.priority : current.priority
  if (payload.status !== undefined) updatePayload.status = payload.status
  if (payload.isDeleted !== undefined) updatePayload.isDeleted = Boolean(payload.isDeleted)
  if (payload.deletedAt !== undefined) updatePayload.deletedAt = payload.deletedAt
  if (payload.deletedBy !== undefined) updatePayload.deletedBy = payload.deletedBy.trim()
  if (payload.comments !== undefined) updatePayload.comments = payload.comments
  if (payload.attachments !== undefined) updatePayload.attachments = payload.attachments

  await updateDoc(taskRef, updatePayload as UpdateData<DocumentData>)
  const deletedBy = payload.deletedBy !== undefined ? payload.deletedBy.trim() : current.deletedBy
  return {
    ...current,
    ...payload,
    taskName: payload.taskName !== undefined ? payload.taskName.trim() : current.taskName,
    description:
      payload.description !== undefined ? payload.description.trim() : current.description,
    assignedTo: payload.assignedTo !== undefined ? payload.assignedTo.trim() : current.assignedTo,
    deletedBy,
    updatedAt: String(updatePayload.updatedAt),
  }
}

export const removeFirestoreTask = async (token: string, taskId: string): Promise<void> => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    throw new Error('Firestore tasks is not configured.')
  }

  await getFirestoreTaskById(token, taskId)
  await deleteTaskCascadeById(taskId)
}

export const addFirestoreTaskComment = async (
  token: string,
  taskId: string,
  comment: string,
): Promise<{ id: string; userId: string; comment: string; timestamp: string }> => {
  const user = await getFirestoreSessionUser(token)
  const task = await getFirestoreTaskById(token, taskId)
  const commentText = comment.trim()
  if (!commentText) {
    throw new Error('Comment is required.')
  }

  const entry = {
    id: randomId('comment'),
    userId: user.id,
    comment: commentText,
    timestamp: nowIso(),
  }
  const nextComments = [...(task.comments ?? []), entry]
  await updateFirestoreTask(token, taskId, { comments: nextComments })
  return entry
}

export const subscribeFirestoreTaskConversation = (
  token: string,
  taskId: string,
  onData: (snapshot: TaskConversationSnapshot) => void,
  onError: (error: Error) => void,
): (() => void) => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    onError(new Error('Firestore tasks is not configured.'))
    return () => undefined
  }

  let active = true
  let taskRecord: TaskRecord | null = null
  let realtimeMessages: TaskMessageRecord[] = []
  const cleanupFns: Unsubscribe[] = []

  const emit = (): void => {
    if (!active || !taskRecord) {
      return
    }

    const legacy = buildLegacyTaskConversation(taskRecord)
    const mergedMessages = sortTaskMessages([...legacy.messages, ...realtimeMessages])

    onData({
      taskId,
      messages: mergedMessages,
      activities: legacy.activities,
      typing: [],
      readReceipts: [],
    })
  }

  const pushError = (error: unknown): void => {
    if (!active) {
      return
    }
    if (error instanceof Error) {
      onError(error)
      return
    }
    onError(new Error(String(error ?? 'Task realtime subscription failed.')))
  }

  void (async () => {
    try {
      await getFirestoreTaskById(token, taskId)
      if (!active) {
        return
      }

      const taskRef = doc(tasksCollection, taskId)
      cleanupFns.push(
        onSnapshot(
          taskRef,
          (snapshot) => {
            if (!snapshot.exists()) {
              pushError(new Error('Task not found.'))
              return
            }
            taskRecord = mapTaskRecord(snapshot.id, snapshot.data() as UpdateData<DocumentData>)
            emit()
          },
          pushError,
        ),
      )

      const messagesCollection = getTaskMessagesCollection(taskId)
      if (!messagesCollection) {
        throw new Error('Firestore tasks is not configured.')
      }

      const messagesQuery = query(messagesCollection)
      cleanupFns.push(
        onSnapshot(
          messagesQuery,
          (snapshot) => {
            realtimeMessages = sortTaskMessages(
              snapshot.docs
                .map((item) =>
                  mapTaskMessageRecord(taskId, item.id, item.data() as UpdateData<DocumentData>),
                )
                .filter((item): item is TaskMessageRecord => Boolean(item)),
            )
            emit()
          },
          pushError,
        ),
      )
    } catch (error) {
      pushError(error)
    }
  })()

  return () => {
    active = false
    cleanupFns.forEach((cleanup) => cleanup())
  }
}

export const sendFirestoreTaskMessage = async (
  token: string,
  taskId: string,
  payload: TaskOutgoingMessagePayload,
): Promise<{ id: string }> => {
  const messagesCollection = getTaskMessagesCollection(taskId)
  if (!messagesCollection) {
    throw new Error('Firestore tasks is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const task = await getFirestoreTaskById(token, taskId)
  const { workspace } = await getWorkspaceForUser(token, task.workspaceId)

  const messageType = payload.type
  const textPayload = 'text' in payload ? String(payload.text ?? '').trim() : ''

  const normalizedPollOptions =
    messageType === 'poll'
      ? (payload.options ?? [])
          .map((item) => ({
            id: String(item.id ?? '').trim() || randomId('poll-option'),
            label: String(item.label ?? '').trim(),
          }))
          .filter(
            (item, index, rows) =>
              item.label && rows.findIndex((candidate) => candidate.id === item.id) === index,
          )
      : []
  const normalizedPollId =
    messageType === 'poll' ? String(payload.pollId ?? '').trim() || randomId('poll') : ''

  if (messageType === 'text' && !textPayload) {
    throw new Error('Message is required.')
  }
  if (messageType === 'image' && !String(payload.imageUrl ?? '').trim()) {
    throw new Error('Image URL is required.')
  }
  if (messageType === 'image' && isDataUrl(String(payload.imageUrl ?? '').trim())) {
    throw new Error('Base64 image payload is not allowed. Upload file and send URL.')
  }
  if (
    messageType === 'file' &&
    (!String(payload.fileUrl ?? '').trim() || !String(payload.fileName ?? '').trim())
  ) {
    throw new Error('File URL and file name are required.')
  }
  if (messageType === 'file' && isDataUrl(String(payload.fileUrl ?? '').trim())) {
    throw new Error('Base64 file payload is not allowed. Upload file and send URL.')
  }
  if (
    messageType === 'poll' &&
    (!String(payload.question ?? '').trim() || normalizedPollOptions.length < 2)
  ) {
    throw new Error('Poll question and at least two options are required.')
  }
  if (
    messageType === 'poll-vote' &&
    (!String(payload.pollId ?? '').trim() || !String(payload.optionId ?? '').trim())
  ) {
    throw new Error('Poll vote is invalid.')
  }

  const messageText =
    messageType === 'text'
      ? textPayload
      : messageType === 'image'
        ? textPayload || 'Image'
        : messageType === 'file'
          ? textPayload || String(payload.fileName ?? '').trim()
          : messageType === 'poll'
            ? String(payload.question ?? '').trim()
            : textPayload || 'Voted on poll'

  const createdAt = nowIso()
  const messageDoc: Record<string, unknown> = {
    text: messageText,
    messageType,
    senderId: user.id,
    createdAt,
    clientCreatedAt: createdAt,
  }

  if (messageType === 'image') {
    messageDoc.imageUrl = String(payload.imageUrl ?? '').trim()
    if (payload.fileName) {
      messageDoc.fileName = String(payload.fileName).trim()
    }
  }
  if (messageType === 'file') {
    messageDoc.fileUrl = String(payload.fileUrl ?? '').trim()
    messageDoc.fileName = String(payload.fileName ?? '').trim()
    if (payload.mimeType) {
      messageDoc.fileMimeType = String(payload.mimeType).trim()
    }
    if (
      typeof payload.sizeBytes === 'number' &&
      Number.isFinite(payload.sizeBytes) &&
      payload.sizeBytes > 0
    ) {
      messageDoc.fileSizeBytes = payload.sizeBytes
    }
  }
  if (messageType === 'poll') {
    messageDoc.poll = {
      pollId: normalizedPollId,
      question: String(payload.question ?? '').trim(),
      options: normalizedPollOptions,
    } satisfies TaskPollRecord
  }
  if (messageType === 'poll-vote') {
    messageDoc.pollVote = {
      pollId: String(payload.pollId ?? '').trim(),
      optionId: String(payload.optionId ?? '').trim(),
    } satisfies TaskPollVoteRecord
  }

  const created = await addDoc(messagesCollection, messageDoc)

  const recipients = collectTaskParticipantIds(task, workspace).filter(
    (memberId) => memberId !== user.id,
  )
  const messagePreview =
    messageType === 'text'
      ? messageText
      : messageType === 'image'
        ? 'Image shared'
        : messageType === 'file'
          ? `File shared: ${String(payload.fileName ?? '').trim()}`
          : messageType === 'poll'
            ? `Poll created: ${String(payload.question ?? '').trim()}`
            : 'Poll vote submitted'
  await safeCreateTaskNotificationsForRecipients({
    recipientIds: recipients,
    task,
    senderId: user.id,
    senderName: user.name,
    type: 'task-message',
    messagePreview,
  })
  await addFirestoreTaskComment(
    token,
    taskId,
    toActivityComment(`Message sent: ${toNotificationPreview(messagePreview)}`),
  )
  return { id: created.id }
}

export const deleteFirestoreTaskMessage = async (
  token: string,
  taskId: string,
  messageId: string,
  source?: TaskMessageRecord['source'],
): Promise<void> => {
  const user = await getFirestoreSessionUser(token)
  const task = await getFirestoreTaskById(token, taskId)
  const normalizedMessageId = String(messageId ?? '').trim()
  if (!normalizedMessageId) {
    throw new Error('Message id is required.')
  }

  const canDeleteByRole = isPrivilegedRole(user.role)
  const comments = task.comments ?? []
  const legacyComment = comments.find((item) => item.id === normalizedMessageId)

  if (source === 'legacy-comment' || (!source && legacyComment)) {
    if (!legacyComment) {
      return
    }
    if (!canDeleteByRole && legacyComment.userId !== user.id) {
      throw new Error('You can delete only your own messages.')
    }
    const nextComments = comments.filter((item) => item.id !== normalizedMessageId)
    await updateFirestoreTask(token, taskId, { comments: nextComments })
    await addFirestoreTaskComment(token, taskId, toActivityComment('Message deleted.'))
    return
  }

  const messagesCollection = getTaskMessagesCollection(taskId)
  if (!messagesCollection) {
    throw new Error('Firestore tasks is not configured.')
  }

  const messageRef = doc(messagesCollection, normalizedMessageId)
  const snapshot = await getDoc(messageRef)
  if (!snapshot.exists()) {
    return
  }

  const senderId = String(snapshot.data().senderId ?? '').trim()
  if (!canDeleteByRole && senderId !== user.id) {
    throw new Error('You can delete only your own messages.')
  }

  await deleteDoc(messageRef)
  await addFirestoreTaskComment(token, taskId, toActivityComment('Message deleted.'))
}

export const setFirestoreTaskTyping = async (
  token: string,
  taskId: string,
  isTyping: boolean,
): Promise<void> => {
  const typingCollection = getTaskTypingCollection(taskId)
  if (!typingCollection) {
    throw new Error('Firestore tasks is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  await getFirestoreTaskById(token, taskId)

  const typingRef = doc(typingCollection, user.id)
  await setDoc(
    typingRef,
    {
      userId: user.id,
      isTyping: Boolean(isTyping),
      updatedAt: nowIso(),
    },
    { merge: true },
  )
}

export const setFirestoreTaskReadReceipt = async (
  token: string,
  taskId: string,
  payload: { lastReadAt?: string; lastReadMessageId?: string },
): Promise<void> => {
  const readReceiptsCollection = getTaskReadReceiptsCollection(taskId)
  if (!readReceiptsCollection) {
    throw new Error('Firestore tasks is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  await getFirestoreTaskById(token, taskId)

  const readReceiptRef = doc(readReceiptsCollection, user.id)
  await setDoc(
    readReceiptRef,
    {
      userId: user.id,
      lastReadAt: normalizeTimestamp(payload.lastReadAt ?? nowIso()),
      lastReadMessageId: toOptionalString(payload.lastReadMessageId),
      updatedAt: nowIso(),
    },
    { merge: true },
  )
}

export const subscribeFirestoreTaskTyping = (
  token: string,
  taskId: string,
  onData: (rows: TaskTypingRecord[]) => void,
  onError: (error: Error) => void,
): (() => void) => {
  const typingCollection = getTaskTypingCollection(taskId)
  if (!typingCollection) {
    onError(new Error('Firestore tasks is not configured.'))
    return () => undefined
  }

  let active = true
  let unsubscribe: Unsubscribe = () => undefined

  const pushError = (error: unknown): void => {
    if (!active) {
      return
    }
    if (error instanceof Error) {
      onError(error)
      return
    }
    onError(new Error(String(error ?? 'Typing subscription failed.')))
  }

  void (async () => {
    try {
      await getFirestoreTaskById(token, taskId)
      if (!active) {
        return
      }

      unsubscribe = onSnapshot(
        typingCollection,
        (snapshot) => {
          const rows = snapshot.docs
            .map((item) => mapTaskTypingRecord(item.data() as UpdateData<DocumentData>))
            .filter((item): item is TaskTypingRecord => Boolean(item))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          onData(rows)
        },
        pushError,
      )
    } catch (error) {
      pushError(error)
    }
  })()

  return () => {
    active = false
    unsubscribe()
  }
}

export const subscribeFirestoreTaskReadReceipts = (
  token: string,
  taskId: string,
  onData: (rows: TaskReadReceiptRecord[]) => void,
  onError: (error: Error) => void,
): (() => void) => {
  const readReceiptsCollection = getTaskReadReceiptsCollection(taskId)
  if (!readReceiptsCollection) {
    onError(new Error('Firestore tasks is not configured.'))
    return () => undefined
  }

  let active = true
  let unsubscribe: Unsubscribe = () => undefined

  const pushError = (error: unknown): void => {
    if (!active) {
      return
    }
    if (error instanceof Error) {
      onError(error)
      return
    }
    onError(new Error(String(error ?? 'Read receipt subscription failed.')))
  }

  void (async () => {
    try {
      await getFirestoreTaskById(token, taskId)
      if (!active) {
        return
      }

      unsubscribe = onSnapshot(
        readReceiptsCollection,
        (snapshot) => {
          const rows = snapshot.docs
            .map((item) => mapTaskReadReceiptRecord(item.data() as UpdateData<DocumentData>))
            .filter((item): item is TaskReadReceiptRecord => Boolean(item))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          onData(rows)
        },
        pushError,
      )
    } catch (error) {
      pushError(error)
    }
  })()

  return () => {
    active = false
    unsubscribe()
  }
}

export const subscribeFirestoreTaskUnreadCount = (
  token: string,
  taskId: string,
  userId: string,
  onData: (count: number) => void,
  onError: (error: Error) => void,
): (() => void) => {
  const tasksCollection = getTasksCollection()
  if (!tasksCollection) {
    onError(new Error('Firestore tasks is not configured.'))
    return () => undefined
  }

  const normalizedUserId = String(userId ?? '').trim()
  if (!normalizedUserId) {
    onError(new Error('User id is required to subscribe unread count.'))
    return () => undefined
  }

  let active = true
  let taskRecord: TaskRecord | null = null
  let realtimeMessages: TaskMessageRecord[] = []
  let readReceipt: TaskReadReceiptRecord | null = null
  const cleanupFns: Unsubscribe[] = []

  const emit = (): void => {
    if (!active || !taskRecord) {
      return
    }

    const legacyMessages = buildLegacyTaskConversation(taskRecord).messages
    const deduped = new Map<string, TaskMessageRecord>()
    ;[...legacyMessages, ...realtimeMessages].forEach((item) => {
      deduped.set(item.id, item)
    })

    const mergedMessages = sortTaskMessages([...deduped.values()])
    const lastReadAt = readReceipt ? new Date(readReceipt.lastReadAt).getTime() : 0
    const normalizedLastReadAt = Number.isNaN(lastReadAt) ? 0 : lastReadAt

    const count = mergedMessages.filter((item) => {
      if (item.senderId === normalizedUserId) {
        return false
      }
      const createdAt = new Date(item.createdAt).getTime()
      if (Number.isNaN(createdAt)) {
        return false
      }
      return createdAt > normalizedLastReadAt
    }).length

    onData(count)
  }

  const pushError = (error: unknown): void => {
    if (!active) {
      return
    }
    if (error instanceof Error) {
      onError(error)
      return
    }
    onError(new Error(String(error ?? 'Task unread subscription failed.')))
  }

  void (async () => {
    try {
      await getFirestoreTaskById(token, taskId)
      if (!active) {
        return
      }

      const taskRef = doc(tasksCollection, taskId)
      cleanupFns.push(
        onSnapshot(
          taskRef,
          (snapshot) => {
            if (!snapshot.exists()) {
              pushError(new Error('Task not found.'))
              return
            }
            taskRecord = mapTaskRecord(snapshot.id, snapshot.data() as UpdateData<DocumentData>)
            emit()
          },
          pushError,
        ),
      )

      const messagesCollection = getTaskMessagesCollection(taskId)
      if (!messagesCollection) {
        throw new Error('Firestore tasks is not configured.')
      }
      cleanupFns.push(
        onSnapshot(
          messagesCollection,
          (snapshot) => {
            realtimeMessages = sortTaskMessages(
              snapshot.docs
                .map((item) =>
                  mapTaskMessageRecord(taskId, item.id, item.data() as UpdateData<DocumentData>),
                )
                .filter((item): item is TaskMessageRecord => Boolean(item)),
            )
            emit()
          },
          pushError,
        ),
      )

      const readReceiptsCollection = getTaskReadReceiptsCollection(taskId)
      if (!readReceiptsCollection) {
        throw new Error('Firestore tasks is not configured.')
      }
      const readReceiptRef = doc(readReceiptsCollection, normalizedUserId)
      cleanupFns.push(
        onSnapshot(
          readReceiptRef,
          (snapshot) => {
            if (!snapshot.exists()) {
              readReceipt = null
              emit()
              return
            }
            const mapped = mapTaskReadReceiptRecord(snapshot.data() as UpdateData<DocumentData>)
            if (mapped) {
              readReceipt = mapped
              emit()
              return
            }

            readReceipt = {
              userId: normalizedUserId,
              lastReadAt: nowIso(),
              updatedAt: nowIso(),
            }
            emit()
          },
          pushError,
        ),
      )
    } catch (error) {
      pushError(error)
    }
  })()

  return () => {
    active = false
    cleanupFns.forEach((cleanup) => cleanup())
  }
}

export const listFirestoreTaskNotifications = async (
  token: string,
): Promise<TaskNotificationRecord[]> => {
  const notificationsCollection = getTaskNotificationsCollection()
  if (!notificationsCollection) {
    throw new Error('Firestore notifications is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const snapshot = await getDocs(query(notificationsCollection, where('userId', '==', user.id)))
  const notifications = snapshot.docs
    .map((item) => mapTaskNotificationRecord(item.id, item.data() as UpdateData<DocumentData>))
    .filter((item): item is TaskNotificationRecord => Boolean(item))
  return sortTaskNotifications(notifications)
}

export const markFirestoreTaskNotificationRead = async (
  token: string,
  notificationId: string,
): Promise<TaskNotificationRecord> => {
  const notificationsCollection = getTaskNotificationsCollection()
  if (!notificationsCollection) {
    throw new Error('Firestore notifications is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const notificationRef = doc(notificationsCollection, notificationId)
  const snapshot = await getDoc(notificationRef)
  if (!snapshot.exists()) {
    throw new Error('Notification not found.')
  }

  const mapped = mapTaskNotificationRecord(snapshot.id, snapshot.data() as UpdateData<DocumentData>)
  if (!mapped) {
    throw new Error('Notification payload is invalid.')
  }
  if (mapped.userId !== user.id) {
    throw new Error('Unauthorized notification access.')
  }

  if (!mapped.readAt) {
    const readAt = nowIso()
    await updateDoc(notificationRef, { readAt })
    return { ...mapped, readAt }
  }

  return mapped
}

export const markAllFirestoreTaskNotificationsRead = async (token: string): Promise<void> => {
  const notificationsCollection = getTaskNotificationsCollection()
  if (!notificationsCollection) {
    throw new Error('Firestore notifications is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const snapshot = await getDocs(query(notificationsCollection, where('userId', '==', user.id)))
  const updates: Promise<void>[] = []
  for (const row of snapshot.docs) {
    const mapped = mapTaskNotificationRecord(row.id, row.data() as UpdateData<DocumentData>)
    if (!mapped || mapped.userId !== user.id || mapped.readAt) {
      continue
    }
    updates.push(updateDoc(doc(notificationsCollection, row.id), { readAt: nowIso() }))
  }
  await Promise.all(updates)
}

export const clearAllFirestoreTaskNotifications = async (token: string): Promise<void> => {
  const notificationsCollection = getTaskNotificationsCollection()
  if (!notificationsCollection) {
    throw new Error('Firestore notifications is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const snapshot = await getDocs(query(notificationsCollection, where('userId', '==', user.id)))
  const deletes = snapshot.docs.map((row) => deleteDoc(doc(notificationsCollection, row.id)))
  await Promise.all(deletes)
}

export const subscribeFirestoreTaskNotifications = (
  token: string,
  userId: string,
  onData: (rows: TaskNotificationRecord[]) => void,
  onError: (error: Error) => void,
): (() => void) => {
  const notificationsCollection = getTaskNotificationsCollection()
  if (!notificationsCollection) {
    onError(new Error('Firestore notifications is not configured.'))
    return () => undefined
  }

  const normalizedUserId = String(userId ?? '').trim()
  if (!normalizedUserId) {
    onError(new Error('User id is required to subscribe notifications.'))
    return () => undefined
  }

  let active = true
  let unsubscribe: Unsubscribe = () => undefined

  const pushError = (error: unknown): void => {
    if (!active) {
      return
    }
    if (error instanceof Error) {
      onError(error)
      return
    }
    onError(new Error(String(error ?? 'Task notification subscription failed.')))
  }

  void (async () => {
    try {
      const sessionUser = await getFirestoreSessionUser(token)
      if (!active) {
        return
      }
      if (sessionUser.id !== normalizedUserId) {
        throw new Error('Unauthorized notification access.')
      }

      const notificationsQuery = query(
        notificationsCollection,
        where('userId', '==', normalizedUserId),
      )
      unsubscribe = onSnapshot(
        notificationsQuery,
        (snapshot) => {
          const rows = snapshot.docs
            .map((item) =>
              mapTaskNotificationRecord(item.id, item.data() as UpdateData<DocumentData>),
            )
            .filter((item): item is TaskNotificationRecord => Boolean(item))
          onData(sortTaskNotifications(rows))
        },
        pushError,
      )
    } catch (error) {
      pushError(error)
    }
  })()

  return () => {
    active = false
    unsubscribe()
  }
}
