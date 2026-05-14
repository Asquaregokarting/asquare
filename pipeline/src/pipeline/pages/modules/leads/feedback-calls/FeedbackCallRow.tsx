import { Phone } from 'lucide-react'
import type { FeedbackCallRecord } from '../../../../api/types'
import { formatPhone, relativeTime } from '../../../../features/leads/lead-utils'
import FeedbackCallStatusPill from './FeedbackCallStatusPill'
import FeedbackCallQuickOutcomeButtons, {
  type FeedbackCallOutcome,
} from './FeedbackCallQuickOutcomeButtons'
import StarRating from './StarRating'

interface Props {
  call: FeedbackCallRecord
  onSelect: () => void
  onOutcome: (callId: string, outcome: FeedbackCallOutcome, nextAttemptAt?: string) => void
  busy: boolean
}

const FeedbackCallRow = ({ call, onSelect, onOutcome, busy }: Props) => {
  const isCompleted = call.status === 'completed'
  return (
    <div className="px-3 py-3 sm:px-4 hover:bg-surface/60 transition">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left"
          aria-label={`Open feedback call for ${call.customerName}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-text">{call.customerName}</span>
            <FeedbackCallStatusPill status={call.status} />
            {isCompleted && typeof call.rating === 'number' && (
              <StarRating value={call.rating} size="sm" />
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            <span>{formatPhone(call.customerPhone)}</span>
            <span>{call.branchName || call.branchId}</span>
            <span>Visited {call.visitDate}</span>
            {call.callAttempts > 0 && (
              <span className="text-warning">
                {call.callAttempts} attempt{call.callAttempts === 1 ? '' : 's'}
              </span>
            )}
            {call.nextAttemptAt && (
              <span className="text-info">Next {relativeTime(call.nextAttemptAt)}</span>
            )}
          </div>
        </button>
        <a
          href={`tel:${call.customerPhone}`}
          className="shrink-0 rounded-lg border border-info/30 bg-info/10 p-2 text-info hover:bg-info/20 transition"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Call ${call.customerName}`}
        >
          <Phone size={14} />
        </a>
      </div>
      {!isCompleted && (
        <div className="mt-2 sm:mt-1.5" onClick={(e) => e.stopPropagation()}>
          <FeedbackCallQuickOutcomeButtons
            onOutcome={(outcome, nextAttemptAt) => onOutcome(call.id, outcome, nextAttemptAt)}
            busy={busy}
            compact
          />
        </div>
      )}
    </div>
  )
}

export default FeedbackCallRow
