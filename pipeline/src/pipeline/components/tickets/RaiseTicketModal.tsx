import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { ModalShell } from '../ui/ModalShell'
import { useAuth } from '../../features/auth/auth-context'
import { useToast } from '../../features/toast/toast-context'
import { createTicket } from '../../api/tickets'
import { subscribeToTicketCategories } from '../../api/ticket-categories'
import { getAllLocations } from '../../../lib/locations'
import { logger } from '../../../lib/logger'
import { findDuplicateTickets, type DuplicateMatch } from '../../api/ticket-duplicates'
import { captureAutoContext } from '../../api/ticket-auto-context'
import type {
  TicketAttachment,
  TicketCategory,
  TicketLinkedEntity,
  TicketPriority,
} from '../../api/types'
import { AttachmentUploader } from './AttachmentUploader'

const PRIORITY_OPTIONS: TicketPriority[] = ['Low', 'Normal', 'High', 'Critical']

const priorityRank = (p: TicketPriority): number => {
  switch (p) {
    case 'Low':
      return 0
    case 'Normal':
      return 1
    case 'High':
      return 2
    case 'Critical':
      return 3
  }
}

const ISSUE_MIN_CHARS = 10

const locations = getAllLocations()

interface RaiseTicketModalProps {
  open: boolean
  onClose: () => void
}

