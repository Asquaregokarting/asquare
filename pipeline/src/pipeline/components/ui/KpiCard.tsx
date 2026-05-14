import { memo } from 'react'

type Tone = 'success' | 'warning' | 'critical' | 'info' | 'muted'

export interface KpiCardProps {
  label: string
  value: string
  tone: Tone
}

const dotTone: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  critical: 'bg-critical',
  info: 'bg-info',
  muted: 'bg-muted/60',
}

/**
 * KPI cell, not card. Quiet by default: small uppercase label, mid-weight
 * tabular numerals at body+1 scale, a 6px tone dot only when the metric is
 * non-neutral. No giant gradient numbers, no entrance animations, no
 * "card" chrome competing with neighbors. PRODUCT.md principle 5: numbers
 * earn their decoration; until the value tilts away from neutral, it stays
 * understated.
 */
export const KpiCard = memo(({ label, value, tone }: KpiCardProps) => (
  <article className="flex items-baseline justify-between gap-3 rounded-lg border border-border/45 bg-panel px-4 py-3">
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums tracking-[-0.01em] text-text">
        {value}
      </p>
    </div>
    {tone !== 'muted' ? (
      <span
        aria-hidden
        className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${dotTone[tone]}`}
      />
    ) : null}
  </article>
))
