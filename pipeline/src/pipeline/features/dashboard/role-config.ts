import { Role } from "../../api/types";

export type Tone = "success" | "warning" | "critical" | "info" | "muted";

export interface KpiConfig {
  id: string;
  label: string;
  tone: Tone;
}

export interface ActionConfig {
  id: string;
  label: string;
  description: string;
  hotkey?: string;
  tone?: Tone;
  /** Optional lucide-react icon name for the quickFabAction. AppShell maps
   *  this to an icon component; unknown names fall back to no icon. */
  icon?:
    | "layout-dashboard"
    | "user-plus"
    | "play"
    | "credit-card"
    | "qr-code"
    | "clipboard-list"
    | "upload"
    | "activity";
}

export interface DashboardRoleConfig {
  role: Role;
  title: string;
  subtitle: string;
  path: string;
  navItems: Array<{ label: string; href: string }>;
  kpis: KpiConfig[];
  primaryActions: ActionConfig[];
  quickFabAction: ActionConfig;
}

export const rolePathMap: Record<Role, string> = {
  Owner: "/dashboard/owner",
  Admin: "/dashboard/admin",
  Telecaller: "/dashboard/telecaller",
  Cashier: "/dashboard/cashier",
  TrackMarshall: "/dashboard/track-marshall",
  Incharge: "/incharge/tasks",
  Editor: "/dashboard/editor",
  Developer: "/dashboard/developer",
  Backend: "/dashboard/backend",
  ThirdParty: "/dashboard/third-party",
  // HR and Accountant land on their respective dashboards. This is the
  // path the Dashboard tab + post-login redirect both target — keeping
  // them in sync prevents the Dashboard tab from bouncing the user to
  // a module page instead of an actual dashboard. From the dashboard
  // they navigate to Shifts (HR) or Accounting (Accountant) via the
  // sidebar like every other role does.
  HR: "/dashboard/hr",
  Accountant: "/dashboard/accountant"
};

const baseNav: Array<{ label: string; href: string }> = [];

