import { useCallback, useEffect, useMemo, useState } from 'react'
import { TrendingUp, Trophy, Target, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { useAuth } from '../../features/auth/auth-context'
import { useLocations } from '../../hooks/useLocations'
import { todayIST } from '../../lib/ist-date'
import { fmtDateIST, fmtTimeShortIST } from '../../../lib/date-format'
import { logger } from '../../../lib/logger'
import {
  getIncentiveConfig,
  updateIncentiveConfig,
  listCashierIncentives,
  getCashierIncentiveSummary,
  listWeeklyGameReports,
  getWeeklyGameReport,
  type IncentiveFilters,
  type IncentiveSummary,
} from '../../api/incentives-firestore'
import type {
  CashierIncentiveRecord,
  IncentiveConfig,
  WeeklyGameReport,
  WeeklyGameReportEntry,
} from '../../api/types'
import { DEFAULT_INCENTIVE_CONFIG } from '../../api/incentives-firestore'
import { getCurrentWeekKey } from '../../features/cashier-incentives/week-utils'
import { isPrivilegedRole } from '../../api/firestore-session'
import { listFirestoreActivityHierarchy } from '../../api/activities-firestore'
import { telecallerPerformanceApi } from '../../api/telecaller-performance'
import { MonthlyReportView } from './incentives/MonthlyReportView'
import { MonthlyExportPopover } from './incentives/MonthlyExportPopover'

// ─── Types ──────────────────────────────────────────────────────────────────

export type IncentivesView =
  | 'dashboard'
  | 'weeklyReport'
  | 'cashierBreakdown'
  | 'config'
  | 'monthly'

interface IncentivesModuleProps {
  view: IncentivesView
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const currency = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

const reasonLabel = (reason: string) => {
  switch (reason) {
    case 'non_performing':
      return 'Non-Performing Game'
    case 'gokart_laps':
      return 'Go-Kart ≥12 Laps'
    case 'both':
      return 'NP + Go-Kart Laps'
    default:
      return reason
  }
}

const reasonBadge = (reason: string) => {
  const base = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium'
  switch (reason) {
    case 'non_performing':
      return (
        <span
          className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400`}
        >
          {reasonLabel(reason)}
        </span>
      )
    case 'gokart_laps':
      return (
        <span
          className={`${base} bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400`}
        >
          {reasonLabel(reason)}
        </span>
      )
    case 'both':
      return (
        <span
          className={`${base} bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400`}
        >
          {reasonLabel(reason)}
        </span>
      )
    default:
      return <span className={`${base} bg-gray-100 text-gray-700`}>{reason}</span>
  }
}

const statusBadge = (isNonPerforming: boolean) => {
  const base = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium'
  return isNonPerforming ? (
    <span className={`${base} bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`}>
      <XCircle className="h-3 w-3" /> Non-Performing
    </span>
  ) : (
    <span
      className={`${base} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`}
    >
      <CheckCircle2 className="h-3 w-3" /> Performing
    </span>
  )
}

const thresholdTypeBadge = (type: string) => {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium'
  switch (type) {
    case 'manual-game':
      return (
        <span
          className={`${base} bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400`}
        >
          Per-Game
        </span>
      )
    case 'manual-global':
      return (
        <span className={`${base} bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400`}>
          Global
        </span>
      )
    default:
      return (
        <span className={`${base} bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400`}>
          Auto
        </span>
      )
  }
}

// ─── KPI Card ───────────────────────────────────────────────────────────────

const KpiCard = ({
  label,
  value,
  icon,
  tone = 'muted',
  active = false,
  onClick,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  tone?: 'success' | 'warning' | 'critical' | 'info' | 'muted'
  active?: boolean
  onClick?: () => void
}) => {
  const toneClass: Record<string, string> = {
    success: 'text-green-600 dark:text-green-400',
    warning: 'text-amber-600 dark:text-amber-400',
    critical: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400',
    muted: 'text-muted',
  }

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-panel p-4 shadow-sm transition-colors ${active ? 'border-primary ring-1 ring-primary/40' : 'border-border/50'} ${onClick ? 'cursor-pointer hover:border-primary/60' : ''}`}
      onClick={onClick}
    >
      <div className={`rounded-lg bg-surface/60 p-2.5 ${toneClass[tone]}`}>{icon}</div>
      <div>
        <p className="text-xs font-medium text-muted">{label}</p>
        <p className="text-lg font-bold text-text">{value}</p>
      </div>
    </div>
  )
}

// ─── Dashboard View ─────────────────────────────────────────────────────────

const DashboardView = () => {
  const { session } = useAuth()
  const { lockedLocationId } = useLocations()
  const isAdmin = session?.user.role && isPrivilegedRole(session.user.role)
  const cashierId = isAdmin ? undefined : session?.user.id
  const locationId = lockedLocationId ?? undefined

  const [records, setRecords] = useState<CashierIncentiveRecord[]>([])
  const [summary, setSummary] = useState<IncentiveSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const today = todayIST()
  const weekKey = getCurrentWeekKey()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const filters: IncentiveFilters = {
        cashierId,
        locationId,
        weekKey,
        status: 'active',
      }
      const [recs, sum] = await Promise.all([
        listCashierIncentives({ ...filters, fromDate: today }),
        getCashierIncentiveSummary(filters),
      ])
      setRecords(recs)
      setSummary(sum)
    } catch (err) {
      logger.error('incentives.dashboard.load_failed', err)
    } finally {
      setLoading(false)
    }
  }, [cashierId, locationId, weekKey, today])

  useEffect(() => {
    loadData()
  }, [loadData])

  const todayTotal = useMemo(
    () => records.filter((r) => r.status === 'active').reduce((s, r) => s + r.incentiveAmount, 0),
    [records],
  )

  const columns: DataTableColumn<CashierIncentiveRecord>[] = useMemo(() => {
    const cols: DataTableColumn<CashierIncentiveRecord>[] = [
      {
        key: 'invoice',
        header: 'Invoice',
        render: (r) => <span className="font-mono text-xs">{r.invoiceNumber}</span>,
      },
      { key: 'item', header: 'Item', render: (r) => <span className="text-sm">{r.itemName}</span> },
      { key: 'reason', header: 'Reason', render: (r) => reasonBadge(r.reason) },
      { key: 'amount', header: 'Item Amount', render: (r) => currency(r.itemAmount) },
      {
        key: 'incentive',
        header: `Incentive (${summary?.totalIncentiveAmount ? (records[0]?.incentivePercent ?? 2) : 2}%)`,
        render: (r) => (
          <span className="font-semibold text-green-600 dark:text-green-400">
            {currency(r.incentiveAmount)}
          </span>
        ),
      },
      { key: 'time', header: 'Time', render: (r) => fmtTimeShortIST(r.createdAt) },
    ]

    if (isAdmin) {
      cols.splice(1, 0, {
        key: 'cashier',
        header: 'Cashier',
        render: (r) => r.cashierName,
      })
    }

    return cols
  }, [isAdmin, summary, records])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Today's Earnings"
          value={currency(todayTotal)}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="success"
        />
        <KpiCard
          label="This Week's Total"
          value={currency(summary?.totalIncentiveAmount ?? 0)}
          icon={<Trophy className="h-5 w-5" />}
          tone="info"
        />
        <KpiCard
          label="Qualifying Transactions"
          value={summary?.activeCount ?? 0}
          icon={<Target className="h-5 w-5" />}
          tone="muted"
        />
        <KpiCard
          label="Reversed"
          value={summary?.reversedCount ?? 0}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={summary?.reversedCount ? 'warning' : 'muted'}
        />
      </div>

      {summary && (
        <div className="flex flex-wrap gap-4 rounded-xl border border-border/50 bg-panel p-4 shadow-sm">
          <div className="text-sm">
            <span className="text-muted">By Non-Performing: </span>
            <span className="font-semibold">
              {currency(summary.byReason['non_performing'] ?? 0)}
            </span>
          </div>
          <div className="text-sm">
            <span className="text-muted">By Go-Kart Laps: </span>
            <span className="font-semibold">{currency(summary.byReason['gokart_laps'] ?? 0)}</span>
          </div>
          <div className="text-sm">
            <span className="text-muted">Both: </span>
            <span className="font-semibold">{currency(summary.byReason['both'] ?? 0)}</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Loading incentives...</div>
      ) : (
        <DataTable
          columns={columns}
          rows={records}
          rowKey={(r) => r.id}
          emptyMessage="No incentive records for today"
        />
      )}
    </div>
  )
}

