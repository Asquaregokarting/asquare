import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { subscribeToTicket } from '../../../api/tickets'
import { useAuth } from '../../../features/auth/auth-context'
import type { Role, Ticket } from '../../../api/types'
import { TicketDetailContent } from './TicketDetailContent'

const TicketDetailRoute = () => {
  const { ticketId } = useParams<{ ticketId: string }>()
  const { session } = useAuth()
  const [ticket, setTicket] = useState<Ticket | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticketId) return
    const unsub = subscribeToTicket(
      ticketId,
      (t) => setTicket(t),
      (err) => setError(err.message),
    )
    return () => unsub()
  }, [ticketId])

  const actor = useMemo(() => {
    const user = session?.user
    return {
      id: user?.id ?? '',
      name: user?.name ?? '',
      role: (user?.role ?? 'ThirdParty') as Role,
    }
  }, [session])

  if (!ticketId) return null
  if (error) {
    return <div className="p-6 text-sm text-critical">Failed to load ticket: {error}</div>
  }
  if (ticket === undefined) {
    return <div className="p-6 text-sm text-muted">Loading ticket…</div>
  }
  if (ticket === null) {
    return (
      <div className="p-6 text-sm text-muted">
        Ticket not found.{' '}
        <Link className="text-info underline" to="/tickets">
          Back to list
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4 lg:p-6">
      <Link className="text-xs text-muted underline" to="/tickets">
        ← Back to tickets
      </Link>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <TicketDetailContent ticket={ticket} actor={actor} surface="route" />
      </div>
    </div>
  )
}

export default TicketDetailRoute
