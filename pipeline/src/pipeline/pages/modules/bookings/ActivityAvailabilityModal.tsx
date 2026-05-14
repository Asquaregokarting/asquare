import { useCallback, useEffect, useMemo, useState } from 'react'
import { listFirestoreActivityCatalog } from '../../../api/activity-catalog-firestore'
import { setActivityAvailability } from '../../../api/activities-firestore'
import {
  listLegacyActivities,
  setLegacyActivityAvailability,
} from '../../../../services/activityService'
import type { Activity } from '../../../../types'
import type { ActivityCatalogRecord, BranchLocationKey } from '../../../api/types'
import type { AdminActor } from '../../../api/asquare-bookings'
import { logger } from '../../../../lib/logger'
import { fmtDateTimeFullIST } from '../../../../lib/date-format'
import {
  isCurrentlyUnavailable,
  type SoftAvailabilityFields,
} from '../../../api/activity-availability'

interface Props {
  actor: AdminActor
  locations: Array<{ id: string; name: string }>
  onClose: () => void
}

// A flag flipped on > STALE_DAYS days ago that has no auto-expire is
// "stale" — likely a forgotten restoration. Surfaced with a badge so
// owners can sweep them. Flags WITH an `until` date aren't stale by
// definition since the system will clean them up.
const STALE_DAYS = 7
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000
const REASON_MAX = 200

const isStale = (sinceIso?: string, untilIso?: string): boolean => {
  if (untilIso) return false
  if (!sinceIso) return false
  const since = new Date(sinceIso).getTime()
  if (!Number.isFinite(since)) return false
  return Date.now() - since > STALE_MS
}

// HTML date input is always YYYY-MM-DD.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Today in YYYY-MM-DD using IST so the date picker's `min` matches the
// timezone we store the auto-restore in (see buildUntilIso).
const todayIstYmd = (): string => {
  const now = new Date()
  const istMs = now.getTime() + (now.getTimezoneOffset() + 330) * 60_000
  return new Date(istMs).toISOString().slice(0, 10)
}

