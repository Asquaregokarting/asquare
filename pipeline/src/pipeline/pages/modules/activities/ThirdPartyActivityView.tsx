import { StatusBadge } from "../../../components/ui/StatusBadge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { DetailPanel } from "../../../components/ui/DetailPanel";
import type { GameDraft } from "./activity-draft-utils";
import { formatMetric } from "./activity-draft-utils";
import type { BranchLocationKey } from "../../../api/types";

interface ThirdPartyActivityViewProps {
  games: GameDraft[];
  locationName: string;
  locations: { id: BranchLocationKey; name: string }[];
  activeLocation: BranchLocationKey;
  onLocationChange: (loc: BranchLocationKey) => void;
}

export const ThirdPartyActivityView = ({
  games,
  locationName,
  locations,
  activeLocation,
  onLocationChange,
}: ThirdPartyActivityViewProps) => {
  if (games.length === 0) {
    return (
      <EmptyState
        title="No games assigned to you at this location"
        description="Check other locations or contact the administrator."
      />
    );
  }

  return (
    <div className="ui-section-stack">
      {/* Location selector */}
      <div className="ui-toolbar py-3.5">
        <div className="flex flex-wrap gap-2">
          {locations.map((loc) => (
            <button
              key={loc.id}
              type="button"
              onClick={() => onLocationChange(loc.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                activeLocation === loc.id
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border bg-panel text-muted hover:text-text"
              }`}
            >
              {loc.name}
            </button>
          ))}
        </div>
      </div>

      <DetailPanel title={`Your Games — ${locationName}`}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((game) => (
            <article
              key={game.key}
              className="overflow-hidden rounded-xl border border-border/45 bg-surface shadow-sm"
            >
              {game.imagePreviews.length > 0 ? (
                <img
                  src={game.imagePreviews[0]}
                  alt={game.name || "Game"}
                  className="h-36 w-full object-cover"
                />
              ) : (
                <div className="flex h-36 items-center justify-center bg-surface/70 text-xs font-semibold uppercase tracking-[0.12em] text-muted/40">
                  No Image
                </div>
              )}
              <div className="space-y-2 p-3">
                <div className="flex items-center justify-between">
                  <h4 className="truncate text-sm font-semibold text-text">
                    {game.name || "Untitled"}
                  </h4>
                  <StatusBadge tone={game.status === "Active" ? "success" : "muted"}>
                    {game.status}
                  </StatusBadge>
                </div>
                <p className="text-xs text-muted">
                  {game.subGames.length} sub game
                  {game.subGames.length !== 1 ? "s" : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {game.subGames.flatMap((sg) =>
                    sg.variants.map((v) => (
                      <span
                        key={`${sg.key}-${v.key}`}
                        className="inline-flex items-center rounded-full border border-border bg-panel px-2 py-0.5 text-[11px] text-text"
                      >
                        {sg.name} | {v.label} | {formatMetric(v)}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </DetailPanel>
    </div>
  );
};
