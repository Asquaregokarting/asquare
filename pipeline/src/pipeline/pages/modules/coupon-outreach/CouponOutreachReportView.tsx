import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../features/auth/auth-context'
import {
  couponOutreachReportApi,
  type CouponOutreachReport,
} from '../../../api/coupon-outreach-report'
import { istDateString } from '../../../api/coupon-outreach'
import { formatRupees } from '../../../features/coupon-outreach/coupon-outreach-utils'
import { logger } from '../../../../lib/logger'

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'custom'

const PRESET_LABELS: Record<Preset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  custom: 'Custom',
}

const shiftDate = (iso: string, days: number): string => {
  const ms = new Date(`${iso}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const presetRange = (preset: Preset, todayIso: string): { from: string; to: string } => {
  switch (preset) {
    case 'today':
      return { from: todayIso, to: todayIso }
    case 'yesterday': {
      const d = shiftDate(todayIso, -1)
      return { from: d, to: d }
    }
    case '7d':
      return { from: shiftDate(todayIso, -6), to: todayIso }
    case '30d':
      return { from: shiftDate(todayIso, -29), to: todayIso }
    default:
      return { from: todayIso, to: todayIso }
  }
}

const formatPercent = (value: number): string =>
  `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`

const CouponOutreachReportView = () => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const today = useMemo(() => istDateString(), [])

  const [preset, setPreset] = useState<Preset>('7d')
  const initialRange = useMemo(() => presetRange('7d', today), [today])
  const [fromDate, setFromDate] = useState(initialRange.from)
  const [toDate, setToDate] = useState(initialRange.to)
  const [report, setReport] = useState<CouponOutreachReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePresetChange = (next: Preset) => {
    setPreset(next)
    if (next !== 'custom') {
      const range = presetRange(next, today)
      setFromDate(range.from)
      setToDate(range.to)
    }
  }

  const run = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const result = await couponOutreachReportApi.computeReport(token, fromDate, toDate)
      setReport(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to compute report'
      logger.error('coupon_outreach.report_load_failed', err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [token, fromDate, toDate])

  // Auto-run on first mount with the default preset so the user sees data
  // immediately instead of an empty panel.
  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="ui-section-stack">
      {/* Date controls */}
      <div className="ui-toolbar flex flex-wrap items-center gap-2">
        <select
          value={preset}
          onChange={(e) => handlePresetChange(e.target.value as Preset)}
          className="ui-field min-h-9 text-xs"
          aria-label="Preset range"
        >
          {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
            <option key={p} value={p}>
              {PRESET_LABELS[p]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value)
              setPreset('custom')
            }}
            className="ui-field min-h-9 text-xs"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value)
              setPreset('custom')
            }}
            className="ui-field min-h-9 text-xs"
          />
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="ui-btn ui-btn-primary min-h-9 text-xs"
        >
          {loading ? 'Running…' : 'Run report'}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </div>
      ) : null}

      {loading && !report ? (
        <div className="py-10 text-center text-sm text-muted">Crunching numbers…</div>
      ) : null}

      {report ? (
        <ReportContent report={report} />
      ) : !loading && !error ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-surface/80 px-5 py-10 text-center text-sm text-muted">
          Pick a date range and click <strong>Run report</strong>.
        </div>
      ) : null}
    </div>
  )
}

// ─── Report content (split out so we can return early cleanly) ─────

const ReportContent = ({ report }: { report: CouponOutreachReport }) => {
  const { summary, revenue, perTelecaller, batches, fromDate, toDate } = report

  if (summary.totalAssigned === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-surface/80 px-5 py-10 text-center text-sm text-muted">
        No outreach batches found between {fromDate} and {toDate}.
      </div>
    )
  }

  return (
    <div className="ui-section-stack">
      {/* Range header */}
      <div className="text-xs text-muted">
        Range:{' '}
        <span className="text-text">
          {fromDate}
          {fromDate !== toDate ? ` → ${toDate}` : ''}
        </span>{' '}
        · {batches.length} {batches.length === 1 ? 'batch' : 'batches'}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
        <SummaryCard label="Assigned" value={summary.totalAssigned} />
        <SummaryCard label="Contacted" value={summary.contacted} tone="info" />
        <SummaryCard label="Done" value={summary.done} tone="success" />
        <SummaryCard label="Pending / Missed" value={summary.missedCalls} tone="warning" />
        <SummaryCard
          label="Conversion"
          value={formatPercent(summary.conversionRate)}
          tone="critical"
        />
      </div>

      {/* Calls + revenue strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <RevenueTile
          label="Calls Completed"
          primary={String(summary.callsCompleted)}
          secondary={`of ${summary.totalAssigned} assigned`}
        />
        <RevenueTile
          label="Bookings Converted"
          primary={String(summary.convertedBookings)}
          secondary={`from ${summary.callsCompleted} calls`}
        />
        <RevenueTile
          label="Revenue Generated"
          primary={formatRupees(revenue.totalRevenue)}
          secondary={`Avg ticket ${formatRupees(revenue.averageTicket)}`}
        />
      </div>

      {/* Per-telecaller breakdown */}
      <div className="rounded-xl border border-border/60 bg-panel shadow-sm overflow-hidden">
        <div className="border-b border-border/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Per-telecaller breakdown
        </div>
        {perTelecaller.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted">
            No telecaller data for this range.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface/40 text-[11px] uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th className="px-4 py-2">Telecaller</th>
                  <th className="px-3 py-2 text-right">Assigned</th>
                  <th className="px-3 py-2 text-right">Contacted</th>
                  <th className="px-3 py-2 text-right">Done</th>
                  <th className="px-3 py-2 text-right">Pending</th>
                  <th className="px-3 py-2 text-right">Converted</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">Conv%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {perTelecaller.map((row) => (
                  <tr key={row.telecallerId}>
                    <td className="px-4 py-2 text-text">{row.telecallerId}</td>
                    <td className="px-3 py-2 text-right text-text">{row.assigned}</td>
                    <td className="px-3 py-2 text-right text-text">{row.contacted}</td>
                    <td className="px-3 py-2 text-right text-text">{row.done}</td>
                    <td className="px-3 py-2 text-right text-text">{row.pending}</td>
                    <td className="px-3 py-2 text-right text-text">{row.convertedBookings}</td>
                    <td className="px-3 py-2 text-right text-text">{formatRupees(row.revenue)}</td>
                    <td className="px-3 py-2 text-right text-text">
                      {formatPercent(row.conversionRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const TONE_CLASSES: Record<'default' | 'info' | 'success' | 'warning' | 'critical', string> = {
  default: 'ui-panel',
  info: 'rounded-xl border border-info/35 bg-info/10 shadow-sm',
  success: 'rounded-xl border border-success/35 bg-success/10 shadow-sm',
  warning: 'rounded-xl border border-warning/35 bg-warning/10 shadow-sm',
  critical: 'rounded-xl border border-critical/35 bg-critical/10 shadow-sm',
}

const TONE_LABEL_CLASSES: Record<'default' | 'info' | 'success' | 'warning' | 'critical', string> =
  {
    default: 'text-muted',
    info: 'text-info',
    success: 'text-success',
    warning: 'text-warning',
    critical: 'text-critical',
  }

const SummaryCard = ({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number | string
  tone?: 'default' | 'info' | 'success' | 'warning' | 'critical'
}) => (
  <div className={`${TONE_CLASSES[tone]} p-3 sm:p-4`}>
    <p className="font-display text-2xl sm:text-3xl font-semibold leading-none text-text">
      {value}
    </p>
    <p
      className={`mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] ${TONE_LABEL_CLASSES[tone]}`}
    >
      {label}
    </p>
  </div>
)

const RevenueTile = ({
  label,
  primary,
  secondary,
}: {
  label: string
  primary: string
  secondary: string
}) => (
  <div className="ui-panel p-4">
    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
    <p className="mt-2 font-display text-2xl font-semibold leading-none text-text">{primary}</p>
    <p className="mt-1 text-xs text-muted">{secondary}</p>
  </div>
)

export default CouponOutreachReportView
