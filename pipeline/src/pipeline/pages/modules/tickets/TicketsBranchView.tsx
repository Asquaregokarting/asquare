import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Ticket } from '../../../api/types'
import { subscribeToTickets } from '../../../api/tickets'
import { useAuth } from '../../../features/auth/auth-context'
import { breachRate, computeMTTR, oldestUnresolved } from '../../../api/ticket-analytics'

const fmtSecondsAsHours = (seconds: number): string => {
  if (!seconds) return '—'
  const hours = seconds / 3600
  if (hours < 1) return `${Math.round(seconds / 60)} min`
  return `${hours.toFixed(1)} hr`
}

const fmtPercent = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`

const fmtTime = (iso: string): string => {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    })
  } catch {
    return '-'
  }
}

const Card = ({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) => (
  <section className="space-y-3 rounded-xl border border-border/45 bg-panel p-4">
    <header>
      <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-muted">{title}</h2>
      {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
    </header>
    {children}
  </section>
)

const startOfTodayMs = (): number => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const TicketsBranchView = () => {
  const { session } = useAuth()
  const role = session?.user.role
  const allowedLocations = session?.user.allowedLocations ?? []
  const myBranchId = allowedLocations.length === 1 ? allowedLocations[0] : ''
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setLoading(true)
    unsubRef.current = subscribeToTickets(
      (rows) => {
        setTickets(rows)
        setLoading(false)
      },
      () => setLoading(false),
    )
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const branchTickets = useMemo(
    () => tickets.filter((t) => t.branchId === myBranchId),
    [tickets, myBranchId],
  )

  const open = useMemo(
    () => branchTickets.filter((t) => t.status === 'Open' || t.status === 'In Progress'),
    [branchTickets],
  )

  const breachesToday = useMemo(() => {
    const startMs = startOfTodayMs()
    return branchTickets.filter((t) => {
      if (!t.resolveDueAt) return false
      const dueMs = new Date(t.resolveDueAt).getTime()
      if (Number.isNaN(dueMs)) return false
      if (dueMs < startMs) return false
      // Only count breaches whose deadline already passed today.
      const now = Date.now()
      if (t.resolvedAt) {
        const resolvedMs = new Date(t.resolvedAt).getTime()
        return resolvedMs > dueMs && resolvedMs >= startMs
      }
      return now > dueMs && t.status !== 'Closed'
    })
  }, [branchTickets])

  const mttr = useMemo(() => computeMTTR(branchTickets), [branchTickets])
  const slaBreach = useMemo(() => breachRate(branchTickets), [branchTickets])
  const oldest = useMemo(() => oldestUnresolved(branchTickets), [branchTickets])

  const allowed = role === 'Incharge' || role === 'Owner' || role === 'Admin'

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border/45 bg-panel p-8 text-center">
        <p className="text-sm text-muted">Branch analytics is restricted to Incharge or Admin.</p>
      </div>
    )
  }

  if (!myBranchId) {
    return (
      <div className="rounded-xl border border-border/45 bg-panel p-8 text-center">
        <p className="text-sm text-muted">
          No branch assigned to your account. Ask an admin to set your branch.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
    )
  }

  const branchLabel = branchTickets[0]?.branchDisplayName || myBranchId

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Showing analytics for <span className="font-semibold text-text">{branchLabel}</span>.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Open in my branch" subtitle="Open + In Progress">
          <p className="text-4xl font-semibold tabular-nums text-text">{open.length}</p>
        </Card>

        <Card title="Breaches today" subtitle={fmtPercent(slaBreach) + ' lifetime breach rate'}>
          <p className="text-4xl font-semibold tabular-nums text-text">{breachesToday.length}</p>
        </Card>

        <Card
          title="Team MTTR"
          subtitle={`${mttr.resolvedCount} resolved out of ${branchTickets.length}`}
        >
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Mean</dt>
              <dd className="text-2xl font-semibold tabular-nums text-text">
                {fmtSecondsAsHours(mttr.meanResolveSeconds)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Median</dt>
              <dd className="text-2xl font-semibold tabular-nums text-text">
                {fmtSecondsAsHours(mttr.medianResolveSeconds)}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Oldest unresolved" subtitle="Drop everything — fix me first">
          {oldest ? (
            <Link
              to={`/tickets/${oldest.id}`}
              className="block rounded-lg border border-border/45 bg-surface/40 p-3 transition hover:bg-surface"
            >
              <p className="font-mono text-xs text-info">{oldest.id}</p>
              <p className="mt-1 truncate text-sm text-text" title={oldest.title}>
                {oldest.title}
              </p>
              <p className="mt-1 text-xs text-muted">
                Opened {fmtTime(oldest.createdAt)} · {oldest.priority}
              </p>
            </Link>
          ) : (
            <p className="text-sm text-muted">No unresolved tickets in your branch.</p>
          )}
        </Card>
      </div>
    </div>
  )
}
