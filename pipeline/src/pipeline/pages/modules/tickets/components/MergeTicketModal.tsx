import { useState, type FormEvent } from 'react'
import { ModalShell } from '../../../../components/ui/ModalShell'
import type { Ticket } from '../../../../api/types'
import { mergeTicketInto, type ActorIdentity } from '../../../../api/tickets-firestore'
import { useToast } from '../../../../features/toast/toast-context'
import { logger } from '../../../../../lib/logger'

interface MergeTicketModalProps {
  ticket: Ticket
  actor: ActorIdentity
  open: boolean
  onClose: () => void
}

export const MergeTicketModal = ({ ticket, actor, open, onClose }: MergeTicketModalProps) => {
  const [targetId, setTargetId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { success, error: toastError } = useToast()

  const handleConfirm = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = targetId.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      await mergeTicketInto(ticket.id, trimmed, actor)
      success(`Merged ${ticket.id} into ${trimmed}`)
      setTargetId('')
      onClose()
    } catch (err) {
      logger.error('ticket.merge_failed', err instanceof Error ? err : new Error(String(err)), {
        sourceId: ticket.id,
        targetId: trimmed,
      })
      toastError(err instanceof Error ? err.message : 'Failed to merge ticket')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} maxWidth="max-w-md">
      <form onSubmit={handleConfirm} className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-text">Merge duplicate ticket</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted transition hover:bg-surface hover:text-text"
            aria-label="Close"
            disabled={submitting}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label
              htmlFor={`merge-target-${ticket.id}`}
              className="mb-1 block text-xs font-medium text-muted"
            >
              Target ticket ID
            </label>
            <input
              id={`merge-target-${ticket.id}`}
              type="text"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="TKT-xxxxxxxx"
              className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/30"
              disabled={submitting}
            />
          </div>
          <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
            The source ticket will be marked Closed and pointed at the target.
          </p>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="ui-btn ui-btn-neutral text-xs"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !targetId.trim()}
            className="ui-btn ui-btn-primary text-xs"
          >
            {submitting ? 'Merging…' : 'Confirm merge'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
