import { lazy, Suspense } from "react";
import { ModulePageLayout } from "../../components/layout/ModulePageLayout";
import { useAuth } from "../../features/auth/auth-context";
import type { ActivitiesView } from "./activities/activity-draft-utils";

const ActivityHierarchyView = lazy(() => import("./activities/ActivityHierarchyView"));
const ComboBuilder = lazy(() => import("../../features/combos/ComboBuilder"));
const VendorGameImportView = lazy(() => import("./activities/VendorGameImportView"));

const titleMap: Record<ActivitiesView, string> = {
  list: "Activities",
  combos: "Combos",
  "bulk-import": "Bulk Import",
};

const subtitleMap: Record<ActivitiesView, string> = {
  list: "Hierarchical activity builder for Location → Game → SubGame → Variant.",
  combos: "Build combo offers by combining multiple activities.",
  "bulk-import": "Upload vendor details and games from an Excel file.",
};

const ActivitiesModule = ({ view = "list" }: { view?: ActivitiesView }) => {
  const { session } = useAuth();
  const role = session?.user.role;
  const canManage = role === "Owner" || role === "Admin";
  const isThirdParty = role === "ThirdParty";

  const subnav = canManage
    ? [
        { label: "Hierarchy", to: "/activities/list" },
        { label: "Combos", to: "/activities/combos" },
        { label: "Bulk Import", to: "/activities/bulk-import" },
      ]
    : [];

  return (
    <ModulePageLayout
      moduleTab="Activities"
      title={isThirdParty && view === "list" ? "Activities" : titleMap[view]}
      subtitle={
        isThirdParty && view === "list"
          ? "Games assigned to your vendor account."
          : subtitleMap[view]
      }
      breadcrumbs={
        isThirdParty
          ? ["Pipeline", "Activities"]
          : ["Pipeline", "Activities", titleMap[view]]
      }
      subnav={subnav}
    >
      <Suspense
        fallback={
          <div className="py-8 text-center text-sm text-muted">Loading...</div>
        }
      >
        {view === "list" && <ActivityHierarchyView />}
        {view === "combos" && <ComboBuilder locationKey="0" />}
        {view === "bulk-import" && <VendorGameImportView />}
      </Suspense>
    </ModulePageLayout>
  );
};

export default ActivitiesModule;
