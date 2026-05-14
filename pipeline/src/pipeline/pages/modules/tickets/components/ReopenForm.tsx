import { useState, type FormEvent } from 'react'
import type { Ticket } from '../../../../api/types'
import { reopenTicket, type ActorIdentity } from '../../../../api/tickets-firestore'
import { useToast } from '../../../../features/toast/toast-context'
import { logger } from '../../../../../lib/logger'

interface ReopenFormProps {
  ticket: Ticket
  actor: ActorIdentity
  onReopened: () => void
}

export const ReopenForm = ({ ticket, actor, onReopened }: ReopenFormProps) => {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { success, error: toastError } = useToast()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      await reopenTicket({
        ticketId: ticket.id,
        resolvedAt: ticket.resolvedAt,
        reason: trimmed,
        actor,
      })
      success(`Ticket ${ticket.id} reopened`)
      setReason('')
      onReopened()
    } catch (err) {
      logger.error('ticket.reopen_failed', err instanceof Error ? err : new Error(String(err)), {
        ticketId: ticket.id,
      })
      toastError(err instanceof Error ? err.message : 'Failed to reopen ticket')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4"
    >
      <h3 className="text-sm font-semibold text-text">Reopen ticket</h3>
      <div>
        <label
          htmlFor={`reopen-reason-${ticket.id}`}
          className="mb-1 block text-xs font-medium text-muted"
        >
          Reason <span className="text-critical">*</span>
        </label>
        <input
          id={`reopen-reason-${ticket.id}`}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this being reopened?"
          className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/30"
          disabled={submitting}
        />
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || !reason.trim()}
          className="ui-btn ui-btn-primary text-xs"
        >
          {submitting ? 'Reopening…' : 'Reopen'}
        </button>
      </div>
    </form>
  )
}
