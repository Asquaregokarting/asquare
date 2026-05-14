import { fmtTimeShortIST } from "../../../lib/date-format";
import { isTerminatedBooking } from "../../../lib/booking-filter";
import { adminApi } from "../../api/admin";
import { billingApi } from "../../api/billing";
import { reportsApi } from "../../api/reports";
import { telecallerPerformanceApi } from "../../api/telecaller-performance";
import { tasksApi } from "../../api/tasks";
import { trackApi } from "../../api/track";
import { shiftsApi } from "../../api/shifts";
import {
  listFirestoreLeaveRequests,
  listFirestoreOvertimeRequests,
} from "../../api/shift-workforce-firestore";
import { listHRAppraisals } from "../../api/hr-appraisals-firestore";
import { listPayrollRuns } from "../../api/hr-payroll-firestore";
import { usersApi } from "../../api/users";
import { GameRevenueReportRecord, Role } from "../../api/types";
import { getAvailableKartCountByLocation } from "../track/services/kartService";
import { getLocationDisplayName } from "../../../lib/locations";

export interface StaffShiftEntry {
  name: string;
  role?: string;
  location?: string;
  status?: "active" | "completed";
}

export interface DashboardFeedItem {
  id: string;
  title: string;
  detail: string;
  tone: "success" | "warning" | "critical" | "info" | "muted";
  staffList?: StaffShiftEntry[];
}

export interface LocationCheckout {
  locationId: string;
  locationName: string;
  cashTotal: number;
  cardTotal: number;
  upiTotal: number;
  totalTransactions: number;
  settledAt: string;
  cashEntered?: number;
  cardEntered?: number;
  upiEntered?: number;
}

export interface DashboardSnapshot {
  kpiValues: Record<string, string>;
  activity: DashboardFeedItem[];
  alerts: DashboardFeedItem[];
  gameRevenue?: GameRevenueReportRecord;
  locationCheckouts?: LocationCheckout[];
}

interface DashboardInput {
  role: Role;
  token: string;
  userId: string;
  allowedSlugs?: string[];
}

const safe = async <T>(promise: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await promise;
  } catch {
    return fallback;
  }
};

const isSameDay = (isoDate: string, now: Date): boolean => {
  const date = new Date(isoDate);
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  );
};

const percentage = (value: number): string => `${Math.max(0, Math.min(100, Math.round(value)))}%`;
const currency = (value: number): string => `INR ${Math.round(value).toLocaleString("en-IN")}`;

