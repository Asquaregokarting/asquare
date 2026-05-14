/**
 * Drill-in panel for the future-bookings strip. Lists every booking
 * scheduled for one specific day, grouped by branch. Reuses the
 * existing slide-over pattern from LeadDetailSlideOver: backdrop on
 * mobile only, right-anchored fixed panel on desktop.
 */
import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, CalendarDays, AlertTriangle } from 'lucide-react'
import {
  fetchFutureBookings,
  type FutureBookingRow,
} from '../../features/dashboard/future-bookings'
import { getLocationDisplayName } from '../../../lib/locations'

interface Props {
  date: string
  onClose: () => void
}

const STATUS_LABEL: Record<string, string> = {
  completed: 'Paid',
  pending: 'Pending',
  failed: 'Failed',
  refunded: 'Refunded',
}

const fmtRevenue = (n: number): string =>
  n === 0 ? '₹0' : `₹${Math.round(n).toLocaleString('en-IN')}`

const fmtDayHeader = (ymd: string): string => {
  const parts = ymd.split('-').map(Number)
  if (parts.length !== 3) return ymd
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const FutureBookingsSlideOver = ({ date, onClose }: Props) => {
  const { data, isLoading } = useQuery({
    queryKey: ['future-bookings-day', date],
    queryFn: () => fetchFutureBookings(date, date),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  // Escape-to-close — gives the panel keyboard parity with native dialogs
  // without pulling in a heavier dialog primitive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const day = data?.days[0]
  const isBelowTypical = useMemo(() => {
    if (!day || day.count === 0) return false
    // Lightweight "soft" hint inside the slide-over: if this day's count
    // is < 5 we flag it. The strip uses median-based logic; here a fixed
    // floor is more readable in isolation.
    return day.count < 5
  }, [day])

  const groupedByBranch = useMemo(() => {
    if (!day) return [] as Array<{ branchId: string; bookings: FutureBookingRow[] }>
    const map = new Map<string, FutureBookingRow[]>()
    for (const b of day.bookings) {
      const key = b.locationId || 'unknown'
      const arr = map.get(key) ?? []
      arr.push(b)
      map.set(key, arr)
    }
    return Array.from(map.entries())
      .map(([branchId, bookings]) => ({ branchId, bookings }))
      .sort((a, b) => b.bookings.length - a.bookings.length)
  }, [day])

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-base/65 backdrop-blur-sm sm:hidden"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Bookings for ${fmtDayHeader(date)}`}
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-border/70 bg-panel shadow-panel"
      >
        <header className="border-b border-border/45 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                <CalendarDays className="h-3 w-3" aria-hidden /> Scheduled bookings
              </p>
              <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-text">
                {fmtDayHeader(date)}
              </h2>
              {day ? (
                <p className="mt-1 font-mono tabular-nums text-sm text-muted">
                  {day.count} bookings · {fmtRevenue(day.revenue)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted transition hover:bg-surface/50 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {isBelowTypical ? (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/5 px-2 py-0.5 text-[11px] text-warning">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Below typical demand for this weekday
            </p>
          ) : null}
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading && !data ? (
            <p className="px-5 py-8 text-sm text-muted">Loading bookings…</p>
          ) : !day || day.bookings.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted">Nothing booked for this day yet.</p>
          ) : (
            <ul className="divide-y divide-border/35">
              {groupedByBranch.map(({ branchId, bookings }) => (
                <li key={branchId}>
                  <div className="flex items-baseline justify-between gap-2 bg-surface/35 px-5 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                      {getLocationDisplayName(branchId) || branchId}
                    </p>
                    <p className="font-mono tabular-nums text-[11px] text-muted">
                      {bookings.length}
                    </p>
                  </div>
                  <ul className="divide-y divide-border/25">
                    {bookings
                      .slice()
                      .sort((a, b) => b.finalAmount - a.finalAmount)
                      .map((b) => (
                        <BookingRow key={b.id} booking={b} />
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}

const BookingRow = ({ booking }: { booking: FutureBookingRow }) => {
  const dim = booking.cancelled || booking.refundStatus === 'Full'
  return (
    <li className={'px-5 py-2.5 ' + (dim ? 'opacity-60' : '')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">
            {booking.customerName || 'Customer'}
            {booking.cancelled ? (
              <span className="ml-2 text-[10px] uppercase tracking-[0.08em] text-critical">
                Cancelled
              </span>
            ) : booking.refundStatus === 'Full' ? (
              <span className="ml-2 text-[10px] uppercase tracking-[0.08em] text-critical">
                Refunded
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted">
            {booking.customerPhone}
            {booking.itemNames.length > 0
              ? ` · ${booking.itemNames.slice(0, 2).join(', ')}${booking.itemNames.length > 2 ? ` +${booking.itemNames.length - 2}` : ''}`
              : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono tabular-nums text-sm font-medium text-text">
            {fmtRevenue(booking.finalAmount)}
          </p>
          <p className="text-[10px] uppercase tracking-[0.08em] text-muted">
            {STATUS_LABEL[booking.paymentStatus] ?? booking.paymentStatus}
          </p>
        </div>
      </div>
    </li>
  )
}

export default FutureBookingsSlideOver
