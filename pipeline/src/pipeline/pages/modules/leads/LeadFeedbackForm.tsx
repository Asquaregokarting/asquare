import { useState } from 'react'
import type { LeadStatus, LeadSubStatus } from '../../../api/types'

interface Props {
  onSubmitStatus: (status: LeadStatus, subStatus?: LeadSubStatus) => Promise<void>
  onSubmitFeedback: (notes: string) => Promise<void>
  onScheduleCallback: (date: string) => Promise<void>
  busy: boolean
}

const STATUS_OPTIONS: Array<{
  status: LeadStatus
  subStatus?: LeadSubStatus
  label: string
  cls: string
}> = [
  { status: 'contacted', label: 'Contacted', cls: 'ui-btn ui-btn-info min-h-8 px-2 py-1 text-xs' },
  {
    status: 'interested',
    label: 'Interested',
    cls: 'ui-btn ui-btn-success min-h-8 px-2 py-1 text-xs',
  },
  {
    status: 'follow_up_pending',
    label: 'Follow-up',
    cls: 'ui-btn min-h-8 px-2 py-1 text-xs bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400',
  },
  {
    status: 'contacted',
    subStatus: 'no_answer',
    label: 'No Answer',
    cls: 'ui-btn ui-btn-warning min-h-8 px-2 py-1 text-xs',
  },
  {
    status: 'contacted',
    subStatus: 'not_interested',
    label: 'Not Interested',
    cls: 'ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs',
  },
  {
    status: 'contacted',
    subStatus: 'wrong_number',
    label: 'Wrong Number',
    cls: 'ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs',
  },
  {
    status: 'booked',
    label: 'Booked!',
    cls: 'ui-btn ui-btn-success min-h-8 px-2 py-1 text-xs font-bold',
  },
  { status: 'lost', label: 'Lost', cls: 'ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs' },
]

const LeadFeedbackForm = ({
  onSubmitStatus,
  onSubmitFeedback,
  onScheduleCallback,
  busy,
}: Props) => {
  const [notes, setNotes] = useState('')
  const [callbackDate, setCallbackDate] = useState('')

  const handleStatusClick = async (status: LeadStatus, subStatus?: LeadSubStatus) => {
    await onSubmitStatus(status, subStatus)
    if (notes.trim()) {
      await onSubmitFeedback(notes.trim())
      setNotes('')
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Quick Status
        </label>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={`${opt.status}-${opt.subStatus ?? ''}`}
              type="button"
              disabled={busy}
              onClick={() => handleStatusClick(opt.status, opt.subStatus)}
              className={opt.cls}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Add call notes..."
          className="ui-field w-full"
        />
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Schedule Callback
          </label>
          <input
            type="datetime-local"
            value={callbackDate}
            onChange={(e) => setCallbackDate(e.target.value)}
            className="ui-field w-full"
          />
        </div>
        <button
          type="button"
          disabled={busy || !callbackDate}
          onClick={async () => {
            if (callbackDate) {
              await onScheduleCallback(new Date(callbackDate).toISOString())
              setCallbackDate('')
            }
          }}
          className="ui-btn ui-btn-info min-h-10 px-3 text-xs"
        >
          Schedule
        </button>
      </div>
    </div>
  )
}

export default LeadFeedbackForm
