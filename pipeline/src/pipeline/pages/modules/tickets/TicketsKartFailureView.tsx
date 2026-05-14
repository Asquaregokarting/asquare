import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Ticket } from '../../../api/types'
import { subscribeToTickets } from '../../../api/tickets'
import { useAuth } from '../../../features/auth/auth-context'
import { kartFailureReport } from '../../../api/ticket-analytics'

const fmtTime = (iso: string): string => {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    })
  } catch {
    return '-'
  }
}

export const TicketsKartFailureView = () => {
  const { session } = useAuth()
  const role = session?.user.role
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

  const rows = useMemo(() => kartFailureReport(tickets), [tickets])

  const allowed =
    role === 'Owner' ||
    role === 'Admin' ||
    role === 'Developer' ||
    role === 'Incharge' ||
    role === 'TrackMarshall'

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border/45 bg-panel p-8 text-center">
        <p className="text-sm text-muted">Kart failure report is restricted to track-ops roles.</p>
      </div>
    )
  }

  if (loading) {
    return <div className="h-48 animate-pulse rounded-xl bg-surface" />
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border/45 bg-panel p-8 text-center">
        <p className="text-sm text-muted">
          No kart-linked Track / Safety tickets in the timeframe.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-muted">
          Kart failure report
        </h2>
        <p className="text-xs text-muted">
          Aggregates `track-safety` tickets that linked a kart entity. Sorted by count.
        </p>
      </header>

      <div className="overflow-x-auto rounded-xl border border-border/45">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border/45 bg-surface/50">
              <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Kart</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Incidents</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">
                Last incident
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Drill in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.kartId} className="border-b border-border/30 hover:bg-surface/30">
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{row.kartId}</td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{row.count}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">
                  {fmtTime(row.lastIncidentAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                  <Link
                    to={`/track/karts?kartId=${encodeURIComponent(row.kartId)}`}
                    className="text-info underline-offset-2 hover:underline"
                  >
                    Open kart
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
