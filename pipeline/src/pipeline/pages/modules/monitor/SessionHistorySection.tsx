import { useEffect, useMemo, useState } from 'react'
import {
  MONITORED_ROLES,
  MonitoredRole,
  StaffSessionEndReason,
  StaffSessionLogRecord,
  type UserRecord,
} from '../../../api/types'
import { branchIdToDisplayName } from '../../../../lib/locations'
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable'
import { todayIST } from '../../../lib/ist-date'
import { shiftsToSessionLogRows } from '../../../features/monitor/monitor-data'
import type { ShiftRecord } from '../../../api/shifts'

const SHORT_SESSION_MINUTES = 240 // 4h
const PAGE_SIZE = 50

const END_REASON_LABEL: Record<StaffSessionEndReason, string> = {
  explicit_signout: 'Sign-out',
  timeout: 'Timeout',
  new_session_replaced: 'New device',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN')
}

function formatHHmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

/** RFC 4180-compliant CSV cell: wraps value in double-quotes, escapes internal quotes. */
const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`

function downloadCsv(rows: StaffSessionLogRecord[]): void {
  const header = [
    'Date',
    'Name',
    'Role',
    'Branch',
    'Login',
    'Logout',
    'Duration (min)',
    'End reason',
  ]
  // Join lines with CRLF per RFC 4180
  const csv = [
    header.map(csvCell).join(','),
    ...rows.map((r) =>
      [
        csvCell(formatDate(r.loginAt)),
        csvCell(r.userName),
        csvCell(r.role),
        csvCell(branchIdToDisplayName(r.branchId)),
        csvCell(formatHHmm(r.loginAt)),
        csvCell(formatHHmm(r.logoutAt)),
        csvCell(String(r.durationMinutes)),
        csvCell(END_REASON_LABEL[r.endReason]),
      ].join(','),
    ),
  ].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `staff-sessions-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  allowedBranchIds: string[]
  shifts: ShiftRecord[]
  users: UserRecord[]
  loading: boolean
  error: string | null
}

