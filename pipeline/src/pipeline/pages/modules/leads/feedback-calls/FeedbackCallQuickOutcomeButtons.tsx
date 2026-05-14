import { useState } from 'react'
import { CheckCircle, Clock, PhoneMissed } from 'lucide-react'

export type FeedbackCallOutcome = 'completed' | 'no_answer' | 'call_later'

interface Props {
  /**
   * `completed` is a request to OPEN the feedback form (the row component
   * is responsible for that). `no_answer` and `call_later` are direct
   * status transitions handled inside `useFeedbackCallActions`.
   */
  onOutcome: (outcome: FeedbackCallOutcome, nextAttemptAt?: string) => void
  busy: boolean
  /** Compact mode is used inside list rows; full size in the hero banner. */
  compact?: boolean
}

const FeedbackCallQuickOutcomeButtons = ({ onOutcome, busy, compact = false }: Props) => {
  const [showLaterPicker, setShowLaterPicker] = useState(false)
  const [laterDate, setLaterDate] = useState('')

  const btnBase = compact
    ? 'inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition disabled:opacity-40'
    : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition disabled:opacity-40'
  const iconSize = compact ? 12 : 16

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => onOutcome('completed')}
        className={`${btnBase} border border-success/40 bg-success/10 text-success hover:bg-success/20`}
      >
        <CheckCircle size={iconSize} />
        Completed
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onOutcome('no_answer')}
        className={`${btnBase} border border-warning/40 bg-warning/10 text-warning hover:bg-warning/20`}
      >
        <PhoneMissed size={iconSize} />
        No Answer
      </button>
      {!showLaterPicker ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setShowLaterPicker(true)}
          className={`${btnBase} border border-info/40 bg-info/10 text-info hover:bg-info/20`}
        >
          <Clock size={iconSize} />
          Call Later
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            type="datetime-local"
            value={laterDate}
            onChange={(e) => setLaterDate(e.target.value)}
            className="ui-field min-h-8 text-xs"
            min={new Date().toISOString().slice(0, 16)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onOutcome('call_later', laterDate ? new Date(laterDate).toISOString() : undefined)
              setShowLaterPicker(false)
              setLaterDate('')
            }}
            className={`${btnBase} border border-info/40 bg-info/15 text-info hover:bg-info/25`}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => {
              setShowLaterPicker(false)
              setLaterDate('')
            }}
            className="text-xs text-muted hover:text-text"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

export default FeedbackCallQuickOutcomeButtons
