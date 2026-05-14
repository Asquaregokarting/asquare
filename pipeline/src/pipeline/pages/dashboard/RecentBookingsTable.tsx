/**
 * Recent bookings widget on the Owner / Admin dashboard.
 *
 * Shows the 10 most recent bookings (sorted by createdAt desc), giving
 * owner-level visibility into live activity without leaving the
 * dashboard. The visible columns are deliberately scoped to "what just
 * happened" — time, customer, items, branch, amount, status — not the
 * full booking record. For deep inspection / search / filter, the
 * footer link opens the full /bookings/list view.
 *
 * Restrained color: status is the only chromatic accent (subtle PAID
 * green / PENDING amber / FAILED critical). Amount is high-contrast
 * tabular-mono so the eye lands there first.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { ArrowRight, History } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getAsquareFirestore } from '../../api/asquare-firestore'
import { parseBooking, type AsquareBooking } from '../../api/asquare-bookings'
import { getLocationDisplayName } from '../../../lib/locations'
import { Skeleton } from '../../components/ui/Skeleton'
import ErrorState from '../../../components/ui/ErrorState'

const RECENT_COUNT = 10

const fmtAmount = (n: number): string => {
  if (n === 0) return '₹0'
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

/**
 * Human-friendly relative time. Tight thresholds because the dashboard
 * shows fresh activity — "32m ago" is precise enough; older entries
 * compress to absolute date+time so a glance at the bottom of the list
 * still gives a usable timestamp.
 */
const relativeTime = (date: Date | null | undefined): string => {
  if (!date || isNaN(date.getTime())) return '—'
  const diffMs = Date.now() - date.getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 30) return 'Just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  // Past 24h — show "Yesterday 3:45 PM" or "12 Apr 4:30 PM"
  const today = new Date()
  const yest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const yyyymmdd = (d: Date) =>
    d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const dKey = yyyymmdd(date)
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
  if (dKey === yyyymmdd(yest)) return `Yesterday · ${time}`
  return `${date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  })} · ${time}`
}

const summarizeItems = (booking: AsquareBooking): string => {
  const names = (booking.items || [])
    .map((it) => {
      const name = it.activity?.name || (it as { itemName?: string }).itemName || ''
      const qty = Number(it.quantity) || 1
      return name ? (qty > 1 ? `${name} ×${qty}` : name) : ''
    })
    .filter(Boolean)
  if (names.length === 0) return '—'
  if (names.length <= 2) return names.join(' · ')
  return `${names.slice(0, 2).join(' · ')} +${names.length - 2}`
}

interface StatusTag {
  label: string
  className: string
}

const statusTag = (booking: AsquareBooking): StatusTag => {
  const ps = String(booking.paymentStatus || '').toLowerCase()
  const bs = String(booking.bookingStatus || '').toLowerCase()
  const refundRaw = String(
    (booking as Record<string, unknown>).refundStatus ?? '',
  ).toLowerCase()
  const cancelled = (booking as { cancelled?: boolean }).cancelled === true

  if (cancelled || bs === 'cancelled') {
    return {
      label: 'CANCELLED',
      className: 'border-critical/25 bg-critical/5 text-critical',
    }
  }
  if (refundRaw === 'full' || ps === 'refunded') {
    return {
      label: 'REFUNDED',
      className: 'border-critical/25 bg-critical/5 text-critical',
    }
  }
  if (refundRaw === 'partial') {
    return {
      label: 'PARTIAL',
      className: 'border-warning/25 bg-warning/5 text-warning',
    }
  }
  if (ps === 'completed') {
    return {
      label: 'PAID',
      className: 'border-success/25 bg-success/5 text-success',
    }
  }
  if (ps === 'pending') {
    return {
      label: 'PENDING',
      className: 'border-warning/25 bg-warning/5 text-warning',
    }
  }
  if (ps === 'failed' || ps === 'amount_mismatch') {
    return {
      label: 'FAILED',
      className: 'border-critical/25 bg-critical/5 text-critical',
    }
  }
  return {
    label: (ps || bs || '—').toUpperCase(),
    className: 'border-border/45 bg-surface/40 text-muted',
  }
}

