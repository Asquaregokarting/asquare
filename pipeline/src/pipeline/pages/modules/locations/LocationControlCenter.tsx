import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Plus, ChevronRight, MapPin } from "lucide-react";
import { Skeleton } from "../../../components/ui/Skeleton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { useAuth } from "../../../features/auth/auth-context";
import {
  asquareLocationsApi,
  type AsquareLocationWithMetrics,
} from "../../../api/asquare-locations";
import { listFirestoreActivityHierarchy } from "../../../api/activities-firestore";
import { listFirestoreUsers } from "../../../api/users-firestore";
import type { ActivityLocationTreeRecord } from "../../../api/types";
import type { UserRecord } from "../../../api/types";
import { AddLocationDialog } from "./AddLocationDialog";
import { LocationDetailPanel } from "./LocationDetailPanel";

const fmtCurr = (v: number) => `\u20B9${Math.round(v).toLocaleString("en-IN")}`;

const LocationControlCenter = () => {
  const { session } = useAuth();
  const [locations, setLocations] = useState<AsquareLocationWithMetrics[]>([]);
  const [hierarchy, setHierarchy] = useState<ActivityLocationTreeRecord[]>([]);
  const [allStaff, setAllStaff] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const canManage =
    session?.user.role === "Owner" || session?.user.role === "Admin";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [locs, hier, staff] = await Promise.all([
        asquareLocationsApi.listLocationsWithMetrics(),
        listFirestoreActivityHierarchy().catch(() => []),
        listFirestoreUsers({ status: "Active" }).catch(() => []),
      ]);
      setLocations(locs);
      setHierarchy(hier);
      setAllStaff(staff);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load locations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const getGameCount = (locationId: string) =>
    hierarchy.find((h) => h.id === locationId)?.games.length ?? 0;

  const getStaffCount = (locationId: string) =>
    allStaff.filter((u) => u.allowedLocations?.includes(locationId)).length;

  const handleToggle = async (locationId: string, currentEnabled: boolean) => {
    setTogglingId(locationId);
    try {
      const overrides = Object.fromEntries(
        locations.map((l) => [
          l.id,
          l.id === locationId ? !currentEnabled : l.enabled,
        ])
      );
      await asquareLocationsApi.updateLocationVisibility(overrides);
      setLocations((prev) =>
        prev.map((l) =>
          l.id === locationId ? { ...l, enabled: !currentEnabled } : l
        )
      );
    } catch {
      // Revert on error — reload
      await load();
    } finally {
      setTogglingId(null);
    }
  };

  const handleLocationAdded = () => {
    setShowAddDialog(false);
    void load();
  };

  const handleSelectLocation = (id: string) => {
    setSelectedLocationId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-5">
      {/* Header actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {locations.length} branch{locations.length !== 1 ? "es" : ""} configured
        </p>
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={() => setShowAddDialog(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 active:scale-[0.97]"
            >
              <Plus className="h-4 w-4" />
              Add Location
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-surface px-4 py-2 text-sm font-medium text-text shadow-sm transition-all hover:bg-surface/80 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-critical/40 bg-critical/10 p-3 text-sm text-critical">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && locations.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : locations.length === 0 ? (
        <EmptyState
          title="No locations"
          description="No branches have been configured yet. Add a new location to get started."
        />
      ) : (
        /* Location cards grid */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {locations.map((loc) => {
            const gameCount = getGameCount(loc.id);
            const staffCount = getStaffCount(loc.id);
            const isSelected = selectedLocationId === loc.id;

            return (
              <div
                key={loc.id}
                className={`rounded-xl border bg-panel p-4 shadow-sm transition-all ${
                  isSelected
                    ? "border-accent/60 ring-2 ring-accent/20"
                    : "border-border/45 hover:shadow-md"
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <MapPin className="h-4.5 w-4.5" />
                    </span>
                    <div>
                      <p className="font-display text-base font-semibold text-text">
                        {loc.name}
                      </p>
                      <StatusBadge tone={loc.enabled ? "success" : "critical"}>
                        {loc.enabled ? "Active" : "Inactive"}
                      </StatusBadge>
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      disabled={togglingId === loc.id}
                      onClick={() => void handleToggle(loc.id, loc.enabled)}
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        loc.enabled ? "bg-success" : "bg-muted/40"
                      } ${togglingId === loc.id ? "opacity-50" : ""}`}
                      aria-label={`Toggle ${loc.name} ${loc.enabled ? "off" : "on"}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                          loc.enabled ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  )}
                </div>

                {/* Metrics */}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-surface px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                      Bookings
                    </p>
                    <p className="mt-0.5 font-display text-lg font-semibold text-text">
                      {loc.bookingCount.toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                      Revenue
                    </p>
                    <p className="mt-0.5 font-display text-lg font-semibold text-success">
                      {fmtCurr(loc.revenue)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                      Games
                    </p>
                    <p className="mt-0.5 font-display text-lg font-semibold text-text">
                      {gameCount}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                      Staff
                    </p>
                    <p className="mt-0.5 font-display text-lg font-semibold text-text">
                      {staffCount}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <button
                  type="button"
                  onClick={() => handleSelectLocation(loc.id)}
                  className="mt-4 flex w-full items-center justify-between rounded-lg border border-border/40 bg-surface px-3 py-2 text-sm font-medium text-text transition-colors hover:bg-accent/10 hover:text-accent"
                >
                  <span>{isSelected ? "Hide Details" : "View Details"}</span>
                  <ChevronRight
                    className={`h-4 w-4 transition-transform ${
                      isSelected ? "rotate-90" : ""
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail panel — shown below grid when a location is selected */}
      {selectedLocationId && (
        <LocationDetailPanel
          locationId={selectedLocationId}
          canManage={canManage}
          onClose={() => setSelectedLocationId(null)}
          onRefresh={load}
        />
      )}

      {/* Add location dialog */}
      <AddLocationDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onCreated={handleLocationAdded}
      />
    </div>
  );
};

export default LocationControlCenter;
