import type { FeedbackCallStatus } from '../../../../api/types'
import {
  FEEDBACK_CALL_STATUS_LABELS,
  FEEDBACK_CALL_STATUS_TONE,
} from '../../../../features/feedback-calls/feedback-call-constants'

interface Props {
  // Legacy / migrated rows can carry status values outside the new
  // enum (Superfone-imported rows, Interakt webhook variants). The
  // pill must render something instead of throwing — accessing
  // `.color` on an undefined tone trips the top-level ErrorBoundary
  // and blanks the page, matching the LeadScoreBadge crash class.
  status: FeedbackCallStatus | string | null | undefined
  size?: 'xs' | 'sm'
}

const FALLBACK_TONE = {
  tone: 'muted',
  color: 'border-muted/30 bg-muted/15 text-muted',
}

const FeedbackCallStatusPill = ({ status, size = 'xs' }: Props) => {
  const key = (status ?? '') as FeedbackCallStatus
  const label =
    (status && FEEDBACK_CALL_STATUS_LABELS[key]) ||
    (typeof status === 'string' && status ? status : 'Unknown')
  const tone = (status && FEEDBACK_CALL_STATUS_TONE[key]) || FALLBACK_TONE
  const sizeCls = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-[10px] px-1.5 py-0.5'
  return <span className={`ui-pill ${tone.color} ${sizeCls}`}>{label}</span>
}

export default FeedbackCallStatusPill
