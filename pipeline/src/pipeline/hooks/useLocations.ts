import { useMemo } from "react";
import { getAsquareFirestore } from "../api/asquare-firestore";
import { useLocations as useLocationsBase } from "../../lib/useLocations";
import { useAuth } from "../features/auth/auth-context";
import { isLocationRestrictedRole, isReadOnlyMultiLocationRole, isPrivilegedRole } from "../api/firestore-session";
import type { Role } from "../api/types";

export function useLocations() {
  const db = getAsquareFirestore();
  const { session } = useAuth();
  const base = useLocationsBase(db);

  const role: Role | undefined = session?.user?.role;
  const allowed = session?.user?.allowedLocations;
  const isRestricted = Array.isArray(allowed) && allowed.length > 0;

  /** True if user's role is locked to a single location (Cashier, TrackMarshall). */
  const isRoleLocked = Boolean(role && isLocationRestrictedRole(role));

  /** True if user can view all locations in read-only mode (Telecaller). */
  const isReadOnlyMulti = Boolean(role && isReadOnlyMultiLocationRole(role));

  /** True if user has full access (Owner, Admin). */
  const isFullAccess = Boolean(role && isPrivilegedRole(role));

  /** Single locked location for restricted roles (null if multi-location). */
  const lockedLocationId = isRestricted && isRoleLocked && allowed!.length === 1 ? allowed![0] : null;

  const enabledLocations = useMemo(
    () =>
      isRestricted
        ? base.enabledLocations.filter((l) => allowed!.includes(l.slug))
        : base.enabledLocations,
    [base.enabledLocations, allowed, isRestricted],
  );

  const allLocations = useMemo(
    () => (isRestricted ? enabledLocations : base.locations),
    [base.locations, enabledLocations, isRestricted],
  );

  const allowedSlugs = useMemo(
    () =>
      isRestricted
        ? allowed!
        : base.enabledLocations.map((l) => l.slug),
    [base.enabledLocations, allowed, isRestricted],
  );

  return {
    ...base,
    locations: allLocations,
    enabledLocations,
    isRestricted,
    allowedSlugs,
    isRoleLocked,
    isReadOnlyMulti,
    isFullAccess,
    lockedLocationId,
  };
}
