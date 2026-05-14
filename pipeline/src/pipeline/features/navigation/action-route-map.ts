import { ModuleTab, Role } from "../../api/types";
import { rolePathMap } from "../dashboard/role-config";
import { canRoleAccessTab, getTabForPath, getTabsForRole } from "./module-manifest";

export type ActionRouteMap = Record<Role, Record<string, string>>;

const actionRouteMap: ActionRouteMap = {
  Owner: {
    governance: "/reports/operations",
    workspace: "/workspaces",
    audit: "/admin/audit",
    "owner-audit": "/admin/audit",
    dashboard: "/dashboard/owner"
  },
  Admin: {
    "user-create": "/admin/users",
    "approve-refund": "/billing/refunds",
    "admin-user": "/admin/users"
  },
  Telecaller: {
    "start-shift": "/shifts/my"
  },
  Cashier: {
    "new-transaction": "/billing/pos",
    refund: "/billing/refunds",
    reconcile: "/shifts/my",
    "cashier-pos": "/billing/pos"
  },
  TrackMarshall: {
    "open-scanner": "/track/scanner",
    "create-session": "/track/sessions",
    "update-kart": "/track/karts",
    incident: "/track/incidents",
    "track-session": "/track/sessions"
  },
  Incharge: {
    "open-incharge": "/incharge/tasks"
  },
  Editor: {
    upload: "/files/uploads",
    "task-update": "/workspaces",
    handoff: "/workspaces",
    "editor-upload": "/files/uploads"
  },
  Developer: {
    "inspect-logs": "/admin/roles",
    "release-check": "/reports/operations",
    "incident-review": "/track/incidents",
    "dev-logs": "/reports/operations"
  },
  Backend: {
    "inspect-logs": "/admin/roles",
    "release-check": "/reports/operations",
    "incident-review": "/track/incidents",
    "dev-logs": "/reports/operations"
  },
  ThirdParty: {
    "inspect-logs": "/admin/roles",
    "release-check": "/reports/operations",
    "incident-review": "/track/incidents",
    "dev-logs": "/reports/operations"
  },
  HR: {
    "open-shifts": "/shifts/my",
    "open-monitor": "/monitor",
    "open-incentives": "/incentives/dashboard"
  },
  Accountant: {
    "open-accounting": "/accounting/ledger",
    "open-reconciliation": "/reconciliation/orphans",
    "approve-refund": "/billing/refunds"
  }
};

const mobileShortcutPriority: ModuleTab[] = [
  "Dashboard",
  "Billing",
  "Bookings",
  "Track",
  "Workspaces",
  "Shifts",
  "Files",
  "Reports",
  "Admin",
  "Settings"
];

const getRoleFallbackPath = (role: Role): string => getTabsForRole(role)[0]?.path ?? rolePathMap[role];

const knownRoutePrefixes = [
  "/dashboard",
  "/shifts",
  "/billing",
  "/bookings",
  "/activities",
  "/track",
  "/incharge",
  "/workspaces",
  "/tasks",
  "/files",
  "/reports",
  "/admin",
  "/coupons",
  "/accounting",
  "/settings"
];

export const isPathAllowedForRole = (role: Role, path: string): boolean => {
  const isKnownPath = knownRoutePrefixes.some((prefix) => path.startsWith(prefix));
  if (!isKnownPath) {
    return false;
  }
  return canRoleAccessTab(role, getTabForPath(path));
};

const sanitizeRolePath = (role: Role, path: string): string =>
  isPathAllowedForRole(role, path) ? path : getRoleFallbackPath(role);

export const resolveRoleActionRoute = (role: Role, actionId: string): string => {
  const mappedPath = actionRouteMap[role]?.[actionId] ?? getRoleFallbackPath(role);
  return sanitizeRolePath(role, mappedPath);
};

export const getRoleMobileShortcuts = (role: Role): Array<{ label: string; href: string }> => {
  const allowedTabs = getTabsForRole(role);
  const byId = new Map(allowedTabs.map((tab) => [tab.id, tab]));

  return mobileShortcutPriority
    .filter((id) => byId.has(id))
    .slice(0, 3)
    .map((id) => {
      const tab = byId.get(id)!;
      return { label: tab.label, href: tab.path };
    });
};
