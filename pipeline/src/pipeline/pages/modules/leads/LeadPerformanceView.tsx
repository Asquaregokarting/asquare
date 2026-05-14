import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, Trophy, Target, Clock, Users, Download, Printer, Medal } from 'lucide-react'
import { useAuth } from '../../../features/auth/auth-context'
import { useLocations } from '../../../hooks/useLocations'
import { isPrivilegedRole } from '../../../api/firestore-session'
import {
  getLeadPerformanceMetrics,
  type LeadPerformanceFilters,
} from '../../../api/leads-firestore'
import type { LeadPerformanceMetrics } from '../../../api/types'
import { LEAD_STATUS_LABELS } from '../../../features/leads/lead-constants'
import {
  exportLeadPerformanceCSV,
  printLeadPerformanceReport,
} from '../../../features/leads/lead-report-export'
import { todayIST } from '../../../lib/ist-date'
import { logger } from '../../../../lib/logger'

// ─── Helpers ────────────────────────────────────────────────────────────────

const currency = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

type Period = 'today' | 'week' | 'month'

function getDateRange(period: Period): { from: string; to: string } {
  const today = todayIST()
  if (period === 'today') return { from: today, to: today }

  const d = new Date(`${today}T00:00:00+05:30`)
  if (period === 'week') {
    const day = d.getDay()
    const mondayOffset = day === 0 ? 6 : day - 1
    const monday = new Date(d)
    monday.setDate(d.getDate() - mondayOffset)
    const from = monday.toISOString().substring(0, 10)
    return { from, to: today }
  }
  // month
  const from = `${today.substring(0, 7)}-01`
  return { from, to: today }
}

// ─── KPI Card ───────────────────────────────────────────────────────────────

const KpiCard = ({
  label,
  value,
  icon,
  tone = 'muted',
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  tone?: 'success' | 'warning' | 'critical' | 'info' | 'muted'
}) => {
  const toneClass: Record<string, string> = {
    success: 'text-green-600 dark:text-green-400',
    warning: 'text-amber-600 dark:text-amber-400',
    critical: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400',
    muted: 'text-muted',
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-panel p-4 shadow-sm">
      <div className={`rounded-lg bg-surface/60 p-2.5 ${toneClass[tone]}`}>{icon}</div>
      <div>
        <p className="text-xs font-medium text-muted">{label}</p>
        <p className="text-lg font-bold text-text">{value}</p>
      </div>
    </div>
  )
}

// ─── Rank Badge ─────────────────────────────────────────────────────────────

const RankBadge = ({ rank }: { rank: number }) => {
  if (rank === 1)
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-white">
        1
      </span>
    )
  if (rank === 2)
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-400 text-xs font-bold text-white">
        2
      </span>
    )
  if (rank === 3)
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-700 text-xs font-bold text-white">
        3
      </span>
    )
  return <span className="text-xs text-muted">{rank}</span>
}

// ─── Main View ──────────────────────────────────────────────────────────────

