import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ticket, TicketCategory } from '../../../api/types'
import { subscribeToTickets } from '../../../api/tickets'
import { subscribeToTicketCategories } from '../../../api/ticket-categories'
import { useAuth } from '../../../features/auth/auth-context'
import {
  aggregateByBranch,
  aggregateByCategory,
  breachRate,
  computeMTTR,
  mttrPerBranch,
  ticketsPerDay,
} from '../../../api/ticket-analytics'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const THIRTY_DAYS = 30

const fmtSecondsAsHours = (seconds: number): string => {
  if (!seconds) return '—'
  const hours = seconds / 3600
  if (hours < 1) return `${Math.round(seconds / 60)} min`
  return `${hours.toFixed(1)} hr`
}

const fmtPercent = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`

interface CardProps {
  title: string
  subtitle?: string
  children: React.ReactNode
}

const Card = ({ title, subtitle, children }: CardProps) => (
  <section className="space-y-3 rounded-xl border border-border/45 bg-panel p-4">
    <header>
      <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-muted">{title}</h2>
      {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
    </header>
    {children}
  </section>
)

interface BarProps {
  label: string
  count: number
  max: number
}

const HBar = ({ label, count, max }: BarProps) => {
  const pct = max === 0 ? 0 : Math.round((count / max) * 100)
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-32 shrink-0 truncate text-muted" title={label}>
        {label}
      </span>
      <div className="relative h-3 grow rounded-full bg-surface">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-info"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums text-text">{count}</span>
    </div>
  )
}

const VBar = ({ value, max }: { value: number; max: number }) => {
  const pct = max === 0 ? 0 : Math.max(2, Math.round((value / max) * 100))
  return (
    <div className="flex h-20 w-3 items-end" title={`${value}`}>
      <div className="w-full rounded-t bg-info" style={{ height: `${pct}%` }} />
    </div>
  )
}

export const TicketsAnalyticsView = () => {
  const { session } = useAuth()
  const role = session?.user.role
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [loading, setLoading] = useState(true)
  const unsubRef = useRef<(() => void) | null>(null)
  const unsubCatRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setLoading(true)
    unsubRef.current = subscribeToTickets(
      (rows) => {
        setTickets(rows)
        setLoading(false)
      },
      () => setLoading(false),
    )
    unsubCatRef.current = subscribeToTicketCategories(
      (rows) => setCategories(rows),
      () => {},
    )
    return () => {
      unsubRef.current?.()
      unsubCatRef.current?.()
    }
  }, [])

  const categoryLabel = useMemo(() => {
    const map = new Map<string, string>()
    categories.forEach((c) => map.set(c.id, c.label))
    return (id: string): string => map.get(id) ?? id
  }, [categories])

  const openTickets = useMemo(
    () => tickets.filter((t) => t.status === 'Open' || t.status === 'In Progress'),
    [tickets],
  )

  const last7Days = useMemo(() => {
    const cutoff = Date.now() - SEVEN_DAYS_MS
    return tickets.filter((t) => new Date(t.createdAt).getTime() >= cutoff)
  }, [tickets])

  const openByBranch = useMemo(() => aggregateByBranch(openTickets), [openTickets])
  const mttrTable = useMemo(() => mttrPerBranch(tickets), [tickets])
  const slaBreach = useMemo(() => breachRate(tickets), [tickets])
  const topCategories = useMemo(() => aggregateByCategory(last7Days).slice(0, 5), [last7Days])
  const trend = useMemo(() => ticketsPerDay(tickets, THIRTY_DAYS), [tickets])
  const trendMax = useMemo(() => trend.reduce((m, d) => Math.max(m, d.count), 0), [trend])
  const branchMax = useMemo(
    () => openByBranch.reduce((m, b) => Math.max(m, b.count), 0),
    [openByBranch],
  )

  if (role !== 'Owner' && role !== 'Admin' && role !== 'Developer') {
    return (
      <div className="rounded-xl border border-border/45 bg-panel p-8 text-center">
        <p className="text-sm text-muted">
          Owner-tier analytics is restricted. Switch to your branch view instead.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-48 animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
    )
  }

  const totalResolved = computeMTTR(tickets).resolvedCount

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Open by branch" subtitle={`${openTickets.length} open / in-progress tickets`}>
        {openByBranch.length === 0 ? (
          <p className="text-sm text-muted">No open tickets.</p>
        ) : (
          <div className="space-y-2">
            {openByBranch.map((b) => (
              <HBar key={b.key} label={b.label} count={b.count} max={branchMax} />
            ))}
          </div>
        )}
      </Card>

      <Card title="MTTR per branch" subtitle="mean / median time to resolve">
        {mttrTable.length === 0 ? (
          <p className="text-sm text-muted">No data yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/45">
                <th className="py-1 font-medium text-muted">Branch</th>
                <th className="py-1 font-medium text-muted">Resolved</th>
                <th className="py-1 font-medium text-muted">Mean</th>
                <th className="py-1 font-medium text-muted">Median</th>
              </tr>
            </thead>
            <tbody>
              {mttrTable.map((row) => (
                <tr key={row.branchId} className="border-b border-border/30">
                  <td className="py-1.5">{row.branchDisplayName}</td>
                  <td className="py-1.5 tabular-nums">{row.mttr.resolvedCount}</td>
                  <td className="py-1.5 tabular-nums">
                    {fmtSecondsAsHours(row.mttr.meanResolveSeconds)}
                  </td>
                  <td className="py-1.5 tabular-nums">
                    {fmtSecondsAsHours(row.mttr.medianResolveSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="SLA breach rate" subtitle={`${tickets.length} tickets in scope`}>
        <div className="flex items-end gap-4">
          <span className="text-4xl font-semibold tabular-nums text-text">
            {fmtPercent(slaBreach)}
          </span>
          <span className="text-xs text-muted">
            {totalResolved} resolved · {tickets.length - totalResolved} pending
          </span>
        </div>
      </Card>

      <Card title="Top 5 categories (last 7 days)" subtitle="by volume">
        {topCategories.length === 0 ? (
          <p className="text-sm text-muted">No tickets in the last 7 days.</p>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {topCategories.map((c, idx) => (
              <li key={c.key} className="flex items-center gap-3">
                <span className="w-5 shrink-0 tabular-nums text-muted">{idx + 1}.</span>
                <span className="grow">{categoryLabel(c.key)}</span>
                <span className="tabular-nums text-muted">{c.count}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Tickets per day (last 30 days)" subtitle="bar height ∝ count">
        {trend.length === 0 ? (
          <p className="text-sm text-muted">No data.</p>
        ) : (
          <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
            {trend.map((d) => (
              <div key={d.date} className="flex flex-col items-center gap-1">
                <VBar value={d.count} max={trendMax} />
                <span className="text-[10px] tabular-nums text-muted">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
