import {
  LoginResponse,
  TaskRecord,
  UserRecord,
  WorkspaceRecord,
  TransactionRecord,
  KartRecord,
  SessionRecord,
  QueueEntryRecord,
  IncidentRecord,
  ContactRecord,
  TodoRecord,
  FileRecord,
  TaskNotificationRecord,
  AuditLogRecord,
  SuperfoneEventQuery,
  SuperfoneInteraktControlsResponse,
  SuperfoneEventsResponse,
  ActivityBookingRecord,
  ActivityRecord,
  BranchLocationKey
} from "./types";
import { parseSuperfoneEventRecords, parseSuperfoneInteraktControlsResponse } from "./lead-normalizers";
import { appBuildTarget, resolveHostedUrl } from "../app/runtime";

const normalizeApiBaseUrl = (value: string | undefined): string => {
  const configured = (value ?? "").trim();
  const fallback = appBuildTarget === "native" ? "" : `${import.meta.env.BASE_URL ?? "/"}api/v1`;
  const resolved = configured || fallback;
  return resolved.endsWith("/") ? resolved.slice(0, -1) : resolved;
};

const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API !== "false";
const MOCK_STATE_KEY = "pipeline-mock-state-v1";
const SUPERFONE_WEBHOOK_URL = (
  import.meta.env.VITE_SUPERFONE_WEBHOOK_URL ?? (appBuildTarget === "native" ? "" : `${import.meta.env.BASE_URL}superfone-webhook.php`)
).trim();
const SUPERFONE_WEBHOOK_TOKEN = (import.meta.env.VITE_SUPERFONE_WEBHOOK_TOKEN ?? "").trim();
const SUPERFONE_WEBHOOK_MODE = (import.meta.env.VITE_SUPERFONE_WEBHOOK_MODE ?? "events").trim() || "events";
const SUPERFONE_WEBHOOK_LIMIT = Math.min(
  Math.max(Number(import.meta.env.VITE_SUPERFONE_WEBHOOK_LIMIT ?? "200"), 1),
  500
);
const isConfiguredSuperfoneToken = (token: string): boolean => {
  const normalized = token.trim();
  return normalized.length > 0 && !/^replace_with_/i.test(normalized);
};

interface MockState {
  users: Array<
    UserRecord & {
      phone: string;
      workspaceIds: string[];
      password: string;
      mustChangePassword: boolean;
    }
  >;
  workspaces: WorkspaceRecord[];
  tasks: TaskRecord[];
  transactions: TransactionRecord[];
  karts: KartRecord[];
  sessions: SessionRecord[];
  queue: QueueEntryRecord[];
  incidents: IncidentRecord[];
  contacts: ContactRecord[];
  todos: TodoRecord[];
  files: FileRecord[];
  notifications: TaskNotificationRecord[];
  auditLogs: AuditLogRecord[];
  activitiesByLocation: Record<BranchLocationKey, ActivityRecord[]>;
  activityBookings: ActivityBookingRecord[];
  counters: {
    invoice: number;
  };
}

const nowIso = () => new Date().toISOString();
const randomId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const tokenFor = (userId: string) => `mock-${userId}`;
const parseMockTokenUserIdInternal = (token?: string): string | null => {
  const match = /^mock-(.+)$/.exec(token ?? "");
  return match?.[1] ?? null;
};
const userIdFromToken = (token?: string) => parseMockTokenUserIdInternal(token) ?? "";

export const buildMockTokenForUser = (userId: string): string => tokenFor(userId);

export const parseMockTokenUserId = (token?: string): string | null => parseMockTokenUserIdInternal(token);

const parseBody = (body?: BodyInit | null): Record<string, unknown> => {
  if (!body) {
    return {};
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (body instanceof URLSearchParams || body instanceof FormData) {
    return Object.fromEntries(body.entries());
  }
  return {};
};

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
};

const asIsoString = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return nowIso();
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return nowIso();
  }

  return parsed.toISOString();
};

const resolveApiUrl = (value: string): string => {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return resolveHostedUrl(value);
};

export const fetchSuperfoneEvents = async (query?: SuperfoneEventQuery): Promise<SuperfoneEventsResponse> => {
  if (!SUPERFONE_WEBHOOK_URL || !isConfiguredSuperfoneToken(SUPERFONE_WEBHOOK_TOKEN)) {
    throw new Error("Superfone webhook configuration is missing. Set VITE_SUPERFONE_WEBHOOK_URL and VITE_SUPERFONE_WEBHOOK_TOKEN.");
  }

  const requestUrl = new URL(resolveApiUrl(SUPERFONE_WEBHOOK_URL));
  requestUrl.searchParams.set("token", SUPERFONE_WEBHOOK_TOKEN);
  requestUrl.searchParams.set("mode", SUPERFONE_WEBHOOK_MODE);
  requestUrl.searchParams.set("limit", String(query?.limit ?? SUPERFONE_WEBHOOK_LIMIT));

  const filters: Array<keyof SuperfoneEventQuery> = ["phone", "from", "to"];
  for (const key of filters) {
    const value = query?.[key];
    if (typeof value === "string" && value.trim() !== "") {
      requestUrl.searchParams.set(key, value.trim());
    }
  }

  const response = await fetch(requestUrl.toString(), { method: "GET" });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const object = asObject(payload);
    const message = String(object?.error ?? `Superfone events request failed (${response.status}).`).trim();
    throw new ApiError(message, response.status, object);
  }

  const events = parseSuperfoneEventRecords(payload);
  const object = asObject(payload);
  const generatedAt = asIsoString(object?.generated_at ?? nowIso());

  return {
    ok: true,
    mode: "events",
    count: events.length,
    events,
    generated_at: generatedAt
  };
};

export const fetchSuperfoneInteraktStatus = async (): Promise<SuperfoneInteraktControlsResponse> => {
  if (!SUPERFONE_WEBHOOK_URL || !isConfiguredSuperfoneToken(SUPERFONE_WEBHOOK_TOKEN)) {
    throw new Error("Superfone webhook configuration is missing. Set VITE_SUPERFONE_WEBHOOK_URL and VITE_SUPERFONE_WEBHOOK_TOKEN.");
  }

  const requestUrl = new URL(resolveApiUrl(SUPERFONE_WEBHOOK_URL));
  requestUrl.searchParams.set("token", SUPERFONE_WEBHOOK_TOKEN);
  requestUrl.searchParams.set("mode", "interakt_status");

  const response = await fetch(requestUrl.toString(), { method: "GET" });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const object = asObject(payload);
    const message = String(object?.error ?? `Interakt status request failed (${response.status}).`).trim();
    throw new ApiError(message, response.status, object);
  }

  return parseSuperfoneInteraktControlsResponse(payload, "interakt_status");
};

