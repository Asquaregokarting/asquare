import { useEffect, useState } from 'react'
import { Calendar, Mail, MapPin, Phone, Ticket, X } from 'lucide-react'
import type { SubmitFeedbackPayload } from '../../../../api/types'
import { lookupMemberByPhone, type MemberRecord } from '../../../../api/asquare-members'
import { useFeedbackCallDetail } from '../../../../features/feedback-calls/useFeedbackCallDetail'
import { useFeedbackCallActions } from '../../../../features/feedback-calls/useFeedbackCallActions'
import { formatPhone, relativeTime } from '../../../../features/leads/lead-utils'
import FeedbackCallStatusPill from './FeedbackCallStatusPill'
import FeedbackForm from './FeedbackForm'

interface Props {
  callId: string
  onClose: () => void
  onMutate: () => void
}

const FeedbackCallDetailSlideOver = ({ callId, onClose, onMutate }: Props) => {
  const { call, loading, refresh } = useFeedbackCallDetail(callId)
  const actions = useFeedbackCallActions(() => {
    refresh()
    onMutate()
  })

  const [member, setMember] = useState<MemberRecord | null>(null)
  const [memberLoading, setMemberLoading] = useState(false)

  useEffect(() => {
    const phone = call?.customerPhone
    if (!phone) {
      setMember(null)
      return
    }
    let cancelled = false
    setMemberLoading(true)
    lookupMemberByPhone(phone)
      .then((result) => {
        if (!cancelled) setMember(result)
      })
      .catch(() => {
        if (!cancelled) setMember(null)
      })
      .finally(() => {
        if (!cancelled) setMemberLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [call?.customerPhone])

  if (loading && !call) {
    return (
      <>
        <div
          className="fixed inset-0 z-30 bg-base/65 backdrop-blur-sm sm:hidden"
          onClick={onClose}
        />
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md border-l border-border/70 bg-panel shadow-panel">
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Loading...
          </div>
        </div>
      </>
    )
  }

  if (!call) return null

  const isLocked = call.status === 'completed'

  const handleSubmitFeedback = async (payload: SubmitFeedbackPayload): Promise<boolean> => {
    const result = await actions.submitFeedback(call.id, payload)
    return Boolean(result)
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-base/65 backdrop-blur-sm sm:hidden" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border/70 bg-panel shadow-panel">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/45 px-4 py-3">
          <h2 className="truncate text-lg font-semibold text-text">{call.customerName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted transition hover:text-text"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Customer info */}
          <div className="space-y-2.5 px-4 py-3">
            <div className="flex items-center justify-between">
              <FeedbackCallStatusPill status={call.status} size="sm" />
              {call.callAttempts > 0 && (
                <span className="text-[11px] text-muted">
                  {call.callAttempts} attempt{call.callAttempts === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted">
              <Phone size={14} />
              <a href={`tel:${call.customerPhone}`} className="text-info hover:underline">
                {formatPhone(call.customerPhone)}
              </a>
            </div>
            {call.customerEmail && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Mail size={14} />
                <span className="text-text">{call.customerEmail}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted">
              <MapPin size={14} />
              <span className="text-text">{call.branchName || call.branchId}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted">
              <Calendar size={14} />
              <span className="text-text">Visited {call.visitDate}</span>
            </div>
            <p className="text-[11px] text-muted/80">
              Assigned {relativeTime(call.assignedAt)}
              {call.lastCallAttemptAt
                ? ` · Last attempt ${relativeTime(call.lastCallAttemptAt)}`
                : ''}
            </p>
          </div>

          {/* ₹150 reward coupons (member loyalty balance) */}
          {(memberLoading || member) && (
            <div className="mx-4 mt-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Ticket size={14} className="text-warning" />
                {memberLoading ? (
                  <span className="text-muted">Checking ₹150 coupons…</span>
                ) : member && member.coupons150Available > 0 ? (
                  <span className="text-text">
                    <span className="font-semibold text-warning">{member.coupons150Available}</span>{' '}
                    × ₹150 reward coupon{member.coupons150Available === 1 ? '' : 's'} available
                  </span>
                ) : (
                  <span className="text-muted">No ₹150 reward coupons available</span>
                )}
              </div>
              {member && member.coupons150Available > 0 && (
                <p className="mt-0.5 text-[11px] text-muted">
                  Earned {member.coupons150Earned} · Used {member.coupons150Redeemed} · Redeemable
                  for go-karting only
                </p>
              )}
            </div>
          )}

          {/* Error / success */}
          {actions.error && (
            <div className="mx-4 mb-2 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
              {actions.error}
            </div>
          )}
          {actions.success && (
            <div className="mx-4 mb-2 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
              {actions.success}
            </div>
          )}

          {/* Quick lifecycle actions (hidden when locked) */}
          {!isLocked && (
            <div className="border-t border-border/40 px-4 py-3">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Call Outcome
              </h3>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={actions.busy}
                  onClick={() => void actions.markNoAnswer(call.id)}
                  className="ui-btn ui-btn-warning min-h-8 px-3 py-1.5 text-xs"
                >
                  No Answer
                </button>
                <button
                  type="button"
                  disabled={actions.busy}
                  onClick={() => void actions.markCallLater(call.id)}
                  className="ui-btn ui-btn-info min-h-8 px-3 py-1.5 text-xs"
                >
                  Call Later
                </button>
                {call.status === 'pending' && (
                  <button
                    type="button"
                    disabled={actions.busy}
                    onClick={() => void actions.markInProgress(call.id)}
                    className="ui-btn ui-btn-neutral min-h-8 px-3 py-1.5 text-xs"
                  >
                    Mark In Progress
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Feedback form */}
          <div className="border-t border-border/40 px-4 py-3 pb-6">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              {isLocked ? 'Submitted Feedback' : 'Submit Feedback'}
            </h3>
            <FeedbackForm
              initial={{
                rating: call.rating,
                experience: call.experience,
                issues: call.issues,
                willVisitAgain: call.willVisitAgain,
                feedbackNotes: call.feedbackNotes,
              }}
              busy={actions.busy}
              locked={isLocked}
              onSubmit={handleSubmitFeedback}
            />
            {isLocked && call.feedbackSubmittedAt && (
              <p className="mt-3 text-[11px] text-muted">
                Submitted {relativeTime(call.feedbackSubmittedAt)}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default FeedbackCallDetailSlideOver
