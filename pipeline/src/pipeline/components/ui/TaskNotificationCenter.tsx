import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fmtDateTimeFullIST } from "../../../lib/date-format";
import type { NotificationSound, TaskNotificationRecord, UserNotificationSettings } from "../../api/types";
import { buildAbsoluteAppUrl } from "../../app/runtime";
import { useTaskNotifications } from "../../features/tasks/useTaskNotifications";

interface TaskNotificationCenterProps {
  token?: string;
  currentUserId?: string;
  notificationSettings?: UserNotificationSettings;
  onError?: (message: string) => void;
  buttonContainerClassName?: string;
  desktopDropdownAlign?: "left" | "right";
  showToastAlerts?: boolean;
}

const defaultNotificationSettings: UserNotificationSettings = {
  sound: "soft",
  browserPushEnabled: false
};

const formatTimestamp = (value: string): string => {
  return fmtDateTimeFullIST(value);
};

const getTaskPath = (workspaceId: string, taskId: string): string => `/workspaces/${workspaceId}/task/${taskId}`;

const playPresetSound = (context: AudioContext, sound: Exclude<NotificationSound, "custom" | "off">) => {
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  if (sound === "chime") {
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(920, now);
    oscillator.frequency.exponentialRampToValueAtTime(730, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.34);
    return;
  }

  if (sound === "bell") {
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(700, now);
    oscillator.frequency.exponentialRampToValueAtTime(520, now + 0.28);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.38);
    return;
  }

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(820, now);
  oscillator.frequency.exponentialRampToValueAtTime(620, now + 0.18);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.03, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.26);
};

