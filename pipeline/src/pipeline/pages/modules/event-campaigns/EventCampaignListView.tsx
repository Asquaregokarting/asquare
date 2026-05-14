import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { useLocations } from '../../../hooks/useLocations'
import {
  listEventCampaigns,
  updateEventCampaign,
  deleteEventCampaign,
} from '../../../features/event-campaigns/event-campaigns-firestore'
import type {
  EventCampaignRecord,
  EventCampaignStatus,
} from '../../../features/event-campaigns/event-campaign-types'
import { RowMoreMenu, type MoreMenuItem } from '../bookings/RowMoreMenu'

/**
 * Today's date (YYYY-MM-DD) in IST, matching the customer-side
 * `listActiveEventsForLocation` filter which uses local timezone.
 */
const istToday = (): string => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date())
}

const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const daysBetween = (a: string, b: string): number => {
  const ad = new Date(`${a}T00:00:00Z`).getTime()
  const bd = new Date(`${b}T00:00:00Z`).getTime()
  return Math.max(0, Math.round((bd - ad) / 86400000))
}

const fmtShortDate = (iso: string): string => {
  if (!iso || iso.length < 10) return iso || '—'
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

interface DateHint {
  hint: string
  tone: 'success' | 'warning' | 'critical' | 'muted'
}

/**
 * Translates a [start, end] window against today into a single short
 * relative-time hint, plus the tone the auditor's eye should pick up
 * (warning when about to drop off, critical when ended).
 */
const dateHint = (start: string, end: string, today: string): DateHint => {
  if (!start || !end) return { hint: '', tone: 'muted' }
  if (start > today) {
    const d = daysBetween(today, start)
    return { hint: d === 0 ? 'starts today' : `starts in ${d}d`, tone: 'muted' }
  }
  if (end < today) {
    const d = daysBetween(end, today)
    return { hint: d === 0 ? 'ended today' : `ended ${d}d ago`, tone: 'critical' }
  }
  const remaining = daysBetween(today, end)
  return {
    hint: remaining === 0 ? 'ends today' : `${remaining}d left`,
    tone: remaining <= 3 ? 'warning' : 'success',
  }
}

/** Human-readable reasons an event is hidden from the Activities page. */
const visibilityIssues = (c: EventCampaignRecord, today: string): string[] => {
  const issues: string[] = []
  if (c.status !== 'active') issues.push('not active')
  if (!c.applicability?.showOnline) issues.push('showOnline off')
  const pkgCount = c.packages?.length ?? 0
  const gameCount = c.games?.length ?? 0
  if (pkgCount === 0 && gameCount === 0) issues.push('no games/packages')
  // Pre-start events are intentionally bookable — don't flag them.
  if (c.endDate && today > c.endDate) issues.push('already ended')
  return issues
}

interface RowState {
  /** Active + no visibility issues = customer-facing live. */
  isLive: boolean
  /** status === 'active' but at least one visibility issue. The loudest
   * signal on this surface — the user thinks it's running, it isn't. */
  isHiddenConfig: boolean
  /** Past end date or status === 'ended'. */
  isEnded: boolean
  /** status === 'inactive' (and not ended). */
  isInactive: boolean
  /** Today is before startDate. */
  isUpcoming: boolean
}

const classify = (c: EventCampaignRecord, today: string): RowState => {
  const issues = visibilityIssues(c, today)
  const isEnded = c.status === 'ended' || (!!c.endDate && c.endDate < today)
  const isUpcoming = !!c.startDate && c.startDate > today
  const isLive = c.status === 'active' && issues.length === 0
  const isHiddenConfig = c.status === 'active' && issues.length > 0 && !isEnded
  const isInactive = c.status === 'inactive' && !isEnded
  return { isLive, isHiddenConfig, isEnded, isInactive, isUpcoming }
}

const StateLine = ({
  total,
  active,
  live,
  hidden,
  upcoming,
  ended,
}: {
  total: number
  active: number
  live: number
  hidden: number
  upcoming: number
  ended: number
}) => {
  const Pair = ({
    label,
    value,
    tone,
    emphasis,
  }: {
    label: string
    value: number
    tone: 'neutral' | 'success' | 'warning' | 'critical'
    emphasis: boolean
  }) => {
    const toneClass =
      tone === 'critical'
        ? emphasis
          ? 'text-critical font-semibold'
          : 'text-muted'
        : tone === 'warning'
          ? emphasis
            ? 'text-warning font-semibold'
            : 'text-muted'
          : tone === 'success'
            ? emphasis
              ? 'text-success font-medium'
              : 'text-muted'
            : 'text-text font-medium'
    return (
      <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-xs uppercase tracking-[0.08em] text-muted">{label}</span>
        <span className={`text-sm tabular-nums ${toneClass}`}>{value}</span>
      </span>
    )
  }
  return (
    <div
      role="status"
      aria-label="Event campaign summary"
      className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-1 text-sm"
    >
      <Pair label="Total" value={total} tone="neutral" emphasis />
      <Pair label="Active" value={active} tone="success" emphasis={active > 0} />
      <Pair label="Live" value={live} tone="success" emphasis={live > 0} />
      <Pair label="Hidden" value={hidden} tone="warning" emphasis={hidden > 0} />
      <Pair label="Upcoming" value={upcoming} tone="neutral" emphasis />
      <Pair label="Ended" value={ended} tone="critical" emphasis={ended > 0} />
    </div>
  )
}

const Workbench = ({
  statusFilter,
  setStatusFilter,
  locationFilter,
  setLocationFilter,
  searchTerm,
  setSearchTerm,
  locations,
  onCreate,
  onRefresh,
}: {
  statusFilter: EventCampaignStatus | ''
  setStatusFilter: (v: EventCampaignStatus | '') => void
  locationFilter: string
  setLocationFilter: (v: string) => void
  searchTerm: string
  setSearchTerm: (v: string) => void
  locations: Array<{ slug: string; shortName: string }>
  onCreate: () => void
  onRefresh: () => void
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <select
      value={statusFilter}
      onChange={(e) => setStatusFilter(e.target.value as EventCampaignStatus | '')}
      aria-label="Filter by status"
      className="ui-field min-h-9 text-xs"
    >
      <option value="">All statuses</option>
      <option value="active">Active</option>
      <option value="inactive">Inactive</option>
      <option value="ended">Ended</option>
    </select>
    <select
      value={locationFilter}
      onChange={(e) => setLocationFilter(e.target.value)}
      aria-label="Filter by location"
      className="ui-field min-h-9 text-xs"
    >
      <option value="">All locations</option>
      {locations.map((l) => (
        <option key={l.slug} value={l.slug}>
          {l.shortName}
        </option>
      ))}
    </select>
    <div className="relative flex-1 min-w-[200px]">
      <input
        type="search"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search title, description…"
        aria-label="Search campaigns"
        className="ui-field min-h-9 w-full pl-8 text-sm"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
      >
        ⌕
      </span>
    </div>
    <button
      type="button"
      onClick={onRefresh}
      aria-label="Refresh"
      title="Refresh"
      className="ui-btn ui-btn-neutral min-h-9 px-2.5 py-1.5 text-base"
    >
      ↻
    </button>
    <button
      type="button"
      onClick={onCreate}
      className="ui-btn ui-btn-primary min-h-9 px-3 py-1.5 text-xs"
    >
      + Create event
    </button>
  </div>
)

const VisibilityCell = ({ state, issues }: { state: RowState; issues: string[] }) => {
  if (state.isLive) {
    return (
      <span className="ui-pill border-success/55 bg-success/12 text-success">
        Live on Activities
      </span>
    )
  }
  if (state.isHiddenConfig) {
    return (
      <div className="space-y-1">
        <span className="ui-pill border-warning/55 bg-warning/12 text-warning">Hidden</span>
        <p
          className="text-[10px] text-warning"
          title={`Hidden from Activities: ${issues.join(', ')}`}
        >
          {issues.join(' · ')}
        </p>
      </div>
    )
  }
  if (state.isEnded) {
    return <span className="ui-pill border-border/55 bg-panel text-muted">Ended</span>
  }
  if (state.isInactive) {
    return <span className="ui-pill border-border/55 bg-panel text-muted">Inactive</span>
  }
  if (state.isUpcoming) {
    return <span className="ui-pill border-info/55 bg-info/12 text-info">Upcoming</span>
  }
  return <span className="ui-pill border-border/55 bg-panel text-muted">—</span>
}

const EmptyState = ({
  hasFilters,
  onCreate,
  onClear,
}: {
  hasFilters: boolean
  onCreate: () => void
  onClear: () => void
}) => (
  <div className="flex flex-col items-center gap-3 rounded-xl border border-border/45 bg-panel/60 px-6 py-14 text-center">
    {hasFilters ? (
      <>
        <p className="text-sm font-medium text-text">No campaigns match these filters.</p>
        <p className="max-w-sm text-xs text-muted">
          Try clearing the status, location, or search filter.
        </p>
        <button
          type="button"
          onClick={onClear}
          className="ui-btn ui-btn-neutral min-h-9 px-3 text-xs"
        >
          Clear filters
        </button>
      </>
    ) : (
      <>
        <p className="text-sm font-medium text-text">No event campaigns yet.</p>
        <p className="max-w-sm text-xs text-muted">
          Create your first campaign to start showing offers on the customer Activities page.
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="ui-btn ui-btn-primary min-h-9 px-4 text-xs"
        >
          + Create event
        </button>
      </>
    )}
  </div>
)

const EventCampaignListView = () => {
  const navigate = useNavigate()
  const { enabledLocations } = useLocations()
  const [campaigns, setCampaigns] = useState<EventCampaignRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<EventCampaignStatus | ''>('')
  const [locationFilter, setLocationFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<EventCampaignRecord | null>(null)

  const today = istToday()

  const locationNameMap = useMemo(
    () => new Map(enabledLocations.map((l) => [l.slug, l.shortName])),
    [enabledLocations],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listEventCampaigns()
      setCampaigns(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load event campaigns.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    let result = campaigns
    if (statusFilter) result = result.filter((c) => c.status === statusFilter)
    if (locationFilter) result = result.filter((c) => c.locationKeys.includes(locationFilter))
    const q = searchTerm.trim().toLowerCase()
    if (q) {
      result = result.filter(
        (c) => c.title.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q),
      )
    }
    return result
  }, [campaigns, statusFilter, locationFilter, searchTerm])

  const stats = useMemo(() => {
    let active = 0
    let live = 0
    let hidden = 0
    let upcoming = 0
    let ended = 0
    for (const c of campaigns) {
      const s = classify(c, today)
      if (c.status === 'active') active++
      if (s.isLive) live++
      if (s.isHiddenConfig) hidden++
      if (s.isUpcoming) upcoming++
      if (s.isEnded) ended++
    }
    return { active, live, hidden, upcoming, ended }
  }, [campaigns, today])

  const handleToggle = async (campaign: EventCampaignRecord) => {
    const next: EventCampaignStatus = campaign.status === 'active' ? 'inactive' : 'active'
    try {
      await updateEventCampaign(campaign.id, { status: next })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle status.')
    }
  }

  /**
   * Force-publish: flip every switch the customer Activities page checks.
   * status=active, showOnline=true, enableInBooking/Billing true; fills
   * locationKeys with all enabled branches if empty; extends endDate if
   * it's already in the past. Does NOT touch packages — those need real
   * input.
   */
  const handlePublish = async (campaign: EventCampaignRecord) => {
    try {
      const locationKeys =
        campaign.locationKeys.length > 0
          ? campaign.locationKeys
          : enabledLocations.map((l) => l.slug)
      const endFallback = addDays(today, 14)
      const endDate = campaign.endDate && campaign.endDate >= today ? campaign.endDate : endFallback
      await updateEventCampaign(campaign.id, {
        status: 'active',
        locationKeys,
        endDate,
        applicability: {
          ...(campaign.applicability ?? {
            showOnline: true,
            enableInBooking: true,
            enableInBilling: true,
          }),
          showOnline: true,
          enableInBooking: true,
          enableInBilling: true,
        },
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish event.')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteEventCampaign(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event.')
    }
  }

  const clearFilters = () => {
    setStatusFilter('')
    setLocationFilter('')
    setSearchTerm('')
  }

  const hasFilters = statusFilter !== '' || locationFilter !== '' || searchTerm.trim() !== ''

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      )}

      {!loading && campaigns.length > 0 && (
        <StateLine
          total={campaigns.length}
          active={stats.active}
          live={stats.live}
          hidden={stats.hidden}
          upcoming={stats.upcoming}
          ended={stats.ended}
        />
      )}

      <Workbench
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        locationFilter={locationFilter}
        setLocationFilter={setLocationFilter}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        locations={enabledLocations}
        onCreate={() => navigate('/event-campaigns/create')}
        onRefresh={() => void load()}
      />

      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading events…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          hasFilters={hasFilters}
          onCreate={() => navigate('/event-campaigns/create')}
          onClear={clearFilters}
        />
      ) : (
        <div className="rounded-xl border border-border/60 bg-panel/60">
          <table className="w-full table-fixed divide-y divide-border/60 text-sm">
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[16%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface text-left text-xs uppercase tracking-[0.08em] text-muted">
              <tr>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Locations</th>
                <th className="px-3 py-2">Dates</th>
                <th className="px-3 py-2">Visibility</th>
                <th className="px-3 py-2 text-right">Packages</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/55">
              {filtered.map((c) => {
                const issues = visibilityIssues(c, today)
                const state = classify(c, today)
                const rowClass = state.isLive
                  ? 'bg-success/4 hover:bg-success/8'
                  : state.isHiddenConfig
                    ? 'bg-warning/8 hover:bg-warning/12'
                    : state.isEnded
                      ? 'opacity-70 hover:opacity-90 hover:bg-panel/40'
                      : 'hover:bg-panel/40'

                const visibleLocs = c.locationKeys.slice(0, 2)
                const extraLocs = c.locationKeys.length - visibleLocs.length
                const allLocsLabel = c.locationKeys
                  .map((k) => locationNameMap.get(k) ?? k)
                  .join(', ')

                const hint = dateHint(c.startDate, c.endDate, today)
                const hintTone =
                  hint.tone === 'critical'
                    ? 'text-critical'
                    : hint.tone === 'warning'
                      ? 'text-warning'
                      : hint.tone === 'success'
                        ? 'text-success'
                        : 'text-muted'

                const packageCount = c.packages?.length ?? 0
                const legacyGameCount = c.games?.length ?? 0

                const moreItems: MoreMenuItem[] = []
                moreItems.push({
                  label: 'Edit',
                  title: 'Edit event details, packages, locations, applicability',
                  onClick: () => navigate(`/event-campaigns/edit/${c.id}`),
                })
                if (state.isHiddenConfig) {
                  moreItems.push({
                    label: 'Force-publish',
                    title: `Activate, show online, enable in booking/billing, fill locations. Remaining: ${issues.join(', ')}`,
                    onClick: () => void handlePublish(c),
                  })
                }
                moreItems.push({
                  label: c.status === 'active' ? 'Deactivate' : 'Activate',
                  title:
                    c.status === 'active'
                      ? 'Deactivate this campaign so it stops showing on the customer Activities page'
                      : 'Reactivate this campaign',
                  onClick: () => void handleToggle(c),
                })
                moreItems.push({
                  label: 'Delete',
                  title: 'Permanently delete this campaign',
                  onClick: () => setDeleteTarget(c),
                  danger: true,
                })

                return (
                  <tr key={c.id} className={rowClass}>
                    <td className="px-3 py-2 align-top">
                      <p className="truncate text-sm font-semibold text-text" title={c.title}>
                        {c.title}
                      </p>
                      <p
                        className="truncate text-xs text-muted"
                        title={c.description || 'No description'}
                      >
                        {c.description || 'No description'}
                      </p>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap items-center gap-1" title={allLocsLabel}>
                        {visibleLocs.map((k) => (
                          <span
                            key={k}
                            className="rounded-full border border-border/55 bg-panel px-2 py-0.5 text-[10px] font-medium text-muted"
                          >
                            {locationNameMap.get(k) ?? k}
                          </span>
                        ))}
                        {extraLocs > 0 && (
                          <span className="rounded-full border border-border/55 bg-panel px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted">
                            +{extraLocs}
                          </span>
                        )}
                        {c.locationKeys.length === 0 && (
                          <span className="text-[10px] text-muted">No locations</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <p className="text-xs tabular-nums text-text">
                        {fmtShortDate(c.startDate)} → {fmtShortDate(c.endDate)}
                      </p>
                      {hint.hint && (
                        <p className={`text-[10px] tabular-nums ${hintTone}`}>{hint.hint}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <VisibilityCell state={state} issues={issues} />
                    </td>
                    <td className="px-3 py-2 align-top text-right text-xs tabular-nums text-muted">
                      {packageCount > 0
                        ? packageCount
                        : legacyGameCount > 0
                          ? `${legacyGameCount} (legacy)`
                          : '—'}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <RowMoreMenu items={moreItems} label="Campaign actions" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Event Campaign"
        description={`Permanently delete "${deleteTarget?.title ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

export default EventCampaignListView
