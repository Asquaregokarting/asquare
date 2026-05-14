import { useCallback, useEffect, useState } from "react";
import { X, ChevronDown, ChevronRight, Pencil, Users, Gamepad2 } from "lucide-react";
import { Skeleton } from "../../../components/ui/Skeleton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import {
  asquareLocationsApi,
  type LocationDetail,
  type LocationDetailActivity,
} from "../../../api/asquare-locations";
import { useNavigate } from "react-router-dom";

interface LocationDetailPanelProps {
  locationId: string;
  canManage: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export const LocationDetailPanel = ({
  locationId,
  canManage,
  onClose,
  onRefresh,
}: LocationDetailPanelProps) => {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<LocationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editShortName, setEditShortName] = useState("");
  const [saving, setSaving] = useState(false);

  // Game toggle state
  const [togglingGameId, setTogglingGameId] = useState<string | null>(null);

  // Accordion state for game expansion
  const [expandedGames, setExpandedGames] = useState<Set<string>>(new Set());

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await asquareLocationsApi.getLocationDetail(locationId);
      setDetail(data);
      setEditName(data.name);
      setEditShortName(data.shortName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load location details.");
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleSaveDetails = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await asquareLocationsApi.updateLocationDetails(locationId, {
        displayName: editName.trim(),
        shortName: editShortName.trim() || undefined,
      });
      setEditing(false);
      await loadDetail();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleGame = async (gameId: string, currentStatus: "Active" | "Inactive") => {
    setTogglingGameId(gameId);
    try {
      await asquareLocationsApi.toggleGameStatus(
        locationId,
        gameId,
        currentStatus === "Inactive"
      );
      // Update local state optimistically
      setDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          activities: prev.activities.map((a) =>
            a.gameId === gameId
              ? { ...a, status: currentStatus === "Active" ? "Inactive" : "Active" }
              : a
          ),
        };
      });
    } catch {
      await loadDetail();
    } finally {
      setTogglingGameId(null);
    }
  };

  const toggleGameExpand = (gameId: string) => {
    setExpandedGames((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border/45 bg-panel p-5 shadow-sm">
        <Skeleton className="mb-4 h-8 w-48 rounded-lg" />
        <Skeleton className="mb-3 h-4 w-72 rounded" />
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="rounded-xl border border-critical/40 bg-critical/10 p-4 text-sm text-critical">
        {error ?? "Location not found."}
        <button type="button" onClick={onClose} className="ml-2 underline">
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/45 bg-panel shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="ui-field min-h-9 text-sm"
                placeholder="Display Name"
              />
              <input
                type="text"
                value={editShortName}
                onChange={(e) => setEditShortName(e.target.value)}
                className="ui-field min-h-9 text-sm"
                placeholder="Short Name"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving || !editName.trim()}
                  onClick={() => void handleSaveDetails()}
                  className="ui-btn ui-btn-success min-h-8 px-3 text-xs font-semibold disabled:opacity-50"
                >
                  {saving ? "..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setEditName(detail.name);
                    setEditShortName(detail.shortName);
                  }}
                  className="ui-btn min-h-8 px-3 text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-text">
                  {detail.name}
                  {detail.shortName !== detail.name && (
                    <span className="ml-2 text-sm font-normal text-muted">
                      ({detail.shortName})
                    </span>
                  )}
                </h3>
                <p className="text-xs text-muted">
                  Slug: <span className="font-mono">{detail.id}</span>
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg border border-border/40 p-1.5 text-muted transition-colors hover:bg-surface hover:text-text"
                  aria-label="Edit location details"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="self-start rounded-lg border border-border/40 p-1.5 text-muted transition-colors hover:bg-surface hover:text-text sm:self-auto"
          aria-label="Close details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content: Activities + Staff side by side on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 gap-0 divide-y divide-border/30 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
        {/* Activities section */}
        <div className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Gamepad2 className="h-4 w-4 text-accent" />
            <h4 className="font-display text-base font-semibold text-text">
              Activities
            </h4>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
              {detail.activities.length}
            </span>
          </div>

          {detail.activities.length === 0 ? (
            <EmptyState
              title="No activities"
              description="No games configured at this location. Go to Activities module to add games."
            />
          ) : (
            <div className="space-y-2">
              {detail.activities.map((activity) => (
                <ActivityRow
                  key={activity.gameId}
                  activity={activity}
                  expanded={expandedGames.has(activity.gameId)}
                  toggling={togglingGameId === activity.gameId}
                  canManage={canManage}
                  onToggle={() =>
                    void handleToggleGame(activity.gameId, activity.status)
                  }
                  onExpand={() => toggleGameExpand(activity.gameId)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Staff section */}
        <div className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            <h4 className="font-display text-base font-semibold text-text">
              Staff
            </h4>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
              {detail.staff.length}
            </span>
          </div>

          {detail.staff.length === 0 ? (
            <EmptyState
              title="No staff assigned"
              description="No staff members are assigned to this location."
            />
          ) : (
            <div className="space-y-2">
              {detail.staff.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-lg border border-border/30 bg-surface px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">
                      {member.name}
                    </p>
                    <p className="text-xs text-muted">{member.role}</p>
                  </div>
                  <StatusBadge
                    tone={member.status === "Active" ? "success" : "critical"}
                  >
                    {member.status}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate("/admin/users")}
            className="mt-3 text-xs font-medium text-accent hover:underline"
          >
            Manage Staff in Admin →
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Activity Row with toggle + accordion ────────────────────────────

interface ActivityRowProps {
  activity: LocationDetailActivity;
  expanded: boolean;
  toggling: boolean;
  canManage: boolean;
  onToggle: () => void;
  onExpand: () => void;
}

const ActivityRow = ({
  activity,
  expanded,
  toggling,
  canManage,
  onToggle,
  onExpand,
}: ActivityRowProps) => {
  const isActive = activity.status === "Active";
  const totalVariants = activity.subGames.reduce(
    (sum, sg) => sum + sg.variantCount,
    0
  );

  return (
    <div className="rounded-lg border border-border/30 bg-surface">
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Expand toggle */}
        <button
          type="button"
          onClick={onExpand}
          className="shrink-0 text-muted hover:text-text"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {/* Game info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-text">
              {activity.name}
            </p>
            <StatusBadge tone={isActive ? "success" : "critical"}>
              {activity.status}
            </StatusBadge>
          </div>
          <p className="text-[11px] text-muted">
            {activity.subGames.length} sub-game
            {activity.subGames.length !== 1 ? "s" : ""} · {totalVariants} variant
            {totalVariants !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Toggle switch */}
        {canManage && (
          <button
            type="button"
            disabled={toggling}
            onClick={onToggle}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              isActive ? "bg-success" : "bg-muted/40"
            } ${toggling ? "opacity-50" : ""}`}
            aria-label={`Toggle ${activity.name} ${isActive ? "off" : "on"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                isActive ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        )}
      </div>

      {/* Expanded sub-games */}
      {expanded && activity.subGames.length > 0 && (
        <div className="border-t border-border/20 px-3 py-2 pl-9">
          <div className="space-y-1">
            {activity.subGames.map((sg) => (
              <div
                key={sg.id}
                className="flex items-center justify-between text-xs text-muted"
              >
                <span>{sg.name}</span>
                <span className="tabular-nums">
                  {sg.variantCount} variant{sg.variantCount !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
