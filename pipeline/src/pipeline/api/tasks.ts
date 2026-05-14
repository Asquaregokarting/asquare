import {
  addFirestoreTaskComment,
  createFirestoreTask,
  createFirestoreWorkspace,
  clearAllFirestoreTaskNotifications,
  deleteFirestoreTaskMessage,
  getFirestoreTaskById,
  getFirestoreWorkspaceById,
  listFirestoreTaskNotifications,
  listFirestoreTasks,
  listFirestoreWorkspaceTasks,
  listFirestoreWorkspaces,
  markAllFirestoreTaskNotificationsRead,
  markFirestoreTaskNotificationRead,
  sendFirestoreTaskMessage,
  setFirestoreTaskReadReceipt,
  setFirestoreTaskTyping,
  subscribeFirestoreTaskNotifications,
  subscribeFirestoreTaskConversation,
  subscribeFirestoreTaskReadReceipts,
  subscribeFirestoreTaskUnreadCount,
  subscribeFirestoreTaskTyping,
  removeFirestoreTask,
  removeFirestoreWorkspace,
  updateFirestoreWorkspace,
  updateFirestoreTask
} from "./tasks-firestore";
import {
  Role,
  TaskConversationSnapshot,
  TaskMessageRecord,
  TaskOutgoingMessagePayload,
  TaskPollOptionRecord,
  TaskNotificationRecord,
  TaskReadReceiptRecord,
  TaskRecord,
  TaskTypingRecord,
  WorkspaceRecord
} from "./types";

export interface TaskQuery {
  workspaceId?: string;
  assignedTo?: string;
  status?: TaskRecord["status"];
  includeDeleted?: boolean;
  deletedOnly?: boolean;
}

export interface WorkspaceQuery {
  includeDeleted?: boolean;
  deletedOnly?: boolean;
}

const randomId = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const normalizePollOptions = (options: TaskPollOptionRecord[]): TaskPollOptionRecord[] => {
  const seen = new Set<string>();
  const rows: TaskPollOptionRecord[] = [];
  for (const option of options) {
    const id = String(option.id ?? "").trim() || randomId("poll-option");
    const label = String(option.label ?? "").trim();
    if (!label) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, label });
  }
  return rows;
};

const normalizeOutgoingMessagePayload = (payload: TaskOutgoingMessagePayload): TaskOutgoingMessagePayload => {
  if (payload.type === "text") {
    return { type: "text", text: String(payload.text ?? "").trim() };
  }
  if (payload.type === "image") {
    return {
      type: "image",
      imageUrl: String(payload.imageUrl ?? "").trim(),
      text: String(payload.text ?? "").trim(),
      fileName: payload.fileName ? String(payload.fileName).trim() : undefined
    };
  }
  if (payload.type === "file") {
    return {
      type: "file",
      fileUrl: String(payload.fileUrl ?? "").trim(),
      fileName: String(payload.fileName ?? "").trim(),
      text: String(payload.text ?? "").trim(),
      mimeType: payload.mimeType ? String(payload.mimeType).trim() : undefined,
      sizeBytes: typeof payload.sizeBytes === "number" && Number.isFinite(payload.sizeBytes) ? payload.sizeBytes : undefined
    };
  }
  if (payload.type === "poll") {
    return {
      type: "poll",
      question: String(payload.question ?? "").trim(),
      pollId: payload.pollId ? String(payload.pollId).trim() : undefined,
      options: normalizePollOptions(payload.options ?? [])
    };
  }
  return {
    type: "poll-vote",
    pollId: String(payload.pollId ?? "").trim(),
    optionId: String(payload.optionId ?? "").trim(),
    text: String(payload.text ?? "").trim()
  };
};

