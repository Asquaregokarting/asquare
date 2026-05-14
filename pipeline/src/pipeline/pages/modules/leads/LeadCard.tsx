import { memo } from 'react'
import type { LeadRecord } from '../../../api/types'
import { formatExactTime, formatPhone, relativeTime } from '../../../features/leads/lead-utils'
import { LEAD_SOURCE_LABELS } from '../../../features/leads/lead-constants'
import ElectricBorder from '../../../components/ui/ElectricBorder'
import LeadScoreBadge from './LeadScoreBadge'

interface Props {
  lead: LeadRecord
  onClick: (lead: LeadRecord) => void
  assigneeName?: string
  /** Window in seconds during which a newly created lead shows the animated border. 0 disables. */
  freshLeadWindowSeconds?: number
}

const DEFAULT_FRESH_WINDOW_SEC = 60

const isFreshLead = (createdAt: string, windowSec: number): boolean => {
  if (windowSec <= 0) return false
  const ms = Date.now() - new Date(createdAt).getTime()
  return ms >= 0 && ms < windowSec * 1000
}

// Memoized so the kanban board doesn't re-render every card when an unrelated
// drag/select happens at the parent level. With 200-500 cards on a typical
// pipeline view, this drops the per-interaction cost from O(n) to O(1).
const LeadCardImpl = ({ lead, onClick, assigneeName, freshLeadWindowSeconds }: Props) => {
  const assigneeLabel = lead.assignedTo ? (assigneeName ?? `${lead.assignedTo.slice(0, 6)}…`) : null
  const freshWindow = freshLeadWindowSeconds ?? DEFAULT_FRESH_WINDOW_SEC
  const fresh = isFreshLead(lead.createdAt, freshWindow)

  const card = (
    <button
      type="button"
      onClick={() => onClick(lead)}
      className="w-full rounded-xl border border-border/45 bg-panel p-3 text-left shadow-sm transition hover:shadow-md hover:border-info/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">{lead.customerName}</p>
          <p className="text-xs text-muted">{formatPhone(lead.customerPhone)}</p>
        </div>
        <LeadScoreBadge score={lead.score} label={lead.scoreLabel} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        <span className="truncate">{LEAD_SOURCE_LABELS[lead.source] ?? lead.source}</span>
        <span>&middot;</span>
        <span title={formatExactTime(lead.lastActivityAt)}>
          {relativeTime(lead.lastActivityAt)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        {fresh && (
          <span className="ui-pill text-[10px] px-1.5 py-0.5 font-semibold uppercase tracking-[0.06em] border-[#FF6B00]/45 bg-[#FF6B00]/10 text-[#FF6B00]">
            New
          </span>
        )}
        {assigneeLabel ? (
          <span className="ui-pill border-info/30 bg-info/10 text-info text-[10px] px-1.5 py-0.5 truncate">
            {assigneeLabel}
          </span>
        ) : (
          <span className="ui-pill border-warning/35 bg-warning/10 text-warning text-[10px] px-1.5 py-0.5 font-semibold uppercase tracking-[0.06em]">
            Unassigned
          </span>
        )}
        {lead.subStatus && (
          <span className="ui-pill border-muted/30 bg-muted/15 text-muted text-[10px] px-1.5 py-0.5 truncate">
            {lead.subStatus.replace(/_/g, ' ')}
          </span>
        )}
      </div>
    </button>
  )

  if (!fresh) return card

  return (
    <ElectricBorder color="#FF6B00" speed={1.6} chaos={0.18} borderRadius={12}>
      {card}
    </ElectricBorder>
  )
}

const LeadCard = memo(LeadCardImpl)
LeadCard.displayName = 'LeadCard'

export default LeadCard
