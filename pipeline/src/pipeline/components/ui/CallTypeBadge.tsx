const callTypeToneClass: Record<string, string> = {
  incoming: "border-info/40 bg-info/10 text-info",
  outgoing: "border-success/40 bg-success/10 text-success",
  missed: "border-critical/40 bg-critical/10 text-critical"
};

export const CallTypeBadge = ({ type }: { type: string }) => {
  const tone = callTypeToneClass[type.toLowerCase()] ?? "border-border bg-panel text-muted";
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.06em] ${tone}`}>{type}</span>;
};
