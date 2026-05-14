import { useMemo, useState } from 'react'
import { History, Play } from 'lucide-react'
import { useAuth } from '../../../../features/auth/auth-context'
import { isPrivilegedRole } from '../../../../api/firestore-session'
import { useFeedbackCallFilters } from '../../../../features/feedback-calls/useFeedbackCallFilters'
import { useFeedbackCallList } from '../../../../features/feedback-calls/useFeedbackCallList'
import { useFeedbackCallActions } from '../../../../features/feedback-calls/useFeedbackCallActions'
import { FEEDBACK_CALL_STATUS_LABELS } from '../../../../features/feedback-calls/feedback-call-constants'
import { BRANCH_MAP } from '../../../../features/leads/lead-constants'
import type { FeedbackCallRecord, FeedbackCallStatus } from '../../../../api/types'
import FeedbackCallRow from './FeedbackCallRow'
import NextFeedbackCallBanner from './NextFeedbackCallBanner'
import FeedbackCallDetailSlideOver from './FeedbackCallDetailSlideOver'
import FeedbackCallRunModal from './FeedbackCallRunModal'
import type { FeedbackCallOutcome } from './FeedbackCallQuickOutcomeButtons'

type CallSectionTone = 'critical' | 'info' | 'warning' | 'muted' | 'success'

const TONE_DOT: Record<CallSectionTone, string> = {
  critical: 'bg-critical',
  info: 'bg-info',
  warning: 'bg-warning',
  muted: 'bg-muted/60',
  success: 'bg-success',
}

const PRIORITY_SECTIONS: { key: FeedbackCallStatus; label: string; tone: CallSectionTone }[] = [
  { key: 'pending', label: 'Pending', tone: 'critical' },
  { key: 'in_progress', label: 'In Progress', tone: 'info' },
  { key: 'call_later', label: 'Call Later', tone: 'warning' },
  { key: 'no_answer', label: 'No Answer', tone: 'muted' },
  { key: 'completed', label: 'Completed Today', tone: 'success' },
]

