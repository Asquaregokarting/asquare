import { useState } from "react";
import { MapPin } from "lucide-react";
import { ModulePageLayout } from "../../components/layout/ModulePageLayout";
import { useAuth } from "../../features/auth/auth-context";
import { isPrivilegedRole } from "../../api/firestore-session";
import { useLocations } from "../../hooks/useLocations";
import KartfluencerListView from "./kartfluencer/KartfluencerListView";
import KartfluencerPipelineView from "./kartfluencer/KartfluencerPipelineView";
import KartfluencerReelsView from "./kartfluencer/KartfluencerReelsView";
import KartfluencerNotificationsView from "./kartfluencer/KartfluencerNotificationsView";
import KartfluencerImportView from "./kartfluencer/KartfluencerImportView";
import KartfluencerConfigView from "./kartfluencer/KartfluencerConfigView";
import KartfluencerScannerView from "./kartfluencer/KartfluencerScannerView";
import KartfluencerWithdrawalsView from "./kartfluencer/KartfluencerWithdrawalsView";
import KartfluencerAnalyticsView from "./kartfluencer/KartfluencerAnalyticsView";
import KartfluencerProfileView from "./kartfluencer/KartfluencerProfileView";

export type KartfluencerView =
  | "list" | "pipeline" | "reels" | "notifications" | "import" | "config"
  | "scanner" | "withdrawals" | "analytics" | "profile";

const titleMap: Record<KartfluencerView, string> = {
  list: "Influencer Directory",
  pipeline: "Influencer Pipeline",
  reels: "Reel Review",
  notifications: "Broadcasts",
  import: "Import Data",
  config: "Settings",
  scanner: "QR Scanner",
  withdrawals: "Withdrawals",
  analytics: "Analytics",
  profile: "Influencer Profile",
};

const subtitleMap: Record<KartfluencerView, string> = {
  list: "All registered influencers with filters and search.",
  pipeline: "Kanban board tracking influencer journey from registration to active.",
  reels: "Review submitted Instagram reels — verify, track views, approve milestones.",
  notifications: "Broadcast announcements to influencers.",
  import: "Import influencer data from CSV files.",
  config: "Configure tiers, rewards, and Instagram API settings.",
  scanner: "Scan influencer QR codes to mark visits.",
  withdrawals: "Manage influencer withdrawal requests.",
  analytics: "Performance metrics, funnel, and ROI analysis.",
  profile: "Detailed influencer profile with live data.",
};

/** Views that should be filtered by the selected location. */
const LOCATION_FILTERED_VIEWS: KartfluencerView[] = ["list", "pipeline", "reels", "scanner", "withdrawals", "analytics"];

interface KartfluencerModuleProps {
  view: KartfluencerView;
  influencerId?: string;
}

const KartfluencerModule = ({ view, influencerId }: KartfluencerModuleProps) => {
  const { session } = useAuth();
  const role = session?.user.role;
  const isAdmin = role ? isPrivilegedRole(role) : false;
  const { enabledLocations, isRoleLocked, lockedLocationId } = useLocations();

  // Location state — default to locked location for restricted roles, "all" for admins
  const [selectedLocation, setSelectedLocation] = useState<string>(lockedLocationId ?? "");

  // The branchId to pass to child views ("" = all locations)
  const activeBranchId = isRoleLocked && lockedLocationId ? lockedLocationId : selectedLocation;

  const subnav = [
    { label: "Directory", to: "/kartfluencer/list" },
    { label: "Pipeline", to: "/kartfluencer/pipeline" },
    { label: "Reels", to: "/kartfluencer/reels" },
    { label: "Scanner", to: "/kartfluencer/scanner" },
    ...(isAdmin
      ? [
          { label: "Withdrawals", to: "/kartfluencer/withdrawals" },
          { label: "Analytics", to: "/kartfluencer/analytics" },
          { label: "Broadcasts", to: "/kartfluencer/notifications" },
          { label: "Import", to: "/kartfluencer/import" },
          { label: "Settings", to: "/kartfluencer/config" },
        ]
      : []),
  ];

  // Location selector rendered in the subnav actions slot
  const locationSelector = LOCATION_FILTERED_VIEWS.includes(view) ? (
    <div className="ml-auto flex items-center gap-1.5 shrink-0">
      <MapPin size={13} className="text-muted" />
      {isRoleLocked && lockedLocationId ? (
        <span className="rounded-lg bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
          {enabledLocations.find((l) => l.slug === lockedLocationId)?.shortName ?? lockedLocationId}
        </span>
      ) : (
        <select
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
          className="ui-field h-7 min-w-[120px] text-xs"
          title="Filter by location"
        >
          <option value="">All Locations</option>
          {enabledLocations.map((loc) => (
            <option key={loc.slug} value={loc.branchId}>{loc.shortName}</option>
          ))}
        </select>
      )}
    </div>
  ) : null;

  return (
    <ModulePageLayout
      moduleTab="Kartfluencer"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={["Pipeline", "Kartfluencer", titleMap[view]]}
      subnav={view === "profile" ? undefined : subnav}
      subnavActions={view === "profile" ? undefined : locationSelector}
      hideHeader={view === "profile"}
    >
      {view === "list" && <KartfluencerListView branchFilter={activeBranchId} />}
      {view === "pipeline" && <KartfluencerPipelineView branchFilter={activeBranchId} />}
      {view === "reels" && <KartfluencerReelsView />}
      {view === "scanner" && <KartfluencerScannerView />}
      {view === "withdrawals" && <KartfluencerWithdrawalsView />}
      {view === "analytics" && <KartfluencerAnalyticsView branchFilter={activeBranchId} />}
      {view === "notifications" && <KartfluencerNotificationsView />}
      {view === "import" && <KartfluencerImportView />}
      {view === "config" && <KartfluencerConfigView />}
      {view === "profile" && influencerId && <KartfluencerProfileView influencerId={influencerId} />}
    </ModulePageLayout>
  );
};

export default KartfluencerModule;
