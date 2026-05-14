import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, GitMerge, MessageSquare, RotateCcw, Wallet } from 'lucide-react'
import type { Role, Ticket, TicketStatus } from '../../../../api/types'
import { transitionStatus, type ActorIdentity } from '../../../../api/tickets-firestore'
import { validateStatusTransition } from '../../../../api/ticket-status-machine'
import { useToast } from '../../../../features/toast/toast-context'
import { logger } from '../../../../../lib/logger'
import { ResolutionForm } from './ResolutionForm'
import { ReopenForm } from './ReopenForm'
import { MergeTicketModal } from './MergeTicketModal'

const ALL_STATUSES: TicketStatus[] = ['Open', 'In Progress', 'Resolved', 'Closed']

interface QuickActionsProps {
  ticket: Ticket
  actor: ActorIdentity & { role: Role }
}

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000

export const QuickActions = ({ ticket, actor }: QuickActionsProps) => {
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [statusValue, setStatusValue] = useState<TicketStatus>(ticket.status)
  const [resolveOpen, setResolveOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const { success, error: toastError } = useToast()

  // Sync the displayed select value when the parent ticket prop changes.
  useEffect(() => {
    if (!updatingStatus) setStatusValue(ticket.status)
  }, [ticket.status, updatingStatus])

  const legalTargets = useMemo<TicketStatus[]>(() => {
    return ALL_STATUSES.filter(
      (s) => s === ticket.status || validateStatusTransition(ticket.status, s, {}).ok,
    )
  }, [ticket.status])

  const canReopen = useMemo(() => {
    if (ticket.status !== 'Resolved') return false
    if (!ticket.resolvedAt) return false
    const elapsed = Date.now() - new Date(ticket.resolvedAt).getTime()
    return elapsed <= FORTY_EIGHT_HOURS_MS
  }, [ticket.status, ticket.resolvedAt])

  const canResolveInline = ticket.status !== 'Resolved' && ticket.status !== 'Closed'
  const isAdminish = actor.role === 'Owner' || actor.role === 'Admin'
  const linkedBooking = ticket.linkedEntities.find((e) => e.type === 'booking')

  const handleStatusChange = async (next: TicketStatus): Promise<void> => {
    if (next === ticket.status) return
    const validation = validateStatusTransition(ticket.status, next, {})
    if (!validation.ok) {
      toastError(`Cannot transition: ${validation.reason}`)
      setStatusValue(ticket.status)
      return
    }
    setUpdatingStatus(true)
    setStatusValue(next)
    try {
      await transitionStatus(ticket.id, ticket.status, next, actor)
      success(`Status updated to ${next}`)
    } catch (err) {
      logger.error(
        'ticket.transition_failed',
        err instanceof Error ? err : new Error(String(err)),
        { ticketId: ticket.id, from: ticket.status, to: next },
      )
      toastError(err instanceof Error ? err.message : 'Failed to update status')
      setStatusValue(ticket.status)
    } finally {
      setUpdatingStatus(false)
    }
  }

  const handleSendWhatsApp = (): void => {
    success('WhatsApp template sending lands in Phase 5')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          Status
          <select
            value={statusValue}
            disabled={updatingStatus || legalTargets.length <= 1}
            onChange={(e) => void handleStatusChange(e.target.value as TicketStatus)}
            className="rounded-lg border border-border/70 bg-surface px-2 py-1 text-xs"
          >
            {legalTargets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        {canResolveInline ? (
          <button
            type="button"
            onClick={() => setResolveOpen((v) => !v)}
            className="ui-btn ui-btn-primary inline-flex items-center gap-1 text-xs"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Resolve
          </button>
        ) : null}

        {canReopen ? (
          <button
            type="button"
            onClick={() => setReopenOpen((v) => !v)}
            className="ui-btn ui-btn-neutral inline-flex items-center gap-1 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reopen
          </button>
        ) : null}

        {isAdminish ? (
          <button
            type="button"
            onClick={() => setMergeOpen(true)}
            className="ui-btn ui-btn-neutral inline-flex items-center gap-1 text-xs"
          >
            <GitMerge className="h-3.5 w-3.5" aria-hidden="true" /> Merge duplicate
          </button>
        ) : null}

        {linkedBooking ? (
          <a
            href={`/billing/refunds?bookingId=${linkedBooking.id}`}
            target="_blank"
            rel="noreferrer"
            className="ui-btn ui-btn-neutral inline-flex items-center gap-1 text-xs"
          >
            <Wallet className="h-3.5 w-3.5" aria-hidden="true" /> Refund booking
          </a>
        ) : null}

        <button
          type="button"
          onClick={handleSendWhatsApp}
          className="ui-btn ui-btn-neutral inline-flex items-center gap-1 text-xs"
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> Send WhatsApp
        </button>
      </div>

      {resolveOpen && canResolveInline ? (
        <ResolutionForm ticket={ticket} actor={actor} onResolved={() => setResolveOpen(false)} />
      ) : null}

      {reopenOpen && canReopen ? (
        <ReopenForm ticket={ticket} actor={actor} onReopened={() => setReopenOpen(false)} />
      ) : null}

      <MergeTicketModal
        ticket={ticket}
        actor={actor}
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
      />
    </div>
  )
}
