import type { LeadRecord } from "../../api/types";

export type QueuePriority = "overdue_callback" | "upcoming_callback" | "hot" | "warm" | "cold";

export interface QueuedLead extends LeadRecord {
  queuePriority: QueuePriority;
  isCallbackOverdue: boolean;
  isCallbackUpcoming: boolean;
}

/**
 * Sort leads into a prioritized call queue:
 *   1. Overdue callbacks (oldest first)
 *   2. Upcoming callbacks (within 60 min)
 *   3. Hot leads (score desc)
 *   4. Warm leads (score desc)
 *   5. Cold leads (newest first)
 *
 * Within each tier, secondary sort by lastActivityAt ascending (least-recently-touched first).
 */
export const sortLeadsByCallQueue = (leads: LeadRecord[]): QueuedLead[] => {
  const now = Date.now();
  const oneHourFromNow = now + 60 * 60 * 1000;

  const queued: QueuedLead[] = leads.map((lead) => {
    const callbackTime = lead.callbackScheduledAt ? new Date(lead.callbackScheduledAt).getTime() : null;
    const isCallbackOverdue =
      lead.subStatus === "callback_requested" && callbackTime !== null && callbackTime < now;
    const isCallbackUpcoming =
      lead.subStatus === "callback_requested" &&
      callbackTime !== null &&
      callbackTime >= now &&
      callbackTime <= oneHourFromNow;

    let queuePriority: QueuePriority;
    if (isCallbackOverdue) {
      queuePriority = "overdue_callback";
    } else if (isCallbackUpcoming) {
      queuePriority = "upcoming_callback";
    } else if (lead.scoreLabel === "hot") {
      queuePriority = "hot";
    } else if (lead.scoreLabel === "warm") {
      queuePriority = "warm";
    } else {
      queuePriority = "cold";
    }

    return { ...lead, queuePriority, isCallbackOverdue, isCallbackUpcoming };
  });

  const priorityOrder: Record<QueuePriority, number> = {
    overdue_callback: 0,
    upcoming_callback: 1,
    hot: 2,
    warm: 3,
    cold: 4,
  };

  return queued.sort((a, b) => {
    // Primary: priority tier
    const tierDiff = priorityOrder[a.queuePriority] - priorityOrder[b.queuePriority];
    if (tierDiff !== 0) return tierDiff;

    // Within callbacks: sort by callback time (oldest overdue first, soonest upcoming first)
    if (a.queuePriority === "overdue_callback" || a.queuePriority === "upcoming_callback") {
      const aTime = a.callbackScheduledAt ? new Date(a.callbackScheduledAt).getTime() : 0;
      const bTime = b.callbackScheduledAt ? new Date(b.callbackScheduledAt).getTime() : 0;
      return aTime - bTime;
    }

    // Within hot/warm: higher score first
    if (a.queuePriority === "hot" || a.queuePriority === "warm") {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
    }

    // Secondary: least-recently-touched first
    const aActivity = a.lastActivityAt ?? a.createdAt;
    const bActivity = b.lastActivityAt ?? b.createdAt;
    return aActivity.localeCompare(bActivity);
  });
};

/** Group queued leads by priority for section rendering. */
export const groupByPriority = (
  leads: QueuedLead[]
): Record<QueuePriority, QueuedLead[]> => ({
  overdue_callback: leads.filter((l) => l.queuePriority === "overdue_callback"),
  upcoming_callback: leads.filter((l) => l.queuePriority === "upcoming_callback"),
  hot: leads.filter((l) => l.queuePriority === "hot"),
  warm: leads.filter((l) => l.queuePriority === "warm"),
  cold: leads.filter((l) => l.queuePriority === "cold"),
});
