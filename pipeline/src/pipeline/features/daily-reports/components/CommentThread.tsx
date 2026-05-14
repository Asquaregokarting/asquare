import { useState } from 'react'
import { Flag, MessageCircle, Trash2 } from 'lucide-react'
import { fmtRelative } from '../format'
import type { ShiftCommentRecord } from '../types'

interface CommentThreadProps {
  comments: ShiftCommentRecord[]
  currentUserId?: string
  canDelete?: boolean
  onDelete?: (commentId: string) => void
}

const ROLE_TONE: Record<string, string> = {
  Owner: 'border-warning/40 bg-warning/10 text-warning',
  Admin: 'border-info/40 bg-info/10 text-info',
  Cashier: 'border-border bg-surface text-muted',
}

const roleClass = (role: string) => ROLE_TONE[role] ?? 'border-border bg-surface text-muted'

export const CommentThread = ({
  comments,
  currentUserId,
  canDelete,
  onDelete,
}: CommentThreadProps) => {
  if (comments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-8 text-center text-sm text-muted">
        <MessageCircle className="mx-auto mb-2 h-5 w-5 opacity-60" />
        No comments on this shift yet. Use the composer below to add one.
      </div>
    )
  }

  return (
    <ol className="space-y-2.5">
      {comments.map((comment) => (
        <li
          key={comment.id}
          className="relative rounded-xl border border-border bg-surface/40 px-4 py-3"
        >
          <header className="mb-1.5 flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold text-text">{comment.authorName}</span>
            <span
              className={`rounded-md border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${roleClass(
                comment.authorRole,
              )}`}
            >
              {comment.authorRole}
            </span>
            {comment.severity === 'flag' && (
              <span className="inline-flex items-center gap-1 rounded-md border border-critical/40 bg-critical/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-critical">
                <Flag className="h-2.5 w-2.5" />
                Flag
              </span>
            )}
            <span className="ml-auto text-[11px] tabular-nums text-muted">
              {fmtRelative(comment.createdAt)}
            </span>
          </header>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">{comment.body}</p>
          {canDelete && comment.authorId === currentUserId && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(comment.id)}
              className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:text-critical"
              title="Delete comment"
              aria-label="Delete comment"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}

interface ComposerProps {
  onSubmit: (body: string, severity: 'comment' | 'flag') => Promise<void>
  defaultSeverity?: 'comment' | 'flag'
  disabled?: boolean
  /**
   * When false, the "Flag" severity toggle is hidden. Use for cashier
   * self-view at /shifts/my so they can't flag their own shift.
   */
  canFlag?: boolean
  /** Owner-facing display name of the shift owner; appears in confirm copy. */
  shiftOwnerName?: string
}

export const CommentComposer = ({
  onSubmit,
  defaultSeverity = 'comment',
  disabled,
  canFlag = true,
  shiftOwnerName,
}: ComposerProps) => {
  const [body, setBody] = useState('')
  const [severity, setSeverity] = useState<'comment' | 'flag'>(defaultSeverity)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const minChars = severity === 'flag' ? 10 : 1
  const ok = body.trim().length >= minChars

  const requestSubmit = () => {
    if (!ok || submitting) return
    if (severity === 'flag') {
      setConfirming(true)
      return
    }
    void doSubmit()
  }

  const doSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(body.trim(), severity)
      setBody('')
      setSeverity('comment')
      setConfirming(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the comment.')
    } finally {
      setSubmitting(false)
    }
  }

  if (confirming && severity === 'flag') {
    return (
      <div className="rounded-xl border border-critical/50 bg-critical/8 p-3">
        <p className="text-sm font-semibold text-critical">
          Flag {shiftOwnerName ? `${shiftOwnerName}'s` : 'this'} shift?
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Visible to all roles in the audit trail. Permanent unless an Owner clears it. Comment will
          read:
        </p>
        <blockquote className="mt-2 border-l border-critical/40 pl-3 text-[12px] italic text-text/90">
          {body.trim()}
        </blockquote>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={submitting}
            className="rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:text-text"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => void doSubmit()}
            disabled={submitting}
            className="rounded-md bg-critical px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-critical/90 disabled:opacity-50"
          >
            {submitting ? 'Flagging…' : 'Flag shift'}
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs text-critical">{error}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSeverity('comment')}
          className={`rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
            severity === 'comment'
              ? 'bg-text text-base'
              : 'border border-border text-muted hover:text-text'
          }`}
        >
          Comment
        </button>
        {canFlag && (
          <button
            type="button"
            onClick={() => setSeverity('flag')}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              severity === 'flag'
                ? 'bg-critical text-white'
                : 'border border-critical/40 text-critical hover:bg-critical/10'
            }`}
          >
            Flag
          </button>
        )}
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted">
          {severity === 'flag' ? 'Min 10 chars · permanent · all roles' : 'Visible to all roles'}
        </span>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        disabled={disabled || submitting}
        placeholder={
          severity === 'flag'
            ? 'Why is this shift flagged? (e.g. cash diff > ₹500, undocumented refund, missing handover photo)'
            : 'Note for the audit trail. Keep it factual.'
        }
        className="w-full resize-none rounded-md border border-border bg-base/40 p-2 text-sm text-text placeholder:text-muted focus:border-info focus:outline-none focus:ring-1 focus:ring-info"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            requestSubmit()
          }
        }}
      />
      {error && <p className="mt-1.5 text-xs text-critical">{error}</p>}
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span>
          <kbd className="dr-keycap">⌘ ⏎</kbd> to {severity === 'flag' ? 'review flag' : 'submit'}
        </span>
        <button
          type="button"
          onClick={requestSubmit}
          disabled={!ok || submitting || disabled}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
            severity === 'flag'
              ? 'border border-critical/60 bg-transparent text-critical hover:bg-critical/10'
              : 'bg-text text-base hover:bg-text/90'
          }`}
        >
          {severity === 'flag' ? 'Review flag…' : submitting ? 'Saving…' : 'Post comment'}
        </button>
      </div>
    </div>
  )
}
