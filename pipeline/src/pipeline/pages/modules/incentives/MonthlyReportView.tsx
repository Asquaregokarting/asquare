import { useCallback, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Building2, Download, TrendingUp, Trophy, Users } from 'lucide-react'
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable'
import { useAuth } from '../../../features/auth/auth-context'
import { useLocations } from '../../../hooks/useLocations'
import { logger } from '../../../../lib/logger'
import { listCashierIncentives } from '../../../api/incentives-firestore'
import { telecallerPerformanceApi } from '../../../api/telecaller-performance'
import {
  aggregateCashierMonth,
  buildBranchSummary,
  mapTelecallerMonth,
} from '../../../features/incentives-report/monthly-aggregator'
import { exportMonthlyExcel } from '../../../features/incentives-report/excel-export'
import { exportMonthlyPdf } from '../../../features/incentives-report/pdf-export'
import { monthLabelFromKey } from '../../../features/incentives-report/filename'
import {
  currentMonthKeyIST,
  monthBounds,
  weekKeysOverlappingMonth,
} from '../../../features/incentives-report/month-utils'
import type {
  CashierMonthlyRow,
  MonthlyReportPayload,
  TelecallerMonthlyRow,
} from '../../../features/incentives-report/types'
import type { CashierIncentiveRecord } from '../../../api/types'
import { CashierDetailModal } from './CashierDetailModal'

const currency = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

const KpiCard = ({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  tone: 'success' | 'info' | 'muted'
}) => {
  const toneClass = {
    success: 'text-green-600 dark:text-green-400',
    info: 'text-blue-600 dark:text-blue-400',
    muted: 'text-muted',
  }[tone]
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-panel p-4 shadow-sm">
      <div className={`rounded-lg bg-surface/60 p-2.5 ${toneClass}`}>{icon}</div>
      <div>
        <p className="text-xs font-medium text-muted">{label}</p>
        <p className="text-lg font-bold text-text">{value}</p>
      </div>
    </div>
  )
}