export const toggleSuperfoneInterakt = async (enabled: boolean): Promise<SuperfoneInteraktControlsResponse> => {
  if (!SUPERFONE_WEBHOOK_URL || !isConfiguredSuperfoneToken(SUPERFONE_WEBHOOK_TOKEN)) {
    throw new Error("Superfone webhook configuration is missing. Set VITE_SUPERFONE_WEBHOOK_URL and VITE_SUPERFONE_WEBHOOK_TOKEN.");
  }

  const requestUrl = new URL(resolveApiUrl(SUPERFONE_WEBHOOK_URL));
  requestUrl.searchParams.set("token", SUPERFONE_WEBHOOK_TOKEN);
  requestUrl.searchParams.set("mode", "interakt_toggle");

  const response = await fetch(requestUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ enabled })
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const object = asObject(payload);
    const message = String(object?.error ?? `Interakt toggle request failed (${response.status}).`).trim();
    throw new ApiError(message, response.status, object);
  }

  return parseSuperfoneInteraktControlsResponse(payload, "interakt_toggle");
};

const seedState = (): MockState => {
  const workspaceId = "ws-operations";
  const now = nowIso();
  return {
    users: [
      {
        id: "u-owner",
        name: "Owner User",
        email: "owner@pipeline.local",
        role: "Owner",
        isActive: true,
        phone: "9999000001",
        workspaceIds: [workspaceId],
        createdAt: now,
        lastLoginAt: now,
        password: "TempPass123!",
        mustChangePassword: true
      },
      {
        id: "u-admin",
        name: "Admin User",
        email: "admin@pipeline.local",
        role: "Admin",
        isActive: true,
        phone: "9999000002",
        workspaceIds: [workspaceId],
        createdAt: now,
        lastLoginAt: now,
        password: "TempPass123!",
        mustChangePassword: true
      },
      {
        id: "u-telecaller",
        name: "Telecaller User",
        email: "telecaller@pipeline.local",
        role: "Telecaller",
        isActive: true,
        phone: "9999000003",
        workspaceIds: [workspaceId],
        createdAt: now,
        lastLoginAt: now,
        password: "TempPass123!",
        mustChangePassword: true
      },
      {
        id: "u-developer",
        name: "Developer User",
        email: "developer@pipeline.local",
        role: "Developer",
        isActive: true,
        phone: "9999000004",
        workspaceIds: [workspaceId],
        createdAt: now,
        lastLoginAt: now,
        password: "TempPass123!",
        mustChangePassword: true
      },
      {
        id: "u-thirdparty",
        name: "Third Party User",
        email: "thirdparty@pipeline.local",
        role: "ThirdParty",
        isActive: true,
        phone: "9999000006",
        workspaceIds: [workspaceId],
        createdAt: now,
        lastLoginAt: now,
        password: "TempPass123!",
        mustChangePassword: true
      }
    ],
    workspaces: [
      {
        id: workspaceId,
        workspaceName: "Operations",
        memberIds: ["u-owner", "u-admin", "u-telecaller"],
        visibility: "Organization-wide",
        boardRole: "Telecaller",
        isDeleted: false
      }
    ],
    tasks: [
      {
        id: "task-1",
        workspaceId,
        taskName: "Initial follow-up",
        description: "Initial follow-up call.",
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        assignedTo: "u-telecaller",
        priority: "High",
        status: "Todo",
        updatedAt: now,
        comments: [],
        attachments: []
      }
    ],
    transactions: [],
    karts: [
      { id: "kart-1", kartNumber: "K1", status: "Available", usageHours: 120 },
      { id: "kart-2", kartNumber: "K2", status: "InUse", usageHours: 130 }
    ],
    sessions: [],
    queue: [],
    incidents: [],
    contacts: [],
    todos: [],
    files: [],
    notifications: [],
    auditLogs: [],
    activitiesByLocation: {
      "0": [
        {
          id: "act-vizag-arcade",
          locationKey: "0",
          name: "Arcade",
          type: "Arcade",
          durationMinutes: 30,
          price: 350,
          status: "Active",
          createdAt: now,
          updatedAt: now
        },
        {
          id: "act-vizag-gokart",
          locationKey: "0",
          name: "Go-Karting",
          type: "Racing",
          durationMinutes: 15,
          price: 450,
          status: "Active",
          createdAt: now,
          updatedAt: now
        }
      ],
      "1": [
        {
          id: "act-kakinada-bowling",
          locationKey: "1",
          name: "Bowling",
          type: "Bowling",
          durationMinutes: 45,
          price: 300,
          status: "Active",
          createdAt: now,
          updatedAt: now
        }
      ],
      "2": [
        {
          id: "act-rjy-laser",
          locationKey: "2",
          name: "Laser Tag",
          type: "Laser Tag",
          durationMinutes: 20,
          price: 280,
          status: "Inactive",
          createdAt: now,
          updatedAt: now
        }
      ]
    },
    activityBookings: [],
    counters: { invoice: 1 }
  };
};

const readState = (): MockState => {
  const raw = localStorage.getItem(MOCK_STATE_KEY);
  if (!raw) {
    const seeded = seedState();
    localStorage.setItem(MOCK_STATE_KEY, JSON.stringify(seeded));
    return seeded;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MockState>;
    return {
      ...seedState(),
      ...parsed,
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      activityBookings: Array.isArray(parsed.activityBookings) ? parsed.activityBookings : []
    };
  } catch {
    const seeded = seedState();
    localStorage.setItem(MOCK_STATE_KEY, JSON.stringify(seeded));
    return seeded;
  }
};

const saveState = (state: MockState): void => {
  localStorage.setItem(MOCK_STATE_KEY, JSON.stringify(state));
};

