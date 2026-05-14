import { hoursSince } from "../../../features/leads/lead-utils";

interface Props {
  viewedBy?: string;
  viewedAt?: string;
  currentUserId: string;
  userMap?: Map<string, { name: string }>;
}

const LeadPresenceIndicator = ({ viewedBy, viewedAt, currentUserId, userMap }: Props) => {
  if (!viewedBy || !viewedAt) return null;
  if (viewedBy === currentUserId) return null;
  if (hoursSince(viewedAt) > 0) return null;
  const diffMs = Date.now() - new Date(viewedAt).getTime();
  if (diffMs > 60_000) return null;

  const name = userMap?.get(viewedBy)?.name ?? "Someone";

  return (
    <div className="ui-pill border-warning/35 bg-warning/10 text-warning text-xs px-2.5 py-1">
      <span className="inline-block h-2 w-2 rounded-full bg-warning animate-pulse" />
      Viewed by {name}
    </div>
  );
};

export default LeadPresenceIndicator;
