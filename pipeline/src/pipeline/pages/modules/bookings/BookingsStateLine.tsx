import type { PaymentStats } from './useBookingFilters'
import { formatCurrency } from './bookings-utils'

interface Props {
  stats: PaymentStats
  total: number
}

/**
 * Inline status strip for the bookings list. Replaces the 5-KpiCard hero
 * block (the SaaS hero-metric template explicitly anti-referenced in
 * PRODUCT.md) with a single horizontal line of pairs. Discrepancy values
 * (failed / disputed / refunded) are the loudest signal: color + weight
 * when non-zero, quiet muted when zero. Healthy values stay quiet.
 *
 * Numeric pairs use tabular figures so columns line up vertically when
 * the line wraps onto two rows.
 */
const Pair = ({
  label,
  value,
  tone = 'neutral',
  emphasis = false,
}: {
  label: string
  value: string
  tone?: 'neutral' | 'success' | 'warning' | 'critical' | 'info'
  emphasis?: boolean
}) => {
  const valueClass =
    tone === 'critical'
      ? emphasis
        ? 'text-critical font-semibold'
        : 'text-muted'
      : tone === 'warning'
        ? emphasis
          ? 'text-warning font-semibold'
          : 'text-muted'
        : tone === 'success'
          ? 'text-success font-medium'
          : tone === 'info'
            ? emphasis
              ? 'text-info font-medium'
              : 'text-muted'
            : 'text-text font-medium'
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-xs uppercase tracking-[0.08em] text-muted">{label}</span>
      <span className={`text-sm tabular-nums ${valueClass}`}>{value}</span>
    </span>
  )
}

export const BookingsStateLine = ({ stats, total }: Props) => {
  return (
    <div
      role="status"
      aria-label="Booking summary"
      className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-1 text-sm"
    >
      <Pair label="Total" value={String(total)} tone="neutral" />
      <Pair
        label="Pending"
        value={String(stats.pending)}
        tone="warning"
        emphasis={stats.pending > 0}
      />
      <Pair label="Completed" value={String(stats.completed)} tone="success" />
      <Pair
        label="Failed"
        value={String(stats.failed)}
        tone="critical"
        emphasis={stats.failed > 0}
      />
      <Pair
        label="Disputed"
        value={String(stats.disputed)}
        tone="warning"
        emphasis={stats.disputed > 0}
      />
      <Pair
        label="Refunded"
        value={String(stats.refunded)}
        tone="info"
        emphasis={stats.refunded > 0}
      />
      <span className="ml-auto inline-flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-xs uppercase tracking-[0.08em] text-muted">Revenue</span>
        <span className="text-base font-semibold tabular-nums text-text">
          {formatCurrency(stats.revenue)}
        </span>
      </span>
    </div>
  )
}

export default BookingsStateLine