const fetchRecentBookings = async (count: number): Promise<AsquareBooking[]> => {
  const firestore = getAsquareFirestore()
  const q = query(
    collection(firestore, 'bookings'),
    orderBy('createdAt', 'desc'),
    limit(count),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => parseBooking({ ...(d.data() as Record<string, unknown>), id: d.id }))
}

const RecentBookingsTable = () => {
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['recent-bookings-dashboard', RECENT_COUNT],
    queryFn: () => fetchRecentBookings(RECENT_COUNT),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const bookings = useMemo(() => data ?? [], [data])

  if (isLoading && bookings.length === 0) return <RecentBookingsSkeleton />
  if (error) {
    return (
      <section
        aria-label="Recent bookings"
        className="rounded-xl border border-border/45 bg-panel p-4"
      >
        <ErrorState
          title="Couldn't load recent bookings"
          description={error instanceof Error ? error.message : 'Unknown error'}
          onRetry={() => void refetch()}
        />
      </section>
    )
  }

  return (
    <section
      aria-label="Recent bookings"
      className="rounded-xl border border-border/45 bg-panel"
    >
      <header className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-muted" aria-hidden />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Recent bookings
          </h2>
          {bookings.length > 0 ? (
            <span className="font-mono tabular-nums text-[11px] text-muted/80">
              · {bookings.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => navigate('/bookings/list')}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted transition-colors hover:bg-surface/55 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
          aria-label="Show all bookings"
        >
          Show all <ArrowRight className="h-3 w-3" aria-hidden />
        </button>
      </header>

      {bookings.length === 0 ? (
        <p className="border-t border-border/30 px-4 py-6 text-center text-sm text-muted">
          No bookings yet.
        </p>
      ) : (
        <ol className="divide-y divide-border/25 border-t border-border/30">
          {bookings.map((b) => (
            <RecentRow key={b.id} booking={b} onOpen={() => navigate('/bookings/list')} />
          ))}
        </ol>
      )}
    </section>
  )
}

interface RowProps {
  booking: AsquareBooking
  onOpen: () => void
}

const RecentRow = ({ booking, onOpen }: RowProps) => {
  const customerName =
    booking.userDisplayName ||
    (booking as { customerName?: string }).customerName ||
    (booking as { name?: string }).name ||
    'Customer'
  const phone =
    booking.userPhone ||
    (booking as { customerPhone?: string }).customerPhone ||
    (booking as { mobile?: string }).mobile ||
    ''
  const branch =
    getLocationDisplayName(String(booking.locationId || '')) || String(booking.locationId || '')
  const tag = statusTag(booking)
  const items = summarizeItems(booking)
  const finalAmount = Number(booking.finalAmount) || 0

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-stretch gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface/55 focus:bg-surface/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/45"
      >
        {/* time-ago — narrow, fixed width so amounts align on the right */}
        <span className="hidden w-16 shrink-0 self-center font-mono tabular-nums text-[11px] text-muted sm:inline">
          {relativeTime(booking.createdAt)}
        </span>

        {/* customer + items — flexible center column, truncates */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="truncate text-sm font-medium text-text">{customerName}</p>
            {phone ? (
              <p className="hidden truncate text-[11px] text-muted sm:inline">{phone}</p>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted">
            {items}
            {branch ? <span className="text-muted/65"> · {branch}</span> : null}
          </p>
          <p className="mt-0.5 text-[10px] text-muted/70 sm:hidden">
            {relativeTime(booking.createdAt)}
          </p>
        </div>

        {/* amount + status — right-aligned */}
        <div className="flex shrink-0 flex-col items-end justify-center gap-0.5">
          <span className="font-mono tabular-nums text-sm font-semibold text-text">
            {fmtAmount(finalAmount)}
          </span>
          <span
            className={
              'inline-flex items-center rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.06em] ' +
              tag.className
            }
          >
            {tag.label}
          </span>
        </div>
      </button>
    </li>
  )
}

const RecentBookingsSkeleton = () => (
  <section className="rounded-xl border border-border/45 bg-panel" aria-busy>
    <header className="flex items-center justify-between gap-3 px-4 py-2.5">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-3 w-16" />
    </header>
    <div className="divide-y divide-border/25 border-t border-border/30">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Skeleton className="hidden h-3 w-14 sm:block" />
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2 w-3/5" />
          </div>
          <div className="flex flex-col items-end gap-1">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-2.5 w-12 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  </section>
)

export default RecentBookingsTable