export const SessionHistorySection = ({
  allowedBranchIds,
  shifts,
  users,
  loading,
  error,
}: Props) => {
  // Use IST "today" so default date range matches the user's local workday.
  const today = todayIST()
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [selectedRoles, setSelectedRoles] = useState<MonitoredRole[]>([...MONITORED_ROLES])
  const [selectedBranches, setSelectedBranches] = useState<string[]>(allowedBranchIds)
  const [userTouchedBranches, setUserTouchedBranches] = useState(false)
  const [shortOnly, setShortOnly] = useState(false)
  const [timeoutsOnly, setTimeoutsOnly] = useState(false)
  const [page, setPage] = useState(1)

  // Keep selectedBranches in sync with allowedBranchIds (locations may load
  // after mount). Once the user toggles a chip we preserve their choice and
  // only prune disallowed branches.
  useEffect(() => {
    setSelectedBranches((cur) => {
      if (!userTouchedBranches) return allowedBranchIds
      const pruned = cur.filter((b) => allowedBranchIds.includes(b))
      return pruned.length === cur.length ? cur : pruned
    })
  }, [allowedBranchIds, userTouchedBranches])

  // Convert shared shifts → StaffSessionLogRecord shape once (memoized on the
  // shifts/users data; cheap to re-derive when filters change).
  const allRows = useMemo(() => {
    const userNameById = new Map<string, string>()
    for (const u of users) userNameById.set(u.id, u.name)
    return shiftsToSessionLogRows(shifts, userNameById)
  }, [shifts, users])

  const filtersEmpty = selectedRoles.length === 0 || selectedBranches.length === 0

  const filtered = useMemo(() => {
    if (filtersEmpty) return [] as StaffSessionLogRecord[]
    const roleSet = new Set<string>(selectedRoles)
    const branchSet = new Set(selectedBranches)
    return allRows.filter((r) => {
      if (!roleSet.has(r.role)) return false
      if (!branchSet.has(r.branchId)) return false
      const day = r.loginAt.slice(0, 10)
      if (day < fromDate || day > toDate) return false
      if (shortOnly && r.durationMinutes >= SHORT_SESSION_MINUTES) return false
      if (timeoutsOnly && r.endReason !== 'timeout') return false
      return true
    })
  }, [
    allRows,
    filtersEmpty,
    selectedRoles,
    selectedBranches,
    fromDate,
    toDate,
    shortOnly,
    timeoutsOnly,
  ])

  // Reset to page 1 whenever the filter set changes.
  useEffect(() => {
    setPage(1)
  }, [filtered])

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  const columns: DataTableColumn<StaffSessionLogRecord>[] = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.loginAt) },
    { key: 'name', header: 'Name', render: (r) => r.userName },
    { key: 'role', header: 'Role', render: (r) => r.role },
    { key: 'branch', header: 'Branch', render: (r) => branchIdToDisplayName(r.branchId) },
    { key: 'login', header: 'Login', render: (r) => formatHHmm(r.loginAt) },
    { key: 'logout', header: 'Logout', render: (r) => formatHHmm(r.logoutAt) },
    { key: 'duration', header: 'Duration', render: (r) => formatDuration(r.durationMinutes) },
    { key: 'endReason', header: 'End', render: (r) => END_REASON_LABEL[r.endReason] },
  ]

  const toggleRole = (role: MonitoredRole) => {
    setSelectedRoles((cur) => (cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role]))
  }

  const toggleBranch = (bid: string) => {
    setUserTouchedBranches(true)
    setSelectedBranches((cur) => (cur.includes(bid) ? cur.filter((b) => b !== bid) : [...cur, bid]))
  }

  const emptyMessage = filtersEmpty
    ? 'Select at least one role and one branch to see sessions.'
    : 'No sessions match the current filters.'

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Session History</h3>
        <button
          type="button"
          onClick={() => downloadCsv(filtered)}
          disabled={filtered.length === 0}
          className="ui-btn ui-btn-neutral text-xs"
        >
          Export CSV
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/40 bg-panel p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">From</span>
          <input
            type="date"
            className="ui-field min-h-9"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">To</span>
          <input
            type="date"
            className="ui-field min-h-9"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {MONITORED_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => toggleRole(role)}
              className={`ui-btn min-h-7 px-2 text-[11px] ${
                selectedRoles.includes(role) ? 'ui-btn-info' : 'ui-btn-neutral'
              }`}
            >
              {role}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {allowedBranchIds.map((bid) => (
            <button
              key={bid}
              type="button"
              onClick={() => toggleBranch(bid)}
              className={`ui-btn min-h-7 px-2 text-[11px] ${
                selectedBranches.includes(bid) ? 'ui-btn-info' : 'ui-btn-neutral'
              }`}
            >
              {branchIdToDisplayName(bid)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={shortOnly}
            onChange={(e) => setShortOnly(e.target.checked)}
          />
          Short sessions only
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={timeoutsOnly}
            onChange={(e) => setTimeoutsOnly(e.target.checked)}
          />
          Timeouts only
        </label>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50/60 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
        >
          <span>Couldn’t load session history. ({error})</span>
        </div>
      ) : null}
      {loading ? (
        <p className="py-6 text-center text-sm text-muted">Loading…</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={paged}
            rowKey={(r) => r.id}
            emptyMessage={emptyMessage}
            rowClassName={(r) => {
              // Red left border + faint red background for short sessions (< 4h).
              if (r.durationMinutes < SHORT_SESSION_MINUTES)
                return 'border-l-2 border-l-red-500 bg-red-50/40 dark:bg-red-950/20'
              // Grey tint when the session ended due to timeout (walked away).
              if (r.endReason === 'timeout') return 'opacity-60'
              return undefined
            }}
          />
          {totalPages > 1 ? (
            <div className="flex items-center justify-end gap-2 text-xs text-muted">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="ui-btn ui-btn-neutral min-h-7 px-2 text-[11px]"
              >
                Prev
              </button>
              <span>
                Page {page} of {totalPages} · {filtered.length} total
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="ui-btn ui-btn-neutral min-h-7 px-2 text-[11px]"
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
