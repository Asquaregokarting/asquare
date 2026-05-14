export const NewBadge = ({ className }: { className?: string }) => (
  <span
    className={`ml-1.5 inline-flex items-center rounded-full border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent ${className ?? ""}`}
  >
    New
  </span>
);
