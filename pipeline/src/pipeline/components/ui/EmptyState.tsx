export const EmptyState = ({ title, description }: { title: string; description: string }) => (
  <div className="rounded-xl border border-dashed border-border/70 bg-surface/80 px-5 py-7 text-center">
    <h3 className="font-display text-xl tracking-tight text-text lg:text-2xl">{title}</h3>
    <p className="mt-2 text-sm text-muted">{description}</p>
  </div>
);