export const TaskNotificationCenter = ({
  token,
  currentUserId,
  notificationSettings,
  onError,
  buttonContainerClassName,
  showToastAlerts = true
}: TaskNotificationCenterProps) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  const {
    notifications,
    unreadCount,
    toastNotifications,
    markNotificationRead,
    markAllRead,
    clearAllNotifications,
    dismissToast
  } = useTaskNotifications({
    token,
    currentUserId,
    onError
  });
  const playedToastIdsRef = useRef<Set<string>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  const customAudioRef = useRef<HTMLAudioElement | null>(null);

  const recentNotifications = useMemo(() => notifications.slice(0, 20), [notifications]);

  const openTaskPage = (notification: TaskNotificationRecord) => {
    setOpen(false);
    navigate(getTaskPath(notification.workspaceId, notification.taskId));
  };

  useEffect(() => {
    const incomingToast = toastNotifications.filter((item) => !playedToastIdsRef.current.has(item.id));
    if (incomingToast.length === 0) {
      return;
    }

    incomingToast.forEach((item) => playedToastIdsRef.current.add(item.id));
    const notificationPreferences = notificationSettings ?? defaultNotificationSettings;

    if (typeof window !== "undefined") {
      incomingToast.forEach((notification) => {
        window.dispatchEvent(new CustomEvent("pipeline:task-notification", { detail: notification }));
      });
    }

    if (notificationPreferences.sound !== "off") {
      if (notificationPreferences.sound === "custom" && notificationPreferences.customSoundDataUrl) {
        try {
          if (!customAudioRef.current || customAudioRef.current.src !== notificationPreferences.customSoundDataUrl) {
            customAudioRef.current = new Audio(notificationPreferences.customSoundDataUrl);
            customAudioRef.current.preload = "auto";
          }
          customAudioRef.current.currentTime = 0;
          customAudioRef.current.volume = 0.35;
          void customAudioRef.current.play().catch(() => undefined);
        } catch {
          // Ignore audio playback errors caused by browser autoplay restrictions.
        }
      } else if (typeof window !== "undefined" && typeof window.AudioContext !== "undefined") {
        const context = audioContextRef.current ?? new window.AudioContext();
        audioContextRef.current = context;
        if (context.state === "suspended") {
          void context.resume().catch(() => undefined);
        }
        playPresetSound(
          context,
          notificationPreferences.sound === "bell" || notificationPreferences.sound === "chime" ? notificationPreferences.sound : "soft"
        );
      }
    }

    const canShowBrowserPush =
      typeof window !== "undefined" &&
      typeof document !== "undefined" &&
      "Notification" in window &&
      notificationPreferences.browserPushEnabled &&
      Notification.permission === "granted" &&
      document.visibilityState !== "visible";

    if (canShowBrowserPush) {
      incomingToast.slice(0, 3).forEach((notification) => {
        try {
          const push = new Notification(notification.taskName, {
            body: `${notification.senderName}: ${notification.messagePreview}`,
            tag: `pipeline-task-notification-${notification.id}`
          });
          push.onclick = () => {
            window.focus();
            window.location.assign(buildAbsoluteAppUrl(getTaskPath(notification.workspaceId, notification.taskId)));
            push.close();
          };
          window.setTimeout(() => push.close(), 8000);
        } catch {
          // Ignore browser notification errors.
        }
      });
    }
  }, [notificationSettings, toastNotifications]);

  useEffect(
    () => () => {
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => undefined);
      }
      if (customAudioRef.current) {
        customAudioRef.current.pause();
      }
    },
    []
  );

  return (
    <>
      {showToastAlerts ? (
        <div className="pointer-events-none fixed right-4 top-4 z-[120] flex w-[min(92vw,360px)] flex-col gap-2">
          {toastNotifications.map((notification) => (
            <article
              key={notification.id}
              role="status"
              onClick={() => openTaskPage(notification)}
              className="pointer-events-auto cursor-pointer rounded-xl border border-info/35 bg-panel/95 px-3 py-2.5 shadow-panel backdrop-blur"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text">{notification.taskName}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {notification.senderName} | {formatTimestamp(notification.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    dismissToast(notification.id);
                  }}
                  className="ui-btn ui-btn-neutral min-h-7 px-2 py-0.5 text-[10px]"
                >
                  Close
                </button>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-text/90">{notification.messagePreview}</p>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openTaskPage(notification);
                  }}
                  className="ui-btn ui-btn-info min-h-8 px-2.5 py-1 text-[11px]"
                >
                  Open Task
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <div ref={containerRef} className={buttonContainerClassName ?? "relative"}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="ui-btn ui-btn-neutral relative min-h-9 px-3 py-1.5 text-xs gap-1.5"
          aria-label="Notifications"
          aria-expanded={open}
        >
          <span aria-hidden="true">&#128276;</span>
          {unreadCount > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-4 h-4 items-center justify-center rounded-full border border-critical/60 bg-critical px-1 text-[9px] font-semibold text-white leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>

        {open ? (
          <div className="absolute right-0 top-full mt-1 z-[95] flex w-80 flex-col rounded-xl border border-border/70 bg-panel shadow-panel overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
              <h4 className="text-xs font-semibold text-text">Notifications</h4>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { void markAllRead(); }}
                  className="ui-btn ui-btn-info min-h-7 px-2 py-0.5 text-[10px]"
                >
                  Mark all read
                </button>
                <button
                  type="button"
                  onClick={() => { void clearAllNotifications(); }}
                  className="ui-btn ui-btn-danger min-h-7 px-2 py-0.5 text-[10px]"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {recentNotifications.length > 0 ? (
                <div className="space-y-px p-1.5">
                  {recentNotifications.map((notification) => {
                    const isUnread = !notification.readAt;
                    return (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => {
                          if (isUnread) {
                            void markNotificationRead(notification.id);
                          }
                          openTaskPage(notification);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                          isUnread ? "border-critical/35 bg-critical/10" : "border-border/65 bg-surface/65"
                        }`}
                      >
                        <p className="text-[10px] text-muted">
                          {notification.senderName} · {formatTimestamp(notification.createdAt)}
                        </p>
                        <p className="mt-0.5 text-xs font-semibold text-text">{notification.taskName}</p>
                        <p className="mt-0.5 line-clamp-2 text-[10px] text-muted">{notification.messagePreview}</p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="px-3 py-6 text-center text-xs text-muted">
                  No notifications yet.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
};
