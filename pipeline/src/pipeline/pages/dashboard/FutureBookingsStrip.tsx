/**
 * Next-7-days forward-looking strip on the Owner / Admin dashboard.
 *
 * Renders a quiet horizontal row of 7 day cells, each with a count and a
 * revenue figure. Today's column is subtly accented (top hairline, cooler
 * surface tint). Days with count < 50% of the 7-day median are flagged
 * with an amber revenue colour so a "soft day" jumps out without
 * competing chromatically with the discrepancy band above.
 *
 * Click a cell → opens the slide-over for that day. Keyboard nav: tab
 * through cells, Enter opens.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, AlertTriangle } from 'lucide-react'
import {
  fetchFutureBookings,
  medianOfCounts,
  SOFT_DAY_RATIO,
  type FutureBookingDay,
} from '../../features/dashboard/future-bookings'
import { addDaysIST, todayIST } from '../../lib/ist-date'
import { getLocationDisplayName } from '../../../lib/locations'
import { Skeleton } from '../../components/ui/Skeleton'
import ErrorState from '../../../components/ui/ErrorState'

interface Props {
  onSelectDate: (date: string) => void
}

const WEEKDAY_LABEL: Record<number, string> = {
  0: 'SUN',
  1: 'MON',
  2: 'TUE',
  3: 'WED',
  4: 'THU',
  5: 'FRI',
  6: 'SAT',
}

/** Format ₹12,345 as "₹12.3k" once the number crosses 10,000 — keeps each
 *  cell narrow enough to fit 7 across at desktop without truncation. */
const fmtRevenue = (n: number): string => {
  if (n === 0) return '—'
  if (n < 10_000) return `₹${Math.round(n).toLocaleString('en-IN')}`
  if (n < 1_00_000) return `₹${(n / 1_000).toFixed(n < 50_000 ? 1 : 0)}k`
  return `₹${(n / 1_00_000).toFixed(1)}L`
}