export const tasksApi = {
  listWorkspaces(token: string, query: WorkspaceQuery = {}): Promise<{ workspaces: WorkspaceRecord[] }> {
    return listFirestoreWorkspaces(token, query).then((workspaces) => ({ workspaces }));
  },
  getWorkspace(token: string, workspaceId: string): Promise<{ workspace: WorkspaceRecord }> {
    return getFirestoreWorkspaceById(token, workspaceId).then((workspace) => ({ workspace }));
  },
  createWorkspace(
    token: string,
    payload: {
      workspaceName: string;
      memberIds?: string[];
      visibility?: "Private" | "Organization-wide";
      boardRole?: Role;
      boardRoles?: Role[];
    }
  ): Promise<{ workspace: WorkspaceRecord }> {
    return createFirestoreWorkspace(token, payload).then((workspace) => ({ workspace }));
  },
  removeWorkspace(token: string, workspaceId: string): Promise<{ ok: true }> {
    return removeFirestoreWorkspace(token, workspaceId).then(() => ({ ok: true as const }));
  },
  updateWorkspace(
    token: string,
    workspaceId: string,
    payload: Partial<
      Pick<
        WorkspaceRecord,
        "workspaceName" | "memberIds" | "visibility" | "boardRole" | "boardRoles" | "excludedMemberIds" | "isDeleted" | "deletedAt" | "deletedBy"
      >
    >
  ): Promise<{ workspace: WorkspaceRecord }> {
    return updateFirestoreWorkspace(token, workspaceId, payload).then((workspace) => ({ workspace }));
  },
  listWorkspaceTasks(
    token: string,
    workspaceId: string,
    queryFilter: Pick<TaskQuery, "includeDeleted" | "deletedOnly"> = {}
  ): Promise<{ tasks: TaskRecord[] }> {
    return listFirestoreWorkspaceTasks(token, workspaceId, queryFilter).then((tasks) => ({ tasks }));
  },
  listTasks(token: string, query: TaskQuery = {}): Promise<{ tasks: TaskRecord[] }> {
    return listFirestoreTasks(token, query).then((tasks) => ({ tasks }));
  },
  getTask(token: string, taskId: string): Promise<{ task: TaskRecord }> {
    return getFirestoreTaskById(token, taskId).then((task) => ({ task }));
  },
  createTask(
    token: string,
    payload: {
      workspaceId: string;
      taskName: string;
      description: string;
      dueDate: string;
      assignedTo: string;
      priority?: TaskRecord["priority"];
      status?: TaskRecord["status"];
    }
  ): Promise<{ task: TaskRecord }> {
    return createFirestoreTask(token, payload).then((task) => ({ task }));
  },
  updateTask(token: string, taskId: string, payload: Partial<TaskRecord>): Promise<{ task: TaskRecord }> {
    return updateFirestoreTask(token, taskId, payload).then((task) => ({ task }));
  },
  removeTask(token: string, taskId: string): Promise<{ ok: true }> {
    return removeFirestoreTask(token, taskId).then(() => ({ ok: true as const }));
  },
  subscribeTaskConversation(
    token: string,
    taskId: string,
    onData: (snapshot: TaskConversationSnapshot) => void,
    onError: (error: Error) => void
  ): () => void {
    return subscribeFirestoreTaskConversation(token, taskId, onData, onError);
  },
  sendTaskMessage(token: string, taskId: string, text: string): Promise<{ id: string }> {
    return tasksApi.sendTaskRichMessage(token, taskId, { type: "text", text });
  },
  sendTaskRichMessage(token: string, taskId: string, payload: TaskOutgoingMessagePayload): Promise<{ id: string }> {
    const normalizedPayload = normalizeOutgoingMessagePayload(payload);
    return sendFirestoreTaskMessage(token, taskId, normalizedPayload);
  },
  deleteTaskMessage(token: string, taskId: string, messageId: string, source?: TaskMessageRecord["source"]): Promise<{ ok: true }> {
    return deleteFirestoreTaskMessage(token, taskId, messageId, source).then(() => ({ ok: true as const }));
  },
  setTaskTyping(token: string, taskId: string, isTyping: boolean): Promise<void> {
    return setFirestoreTaskTyping(token, taskId, isTyping);
  },
  setTaskReadReceipt(
    token: string,
    taskId: string,
    payload: { lastReadAt?: string; lastReadMessageId?: string }
  ): Promise<void> {
    return setFirestoreTaskReadReceipt(token, taskId, payload);
  },
  subscribeTaskTyping(
    token: string,
    taskId: string,
    onData: (rows: TaskTypingRecord[]) => void,
    onError: (error: Error) => void
  ): () => void {
    return subscribeFirestoreTaskTyping(token, taskId, onData, onError);
  },
  subscribeTaskReadReceipts(
    token: string,
    taskId: string,
    onData: (rows: TaskReadReceiptRecord[]) => void,
    onError: (error: Error) => void
  ): () => void {
    return subscribeFirestoreTaskReadReceipts(token, taskId, onData, onError);
  },
  subscribeTaskUnreadCount(
    token: string,
    taskId: string,
    userId: string,
    onData: (count: number) => void,
    onError: (error: Error) => void
  ): () => void {
    return subscribeFirestoreTaskUnreadCount(token, taskId, userId, onData, onError);
  },
  listTaskNotifications(token: string): Promise<{ notifications: TaskNotificationRecord[] }> {
    return listFirestoreTaskNotifications(token).then((notifications) => ({ notifications }));
  },
  markTaskNotificationRead(token: string, notificationId: string): Promise<{ notification: TaskNotificationRecord }> {
    return markFirestoreTaskNotificationRead(token, notificationId).then((notification) => ({ notification }));
  },
  markAllTaskNotificationsRead(token: string): Promise<{ ok: true }> {
    return markAllFirestoreTaskNotificationsRead(token).then(() => ({ ok: true as const }));
  },
  clearAllTaskNotifications(token: string): Promise<{ ok: true }> {
    return clearAllFirestoreTaskNotifications(token).then(() => ({ ok: true as const }));
  },
  subscribeTaskNotifications(
    token: string,
    userId: string,
    onData: (rows: TaskNotificationRecord[]) => void,
    onError: (error: Error) => void
  ): () => void {
    return subscribeFirestoreTaskNotifications(token, userId, onData, onError);
  },
  addComment(token: string, taskId: string, comment: string): Promise<{ comment: { id: string; comment: string } }> {
    return addFirestoreTaskComment(token, taskId, comment).then((entry) => ({ comment: { id: entry.id, comment: entry.comment } }));
  }
};