// Build the auto-restore ISO from a YYYY-MM-DD picker value, anchored to
// 23:59:59 IST so the flag clears at end-of-day in the operator's timezone
// regardless of the admin's machine clock. Returns null if the input is
// malformed.
const buildUntilIso = (ymd: string): string | null => {
  if (!DATE_RE.test(ymd)) return null
  const ms = Date.parse(`${ymd}T23:59:59+05:30`)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

type AvailabilityRecord = SoftAvailabilityFields & {
  id: string
  primaryName: string
  secondaryLine: string
  branchLine?: string
}

const toRow = (r: ActivityCatalogRecord): AvailabilityRecord => ({
  id: r.id,
  primaryName: r.bookingName ?? r.name,
  secondaryLine: `${r.category}${r.subcategory ? ` • ${r.subcategory}` : ''}`,
  branchLine:
    r.locationKeys.slice(0, 2).join(', ') +
    (r.locationKeys.length > 2 ? ` +${r.locationKeys.length - 2}` : ''),
  temporarilyUnavailable: r.temporarilyUnavailable,
  temporarilyUnavailableReason: r.temporarilyUnavailableReason,
  temporarilyUnavailableSince: r.temporarilyUnavailableSince,
  temporarilyUnavailableMarkedById: r.temporarilyUnavailableMarkedById,
  temporarilyUnavailableMarkedByName: r.temporarilyUnavailableMarkedByName,
  temporarilyUnavailableUntil: r.temporarilyUnavailableUntil,
})

const toLegacyRow = (a: Activity): AvailabilityRecord => ({
  id: a.id,
  primaryName: a.name,
  secondaryLine: a.category ?? a.gameTypeId ?? '',
  temporarilyUnavailable: a.temporarilyUnavailable,
  temporarilyUnavailableReason: a.temporarilyUnavailableReason,
  temporarilyUnavailableSince: a.temporarilyUnavailableSince,
  temporarilyUnavailableMarkedById: a.temporarilyUnavailableMarkedById,
  temporarilyUnavailableMarkedByName: a.temporarilyUnavailableMarkedByName,
  temporarilyUnavailableUntil: a.temporarilyUnavailableUntil,
})

interface RowProps {
  row: AvailabilityRecord
  showBranch: boolean
  isPending: boolean
  reasonDraft: string
  untilDraft: string
  minUntil: string
  onReasonChange: (id: string, value: string) => void
  onUntilChange: (id: string, value: string) => void
  onToggle: (row: AvailabilityRecord) => void
}

const AvailabilityRow = ({
  row,
  showBranch,
  isPending,
  reasonDraft,
  untilDraft,
  minUntil,
  onReasonChange,
  onUntilChange,
  onToggle,
}: RowProps) => {
  const isUnavailable = isCurrentlyUnavailable(row)
  const since = row.temporarilyUnavailableSince ? new Date(row.temporarilyUnavailableSince) : null
  return (
    <tr className="hover:bg-panel/40">
      <td className="px-3 py-2 align-top">
        <p className="font-medium text-text">{row.primaryName}</p>
        {row.secondaryLine && <p className="text-[11px] text-muted">{row.secondaryLine}</p>}
      </td>
      {showBranch && (
        <td className="px-3 py-2 align-top text-xs text-muted">{row.branchLine ?? '—'}</td>
      )}
      <td className="px-3 py-2 align-top">
        {isUnavailable ? (
          <div className="space-y-1">
            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
              Unavailable
            </span>
            {isStale(row.temporarilyUnavailableSince, row.temporarilyUnavailableUntil) && (
              <span className="block rounded bg-critical/15 px-1.5 py-0.5 text-[11px] font-medium text-critical">
                Stale &gt; {STALE_DAYS}d
              </span>
            )}
          </div>
        ) : (
          <span className="rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-medium text-success">
            Available
          </span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        {isUnavailable ? (
          <div className="text-xs">
            <p className="text-text">{row.temporarilyUnavailableReason || '(no reason)'}</p>
            <p className="text-[11px] text-muted">
              By {row.temporarilyUnavailableMarkedByName ?? '—'}
              {since ? ` · ${fmtDateTimeFullIST(since)}` : ''}
            </p>
            {row.temporarilyUnavailableUntil && (
              <p className="text-[11px] text-info">
                Auto-restores: {fmtDateTimeFullIST(new Date(row.temporarilyUnavailableUntil))}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <input
              type="text"
              placeholder="Reason (required to mark unavailable)"
              value={reasonDraft}
              maxLength={REASON_MAX}
              onChange={(e) => onReasonChange(row.id, e.target.value)}
              className="ui-field min-h-8 w-full text-xs"
            />
            <input
              type="date"
              min={minUntil}
              title="Optional auto-restore date — flag clears after this day (IST). Leave empty for open-ended."
              value={untilDraft}
              onChange={(e) => onUntilChange(row.id, e.target.value)}
              className="ui-field min-h-8 w-full text-xs"
            />
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top text-right">
        <button
          type="button"
          disabled={isPending}
          onClick={() => onToggle(row)}
          className={`ui-btn min-h-8 px-3 py-1 text-[11px] ${
            isUnavailable ? 'ui-btn-success' : 'ui-btn-warning'
          }`}
        >
          {isPending ? 'Saving…' : isUnavailable ? 'Restore' : 'Mark Unavailable'}
        </button>
      </td>
    </tr>
  )
}

const ActivityAvailabilityModal = ({ actor, locations, onClose }: Props) => {
  const [rows, setRows] = useState<ActivityCatalogRecord[]>([])
  const [legacyRows, setLegacyRows] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeLocation, setActiveLocation] = useState<string>('all')
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set())
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({})
  const [untilDraft, setUntilDraft] = useState<Record<string, string>>({})

  const reload = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    try {
      const [hierarchy, legacy] = await Promise.all([
        listFirestoreActivityCatalog(),
        listLegacyActivities(),
      ])
      setRows(hierarchy.filter((r) => r.status === 'Active'))
      // Legacy items: only show those that are otherwise bookable (`available: true`).
      // Permanently-disabled ones aren't relevant for the soft flag.
      setLegacyRows(legacy.filter((a) => a.available))
      return true
    } catch (err) {
      logger.error('activity_availability_modal.load_failed', err)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const ok = await reload()
      if (!ok) setError('Failed to load activity catalog.')
    })()
  }, [reload])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter(
        (r) =>
          activeLocation === 'all' || r.locationKeys.includes(activeLocation as BranchLocationKey),
      )
      .filter((r) =>
        !q
          ? true
          : [r.bookingName, r.name, r.category, r.subcategory]
              .filter(Boolean)
              .some((s) => String(s).toLowerCase().includes(q)),
      )
      .map(toRow)
  }, [rows, search, activeLocation])

  const filteredLegacy = useMemo(() => {
    const q = search.trim().toLowerCase()
    return legacyRows
      .filter((a) =>
        !q
          ? true
          : [a.name, a.category, a.gameTypeId]
              .filter(Boolean)
              .some((s) => String(s).toLowerCase().includes(q)),
      )
      .map(toLegacyRow)
  }, [legacyRows, search])

  const unavailableCount = filtered.filter((r) => isCurrentlyUnavailable(r)).length
  const staleCount = filtered.filter(
    (r) =>
      isCurrentlyUnavailable(r) &&
      isStale(r.temporarilyUnavailableSince, r.temporarilyUnavailableUntil),
  ).length
  const legacyUnavailableCount = filteredLegacy.filter((a) => isCurrentlyUnavailable(a)).length

  const minUntil = useMemo(() => todayIstYmd(), [])

  const handleReasonChange = useCallback((id: string, value: string) => {
    setReasonDraft((d) => ({ ...d, [id]: value }))
  }, [])

  const handleUntilChange = useCallback((id: string, value: string) => {
    setUntilDraft((d) => ({ ...d, [id]: value }))
  }, [])

  const clearDrafts = useCallback((id: string) => {
    setReasonDraft((d) => {
      if (!(id in d)) return d
      const next = { ...d }
      delete next[id]
      return next
    })
    setUntilDraft((d) => {
      if (!(id in d)) return d
      const next = { ...d }
      delete next[id]
      return next
    })
  }, [])

  const runToggle = useCallback(
    async (
      row: AvailabilityRecord,
      writer: (
        id: string,
        params: {
          unavailable: boolean
          reason?: string
          markedById?: string
          markedByName?: string
          until?: string
        },
      ) => Promise<boolean>,
    ) => {
      const turningOn = !isCurrentlyUnavailable(row)
      const reason = (reasonDraft[row.id] ?? '').trim()
      const untilRaw = (untilDraft[row.id] ?? '').trim()
      if (turningOn && !reason) {
        setError('Reason is required when marking unavailable.')
        return
      }
      let untilIso: string | undefined
      if (turningOn && untilRaw) {
        if (untilRaw < minUntil) {
          setError('Until date must be today or later.')
          return
        }
        const built = buildUntilIso(untilRaw)
        if (!built) {
          setError('Until date is invalid.')
          return
        }
        untilIso = built
      }
      setError(null)
      setPendingIds((s) => {
        const next = new Set(s)
        next.add(row.id)
        return next
      })
      let ok = false
      try {
        ok = await writer(row.id, {
          unavailable: turningOn,
          reason: turningOn ? reason : undefined,
          markedById: actor.id,
          markedByName: actor.name,
          until: untilIso,
        })
      } finally {
        setPendingIds((s) => {
          if (!s.has(row.id)) return s
          const next = new Set(s)
          next.delete(row.id)
          return next
        })
      }
      if (!ok) {
        setError(`Failed to update ${row.primaryName}.`)
        return
      }
      clearDrafts(row.id)
      const refreshed = await reload()
      if (!refreshed) {
        setError('Saved. Couldn’t refresh the list — view may be stale.')
      }
    },
    [actor.id, actor.name, clearDrafts, minUntil, reasonDraft, reload, untilDraft],
  )

  const handleHierarchyToggle = useCallback(
    (row: AvailabilityRecord) => {
      void runToggle(row, setActivityAvailability)
    },
    [runToggle],
  )

  const handleLegacyToggle = useCallback(
    (row: AvailabilityRecord) => {
      void runToggle(row, setLegacyActivityAvailability)
    },
    [runToggle],
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-base/70 p-4 pt-10 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-text">Activity Availability</h3>
            <p className="text-xs text-muted">
              Mark games offline temporarily — machine maintenance, staff shortage, weather. Hidden
              from booking surfaces until restored.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-neutral min-h-8 px-3 py-1 text-xs"
          >
            Close
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        )}

        {unavailableCount > 0 && (
          <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            {unavailableCount} activity(ies) currently marked unavailable in this view.
            {staleCount > 0 && (
              <>
                {' '}
                <span className="font-semibold">
                  {staleCount} flagged for &gt; {STALE_DAYS} days — likely forgotten.
                </span>
              </>
            )}
          </p>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity…"
            className="ui-field min-h-9 flex-1 text-sm"
          />
          <select
            value={activeLocation}
            onChange={(e) => setActiveLocation(e.target.value)}
            className="ui-field min-h-9 text-sm"
            title="Filter by branch (hierarchy activities only — legacy items are global)"
          >
            <option value="all">All Branches</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Hierarchy Activities
        </p>
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="min-w-full divide-y divide-border/60 text-sm">
            <thead className="bg-surface/45 text-left text-xs uppercase tracking-[0.08em] text-muted">
              <tr>
                <th className="px-3 py-2">Activity</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Reason / Audit</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/55">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted">
                    No activities match.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <AvailabilityRow
                    key={r.id}
                    row={r}
                    showBranch
                    isPending={pendingIds.has(r.id)}
                    reasonDraft={reasonDraft[r.id] ?? ''}
                    untilDraft={untilDraft[r.id] ?? ''}
                    minUntil={minUntil}
                    onReasonChange={handleReasonChange}
                    onUntilChange={handleUntilChange}
                    onToggle={handleHierarchyToggle}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredLegacy.length > 0 && (
          <>
            <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Legacy Activities (Helicopter, Specials)
              {legacyUnavailableCount > 0 && (
                <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                  {legacyUnavailableCount} unavailable
                </span>
              )}
            </p>
            <p className="mb-2 text-[11px] text-muted">
              These items live in the legacy `activities` collection (helicopter, dayout packages)
              and aren’t branch-scoped — the branch filter above doesn’t apply here. Toggling writes
              the same audit fields and hides them from the customer app.
            </p>
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="min-w-full divide-y divide-border/60 text-sm">
                <thead className="bg-surface/45 text-left text-xs uppercase tracking-[0.08em] text-muted">
                  <tr>
                    <th className="px-3 py-2">Activity</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Reason / Audit</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/55">
                  {filteredLegacy.map((a) => (
                    <AvailabilityRow
                      key={a.id}
                      row={a}
                      showBranch={false}
                      isPending={pendingIds.has(a.id)}
                      reasonDraft={reasonDraft[a.id] ?? ''}
                      untilDraft={untilDraft[a.id] ?? ''}
                      minUntil={minUntil}
                      onReasonChange={handleReasonChange}
                      onUntilChange={handleUntilChange}
                      onToggle={handleLegacyToggle}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default ActivityAvailabilityModal
