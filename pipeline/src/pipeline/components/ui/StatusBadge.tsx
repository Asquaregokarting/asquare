import { memo, ReactNode } from "react";

type Tone = "success" | "warning" | "critical" | "info" | "muted";

const toneClasses: Record<Tone, string> = {
  success: "border-success/35 bg-success/10 text-success",
  warning: "border-warning/35 bg-warning/10 text-warning",
  critical: "border-critical/35 bg-critical/10 text-critical",
  info: "border-info/35 bg-info/10 text-info",
  muted: "border-muted/30 bg-muted/15 text-muted"
};

export const StatusBadge = memo(({
  tone,
  children,
  className = ""
}: {
  tone: Tone;
  children?: ReactNode;
  className?: string;
}) => (
  <span
    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] ${toneClasses[tone]} ${className}`.trim()}
  >
    {children ?? tone}
  </span>
));