const FeedbackCallsInboxView = () => {
  const { session } = useAuth()
  const role = session?.user.role
  const isAdmin = role ? isPrivilegedRole(role) || role === 'Developer' : false

  const { filters, setFilter } = useFeedbackCallFilters()
  const { calls, loading, error, hasMore, loadMore, refresh } = useFeedbackCallList(filters)
  const actions = useFeedbackCallActions(refresh)
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())
  const [lastRunModalOpen, setLastRunModalOpen] = useState(false)
  // Bumped every time the user re-opens the modal so the inner fetch effect
  // re-runs even if the modal was closed and re-opened in the same session.
  const [lastRunModalKey, setLastRunModalKey] = useState(0)

  // Group by status for the priority sections
  const groups = useMemo(() => {
    const buckets: Record<FeedbackCallStatus, FeedbackCallRecord[]> = {
      pending: [],
      in_progress: [],
      call_later: [],
      no_answer: [],
      completed: [],
    }
    for (const call of calls) {
      buckets[call.status].push(call)
    }
    return buckets
  }, [calls])

  // Next call hero — pick the top pending call that hasn't been skipped this session
  const nextCall = useMemo(
    () => groups.pending.find((c) => !skippedIds.has(c.id)) ?? null,
    [groups.pending, skippedIds],
  )

  const completedCount = groups.completed.length
  const pendingCount =
    groups.pending.length +
    groups.in_progress.length +
    groups.call_later.length +
    groups.no_answer.length

  const handleOutcome = (callId: string, outcome: FeedbackCallOutcome, nextAttemptAt?: string) => {
    if (outcome === 'completed') {
      // Open the form in the slide-over — submission happens there
      setSelectedCallId(callId)
      return
    }
    if (outcome === 'no_answer') {
      void actions.markNoAnswer(callId)
      return
    }
    if (outcome === 'call_later') {
      void actions.markCallLater(callId, nextAttemptAt)
    }
  }

  const handleSkip = () => {
    if (nextCall) {
      setSkippedIds((prev) => new Set(prev).add(nextCall.id))
    }
  }

  const handleRunDistribution = async () => {
    await actions.triggerDistribution()
  }

  return (
    <div className="ui-section-stack">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="ui-panel p-3 sm:p-4">
          <p className="font-display text-2xl font-semibold leading-none text-text sm:text-3xl">
            {calls.length}
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted sm:text-[11px]">
            {isAdmin ? 'All Feedback Calls' : 'My Feedback Calls'}
          </p>
        </div>
        <div className="relative rounded-xl border border-critical/35 bg-critical/10 p-3 shadow-sm sm:p-4">
          <p className="font-display text-2xl font-semibold leading-none text-critical sm:text-3xl">
            {pendingCount}
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-critical sm:text-[11px]">
            Pending
          </p>
        </div>
        <div className="relative rounded-xl border border-success/35 bg-success/10 p-3 shadow-sm sm:p-4">
          <p className="font-display text-2xl font-semibold leading-none text-success sm:text-3xl">
            {completedCount}
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-success sm:text-[11px]">
            Completed
          </p>
        </div>
      </div>

      {/* Next-call hero */}
      <NextFeedbackCallBanner
        call={nextCall}
        onOutcome={handleOutcome}
        onSkip={handleSkip}
        busy={actions.busy}
      />

      {/* Toolbar */}
      <div className="ui-toolbar grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <select
          value={filters.status ?? ''}
          onChange={(e) => setFilter('status', e.target.value || undefined)}
          className="ui-field min-h-9 text-xs"
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          {Object.entries(FEEDBACK_CALL_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {isAdmin && (
          <select
            value={filters.branchId ?? ''}
            onChange={(e) => setFilter('branchId', e.target.value || undefined)}
            className="ui-field min-h-9 text-xs"
            aria-label="Filter by branch"
          >
            <option value="">All Branches</option>
            {Object.entries(BRANCH_MAP).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder="Search name or phone..."
          value={filters.search ?? ''}
          onChange={(e) => setFilter('search', e.target.value || undefined)}
          className="ui-field col-span-2 min-h-9 text-xs sm:col-span-1"
        />
        {isAdmin && (
          <button
            type="button"
            disabled={actions.busy}
            onClick={() => void handleRunDistribution()}
            className="ui-btn ui-btn-primary inline-flex min-h-9 items-center gap-1.5 px-3 text-xs"
            title="Manually distribute yesterday's customers to on-shift telecallers"
          >
            <Play size={12} />
            Run Distribution Now
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              setLastRunModalKey((k) => k + 1)
              setLastRunModalOpen(true)
            }}
            className="ui-btn ui-btn-neutral inline-flex min-h-9 items-center gap-1.5 px-3 text-xs"
            title="See the audit log for the most recent distribution run"
          >
            <History size={12} />
            View Last Run
          </button>
        )}
      </div>

      {/* Feedback messages */}
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

      {/* Queue */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Loading feedback calls...</div>
      ) : calls.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-surface/80 px-5 py-10 text-center text-sm text-muted">
          {isAdmin
            ? 'No feedback calls found for the current filters.'
            : 'No feedback calls assigned to you yet. The daily distribution runs at 10:30 IST.'}
        </div>
      ) : (
        <div className="space-y-4">
          {PRIORITY_SECTIONS.map(({ key, label, tone }) => {
            const sectionCalls = groups[key]
            if (sectionCalls.length === 0) return null
            return (
              <div
                key={key}
                className="overflow-hidden rounded-xl border border-border/45 bg-panel shadow-sm"
              >
                <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2.5">
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                    {label} ({sectionCalls.length})
                  </h3>
                </div>
                <div className="divide-y divide-border/30">
                  {sectionCalls.map((call) => (
                    <FeedbackCallRow
                      key={call.id}
                      call={call}
                      onSelect={() => setSelectedCallId(call.id)}
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

      {selectedCallId && (
        <FeedbackCallDetailSlideOver
          callId={selectedCallId}
          onClose={() => setSelectedCallId(null)}
          onMutate={refresh}
        />
      )}

      <FeedbackCallRunModal
        key={lastRunModalKey}
        open={lastRunModalOpen}
        onClose={() => setLastRunModalOpen(false)}
      />
    </div>
  )
}

export default FeedbackCallsInboxView
