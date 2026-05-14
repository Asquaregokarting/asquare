import { X, Phone, Mail, MapPin, Tag } from 'lucide-react'
import { useLeadDetail } from '../../../features/leads/useLeadDetail'
import { useLeadActions } from '../../../features/leads/useLeadActions'
import { formatPhone, relativeTime } from '../../../features/leads/lead-utils'
import { LEAD_STATUS_LABELS, LEAD_SOURCE_LABELS } from '../../../features/leads/lead-constants'
import LeadScoreBadge from './LeadScoreBadge'
import LeadPresenceIndicator from './LeadPresenceIndicator'
import LeadTimelinePanel from './LeadTimelinePanel'
import LeadFeedbackForm from './LeadFeedbackForm'

interface Props {
  leadId: string
  currentUserId: string
  /** When false, the "Claim Lead" button is hidden (e.g. for telecallers). */
  canClaim?: boolean
  onClose: () => void
  onMutate: () => void
}

const LeadDetailSlideOver = ({
  leadId,
  currentUserId,
  canClaim = true,
  onClose,
  onMutate,
}: Props) => {
  const { lead, loading, timeline, refresh } = useLeadDetail(leadId)
  const actions = useLeadActions(() => {
    refresh()
    onMutate()
  })

  if (loading && !lead) {
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

  if (!lead) return null

  return (
    <>
      <div className="fixed inset-0 z-30 bg-base/65 backdrop-blur-sm sm:hidden" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border/70 bg-panel shadow-panel">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/45 px-4 py-3">
          <h2 className="text-lg font-semibold text-text truncate">{lead.customerName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text transition"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Presence */}
          <div className="px-4 pt-3">
            <LeadPresenceIndicator
              viewedBy={lead.viewedBy}
              viewedAt={lead.viewedAt}
              currentUserId={currentUserId}
            />
          </div>

          {/* Customer Info */}
          <div className="space-y-2.5 px-4 py-3">
            <div className="flex items-center justify-between">
              <LeadScoreBadge score={lead.score} label={lead.scoreLabel} size="md" />
              <span className="ui-pill border-muted/30 bg-muted/15 text-muted text-xs px-2 py-0.5">
                {LEAD_STATUS_LABELS[lead.status]}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted">
              <Phone size={14} />
              <a href={`tel:${lead.customerPhone}`} className="text-info hover:underline">
                {formatPhone(lead.customerPhone)}
              </a>
            </div>
            {lead.customerEmail && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Mail size={14} />
                <span className="text-text">{lead.customerEmail}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted">
              <MapPin size={14} />
              <span className="text-text">{lead.branchName || lead.branchId}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted">
              <Tag size={14} />
              <span className="text-text">{LEAD_SOURCE_LABELS[lead.source] ?? lead.source}</span>
            </div>
            <p className="text-[11px] text-muted/80">
              Created {relativeTime(lead.createdAt)} &middot; Last activity{' '}
              {relativeTime(lead.lastActivityAt)}
            </p>
            {lead.notes && (
              <div className="rounded-lg border border-border/40 bg-surface/50 p-2.5 text-sm text-text">
                {lead.notes}
              </div>
            )}
          </div>

          {/* Error/Success */}
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

          {/* Quick Actions */}
          <div className="border-t border-border/40 px-4 py-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Actions
            </h3>
            {!lead.assignedTo && canClaim && (
              <button
                type="button"
                disabled={actions.busy}
                onClick={() => actions.claimLead(lead.id)}
                className="ui-btn ui-btn-primary w-full mb-3"
              >
                Claim Lead
              </button>
            )}
            <LeadFeedbackForm
              onSubmitStatus={(status, subStatus) =>
                actions.updateStatus(lead.id, status, subStatus).then(() => {})
              }
              onSubmitFeedback={(notes) => actions.submitFeedback(lead.id, notes).then(() => {})}
              onScheduleCallback={(date) => actions.scheduleCallback(lead.id, date).then(() => {})}
              busy={actions.busy}
            />
          </div>

          {/* Timeline */}
          <div className="border-t border-border/40 px-4 py-3">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Activity Timeline
            </h3>
            <LeadTimelinePanel events={timeline.events} loading={timeline.loading} />
          </div>
        </div>
      </div>
    </>
  )
}

export default LeadDetailSlideOver
