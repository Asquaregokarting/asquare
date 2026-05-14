export const Skeleton = ({ className }: { className?: string }) => (
  <div
    aria-hidden="true"
    className={`animate-pulse rounded-xl border border-border/40 bg-surface/50 ${className ?? "h-24 w-full"}`}
  />
);

