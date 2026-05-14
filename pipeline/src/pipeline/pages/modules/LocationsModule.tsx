import { lazy, Suspense } from "react";
import { ModulePageLayout } from "../../components/layout/ModulePageLayout";

const LocationControlCenter = lazy(() => import("./locations/LocationControlCenter"));

const LocationsModule = () => {
  return (
    <ModulePageLayout
      moduleTab="Locations"
      title="Location Control Center"
      subtitle="Manage branches, activities, and staff across all locations."
      breadcrumbs={["Pipeline", "Locations"]}
    >
      <Suspense
        fallback={
          <div className="py-8 text-center text-sm text-muted">Loading...</div>
        }
      >
        <LocationControlCenter />
      </Suspense>
    </ModulePageLayout>
  );
};

export default LocationsModule;
