import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Role, Ticket, TicketPriority, TicketStatus } from '../../../api/types'
import { subscribeToTickets } from '../../../api/tickets'
import { useAuth } from '../../../features/auth/auth-context'
import { TicketDetailModal } from './TicketDetailModal'

type MyTicketsTab = 'assigned' | 'raised' | 'mentioned'

const TAB_LABEL: Record<MyTicketsTab, string> = {
  assigned: 'Assigned to me',
  raised: 'Raised by me',
  mentioned: 'Mentioned',
}

const ticketStatusTone = (status: TicketStatus): string => {
  switch (status) {
    case 'Open':
      return 'bg-critical/15 text-critical'
    case 'In Progress':
      return 'bg-warning/15 text-warning'
    case 'Resolved':
      return 'bg-success/15 text-success'
    case 'Closed':
      return 'bg-muted/15 text-muted'
    default:
      return 'bg-muted/15 text-muted'
  }
}

const priorityTone = (p: TicketPriority): string => {
  switch (p) {
    case 'Critical':
      return 'bg-critical/15 text-critical'
    case 'High':
      return 'bg-warning/15 text-warning'
    case 'Normal':
      return 'bg-info/15 text-info'
    case 'Low':
      return 'bg-muted/15 text-muted'
  }
}

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

export const MyTicketsView = () => {
  const { session } = useAuth()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<MyTicketsTab>('assigned')
  const [searchParams, setSearchParams] = useSearchParams()
  const openId = searchParams.get('openId')
  const unsubRef = useRef<(() => void) | null>(null)

  const me = session?.user
  const myId = me?.id ?? ''

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

  const assigned = useMemo(() => tickets.filter((t) => t.assigneeId === myId), [tickets, myId])
  const raised = useMemo(() => tickets.filter((t) => t.raisedBy === myId), [tickets, myId])
  const mentioned = useMemo(
    () => tickets.filter((t) => t.watcherIds.includes(myId)),
    [tickets, myId],
  )

  const visibleTickets = tab === 'assigned' ? assigned : tab === 'raised' ? raised : mentioned

  const ticketsById = useMemo(() => {
    const map = new Map<string, Ticket>()
    tickets.forEach((t) => map.set(t.id, t))
    return map
  }, [tickets])

  const actor = useMemo(
    () => ({
      id: me?.id ?? '',
      name: me?.name ?? '',
      role: (me?.role ?? 'ThirdParty') as Role,
    }),
    [me],
  )

  const openTicket = openId ? ticketsById.get(openId) : undefined

  const handleOpen = (ticketId: string): void => {
    const next = new URLSearchParams(searchParams)
    next.set('openId', ticketId)
    setSearchParams(next)
  }

  const handleClose = (): void => {
    const next = new URLSearchParams(searchParams)
    next.delete('openId')
    setSearchParams(next)
  }

  const counts: Record<MyTicketsTab, number> = {
    assigned: assigned.length,
    raised: raised.length,
    mentioned: mentioned.length,
  }

  if (!myId) {
    return (
      <div className="rounded-xl border border-border/45 bg-panel p-8 text-center">
        <p className="text-sm text-muted">Sign in to see your tickets.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="My tickets tabs"
        className="flex flex-wrap items-center gap-2 border-b border-border/45"
      >
        {(Object.keys(TAB_LABEL) as MyTicketsTab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`relative rounded-t-md px-3 py-2 text-sm font-medium transition ${
              tab === key
                ? 'bg-surface text-text shadow-[inset_0_-2px_0_var(--color-info)]'
                : 'text-muted hover:text-text'
            }`}
          >
            {TAB_LABEL[key]}
            <span className="ml-2 inline-flex min-w-[1.5rem] justify-center rounded-full bg-muted/15 px-1.5 py-0.5 text-xs font-semibold text-muted">
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : visibleTickets.length === 0 ? (
        <div className="rounded-xl border border-border/45 bg-panel p-8 text-center">
          <p className="text-sm text-muted">
            {tab === 'mentioned'
              ? 'You have not been @mentioned in any tickets yet.'
              : tab === 'raised'
                ? 'You have not raised any tickets yet.'
                : 'No tickets are currently assigned to you.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/45">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/45 bg-surface/50">
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Ticket ID</th>
                <th className="px-3 py-2.5 font-medium text-muted">Title</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Branch</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Status</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Priority</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Created</th>
              </tr>
            </thead>
            <tbody>
              {visibleTickets.map((t) => (
                <tr key={t.id} className="border-b border-border/30 transition hover:bg-surface/30">
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                    <button
                      type="button"
                      onClick={() => handleOpen(t.id)}
                      className="text-info underline-offset-2 hover:underline"
                    >
                      {t.id}
                    </button>
                  </td>
                  <td className="max-w-[320px] truncate px-3 py-2.5" title={t.title}>
                    <button
                      type="button"
                      onClick={() => handleOpen(t.id)}
                      className="text-left hover:text-text"
                    >
                      {t.title}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">
                    {t.branchDisplayName || t.branchId}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ticketStatusTone(t.status)}`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${priorityTone(t.priority)}`}
                    >
                      {t.priority}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">
                    {fmtTime(t.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openTicket ? (
        <TicketDetailModal open={true} onClose={handleClose} ticket={openTicket} actor={actor} />
      ) : null}
    </div>
  )
}
