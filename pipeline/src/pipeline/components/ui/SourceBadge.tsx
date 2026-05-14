const sourceToneClass: Record<string, string> = {
  web: "border-info/40 bg-info/10 text-info",
  counter: "border-warning/40 bg-warning/10 text-warning",
  express: "border-accent/40 bg-accent/10 text-accent",
  interakt: "border-success/40 bg-success/10 text-success",
  unknown: "border-border bg-panel text-muted"
};

export const SourceBadge = ({ source }: { source: string }) => {
  const token = source.trim().toLowerCase();
  const classes = sourceToneClass[token] ?? sourceToneClass.unknown;

  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.06em] ${classes}`}>{source}</span>;
};