export const RaiseTicketModal = ({ open, onClose }: RaiseTicketModalProps) => {
  const { session } = useAuth()
  const { success, error: toastError } = useToast()

  // Role is taken from the session, never user-editable. Previously this was
  // a 10-role dropdown that let any user spoof which role raised the ticket
  // for the audit trail; that's a data-integrity bug. The server stamps
  // `raisedBy: session.user.id` regardless, but `role` was being trusted from
  // the client form. Now we just send `session.user.role`.
  const role = session?.user.role ?? 'Admin'

  const [location, setLocation] = useState('')
  const [issue, setIssue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoryId, setCategoryId] = useState<string>('')
  const [priority, setPriority] = useState<TicketPriority>('Normal')
  const [priorityOverridden, setPriorityOverridden] = useState(false)

  const [attachments, setAttachments] = useState<TicketAttachment[]>([])
  const [linkedEntities] = useState<TicketLinkedEntity[]>([])
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])
  const [, setDupesChecking] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // Stable per-modal pending id for storage paths until a real ticket id exists.
  const ticketDraftIdRef = useRef(`pending-${Math.random().toString(36).slice(2, 10)}`)
  const firstInputRef = useRef<HTMLSelectElement>(null)

  // Auto-focus the first input on open. Without this, the modal opens to
  // nowhere — the user has to tab in before they can do anything.
  useEffect(() => {
    if (!open) return
    // setTimeout because ModalShell may apply its own focus management on mount.
    const handle = window.setTimeout(() => firstInputRef.current?.focus(), 50)
    return () => window.clearTimeout(handle)
  }, [open])

  useEffect(() => {
    setCategoriesLoading(true)
    const unsubscribe = subscribeToTicketCategories(
      (rows) => {
        const active = rows.filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder)
        setCategories(active)
        setCategoriesLoading(false)
        setCategoryId((current) => {
          if (current && active.some((c) => c.id === current)) return current
          return active[0]?.id ?? ''
        })
      },
      () => {
        setCategoriesLoading(false)
      },
    )
    return () => {
      unsubscribe()
    }
  }, [])

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId],
  )

  // Initialize / reset priority when category changes (unless user overrode it).
  useEffect(() => {
    if (!selectedCategory) return
    setPriority((current) => {
      const floor = selectedCategory.priorityFloor
      if (!priorityOverridden) {
        return floor
      }
      // User overrode: keep their value, but clamp UP to floor if below.
      return priorityRank(current) < priorityRank(floor) ? floor : current
    })
  }, [selectedCategory, priorityOverridden])

  // Debounced duplicate-ticket check while the user types.
  useEffect(() => {
    if (!categoryId || !location) {
      setDuplicates([])
      return
    }
    const trimmed = issue.trim()
    if (trimmed.length < ISSUE_MIN_CHARS) {
      setDuplicates([])
      return
    }
    let cancelled = false
    setDupesChecking(true)
    const handle = setTimeout(() => {
      void findDuplicateTickets({
        branchId: location,
        categoryId,
        title: trimmed.slice(0, 80),
        description: trimmed,
      })
        .then((matches) => {
          if (cancelled) return
          setDuplicates(matches)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setDuplicates([])
          logger.warn('ticket.duplicate_check_failed', {
            error: err instanceof Error ? err.message : String(err),
          })
        })
        .finally(() => {
          if (!cancelled) setDupesChecking(false)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(handle)
      setDupesChecking(false)
    }
  }, [categoryId, location, issue])

  // Per-field error clearer — wipes one error key as the user fixes it,
  // instead of leaving stale "X is required" copy under a now-valid field.
  const clearError = (key: string) =>
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })

  const validate = (): boolean => {
    const next: Record<string, string> = {}
    if (!location) next.location = 'Pick a location'
    if (!categoryId) next.category = 'Pick a category'
    const trimmed = issue.trim()
    if (!trimmed) next.issue = 'Describe the issue'
    else if (trimmed.length < ISSUE_MIN_CHARS)
      next.issue = `Need ${ISSUE_MIN_CHARS - trimmed.length} more characters`
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const isDirty = issue.trim().length > 0 || attachments.length > 0 || Boolean(location)

  const requestClose = () => {
    if (submitting) return
    if (isDirty) {
      setConfirmDiscard(true)
      return
    }
    onClose()
  }

  const discardAndClose = () => {
    setConfirmDiscard(false)
    onClose()
  }

  const resetForm = () => {
    setLocation('')
    setIssue('')
    setErrors({})
    setPriorityOverridden(false)
    setAttachments([])
    setDuplicates([])
    setConfirmDiscard(false)
    ticketDraftIdRef.current = `pending-${Math.random().toString(36).slice(2, 10)}`
    const first = categories[0]
    if (first) {
      setCategoryId(first.id)
      setPriority(first.priorityFloor)
    }
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!validate() || !session) return

    setSubmitting(true)
    try {
      const loc = locations.find((l) => l.slug === location)
      const autoContext = captureAutoContext()
      if (!session.user.name) {
        throw new Error('Session is missing a display name. Sign out and back in to retry.')
      }
      const ticketId = await createTicket({
        role,
        location,
        locationDisplayName: loc?.displayName ?? location,
        issue: issue.trim(),
        raisedBy: session.user.id,
        raisedByName: session.user.name,
        categoryId,
        priorityOverride: priority,
        attachments,
        linkedEntities,
        autoContext,
      })
      success(`Ticket ${ticketId} raised.`)
      resetForm()
      onClose()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to raise ticket. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ⌘/Ctrl+Enter submits — power-user accelerator.
  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
  }

  const floor = selectedCategory?.priorityFloor ?? 'Low'
  const floorRank = priorityRank(floor)
  const issueLength = issue.trim().length
  const charsRemaining = Math.max(0, ISSUE_MIN_CHARS - issueLength)

  return (
    <ModalShell open={open} onClose={requestClose} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text">Raise a ticket</h2>
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg p-1 text-muted transition hover:bg-surface hover:text-text"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="ticket-location" className="mb-1 block text-xs font-medium text-muted">
              Location
            </label>
            <select
              ref={firstInputRef}
              id="ticket-location"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value)
                clearError('location')
              }}
              className="ui-field w-full"
            >
              <option value="">Select location</option>
              {locations.map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.displayName}
                </option>
              ))}
            </select>
            {errors.location && <p className="mt-1 text-xs text-critical">{errors.location}</p>}
          </div>

          <div>
            <label htmlFor="ticket-category" className="mb-1 block text-xs font-medium text-muted">
              Category <span className="text-critical">*</span>
            </label>
            <select
              id="ticket-category"
              value={categoryId}
              disabled={categoriesLoading}
              onChange={(e) => {
                setCategoryId(e.target.value)
                setPriorityOverridden(false)
                clearError('category')
              }}
              className="ui-field w-full disabled:opacity-60"
            >
              {categoriesLoading ? (
                <option value="">Loading…</option>
              ) : categories.length === 0 ? (
                <option value="">No categories available</option>
              ) : (
                categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))
              )}
            </select>
            {errors.category && <p className="mt-1 text-xs text-critical">{errors.category}</p>}
          </div>

          <div>
            <label htmlFor="ticket-priority" className="mb-1 block text-xs font-medium text-muted">
              Priority
            </label>
            <select
              id="ticket-priority"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value as TicketPriority)
                setPriorityOverridden(true)
              }}
              className="ui-field w-full"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p} disabled={priorityRank(p) < floorRank}>
                  {p}
                  {priorityRank(p) < floorRank ? ' (below minimum)' : ''}
                </option>
              ))}
            </select>
            {selectedCategory ? (
              <p className="mt-1 text-xs text-muted">
                Minimum priority for {selectedCategory.label}: {selectedCategory.priorityFloor}
              </p>
            ) : null}
          </div>

          {duplicates.length > 0 ? (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
              <p className="mb-2 text-xs font-semibold text-warning">
                Possible duplicate{duplicates.length > 1 ? 's' : ''} in the last 7 days:
              </p>
              <ul className="space-y-1">
                {duplicates.slice(0, 3).map((d) => (
                  <li
                    key={d.ticket.id}
                    className="flex flex-wrap items-center gap-2 text-xs text-text"
                  >
                    <span className="font-mono text-muted">{d.ticket.id}</span>
                    <span className="truncate">{d.ticket.title}</span>
                    <span className="text-muted">{(d.similarity * 100).toFixed(0)}% match</span>
                    <Link
                      to={`/tickets/${d.ticket.id}`}
                      className="text-info underline-offset-2 hover:underline"
                    >
                      View
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <label htmlFor="ticket-issue" className="mb-1 block text-xs font-medium text-muted">
              Issue <span className="text-critical">*</span>
            </label>
            <textarea
              id="ticket-issue"
              rows={4}
              value={issue}
              onChange={(e) => {
                setIssue(e.target.value)
                clearError('issue')
              }}
              placeholder="What happened? When? What did you expect instead?"
              className="ui-field w-full resize-y"
            />
            {issueLength > 0 && issueLength < ISSUE_MIN_CHARS ? (
              <p className="mt-1 text-xs text-muted">
                {charsRemaining} more {charsRemaining === 1 ? 'character' : 'characters'} needed
              </p>
            ) : null}
            {errors.issue && <p className="mt-1 text-xs text-critical">{errors.issue}</p>}
          </div>

          <div>
            <p className="mb-1 block text-xs font-medium text-muted">Attachments</p>
            <AttachmentUploader
              value={attachments}
              onChange={setAttachments}
              ticketDraftId={ticketDraftIdRef.current}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">
            <kbd className="rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-[10px]">
              ⌘ ⏎
            </kbd>{' '}
            to submit
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={requestClose}
              className="ui-btn ui-btn-neutral text-xs"
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="ui-btn ui-btn-primary text-xs" disabled={submitting}>
              {submitting ? 'Raising…' : 'Raise ticket'}
            </button>
          </div>
        </div>
      </form>

      {/* Discard-confirm overlay — appears inside the modal when the user
          tries to close with unsaved input. Avoids a stack-of-modals
          situation; the rest of the form stays visible behind. */}
      {confirmDiscard ? (
        <div
          role="alertdialog"
          aria-label="Discard ticket draft?"
          className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-base/85 p-5"
        >
          <div className="w-full max-w-xs rounded-xl border border-border bg-panel p-4 shadow-panel">
            <p className="text-sm font-semibold text-text">Discard this draft?</p>
            <p className="mt-1 text-xs text-muted">
              You'll lose the typed issue
              {attachments.length > 0
                ? ` and ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
                : ''}
              .
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="ui-btn ui-btn-neutral text-xs"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={discardAndClose}
                className="ui-btn ui-btn-danger text-xs"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ModalShell>
  )
}
