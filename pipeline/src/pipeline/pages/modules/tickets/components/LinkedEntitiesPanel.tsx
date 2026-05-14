import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Car, CreditCard, Plus, User } from 'lucide-react'
import type { TicketLinkedEntity, TicketLinkedEntityType } from '../../../../api/types'
import { addTicketLinkedEntity, type ActorIdentity } from '../../../../api/tickets-firestore'
import { useToast } from '../../../../features/toast/toast-context'
import { logger } from '../../../../../lib/logger'

interface LinkedEntitiesPanelProps {
  entities: TicketLinkedEntity[]
  ticketId: string
  actor: ActorIdentity
}

const iconFor = (type: TicketLinkedEntityType) => {
  switch (type) {
    case 'booking':
      return <Calendar className="h-4 w-4" aria-hidden="true" />
    case 'kart':
      return <Car className="h-4 w-4" aria-hidden="true" />
    case 'customer':
      return <User className="h-4 w-4" aria-hidden="true" />
    case 'payment':
      return <CreditCard className="h-4 w-4" aria-hidden="true" />
  }
}

const hrefFor = (entity: TicketLinkedEntity): string => {
  switch (entity.type) {
    case 'booking':
      return `/bookings/list?bookingId=${entity.id}`
    case 'kart':
      return `/track/karts?kartId=${entity.id}`
    case 'customer':
      return `/admin/customers/${entity.id}`
    case 'payment':
      return `/billing/transactions?paymentId=${entity.id}`
  }
}

export const LinkedEntitiesPanel = ({ entities, ticketId, actor }: LinkedEntitiesPanelProps) => {
  const [linkOpen, setLinkOpen] = useState(false)
  const [bookingId, setBookingId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { success, error: toastError } = useToast()

  const handleLink = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = bookingId.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      await addTicketLinkedEntity(
        ticketId,
        { type: 'booking', id: trimmed, label: `Booking ${trimmed}` },
        actor,
      )
      setBookingId('')
      setLinkOpen(false)
      success(`Linked booking ${trimmed}`)
    } catch (err) {
      logger.error(
        'ticket.linked_entity_add_failed',
        err instanceof Error ? err : new Error(String(err)),
        { ticketId, type: 'booking', id: trimmed },
      )
      toastError('Failed to link booking')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Linked entities</h3>
        <button
          type="button"
          onClick={() => setLinkOpen((v) => !v)}
          className="ui-btn ui-btn-neutral inline-flex items-center gap-1 text-xs"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Link booking…
        </button>
      </div>

      {linkOpen ? (
        <form
          onSubmit={handleLink}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border/45 bg-panel p-3"
        >
          <input
            type="text"
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
            placeholder="Booking ID"
            className="flex-1 rounded-lg border border-border/70 bg-surface px-3 py-1.5 text-sm text-text outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/30"
            disabled={submitting}
          />
          <button
            type="submit"
            disabled={submitting || !bookingId.trim()}
            className="ui-btn ui-btn-primary text-xs"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setLinkOpen(false)
              setBookingId('')
            }}
            disabled={submitting}
            className="ui-btn ui-btn-neutral text-xs"
          >
            Cancel
          </button>
        </form>
      ) : null}

      {entities.length === 0 ? (
        <div className="rounded-lg border border-border/45 bg-panel p-6 text-center text-sm text-muted">
          No linked entities.
        </div>
      ) : (
        <ul className="space-y-2">
          {entities.map((e) => (
            <li key={`${e.type}:${e.id}`}>
              <Link
                to={hrefFor(e)}
                className="flex items-center gap-2 rounded-lg border border-border/45 bg-surface px-3 py-2 text-sm text-text transition hover:bg-surface/60"
              >
                <span className="text-muted">{iconFor(e.type)}</span>
                <span className="font-medium">{e.label}</span>
                <span className="ml-auto text-xs font-mono text-muted">{e.id}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
