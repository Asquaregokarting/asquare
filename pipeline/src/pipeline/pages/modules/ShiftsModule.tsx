import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { fmtDateTimeFullIST, todayISTStr } from '../../../lib/date-format'
import { normalizeLocationId, getLocationDisplayName } from '../../../lib/locations'
import { shiftsApi, ShiftRecord } from '../../api/shifts'
import { Role } from '../../api/types'
import { inchargeTasksApi, type InchargeDailyRecord } from '../../api/incharge-tasks'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { DataTable } from '../../components/ui/DataTable'
import { FilterBar, FilterField } from '../../components/ui/FilterBar'
import { SummaryCards } from '../../components/ui/SummaryCards'
import { useAuth } from '../../features/auth/auth-context'
import { useLocations } from '../../hooks/useLocations'
import {
  KartReportRecord,
  subscribeKartReport,
} from '../../features/track/services/kartReportService'
import { todayIST } from '../../lib/ist-date'
import LeaveDesk from './shifts/LeaveDesk'
import { DailyReportsHub } from '../../features/daily-reports/DailyReportsHub'

const SHIFT_LOCATION_KEY = 'pipeline_shift_location'

export type ShiftsView = 'my' | 'team' | 'reports' | 'leave'

const baseSubnav = [
  { label: 'My Shift', to: '/shifts/my' },
  { label: 'Team', to: '/shifts/team' },
  { label: 'Reports', to: '/shifts/reports' },
  { label: 'Leave', to: '/shifts/leave' },
]

const titleMap: Record<ShiftsView, string> = {
  my: 'My Shift Control',
  team: 'Team Shifts',
  reports: 'Shift Reports',
  leave: 'Leave & Workforce Desk',
}

const subtitleMap: Record<ShiftsView, string> = {
  my: 'Start, break, and end your active shift.',
  team: 'Audit cashier-submitted settlements across every branch.',
  reports: 'Discrepancy roll-up, drill-in, and re-print across branches.',
  leave: 'Apply leave and manage overtime, issues, and attendance.',
}

const formatDateTime = (value: string | undefined) => fmtDateTimeFullIST(value)
const SHIFT_CONTROL_ROLES: Role[] = ['Telecaller', 'Cashier', 'TrackMarshall', 'Incharge']
const EMPLOYEE_SHIFT_ROLES: Role[] = ['Telecaller', 'Cashier', 'TrackMarshall', 'Incharge']
const LEAVE_EMPLOYEE_ROLES: Role[] = [
  'Telecaller',
  'Cashier',
  'TrackMarshall',
  'Incharge',
  'Editor',
]
// HR is added to both — leave/overtime approvals and team shift reports
// are core HR responsibilities. Accountant added to TEAM_REPORT_ROLES
// only — they review shift settlements for financial accuracy but don't
// approve leave (that's HR's call).
const LEAVE_REVIEW_ROLES: Role[] = ['Owner', 'Admin', 'Developer', 'HR']
const TEAM_REPORT_ROLES: Role[] = ['Owner', 'Admin', 'Developer', 'HR', 'Accountant']

const toMillis = (value: string | undefined): number | null => {
  if (!value) {
    return null
  }
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

const getActiveDurationMs = (shift: ShiftRecord, nowMs: number): number => {
  const shiftStart = toMillis(shift.startTime)
  if (shiftStart === null) {
    return 0
  }

  const shiftEndCandidate = shift.endTime ? toMillis(shift.endTime) : nowMs
  if (shiftEndCandidate === null) {
    return 0
  }
  const shiftEnd = Math.max(shiftStart, shiftEndCandidate)
  const totalShiftMs = Math.max(0, shiftEnd - shiftStart)

  const breakMs = shift.breaks.reduce((sum, item) => {
    const breakStart = toMillis(item.breakStart)
    const breakEndCandidate = item.breakEnd ? toMillis(item.breakEnd) : nowMs
    if (breakStart === null || breakEndCandidate === null) {
      return sum
    }
    const clampedStart = Math.max(shiftStart, breakStart)
    const clampedEnd = Math.min(shiftEnd, Math.max(clampedStart, breakEndCandidate))
    return sum + Math.max(0, clampedEnd - clampedStart)
  }, 0)

  return Math.max(0, totalShiftMs - breakMs)
}

const formatDuration = (durationMs: number): string => {
  const seconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':')
}

const loadShiftLocation = (): string => {
  try {
    const stored = localStorage.getItem(SHIFT_LOCATION_KEY)
    if (stored) return normalizeLocationId(stored)
  } catch {
    /* ignore */
  }
  return ''
}

