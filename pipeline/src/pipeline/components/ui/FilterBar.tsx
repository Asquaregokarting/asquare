import { ReactNode } from "react";

export const FilterBar = ({ children }: { children: ReactNode }) => (
  <div className="ui-toolbar py-3.5">
    <div className="flex flex-wrap items-end gap-4">{children}</div>
  </div>
);

export const FilterField = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="grid min-w-[160px] gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
    <span>{label}</span>
    {children}
  </label>
);