export const loadDashboardData = async ({ role, token, userId, allowedSlugs }: DashboardInput): Promise<DashboardSnapshot> => {
  const now = new Date();
  const monthKey = telecallerPerformanceApi.getCurrentMonthKey();

  const today = now.toISOString().slice(0, 10);

  const isHRPriv = role === "HR" || role === "Owner" || role === "Admin";
  const [
    userResult,
    auditResult,
    transactionResult,
    kartResult,
    sessionResult,
    incidentResult,
    workspaceResult,
    taskResult,
    telecallerPerformanceResult,
    gameRevenueResult,
    shiftResult,
    pendingLeaveRequests,
    pendingOvertimeRequests,
    pendingHrAppraisals,
    recentPayrollRuns
  ] =
    await Promise.all([
      safe(usersApi.list(token), { users: [] }),
      safe(adminApi.listAuditLogs(token, 12), { logs: [] }),
      safe(billingApi.listTransactions(token), { transactions: [] }),
      safe(trackApi.listKarts(token), { karts: [] }),
      safe(trackApi.listSessions(token), { sessions: [] }),
      safe(trackApi.listIncidents(token), { incidents: [] }),
      safe(tasksApi.listWorkspaces(token), { workspaces: [] }),
      safe(tasksApi.listTasks(token), { tasks: [] }),
      role === "Telecaller"
        ? safe(telecallerPerformanceApi.listPerformance({ monthKey, telecallerIds: [userId] }), { performance: [] })
        : Promise.resolve({ performance: [] }),
      role === "Owner"
        ? safe(reportsApi.gameRevenue(token, { from: today, to: today }), { report: null as unknown as Record<string, unknown> })
        : Promise.resolve({ report: null as unknown as Record<string, unknown> }),
      role === "Owner" || role === "Admin"
        ? safe(shiftsApi.list(token, { from: today, to: today }), { shifts: [] })
        : Promise.resolve({ shifts: [] }),
      // HR KPIs — fetch pending leave + overtime queues for the dashboard
      // count cards. Other roles get empty arrays so the cost stays zero.
      isHRPriv
        ? safe(listFirestoreLeaveRequests(token, { status: "Pending" }), [])
        : Promise.resolve([]),
      isHRPriv
        ? safe(listFirestoreOvertimeRequests(token, { status: "Pending" }), [])
        : Promise.resolve([]),
      // HR signals from the new modules — appraisals waiting on HR
      // and the most recent payroll run. Kart cleaning compliance is
      // surfaced inside the /hr/kart-monitor module itself via
      // subscribeDeepCleanHistoryByLocation (real-time, no need to
      // re-aggregate here).
      isHRPriv ? safe(listHRAppraisals({ stage: "hr" }), []) : Promise.resolve([]),
      isHRPriv ? safe(listPayrollRuns(), []) : Promise.resolve([])
    ]);

  const users = userResult.users;
  const logs = auditResult.logs;
  const allTransactions = transactionResult.transactions;
  const transactions = allowedSlugs && allowedSlugs.length > 0
    ? allTransactions.filter(t => allowedSlugs.includes(t.locationId ?? ""))
    : allTransactions;
  const karts = kartResult.karts;
  const sessions = sessionResult.sessions;
  const incidents = incidentResult.incidents;
  const workspaces = workspaceResult.workspaces;
  const tasks = taskResult.tasks;
  const telecallerPerformance = telecallerPerformanceResult.performance[0] ?? null;

  const todayTransactions = transactions.filter(
    (item) =>
      isSameDay(item.transactionDate, now) &&
      item.paymentStatus === "completed" &&
      // Canonical termination check — pre-fix this only excluded
      // `cancelled === true`, missing deletedAt / voidedAt / bookingStatus
      // = 'cancelled' from the dashboard's revenue / refunds / avg-
      // invoice KPIs.
      !isTerminatedBooking(item as unknown as Record<string, unknown>)
  );
  const revenueToday = todayTransactions.reduce((sum, item) => sum + item.totalAmount, 0);
  const refundsToday = todayTransactions.filter((item) => item.refundStatus !== "None").length;
  const averageInvoice = todayTransactions.length > 0 ? revenueToday / todayTransactions.length : 0;
  const pendingToday = transactions.filter(
    (item) => isSameDay(item.transactionDate, now) && item.paymentStatus === "pending"
  ).length;

  const activeSessions = sessions.filter((item) => item.status === "Active");
  const openIncidents = incidents.filter((item) => item.status !== "Resolved");
  const availableKarts = karts.filter((item) => item.status === "Available");

  // Location-aware kart count: query Firestore directly for the user's location
  let locationKartCount: number | null = null;
  if (role === "TrackMarshall" || role === "Owner" || role === "Admin") {
    const locationSlug = allowedSlugs?.[0];
    if (locationSlug) {
      locationKartCount = await safe(getAvailableKartCountByLocation(locationSlug), 0);
    }
  }

  const myTasks = tasks.filter((item) => item.assignedTo === userId);
  const blockedTasks = tasks.filter((item) => item.status === "Blocked");
  const overdueTasks = tasks.filter(
    (item) => new Date(item.dueDate).getTime() < now.getTime() && item.status !== "Completed"
  );
  const dueToday = tasks.filter((item) => isSameDay(item.dueDate, now));

  const shiftStartToday = logs.filter((item) => item.action === "SHIFT_STARTED" && isSameDay(item.createdAt, now)).length;
  const shiftEndToday = logs.filter((item) => item.action === "SHIFT_ENDED" && isSameDay(item.createdAt, now)).length;
  const activeShifts = Math.max(0, shiftStartToday - shiftEndToday);
  const shiftCompliance = shiftStartToday > 0 ? (shiftEndToday / shiftStartToday) * 100 : 100;

  const recentActivity: DashboardFeedItem[] =
    logs.length > 0
      ? logs.slice(0, 6).map((log) => ({
          id: log.id,
          title: log.action.replaceAll("_", " "),
          detail: `${log.entityType} ${log.entityId.slice(0, 8)} • ${fmtTimeShortIST(log.createdAt)}`,
          tone: log.action.includes("REFUND") || log.action.includes("INCIDENT") ? "warning" : "info"
        }))
      : [
          {
            id: "no-events",
            title: "No activity stream available",
            detail: "Audit logs are empty or restricted for this role.",
            tone: "muted"
          }
        ];

  const alerts: DashboardFeedItem[] = [];

  if (openIncidents.length > 0) {
    alerts.push({
      id: "open-incidents",
      title: "Safety incidents open",
      detail: `${openIncidents.length} incidents require review.`,
      tone: "critical"
    });
  }
  if (overdueTasks.length > 0) {
    alerts.push({
      id: "task-overdue",
      title: "Overdue tasks detected",
      detail: `${overdueTasks.length} tasks are beyond due date.`,
      tone: "warning"
    });
  }

  if (role === "Owner" || role === "Admin") {
    const SHIFT_ELIGIBLE_ROLES: Role[] = ["Cashier", "TrackMarshall"];
    const todayShifts = shiftResult.shifts;
    const shiftEligibleStaff = users.filter(
      (u) => u.isActive && SHIFT_ELIGIBLE_ROLES.includes(u.role)
    );

    if (shiftEligibleStaff.length > 0) {
      const usersWithShiftToday = new Set(todayShifts.map((s) => s.userId));
      const notStarted = shiftEligibleStaff.filter((u) => !usersWithShiftToday.has(u.id));

      const activeShifts = todayShifts.filter((s) => !s.endTime);
      const activeUserIds = new Set(activeShifts.map((s) => s.userId));
      const completedUserIds = new Set(
        todayShifts
          .filter((s) => s.endTime && !activeUserIds.has(s.userId))
          .map((s) => s.userId)
      );

      const userNameMap = new Map(users.map((u) => [u.id, u.name]));
      const userRoleMap = new Map(todayShifts.map((s) => [s.userId, s.role]));
      const userShiftLocationMap = new Map(todayShifts.map((s) => [s.userId, s.locationName]));

      const startedStaffList: StaffShiftEntry[] = [];
      if (activeShifts.length > 0) {
        const seen = new Set<string>();
        for (const s of activeShifts) {
          if (!seen.has(s.userId)) {
            seen.add(s.userId);
            startedStaffList.push({
              name: userNameMap.get(s.userId) ?? s.userId.slice(0, 8),
              role: s.role || undefined,
              location: s.locationName || undefined,
              status: "active"
            });
          }
        }
      }
      for (const id of completedUserIds) {
        startedStaffList.push({
          name: userNameMap.get(id) ?? id.slice(0, 8),
          role: userRoleMap.get(id) || undefined,
          location: userShiftLocationMap.get(id) || undefined,
          status: "completed"
        });
      }

      if (startedStaffList.length > 0) {
        const activeCount = startedStaffList.filter((s) => s.status === "active").length;
        const completedCount = startedStaffList.filter((s) => s.status === "completed").length;
        const parts: string[] = [];
        if (activeCount > 0) parts.push(`${activeCount} active`);
        if (completedCount > 0) parts.push(`${completedCount} completed`);
        alerts.push({
          id: "shift-started",
          title: `${startedStaffList.length} staff on shift`,
          detail: parts.join(", "),
          tone: "success",
          staffList: startedStaffList
        });
      }

      if (notStarted.length > 0) {
        alerts.push({
          id: "shift-not-started",
          title: `${notStarted.length} staff not on shift`,
          detail: `${notStarted.length} shift-eligible staff have not started today.`,
          tone: "warning",
          staffList: notStarted.map((u) => ({
            name: u.name,
            role: u.role,
            location: u.allowedLocations?.[0] ? getLocationDisplayName(u.allowedLocations[0]) : undefined,
          }))
        });
      }
    }
  }

  if (alerts.length === 0) {
    alerts.push({
      id: "all-clear",
      title: "Operations stable",
      detail: "No critical alerts in current dashboard scope.",
      tone: "success"
    });
  }

  const kpiByRole: Record<Role, Record<string, string>> = {
    Owner: {
      activeShifts: String(activeShifts),
      revenueToday: currency(revenueToday),
      activeSessions: String(activeSessions.length)
    },
    Admin: {
      shiftCompliance: percentage(shiftCompliance),
      refundRequests: String(refundsToday),
      overdueTasks: String(overdueTasks.length)
    },
    Telecaller: {
      myBookings: String(telecallerPerformance?.bookingCount ?? 0),
      myBookedAmount: currency(telecallerPerformance?.bookedAmount ?? 0),
      myTargetProgress: telecallerPerformance?.hasPlan ? currency(telecallerPerformance.targetAmount) : "No target",
      myEstimatedIncentive: currency(telecallerPerformance?.estimatedIncentiveTotal ?? 0)
    },
    Cashier: {
      transactionsToday: String(todayTransactions.length),
      revenueToday: currency(revenueToday),
      refundsToday: String(refundsToday),
      averageInvoice: currency(averageInvoice),
      pendingToday: String(pendingToday)
    },
    TrackMarshall: {
      availableKarts: String(locationKartCount ?? availableKarts.length),
      activeSessions: String(activeSessions.length),
      openIncidents: String(openIncidents.length)
    },
    Incharge: {},
    Editor: {
      assignedTasks: String(myTasks.length),
      dueToday: String(dueToday.length),
      blockedTasks: String(blockedTasks.length)
    },
    Developer: {
      apiHealth: openIncidents.length === 0 ? "Healthy" : "Degraded",
      errorCount: String(openIncidents.length),
      latencyBand: openIncidents.length > 2 ? "Elevated" : "Nominal",
      failedJobs: String(alerts.filter((item) => item.tone === "critical").length)
    },
    Backend: {
      apiHealth: openIncidents.length === 0 ? "Healthy" : "Degraded",
      errorCount: String(openIncidents.length),
      latencyBand: openIncidents.length > 2 ? "Elevated" : "Nominal",
      failedJobs: String(alerts.filter((item) => item.tone === "critical").length)
    },
    ThirdParty: {
      apiHealth: openIncidents.length === 0 ? "Healthy" : "Degraded",
      errorCount: String(openIncidents.length),
      latencyBand: openIncidents.length > 2 ? "Elevated" : "Nominal",
      failedJobs: String(alerts.filter((item) => item.tone === "critical").length)
    },
    // HR KPIs — leave / overtime queues are live now from the
    // shift-workforce-firestore Firestore reads. `absentStaffToday`
    // stays a placeholder until we have a published roster source
    // (computing "absent" requires knowing who SHOULD be working
    // today vs who actually checked in — needs a roster doc).
    HR: {
      openLeaveRequests: String(pendingLeaveRequests.length),
      openOvertimeRequests: String(pendingOvertimeRequests.length),
      activeShiftsToday: String(activeShifts),
      absentStaffToday: "—",
      pendingAppraisals: String(pendingHrAppraisals.length),
      // Kart cleaning compliance moved into the /hr/kart-monitor module
      // since it reads from kartService's per-location subscriptions —
      // expose the link from the dashboard rather than re-aggregating.
      kartChecksToday: "—",
      payrollDraftStatus:
        recentPayrollRuns.length === 0
          ? "No runs"
          : recentPayrollRuns[0]
            ? `${recentPayrollRuns[0].monthIso} · ${recentPayrollRuns[0].status}`
            : "—"
    },
    Accountant: {
      pendingVendorPayouts: "—",
      pendingRefundApprovals: String(refundsToday),
      openReconciliations: "—",
      monthGstLiability: "—"
    }
  };

  // ── Location checkouts (Owner/Admin only) ────────────────────────────────
  let locationCheckouts: LocationCheckout[] | undefined;
  if (role === "Owner" || role === "Admin") {
    const completedShifts = shiftResult.shifts.filter((s) => s.settlement);
    const locMap = new Map<string, LocationCheckout>();
    for (const s of completedShifts) {
      const loc = s.locationId;
      const existing = locMap.get(loc);
      const stl = s.settlement!;
      if (!existing) {
        locMap.set(loc, {
          locationId: loc,
          locationName: s.locationName || getLocationDisplayName(loc),
          cashTotal: stl.cashActual,
          cardTotal: stl.cardActual,
          upiTotal: stl.upiActual,
          totalTransactions: stl.totalTransactions,
          settledAt: stl.settledAt,
          cashEntered: stl.cashEntered,
          cardEntered: stl.cardEntered,
          upiEntered: stl.upiEntered,
        });
      } else {
        existing.cashTotal += stl.cashActual;
        existing.cardTotal += stl.cardActual;
        existing.upiTotal += stl.upiActual;
        existing.totalTransactions += stl.totalTransactions;
        if (stl.settledAt > existing.settledAt) existing.settledAt = stl.settledAt;
        existing.cashEntered = (existing.cashEntered ?? 0) + stl.cashEntered;
        existing.cardEntered = (existing.cardEntered ?? 0) + stl.cardEntered;
        existing.upiEntered = (existing.upiEntered ?? 0) + stl.upiEntered;
      }
    }
    if (locMap.size > 0) locationCheckouts = [...locMap.values()];
  }

  return {
    kpiValues: {
      ...kpiByRole[role],
      _metaUsers: String(users.filter((user) => user.isActive).length),
      _metaWorkspaces: String(workspaces.length)
    },
    activity: recentActivity,
    alerts,
    gameRevenue: gameRevenueResult.report
      ? (gameRevenueResult.report as unknown as GameRevenueReportRecord)
      : undefined,
    locationCheckouts
  };
};