export const MonthlyReportView = () => {
  const { session } = useAuth()
  const { enabledLocations } = useLocations()
  const [monthKey, setMonthKey] = useState<string>(currentMonthKeyIST())
  const [branchId, setBranchId] = useState<string>('')
  const [format, setFormat] = useState<'xlsx' | 'pdf'>('xlsx')
  const [tab, setTab] = useState<'cashiers' | 'telecallers'>('cashiers')
  const [exporting, setExporting] = useState(false)

  const branchNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const l of enabledLocations) m[l.branchId] = l.displayName
    return m
  }, [enabledLocations])

  const branchLabel = useMemo(() => {
    if (!branchId) return 'All Branches'
    return branchNameById[branchId] ?? branchId
  }, [branchId, branchNameById])

  const query = useQuery({
    queryKey: ['incentives.monthly', monthKey, branchId || 'all'],
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const { fromDate, toDate } = monthBounds(monthKey)
      const weekKeys = weekKeysOverlappingMonth(monthKey)
      const cashierWeekQueries = weekKeys.map((weekKey) =>
        listCashierIncentives({
          weekKey,
          locationId: branchId || undefined,
          status: 'active',
        }),
      )
      try {
        const [weekResults, perfResult] = await Promise.all([
          Promise.all(cashierWeekQueries),
          telecallerPerformanceApi.listPerformance({ monthKey }),
        ])
        const seen = new Set<string>()
        const records: CashierIncentiveRecord[] = []
        for (const week of weekResults) {
          for (const r of week) {
            if (seen.has(r.id)) continue
            if (r.transactionDate < fromDate || r.transactionDate > toDate) continue
            seen.add(r.id)
            records.push(r)
          }
        }
        const recordsByCashierKey = new Map<string, CashierIncentiveRecord[]>()
        for (const r of records) {
          const key = `${r.locationId}::${r.cashierId}`
          const list = recordsByCashierKey.get(key)
          if (list) list.push(r)
          else recordsByCashierKey.set(key, [r])
        }
        return {
          cashiers: aggregateCashierMonth(records, branchNameById),
          telecallers: mapTelecallerMonth(perfResult.performance),
          recordsByCashierKey,
        }
      } catch (err) {
        logger.error('incentives.monthly.load_failed', err)
        throw err
      }
    },
  })

  const cashiers: CashierMonthlyRow[] = query.data?.cashiers ?? []
  const telecallers: TelecallerMonthlyRow[] = query.data?.telecallers ?? []
  const recordsByCashierKey = query.data?.recordsByCashierKey ?? new Map()
  const isFirstLoad = query.isPending
  const isRefreshing = query.isFetching && !isFirstLoad

  const [detailKey, setDetailKey] = useState<string | null>(null)
  const detailRow = useMemo(
    () =>
      detailKey
        ? (cashiers.find((c) => `${c.branchId}::${c.cashierId}` === detailKey) ?? null)
        : null,
    [detailKey, cashiers],
  )
  const detailRecords = detailKey ? (recordsByCashierKey.get(detailKey) ?? []) : []

  const totals = useMemo(() => {
    const cashier = cashiers.reduce((s, r) => s + r.totalIncentive, 0)
    const telecaller = telecallers.reduce((s, r) => s + r.incentiveEarned, 0)
    const employees =
      cashiers.filter((c) => c.totalIncentive > 0).length +
      telecallers.filter((t) => t.incentiveEarned > 0).length
    const branches = new Set(cashiers.map((c) => c.branchId)).size
    return { cashier, telecaller, employees, branches }
  }, [cashiers, telecallers])

  const handleExport = useCallback(async () => {
    if (cashiers.length === 0 && telecallers.length === 0) return
    setExporting(true)
    try {
      const payload: MonthlyReportPayload = {
        monthKey,
        monthLabel: monthLabelFromKey(monthKey),
        branchLabel,
        generatedAt: new Date().toISOString(),
        generatedByName: session?.user.name ?? session?.user.id ?? 'Unknown',
        cashiers,
        telecallers,
        branchSummary: buildBranchSummary(cashiers, telecallers, branchNameById),
      }
      if (format === 'xlsx') await exportMonthlyExcel(payload)
      else exportMonthlyPdf(payload)
    } catch (err) {
      logger.error('incentives.monthly.export_failed', err)
    } finally {
      setExporting(false)
    }
  }, [cashiers, telecallers, monthKey, branchLabel, branchNameById, format, session])

  const cashierColumns: DataTableColumn<CashierMonthlyRow>[] = [
    { key: 'branch', header: 'Branch', render: (r) => r.branchName },
    { key: 'name', header: 'Cashier', render: (r) => r.cashierName },
    { key: 'txns', header: 'Txns', render: (r) => r.qualifyingTxns },
    { key: 'np', header: 'Non-Performing', render: (r) => currency(r.byNonPerforming) },
    { key: 'gk', header: 'Go-Kart Laps', render: (r) => currency(r.byGokartLaps) },
    { key: 'both', header: 'Both', render: (r) => currency(r.byBoth) },
    {
      key: 'total',
      header: 'Total',
      render: (r) => (
        <span className="font-semibold text-green-600 dark:text-green-400">
          {currency(r.totalIncentive)}
        </span>
      ),
    },
  ]

  const telecallerColumns: DataTableColumn<TelecallerMonthlyRow>[] = [
    { key: 'name', header: 'Telecaller', render: (r) => r.telecallerName },
    {
      key: 'plan',
      header: 'Plan',
      render: (r) =>
        r.hasPlan ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
            Active
          </span>
        ) : (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">No Plan</span>
        ),
    },
    { key: 'bookings', header: 'Bookings', render: (r) => r.bookingCount },
    { key: 'booked', header: 'Booked', render: (r) => currency(r.bookedAmount) },
    { key: 'target', header: 'Target', render: (r) => currency(r.targetAmount) },
    {
      key: 'achv',
      header: 'Achievement',
      render: (r) => `${r.achievementPercent.toFixed(1)}%`,
    },
    { key: 'pct', header: 'Inc %', render: (r) => `${r.incentivePercentUsed.toFixed(1)}%` },
    {
      key: 'earned',
      header: 'Earned',
      render: (r) => (
        <span className="font-semibold text-green-600 dark:text-green-400">
          {currency(r.incentiveEarned)}
        </span>
      ),
    },
  ]

  const isEmpty = cashiers.length === 0 && telecallers.length === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="month"
          className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
          value={monthKey}
          onChange={(e) => setMonthKey(e.target.value || currentMonthKeyIST())}
        />
        <select
          className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
        >
          <option value="">All Branches</option>
          {enabledLocations.map((l) => (
            <option key={l.branchId} value={l.branchId}>
              {l.displayName}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
          value={format}
          onChange={(e) => setFormat(e.target.value as 'xlsx' | 'pdf')}
        >
          <option value="xlsx">Excel (.xlsx)</option>
          <option value="pdf">PDF (.pdf)</option>
        </select>
        <button
          className="ui-btn ui-btn-info inline-flex items-center gap-2 px-4 text-sm"
          disabled={exporting || isFirstLoad || isEmpty}
          onClick={handleExport}
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Exporting...' : `Export ${format.toUpperCase()}`}
        </button>
        {isRefreshing && <span className="text-xs text-muted">Refreshing…</span>}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Cashier Incentive"
          value={currency(totals.cashier)}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="success"
        />
        <KpiCard
          label="Telecaller Incentive"
          value={currency(totals.telecaller)}
          icon={<Trophy className="h-5 w-5" />}
          tone="info"
        />
        <KpiCard
          label="Employees Paid"
          value={totals.employees}
          icon={<Users className="h-5 w-5" />}
          tone="muted"
        />
        <KpiCard
          label="Branches Covered"
          value={totals.branches}
          icon={<Building2 className="h-5 w-5" />}
          tone="muted"
        />
      </div>

      <div className="flex gap-2 border-b border-border/50">
        <button
          className={`px-4 py-2 text-sm font-medium ${tab === 'cashiers' ? 'border-b-2 border-primary text-text' : 'text-muted'}`}
          onClick={() => setTab('cashiers')}
        >
          Cashiers ({cashiers.length})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium ${tab === 'telecallers' ? 'border-b-2 border-primary text-text' : 'text-muted'}`}
          onClick={() => setTab('telecallers')}
        >
          Telecallers ({telecallers.length})
        </button>
      </div>

      {isFirstLoad ? (
        <div className="py-12 text-center text-sm text-muted">Loading monthly report...</div>
      ) : tab === 'cashiers' ? (
        <DataTable
          columns={cashierColumns}
          rows={cashiers}
          rowKey={(r) => `${r.branchId}_${r.cashierId}`}
          emptyMessage="No cashier incentives for this month"
          onRowClick={(r) => setDetailKey(`${r.branchId}::${r.cashierId}`)}
        />
      ) : (
        <DataTable
          columns={telecallerColumns}
          rows={telecallers}
          rowKey={(r) => r.telecallerId}
          emptyMessage="No telecaller performance for this month"
        />
      )}

      <CashierDetailModal
        open={!!detailRow}
        onClose={() => setDetailKey(null)}
        cashierName={detailRow?.cashierName ?? ''}
        branchName={detailRow?.branchName ?? ''}
        monthLabel={monthLabelFromKey(monthKey)}
        records={detailRecords}
      />
    </div>
  )
}
