import { useEffect, useState } from 'react'
import type {
  FeedbackCallIssue,
  FeedbackIssueCategory,
  FeedbackRating,
  SubmitFeedbackPayload,
} from '../../../../api/types'
import {
  FEEDBACK_ISSUE_LABELS,
  FEEDBACK_ISSUE_OPTIONS,
  MAX_EXPERIENCE_LENGTH,
  MAX_FEEDBACK_NOTES_LENGTH,
} from '../../../../features/feedback-calls/feedback-call-constants'
import StarRating from './StarRating'

interface Props {
  /** Pre-fill from an existing record (used in the locked view). */
  initial?: {
    rating?: FeedbackRating
    experience?: string
    issues?: FeedbackCallIssue[]
    willVisitAgain?: boolean
    feedbackNotes?: string
  }
  /** Submit handler. Resolves with `true` on success so the parent can close. */
  onSubmit: (payload: SubmitFeedbackPayload) => Promise<boolean>
  busy: boolean
  /** Read-only mode for completed calls. */
  locked?: boolean
}

const FeedbackForm = ({ initial, onSubmit, busy, locked = false }: Props) => {
  const [rating, setRating] = useState<FeedbackRating | 0>(initial?.rating ?? 0)
  const [experience, setExperience] = useState(initial?.experience ?? '')
  const [issues, setIssues] = useState<Set<FeedbackIssueCategory>>(
    () => new Set((initial?.issues ?? []).map((i) => i.category)),
  )
  const [willVisitAgain, setWillVisitAgain] = useState<boolean | null>(
    typeof initial?.willVisitAgain === 'boolean' ? initial.willVisitAgain : null,
  )
  const [notes, setNotes] = useState(initial?.feedbackNotes ?? '')
  const [validationError, setValidationError] = useState<string | null>(null)

  // Reset state when the initial payload changes (e.g. switching between calls)
  useEffect(() => {
    setRating(initial?.rating ?? 0)
    setExperience(initial?.experience ?? '')
    setIssues(new Set((initial?.issues ?? []).map((i) => i.category)))
    setWillVisitAgain(typeof initial?.willVisitAgain === 'boolean' ? initial.willVisitAgain : null)
    setNotes(initial?.feedbackNotes ?? '')
    setValidationError(null)
  }, [initial])

  const toggleIssue = (category: FeedbackIssueCategory) => {
    setIssues((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const handleSubmit = async () => {
    setValidationError(null)
    if (rating === 0) {
      setValidationError('Please pick a star rating.')
      return
    }
    const trimmedExp = experience.trim()
    if (!trimmedExp) {
      setValidationError('Please write a short note about the experience.')
      return
    }
    if (trimmedExp.length > MAX_EXPERIENCE_LENGTH) {
      setValidationError(`Experience must be ${MAX_EXPERIENCE_LENGTH} characters or fewer.`)
      return
    }
    if (willVisitAgain === null) {
      setValidationError("Please answer 'will visit again?'")
      return
    }
    const payload: SubmitFeedbackPayload = {
      rating: rating as FeedbackRating,
      experience: trimmedExp,
      issues: Array.from(issues).map((category) => ({ category })),
      willVisitAgain,
      feedbackNotes: notes.trim() || undefined,
    }
    await onSubmit(payload)
  }

  return (
    <div className="space-y-3.5">
      {/* Rating */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Rating <span className="text-critical">*</span>
        </label>
        <StarRating
          value={rating}
          onChange={(r) => setRating(r)}
          disabled={locked || busy}
          size="lg"
          label="Customer rating"
        />
      </div>

      {/* Experience */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Experience <span className="text-critical">*</span>
        </label>
        <textarea
          value={experience}
          onChange={(e) => setExperience(e.target.value)}
          disabled={locked || busy}
          rows={3}
          maxLength={MAX_EXPERIENCE_LENGTH}
          placeholder="What did the customer say about their visit?"
          className="ui-field w-full disabled:opacity-70"
        />
        <p className="mt-0.5 text-right text-[10px] text-muted">
          {experience.length}/{MAX_EXPERIENCE_LENGTH}
        </p>
      </div>

      {/* Issues */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Issues (optional)
        </label>
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_ISSUE_OPTIONS.map((category) => {
            const active = issues.has(category)
            return (
              <button
                key={category}
                type="button"
                disabled={locked || busy}
                onClick={() => toggleIssue(category)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? 'border-critical/45 bg-critical/15 text-critical'
                    : 'border-border/60 bg-surface/50 text-muted hover:border-muted/40 hover:text-text'
                }`}
                aria-pressed={active}
              >
                {FEEDBACK_ISSUE_LABELS[category]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Will visit again */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Will visit again? <span className="text-critical">*</span>
        </label>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={locked || busy}
            onClick={() => setWillVisitAgain(true)}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              willVisitAgain === true
                ? 'border-success/50 bg-success/15 text-success'
                : 'border-border/60 bg-surface/50 text-muted hover:border-success/30'
            }`}
            aria-pressed={willVisitAgain === true}
          >
            Yes
          </button>
          <button
            type="button"
            disabled={locked || busy}
            onClick={() => setWillVisitAgain(false)}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              willVisitAgain === false
                ? 'border-critical/50 bg-critical/15 text-critical'
                : 'border-border/60 bg-surface/50 text-muted hover:border-critical/30'
            }`}
            aria-pressed={willVisitAgain === false}
          >
            No
          </button>
        </div>
      </div>

      {/* Internal note */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Internal note (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={locked || busy}
          rows={2}
          maxLength={MAX_FEEDBACK_NOTES_LENGTH}
          placeholder="Notes for Owner / Admin only — not visible to the customer."
          className="ui-field w-full disabled:opacity-70"
        />
        <p className="mt-0.5 text-right text-[10px] text-muted">
          {notes.length}/{MAX_FEEDBACK_NOTES_LENGTH}
        </p>
      </div>

      {/* Validation error */}
      {validationError && (
        <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {validationError}
        </div>
      )}

      {/* Submit button (hidden in locked mode) */}
      {!locked && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleSubmit()}
          className="ui-btn ui-btn-primary w-full"
        >
          {busy ? 'Saving...' : 'Submit Feedback'}
        </button>
      )}
    </div>
  )
}

export default FeedbackForm