// ─── Weekly Report View ─────────────────────────────────────────────────────

const WeeklyReportView = () => {
  const { session } = useAuth()
  const isAdmin = session?.user.role && isPrivilegedRole(session.user.role)
  const { enabledLocations } = useLocations()
  const [reports, setReports] = useState<WeeklyGameReport[]>([])
  const [selectedWeek, setSelectedWeek] = useState<string>('')
  const [selectedLocation, setSelectedLocation] = useState<string>('')
  const [report, setReport] = useState<WeeklyGameReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'non-performing' | 'performing'>('all')

  const loadReports = useCallback(async () => {
    setLoading(true)
    try {
      const reps = await listWeeklyGameReports(12)
      setReports(reps)
      if (reps.length > 0 && !selectedWeek) {
        setSelectedWeek(reps[0].weekKey)
      }
    } catch (err) {
      logger.error('incentives.weekly.list_failed', err)
    } finally {
      setLoading(false)
    }
  }, [selectedWeek])

  useEffect(() => {
    loadReports()
  }, [loadReports])

  useEffect(() => {
    if (enabledLocations.length > 0 && !selectedLocation) {
      setSelectedLocation(enabledLocations[0].slug)
    }
  }, [enabledLocations, selectedLocation])

  useEffect(() => {
    if (!selectedWeek) return
    setLoading(true)
    getWeeklyGameReport(selectedWeek)
      .then(setReport)
      .catch((err) => logger.error('incentives.weekly.load_failed', err))
      .finally(() => setLoading(false))
  }, [selectedWeek])

  const handleGenerateNow = useCallback(async () => {
    if (!session) return
    setGenerating(true)
    try {
      const { initializeFirebaseApp } = await import('../../lib/firebase')
      const { getAuth } = await import('firebase/auth')
      const { ensureFirebaseAuthForStorage } = await import('../../lib/firebase-auth')

      const app = initializeFirebaseApp()
      if (!app) throw new Error('Firebase app is not configured.')
      const firebaseAuth = getAuth(app)
      if (!firebaseAuth.currentUser) {
        await ensureFirebaseAuthForStorage()
      }
      if (!firebaseAuth.currentUser) throw new Error('Not authenticated in Firebase.')
      const idToken = await firebaseAuth.currentUser.getIdToken()

      const res = await fetch(
        'https://asia-south1-a-square-6720c.cloudfunctions.net/runWeeklyGameReportNow',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ userId: session.user.id }),
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as Record<string, string>).message || `HTTP ${res.status}`)
      }
      // Reload reports after generation
      const reps = await listWeeklyGameReports(12)
      setReports(reps)
      if (reps.length > 0) {
        const weekToSelect = reps[0].weekKey
        setSelectedWeek(weekToSelect)
        // Also reload the report data directly
        const freshReport = await getWeeklyGameReport(weekToSelect)
        setReport(freshReport)
      }
    } catch (err) {
      logger.error('incentives.weekly.generate_failed', err)
    } finally {
      setGenerating(false)
    }
  }, [session])

  const games = useMemo(() => {
    if (!report || !selectedLocation) return []
    // Try both slug and branch ID (locationReports may be keyed by either)
    const locData =
      report.locationReports[selectedLocation] ??
      report.locationReports[
        enabledLocations.find((l) => l.slug === selectedLocation)?.branchId ?? ''
      ]
    return locData?.games ?? []
  }, [report, selectedLocation, enabledLocations])

  const summaryStats = useMemo(() => {
    const total = games.length
    const np = games.filter((g) => g.isNonPerforming).length
    const totalRevenue = games.reduce((s, g) => s + g.weeklyRevenue, 0)
    return { total, np, performing: total - np, totalRevenue }
  }, [games])

  const columns: DataTableColumn<WeeklyGameReportEntry>[] = [
    { key: 'game', header: 'Game', render: (r) => r.gameName },
    { key: 'variant', header: 'Variant', render: (r) => r.variantLabel },
    { key: 'price', header: 'Price', render: (r) => currency(r.variantPrice) },
    { key: 'threshold', header: 'Threshold', render: (r) => currency(r.threshold) },
    { key: 'thresholdType', header: 'Type', render: (r) => thresholdTypeBadge(r.thresholdType) },
    { key: 'revenue', header: 'Week Revenue', render: (r) => currency(r.weeklyRevenue) },
    { key: 'txns', header: 'Txns', render: (r) => r.weeklyTxnCount },
    { key: 'qty', header: 'Qty', render: (r) => r.weeklyQuantity },
    { key: 'status', header: 'Status', render: (r) => statusBadge(r.isNonPerforming) },
    {
      key: 'laps',
      header: 'Laps',
      render: (r) => (r.laps != null ? r.laps : '-'),
    },
  ]

  // No reports exist yet — show empty state with generate button
  if (!loading && reports.length === 0) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Total Games"
            value={0}
            icon={<Target className="h-5 w-5" />}
            tone="muted"
          />
          <KpiCard
            label="Non-Performing"
            value={0}
            icon={<XCircle className="h-5 w-5" />}
            tone="muted"
          />
          <KpiCard
            label="Performing"
            value={0}
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone="muted"
          />
          <KpiCard
            label="Total Revenue"
            value={currency(0)}
            icon={<TrendingUp className="h-5 w-5" />}
            tone="muted"
          />
        </div>
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border/50 bg-panel py-16 shadow-sm">
          <AlertTriangle className="h-10 w-10 text-amber-500" />
          <p className="text-sm text-muted">No weekly reports generated yet.</p>
          <p className="text-xs text-muted">
            Reports are automatically generated every Friday at 11:30 PM IST.
          </p>
          <button
            className="ui-btn ui-btn-info mt-2 px-6"
            disabled={generating}
            onClick={handleGenerateNow}
          >
            {generating ? 'Generating...' : 'Generate Report Now'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
          value={selectedWeek}
          onChange={(e) => setSelectedWeek(e.target.value)}
        >
          {reports.map((r) => (
            <option key={r.weekKey} value={r.weekKey}>
              {r.weekKey} ({r.weekStart} to {r.weekEnd})
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
        >
          {enabledLocations.map((l) => (
            <option key={l.slug} value={l.slug}>
              {l.displayName}
            </option>
          ))}
        </select>
        {isAdmin && (
          <button
            className="ui-btn ui-btn-neutral px-4 text-sm"
            disabled={generating}
            onClick={handleGenerateNow}
          >
            {generating ? 'Regenerating...' : 'Regenerate Report'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Games"
          value={summaryStats.total}
          icon={<Target className="h-5 w-5" />}
          tone="muted"
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <KpiCard
          label="Non-Performing"
          value={summaryStats.np}
          icon={<XCircle className="h-5 w-5" />}
          tone="critical"
          active={statusFilter === 'non-performing'}
          onClick={() => setStatusFilter('non-performing')}
        />
        <KpiCard
          label="Performing"
          value={summaryStats.performing}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="success"
          active={statusFilter === 'performing'}
          onClick={() => setStatusFilter('performing')}
        />
        <KpiCard
          label="Total Revenue"
          value={currency(summaryStats.totalRevenue)}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="info"
        />
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Loading report...</div>
      ) : (
        <DataTable
          columns={columns}
          rows={
            statusFilter === 'all'
              ? games
              : games.filter((g) =>
                  statusFilter === 'non-performing' ? g.isNonPerforming : !g.isNonPerforming,
                )
          }
          rowKey={(r) => `${r.gameId}_${r.subGameId}_${r.variantId}`}
          emptyMessage="No games found for this location/week"
        />
      )}
    </div>
  )
}

// ─── Cashier Breakdown View ─────────────────────────────────────────────────

const CashierBreakdownView = () => {
  const { enabledLocations, lockedLocationId } = useLocations()
  const [summary, setSummary] = useState<IncentiveSummary | null>(null)
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeekKey())
  const [selectedLocation, setSelectedLocation] = useState(
    lockedLocationId ?? enabledLocations[0]?.slug ?? '',
  )
  const [reports, setReports] = useState<WeeklyGameReport[]>([])
  const [loading, setLoading] = useState(true)
  const [detailCashierId, setDetailCashierId] = useState<string | null>(null)
  const [detailRecords, setDetailRecords] = useState<CashierIncentiveRecord[]>([])

  useEffect(() => {
    listWeeklyGameReports(12)
      .then(setReports)
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    getCashierIncentiveSummary({
      weekKey: selectedWeek,
      locationId: selectedLocation || undefined,
      status: 'active',
    })
      .then(setSummary)
      .catch((err) => logger.error('incentives.cashier_breakdown.load_failed', err))
      .finally(() => setLoading(false))
  }, [selectedWeek, selectedLocation])

  const loadCashierDetail = useCallback(
    async (cashierId: string) => {
      setDetailCashierId(cashierId)
      try {
        const recs = await listCashierIncentives({
          cashierId,
          weekKey: selectedWeek,
          locationId: selectedLocation || undefined,
          status: 'active',
        })
        setDetailRecords(recs)
      } catch {
        setDetailRecords([])
      }
    },
    [selectedWeek, selectedLocation],
  )

  type CashierRow = IncentiveSummary['byCashier'][number]

  const columns: DataTableColumn<CashierRow>[] = [
    { key: 'cashier', header: 'Cashier', render: (r) => r.cashierName || r.cashierId },
    {
      key: 'total',
      header: 'Total Incentive',
      render: (r) => (
        <span className="font-semibold text-green-600 dark:text-green-400">
          {currency(r.totalAmount)}
        </span>
      ),
    },
    { key: 'count', header: 'Transactions', render: (r) => r.count },
  ]

  const detailColumns: DataTableColumn<CashierIncentiveRecord>[] = [
    {
      key: 'invoice',
      header: 'Invoice',
      render: (r) => <span className="font-mono text-xs">{r.invoiceNumber}</span>,
    },
    { key: 'item', header: 'Item', render: (r) => r.itemName },
    { key: 'reason', header: 'Reason', render: (r) => reasonBadge(r.reason) },
    { key: 'amount', header: 'Item Amt', render: (r) => currency(r.itemAmount) },
    {
      key: 'incentive',
      header: 'Incentive',
      render: (r) => (
        <span className="font-semibold text-green-600">{currency(r.incentiveAmount)}</span>
      ),
    },
    { key: 'date', header: 'Date', render: (r) => fmtDateIST(r.createdAt) },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
          value={selectedWeek}
          onChange={(e) => setSelectedWeek(e.target.value)}
        >
          <option value={getCurrentWeekKey()}>Current Week</option>
          {reports.map((r) => (
            <option key={r.weekKey} value={r.weekKey}>
              {r.weekKey} ({r.weekStart} - {r.weekEnd})
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
        >
          <option value="">All Branches</option>
          {enabledLocations.map((l) => (
            <option key={l.slug} value={l.slug}>
              {l.displayName}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <MonthlyExportPopover
            branchId={
              selectedLocation
                ? enabledLocations.find((l) => l.slug === selectedLocation)?.branchId
                : undefined
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard
          label="Total Incentives Paid"
          value={currency(summary?.totalIncentiveAmount ?? 0)}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="success"
        />
        <KpiCard
          label="Active Records"
          value={summary?.activeCount ?? 0}
          icon={<Target className="h-5 w-5" />}
          tone="info"
        />
        <KpiCard
          label="Cashiers"
          value={summary?.byCashier.length ?? 0}
          icon={<Trophy className="h-5 w-5" />}
          tone="muted"
        />
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Loading...</div>
      ) : (
        <DataTable
          columns={columns}
          rows={summary?.byCashier ?? []}
          rowKey={(r) => r.cashierId}
          emptyMessage="No incentive records for this period"
          onRowClick={(r) => loadCashierDetail(r.cashierId)}
        />
      )}

      {detailCashierId && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">
              Detail:{' '}
              {summary?.byCashier.find((c) => c.cashierId === detailCashierId)?.cashierName ??
                detailCashierId}
            </h3>
            <button
              className="text-xs text-muted hover:text-text"
              onClick={() => setDetailCashierId(null)}
            >
              Close
            </button>
          </div>
          <DataTable
            columns={detailColumns}
            rows={detailRecords}
            rowKey={(r) => r.id}
            emptyMessage="No records"
          />
        </div>
      )}
    </div>
  )
}

// ─── Config View ────────────────────────────────────────────────────────────

interface VariantRow {
  locationId: string
  gameId: string
  gameName: string
  subGameId: string
  subGameName: string
  variantId: string
  variantLabel: string
  price: number
  laps: number | null
  overrideKey: string
  customThreshold: number | null
  excluded: boolean
}

const ConfigView = () => {
  const { session } = useAuth()
  const { enabledLocations } = useLocations()
  const [config, setConfig] = useState<IncentiveConfig>(DEFAULT_INCENTIVE_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [variants, setVariants] = useState<VariantRow[]>([])
  const [selectedLocation, setSelectedLocation] = useState('')

  // Draft fields
  const [draftMultiplier, setDraftMultiplier] = useState<string>('')
  const [draftIncentivePercent, setDraftIncentivePercent] = useState<string>('')
  const [draftLapThreshold, setDraftLapThreshold] = useState<string>('')
  const [draftOverrides, setDraftOverrides] = useState<Record<string, string>>({})
  const [telecallerDefaultPercent, setTelecallerDefaultPercent] = useState<number | null>(null)
  const [draftTelecallerDefaultPercent, setDraftTelecallerDefaultPercent] = useState<string>('')
  const [savingTelecaller, setSavingTelecaller] = useState(false)

  // Load config
  useEffect(() => {
    setLoading(true)
    Promise.all([
      getIncentiveConfig(),
      telecallerPerformanceApi.getGlobalConfig().catch(() => null),
    ])
      .then(([c, telecallerConfigResult]) => {
        setConfig(c)
        setDraftMultiplier(c.globalMultiplier != null ? String(c.globalMultiplier) : '')
        setDraftIncentivePercent(String(c.incentivePercent))
        setDraftLapThreshold(String(c.goKartLapThreshold))
        const tcPercent = telecallerConfigResult?.config?.defaultIncentivePercent ?? null
        setTelecallerDefaultPercent(tcPercent)
        setDraftTelecallerDefaultPercent(tcPercent != null ? String(tcPercent) : '')
      })
      .catch((err) => logger.error('incentives.config.load_failed', err))
      .finally(() => setLoading(false))
  }, [])

  // Load variants when location changes
  useEffect(() => {
    if (!selectedLocation) {
      if (enabledLocations.length > 0) setSelectedLocation(enabledLocations[0].slug)
      return
    }
    const loc = enabledLocations.find((l) => l.slug === selectedLocation)
    if (!loc) return

    listFirestoreActivityHierarchy(loc.branchId)
      .then((locations) => {
        const rows: VariantRow[] = []
        const hierarchy = locations[0]
        if (!hierarchy) {
          setVariants([])
          return
        }
        for (const game of hierarchy.games) {
          if (game.status === 'Inactive') continue
          for (const sg of game.subGames) {
            for (const v of sg.variants) {
              if (v.active === false) continue
              const overrideKey = `${loc.branchId}_${game.id}_${sg.id}_${v.id}`
              const override = config.perGameOverrides[overrideKey]
              rows.push({
                locationId: loc.branchId,
                gameId: game.id,
                gameName: game.name,
                subGameId: sg.id,
                subGameName: sg.name,
                variantId: v.id,
                variantLabel: v.label,
                price: v.price,
                laps: v.laps ?? null,
                overrideKey,
                customThreshold: override?.customThreshold ?? null,
                excluded: override?.excluded ?? false,
              })
            }
          }
        }
        setVariants(rows)
      })
      .catch((err) => logger.error('incentives.config.variants_load_failed', err))
  }, [selectedLocation, enabledLocations, config.perGameOverrides])

  const handleSaveTelecallerDefault = useCallback(async () => {
    if (!session) return
    const parsed = Number(draftTelecallerDefaultPercent)
    if (!Number.isFinite(parsed) || parsed < 0) {
      logger.error(
        'incentives.config.telecaller_save_failed',
        new Error('Invalid telecaller default percent'),
      )
      return
    }
    setSavingTelecaller(true)
    try {
      const result = await telecallerPerformanceApi.updateGlobalConfig({
        defaultIncentivePercent: parsed,
        updatedBy: session.user.id,
      })
      setTelecallerDefaultPercent(result.config.defaultIncentivePercent)
      setDraftTelecallerDefaultPercent(String(result.config.defaultIncentivePercent))
    } catch (err) {
      logger.error('incentives.config.telecaller_save_failed', err)
    } finally {
      setSavingTelecaller(false)
    }
  }, [session, draftTelecallerDefaultPercent])

  const handleSaveGlobal = useCallback(async () => {
    if (!session) return
    setSaving(true)
    try {
      const updated = await updateIncentiveConfig(session.token, {
        globalMultiplier: draftMultiplier ? Number(draftMultiplier) : null,
        incentivePercent: Number(draftIncentivePercent) || 2,
        goKartLapThreshold: Number(draftLapThreshold) || 12,
      })
      setConfig(updated)
    } catch (err) {
      logger.error('incentives.config.save_failed', err)
    } finally {
      setSaving(false)
    }
  }, [session, draftMultiplier, draftIncentivePercent, draftLapThreshold])

  const handleSetOverride = useCallback(
    async (overrideKey: string, customThreshold: number | null, excluded: boolean) => {
      if (!session) return
      const newOverrides = {
        ...config.perGameOverrides,
        [overrideKey]: { customThreshold, excluded },
      }
      try {
        const updated = await updateIncentiveConfig(session.token, {
          perGameOverrides: newOverrides,
        })
        setConfig(updated)
      } catch (err) {
        logger.error('incentives.config.override_save_failed', err)
      }
    },
    [session, config.perGameOverrides],
  )

  const columns: DataTableColumn<VariantRow>[] = [
    { key: 'game', header: 'Game', render: (r) => r.gameName },
    { key: 'sub', header: 'Sub-Game', render: (r) => r.subGameName },
    { key: 'variant', header: 'Variant', render: (r) => r.variantLabel },
    { key: 'price', header: 'Price', render: (r) => currency(r.price) },
    {
      key: 'defaultThreshold',
      header: 'Default Threshold',
      render: (r) => {
        const multiplier = config.globalMultiplier ?? config.defaultMultiplier
        return currency(r.price * multiplier)
      },
    },
    {
      key: 'override',
      header: 'Custom Override',
      render: (r) => {
        const draft = draftOverrides[r.overrideKey]
        const displayValue =
          draft !== undefined ? draft : r.customThreshold != null ? String(r.customThreshold) : ''
        const commitOverride = () => {
          const val = (draftOverrides[r.overrideKey] ?? '').trim()
          setDraftOverrides((prev) => {
            const next = { ...prev }
            delete next[r.overrideKey]
            return next
          })
          const newThreshold = val ? Number(val) : null
          if (newThreshold !== r.customThreshold) {
            handleSetOverride(r.overrideKey, newThreshold, r.excluded)
          }
        }
        return (
          <input
            type="number"
            className="w-28 rounded border border-border/60 bg-surface px-2 py-1 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            value={displayValue}
            placeholder="Enter amount"
            onChange={(e) =>
              setDraftOverrides((prev) => ({ ...prev, [r.overrideKey]: e.target.value }))
            }
            onBlur={commitOverride}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        )
      },
    },
    {
      key: 'excluded',
      header: 'Excluded',
      render: (r) => (
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border"
          checked={r.excluded}
          onChange={(e) => handleSetOverride(r.overrideKey, r.customThreshold, e.target.checked)}
        />
      ),
    },
    {
      key: 'laps',
      header: 'Laps',
      render: (r) => (r.laps != null ? r.laps : '-'),
    },
  ]

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted">Loading config...</div>
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/50 bg-panel p-6 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-text">Telecaller Incentive</h3>
        <p className="mb-4 text-xs text-muted">
          Default percentage applied to every completed booking for telecallers who do not have a
          per-telecaller override on their monthly plan.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Default Incentive % (current: {telecallerDefaultPercent ?? '—'}%)
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              className="w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm"
              value={draftTelecallerDefaultPercent}
              onChange={(e) => setDraftTelecallerDefaultPercent(e.target.value)}
              placeholder="2"
            />
            <p className="mt-1 text-[10px] text-muted">
              Each qualifying booking pays (finalAmount × this %), rounded to the nearest rupee.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <button
            type="button"
            className="ui-btn ui-btn-info px-6"
            disabled={savingTelecaller}
            onClick={handleSaveTelecallerDefault}
          >
            {savingTelecaller ? 'Saving...' : 'Save Telecaller Default'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-panel p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-text">Global Settings</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Global Multiplier (default: {config.defaultMultiplier})
            </label>
            <input
              type="number"
              className="w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm"
              value={draftMultiplier}
              placeholder={String(config.defaultMultiplier)}
              onChange={(e) => setDraftMultiplier(e.target.value)}
            />
            <p className="mt-1 text-[10px] text-muted">
              Threshold = Price × Multiplier. Leave empty to use default ({config.defaultMultiplier}
              ).
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Incentive Percentage
            </label>
            <input
              type="number"
              className="w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm"
              value={draftIncentivePercent}
              onChange={(e) => setDraftIncentivePercent(e.target.value)}
            />
            <p className="mt-1 text-[10px] text-muted">Applied to qualifying item amounts.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Go-Kart Minimum Laps
            </label>
            <input
              type="number"
              className="w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm"
              value={draftLapThreshold}
              onChange={(e) => setDraftLapThreshold(e.target.value)}
            />
            <p className="mt-1 text-[10px] text-muted">
              Go-Kart bookings with ≥ this many laps get incentive.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <button className="ui-btn ui-btn-info px-6" disabled={saving} onClick={handleSaveGlobal}>
            {saving ? 'Saving...' : 'Save Global Settings'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Per-Game Overrides</h3>
          <select
            className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
          >
            {enabledLocations.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.displayName}
              </option>
            ))}
          </select>
        </div>
        <DataTable
          columns={columns}
          rows={variants}
          rowKey={(r) => r.overrideKey}
          emptyMessage="No active variants found"
        />
      </div>
    </div>
  )
}

// ─── Module Root ────────────────────────────────────────────────────────────

const IncentivesModule = ({ view }: IncentivesModuleProps) => {
  const { session } = useAuth()
  const isAdmin = session?.user.role && isPrivilegedRole(session.user.role)

  const subnavItems = useMemo(() => {
    const items = [
      { label: 'Dashboard', to: '/incentives/dashboard' },
      { label: 'Weekly Report', to: '/incentives/weekly' },
      { label: 'Telecallers', to: '/incentives/telecallers' },
    ]
    if (isAdmin) {
      items.push(
        { label: 'Cashier Breakdown', to: '/incentives/cashiers' },
        { label: 'Monthly Report', to: '/incentives/monthly' },
        { label: 'Config', to: '/incentives/config' },
      )
    }
    return items
  }, [isAdmin])

  const titleMap: Record<IncentivesView, string> = {
    dashboard: 'Incentives Dashboard',
    weeklyReport: 'Weekly Non-Performing Report',
    cashierBreakdown: 'Cashier Incentive Breakdown',
    config: 'Incentive Configuration',
    monthly: 'Monthly Incentives Report',
  }

  return (
    <ModulePageLayout
      moduleTab="Incentives"
      title={titleMap[view]}
      subtitle="Cashier incentive tracking and non-performing game analytics"
      breadcrumbs={['Incentives', titleMap[view]]}
      subnav={subnavItems}
    >
      {view === 'dashboard' && <DashboardView />}
      {view === 'weeklyReport' && <WeeklyReportView />}
      {view === 'cashierBreakdown' && isAdmin && <CashierBreakdownView />}
      {view === 'config' && isAdmin && <ConfigView />}
      {view === 'monthly' && isAdmin && <MonthlyReportView />}
      {(view === 'cashierBreakdown' || view === 'config' || view === 'monthly') && !isAdmin && (
        <div className="py-12 text-center text-sm text-muted">
          This view is only accessible to Owner and Admin roles.
        </div>
      )}
    </ModulePageLayout>
  )
}

export default IncentivesModule