const fmtRevenueFull = (n: number): string =>
  n === 0 ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`

const weekdayOf = (ymd: string): string => {
  const parts = ymd.split('-').map(Number)
  if (parts.length !== 3) return ''
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  return WEEKDAY_LABEL[d.getUTCDay()] ?? ''
}

const dayOf = (ymd: string): string => ymd.slice(8, 10)

const FutureBookingsStrip = ({ onSelectDate }: Props) => {
  const today = todayIST()
  const range = useMemo(() => ({ from: today, to: addDaysIST(today, 6) }), [today])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['future-bookings', range.from, range.to],
    queryFn: () => fetchFutureBookings(range.from, range.to),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const softCountThreshold = useMemo(() => {
    if (!data) return 0
    const median = medianOfCounts(data.days.map((d) => d.count))
    return median * SOFT_DAY_RATIO
  }, [data])

  // Sum across all 7 days, grouped by branch — drives the footer chips.
  const branchTotals = useMemo(() => {
    if (!data) return [] as Array<{ branchId: string; count: number; revenue: number }>
    const acc = new Map<string, { count: number; revenue: number }>()
    for (const day of data.days) {
      for (const [branchId, totals] of day.byBranch) {
        const existing = acc.get(branchId) ?? { count: 0, revenue: 0 }
        existing.count += totals.count
        existing.revenue += totals.revenue
        acc.set(branchId, existing)
      }
    }
    return Array.from(acc.entries())
      .map(([branchId, totals]) => ({ branchId, ...totals }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.revenue - a.revenue)
  }, [data])

  if (isLoading && !data) return <FutureBookingsStripSkeleton />
  if (error) {
    return (
      <section aria-label="Next 7 days" className="rounded-xl border border-border/45 bg-panel p-4">
        <ErrorState
          title="Couldn't load future bookings"
          description={error instanceof Error ? error.message : 'Unknown error'}
          onRetry={() => void refetch()}
        />
      </section>
    )
  }
  if (!data) return null

  const allEmpty = data.totalCount === 0

  return (
    <section aria-label="Next 7 days" className="rounded-xl border border-border/45 bg-panel">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-3.5 w-3.5 text-muted" aria-hidden />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Next 7 days
          </h2>
        </div>
        <p className="font-mono tabular-nums text-[11px] text-muted">
          {data.totalCount} bookings · {fmtRevenueFull(data.totalRevenue)}
        </p>
      </header>

      {allEmpty ? (
        <p className="border-t border-border/30 px-4 py-6 text-center text-sm text-muted">
          No bookings scheduled this week.
        </p>
      ) : (
        <>
          <ol className="grid grid-cols-7 border-t border-border/30 overflow-x-auto">
            {data.days.map((day) => (
              <DayCell
                key={day.date}
                day={day}
                isToday={day.date === today}
                softCountThreshold={softCountThreshold}
                onClick={() => onSelectDate(day.date)}
              />
            ))}
          </ol>

          {branchTotals.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/30 px-4 py-2 text-[11px] text-muted">
              <span className="font-semibold uppercase tracking-[0.08em] text-muted/80">
                7-day split
              </span>
              {branchTotals.map((row) => (
                <span key={row.branchId} className="font-mono tabular-nums">
                  <span className="text-text/85">
                    {getLocationDisplayName(row.branchId) || row.branchId}
                  </span>
                  <span className="text-muted/80"> {row.count}</span>
                  <span className="text-muted/60"> · {fmtRevenue(row.revenue)}</span>
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

interface CellProps {
  day: FutureBookingDay
  isToday: boolean
  softCountThreshold: number
  onClick: () => void
}

const DayCell = ({ day, isToday, softCountThreshold, onClick }: CellProps) => {
  const empty = day.count === 0
  // "Soft" trigger is by count vs 7-day median, not revenue — a single
  // big-ticket booking on an otherwise empty day shouldn't disguise it.
  const isSoft = !empty && day.count < softCountThreshold

  const wd = isToday ? 'TODAY' : weekdayOf(day.date)
  const dn = dayOf(day.date)
  const revenueText = fmtRevenue(day.revenue)
  const revenueClass = empty ? 'text-muted/60' : isSoft ? 'text-warning' : 'text-text'

  return (
    <li className="contents">
      <button
        type="button"
        onClick={onClick}
        aria-label={`${wd} ${dn}, ${day.count} bookings, ${fmtRevenueFull(day.revenue)}`}
        className={
          'group relative flex flex-col items-center gap-1 border-l border-border/30 px-2 py-3 text-center transition-colors first:border-l-0 hover:bg-surface/55 focus:bg-surface/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/45 ' +
          (isToday ? 'bg-surface/40' : '')
        }
      >
        {isToday ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-2 top-0 h-px bg-accent/70"
          />
        ) : null}
        <span
          className={
            'text-[10px] font-semibold uppercase tracking-[0.1em] ' +
            (isToday ? 'text-accent' : 'text-muted')
          }
        >
          {wd}
        </span>
        <span
          className={
            'font-mono tabular-nums text-[11px] ' + (isToday ? 'text-text' : 'text-muted/85')
          }
        >
          {dn}
        </span>
        <span
          className={
            'mt-1 font-mono tabular-nums text-xl leading-none ' +
            (empty ? 'text-muted/45' : 'text-text')
          }
        >
          {empty ? '—' : day.count}
        </span>
        <span className={'font-mono tabular-nums text-[11px] leading-tight ' + revenueClass}>
          {revenueText}
        </span>
        {isSoft ? (
          <span
            className="mt-0.5 inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.08em] text-warning/80"
            aria-label="Below typical demand"
          >
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden /> Soft
          </span>
        ) : null}
      </button>
    </li>
  )
}

const FutureBookingsStripSkeleton = () => (
  <section className="rounded-xl border border-border/45 bg-panel" aria-busy>
    <header className="flex items-center justify-between gap-3 px-4 py-2.5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-32" />
    </header>
    <div className="grid grid-cols-7 border-t border-border/30">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col items-center gap-2 border-l border-border/30 px-2 py-3 first:border-l-0"
        >
          <Skeleton className="h-2 w-8" />
          <Skeleton className="h-2 w-4" />
          <Skeleton className="mt-1 h-5 w-8" />
          <Skeleton className="h-2 w-10" />
        </div>
      ))}
    </div>
  </section>
)

export default FutureBookingsStrip
