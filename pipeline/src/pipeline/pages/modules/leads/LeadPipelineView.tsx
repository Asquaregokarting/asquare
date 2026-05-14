import { useMemo, useState } from 'react'
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { LeadRecord, LeadStatus } from '../../../api/types'
import { useAuth } from '../../../features/auth/auth-context'
import { useLeadFilters } from '../../../features/leads/useLeadFilters'
import { useLeadList } from '../../../features/leads/useLeadList'
import { useLeadActions } from '../../../features/leads/useLeadActions'
import { useTelecallers } from '../../../features/leads/useTelecallers'
import { useLeadConfig } from '../../../features/leads/useLeadConfig'
import {
  KANBAN_COLUMNS,
  BRANCH_MAP,
  LEAD_SOURCE_LABELS,
  DEFAULT_AUTOMATION_CONFIG,
} from '../../../features/leads/lead-constants'
import KanbanColumn from './KanbanColumn'
import LeadDetailSlideOver from './LeadDetailSlideOver'
import LeadCreateForm from './LeadCreateForm'

const LeadPipelineView = () => {
  const { session } = useAuth()
  const { filters, setFilter } = useLeadFilters()
  const { config } = useLeadConfig()
  const pageSize = config?.leadsPageSize ?? DEFAULT_AUTOMATION_CONFIG.leadsPageSize
  const freshWindow =
    config?.freshLeadWindowSeconds ?? DEFAULT_AUTOMATION_CONFIG.freshLeadWindowSeconds
  const { leads, loading, hasMore, loadMore, refresh } = useLeadList(filters, { pageSize })
  const actions = useLeadActions(refresh)
  const { telecallers, nameById: assigneeNameById } = useTelecallers()
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const columns = useMemo(() => {
    const grouped: Record<LeadStatus, LeadRecord[]> = {
      new: [],
      contacted: [],
      interested: [],
      follow_up_pending: [],
      booked: [],
      closed: [],
      lost: [],
    }
    for (const lead of leads) {
      ;(grouped[lead.status] ?? grouped.new).push(lead)
    }
    return grouped
  }, [leads])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const leadId = String(active.id)
    const newStatus = over.id as LeadStatus
    const lead = leads.find((l) => l.id === leadId)
    if (!lead || lead.status === newStatus) return
    void actions.updateStatus(leadId, newStatus)
  }

  return (
    <div className="ui-section-stack">
      {/* Filters */}
      <div className="ui-toolbar grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <select
          aria-label="Filter by branch"
          value={filters.branchId ?? ''}
          onChange={(e) => setFilter('branchId', e.target.value || undefined)}
          className="ui-field min-h-9 text-xs"
        >
          <option value="">All Branches</option>
          {Object.entries(BRANCH_MAP).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by assigned telecaller"
          value={filters.assignedTo ?? ''}
          onChange={(e) => setFilter('assignedTo', e.target.value || undefined)}
          className="ui-field min-h-9 text-xs"
        >
          <option value="">All Telecallers</option>
          {telecallers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by source"
          value={filters.source ?? ''}
          onChange={(e) => setFilter('source', e.target.value || undefined)}
          className="ui-field min-h-9 text-xs"
        >
          <option value="">All Sources</option>
          {Object.entries(LEAD_SOURCE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by score"
          value={filters.scoreLabel ?? ''}
          onChange={(e) => setFilter('scoreLabel', e.target.value || undefined)}
          className="ui-field min-h-9 text-xs"
        >
          <option value="">All Scores</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
        <input
          type="text"
          placeholder="Search name/phone..."
          value={filters.search ?? ''}
          onChange={(e) => setFilter('search', e.target.value || undefined)}
          className="ui-field min-h-9 text-xs col-span-2 sm:col-span-1"
        />
        <button
          type="button"
          onClick={() => setShowCreateForm(true)}
          className="ui-btn ui-btn-primary min-h-9 px-3 text-xs"
        >
          + Create Lead
        </button>
        <button
          type="button"
          disabled={actions.busy}
          onClick={() => actions.recoverAbandonedCarts(filters.branchId)}
          className="ui-btn ui-btn-warning min-h-9 px-3 text-xs"
        >
          Recover Carts
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:flex lg:gap-3">
        {KANBAN_COLUMNS.map((status) => (
          <div key={status} className="ui-panel text-center p-2 sm:p-3 lg:flex-1">
            <p className="text-lg sm:text-2xl font-semibold text-text">
              {columns[status]?.length ?? 0}
            </p>
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-muted truncate">
              {status}
            </p>
          </div>
        ))}
        <div className="ui-panel text-center p-2 sm:p-3 lg:flex-1">
          <p className="text-lg sm:text-2xl font-semibold text-text">{leads.length}</p>
          <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Total
          </p>
        </div>
      </div>

      {/* Feedback */}
      {actions.error && (
        <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {actions.error}
        </div>
      )}
      {actions.success && (
        <div className="rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {actions.success}
        </div>
      )}

      {/* Truncation banner — fires when the page-size ceiling clipped the result set */}
      {!loading && hasMore && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/35 bg-warning/10 px-3 py-2 text-sm text-warning">
          <span>
            Showing the first {leads.length}. More leads match these filters — narrow by branch,
            assignee, score, or source for a focused view.
          </span>
          <button
            type="button"
            onClick={loadMore}
            className="ui-btn ui-btn-warning min-h-9 px-3 text-xs"
          >
            Load more
          </button>
        </div>
      )}

      {/* Kanban Board */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Loading leads...</div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {KANBAN_COLUMNS.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                leads={columns[status] ?? []}
                onCardClick={(lead) => setSelectedLeadId(lead.id)}
                assigneeNameById={assigneeNameById}
                freshLeadWindowSeconds={freshWindow}
              />
            ))}
            <KanbanColumn
              status="lost"
              leads={columns.lost ?? []}
              onCardClick={(lead) => setSelectedLeadId(lead.id)}
              assigneeNameById={assigneeNameById}
              freshLeadWindowSeconds={freshWindow}
            />
          </div>
        </DndContext>
      )}

      {/* Slide-over */}
      {selectedLeadId && session && (
        <LeadDetailSlideOver
          leadId={selectedLeadId}
          currentUserId={session.user.id}
          onClose={() => setSelectedLeadId(null)}
          onMutate={refresh}
        />
      )}

      {/* Create modal */}
      {showCreateForm && (
        <LeadCreateForm
          onSubmit={(payload) => actions.createLead(payload).then(() => {})}
          onClose={() => setShowCreateForm(false)}
          busy={actions.busy}
          defaultBranchId={
            session?.user.allowedLocations?.length === 1
              ? session.user.allowedLocations[0]
              : undefined
          }
        />
      )}
    </div>
  )
}

export default LeadPipelineView