const persistShiftLocation = (locationId: string) => {
  try {
    if (locationId) localStorage.setItem(SHIFT_LOCATION_KEY, locationId)
    else localStorage.removeItem(SHIFT_LOCATION_KEY)
  } catch {
    /* ignore */
  }
}

const ShiftsModule = ({ view }: { view: ShiftsView }) => {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [shifts, setShifts] = useState<ShiftRecord[]>([])

  const { enabledLocations, isRoleLocked, isFullAccess, lockedLocationId } = useLocations()

  // For restricted roles with a locked location, force their locationId
  const [manualLocationId, setManualLocationId] = useState<string>(() => loadShiftLocation())
  const selectedLocationId = lockedLocationId ?? manualLocationId

  const selectedLocationName = selectedLocationId ? getLocationDisplayName(selectedLocationId) : ''

  const handleLocationChange = (locationId: string) => {
    if (isRoleLocked) return // restricted roles cannot change
    setManualLocationId(locationId)
    persistShiftLocation(locationId)
  }

  // Auto-persist locked location for restricted roles
  useEffect(() => {
    if (lockedLocationId && manualLocationId !== lockedLocationId) {
      setManualLocationId(lockedLocationId)
      persistShiftLocation(lockedLocationId)
    }
  }, [lockedLocationId, manualLocationId])

  const token = session?.token
  const canAccessMyShift = Boolean(session && SHIFT_CONTROL_ROLES.includes(session.user.role))
  const canAccessLeaveDesk = Boolean(
    session &&
    (LEAVE_EMPLOYEE_ROLES.includes(session.user.role) ||
      LEAVE_REVIEW_ROLES.includes(session.user.role)),
  )
  const isEmployeeShiftRole = Boolean(session && EMPLOYEE_SHIFT_ROLES.includes(session.user.role))
  const isInchargeRole = session?.user.role === 'Incharge'
  const canAccessTeamReports = Boolean(session && TEAM_REPORT_ROLES.includes(session.user.role))

  // Subscribe to today's Incharge daily-tasks doc when the user is in the
  // Incharge role. The End Shift button is gated on this record being complete.
  const [inchargeRecord, setInchargeRecord] = useState<InchargeDailyRecord | null>(null)
  useEffect(() => {
    if (!isInchargeRole || !lockedLocationId) {
      setInchargeRecord(null)
      return
    }
    const unsub = inchargeTasksApi.subscribeForToday(lockedLocationId, setInchargeRecord)
    return () => unsub()
  }, [isInchargeRole, lockedLocationId])
  const inchargeTasksPending = isInchargeRole && !inchargeTasksApi.isComplete(inchargeRecord)
  const subnav = useMemo(() => {
    if (!session) {
      return baseSubnav.filter((item) => item.to !== '/shifts/my')
    }
    return baseSubnav.filter((item) => {
      if (item.to === '/shifts/my') return canAccessMyShift
      if (item.to === '/shifts/team' || item.to === '/shifts/reports') return canAccessTeamReports
      if (item.to === '/shifts/leave') return canAccessLeaveDesk
      return true
    })
  }, [canAccessLeaveDesk, canAccessMyShift, canAccessTeamReports, session])

  const today = todayISTStr()
  const from = searchParams.get('from') ?? (view === 'team' ? today : '')
  const to = searchParams.get('to') ?? (view === 'team' ? today : '')
  const roleFilter = (searchParams.get('role') as Role | null) ?? ''
  const activeOnly = searchParams.get('activeOnly') === 'true'

  const loadShifts = async () => {
    if (!token || !session) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      const role =
        roleFilter && ['Telecaller', 'Cashier', 'TrackMarshall'].includes(roleFilter)
          ? (roleFilter as 'Telecaller' | 'Cashier' | 'TrackMarshall')
          : undefined
      const result = await shiftsApi.list(token, {
        from: from || undefined,
        to: to || undefined,
        role,
        userId: view === 'my' ? session.user.id : undefined,
        activeOnly: view === 'my' ? undefined : activeOnly ? true : undefined,
        locationId: selectedLocationId || undefined,
      })
      setShifts(result.shifts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shifts.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (view === 'leave') {
      return
    }
    void loadShifts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, view, session?.user.id, from, to, roleFilter, activeOnly, selectedLocationId])

  const activeCount = shifts.filter((shift) => !shift.endTime).length
  const completed = shifts.filter((shift) => typeof shift.totalActiveHours === 'number')
  const averageHours =
    completed.length > 0
      ? completed.reduce((sum, shift) => sum + (shift.totalActiveHours ?? 0), 0) / completed.length
      : 0

  const byRole = useMemo(
    () =>
      shifts.reduce<Record<string, number>>((accumulator, shift) => {
        accumulator[shift.role] = (accumulator[shift.role] ?? 0) + 1
        return accumulator
      }, {}),
    [shifts],
  )
  const [nowMs, setNowMs] = useState(() => Date.now())
  const activeShift = useMemo(() => shifts.find((shift) => !shift.endTime), [shifts])
  const hasOpenBreak = Boolean(activeShift?.breaks.some((item) => !item.breakEnd))
  const shiftStatus = activeShift ? (hasOpenBreak ? 'On Break' : 'Working') : 'Shift Ended'
  const liveDurationMs = activeShift ? getActiveDurationMs(activeShift, nowMs) : 0
  const showEmployeeTimer = view === 'my' && isEmployeeShiftRole
  // Restricted roles: always locked. Others: locked only during active shift (unless privileged).
  const locationLocked = isRoleLocked || (Boolean(activeShift) && !isFullAccess)

  // Cashier kart-report preflight: subscribe to today's report for the
  // selected location so we can disable Start Shift and show a banner.
  const isCashier = session?.user.role === 'Cashier'
  const [todaysKartReport, setTodaysKartReport] = useState<KartReportRecord | null>(null)
  useEffect(() => {
    if (!isCashier || !selectedLocationId) {
      setTodaysKartReport(null)
      return
    }
    const unsubscribe = subscribeKartReport(
      selectedLocationId,
      todayIST(),
      (record) => setTodaysKartReport(record),
      () => setTodaysKartReport(null),
    )
    return () => unsubscribe()
  }, [isCashier, selectedLocationId])
  const cashierBlocked = isCashier && (!todaysKartReport || todaysKartReport.status !== 'submitted')

  useEffect(() => {
    if (!showEmployeeTimer || !activeShift) {
      return
    }
    const interval = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(interval)
  }, [activeShift, showEmployeeTimer])

  const executeShiftAction = async (
    action: () => Promise<{ shift: ShiftRecord }>,
    successMessage: string,
  ): Promise<void> => {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      await action()
      setSuccess(successMessage)
      await loadShifts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Shift action failed.')
    } finally {
      setLoading(false)
    }
  }

  if (!session || !token) {
    return null
  }
  if (view === 'my' && !canAccessMyShift) {
    return <Navigate replace to={canAccessLeaveDesk ? '/shifts/leave' : '/shifts/team'} />
  }
  if (view === 'leave' && !canAccessLeaveDesk) {
    return <Navigate replace to="/shifts/team" />
  }
  if ((view === 'team' || view === 'reports') && !canAccessTeamReports) {
    return (
      <Navigate
        replace
        to={canAccessMyShift ? '/shifts/my' : canAccessLeaveDesk ? '/shifts/leave' : '/dashboard'}
      />
    )
  }

  // ── Team & Reports views are the audit-grade Daily Reports surface ─────
  // (shifts module retains 'my' for cashier shift control + 'leave' desk).
  if (view === 'team' || view === 'reports') {
    return (
      <ModulePageLayout
        moduleTab="Shifts"
        title={titleMap[view]}
        subtitle={subtitleMap[view]}
        breadcrumbs={['Pipeline', 'Shifts', titleMap[view]]}
        subnav={subnav}
      >
        <DailyReportsHub mode={view} />
      </ModulePageLayout>
    )
  }

  return (
    <ModulePageLayout
      moduleTab="Shifts"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={['Pipeline', 'Shifts', titleMap[view]]}
      subnav={subnav}
    >
      {/* ── Location Selector ────────────────────────────────────────── */}
      {view !== 'leave' ? (
        <section className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3">
          <label className="text-xs font-semibold uppercase tracking-[0.07em] text-muted">
            Location
          </label>
          <select
            className="ui-field min-h-9 min-w-[180px]"
            value={selectedLocationId}
            disabled={locationLocked}
            onChange={(e) => handleLocationChange(e.target.value)}
          >
            <option value="">— Select Location —</option>
            {enabledLocations.map((loc) => (
              <option key={loc.slug} value={loc.slug}>
                {loc.displayName}
              </option>
            ))}
            <option value="vizag-corporate-office">Vizag Corporate Office</option>
          </select>
          {isRoleLocked ? (
            <span className="text-xs text-muted">Locked to your assigned location</span>
          ) : locationLocked ? (
            <span className="text-xs text-warning">Location is locked during an active shift.</span>
          ) : null}
          {selectedLocationName ? (
            <span className="ml-auto text-sm font-semibold text-foreground">
              {selectedLocationName}
              {isRoleLocked ? ' (Locked)' : ''}
            </span>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
        </p>
      ) : null}

      {view === 'leave' ? (
        <LeaveDesk
          token={token}
          user={{ id: session.user.id, name: session.user.name, role: session.user.role }}
        />
      ) : (
        <>
          {showEmployeeTimer ? (
            <section className="mb-4 rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                    {activeShift
                      ? `Shift Active — ${activeShift.locationName || selectedLocationName}`
                      : 'Live Running Shift Timer'}
                  </p>
                  <p className="text-3xl font-semibold tracking-[0.08em] text-foreground">
                    {formatDuration(liveDurationMs)}
                  </p>
                </div>
                <div
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${
                    shiftStatus === 'Working'
                      ? 'border border-success/45 bg-success/10 text-success'
                      : shiftStatus === 'On Break'
                        ? 'border border-warning/45 bg-warning/10 text-warning'
                        : 'border border-muted/45 bg-muted/10 text-muted'
                  }`}
                >
                  {shiftStatus}
                </div>
              </div>
            </section>
          ) : (
            <SummaryCards
              items={[
                {
                  id: 'active',
                  label: 'Active Shifts',
                  value: String(activeCount),
                  tone: 'success',
                },
                { id: 'total', label: 'Total Shifts', value: String(shifts.length), tone: 'info' },
                {
                  id: 'avg',
                  label: 'Avg Active Hours',
                  value: averageHours.toFixed(2),
                  tone: 'warning',
                },
                {
                  id: 'roles',
                  label: 'Role Mix',
                  value: `${Object.keys(byRole).length} roles`,
                  tone: 'muted',
                },
              ]}
            />
          )}

          {view === 'my' ? (
            <>
              {cashierBlocked && !activeShift ? (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                  <span className="text-base leading-none">⚠️</span>
                  <span>
                    Kart update was not completed. Please wait for Track Marshall to submit
                    today&apos;s kart report.
                  </span>
                </div>
              ) : null}

              <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-3">
                <button
                  type="button"
                  disabled={!selectedLocationId || loading}
                  onClick={() => {
                    if (!selectedLocationId) {
                      setError('Please select a location before starting a shift.')
                      return
                    }
                    if (cashierBlocked) {
                      setError(
                        "Kart update was not completed. Please wait for Track Marshall to submit today's kart report.",
                      )
                      return
                    }
                    void executeShiftAction(
                      () =>
                        shiftsApi.start(
                          token,
                          session.user.role as
                            | 'Telecaller'
                            | 'Cashier'
                            | 'TrackMarshall'
                            | 'Incharge',
                          selectedLocationId,
                        ),
                      'Shift started',
                    )
                  }}
                  className="ui-btn ui-btn-primary"
                  title={
                    !selectedLocationId
                      ? 'Select a location first'
                      : cashierBlocked && !activeShift
                        ? "Kart update was not completed. Please wait for Track Marshall to submit today's kart report."
                        : undefined
                  }
                >
                  Start Shift
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void executeShiftAction(() => shiftsApi.startBreak(token), 'Break started')
                  }
                  className="rounded-lg border border-warning/45 bg-warning/10 px-3 py-1.5 text-sm font-semibold text-warning"
                >
                  Start Break
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void executeShiftAction(() => shiftsApi.endBreak(token), 'Break ended')
                  }
                  className="rounded-lg border border-info/45 bg-info/10 px-3 py-1.5 text-sm font-semibold text-info"
                >
                  End Break
                </button>
                <button
                  type="button"
                  disabled={inchargeTasksPending || loading}
                  onClick={() => void executeShiftAction(() => shiftsApi.end(token), 'Shift ended')}
                  title={
                    inchargeTasksPending
                      ? "Complete today's Incharge tasks before ending shift."
                      : undefined
                  }
                  className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-1.5 text-sm font-semibold text-critical disabled:cursor-not-allowed disabled:opacity-50"
                >
                  End Shift
                </button>
                {LEAVE_EMPLOYEE_ROLES.includes(session.user.role) ? (
                  <button
                    type="button"
                    onClick={() => navigate('/shifts/leave')}
                    className="ui-btn ui-btn-info"
                  >
                    Leave
                  </button>
                ) : null}
                {inchargeTasksPending ? (
                  <div className="basis-full">
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-warning/45 bg-warning/10 px-3 py-2 text-xs text-warning">
                      <span>📋</span>
                      <p>
                        Complete today&apos;s Incharge tasks (Washroom, Housekeeping, Vehicle
                        Report) before ending your shift.
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate('/incharge/tasks')}
                        className="ml-auto rounded border border-warning/45 px-2 py-1 font-semibold hover:bg-warning/20"
                      >
                        Open Incharge
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Personal audit view — same hub the Owner uses, scoped to me. */}
              <div className="mt-4">
                <DailyReportsHub mode="my" />
              </div>
            </>
          ) : (
            <FilterBar>
              <button
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(searchParams)
                  const today = todayISTStr()
                  next.set('from', today)
                  next.set('to', today)
                  setSearchParams(next)
                }}
                className="ui-btn ui-btn-info min-h-10 px-4 text-sm"
              >
                Today
              </button>
              <FilterField label="From">
                <input
                  className="ui-field min-h-10"
                  type="date"
                  value={from}
                  onChange={(event) => {
                    const next = new URLSearchParams(searchParams)
                    if (event.target.value) next.set('from', event.target.value)
                    else next.delete('from')
                    setSearchParams(next)
                  }}
                />
              </FilterField>
              <FilterField label="To">
                <input
                  className="ui-field min-h-10"
                  type="date"
                  value={to}
                  onChange={(event) => {
                    const next = new URLSearchParams(searchParams)
                    if (event.target.value) next.set('to', event.target.value)
                    else next.delete('to')
                    setSearchParams(next)
                  }}
                />
              </FilterField>
              <FilterField label="Role">
                <select
                  className="ui-field min-h-10"
                  value={roleFilter}
                  onChange={(event) => {
                    const next = new URLSearchParams(searchParams)
                    if (event.target.value) next.set('role', event.target.value)
                    else next.delete('role')
                    setSearchParams(next)
                  }}
                >
                  <option value="">All</option>
                  <option value="Telecaller">Telecaller</option>
                  <option value="Cashier">Cashier</option>
                  <option value="TrackMarshall">Track Marshall</option>
                </select>
              </FilterField>
              <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                <input
                  type="checkbox"
                  checked={activeOnly}
                  onChange={(event) => {
                    const next = new URLSearchParams(searchParams)
                    if (event.target.checked) next.set('activeOnly', 'true')
                    else next.delete('activeOnly')
                    setSearchParams(next)
                  }}
                />
                Active only
              </label>
            </FilterBar>
          )}

          <DataTable
            columns={[
              {
                key: 'shiftDate',
                header: 'Shift Date',
                render: (shift) => <span>{shift.shiftDate}</span>,
              },
              {
                key: 'userId',
                header: 'User',
                render: (shift) => (
                  <span className="font-mono text-xs">{shift.userId.slice(0, 8)}</span>
                ),
              },
              { key: 'role', header: 'Role', render: (shift) => shift.role },
              {
                key: 'location',
                header: 'Location',
                render: (shift) => (
                  <span className="text-xs">{shift.locationName || shift.locationId || '—'}</span>
                ),
              },
              { key: 'start', header: 'Start', render: (shift) => formatDateTime(shift.startTime) },
              { key: 'end', header: 'End', render: (shift) => formatDateTime(shift.endTime) },
              {
                key: 'hours',
                header: 'Active Hours',
                render: (shift) =>
                  typeof shift.totalActiveHours === 'number'
                    ? shift.totalActiveHours.toFixed(2)
                    : '-',
              },
              ...(canAccessTeamReports && view !== 'my'
                ? [
                    {
                      key: 'actions' as const,
                      header: 'Actions',
                      render: (shift: ShiftRecord) =>
                        !shift.endTime ? (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() =>
                              void executeShiftAction(
                                () => shiftsApi.endById(token, shift.id),
                                `Shift ended for ${shift.userId.slice(0, 8)}`,
                              )
                            }
                            className="rounded-lg border border-critical/45 bg-critical/10 px-2 py-1 text-xs font-semibold text-critical hover:bg-critical/20"
                          >
                            End Shift
                          </button>
                        ) : null,
                    },
                  ]
                : []),
            ]}
            rows={shifts}
            rowKey={(shift) => shift.id}
            emptyMessage={loading ? 'Loading shifts...' : 'No shifts found for selected filters.'}
          />
        </>
      )}
    </ModulePageLayout>
  )
}

export default ShiftsModule
