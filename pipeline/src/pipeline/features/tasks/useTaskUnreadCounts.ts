import { useEffect, useMemo, useState } from "react";
import { tasksApi } from "../../api/tasks";
import { TaskRecord } from "../../api/types";

export interface UseTaskUnreadCountsOptions {
  token?: string;
  currentUserId?: string;
  tasks: TaskRecord[];
  enabled?: boolean;
  maxSubscriptions?: number;
  onError?: (message: string) => void;
}

export interface UseTaskUnreadCountsResult {
  unreadByTaskId: Record<string, number>;
  totalUnread: number;
}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Failed to subscribe unread counts.";
};

export const useTaskUnreadCounts = ({
  token,
  currentUserId,
  tasks,
  enabled = true,
  maxSubscriptions = 120,
  onError
}: UseTaskUnreadCountsOptions): UseTaskUnreadCountsResult => {
  const tokenValue = token ?? "";
  const userIdValue = currentUserId ?? "";
  const taskIds = useMemo(
    () =>
      Array.from(
        new Set(
          tasks
            .map((task) => String(task.id ?? "").trim())
            .filter((taskId) => taskId.length > 0)
        )
      ).sort(),
    [tasks]
  );
  const cappedTaskIds = useMemo(
    () => taskIds.slice(0, Math.max(0, Math.min(Math.round(maxSubscriptions), taskIds.length))),
    [maxSubscriptions, taskIds]
  );
  const taskIdsKey = taskIds.join("|");
  const canSubscribe = enabled && tokenValue.length > 0 && userIdValue.length > 0 && cappedTaskIds.length > 0;

  const [unreadByTaskId, setUnreadByTaskId] = useState<Record<string, number>>({});

  useEffect(() => {
    const emptyState = taskIds.reduce<Record<string, number>>((accumulator, taskId) => {
      accumulator[taskId] = 0;
      return accumulator;
    }, {});
    setUnreadByTaskId(emptyState);
  }, [taskIdsKey]);

  useEffect(() => {
    if (!canSubscribe) {
      return;
    }

    let active = true;
    const unsubs = cappedTaskIds.map((taskId) =>
      tasksApi.subscribeTaskUnreadCount(
        tokenValue,
        taskId,
        userIdValue,
        (count) => {
          if (!active) {
            return;
          }
          setUnreadByTaskId((current) => {
            if (current[taskId] === count) {
              return current;
            }
            return {
              ...current,
              [taskId]: count
            };
          });
        },
        (error) => {
          onError?.(toErrorMessage(error));
        }
      )
    );

    return () => {
      active = false;
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [canSubscribe, cappedTaskIds, onError, tokenValue, userIdValue]);

  const totalUnread = useMemo(
    () => Object.values(unreadByTaskId).reduce((total, count) => total + (Number.isFinite(count) ? count : 0), 0),
    [unreadByTaskId]
  );

  return {
    unreadByTaskId,
    totalUnread
  };
};
