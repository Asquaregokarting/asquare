import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tasksApi } from "../../api/tasks";
import { TaskNotificationRecord } from "../../api/types";

const TOAST_TTL_MS = 5000;
const MAX_ALERTED_NOTIFICATION_IDS = 600;

const getAlertedStorageKey = (userId: string): string => `pipeline:task-notification-alerted:${userId}`;

const readAlertedNotificationIds = (userId: string): Set<string> => {
  if (typeof window === "undefined" || !userId) {
    return new Set();
  }
  try {
    const raw = window.sessionStorage.getItem(getAlertedStorageKey(userId));
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    const values = parsed
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length > 0);
    return new Set(values.slice(-MAX_ALERTED_NOTIFICATION_IDS));
  } catch {
    return new Set();
  }
};

const persistAlertedNotificationIds = (userId: string, ids: Set<string>): void => {
  if (typeof window === "undefined" || !userId) {
    return;
  }
  try {
    const values = [...ids];
    const trimmed = values.slice(-MAX_ALERTED_NOTIFICATION_IDS);
    window.sessionStorage.setItem(getAlertedStorageKey(userId), JSON.stringify(trimmed));
  } catch {
    // Ignore storage write errors (private mode/storage limits).
  }
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export interface UseTaskNotificationsOptions {
  token?: string;
  currentUserId?: string;
  enabled?: boolean;
  onError?: (message: string) => void;
}

export interface UseTaskNotificationsResult {
  notifications: TaskNotificationRecord[];
  unreadCount: number;
  toastNotifications: TaskNotificationRecord[];
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearAllNotifications: () => Promise<void>;
  dismissToast: (notificationId: string) => void;
}

export const useTaskNotifications = ({
  token,
  currentUserId,
  enabled = true,
  onError
}: UseTaskNotificationsOptions): UseTaskNotificationsResult => {
  const tokenValue = token ?? "";
  const userIdValue = currentUserId ?? "";
  const canSubscribe = enabled && tokenValue.length > 0 && userIdValue.length > 0;

  const [notifications, setNotifications] = useState<TaskNotificationRecord[]>([]);
  const [toastNotifications, setToastNotifications] = useState<TaskNotificationRecord[]>([]);

  const hasBootstrappedRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const alertedIdsRef = useRef<Set<string>>(new Set());
  const toastTimerRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const permissionDeniedRef = useRef(false);

  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      const message = toErrorMessage(error, fallback);
      const normalized = message.toLowerCase();
      if (normalized.includes("missing or insufficient permissions") || normalized.includes("permission-denied")) {
        permissionDeniedRef.current = true;
        return message;
      }
      onError?.(message);
      return message;
    },
    [onError]
  );

  const dismissToast = useCallback((notificationId: string) => {
    setToastNotifications((current) => current.filter((item) => item.id !== notificationId));
    const timer = toastTimerRefs.current.get(notificationId);
    if (timer) {
      clearTimeout(timer);
      toastTimerRefs.current.delete(notificationId);
    }
  }, []);

  useEffect(() => {
    setNotifications([]);
    setToastNotifications([]);
    hasBootstrappedRef.current = false;
    seenIdsRef.current = new Set();
    alertedIdsRef.current = readAlertedNotificationIds(userIdValue);
    permissionDeniedRef.current = false;
    toastTimerRefs.current.forEach((timer) => clearTimeout(timer));
    toastTimerRefs.current.clear();
  }, [tokenValue, userIdValue]);

  useEffect(() => {
    if (!canSubscribe) {
      return;
    }

    const unsubscribe = tasksApi.subscribeTaskNotifications(
      tokenValue,
      userIdValue,
      (rows) => {
        if (permissionDeniedRef.current) {
          return;
        }
        setNotifications(rows);
      },
      (error) => {
        reportError(error, "Failed to subscribe notifications.");
      }
    );

    return () => {
      unsubscribe();
    };
  }, [canSubscribe, reportError, tokenValue, userIdValue]);

  useEffect(() => {
    if (!canSubscribe) {
      return;
    }

    if (!hasBootstrappedRef.current) {
      notifications.forEach((item) => seenIdsRef.current.add(item.id));
      hasBootstrappedRef.current = true;
      return;
    }

    const incoming = notifications.filter((item) => !seenIdsRef.current.has(item.id));
    if (incoming.length === 0) {
      return;
    }

    incoming.forEach((item) => seenIdsRef.current.add(item.id));
    const unreadIncoming = incoming.filter((item) => !item.readAt && !alertedIdsRef.current.has(item.id));
    if (unreadIncoming.length === 0) {
      return;
    }

    for (const row of unreadIncoming) {
      alertedIdsRef.current.add(row.id);
    }
    persistAlertedNotificationIds(userIdValue, alertedIdsRef.current);

    setToastNotifications((current) => {
      const next = [...current];
      const existingIds = new Set(current.map((item) => item.id));
      for (const row of unreadIncoming) {
        if (!existingIds.has(row.id)) {
          next.unshift(row);
        }
      }
      return next.slice(0, 5);
    });

    for (const row of unreadIncoming) {
      if (toastTimerRefs.current.has(row.id)) {
        continue;
      }
      const timer = setTimeout(() => {
        dismissToast(row.id);
      }, TOAST_TTL_MS);
      toastTimerRefs.current.set(row.id, timer);
    }
  }, [canSubscribe, dismissToast, notifications, userIdValue]);

  useEffect(
    () => () => {
      toastTimerRefs.current.forEach((timer) => clearTimeout(timer));
      toastTimerRefs.current.clear();
    },
    []
  );

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      if (!canSubscribe) {
        return;
      }
      try {
        await tasksApi.markTaskNotificationRead(tokenValue, notificationId);
        setNotifications((current) =>
          current.map((item) =>
            item.id === notificationId
              ? {
                  ...item,
                  readAt: item.readAt ?? new Date().toISOString()
                }
              : item
          )
        );
        dismissToast(notificationId);
      } catch (error) {
        reportError(error, "Failed to mark notification read.");
      }
    },
    [canSubscribe, dismissToast, reportError, tokenValue]
  );

  const markAllRead = useCallback(async () => {
    if (!canSubscribe) {
      return;
    }
    try {
      await tasksApi.markAllTaskNotificationsRead(tokenValue);
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          readAt: item.readAt ?? readAt
        }))
      );
      setToastNotifications([]);
      toastTimerRefs.current.forEach((timer) => clearTimeout(timer));
      toastTimerRefs.current.clear();
    } catch (error) {
      reportError(error, "Failed to mark all notifications read.");
    }
  }, [canSubscribe, reportError, tokenValue]);

  const clearAllNotifications = useCallback(async () => {
    if (!canSubscribe) {
      return;
    }
    try {
      await tasksApi.clearAllTaskNotifications(tokenValue);
      setNotifications([]);
      setToastNotifications([]);
      seenIdsRef.current = new Set();
      hasBootstrappedRef.current = true;
      toastTimerRefs.current.forEach((timer) => clearTimeout(timer));
      toastTimerRefs.current.clear();
    } catch (error) {
      reportError(error, "Failed to clear notifications.");
    }
  }, [canSubscribe, reportError, tokenValue]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.readAt).length, [notifications]);

  return {
    notifications,
    unreadCount,
    toastNotifications,
    markNotificationRead,
    markAllRead,
    clearAllNotifications,
    dismissToast
  };
};
