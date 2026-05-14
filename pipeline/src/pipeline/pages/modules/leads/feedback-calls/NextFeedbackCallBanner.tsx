import { Phone, SkipForward } from 'lucide-react'
import type { FeedbackCallRecord } from '../../../../api/types'
import { formatPhone } from '../../../../features/leads/lead-utils'
import FeedbackCallQuickOutcomeButtons, {
  type FeedbackCallOutcome,
} from './FeedbackCallQuickOutcomeButtons'

interface Props {
  call: FeedbackCallRecord | null
  onOutcome: (callId: string, outcome: FeedbackCallOutcome, nextAttemptAt?: string) => void
  onSkip: () => void
  busy: boolean
}

const NextFeedbackCallBanner = ({ call, onOutcome, onSkip, busy }: Props) => {
  if (!call) return null

  return (
    <div className="rounded-xl border border-info/40 bg-info/5 p-3 sm:p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Next Feedback Call
          </p>
          <h3 className="truncate text-base font-semibold text-text sm:text-lg">
            {call.customerName}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted sm:gap-3">
            <a
              href={`tel:${call.customerPhone}`}
              className="inline-flex items-center gap-1 font-medium text-info hover:underline"
            >
              <Phone size={14} />
              {formatPhone(call.customerPhone)}
            </a>
            <span>{call.branchName || call.branchId}</span>
            <span>Visited {call.visitDate}</span>
          </div>
          {call.callAttempts > 0 && (
            <p className="mt-1 text-xs text-warning">
              {call.callAttempts} previous attempt{call.callAttempts === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
          <a
            href={`tel:${call.customerPhone}`}
            className="ui-btn ui-btn-primary inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 px-4 text-sm sm:flex-none"
          >
            <Phone size={16} />
            Call Now
          </a>
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-text"
          >
            <SkipForward size={12} />
            Skip
          </button>
        </div>
      </div>
      <div className="mt-3 border-t border-border/30 pt-3">
        <FeedbackCallQuickOutcomeButtons
          onOutcome={(outcome, nextAttemptAt) => onOutcome(call.id, outcome, nextAttemptAt)}
          busy={busy}
        />
      </div>
    </div>
  )
}

export default NextFeedbackCallBanner
