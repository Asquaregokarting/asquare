import type { FeedbackCallStatus, FeedbackIssueCategory, FeedbackRating } from '../../api/types'

// ─── Status Labels ───────────────────────────────────────────────
export const FEEDBACK_CALL_STATUS_LABELS: Record<FeedbackCallStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  no_answer: 'No Answer',
  call_later: 'Call Later',
}

export const FEEDBACK_CALL_STATUS_TONE: Record<
  FeedbackCallStatus,
  { tone: string; color: string }
> = {
  pending: { tone: 'critical', color: 'border-critical/35 bg-critical/10 text-critical' },
  in_progress: { tone: 'info', color: 'border-info/35 bg-info/10 text-info' },
  completed: { tone: 'success', color: 'border-success/35 bg-success/10 text-success' },
  no_answer: { tone: 'muted', color: 'border-muted/35 bg-muted/15 text-muted' },
  call_later: { tone: 'warning', color: 'border-warning/35 bg-warning/10 text-warning' },
}

// ─── Issue Category Labels ───────────────────────────────────────
export const FEEDBACK_ISSUE_LABELS: Record<FeedbackIssueCategory, string> = {
  kart_quality: 'Kart Quality',
  service: 'Service',
  wait_time: 'Wait Time',
  cleanliness: 'Cleanliness',
  pricing: 'Pricing',
  safety: 'Safety',
  other: 'Other',
}

export const FEEDBACK_ISSUE_OPTIONS: FeedbackIssueCategory[] = [
  'kart_quality',
  'service',
  'wait_time',
  'cleanliness',
  'pricing',
  'safety',
  'other',
]

// ─── Rating ──────────────────────────────────────────────────────
export const RATING_OPTIONS: FeedbackRating[] = [1, 2, 3, 4, 5]

/**
 * A feedback submission counts as "negative" when:
 *   - rating is 1 or 2, OR
 *   - the telecaller logged at least one issue.
 *
 * The metrics dashboard uses this to compute the "Negative feedback count"
 * KPI without re-implementing the rule in every consumer.
 */
export const isNegativeFeedback = (rating: number | undefined, issuesCount: number): boolean => {
  if (issuesCount > 0) return true
  if (typeof rating === 'number' && rating <= 2) return true
  return false
}

// ─── Page size ───────────────────────────────────────────────────
export const FEEDBACK_CALLS_PAGE_SIZE = 100

// ─── Constants ───────────────────────────────────────────────────
/** Max length of the experience textarea — enforced at the API layer. */
export const MAX_EXPERIENCE_LENGTH = 1000
/** Max length of the optional internal note. */
export const MAX_FEEDBACK_NOTES_LENGTH = 500