const LeadPerformanceView = () => {
  const { session } = useAuth()
  const { enabledLocations, lockedLocationId } = useLocations()
  const isAdmin = session?.user.role && isPrivilegedRole(session.user.role)
  const navigate = useNavigate()

  const drillIntoTelecaller = useCallback(
    (telecallerId: string) => {
      navigate(`/leads/pipeline?assignedTo=${encodeURIComponent(telecallerId)}`)
    },
    [navigate],
  )

  const handleRowKey = useCallback(
    (e: React.KeyboardEvent<HTMLTableRowElement>, telecallerId: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        drillIntoTelecaller(telecallerId)
      }
    },
    [drillIntoTelecaller],
  )

  const [metrics, setMetrics] = useState<LeadPerformanceMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('week')
  const [branchFilter, setBranchFilter] = useState(lockedLocationId ?? '')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [useCustomDates, setUseCustomDates] = useState(false)

  const dateRange = useMemo(() => {
    if (useCustomDates && customFrom && customTo) return { from: customFrom, to: customTo }
    return getDateRange(period)
  }, [period, useCustomDates, customFrom, customTo])

  const loadMetrics = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const filters: LeadPerformanceFilters = {
        fromDate: dateRange.from,
        toDate: dateRange.to,
        branchId: branchFilter || undefined,
        assignedTo: isAdmin ? undefined : session.user.id,
      }
      const result = await getLeadPerformanceMetrics(session.token, filters)
      setMetrics(result)
    } catch (err) {
      logger.error('lead_performance.load_failed', err)
    } finally {
      setLoading(false)
    }
  }, [session, dateRange, branchFilter, isAdmin])

  useEffect(() => {
    loadMetrics()
  }, [loadMetrics])

  // ─── Stage Funnel ───────────────────────────────────────────────────────

  const stageFunnel = useMemo(() => {
    if (!metrics) return []
    return (Object.entries(metrics.byStatus) as [string, number][])
      .filter(([, count]) => count > 0)
      .map(([status, count]) => ({
        label: LEAD_STATUS_LABELS[status as keyof typeof LEAD_STATUS_LABELS] ?? status,
        count,
        percent: metrics.totalLeads > 0 ? Math.round((count / metrics.totalLeads) * 100) : 0,
      }))
  }, [metrics])

  if (loading && !metrics) {
    return <div className="py-12 text-center text-sm text-muted">Loading performance data...</div>
  }

  return (
    <div className="space-y-6">
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        {!useCustomDates && (
          <div className="flex rounded-lg border border-border/60 bg-panel">
            {(['today', 'week', 'month'] as Period[]).map((p) => (
              <button
                key={p}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  period === p ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text'
                }`}
                onClick={() => {
                  setPeriod(p)
                  setUseCustomDates(false)
                }}
              >
                {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
          </div>
        )}

        {isAdmin && (
          <select
            className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <option value="">All Branches</option>
            {enabledLocations.map((l) => (
              <option key={l.slug} value={l.branchId}>
                {l.displayName}
              </option>
            ))}
          </select>
        )}

        <button
          className="text-xs text-muted hover:text-text"
          onClick={() => setUseCustomDates(!useCustomDates)}
        >
          {useCustomDates ? 'Use presets' : 'Custom dates'}
        </button>

        {useCustomDates && (
          <>
            <input
              type="date"
              className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="text-xs text-muted">to</span>
            <input
              type="date"
              className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </>
        )}

        {isAdmin && metrics && (
          <div className="ml-auto flex gap-2">
            <button
              className="ui-btn ui-btn-neutral px-3 text-sm"
              onClick={() => exportLeadPerformanceCSV(metrics, dateRange)}
            >
              <Download className="mr-1 inline h-3.5 w-3.5" /> Excel
            </button>
            <button
              className="ui-btn ui-btn-neutral px-3 text-sm"
              onClick={() => printLeadPerformanceReport(metrics, dateRange)}
            >
              <Printer className="mr-1 inline h-3.5 w-3.5" /> PDF
            </button>
          </div>
        )}
      </div>

      {/* ── KPI Cards ── */}
      {metrics && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KpiCard
            label="Total Leads"
            value={metrics.totalLeads}
            icon={<Users className="h-5 w-5" />}
            tone="muted"
          />
          <KpiCard
            label="Conversions"
            value={metrics.totalConversions}
            icon={<Trophy className="h-5 w-5" />}
            tone="success"
          />
          <KpiCard
            label="Conversion %"
            value={`${metrics.conversionPercent}%`}
            icon={<TrendingUp className="h-5 w-5" />}
            tone={
              metrics.conversionPercent >= 10
                ? 'success'
                : metrics.conversionPercent >= 5
                  ? 'warning'
                  : 'critical'
            }
          />
          <KpiCard
            label="Pending Follow-ups"
            value={metrics.pendingFollowUps}
            icon={<Clock className="h-5 w-5" />}
            tone={metrics.pendingFollowUps > 10 ? 'warning' : 'muted'}
          />
          <KpiCard
            label="Active Telecallers"
            value={metrics.perTelecaller.length}
            icon={<Target className="h-5 w-5" />}
            tone="info"
          />
        </div>
      )}

      {/* ── Stage Funnel ── */}
      {stageFunnel.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-panel p-4 shadow-sm">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            Stage Funnel
          </h3>
          <div className="flex flex-wrap gap-3">
            {stageFunnel.map((s) => (
              <div
                key={s.label}
                className="flex items-center gap-2 rounded-lg bg-surface/60 px-3 py-2"
              >
                <span className="text-sm font-semibold text-text">{s.count}</span>
                <span className="text-xs text-muted">{s.label}</span>
                <span className="text-[10px] text-muted">({s.percent}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Per-Telecaller Table ── */}
      {isAdmin && metrics && metrics.perTelecaller.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/50 bg-panel shadow-sm">
          <div className="border-b border-border/30 px-4 py-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              Per-Telecaller Performance
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-surface/45">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Telecaller
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Assigned
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Contacted
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Follow-ups
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Conversions
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Conv %
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/55">
                {metrics.perTelecaller.map((t) => (
                  <tr
                    key={t.telecallerId}
                    role="button"
                    tabIndex={0}
                    aria-label={`View ${t.telecallerName}'s leads`}
                    onClick={() => drillIntoTelecaller(t.telecallerId)}
                    onKeyDown={(e) => handleRowKey(e, t.telecallerId)}
                    className="cursor-pointer transition hover:bg-surface/45 focus:bg-surface/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                  >
                    <td className="px-4 py-3 text-sm text-text">{t.telecallerName}</td>
                    <td className="px-4 py-3 text-right text-sm">{t.leadsAssigned}</td>
                    <td className="px-4 py-3 text-right text-sm">{t.leadsContacted}</td>
                    <td className="px-4 py-3 text-right text-sm">
                      {t.followUpsPending > 0 ? (
                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                          {t.followUpsPending}
                        </span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-green-600 dark:text-green-400">
                      {t.conversions}
                    </td>
                    <td className="px-4 py-3 text-right text-sm">{t.conversionPercent}%</td>
                    <td className="px-4 py-3 text-right text-sm">{currency(t.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Leaderboard ── */}
      {isAdmin && metrics && metrics.perTelecaller.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/50 bg-panel shadow-sm">
          <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2.5">
            <Medal className="h-4 w-4 text-amber-500" />
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              Conversion Leaderboard
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-surface/45">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.09em] text-muted w-12">
                    Rank
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Telecaller
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Conversions
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Conv %
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/55">
                {metrics.perTelecaller
                  .filter((t) => t.conversions > 0)
                  .map((t, i) => (
                    <tr
                      key={t.telecallerId}
                      role="button"
                      tabIndex={0}
                      aria-label={`View ${t.telecallerName}'s leads`}
                      onClick={() => drillIntoTelecaller(t.telecallerId)}
                      onKeyDown={(e) => handleRowKey(e, t.telecallerId)}
                      className={`cursor-pointer transition hover:bg-surface/45 focus:bg-surface/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                        i < 3 ? 'bg-amber-50/30 dark:bg-amber-900/5' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-center">
                        <RankBadge rank={i + 1} />
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-text">
                        {t.telecallerName}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-green-600 dark:text-green-400">
                        {t.conversions}
                      </td>
                      <td className="px-4 py-3 text-right text-sm">{t.conversionPercent}%</td>
                      <td className="px-4 py-3 text-right text-sm">{currency(t.revenue)}</td>
                    </tr>
                  ))}
                {metrics.perTelecaller.filter((t) => t.conversions > 0).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                      No conversions in this period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Telecaller Self-View (non-admin) ── */}
      {!isAdmin && metrics && (
        <div className="rounded-xl border border-border/50 bg-panel p-4 shadow-sm">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            My Activity Summary
          </h3>
          {metrics.perTelecaller.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted">Assigned</p>
                <p className="text-lg font-bold text-text">
                  {metrics.perTelecaller[0].leadsAssigned}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">Contacted</p>
                <p className="text-lg font-bold text-text">
                  {metrics.perTelecaller[0].leadsContacted}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">Conversions</p>
                <p className="text-lg font-bold text-green-600">
                  {metrics.perTelecaller[0].conversions}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">Follow-ups Pending</p>
                <p
                  className={`text-lg font-bold ${metrics.perTelecaller[0].followUpsPending > 0 ? 'text-amber-600' : 'text-text'}`}
                >
                  {metrics.perTelecaller[0].followUpsPending}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">No activity in this period</p>
          )}
        </div>
      )}
    </div>
  )
}

export default LeadPerformanceView
