import { useMemo, useState } from 'react'
import { Bell, Phone } from 'lucide-react'
import { useAuth } from '../../../features/auth/auth-context'
import { useLeadFilters } from '../../../features/leads/useLeadFilters'
import { useLeadList } from '../../../features/leads/useLeadList'
import { useLeadActions } from '../../../features/leads/useLeadActions'
import {
  useCallbackReminders,
  requestCallbackNotificationPermission,
} from '../../../features/leads/useCallbackReminders'
import {
  sortLeadsByCallQueue,
  groupByPriority,
  type QueuedLead,
} from '../../../features/leads/lead-queue-sort'
import { formatExactTime, formatPhone, relativeTime } from '../../../features/leads/lead-utils'
import { LEAD_STATUS_LABELS, LEAD_SOURCE_LABELS } from '../../../features/leads/lead-constants'
import type { CallOutcome } from '../../../api/types'
import LeadScoreBadge from './LeadScoreBadge'
import LeadDetailSlideOver from './LeadDetailSlideOver'
import NextCallBanner from './NextCallBanner'
import CallbackAlert from './CallbackAlert'
import QuickOutcomeButtons from './QuickOutcomeButtons'

type PrioritySectionTone = 'critical' | 'warning' | 'info'

const TONE_DOT: Record<PrioritySectionTone, string> = {
  critical: 'bg-critical',
  warning: 'bg-warning',
  info: 'bg-info',
}

const PRIORITY_SECTIONS: {
  key: keyof ReturnType<typeof groupByPriority>
  label: string
  tone: PrioritySectionTone
}[] = [
  { key: 'overdue_callback', label: 'Overdue Callbacks', tone: 'critical' },
  { key: 'upcoming_callback', label: 'Upcoming Callbacks', tone: 'warning' },
  { key: 'hot', label: 'Hot Leads', tone: 'critical' },
  { key: 'warm', label: 'Warm Leads', tone: 'warning' },
  { key: 'cold', label: 'Cold Leads', tone: 'info' },
]

