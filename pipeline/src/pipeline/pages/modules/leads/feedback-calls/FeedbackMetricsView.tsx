import { useMemo, useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../../../../features/auth/auth-context'
import { isPrivilegedRole } from '../../../../api/firestore-session'
import { useFeedbackCallMetrics } from '../../../../features/feedback-calls/useFeedbackCallMetrics'
import { FEEDBACK_ISSUE_LABELS } from '../../../../features/feedback-calls/feedback-call-constants'
import { BRANCH_MAP } from '../../../../features/leads/lead-constants'
import type { FeedbackIssueCategory, FeedbackRating } from '../../../../api/types'

// Star colors mirror LeadMetricsView's STATUS_COLORS approach — one fixed
// hex per rating bucket so the histogram is instantly readable.
const RATING_COLORS: Record<FeedbackRating, string> = {
  1: '#EF4444', // red
  2: '#F97316', // orange
  3: '#F59E0B', // amber
  4: '#84CC16', // lime
  5: '#10B981', // green
}

const RATING_LABELS: Record<FeedbackRating, string> = {
  1: '1 ★',
  2: '2 ★',
  3: '3 ★',
  4: '4 ★',
  5: '5 ★',
}

const todayDateInputValue = (): string => {
  const d = new Date()
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000
  const ist = new Date(istMs)
  const y = ist.getUTCFullYear()
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0')
  const day = String(ist.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const monthAgoDateInputValue = (): string => {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000
  const ist = new Date(istMs)
  const y = ist.getUTCFullYear()
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0')
  const day = String(ist.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const FeedbackMetricsView = () => {
  const { session } = useAuth()
  const role = session?.user.role
  const canView = role ? isPrivilegedRole(role) || role === 'Developer' : false

  // Default range: last 30 days, all branches
  const [fromDate, setFromDate] = useState<string>(monthAgoDateInputValue())
  const [toDate, setToDate] = useState<string>(todayDateInputValue())
  const [branchId, setBranchId] = useState<string>('')

  const filter = useMemo(
    () => ({
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      branchId: branchId || undefined,
    }),
    [fromDate, toDate, branchId],
  )

  const { metrics, loading, error } = useFeedbackCallMetrics(filter)

  // Build chart data unconditionally (hooks must run on every render path)
  const ratingData = useMemo(() => {
    if (!metrics) return []
    return ([1, 2, 3, 4, 5] as FeedbackRating[]).map((star) => ({
      rating: star,
      name: RATING_LABELS[star],
      value: metrics.perRating[star] ?? 0,
    }))
  }, [metrics])

  const issuesData = useMemo(() => {
    if (!metrics) return []
    return (Object.keys(metrics.perIssue) as FeedbackIssueCategory[])
      .map((category) => ({
        name: FEEDBACK_ISSUE_LABELS[category],
        value: metrics.perIssue[category] ?? 0,
      }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [metrics])

  if (!canView) {
    return (
      <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
        Feedback metrics are visible to Owner / Admin / Developer only.
      </div>
    )
  }

  return (
    <div className="ui-section-stack">
      {/* Filter toolbar */}
      <div className="ui-toolbar grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="ui-field min-h-9 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="ui-field min-h-9 text-xs"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted sm:col-span-1">
          Branch
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="ui-field min-h-9 text-xs"
          >
            <option value="">All Branches</option>
            {Object.entries(BRANCH_MAP).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <div className="py-12 text-center text-sm text-muted">Loading metrics...</div>}
      {error && (
        <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </div>
      )}

      {!loading && !error && metrics && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
            <div className="ui-panel p-3 sm:p-4">
              <p className="font-display text-2xl font-semibold leading-none text-text sm:text-3xl">
                {metrics.total}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted sm:text-[11px]">
                Total Calls
              </p>
            </div>
            <div className="relative rounded-xl border border-success/35 bg-success/10 p-3 shadow-sm sm:p-4">
              <p className="font-display text-2xl font-semibold leading-none text-success sm:text-3xl">
                {metrics.completionRate}%
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-success sm:text-[11px]">
                Completion Rate
              </p>
            </div>
            <div className="relative rounded-xl border border-warning/35 bg-warning/10 p-3 shadow-sm sm:p-4">
              <p className="font-display text-2xl font-semibold leading-none text-warning sm:text-3xl">
                {metrics.averageRating || '—'}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-warning sm:text-[11px]">
                Avg Rating
              </p>
            </div>
            <div className="relative rounded-xl border border-critical/35 bg-critical/10 p-3 shadow-sm sm:p-4">
              <p className="font-display text-2xl font-semibold leading-none text-critical sm:text-3xl">
                {metrics.negativeCount}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-critical sm:text-[11px]">
                Negative
              </p>
            </div>
          </div>

          {/* Status breakdown row */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <StatusTile label="Pending" value={metrics.pending} tone="critical" />
            <StatusTile label="Completed" value={metrics.completed} tone="success" />
            <StatusTile label="No Answer" value={metrics.noAnswer} tone="warning" />
            <StatusTile label="Call Later" value={metrics.callLater} tone="info" />
          </div>

          {/* Rating distribution */}
          <div className="ui-panel p-3 sm:p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              Rating Distribution
            </h3>
            {ratingData.every((d) => d.value === 0) ? (
              <p className="py-6 text-center text-xs text-muted">
                No ratings submitted in the selected range yet.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ratingData} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="name" tick={{ fill: 'rgb(var(--color-muted))', fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: 'rgb(var(--color-muted))', fontSize: 11 }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'rgb(var(--color-panel))',
                      border: '1px solid rgb(var(--color-border))',
                      borderRadius: 8,
                      color: 'rgb(var(--color-text))',
                    }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {ratingData.map((entry) => (
                      <Cell key={entry.rating} fill={RATING_COLORS[entry.rating]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Issues breakdown */}
          <div className="ui-panel p-3 sm:p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              Issues Reported
            </h3>
            {issuesData.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted">
                No issues reported in the selected range.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={issuesData} margin={{ left: -10, right: 10 }}>
                  <XAxis
                    dataKey="name"
                    tick={{ fill: 'rgb(var(--color-muted))', fontSize: 9 }}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fill: 'rgb(var(--color-muted))', fontSize: 11 }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'rgb(var(--color-panel))',
                      border: '1px solid rgb(var(--color-border))',
                      borderRadius: 8,
                      color: 'rgb(var(--color-text))',
                    }}
                  />
                  <Bar dataKey="value" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Per-telecaller leaderboard */}
          <div className="overflow-x-auto rounded-xl border border-border/50 bg-panel shadow-sm">
            <div className="border-b border-border/30 px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                Per-Telecaller Leaderboard
              </h3>
            </div>
            {metrics.perTelecaller.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted">
                No telecaller activity in the selected range.
              </p>
            ) : (
              <table className="w-full min-w-[480px] text-sm">
                <thead className="bg-surface/45">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                      Telecaller
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                      Total
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                      Completed
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                      Avg ★
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                      Negative
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                      Completion %
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/55">
                  {metrics.perTelecaller.map((row) => (
                    <tr key={row.telecallerId}>
                      <td className="px-4 py-3 font-mono text-[11px] text-text">
                        {row.telecallerName}
                      </td>
                      <td className="px-4 py-3 text-right text-text">{row.total}</td>
                      <td className="px-4 py-3 text-right text-success">{row.completed}</td>
                      <td className="px-4 py-3 text-right text-warning">
                        {row.averageRating || '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-critical">{row.negative}</td>
                      <td className="px-4 py-3 text-right font-semibold text-text">
                        {row.completionRate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Per-branch breakdown */}
          <div className="overflow-x-auto rounded-xl border border-border/50 bg-panel shadow-sm">
            <div className="border-b border-border/30 px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                Per-Branch Breakdown
              </h3>
            </div>
            {metrics.perBranch.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted">
                No branch activity in the selected range.
              </p>
            ) : (
              <table className="w-full min-w-[420px] text-sm">
                <thead className="bg-surface/45">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                      Branch
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                      Total
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                      Completed
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                      Avg ★
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                      Negative
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/55">
                  {metrics.perBranch.map((row) => (
                    <tr key={row.branchId}>
                      <td className="px-4 py-3 text-text">{row.branchName}</td>
                      <td className="px-4 py-3 text-right text-text">{row.total}</td>
                      <td className="px-4 py-3 text-right text-success">{row.completed}</td>
                      <td className="px-4 py-3 text-right text-warning">
                        {row.averageRating || '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-critical">{row.negative}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const StatusTile = ({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'info' | 'success' | 'warning' | 'critical'
}) => {
  const toneClasses: Record<string, string> = {
    info: 'border-info/35 bg-info/10 text-info',
    success: 'border-success/35 bg-success/10 text-success',
    warning: 'border-warning/35 bg-warning/10 text-warning',
    critical: 'border-critical/35 bg-critical/10 text-critical',
  }
  return (
    <div className={`relative rounded-xl border px-3 py-2.5 shadow-sm ${toneClasses[tone]}`}>
      <p className="font-display text-xl font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em]">{label}</p>
    </div>
  )
}

export default FeedbackMetricsView
