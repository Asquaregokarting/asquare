/**
 * Customer 360 — Games tab.
 *
 * No per-game-session collection exists in Firestore. This tab walks the
 * customer's bookings (cursored, capped at 5,000) and reduces
 * `bookings.items[]` into a per-activity aggregate:
 *   { activity → { count, totalSpent, lastPlayed, locations } }
 *
 * Sorted by play count desc.
 */
import { useEffect, useMemo, useState } from 'react'
import { customerBookingsApi } from '../../../../api/customer-detail/customer-bookings'
import type { CustomerBookingRow } from '../../../../api/customer-detail/customer-bookings'
import { fmtDateIST } from '../../../../../lib/date-format'
import ErrorState from '../../../../../components/ui/ErrorState'

const PAGE_SIZE = 200
const MAX_BOOKINGS = 5000
const fmt = (n: number) => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

interface GameAggregate {
  activityName: string
  count: number
  totalSpent: number
  lastPlayed: Date | null
  locations: Set<string>
}

interface Props {
  customerId: string
}

export const GamesTab = ({ customerId }: Props) => {
  const [bookings, setBookings] = useState<CustomerBookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [hitCap, setHitCap] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    let cursor: Awaited<ReturnType<typeof customerBookingsApi.listBookings>>['nextCursor'] = null
    const collected: CustomerBookingRow[] = []
    setLoading(true)
    setError(null)
    setHitCap(false)
    ;(async () => {
      try {
        do {
          const page = await customerBookingsApi.listBookings(customerId, {
            pageSize: PAGE_SIZE,
            cursor: cursor ?? undefined,
          })
          if (cancelled) return
          collected.push(...page.items)
          cursor = page.nextCursor
          if (collected.length >= MAX_BOOKINGS) {
            setHitCap(true)
            break
          }
        } while (cursor)
        if (!cancelled) setBookings(collected)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [customerId, refreshKey])

  const aggregates = useMemo(() => {
    const map = new Map<string, GameAggregate>()
    for (const b of bookings) {
      if (b.deleted) continue
      const sessionDate = b.sessionDate
      for (const item of b.items ?? []) {
        const name = item.activity?.name?.trim() || 'Unknown activity'
        const existing = map.get(name)
        const sharePerItem = b.items.length > 0 ? b.finalAmount / b.items.length : 0
        if (existing) {
          existing.count += item.quantity
          existing.totalSpent += sharePerItem
          if (sessionDate && (!existing.lastPlayed || sessionDate > existing.lastPlayed)) {
            existing.lastPlayed = sessionDate
          }
          if (b.locationId) existing.locations.add(b.locationId)
        } else {
          map.set(name, {
            activityName: name,
            count: item.quantity,
            totalSpent: sharePerItem,
            lastPlayed: sessionDate || null,
            locations: new Set<string>(b.locationId ? [b.locationId] : []),
          })
        }
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [bookings])

  if (error) {
    return (
      <ErrorState
        title="Couldn't aggregate games"
        description={error.message}
        onRetry={() => setRefreshKey((k) => k + 1)}
      />
    )
  }

  return (
    <div>
      {hitCap ? (
        <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Showing aggregates from the most recent {MAX_BOOKINGS} bookings. Older bookings are
          excluded to keep the page responsive.
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">
          Aggregating from bookings… (may take a few seconds for loyal customers)
        </p>
      ) : aggregates.length === 0 ? (
        <p className="text-sm text-muted">
          No games played yet. Once this customer makes a booking, the activities they played will
          be summarised here.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {aggregates.map((g) => (
            <div key={g.activityName} className="rounded-xl border border-border/60 bg-panel p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                Activity
              </p>
              <h3 className="mt-1 text-base font-medium text-text">{g.activityName}</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted">Total plays</p>
                  <p className="font-semibold text-text">{g.count}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Total spent</p>
                  <p className="font-semibold text-text">{fmt(g.totalSpent)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Last played</p>
                  <p className="text-text">{g.lastPlayed ? fmtDateIST(g.lastPlayed) : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Locations</p>
                  <p className="text-text">
                    {g.locations.size > 0 ? [...g.locations].join(', ') : '—'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted">
        Game-level history is aggregated from bookings. For session-level detail, see the Bookings
        tab.
      </p>
    </div>
  )
}
