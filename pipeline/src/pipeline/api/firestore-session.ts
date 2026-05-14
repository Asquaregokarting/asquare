import type { Role, UserRecord } from "./types";
import { getFirestoreUserAuthById, isFirestoreUsersActive } from "./users-firestore";

const SESSION_TOKEN_PATTERN = /^mock-(.+)$/;

export const parseSessionUserId = (token: string): string | null => {
  const match = SESSION_TOKEN_PATTERN.exec(String(token ?? "").trim());
  return match?.[1] ?? null;
};

// ── Role classification helpers ──────────────────────────────────────

// Roles with cross-branch READ visibility. NOT a write/admin capability —
// every mutating action still goes through its own role check. Accountant
// needs cross-branch read for financial reporting / GST / reconciliation;
// HR needs it for staff scheduling / attendance / incentives across all
// branches. Without this, the location-scope helper treats them as
// branch-restricted and an empty allowedLocations array silently filters
// every report to zero rows — exactly the "no error, no data" symptom.
/** Full system access — can switch locations, access all data. */
export const isPrivilegedRole = (role: UserRecord["role"]): boolean =>
  role === "Owner" ||
  role === "Admin" ||
  role === "Accountant" ||
  role === "HR";

/** Locked to a single location — cannot change location or see other branches. */
export const isLocationRestrictedRole = (role: Role): boolean =>
  role === "Cashier" || role === "TrackMarshall" || role === "Incharge";

/** Can view all locations but cannot perform operational actions (shifts, scanning). */
export const isReadOnlyMultiLocationRole = (role: Role): boolean => role === "Telecaller";

/**
 * Returns the single effective locationId for a restricted user.
 * For users with `allowedLocations` containing exactly one entry, that's their location.
 * Returns `null` for privileged roles or users with multi-location access.
 */
export const getUserEffectiveLocationId = (user: { role: Role; allowedLocations?: string[] }): string | null => {
  if (isPrivilegedRole(user.role)) return null;
  const allowed = user.allowedLocations;
  if (Array.isArray(allowed) && allowed.length === 1) return allowed[0];
  return null;
};

/**
 * Validates that a requested locationId is permitted for the given user.
 * - Privileged roles: always allowed.
 * - Restricted roles: must match their allowedLocations.
 * - Throws if the location is not permitted.
 */
export const assertLocationAccess = (
  user: { role: Role; allowedLocations?: string[] },
  requestedLocationId: string
): void => {
  if (isPrivilegedRole(user.role)) return;
  const allowed = user.allowedLocations;
  if (!Array.isArray(allowed) || allowed.length === 0) return; // unrestricted
  if (!allowed.includes(requestedLocationId)) {
    throw new Error(`Access denied: you are not authorized for location "${requestedLocationId}".`);
  }
};

// ── Session lookup ───────────────────────────────────────────────────

export const getFirestoreSessionUser = async (token: string): Promise<UserRecord> => {
  if (!isFirestoreUsersActive()) {
    throw new Error("Firestore users is not configured.");
  }

  const userId = parseSessionUserId(token);
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const authRecord = await getFirestoreUserAuthById(userId);
  if (!authRecord || !authRecord.user.isActive) {
    throw new Error("Unauthorized");
  }

  return authRecord.user;
};
