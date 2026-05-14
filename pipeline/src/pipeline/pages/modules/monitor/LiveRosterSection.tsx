import { useEffect, useMemo, useState } from 'react'
import { branchIdToDisplayName } from '../../../../lib/locations'
import {
  mergeMonitorRoster,
  type MonitorRosterEntry,
  type MonitorShiftStatus,
  type MonitorWebStatus,
} from '../../../features/monitor/monitor-data'
import type { ShiftRecord } from '../../../api/shifts'
import type { StaffPresenceRecord, UserRecord } from '../../../api/types'

const TICK_INTERVAL_MS = 30_000

function formatHHmm(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatElapsed(iso: string | undefined, nowMs: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const mins = Math.max(0, Math.round((nowMs - t) / 60_000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

const SHIFT_PILL: Record<MonitorShiftStatus, { label: string; className: string }> = {
  active: {
    label: 'On shift',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  },
  on_break: {
    label: 'On break',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  },
  completed: {
    label: 'Shift ended',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
  not_started: {
    label: 'Not started',
    className: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200',
  },
  no_shift_required: {
    label: 'No shift',
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
}

const WEB_DOT: Record<MonitorWebStatus, string> = {
  online: 'bg-green-500',
  idle: 'bg-amber-400',
  offline: 'bg-gray-400',
  never: 'bg-slate-300 dark:bg-slate-700',
}

const WEB_LABEL: Record<MonitorWebStatus, string> = {
  online: 'In app',
  idle: 'Idle',
  offline: 'Offline',
  never: 'Never',
}

interface Props {
  allowedBranchIds: string[]
  shifts: ShiftRecord[]
  presence: StaffPresenceRecord[]
  users: UserRecord[]
  loading: boolean
  error: string | null
  onRetry: () => void
}

export const LiveRosterSection = ({
  allowedBranchIds,
  shifts,
  presence,
  users,
  loading,
  error,
  onRetry,
}: Props) => {
  // Tick a clock so elapsed-time / web-status (online/idle/offline) re-derive
  // even when the underlying data hasn't changed.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // Today (IST) cutoff for "today's shifts".
  const todayShifts = useMemo(() => {
    const today = istToday()
    return shifts.filter((s) => s.shiftDate === today)
  }, [shifts])

  const roster = useMemo(
    () =>
      mergeMonitorRoster({
        todayShifts,
        presenceRecords: presence,
        monitoredUsers: users,
        allowedBranchIds,
        nowMs,
      }),
    [todayShifts, presence, users, allowedBranchIds, nowMs],
  )

  const branchEntries = useMemo(
    () =>
      allowedBranchIds.map((bid) => ({
        branchId: bid,
        rows: roster.byBranch.get(bid) ?? [],
        active: roster.activeCountByBranch.get(bid) ?? 0,
        online: roster.onlineCountByBranch.get(bid) ?? 0,
      })),
    [roster, allowedBranchIds],
  )

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">Live Roster</h3>
          <p className="text-xs text-muted">
            Today’s shifts (start/end via Billing) with web-app activity overlay.
          </p>
        </div>
        {loading ? <span className="text-xs text-muted">Loading…</span> : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50/60 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
        >
          <span>Couldn’t load some roster data — values below may be incomplete. ({error})</span>
          <button
            type="button"
            onClick={onRetry}
            className="ui-btn ui-btn-neutral min-h-7 px-3 text-xs"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {branchEntries.map(({ branchId, rows, active, online }) => (
          <div key={branchId} className="rounded-xl border border-border/60 bg-panel p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-text">{branchIdToDisplayName(branchId)}</h4>
              <span className="text-xs text-muted">
                {active} on shift · {online} in app
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted">
                No monitored staff for this branch today.
              </p>
            ) : (
              <ul className="space-y-2">
                {rows.map((r: MonitorRosterEntry) => {
                  const pill = SHIFT_PILL[r.shiftStatus]
                  return (
                    <li
                      key={`${r.userId}-${r.role}`}
                      className="flex items-center gap-3 rounded-lg border border-border/40 bg-surface px-3 py-2"
                    >
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${WEB_DOT[r.webStatus]}`}
                        title={WEB_LABEL[r.webStatus]}
                      />
                      <span className="flex-1 truncate text-sm font-medium text-text">
                        {r.userName}
                      </span>
                      <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                        {r.role}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${pill.className}`}
                      >
                        {pill.label}
                      </span>
                      <span className="w-20 text-right text-xs text-muted">
                        {r.shiftStartTime ? formatHHmm(r.shiftStartTime) : '—'}
                      </span>
                      <span className="w-14 text-right text-xs font-semibold text-text">
                        {r.shiftStartTime && !r.shiftEndTime
                          ? formatElapsed(r.shiftStartTime, nowMs)
                          : r.shiftEndTime
                            ? formatHHmm(r.shiftEndTime)
                            : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function istToday(): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000
  const ist = new Date(Date.now() + istOffsetMs)
  const yyyy = ist.getUTCFullYear()
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(ist.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
