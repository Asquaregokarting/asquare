import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../features/auth/auth-context";
import type { Role } from "../api/types";

interface RoleGuardRouteProps {
  children: ReactNode;
  blockedRoles: Role[];
  fallbackPath?: string;
}

/**
 * Route-level role guard. Redirects users whose role is in `blockedRoles`
 * to `fallbackPath` (defaults to the dashboard).
 */
const RoleGuardRoute = ({ children, blockedRoles, fallbackPath = "/dashboard" }: RoleGuardRouteProps) => {
  const { session } = useAuth();
  if (!session) return <Navigate replace to="/login" />;

  if (blockedRoles.includes(session.user.role)) {
    return <Navigate replace to={fallbackPath} />;
  }

  return children;
};

export default RoleGuardRoute;
