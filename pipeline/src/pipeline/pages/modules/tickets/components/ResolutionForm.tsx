import { useState, type FormEvent } from 'react'
import type { Ticket, TicketRootCauseTag } from '../../../../api/types'
import { TICKET_ROOT_CAUSE_TAGS } from '../../../../api/types'
import { resolveTicket, type ActorIdentity } from '../../../../api/tickets-firestore'
import { useToast } from '../../../../features/toast/toast-context'
import { logger } from '../../../../../lib/logger'

interface ResolutionFormProps {
  ticket: Ticket
  actor: ActorIdentity
  onResolved: () => void
}

export const ResolutionForm = ({ ticket, actor, onResolved }: ResolutionFormProps) => {
  const [note, setNote] = useState('')
  const [tag, setTag] = useState<TicketRootCauseTag>('other')
  const [submitting, setSubmitting] = useState(false)
  const { success, error: toastError } = useToast()

  const noteValid = note.trim().length >= 10

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!noteValid) return
    setSubmitting(true)
    try {
      await resolveTicket({
        ticketId: ticket.id,
        fromStatus: ticket.status,
        resolutionNote: note,
        rootCauseTag: tag,
        actor,
      })
      success(`Ticket ${ticket.id} resolved`)
      setNote('')
      setTag('other')
      onResolved()
    } catch (err) {
      logger.error('ticket.resolve_failed', err instanceof Error ? err : new Error(String(err)), {
        ticketId: ticket.id,
      })
      toastError(err instanceof Error ? err.message : 'Failed to resolve ticket')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-success/40 bg-success/5 p-4"
    >
      <h3 className="text-sm font-semibold text-text">Resolve ticket</h3>
      <div>
        <label
          htmlFor={`resolve-note-${ticket.id}`}
          className="mb-1 block text-xs font-medium text-muted"
        >
          Resolution note <span className="text-critical">*</span>
        </label>
        <textarea
          id={`resolve-note-${ticket.id}`}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What was the resolution?"
          className="w-full resize-y rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/30"
          disabled={submitting}
        />
        <p className="mt-1 text-xs text-muted">{note.trim().length}/10 min characters</p>
      </div>
      <div>
        <label
          htmlFor={`resolve-tag-${ticket.id}`}
          className="mb-1 block text-xs font-medium text-muted"
        >
          Root cause
        </label>
        <select
          id={`resolve-tag-${ticket.id}`}
          value={tag}
          onChange={(e) => setTag(e.target.value as TicketRootCauseTag)}
          className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/30"
          disabled={submitting}
        >
          {TICKET_ROOT_CAUSE_TAGS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || !noteValid}
          className="ui-btn ui-btn-primary text-xs"
        >
          {submitting ? 'Resolving…' : 'Submit resolution'}
        </button>
      </div>
    </form>
  )
}