const LeadInboxView = () => {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const { filters, setFilter } = useLeadFilters()
  const myFilters = useMemo(() => ({ ...filters, assignedTo: userId }), [filters, userId])
  const { leads, loading, error, hasMore, loadMore, refresh } = useLeadList(myFilters)
  const actions = useLeadActions(refresh)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())

  // Priority queue
  const sortedLeads = useMemo(() => sortLeadsByCallQueue(leads), [leads])
  const groups = useMemo(() => groupByPriority(sortedLeads), [sortedLeads])

  // Callback reminders
  const { overdueCallbacks } = useCallbackReminders(leads)

  // Next call (skip already-skipped leads)
  const nextCall = useMemo(
    () => sortedLeads.find((l) => !skippedIds.has(l.id)) ?? null,
    [sortedLeads, skippedIds],
  )

  const hotCount = leads.filter((l) => l.scoreLabel === 'hot').length

  const handleOutcome = (leadId: string, outcome: CallOutcome, callbackDate?: string) => {
    void actions.logOutcome(leadId, outcome, callbackDate)
  }

  const handleSkip = () => {
    if (nextCall) {
      setSkippedIds((prev) => new Set(prev).add(nextCall.id))
    }
  }

  return (
    <div className="ui-section-stack">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="ui-panel p-3 sm:p-4">
          <p className="font-display text-2xl sm:text-3xl font-semibold leading-none text-text">
            {leads.length}
          </p>
          <p className="mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            My Leads
          </p>
        </div>
        <div className="relative rounded-xl border border-critical/35 bg-critical/10 p-3 sm:p-4 shadow-sm">
          <p className="font-display text-2xl sm:text-3xl font-semibold leading-none text-critical">
            {hotCount}
          </p>
          <p className="mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-critical">
            Hot
          </p>
        </div>
        <div className="relative rounded-xl border border-warning/35 bg-warning/10 p-3 sm:p-4 shadow-sm">
          <p className="font-display text-2xl sm:text-3xl font-semibold leading-none text-warning">
            {overdueCallbacks.length}
          </p>
          <p className="mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-warning">
            Overdue
          </p>
        </div>
      </div>

      {/* Notification permission prompt */}
      {typeof Notification !== 'undefined' && Notification.permission === 'default' && (
        <button
          type="button"
          onClick={() => void requestCallbackNotificationPermission()}
          className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-info hover:bg-info/10 transition"
        >
          <Bell size={14} />
          Enable notifications for callback reminders
        </button>
      )}

      {/* Callback Alert */}
      <CallbackAlert
        overdueCount={overdueCallbacks.length}
        nextOverdue={overdueCallbacks[0] ?? null}
        onCallNow={(id) => setSelectedLeadId(id)}
      />

      {/* Next Call Banner */}
      <NextCallBanner
        lead={nextCall}
        onOutcome={handleOutcome}
        onSkip={handleSkip}
        busy={actions.busy}
      />

      {/* Filters */}
      <div className="ui-toolbar grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <select
          value={filters.status ?? ''}
          onChange={(e) => setFilter('status', e.target.value || undefined)}
          className="ui-field min-h-9 text-xs"
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          {Object.entries(LEAD_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={filters.scoreLabel ?? ''}
          onChange={(e) => setFilter('scoreLabel', e.target.value || undefined)}
          className="ui-field min-h-9 text-xs"
          aria-label="Filter by score"
        >
          <option value="">All Scores</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
        <input
          type="text"
          placeholder="Search..."
          value={filters.search ?? ''}
          onChange={(e) => setFilter('search', e.target.value || undefined)}
          className="ui-field min-h-9 text-xs col-span-2 sm:col-span-1"
        />
      </div>

      {/* Feedback */}
      {error && (
        <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </div>
      )}
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

      {/* Lead Queue */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Loading your leads...</div>
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-surface/80 px-5 py-10 text-center text-sm text-muted">
          No leads assigned to you
        </div>
      ) : (
        <div className="space-y-4">
          {PRIORITY_SECTIONS.map(({ key, label, tone }) => {
            const sectionLeads = groups[key]
            if (sectionLeads.length === 0) return null

            return (
              <div
                key={key}
                className="overflow-hidden rounded-xl border border-border/45 bg-panel shadow-sm"
              >
                <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2.5">
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                    {label} ({sectionLeads.length})
                  </h3>
                </div>
                <div className="divide-y divide-border/30">
                  {sectionLeads.map((lead) => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      onSelect={() => setSelectedLeadId(lead.id)}
                      onOutcome={handleOutcome}
                      busy={actions.busy}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {hasMore && (
        <div className="text-center">
          <button
            type="button"
            onClick={loadMore}
            className="ui-btn ui-btn-neutral min-h-9 px-4 text-xs"
          >
            Load More
          </button>
        </div>
      )}

      {selectedLeadId && session && (
        <LeadDetailSlideOver
          leadId={selectedLeadId}
          currentUserId={session.user.id}
          canClaim={false}
          onClose={() => setSelectedLeadId(null)}
          onMutate={refresh}
        />
      )}
    </div>
  )
}

// ─── Lead Row ───────────────────────────────────────────────────────

const LeadRow = ({
  lead,
  onSelect,
  onOutcome,
  busy,
}: {
  lead: QueuedLead
  onSelect: () => void
  onOutcome: (leadId: string, outcome: CallOutcome, callbackDate?: string) => void
  busy: boolean
}) => (
  <div className="px-3 py-3 sm:px-4 hover:bg-surface/60 transition">
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 cursor-pointer" onClick={onSelect}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-text truncate">{lead.customerName}</span>
          <LeadScoreBadge score={lead.score} label={lead.scoreLabel} />
          <span className="ui-pill border-muted/30 bg-muted/15 text-muted text-[10px] px-1.5 py-0.5">
            {LEAD_STATUS_LABELS[lead.status]}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          <span>{formatPhone(lead.customerPhone)}</span>
          <span>{LEAD_SOURCE_LABELS[lead.source]}</span>
          <span title={formatExactTime(lead.lastActivityAt)}>
            {relativeTime(lead.lastActivityAt)}
          </span>
          {lead.isCallbackOverdue && lead.callbackScheduledAt && (
            <span
              className="text-critical font-medium"
              title={formatExactTime(lead.callbackScheduledAt)}
            >
              Due {relativeTime(lead.callbackScheduledAt)}
            </span>
          )}
        </div>
      </div>
      <a
        href={`tel:${lead.customerPhone}`}
        className="shrink-0 rounded-lg border border-info/30 bg-info/10 p-2 text-info hover:bg-info/20 transition"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Call ${lead.customerName}`}
      >
        <Phone size={14} />
      </a>
    </div>
    <div className="mt-2 sm:mt-1.5" onClick={(e) => e.stopPropagation()}>
      <QuickOutcomeButtons
        onOutcome={(outcome, callbackDate) => onOutcome(lead.id, outcome, callbackDate)}
        busy={busy}
        compact
      />
    </div>
  </div>
)

export default LeadInboxView
