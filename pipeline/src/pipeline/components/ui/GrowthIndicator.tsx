/**
 * GrowthIndicator — compact "+12.5% ↑" / "-3.2% ↓" pill.
 *
 * Direction is derived from sign of the percent, with a "flat" rest
 * state for changes inside ±0.5%. Color follows the project's semantic
 * tokens (success / critical / muted) so dark/light themes both work
 * without per-call overrides.
 *
 * Restrained color per PRODUCT.md — semantic colors only fire when the
 * value is genuinely up or down. A flat indicator is neutral muted.
 */
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'

export interface GrowthIndicatorProps {
  /** Percent change, e.g. 12.5 for +12.5%. Pass `null` to show nothing
   *  (e.g. when previous-period data is missing). */
  percent: number | null
  /** Optional context label rendered as a hover tooltip + sr-only span,
   *  e.g. "vs yesterday". Keeps the visible pill compact. */
  label?: string
  /** Tweak the spacing/typography for the host card. Default: 'sm'. */
  size?: 'sm' | 'md'
  className?: string
}

const FLAT_THRESHOLD = 0.5

const tone = (percent: number) => {
  if (percent >= FLAT_THRESHOLD) {
    return {
      Icon: TrendingUp,
      sign: '+',
      cls: 'border-success/30 bg-success/10 text-success',
    }
  }
  if (percent <= -FLAT_THRESHOLD) {
    return {
      Icon: TrendingDown,
      sign: '',
      cls: 'border-critical/30 bg-critical/10 text-critical',
    }
  }
  return {
    Icon: Minus,
    sign: '',
    cls: 'border-border/45 bg-surface/55 text-muted',
  }
}

export default function GrowthIndicator({
  percent,
  label,
  size = 'sm',
  className = '',
}: GrowthIndicatorProps) {
  if (percent === null || !Number.isFinite(percent)) return null
  const { Icon, sign, cls } = tone(percent)
  const sizeCls = size === 'md' ? 'px-2 py-0.5 text-xs gap-1' : 'px-1.5 py-px text-[11px] gap-0.5'
  const iconSize = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'
  const display = `${sign}${Math.abs(percent) < 10 ? percent.toFixed(1) : Math.round(percent)}%`
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border font-mono tabular-nums font-semibold',
        sizeCls,
        cls,
        className,
      ].join(' ')}
      title={label}
      aria-label={label ? `${display} ${label}` : `${display}`}
    >
      <Icon className={iconSize} aria-hidden="true" />
      {display}
    </span>
  )
}
