import { memo } from "react";

export interface MetricStripItem {
  id: string;
  label: string;
  value: string;
}

export const MetricStrip = memo(({ items }: { items: MetricStripItem[] }) => (
  <section className="overflow-hidden rounded-xl border border-border/70 bg-surface shadow-sm">
    <ul className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
      {items.map((item) => (
        <li key={item.id} className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">{item.label}</p>
          <p className="mt-1 text-lg font-semibold leading-none text-text">{item.value}</p>
        </li>
      ))}
    </ul>
  </section>
));