const canUserAccessWorkspace = (user: UserRecord, workspace: WorkspaceRecord): boolean => {
  if ((workspace.excludedMemberIds ?? []).includes(user.id)) {
    return false;
  }
  if (user.role === "Owner" || user.role === "Admin") {
    return true;
  }
  if ((workspace.memberIds ?? []).includes(user.id)) {
    return true;
  }
  if (!workspace.boardRole) {
    return true;
  }
  return user.role === workspace.boardRole;
};

const isTruthyQueryFlag = (value: string | null): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const filterTasksByDeletedState = (tasks: TaskRecord[], params: URLSearchParams): TaskRecord[] => {
  const deletedOnly = isTruthyQueryFlag(params.get("deletedOnly"));
  const includeDeleted = isTruthyQueryFlag(params.get("includeDeleted"));
  if (deletedOnly) {
    return tasks.filter((item) => Boolean(item.isDeleted));
  }
  if (includeDeleted) {
    return tasks;
  }
  return tasks.filter((item) => !item.isDeleted);
};

const filterWorkspacesByDeletedState = (workspaces: WorkspaceRecord[], params: URLSearchParams): WorkspaceRecord[] => {
  const deletedOnly = isTruthyQueryFlag(params.get("deletedOnly"));
  const includeDeleted = isTruthyQueryFlag(params.get("includeDeleted"));
  if (deletedOnly) {
    return workspaces.filter((item) => Boolean(item.isDeleted));
  }
  if (includeDeleted) {
    return workspaces;
  }
  return workspaces.filter((item) => !item.isDeleted);
};

const TASK_ACTIVITY_PREFIX = "[[activity]] ";
const MAX_NOTIFICATION_PREVIEW_LENGTH = 180;