export const roleConfig: Record<Role, DashboardRoleConfig> = {
  Owner: {
    role: "Owner",
    title: "Owner Command Center",
    subtitle: "Cross-department governance and strategic control.",
    path: rolePathMap.Owner,
    navItems: baseNav,
    kpis: [],
    primaryActions: [],
    quickFabAction: {
      id: "dashboard",
      label: "Dashboard",
      description: "Owner command center",
      icon: "layout-dashboard"
    }
  },
  Admin: {
    role: "Admin",
    title: "Admin Operations Hub",
    subtitle: "Execution oversight, staffing, and workflow control.",
    path: rolePathMap.Admin,
    navItems: baseNav,
    kpis: [
      { id: "shiftCompliance", label: "Shift Compliance", tone: "success" },
      { id: "refundRequests", label: "Refund Requests", tone: "critical" },
      { id: "overdueTasks", label: "Overdue Tasks", tone: "critical" }
    ],
    primaryActions: [
      { id: "user-create", label: "Create User", description: "Provision an invite-only account", hotkey: "U" },
      { id: "approve-refund", label: "Approve Refund", description: "Resolve pending refund queue", tone: "warning" }
    ],
    quickFabAction: { id: "admin-user", label: "New User", description: "Fast user provisioning" }
  },
  Telecaller: {
    role: "Telecaller",
    title: "Telecaller Execution Board",
    subtitle: "Callback discipline and conversion velocity.",
    path: rolePathMap.Telecaller,
    navItems: baseNav,
    kpis: [
      { id: "myBookings", label: "My Bookings", tone: "info" },
      { id: "myBookedAmount", label: "My Booked Amount", tone: "success" },
      { id: "myTargetProgress", label: "My Monthly Target", tone: "warning" },
      { id: "myEstimatedIncentive", label: "My Estimated Incentive", tone: "critical" }
    ],
    primaryActions: [
      { id: "start-shift", label: "Shift Control", description: "Start, break, and end shift", tone: "info" }
    ],
    quickFabAction: { id: "start-shift", label: "Shift", description: "Start shift now" }
  },
  Cashier: {
    role: "Cashier",
    title: "Cashier POS Deck",
    subtitle: "Billing throughput, reconciliation, and payment mix.",
    path: rolePathMap.Cashier,
    navItems: baseNav,
    kpis: [],
    primaryActions: [
      { id: "new-transaction", label: "POS", description: "Open POS transaction", hotkey: "N" },
      { id: "refund", label: "Process Refund", description: "Issue partial/full refund", tone: "warning" },
      { id: "reconcile", label: "Reconcile Shift", description: "Close day cash position", hotkey: "R" }
    ],
    quickFabAction: { id: "cashier-pos", label: "POS", description: "Open quick transaction" }
  },
  TrackMarshall: {
    role: "TrackMarshall",
    title: "Track Marshall Live Board",
    subtitle: "Track safety, kart utilization, and session throughput.",
    path: rolePathMap.TrackMarshall,
    navItems: baseNav,
    kpis: [
      { id: "pendingScans", label: "Pending Scans", tone: "warning" },
      { id: "availableKarts", label: "Available Karts", tone: "success" },
      { id: "activeSessions", label: "Active Sessions", tone: "info" },
      { id: "openIncidents", label: "Open Incidents", tone: "critical" }
    ],
    primaryActions: [
      { id: "open-scanner", label: "Scanner", description: "Scan QR codes and verify rides", hotkey: "Q", tone: "success" },
      { id: "update-kart", label: "Update Kart", description: "Set availability or maintenance", hotkey: "K" },
      { id: "create-session", label: "Create Session", description: "Schedule next run", hotkey: "S" },
      { id: "incident", label: "Log Incident", description: "Capture safety event", tone: "critical" }
    ],
    quickFabAction: { id: "track-session", label: "Session", description: "Start session flow" }
  },
  Incharge: {
    role: "Incharge",
    title: "Incharge Daily Tasks",
    subtitle: "Mandatory daily checks: washroom, housekeeping, and vehicle report.",
    path: rolePathMap.Incharge,
    navItems: baseNav,
    kpis: [],
    primaryActions: [
      { id: "open-incharge", label: "Today's Tasks", description: "Open daily Incharge checklist", tone: "info" }
    ],
    quickFabAction: { id: "open-incharge", label: "Tasks", description: "Open daily checklist" }
  },
  Editor: {
    role: "Editor",
    title: "Editor Production Desk",
    subtitle: "Task throughput, media workflow, and delivery quality.",
    path: rolePathMap.Editor,
    navItems: baseNav,
    kpis: [
      { id: "assignedTasks", label: "Assigned Tasks", tone: "info" },
      { id: "dueToday", label: "Due Today", tone: "warning" },
      { id: "blockedTasks", label: "Blocked Tasks", tone: "critical" }
    ],
    primaryActions: [
      { id: "upload", label: "Upload Asset", description: "Attach media to task", hotkey: "U" },
      { id: "task-update", label: "Update Task", description: "Move status and comment", hotkey: "T" },
      { id: "handoff", label: "Mark Review Ready", description: "Submit for stakeholder review", tone: "success" }
    ],
    quickFabAction: { id: "editor-upload", label: "Upload", description: "Add media asset" }
  },
  Developer: {
    role: "Developer",
    title: "Developer Reliability Console",
    subtitle: "System health, incident cadence, and release safety.",
    path: rolePathMap.Developer,
    navItems: baseNav,
    kpis: [
      { id: "apiHealth", label: "API Health", tone: "success" },
      { id: "errorCount", label: "Error Count", tone: "critical" },
      { id: "latencyBand", label: "Latency Band", tone: "warning" },
      { id: "failedJobs", label: "Failed Jobs", tone: "info" }
    ],
    primaryActions: [
      { id: "inspect-logs", label: "Inspect Logs", description: "Review recent audit/error stream", hotkey: "I" },
      { id: "release-check", label: "Release Check", description: "Validate deploy readiness", hotkey: "R" },
      { id: "incident-review", label: "Incident Review", description: "Close unresolved incidents", tone: "critical" }
    ],
    quickFabAction: { id: "dev-logs", label: "Logs", description: "Open recent signals" }
  },
  Backend: {
    role: "Backend",
    title: "Backend Reliability Console",
    subtitle: "API stability, database integrity, and service observability.",
    path: rolePathMap.Backend,
    navItems: baseNav,
    kpis: [
      { id: "apiHealth", label: "API Health", tone: "success" },
      { id: "errorCount", label: "Error Count", tone: "critical" },
      { id: "latencyBand", label: "Latency Band", tone: "warning" },
      { id: "failedJobs", label: "Failed Jobs", tone: "info" }
    ],
    primaryActions: [
      { id: "inspect-logs", label: "Inspect Logs", description: "Review API and backend diagnostics", hotkey: "I" },
      { id: "release-check", label: "Release Check", description: "Validate backend deploy readiness", hotkey: "R" },
      { id: "incident-review", label: "Incident Review", description: "Resolve production incidents", tone: "critical" }
    ],
    quickFabAction: { id: "dev-logs", label: "Logs", description: "Open backend signals" }
  },
  ThirdParty: {
    role: "ThirdParty",
    title: "Third Party Operations Console",
    subtitle: "External partner visibility for operational and reporting workflows.",
    path: rolePathMap.ThirdParty,
    navItems: baseNav,
    kpis: [
      { id: "apiHealth", label: "API Health", tone: "success" },
      { id: "errorCount", label: "Error Count", tone: "critical" },
      { id: "latencyBand", label: "Latency Band", tone: "warning" },
      { id: "failedJobs", label: "Failed Jobs", tone: "info" }
    ],
    primaryActions: [
      { id: "inspect-logs", label: "Inspect Logs", description: "Review partner-facing telemetry", hotkey: "I" },
      { id: "release-check", label: "Release Check", description: "Validate integration readiness", hotkey: "R" },
      { id: "incident-review", label: "Incident Review", description: "Track external incident status", tone: "critical" }
    ],
    quickFabAction: { id: "dev-logs", label: "Logs", description: "Open partner signals" }
  },
  HR: {
    role: "HR",
    title: "HR Workforce Center",
    subtitle: "Staff scheduling, attendance, leave approvals, and incentives.",
    path: rolePathMap.HR,
    navItems: baseNav,
    kpis: [
      { id: "openLeaveRequests", label: "Open Leave Requests", tone: "warning" },
      { id: "openOvertimeRequests", label: "Open Overtime Requests", tone: "warning" },
      { id: "activeShiftsToday", label: "Active Shifts Today", tone: "info" },
      { id: "absentStaffToday", label: "Absent Today", tone: "critical" },
      { id: "pendingAppraisals", label: "Appraisals Awaiting HR", tone: "warning" },
      { id: "kartChecksToday", label: "Kart Checks Today", tone: "info" },
      { id: "payrollDraftStatus", label: "Payroll Draft", tone: "info" }
    ],
    primaryActions: [
      { id: "open-shifts", label: "Shifts", description: "Schedule and approve shifts", hotkey: "S", tone: "info" },
      { id: "open-monitor", label: "Staff Monitor", description: "Who's clocked in right now", hotkey: "M" },
      { id: "open-incentives", label: "Incentives", description: "Review staff payouts", tone: "success" }
    ],
    quickFabAction: { id: "open-shifts", label: "Shifts", description: "Open shift control", icon: "clipboard-list" }
  },
  Accountant: {
    role: "Accountant",
    title: "Accountant Ledger Desk",
    subtitle: "Vendor settlements, GST, reconciliation, and refund approvals.",
    path: rolePathMap.Accountant,
    navItems: baseNav,
    kpis: [
      { id: "pendingVendorPayouts", label: "Pending Payouts", tone: "warning" },
      { id: "pendingRefundApprovals", label: "Refund Approvals", tone: "critical" },
      { id: "openReconciliations", label: "Open Reconciliations", tone: "warning" },
      { id: "monthGstLiability", label: "Month GST Liability", tone: "info" }
    ],
    primaryActions: [
      { id: "open-accounting", label: "Accounting", description: "Open ledger and vendor invoices", hotkey: "A", tone: "info" },
      { id: "open-reconciliation", label: "Reconciliation", description: "Audit and reconcile transactions", hotkey: "R" },
      { id: "approve-refund", label: "Approve Refund", description: "Review pending refund queue", tone: "warning" }
    ],
    quickFabAction: { id: "open-accounting", label: "Ledger", description: "Open accounting ledger", icon: "credit-card" }
  }
};

export const getRoleConfig = (role: Role): DashboardRoleConfig => roleConfig[role];
