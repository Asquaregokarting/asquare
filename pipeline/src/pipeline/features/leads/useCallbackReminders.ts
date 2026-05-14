import { useEffect, useMemo, useRef, useState } from "react";
import type { LeadRecord } from "../../api/types";

interface CallbackReminders {
  overdueCallbacks: LeadRecord[];
  upcomingCallbacks: LeadRecord[];
}

/**
 * Monitors lead callbacks and fires browser notifications when they become overdue.
 * Re-evaluates every 60 seconds.
 */
export const useCallbackReminders = (leads: LeadRecord[]): CallbackReminders => {
  const [tick, setTick] = useState(0);
  const notifiedIdsRef = useRef(new Set<string>());

  // Re-evaluate every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  const { overdueCallbacks, upcomingCallbacks } = useMemo(() => {
    const now = Date.now();
    const oneHourFromNow = now + 60 * 60 * 1000;
    const overdue: LeadRecord[] = [];
    const upcoming: LeadRecord[] = [];

    for (const lead of leads) {
      if (lead.subStatus !== "callback_requested" || !lead.callbackScheduledAt) continue;
      const callbackTime = new Date(lead.callbackScheduledAt).getTime();

      if (callbackTime < now) {
        overdue.push(lead);
      } else if (callbackTime <= oneHourFromNow) {
        upcoming.push(lead);
      }
    }

    // Sort overdue: most overdue first
    overdue.sort(
      (a, b) =>
        new Date(a.callbackScheduledAt!).getTime() - new Date(b.callbackScheduledAt!).getTime()
    );
    upcoming.sort(
      (a, b) =>
        new Date(a.callbackScheduledAt!).getTime() - new Date(b.callbackScheduledAt!).getTime()
    );

    return { overdueCallbacks: overdue, upcomingCallbacks: upcoming };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, tick]);

  // Fire browser notifications for newly overdue callbacks
  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    for (const lead of overdueCallbacks) {
      if (notifiedIdsRef.current.has(lead.id)) continue;
      notifiedIdsRef.current.add(lead.id);

      new Notification("Callback Due", {
        body: `Time to call ${lead.customerName} (${lead.customerPhone})`,
        icon: "/favicon.ico",
        tag: `callback-${lead.id}`,
      });
    }
  }, [overdueCallbacks]);

  return { overdueCallbacks, upcomingCallbacks };
};

/** Request browser notification permission. */
export const requestCallbackNotificationPermission = async (): Promise<boolean> => {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const result = await Notification.requestPermission();
  return result === "granted";
};