const toNotificationPreview = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "New activity in this task.";
  }
  if (normalized.length <= MAX_NOTIFICATION_PREVIEW_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_NOTIFICATION_PREVIEW_LENGTH - 3)}...`;
};

const pushTaskNotification = (
  state: MockState,
  payload: Omit<TaskNotificationRecord, "id" | "createdAt" | "readAt">
): void => {
  state.notifications.unshift({
    id: randomId("notification"),
    createdAt: nowIso(),
    ...payload
  });
};

const notifyTaskAssignee = (
  state: MockState,
  task: TaskRecord,
  sender: Pick<UserRecord, "id" | "name">
): void => {
  const assignedUserId = String(task.assignedTo ?? "").trim();
  if (!assignedUserId) {
    return;
  }
  pushTaskNotification(state, {
    userId: assignedUserId,
    taskId: task.id,
    workspaceId: task.workspaceId,
    taskName: task.taskName,
    senderId: sender.id,
    senderName: sender.name,
    type: "task-assigned",
    messagePreview: `${sender.name} assigned you a task.`
  });
};

const notifyTaskParticipantsForMessage = (
  state: MockState,
  task: TaskRecord,
  sender: Pick<UserRecord, "id" | "name">,
  messageText: string
): void => {
  const workspace = state.workspaces.find((item) => item.id === task.workspaceId);
  const participants = new Set<string>([...(workspace?.memberIds ?? []), task.assignedTo]);
  for (const participantIdRaw of participants) {
    const participantId = String(participantIdRaw ?? "").trim();
    if (!participantId || participantId === sender.id) {
      continue;
    }
    pushTaskNotification(state, {
      userId: participantId,
      taskId: task.id,
      workspaceId: task.workspaceId,
      taskName: task.taskName,
      senderId: sender.id,
      senderName: sender.name,
      type: "task-message",
      messagePreview: toNotificationPreview(messageText)
    });
  }
};

export const syncMockUserForSession = (
  user: LoginResponse["user"],
  options?: {
    phone?: string;
    password?: string;
    isActive?: boolean;
  }
): void => {
  if (!USE_MOCK_API || typeof localStorage === "undefined") {
    return;
  }

  const state = readState();
  const existingIndex = state.users.findIndex((item) => item.id === user.id);
  const existing = existingIndex >= 0 ? state.users[existingIndex] : undefined;
  const nextUser = {
    id: user.id,
    name: user.name || existing?.name || "User",
    email: user.email.toLowerCase(),
    role: user.role,
    isActive: options?.isActive ?? existing?.isActive ?? true,
    phone: options?.phone ?? existing?.phone ?? "",
    workspaceIds: user.workspaceIds ?? existing?.workspaceIds ?? [],
    notificationSettings: user.notificationSettings ?? existing?.notificationSettings,
    password: options?.password ?? existing?.password ?? "TempPass123!",
    mustChangePassword: user.mustChangePassword,
    createdAt: existing?.createdAt ?? nowIso(),
    lastLoginAt: nowIso()
  };

  if (existingIndex >= 0) {
    state.users[existingIndex] = nextUser;
  } else {
    state.users.unshift(nextUser);
  }
  saveState(state);
};

export const updateMockUserPassword = (userId: string, password: string, mustChangePassword: boolean): void => {
  if (!USE_MOCK_API || typeof localStorage === "undefined") {
    return;
  }

  const state = readState();
  const user = state.users.find((item) => item.id === userId);
  if (!user) {
    return;
  }

  user.password = password;
  user.mustChangePassword = mustChangePassword;
  saveState(state);
};

const asLoginUser = (user: MockState["users"][number]): LoginResponse["user"] => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  workspaceIds: user.workspaceIds,
  mustChangePassword: user.mustChangePassword,
  notificationSettings: user.notificationSettings
});

const requireAuth = (state: MockState, token?: string): MockState["users"][number] => {
  const userId = userIdFromToken(token);
  const user = state.users.find((item) => item.id === userId);
  if (!user || !user.isActive) {
    throw new ApiError("Unauthorized", 401);
  }
  return user;
};

const mockApiRequest = async <T>(path: string, init: RequestInit = {}, options?: { token?: string }): Promise<T> => {
  const state = readState();
  const method = (init.method ?? "GET").toUpperCase();
  const url = new URL(path, "http://mock.local");
  const body = parseBody(init.body);
  const segments = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/auth/login" && method === "POST") {
    const loginId = String(body.userId ?? body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const user = state.users.find(
      (item) => (item.email.toLowerCase() === loginId || item.id.toLowerCase() === loginId) && item.password === password && item.isActive
    );
    if (!user) {
      throw new ApiError("Invalid email/user id or password", 401);
    }
    const payload = { token: tokenFor(user.id), user: asLoginUser(user) } satisfies LoginResponse;
    return payload as T;
  }

  if (url.pathname === "/auth/logout" && method === "POST") {
    return { message: "Logged out." } as T;
  }

  if (url.pathname === "/auth/reset-password" && method === "POST") {
    const user = requireAuth(state, options?.token);
    const oldPassword = String(body.oldPassword ?? "");
    const newPassword = String(body.newPassword ?? "");
    if (user.password !== oldPassword) {
      throw new ApiError("Old password is incorrect.", 400);
    }
    user.password = newPassword;
    user.mustChangePassword = false;
    saveState(state);
    return { message: "Password reset successful." } as T;
  }

  const currentUser = requireAuth(state, options?.token);

  if (url.pathname === "/users" && method === "GET") {
    return { users: state.users } as T;
  }
  if (url.pathname === "/users" && method === "POST") {
    const baseId =
      String(body.name ?? "user")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "user";
    let userId = baseId;
    let suffix = 2;
    while (state.users.some((item) => item.id === userId)) {
      userId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const created = {
      id: userId,
      name: String(body.name ?? "New User"),
      email: String(body.email ?? ""),
      role: (body.role as UserRecord["role"]) ?? "Telecaller",
      isActive: true,
      phone: String(body.phone ?? ""),
      workspaceIds: Array.isArray(body.workspaceIds) ? (body.workspaceIds as string[]) : [],
      password: String(body.temporaryPassword ?? "TempPass123!"),
      mustChangePassword: true,
      createdAt: nowIso()
    };
    state.users.unshift(created);
    saveState(state);
    return { user: created } as T;
  }
  if (segments[0] === "users" && segments[1] && method === "PUT") {
    const user = state.users.find((item) => item.id === segments[1]);
    if (!user) throw new ApiError("User not found.", 404);
    Object.assign(user, body);
    saveState(state);
    return { user } as T;
  }
  if (segments[0] === "users" && segments[1] && method === "DELETE") {
    const userIndex = state.users.findIndex((item) => item.id === segments[1]);
    if (userIndex < 0) throw new ApiError("User not found.", 404);
    state.users.splice(userIndex, 1);
    saveState(state);
    return { message: "User deleted." } as T;
  }

  if (url.pathname.startsWith("/admin/audit-logs") && method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? "10");
    return { logs: state.auditLogs.slice(0, limit) } as T;
  }

  if (url.pathname === "/workspaces" && method === "GET") {
    const workspaces = filterWorkspacesByDeletedState(
      state.workspaces.filter((workspace) => canUserAccessWorkspace(currentUser, workspace)),
      url.searchParams
    );
    return { workspaces } as T;
  }
  if (url.pathname === "/workspaces" && method === "POST") {
    if (currentUser.role !== "Owner" && currentUser.role !== "Admin") {
      throw new ApiError("Only Owner or Admin can create boards.", 403);
    }
    const workspace: WorkspaceRecord = {
      id: randomId("ws"),
      workspaceName: String(body.workspaceName ?? "Workspace"),
      memberIds: Array.isArray(body.memberIds) ? (body.memberIds as string[]) : [currentUser.id],
      visibility: (body.visibility as WorkspaceRecord["visibility"]) ?? "Private",
      boardRole: String(body.boardRole ?? "Telecaller") as WorkspaceRecord["boardRole"],
      excludedMemberIds: [],
      isDeleted: false
    };
    state.workspaces.unshift(workspace);
    saveState(state);
    return { workspace } as T;
  }
  if (segments[0] === "workspaces" && segments[1] && method === "GET" && segments.length === 2) {
    const workspace = state.workspaces.find((item) => item.id === segments[1]);
    if (!workspace) throw new ApiError("Workspace not found.", 404);
    if (workspace.isDeleted) throw new ApiError("Workspace not found.", 404);
    if (!canUserAccessWorkspace(currentUser, workspace)) {
      throw new ApiError("You are not allowed to access this board.", 403);
    }
    return { workspace } as T;
  }
  if (segments[0] === "workspaces" && segments[1] && method === "DELETE" && segments.length === 2) {
    const workspaceIndex = state.workspaces.findIndex((item) => item.id === segments[1]);
    if (workspaceIndex < 0) throw new ApiError("Workspace not found.", 404);
    state.workspaces.splice(workspaceIndex, 1);
    state.tasks = state.tasks.filter((item) => item.workspaceId !== segments[1]);
    saveState(state);
    return { ok: true } as T;
  }
  if (segments[0] === "workspaces" && segments[1] && method === "PUT" && segments.length === 2) {
    if (currentUser.role !== "Owner" && currentUser.role !== "Admin") {
      throw new ApiError("Only Owner or Admin can update boards.", 403);
    }
    const workspace = state.workspaces.find((item) => item.id === segments[1]);
    if (!workspace) throw new ApiError("Workspace not found.", 404);

    if (typeof body.workspaceName === "string" && body.workspaceName.trim()) {
      workspace.workspaceName = body.workspaceName.trim();
    }
    if (Array.isArray(body.memberIds)) {
      workspace.memberIds = (body.memberIds as unknown[])
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.length > 0);
    }
    if (body.visibility === "Private" || body.visibility === "Organization-wide") {
      workspace.visibility = body.visibility;
    }
    if (
      body.boardRole === "Owner" ||
      body.boardRole === "Admin" ||
      body.boardRole === "Telecaller" ||
      body.boardRole === "Cashier" ||
      body.boardRole === "TrackMarshall" ||
      body.boardRole === "Editor" ||
      body.boardRole === "Developer" ||
      body.boardRole === "Backend" ||
      body.boardRole === "ThirdParty"
    ) {
      workspace.boardRole = body.boardRole;
    }
    if (Array.isArray(body.excludedMemberIds)) {
      workspace.excludedMemberIds = (body.excludedMemberIds as unknown[])
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.length > 0);
    }
    if (body.isDeleted !== undefined) {
      workspace.isDeleted = Boolean(body.isDeleted);
    }
    if (body.deletedAt !== undefined) {
      workspace.deletedAt = String(body.deletedAt ?? "").trim() || undefined;
    }
    if (body.deletedBy !== undefined) {
      workspace.deletedBy = String(body.deletedBy ?? "").trim() || undefined;
    }

    saveState(state);
    return { workspace } as T;
  }
  if (segments[0] === "workspaces" && segments[2] === "tasks" && method === "GET") {
    const workspace = state.workspaces.find((item) => item.id === segments[1]);
    if (!workspace) throw new ApiError("Workspace not found.", 404);
    if (!canUserAccessWorkspace(currentUser, workspace)) {
      throw new ApiError("You are not allowed to access this board.", 403);
    }
    const tasks = state.tasks.filter((item) => item.workspaceId === segments[1]);
    return { tasks: filterTasksByDeletedState(tasks, url.searchParams) } as T;
  }

  if (url.pathname === "/tasks" && method === "GET") {
    let tasks = filterTasksByDeletedState([...state.tasks], url.searchParams);
    const workspaceId = url.searchParams.get("workspaceId");
    const assignedTo = url.searchParams.get("assignedTo");
    const status = url.searchParams.get("status");
    if (workspaceId) tasks = tasks.filter((item) => item.workspaceId === workspaceId);
    if (assignedTo) tasks = tasks.filter((item) => item.assignedTo === assignedTo);
    if (status) tasks = tasks.filter((item) => item.status === status);
    return { tasks } as T;
  }
  if (url.pathname === "/tasks" && method === "POST") {
    const task: TaskRecord = {
      id: randomId("task"),
      workspaceId: String(body.workspaceId ?? state.workspaces[0]?.id ?? "ws-default"),
      taskName: String(body.taskName ?? "Task"),
      description: String(body.description ?? ""),
      dueDate: String(body.dueDate ?? nowIso()),
      assignedTo: String(body.assignedTo ?? currentUser.id),
      priority: (body.priority as TaskRecord["priority"]) ?? "Medium",
      status: (body.status as TaskRecord["status"]) ?? "Todo",
      isDeleted: false,
      updatedAt: nowIso(),
      comments: [],
      attachments: []
    };
    state.tasks.unshift(task);
    notifyTaskAssignee(state, task, { id: currentUser.id, name: currentUser.name });
    saveState(state);
    return { task } as T;
  }
  if (segments[0] === "tasks" && segments[1] && method === "GET" && segments.length === 2) {
    const task = state.tasks.find((item) => item.id === segments[1]);
    if (!task) throw new ApiError("Task not found.", 404);
    return { task } as T;
  }
  if (segments[0] === "tasks" && segments[1] && method === "PUT") {
    const task = state.tasks.find((item) => item.id === segments[1]);
    if (!task) throw new ApiError("Task not found.", 404);
    const previousAssignee = task.assignedTo;
    Object.assign(task, body, { updatedAt: nowIso() });
    if (String(task.assignedTo ?? "").trim() && task.assignedTo !== previousAssignee) {
      notifyTaskAssignee(state, task, { id: currentUser.id, name: currentUser.name });
    }
    saveState(state);
    return { task } as T;
  }
  if (segments[0] === "tasks" && segments[1] && method === "DELETE") {
    const taskIndex = state.tasks.findIndex((item) => item.id === segments[1]);
    if (taskIndex < 0) throw new ApiError("Task not found.", 404);
    state.tasks.splice(taskIndex, 1);
    saveState(state);
    return { ok: true } as T;
  }
  if (segments[0] === "tasks" && segments[2] === "comments" && method === "POST") {
    const task = state.tasks.find((item) => item.id === segments[1]);
    if (!task) throw new ApiError("Task not found.", 404);
    const comment = { id: randomId("comment"), userId: currentUser.id, comment: String(body.comment ?? ""), timestamp: nowIso() };
    task.comments = [...(task.comments ?? []), comment];
    if (!comment.comment.startsWith(TASK_ACTIVITY_PREFIX)) {
      notifyTaskParticipantsForMessage(state, task, { id: currentUser.id, name: currentUser.name }, comment.comment);
    }
    saveState(state);
    return { comment } as T;
  }
  if (segments[0] === "tasks" && segments[2] === "messages" && segments[3] && method === "DELETE") {
    const task = state.tasks.find((item) => item.id === segments[1]);
    if (!task) throw new ApiError("Task not found.", 404);
    const comments = task.comments ?? [];
    const targetComment = comments.find((item) => item.id === segments[3]);
    if (!targetComment) {
      return { ok: true } as T;
    }
    const canDelete = targetComment.userId === currentUser.id || currentUser.role === "Owner" || currentUser.role === "Admin";
    if (!canDelete) {
      throw new ApiError("You can delete only your own messages.", 403);
    }
    task.comments = comments.filter((item) => item.id !== segments[3]);
    saveState(state);
    return { ok: true } as T;
  }

  if (url.pathname === "/notifications" && method === "GET") {
    const notifications = state.notifications
      .filter((item) => item.userId === currentUser.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { notifications } as T;
  }
  if (segments[0] === "notifications" && segments[1] && segments[2] === "read" && method === "PUT") {
    const notification = state.notifications.find((item) => item.id === segments[1] && item.userId === currentUser.id);
    if (!notification) throw new ApiError("Notification not found.", 404);
    if (!notification.readAt) {
      notification.readAt = nowIso();
    }
    saveState(state);
    return { notification } as T;
  }
  if (url.pathname === "/notifications/read-all" && method === "POST") {
    const readAt = nowIso();
    state.notifications = state.notifications.map((item) =>
      item.userId === currentUser.id && !item.readAt
        ? {
            ...item,
            readAt
          }
        : item
    );
    saveState(state);
    return { ok: true } as T;
  }
  if (url.pathname === "/notifications/clear-all" && method === "POST") {
    state.notifications = state.notifications.filter((item) => item.userId !== currentUser.id);
    saveState(state);
    return { ok: true } as T;
  }

  if (url.pathname === "/files" && method === "GET") return { files: state.files } as T;
  if (url.pathname === "/files/upload-session" && method === "POST") {
    return { uploadSession: { id: randomId("upload"), taskId: String(body.taskId ?? ""), uploadUrl: "#", expiresAt: nowIso() } } as T;
  }
  if (url.pathname === "/files/complete" && method === "POST") {
    const attachment: FileRecord = {
      id: randomId("file"),
      fileName: "uploaded-file",
      mimeType: "application/octet-stream",
      sizeBytes: 1000,
      storageProvider: "GoogleDrive",
      uploadedAt: nowIso(),
      taskId: "task-1",
      workspaceId: "ws-operations",
      downloadPath: "#"
    };
    state.files.unshift(attachment);
    saveState(state);
    return { attachment } as T;
  }
  if (segments[0] === "files" && segments[2] === "revoke" && method === "POST") {
    const file = state.files.find((item) => item.id === segments[1]);
    if (!file) throw new ApiError("File not found.", 404);
    file.revokedAt = nowIso();
    saveState(state);
    return { attachment: file } as T;
  }

  if (url.pathname === "/billing/transactions" && method === "GET") return { transactions: state.transactions } as T;
  if (url.pathname === "/billing/transactions" && method === "POST") {
    const amount = Array.isArray(body.items)
      ? (body.items as Array<{ quantity: number; unitPrice: number }>).reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      : 0;
    const transaction: TransactionRecord = {
      id: randomId("txn"),
      invoiceNumber: `INV-${String(state.counters.invoice++).padStart(4, "0")}`,
      customerName: String(body.customerName ?? "Customer"),
      customerPhone: String(body.customerPhone ?? ""),
      totalAmount: amount,
      paymentMethod: (body.paymentMethod as TransactionRecord["paymentMethod"]) ?? "Cash",
      refundStatus: "None",
      transactionDate: nowIso(),
      items: Array.isArray(body.items) ? (body.items as Array<{ itemName: string; quantity: number; unitPrice: number }>) : []
    };
    state.transactions.unshift(transaction);
    saveState(state);
    return { transaction } as T;
  }
  if (segments[0] === "billing" && segments[1] === "transactions" && segments[2] && method === "GET") {
    const transaction = state.transactions.find((item) => item.id === segments[2]);
    if (!transaction) throw new ApiError("Transaction not found.", 404);
    return { transaction } as T;
  }
  if (segments[0] === "billing" && segments[1] === "invoices" && segments[2] && method === "GET") {
    const invoice = state.transactions.find((item) => item.invoiceNumber === segments[2]);
    if (!invoice) throw new ApiError("Invoice not found.", 404);
    return { invoice } as T;
  }
  if (url.pathname === "/billing/refunds" && method === "POST") {
    const transaction = state.transactions.find((item) => item.id === String(body.transactionId ?? ""));
    if (!transaction) throw new ApiError("Transaction not found.", 404);
    const refund = Number(body.refundAmount ?? 0);
    transaction.refundAmount = refund;
    transaction.refundStatus = refund >= transaction.totalAmount ? "Full" : "Partial";
    saveState(state);
    return { transaction } as T;
  }
  if (url.pathname === "/billing/revenue/summary" && method === "GET") {
    const totalRevenue = state.transactions.reduce((sum, item) => sum + item.totalAmount, 0);
    return {
      summary: {
        totalRevenue,
        totalTransactions: state.transactions.length,
        averageTransactionValue: state.transactions.length > 0 ? totalRevenue / state.transactions.length : 0,
        paymentMethodBreakdown: state.transactions.reduce<Record<string, number>>((accumulator, item) => {
          if (item.paymentMethod === "Split") {
            if (item.splitCash) accumulator.Cash = (accumulator.Cash ?? 0) + item.splitCash;
            if (item.splitUpi) accumulator.UPI = (accumulator.UPI ?? 0) + item.splitUpi;
            if (item.splitCard) accumulator.Card = (accumulator.Card ?? 0) + item.splitCard;
          } else {
            accumulator[item.paymentMethod] = (accumulator[item.paymentMethod] ?? 0) + item.totalAmount;
          }
          return accumulator;
        }, {}),
        refundsCount: state.transactions.filter((item) => item.refundStatus !== "None").length,
        refundsValue: state.transactions.reduce((sum, item) => sum + (item.refundAmount ?? 0), 0)
      }
    } as T;
  }
  if (url.pathname === "/billing/helicopter/activities" && method === "GET") return { activities: [] } as T;
  if (url.pathname === "/billing/helicopter/activities" && method === "POST") return { activity: { id: randomId("heli"), ...body, createdAt: nowIso(), updatedAt: nowIso() } } as T;
  if (segments[0] === "billing" && segments[1] === "helicopter" && segments[2] === "activities" && method === "PUT") return { activity: { id: segments[3], ...body, updatedAt: nowIso() } } as T;
  if (url.pathname === "/billing/helicopter/payments" && method === "GET") return { payments: [] } as T;
  if (url.pathname === "/billing/helicopter/payments/send" && method === "POST") return { payment: { id: randomId("pay"), ...body, status: "Sent", createdAt: nowIso(), updatedAt: nowIso() } } as T;

  if (url.pathname === "/activities/bookings" && method === "GET") {
    const locationKey = String(url.searchParams.get("locationKey") ?? "").trim();
    const limitRaw = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
    const bookings = state.activityBookings
      .filter((booking) => !locationKey || booking.locationKey === locationKey)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
    return { bookings } as T;
  }

  if (url.pathname === "/activities/bookings/send" && method === "POST") {
    const customerName = String(body.customerName ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const locationKey = String(body.locationKey ?? "").trim() as BranchLocationKey;
    const activityIds = Array.isArray(body.activityIds)
      ? (body.activityIds as unknown[]).map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];

    if (!customerName) throw new ApiError("Customer name is required.", 400);
    if (!phone) throw new ApiError("Phone number is required.", 400);
    if (!locationKey) throw new ApiError("Location is required.", 400);
    if (activityIds.length === 0) throw new ApiError("Select at least one activity.", 400);

    const locationActivities = state.activitiesByLocation[locationKey] ?? [];
    const selectedActivities = locationActivities.filter((activity) => activityIds.includes(activity.id));
    if (selectedActivities.length !== activityIds.length) {
      throw new ApiError("One or more selected activities were not found in this branch.", 400);
    }
    if (selectedActivities.some((activity) => activity.status !== "Active")) {
      throw new ApiError("Only active activities can be booked.", 400);
    }

    const bookingId = randomId("booking");
    const createdAt = nowIso();
    const booking: ActivityBookingRecord = {
      id: bookingId,
      customerName,
      phone,
      locationKey,
      activityIds,
      activityNames: selectedActivities.map((activity) => activity.name),
      totalAmount: selectedActivities.reduce((sum, activity) => sum + activity.price, 0),
      paymentLink: `https://payments.pipeline.local/booking/${bookingId}`,
      status: "Sent",
      sentBy: currentUser.id,
      createdAt,
      updatedAt: createdAt
    };

    state.activityBookings.unshift(booking);
    saveState(state);
    return { booking } as T;
  }

  if (url.pathname === "/activities" && method === "GET") {
    const activitiesByLocation = Object.entries(state.activitiesByLocation).reduce<Record<BranchLocationKey, ActivityRecord[]>>(
      (acc, [key, value]) => {
        acc[key] = [...value];
        return acc;
      },
      {}
    );
    return { activitiesByLocation } as T;
  }
  if (url.pathname === "/activities" && method === "POST") {
    const locationKey = String(body.locationKey ?? "").trim() as BranchLocationKey;
    if (!locationKey) {
      throw new ApiError("Invalid location key.", 400);
    }
    if (!state.activitiesByLocation[locationKey]) {
      state.activitiesByLocation[locationKey] = [];
    }
    const activity: ActivityRecord = {
      id: randomId("activity"),
      locationKey,
      name: String(body.name ?? "").trim() || "New Activity",
      type: String(body.type ?? "").trim() || "Game",
      durationMinutes: Math.max(Number(body.durationMinutes ?? 0), 0),
      price: Math.max(Number(body.price ?? 0), 0),
      status: body.status === "Inactive" ? "Inactive" : "Active",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.activitiesByLocation[locationKey].unshift(activity);
    saveState(state);
    return { activity } as T;
  }
  if (url.pathname === "/activities/combo" && method === "POST") {
    const locationKey = String(body.locationKey ?? "").trim() as BranchLocationKey;
    if (!locationKey) {
      throw new ApiError("Invalid location key.", 400);
    }
    if (!state.activitiesByLocation[locationKey]) {
      state.activitiesByLocation[locationKey] = [];
    }

    const selectedIds = Array.isArray(body.activityIds)
      ? (body.activityIds as unknown[]).map((item) => String(item ?? "").trim()).filter((item) => item.length > 0)
      : [];

    if (selectedIds.length < 2) {
      throw new ApiError("Select at least two activities to create a combo.", 400);
    }

    const selectedActivities = state.activitiesByLocation[locationKey].filter((item) => selectedIds.includes(item.id));
    const computedDuration = selectedActivities.reduce((sum, item) => sum + item.durationMinutes, 0);
    const computedPrice = selectedActivities.reduce((sum, item) => sum + item.price, 0);
    const inputPrice = Number(body.price ?? computedPrice);

    const combo: ActivityRecord = {
      id: randomId("combo"),
      locationKey,
      name: String(body.name ?? "").trim() || "Combo Game",
      type: "Combo",
      durationMinutes: computedDuration,
      price: Number.isFinite(inputPrice) && inputPrice >= 0 ? inputPrice : computedPrice,
      status: body.status === "Inactive" ? "Inactive" : "Active",
      isCombo: true,
      activityIds: selectedIds,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    state.activitiesByLocation[locationKey].unshift(combo);
    saveState(state);
    return { activity: combo } as T;
  }

  if (url.pathname === "/karts" && method === "GET") return { karts: state.karts } as T;
  if (url.pathname === "/sessions" && method === "GET") return { sessions: state.sessions } as T;
  if (url.pathname === "/queue" && method === "GET") return { queue: state.queue } as T;
  if (url.pathname === "/incidents" && method === "GET") return { incidents: state.incidents } as T;
  if (url.pathname === "/sessions" && method === "POST") {
    const session: SessionRecord = {
      id: randomId("session"),
      sessionName: String(body.sessionName ?? "Session"),
      status: (body.status as SessionRecord["status"]) ?? "Scheduled",
      startTime: String(body.startTime ?? nowIso()),
      duration: Number(body.duration ?? 15),
      maxParticipants: Number(body.maxParticipants ?? 8),
      assignedKarts: Array.isArray(body.assignedKarts) ? (body.assignedKarts as string[]) : [],
      trackMarshallId: currentUser.id
    };
    state.sessions.unshift(session);
    saveState(state);
    return { session } as T;
  }
  if (url.pathname === "/queue" && method === "POST") {
    const queueEntry: QueueEntryRecord = {
      id: randomId("queue"),
      customerName: String(body.customerName ?? "Customer"),
      customerPhone: String(body.customerPhone ?? ""),
      priority: (body.priority as QueueEntryRecord["priority"]) ?? "Normal",
      status: "Waiting",
      estimatedWaitMinutes: Number(body.estimatedWaitMinutes ?? 10),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.queue.unshift(queueEntry);
    saveState(state);
    return { queueEntry } as T;
  }
  if (url.pathname === "/incidents" && method === "POST") {
    const incident: IncidentRecord = {
      id: randomId("incident"),
      incidentType: (body.incidentType as IncidentRecord["incidentType"]) ?? "Minor",
      status: (body.status as IncidentRecord["status"]) ?? "Open",
      dateTime: String(body.dateTime ?? nowIso()),
      description: body.description ? String(body.description) : undefined
    };
    state.incidents.unshift(incident);
    saveState(state);
    return { incident } as T;
  }
  if (segments[0] === "karts" && segments[1] && method === "GET") {
    const kart = state.karts.find((item) => item.id === segments[1]);
    if (!kart) throw new ApiError("Kart not found.", 404);
    return { kart } as T;
  }
  if (segments[0] === "karts" && segments[1] && method === "PUT") {
    const kart = state.karts.find((item) => item.id === segments[1]);
    if (!kart) throw new ApiError("Kart not found.", 404);
    Object.assign(kart, body);
    saveState(state);
    return { kart } as T;
  }
  if (segments[0] === "sessions" && segments[1] && method === "GET") {
    const session = state.sessions.find((item) => item.id === segments[1]);
    if (!session) throw new ApiError("Session not found.", 404);
    return { session } as T;
  }
  if (segments[0] === "sessions" && segments[1] && method === "PUT") {
    const session = state.sessions.find((item) => item.id === segments[1]);
    if (!session) throw new ApiError("Session not found.", 404);
    Object.assign(session, body);
    saveState(state);
    return { session } as T;
  }
  if (segments[0] === "queue" && segments[1] && method === "PUT") {
    const queueEntry = state.queue.find((item) => item.id === segments[1]);
    if (!queueEntry) throw new ApiError("Queue entry not found.", 404);
    Object.assign(queueEntry, body, { updatedAt: nowIso() });
    saveState(state);
    return { queueEntry } as T;
  }
  if (segments[0] === "queue" && segments[1] && method === "DELETE") {
    state.queue = state.queue.filter((item) => item.id !== segments[1]);
    saveState(state);
    return { message: "Deleted" } as T;
  }
  if (segments[0] === "incidents" && segments[1] && method === "PUT") {
    const incident = state.incidents.find((item) => item.id === segments[1]);
    if (!incident) throw new ApiError("Incident not found.", 404);
    Object.assign(incident, body);
    saveState(state);
    return { incident } as T;
  }

  if (url.pathname === "/contacts" && method === "GET") return { contacts: state.contacts } as T;
  if (url.pathname === "/contacts" && method === "POST") {
    const contact: ContactRecord = {
      id: randomId("contact"),
      name: String(body.name ?? "Contact"),
      phone: String(body.phone ?? ""),
      email: body.email ? String(body.email) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      createdBy: currentUser.id,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.contacts.unshift(contact);
    saveState(state);
    return { contact } as T;
  }
  if (segments[0] === "contacts" && segments[1] && method === "PUT") {
    const contact = state.contacts.find((item) => item.id === segments[1]);
    if (!contact) throw new ApiError("Contact not found.", 404);
    Object.assign(contact, body, { updatedAt: nowIso() });
    saveState(state);
    return { contact } as T;
  }
  if (segments[0] === "contacts" && segments[1] && method === "DELETE") {
    state.contacts = state.contacts.filter((item) => item.id !== segments[1]);
    saveState(state);
    return { message: "Deleted" } as T;
  }

  if (url.pathname === "/todos" && method === "GET") return { todos: state.todos } as T;
  if (url.pathname === "/todos" && method === "POST") {
    const todo: TodoRecord = {
      id: randomId("todo"),
      title: String(body.title ?? "Todo"),
      assignedTo: String(body.assignedTo ?? currentUser.id),
      status: (body.status as TodoRecord["status"]) ?? "Pending",
      dueDate: body.dueDate ? String(body.dueDate) : undefined,
      createdBy: currentUser.id,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.todos.unshift(todo);
    saveState(state);
    return { todo } as T;
  }
  if (segments[0] === "todos" && segments[1] && method === "PUT") {
    const todo = state.todos.find((item) => item.id === segments[1]);
    if (!todo) throw new ApiError("Todo not found.", 404);
    Object.assign(todo, body, { updatedAt: nowIso() });
    saveState(state);
    return { todo } as T;
  }
  if (segments[0] === "todos" && segments[1] && method === "DELETE") {
    state.todos = state.todos.filter((item) => item.id !== segments[1]);
    saveState(state);
    return { message: "Deleted" } as T;
  }

  if (url.pathname === "/reports/operations" && method === "GET") {
    return {
      report: {
        activeShiftCount: 0,
        sessionsActive: state.sessions.filter((item) => item.status === "Active").length,
        incidentsOpen: state.incidents.filter((item) => item.status !== "Resolved").length,
        queueWaiting: state.queue.filter((item) => item.status === "Waiting").length,
        tasksOverdue: state.tasks.filter((item) => item.status !== "Completed" && new Date(item.dueDate).getTime() < Date.now()).length
      }
    } as T;
  }
  if (url.pathname === "/reports/revenue" && method === "GET") return { report: {} } as T;
  if (url.pathname === "/reports/shifts" && method === "GET") return { report: {} } as T;
  if (url.pathname.startsWith("/reports/call-history") && method === "GET") return { records: [] } as T;
  if (url.pathname.startsWith("/reports/insights") && method === "GET") return { summary: { outgoingCalls: 0, incomingCalls: 0, connectedCalls: 0, missedCalls: 0, totalDurationSeconds: 0, uniqueCustomers: 0, noAnswerCalls: 0 }, staffInsights: [] } as T;

  throw new ApiError(`Mock route not found: ${method} ${url.pathname}`, 404);
};

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export const apiRequest = async <T>(
  path: string,
  init: RequestInit = {},
  options?: { token?: string }
): Promise<T> => {
  if (USE_MOCK_API) {
    return mockApiRequest<T>(path, init, options);
  }

  if (!API_BASE_URL) {
    const message =
      appBuildTarget === "native"
        ? "VITE_API_BASE_URL is required for native builds because packaged apps cannot use the hosted /pipeline API fallback."
        : "VITE_API_BASE_URL is not configured.";
    throw new ApiError(message, 0);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(init.headers ?? {})
      }
    });
  } catch (error) {
    const guidance =
      appBuildTarget === "native"
        ? " Native builds need an absolute VITE_API_BASE_URL because packaged apps cannot use the hosted /pipeline API fallback."
        : "";
    throw new ApiError(
      `Cannot reach API at ${API_BASE_URL}. Set VITE_API_BASE_URL to your backend URL and make sure the server is running.${guidance}`,
      0,
      error
    );
  }

  const data = (await response.json().catch(() => null)) as
    | {
      error?: string;
      details?: unknown;
    }
    | null;

  if (!response.ok) {
    throw new ApiError(data?.error ?? "Request failed", response.status, data?.details);
  }

  if (data === null) {
    const guidance =
      appBuildTarget === "native"
        ? " Native builds need an absolute VITE_API_BASE_URL because packaged apps cannot use the hosted /pipeline API fallback."
        : "";
    throw new ApiError(
      `API at ${API_BASE_URL} returned a non-JSON response for ${path}. Check VITE_API_BASE_URL and backend routing.${guidance}`,
      response.status
    );
  }

  return data as T;
};
