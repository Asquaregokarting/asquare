import type { LoginResponse, TaskStatus, UserRecord } from "../../api/types";

export const defaultTaskStatuses: TaskStatus[] = ["Todo", "InProgress", "Completed", "Blocked"];

export const taskStatusLabelMap: Record<string, string> = {
  Todo: "Todo",
  InProgress: "In Progress",
  Completed: "Completed",
  Blocked: "Blocked"
};

export const taskStatusToneMap: Record<string, string> = {
  Todo: "border-muted/30 bg-muted/10 text-muted",
  InProgress: "border-info/35 bg-info/10 text-info",
  Completed: "border-success/35 bg-success/10 text-success",
  Blocked: "border-critical/40 bg-critical/10 text-critical"
};

export const normalizeTaskStatusName = (value: string): TaskStatus => value.trim().replace(/\s+/g, " ") as TaskStatus;

export const dedupeTaskStatuses = (statuses: TaskStatus[]): TaskStatus[] => {
  const seen = new Set<string>();
  const result: TaskStatus[] = [];

  for (const status of statuses) {
    const normalized = normalizeTaskStatusName(String(status));
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const readStoredStatusList = (storageKey: string): TaskStatus[] => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupeTaskStatuses(parsed.map((item) => String(item)));
  } catch {
    return [];
  }
};

export const readWorkspaceCustomStatuses = (workspaceId: string): TaskStatus[] =>
  readStoredStatusList(`pipeline-workspace-custom-statuses:${workspaceId}`);

export const readWorkspaceHiddenDefaultStatuses = (workspaceId: string): TaskStatus[] =>
  readStoredStatusList(`pipeline-workspace-hidden-default-statuses:${workspaceId}`);

export const readWorkspaceFavorites = (): Record<string, true> => {
  try {
    const raw = localStorage.getItem("pipeline-workspace-favorites");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, true>;
    return parsed ?? {};
  } catch {
    return {};
  }
};

export const buildTaskModuleUsers = (session: LoginResponse | null, users: UserRecord[]): UserRecord[] => {
  if (users.length > 0) {
    return users;
  }

  if (!session) {
    return [];
  }

  return [
    {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      isActive: true,
      workspaceIds: session.user.workspaceIds,
      notificationSettings: session.user.notificationSettings
    }
  ];
};

export const resolveTaskUserName = (
  userId: string,
  users: UserRecord[],
  session: LoginResponse | null,
  options?: { annotateCurrentUser?: boolean; fallbackLabel?: string }
): string => {
  const annotateCurrentUser = options?.annotateCurrentUser ?? false;
  if (session && userId === session.user.id) {
    return annotateCurrentUser ? `${session.user.name} (You)` : session.user.name;
  }

  const user = users.find((item) => item.id === userId);
  if (user) {
    return user.name;
  }

  if (options?.fallbackLabel) {
    return options.fallbackLabel;
  }

  return userId.slice(0, 8);
};
