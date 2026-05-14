import { DetailPanel } from "../../../components/ui/DetailPanel";
import type { GameDraft } from "./activity-draft-utils";
import type { BranchLocationKey } from "../../../api/types";

interface LocationAssignmentPanelProps {
  game: GameDraft;
  locations: { id: BranchLocationKey; name: string }[];
  activeLocation: BranchLocationKey;
  draftsByLocation: Record<string, GameDraft[]>;
  onToggle: (locationId: string) => void;
  canManage: boolean;
}

export const LocationAssignmentPanel = ({
  game,
  locations,
  activeLocation,
  draftsByLocation,
  onToggle,
  canManage,
}: LocationAssignmentPanelProps) => {
  const gameName = game.name.trim().toLowerCase();

  return (
    <DetailPanel title="Locations Using This Activity">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {locations.map((location) => {
          const isActive = (draftsByLocation[location.id] ?? []).some(
            (g) => g.name.trim().toLowerCase() === gameName
          );
          const isCurrentLocation = location.id === activeLocation;

          return (
            <label
              key={location.id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${
                isCurrentLocation
                  ? "cursor-not-allowed opacity-50 grayscale-[0.5]"
                  : ""
              } ${
                isActive
                  ? "border-accent/40 bg-accent/5 shadow-sm"
                  : "border-border bg-panel/30 hover:border-accent/20"
              }`}
            >
              <div className="relative flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={isActive}
                  disabled={isCurrentLocation || !canManage}
                  onChange={() => onToggle(location.id)}
                  className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-border transition-all checked:border-accent checked:bg-accent hover:border-accent focus:outline-none disabled:cursor-not-allowed"
                />
                <svg
                  className="pointer-events-none absolute h-3.5 w-3.5 text-white opacity-0 transition-opacity peer-checked:opacity-100"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span className="select-none text-xs font-medium text-text">
                {location.name}
                {isCurrentLocation && (
                  <span className="ml-1.5 text-[10px] italic text-muted">
                    (Current)
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </DetailPanel>
  );
};
