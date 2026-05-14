import { memo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { LeadRecord, LeadStatus } from '../../../api/types'
import { LEAD_STATUS_LABELS } from '../../../features/leads/lead-constants'
import LeadCard from './LeadCard'

interface Props {
  status: LeadStatus
  leads: LeadRecord[]
  onCardClick: (lead: LeadRecord) => void
  assigneeNameById?: Map<string, string>
  freshLeadWindowSeconds?: number
}

// Memoized so non-affected columns don't re-render when one card moves.
// Note: callers must pass a stable `onCardClick` reference (use `useCallback`)
// and a stable `assigneeNameById` reference (memoize at the parent) for the
// memo to be effective.
const KanbanColumnImpl = ({
  status,
  leads,
  onCardClick,
  assigneeNameById,
  freshLeadWindowSeconds,
}: Props) => {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[240px] w-64 flex-shrink-0 flex-col rounded-xl border bg-surface/50 transition ${
        isOver ? 'border-accent/60 bg-accent/10' : 'border-border/45'
      }`}
    >
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          {LEAD_STATUS_LABELS[status]}
        </h3>
        <span className="ui-pill border-border/50 bg-surface text-muted text-[10px] px-1.5 py-0.5 font-bold">
          {leads.length}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {leads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onClick={onCardClick}
            assigneeName={lead.assignedTo ? assigneeNameById?.get(lead.assignedTo) : undefined}
            freshLeadWindowSeconds={freshLeadWindowSeconds}
          />
        ))}
        {leads.length === 0 && <p className="py-8 text-center text-xs text-muted/60">No leads</p>}
      </div>
    </div>
  )
}

const KanbanColumn = memo(KanbanColumnImpl)
KanbanColumn.displayName = 'KanbanColumn'

export default KanbanColumn
