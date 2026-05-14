import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Printer, Trash2 } from 'lucide-react'
import { printCashierShiftReport } from '../../features/billing/generateShiftReport'
import { aggregateDayReport, type DayReportData } from '../../features/billing/checkout-day-report'
import { printDayReport } from '../../features/billing/generateDayReport'
import { fmtDateTimeFullIST, fmtDateIST, fmtDateTimeReportIST } from '../../../lib/date-format'
import { getLocationShortName } from '../../../lib/locations'
import {
  RevenueData,
  RevenueFilters,
  RevenueBooking,
  asquareRevenueApi,
} from '../../api/asquare-revenue'
import { reportsApi } from '../../api/reports'
import { ShiftRecord, shiftsApi } from '../../api/shifts'
import { usersApi } from '../../api/users'
import {
  BranchGameRevenueBreakdown,
  CallHistoryRecord,
  GameRevenueReportRecord,
  GameRevenueRow,
  LocationRevenueRow,
  OperationsReportRecord,
  RevenueReportRecord,
  ShiftSummaryReportRecord,
  StaffInsightRecord,
  UserRecord,
} from '../../api/types'
import { CallTypeBadge } from '../../components/ui/CallTypeBadge'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { DataTable } from '../../components/ui/DataTable'
import { DetailPanel } from '../../components/ui/DetailPanel'
import { FilterBar, FilterField } from '../../components/ui/FilterBar'
import { GameDrillDownModal } from '../../components/ui/GameDrillDownModal'
import { MetricStrip } from '../../components/ui/MetricStrip'
import { SummaryCards } from '../../components/ui/SummaryCards'
import { useAuth } from '../../features/auth/auth-context'
import { useLocations } from '../../hooks/useLocations'
import { todayIST } from '../../lib/ist-date'

export type ReportsView =
  | 'operations'
  | 'revenue'
  | 'shifts'
  | 'callHistory'
  | 'insights'
  | 'bookingRevenue'
  | 'gameRevenue'
  | 'cashierDetails'
  | 'daySales'

const baseSubnav = [
  { label: 'Operations', to: '/reports/operations' },
  { label: 'Revenue', to: '/reports/revenue' },
  { label: 'Shifts', to: '/reports/shifts' },
  { label: 'Call History', to: '/reports/call-history' },
  { label: 'Insights', to: '/reports/insights' },
  { label: 'Booking Revenue', to: '/reports/booking-revenue' },
  { label: 'Game Revenue', to: '/reports/game-revenue' },
  { label: 'Day Sales', to: '/reports/day-sales' },
]

const titleMap: Record<ReportsView, string> = {
  operations: 'Operations Report',
  revenue: 'Revenue Report',
  shifts: 'Shifts Report',
  callHistory: 'Call History',
  insights: 'Insights',
  bookingRevenue: 'Booking Revenue',
  gameRevenue: 'Game-wise Revenue',
  cashierDetails: 'Cashier Details',
  daySales: 'Day Sales Report',
}

const currency = (value: number): string => `INR ${Math.round(value || 0).toLocaleString('en-IN')}`
const hoursLabel = (value: number): string => `${Number(value || 0).toFixed(2)} hrs`
const dateTimeLabel = (value?: string): string => {
  return fmtDateTimeFullIST(value)
}

/* ── City Office / Branch-only column definitions ────────────────────── */

interface CityOfficeChannelRow {
  channel: string
  revenue: number
  percent: number
}

const branchLocationRevenueColumns = [
  {
    key: 'location',
    header: 'Location',
    render: (row: LocationRevenueRow) => (
      <span className="font-medium text-text">{row.locationName}</span>
    ),
  },
  {
    key: 'pos',
    header: 'POS Revenue',
    render: (row: LocationRevenueRow) => currency(row.posRevenue),
  },
  {
    key: 'count',
    header: 'Txns',
    render: (row: LocationRevenueRow) => String(row.transactionCount),
  },
  {
    key: 'pct',
    header: '% of Branch Total',
    render: (row: LocationRevenueRow) => `${row.contributionPercent.toFixed(1)}%`,
  },
]

const cityOfficeChannelColumns = [
  {
    key: 'channel',
    header: 'Channel',
    render: (row: CityOfficeChannelRow) => (
      <span className="font-medium text-text">{row.channel}</span>
    ),
  },
  {
    key: 'revenue',
    header: 'Revenue',
    render: (row: CityOfficeChannelRow) => currency(row.revenue),
  },
  {
    key: 'pct',
    header: '% of Online Total',
    render: (row: CityOfficeChannelRow) => `${row.percent.toFixed(1)}%`,
  },
]

const makeCityOfficeDistributionColumns = (totalOnlineRevenue: number) => [
  {
    key: 'location',
    header: 'Location',
    render: (row: LocationRevenueRow) => (
      <span className="font-medium text-text">{row.locationName}</span>
    ),
  },
  {
    key: 'online',
    header: 'Online Total',
    render: (row: LocationRevenueRow) =>
      currency(row.bookingRevenue + row.adminBookingRevenue + row.telecallerRevenue),
  },
  {
    key: 'website',
    header: 'Website',
    render: (row: LocationRevenueRow) => currency(row.bookingRevenue),
  },
  {
    key: 'admin',
    header: 'Admin',
    render: (row: LocationRevenueRow) => currency(row.adminBookingRevenue),
  },
  {
    key: 'telecaller',
    header: 'Telecaller',
    render: (row: LocationRevenueRow) => currency(row.telecallerRevenue),
  },
  { key: 'sbk', header: 'SBK', render: () => currency(0) },
  { key: 'app', header: 'App', render: () => currency(0) },
  {
    key: 'pct',
    header: '% of Online',
    render: (row: LocationRevenueRow) => {
      const locOnline = row.bookingRevenue + row.adminBookingRevenue + row.telecallerRevenue
      return totalOnlineRevenue > 0
        ? `${((locOnline / totalOnlineRevenue) * 100).toFixed(1)}%`
        : '0%'
    },
  },
]

const makeBranchGameRevenueColumns = (branchPosTotal: number) => [
  {
    key: 'game',
    header: 'Game',
    render: (row: GameRevenueRow) => <span className="font-medium text-text">{row.gameName}</span>,
  },
  { key: 'pos', header: 'POS Revenue', render: (row: GameRevenueRow) => currency(row.posRevenue) },
  { key: 'count', header: 'Txns', render: (row: GameRevenueRow) => String(row.transactionCount) },
  {
    key: 'pct',
    header: '%',
    render: (row: GameRevenueRow) =>
      branchPosTotal > 0 ? `${((row.posRevenue / branchPosTotal) * 100).toFixed(1)}%` : '0%',
  },
]

const ReportsModule = ({ view }: { view: ReportsView }) => {
  const { session } = useAuth()
  const { enabledLocations, isRestricted, allowedSlugs } = useLocations()
  const token = session?.token
  // Accountant: financial reporting core. HR: workforce reporting +
  // staffing reports. Both get the same Reports access as Admin
  // (including the Cashier Details tab — HR needs it for attendance
  // / settlement-discipline review across shifts).
  const isOwnerOrAdmin = session
    ? ['Owner', 'Admin', 'Accountant', 'HR'].includes(session.user.role)
    : false
  const isOwnerOrDev = session ? ['Owner', 'Admin', 'Developer'].includes(session.user.role) : false
  const subnav = useMemo(() => {
    const nav = [...baseSubnav]
    if (isOwnerOrAdmin) nav.push({ label: 'Cashier Details', to: '/reports/cashier-details' })
    if (isOwnerOrDev) nav.push({ label: 'Raise Ticket / Issues', to: '/reports/tickets' })
    return nav
  }, [isOwnerOrAdmin, isOwnerOrDev])
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [staff, setStaff] = useState<UserRecord[]>([])
  const [callHistory, setCallHistory] = useState<CallHistoryRecord[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [insightsSummary, setInsightsSummary] = useState<{
    outgoingCalls: number
    incomingCalls: number
    connectedCalls: number
    missedCalls: number
    totalDurationSeconds: number
    uniqueCustomers: number
    noAnswerCalls: number
  } | null>(null)
  const [staffInsights, setStaffInsights] = useState<StaffInsightRecord[]>([])
  const [bookingRevenueData, setBookingRevenueData] = useState<RevenueData | null>(null)
  const [bookingRevSearch, setBookingRevSearch] = useState('')
  const [bookingRevLocation, setBookingRevLocation] = useState('')
  const [drillDown, setDrillDown] = useState<{
    gameName: string
    locationId?: string
    locationName?: string
  } | null>(null)

  // Cashier Details state
  const [cashierShifts, setCashierShifts] = useState<ShiftRecord[]>([])
  const [cashierShiftsLoading, setCashierShiftsLoading] = useState(false)
  const [cashierDetailDateFrom, setCashierDetailDateFrom] = useState(() => todayIST())
  const [cashierDetailDateTo, setCashierDetailDateTo] = useState(() => todayIST())
  const [cashierDetailLocation, setCashierDetailLocation] = useState('All')
  const [cashierDetailUser, setCashierDetailUser] = useState('All')
  const [cashierUsers, setCashierUsers] = useState<Array<{ id: string; name: string }>>([])

  // Day Sales state
  const [daySalesDate, setDaySalesDate] = useState(() => todayIST())
  const [daySalesLocation, setDaySalesLocation] = useState('')
  const [daySalesData, setDaySalesData] = useState<DayReportData | null>(null)
  const [daySalesLoading, setDaySalesLoading] = useState(false)
  const [daySalesDayClosed, setDaySalesDayClosed] = useState(false)
  const [daySalesPrintLoading, setDaySalesPrintLoading] = useState(false)

  const matchesLocation = (locationId?: string): boolean =>
    !isRestricted || allowedSlugs.includes(locationId ?? '')

  const handleGameClick = useCallback(
    (row: GameRevenueRow, locationId?: string, locationName?: string) => {
      setDrillDown({ gameName: row.gameName, locationId, locationName })
    },
    [],
  )

  const handleLocationClick = useCallback((row: LocationRevenueRow) => {
    const el = document.getElementById(`branch-${row.locationId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  useEffect(() => {
    if (!token) return
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const from = searchParams.get('from') || undefined
        const to = searchParams.get('to') || undefined
        const staffId = searchParams.get('staffId') || undefined

        if (view === 'operations') {
          const result = await reportsApi.operations(token)
          setReport(result.report as unknown as Record<string, unknown>)
          setCallHistory([])
          setStaffInsights([])
          setNextCursor(undefined)
          setInsightsSummary(null)
        } else if (view === 'revenue') {
          const result = await reportsApi.revenue(token, {
            from,
            to,
          })
          setReport(result.report)
          setCallHistory([])
          setStaffInsights([])
          setNextCursor(undefined)
          setInsightsSummary(null)
        } else if (view === 'shifts') {
          const result = await reportsApi.shifts(token, {
            from,
            to,
          })
          setReport(result.report)
          setCallHistory([])
          setStaffInsights([])
          setNextCursor(undefined)
          setInsightsSummary(null)
        } else if (view === 'callHistory') {
          const [historyResult, usersResult] = await Promise.all([
            reportsApi.callHistory(token, {
              from,
              to,
              staffId,
              type:
                (searchParams.get('type') as 'Incoming' | 'Outgoing' | 'Missed' | null) ??
                undefined,
              q: searchParams.get('q') || undefined,
              limit: 100,
              cursor: searchParams.get('cursor') || undefined,
            }),
            usersApi.list(token),
          ])
          setCallHistory(historyResult.records)
          setNextCursor(historyResult.nextCursor)
          setStaff(usersResult.users)
          setReport(null)
          setStaffInsights([])
          setInsightsSummary(null)
        } else if (view === 'gameRevenue') {
          const today = new Date().toISOString().slice(0, 10)
          const result = await reportsApi.gameRevenue(token, {
            from: from ?? today,
            to: to ?? today,
          })
          setReport(result.report)
          setCallHistory([])
          setStaffInsights([])
          setNextCursor(undefined)
          setInsightsSummary(null)
          setBookingRevenueData(null)
        } else if (view === 'bookingRevenue') {
          const filters: RevenueFilters = {}
          if (from) filters.dateFrom = from
          if (to) filters.dateTo = to
          if (bookingRevLocation) filters.locationId = bookingRevLocation
          if (bookingRevSearch) filters.search = bookingRevSearch
          const data = await asquareRevenueApi.getRevenueData(filters)
          setBookingRevenueData(data)
          setReport(null)
          setCallHistory([])
          setStaffInsights([])
          setNextCursor(undefined)
          setInsightsSummary(null)
        } else if (view === 'cashierDetails') {
          // Cashier details loading is handled by its own useEffect/loadCashierDetails
          setReport(null)
          setCallHistory([])
          setStaffInsights([])
          setNextCursor(undefined)
          setInsightsSummary(null)
          setBookingRevenueData(null)
        } else {
          const [insightsResult, usersResult] = await Promise.all([
            reportsApi.insights(token, { from, to, staffId }),
            usersApi.list(token),
          ])
          setInsightsSummary(insightsResult.summary)
          setStaffInsights(insightsResult.staffInsights)
          setStaff(usersResult.users)
          setReport(null)
          setCallHistory([])
          setNextCursor(undefined)
          setBookingRevenueData(null)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load report.')
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [token, view, searchParams, bookingRevLocation])

  const filteredBookingRevenue = useMemo(() => {
    if (!bookingRevenueData) return []
    const term = bookingRevSearch.toLowerCase()
    return bookingRevenueData.bookings.filter((b) => {
      if (!term) return true
      return (
        b.id.toLowerCase().includes(term) ||
        b.userDisplayName.toLowerCase().includes(term) ||
        b.userPhone.includes(term)
      )
    })
  }, [bookingRevenueData, bookingRevSearch])

  const filteredCallHistory = useMemo(
    () => callHistory.filter((r) => matchesLocation(r.branchId)),
    [callHistory, isRestricted, allowedSlugs],
  )

  const filteredShiftsReport = useMemo(() => {
    if (!report || view !== 'shifts') return null
    const sr = report as unknown as ShiftSummaryReportRecord
    if (!sr.trackMarshallShifts) return sr
    if (!isRestricted) return sr
    const filteredTM = sr.trackMarshallShifts.filter((s) => matchesLocation(s.branchId))
    const tmHours = filteredTM.reduce((sum, s) => sum + (s.totalActiveHours ?? 0), 0)
    return {
      ...sr,
      trackMarshallShifts: filteredTM,
      trackMarshallShiftCount: filteredTM.length,
      trackMarshallActiveHours: tmHours,
    } as ShiftSummaryReportRecord
  }, [report, view, isRestricted, allowedSlugs])

  const filteredGameRevenueReport = useMemo(() => {
    if (!report || view !== 'gameRevenue') return null
    const gr = report as unknown as GameRevenueReportRecord
    if (!gr.locationBreakdown || !gr.branchBreakdowns) return gr
    if (!isRestricted) return gr
    const filteredLocations = gr.locationBreakdown.filter((l) => matchesLocation(l.locationId))
    const filteredBranches = gr.branchBreakdowns.filter((b) => matchesLocation(b.locationId))
    const filteredTotalRevenue = filteredBranches.reduce((sum, b) => sum + b.totalRevenue, 0)
    // Recalculate contribution percentages for filtered location rows
    const recalcLocations = filteredLocations.map((l) => ({
      ...l,
      contributionPercent:
        filteredTotalRevenue > 0 ? (l.totalRevenue / filteredTotalRevenue) * 100 : 0,
    }))
    return {
      ...gr,
      totalRevenue: filteredTotalRevenue,
      locationBreakdown: recalcLocations,
      branchBreakdowns: filteredBranches,
    } as GameRevenueReportRecord
  }, [report, view, isRestricted, allowedSlugs])

  // Derive City Office vs Branch (POS-only) aggregations from the game revenue report
  const gameRevenueViewData = useMemo(() => {
    if (!filteredGameRevenueReport) return null
    const gr = filteredGameRevenueReport
    if (!gr.locationBreakdown) return null

    // Branch-only (POS) totals
    const totalPosRevenue = gr.locationBreakdown.reduce((sum, l) => sum + l.posRevenue, 0)
    const branchLocationRows = gr.locationBreakdown.map((l) => ({
      ...l,
      contributionPercent: totalPosRevenue > 0 ? (l.posRevenue / totalPosRevenue) * 100 : 0,
    }))

    // City Office (online) aggregates
    const totalWebsite = gr.locationBreakdown.reduce((sum, l) => sum + l.bookingRevenue, 0)
    const totalAdmin = gr.locationBreakdown.reduce((sum, l) => sum + l.adminBookingRevenue, 0)
    const totalTelecaller = gr.locationBreakdown.reduce((sum, l) => sum + l.telecallerRevenue, 0)
    const totalOnlineRevenue = totalWebsite + totalAdmin + totalTelecaller

    const cityOfficeChannels: CityOfficeChannelRow[] = [
      {
        channel: 'Website',
        revenue: totalWebsite,
        percent: totalOnlineRevenue > 0 ? (totalWebsite / totalOnlineRevenue) * 100 : 0,
      },
      {
        channel: 'Admin',
        revenue: totalAdmin,
        percent: totalOnlineRevenue > 0 ? (totalAdmin / totalOnlineRevenue) * 100 : 0,
      },
      {
        channel: 'Telecaller',
        revenue: totalTelecaller,
        percent: totalOnlineRevenue > 0 ? (totalTelecaller / totalOnlineRevenue) * 100 : 0,
      },
      { channel: 'SBK', revenue: 0, percent: 0 },
      { channel: 'App', revenue: 0, percent: 0 },
    ]

    // City Office -> Location Distribution (only locations with online revenue)
    const cityOfficeLocationRows = gr.locationBreakdown.filter(
      (l) => l.bookingRevenue + l.adminBookingRevenue + l.telecallerRevenue > 0,
    )

    return {
      totalPosRevenue,
      totalOnlineRevenue,
      branchLocationRows,
      cityOfficeChannels,
      cityOfficeLocationRows,
    }
  }, [filteredGameRevenueReport])

  // Cashier Details — data loader
  const loadCashierDetails = useCallback(async () => {
    if (!token) return
    setCashierShiftsLoading(true)
    try {
      const [shiftResult, userResult] = await Promise.all([
        shiftsApi.list(token, {
          role: 'Cashier',
          from: cashierDetailDateFrom,
          to: cashierDetailDateTo,
        }),
        usersApi.list(token, { role: 'Cashier' }),
      ])
      setCashierShifts(shiftResult.shifts)
      setCashierUsers(userResult.users.map((u) => ({ id: u.id, name: u.name })))
    } catch {
      setCashierShifts([])
    } finally {
      setCashierShiftsLoading(false)
    }
  }, [token, cashierDetailDateFrom, cashierDetailDateTo])

  // Auto-load cashier details when tab selected
  useEffect(() => {
    if (view === 'cashierDetails' && isOwnerOrAdmin) {
      void loadCashierDetails()
    }
  }, [view, isOwnerOrAdmin, loadCashierDetails])

  // Day Sales — load handler
  const loadDaySales = useCallback(async () => {
    if (!token || !daySalesLocation) return
    setDaySalesLoading(true)
    setError(null)
    setDaySalesData(null)
    try {
      const data = await aggregateDayReport(daySalesLocation, daySalesDate)
      setDaySalesData(data)

      // Check if day-end is complete (any Cashier shift with settlement for this location+date)
      const { shifts } = await shiftsApi.list(token, {
        from: daySalesDate,
        to: daySalesDate,
        role: 'Cashier',
      })
      const settledShift = shifts.find(
        (s) => s.locationId === daySalesLocation && !!s.endTime && !!s.settlement,
      )
      setDaySalesDayClosed(!!settledShift)

      // Attach settlement data to report for excess/shortage calculation
      if (settledShift?.settlement) {
        data.settlement = {
          cashEntered: settledShift.settlement.cashEntered,
          cardEntered: settledShift.settlement.cardEntered,
          upiEntered: settledShift.settlement.upiEntered,
          cashActual: settledShift.settlement.cashActual,
          cardActual: settledShift.settlement.cardActual,
          upiActual: settledShift.settlement.upiActual,
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load day sales data.')
    } finally {
      setDaySalesLoading(false)
    }
  }, [token, daySalesLocation, daySalesDate])

  // Cashier Details — filtered shifts
  const filteredCashierShifts = useMemo(() => {
    let filtered = cashierShifts
    if (cashierDetailLocation !== 'All') {
      filtered = filtered.filter((s) => s.locationId === cashierDetailLocation)
    }
    if (cashierDetailUser !== 'All') {
      filtered = filtered.filter((s) => s.userId === cashierDetailUser)
    }
    return filtered
  }, [cashierShifts, cashierDetailLocation, cashierDetailUser])

  // Cashier Details — user name lookup
  const cashierNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const u of cashierUsers) map.set(u.id, u.name)
    return map
  }, [cashierUsers])

  if (!session || !token) {
    return null
  }

  const operationsReport = view === 'operations' ? (report as OperationsReportRecord | null) : null
  const revenueReport = view === 'revenue' ? (report as RevenueReportRecord | null) : null
  const shiftsReport = view === 'shifts' ? filteredShiftsReport : null
  const gameRevenueReport = view === 'gameRevenue' ? filteredGameRevenueReport : null

  return (
    <ModulePageLayout
      moduleTab="Reports"
      title={titleMap[view]}
      subtitle="Operational, revenue, shift, call, and insight reporting views."
      breadcrumbs={['Pipeline', 'Reports', titleMap[view]]}
      subnav={subnav}
    >
      {error ? (
        <p className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}

      {view !== 'operations' && view !== 'cashierDetails' ? (
        <FilterBar>
          <FilterField label="From">
            <input
              className="ui-field min-h-10"
              type="date"
              value={searchParams.get('from') ?? ''}
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
              value={searchParams.get('to') ?? ''}
              onChange={(event) => {
                const next = new URLSearchParams(searchParams)
                if (event.target.value) next.set('to', event.target.value)
                else next.delete('to')
                setSearchParams(next)
              }}
            />
          </FilterField>
          {view === 'callHistory' || view === 'insights' ? (
            <FilterField label="Staff">
              <select
                className="ui-field min-h-10"
                value={searchParams.get('staffId') ?? ''}
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams)
                  if (event.target.value) next.set('staffId', event.target.value)
                  else next.delete('staffId')
                  next.delete('cursor')
                  setSearchParams(next)
                }}
              >
                <option value="">All</option>
                {staff.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </FilterField>
          ) : null}
          {view === 'callHistory' ? (
            <FilterField label="Type">
              <select
                className="ui-field min-h-10"
                value={searchParams.get('type') ?? ''}
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams)
                  if (event.target.value) next.set('type', event.target.value)
                  else next.delete('type')
                  next.delete('cursor')
                  setSearchParams(next)
                }}
              >
                <option value="">All</option>
                <option value="Incoming">Incoming</option>
                <option value="Outgoing">Outgoing</option>
                <option value="Missed">Missed</option>
              </select>
            </FilterField>
          ) : null}
          {view === 'callHistory' ? (
            <FilterField label="Search">
              <input
                className="ui-field min-h-10"
                value={searchParams.get('q') ?? ''}
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams)
                  if (event.target.value) next.set('q', event.target.value)
                  else next.delete('q')
                  next.delete('cursor')
                  setSearchParams(next)
                }}
                placeholder="Customer, number, status"
              />
            </FilterField>
          ) : null}
          {view === 'gameRevenue' ? (
            <FilterField label="Quick Range">
              <div className="flex gap-1.5">
                {[
                  {
                    label: 'Today',
                    getRange: () => {
                      const d = new Date().toISOString().slice(0, 10)
                      return { from: d, to: d }
                    },
                  },
                  {
                    label: 'This Week',
                    getRange: () => {
                      const now = new Date()
                      const day = now.getDay()
                      const monday = new Date(now)
                      monday.setDate(now.getDate() - day + (day === 0 ? -6 : 1))
                      return {
                        from: monday.toISOString().slice(0, 10),
                        to: now.toISOString().slice(0, 10),
                      }
                    },
                  },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="ui-btn ui-btn-neutral px-3 py-1.5 text-xs"
                    onClick={() => {
                      const range = preset.getRange()
                      const next = new URLSearchParams(searchParams)
                      next.set('from', range.from)
                      next.set('to', range.to)
                      setSearchParams(next)
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </FilterField>
          ) : null}
        </FilterBar>
      ) : null}

      {view === 'operations' ? (
        <div className="space-y-4">
          <SummaryCards
            items={[
              {
                id: 'ops-calls',
                label: 'Calls Today',
                value: String(operationsReport?.totalCalls ?? 0),
                tone: 'info',
              },
              {
                id: 'ops-bookings',
                label: 'Paid Bookings',
                value: String(operationsReport?.paidBookingCount ?? 0),
                tone: 'success',
              },
              {
                id: 'ops-revenue',
                label: 'Revenue Today',
                value: currency(operationsReport?.totalRevenue ?? 0),
                tone: 'success',
              },
              {
                id: 'ops-track',
                label: 'Track Hours',
                value: hoursLabel(operationsReport?.trackMarshallActiveHours ?? 0),
                tone: 'warning',
              },
            ]}
          />

          <MetricStrip
            items={[
              {
                id: 'ops-incoming',
                label: 'Incoming Calls',
                value: String(operationsReport?.incomingCalls ?? 0),
              },
              {
                id: 'ops-outgoing',
                label: 'Outgoing Calls',
                value: String(operationsReport?.outgoingCalls ?? 0),
              },
              {
                id: 'ops-missed',
                label: 'Missed Calls',
                value: String(operationsReport?.missedCalls ?? 0),
              },
              {
                id: 'ops-talk',
                label: 'Talk Time (s)',
                value: String(operationsReport?.totalTalkSeconds ?? 0),
              },
            ]}
          />

          <DetailPanel title="Operational Snapshot">
            <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border border-border bg-panel px-4 py-3">
                <dt className="text-xs uppercase tracking-[0.08em] text-muted">
                  Telecallers Online Scope
                </dt>
                <dd className="mt-1 text-lg font-semibold text-text">
                  {operationsReport?.telecallerCount ?? 0}
                </dd>
              </div>
              <div className="rounded-xl border border-border bg-panel px-4 py-3">
                <dt className="text-xs uppercase tracking-[0.08em] text-muted">Booking Revenue</dt>
                <dd className="mt-1 text-lg font-semibold text-text">
                  {currency(operationsReport?.bookingRevenue ?? 0)}
                </dd>
              </div>
              <div className="rounded-xl border border-border bg-panel px-4 py-3">
                <dt className="text-xs uppercase tracking-[0.08em] text-muted">POS Revenue</dt>
                <dd className="mt-1 text-lg font-semibold text-text">
                  {currency(operationsReport?.posRevenue ?? 0)}
                </dd>
              </div>
              <div className="rounded-xl border border-border bg-panel px-4 py-3">
                <dt className="text-xs uppercase tracking-[0.08em] text-muted">Track Shifts</dt>
                <dd className="mt-1 text-lg font-semibold text-text">
                  {operationsReport?.trackMarshallShiftCount ?? 0}
                </dd>
              </div>
              <div className="rounded-xl border border-border bg-panel px-4 py-3">
                <dt className="text-xs uppercase tracking-[0.08em] text-muted">Generated</dt>
                <dd className="mt-1 text-sm text-text">
                  {dateTimeLabel(operationsReport?.generatedAt)}
                </dd>
              </div>
            </dl>
          </DetailPanel>
        </div>
      ) : null}

      {view === 'revenue' ? (
        <div className="space-y-4">
          <SummaryCards
            items={[
              {
                id: 'rev-total',
                label: 'Total Revenue',
                value: currency(revenueReport?.totalRevenue ?? 0),
                tone: 'success',
              },
              {
                id: 'rev-booking',
                label: 'Bookings',
                value: currency(revenueReport?.bookingRevenue ?? 0),
                tone: 'info',
              },
              {
                id: 'rev-pos',
                label: 'POS',
                value: currency(revenueReport?.posRevenue ?? 0),
                tone: 'warning',
              },
              {
                id: 'rev-average',
                label: 'Average Value',
                value: currency(revenueReport?.averageTransactionValue ?? 0),
                tone: 'muted',
              },
            ]}
          />

          <MetricStrip
            items={[
              {
                id: 'rev-transactions',
                label: 'Transactions',
                value: String(revenueReport?.totalTransactions ?? 0),
              },
              {
                id: 'rev-refunds',
                label: 'Refunds',
                value: String(revenueReport?.refundsCount ?? 0),
              },
              {
                id: 'rev-refunds-value',
                label: 'Refund Value',
                value: currency(revenueReport?.refundsValue ?? 0),
              },
              {
                id: 'rev-generated',
                label: 'Generated',
                value: dateTimeLabel(revenueReport?.generatedAt),
              },
            ]}
          />

          <DetailPanel title="Payment Breakdown">
            <DataTable
              columns={[
                { key: 'method', header: 'Payment Method', render: (row) => row.method },
                { key: 'amount', header: 'Amount', render: (row) => currency(row.amount) },
              ]}
              rows={Object.entries(revenueReport?.paymentMethodBreakdown ?? {}).map(
                ([method, amount]) => ({ method, amount }),
              )}
              rowKey={(row) => row.method}
              emptyMessage={loading ? 'Loading revenue breakdown...' : 'No payment data available.'}
            />
          </DetailPanel>
        </div>
      ) : null}

      {view === 'shifts' ? (
        <div className="space-y-4">
          <SummaryCards
            items={[
              {
                id: 'shift-total',
                label: 'Total Shifts',
                value: String(shiftsReport?.totalShiftCount ?? 0),
                tone: 'info',
              },
              {
                id: 'shift-hours',
                label: 'Active Hours',
                value: hoursLabel(shiftsReport?.totalActiveHours ?? 0),
                tone: 'success',
              },
              {
                id: 'shift-track-count',
                label: 'TrackMarshall Shifts',
                value: String(shiftsReport?.trackMarshallShiftCount ?? 0),
                tone: 'warning',
              },
              {
                id: 'shift-track-hours',
                label: 'TrackMarshall Hours',
                value: hoursLabel(shiftsReport?.trackMarshallActiveHours ?? 0),
                tone: 'muted',
              },
            ]}
          />

          <DetailPanel title="Role Coverage">
            <DataTable
              columns={[
                { key: 'role', header: 'Role', render: (row) => row.role },
                { key: 'count', header: 'Shifts', render: (row) => String(row.count) },
              ]}
              rows={Object.entries(shiftsReport?.byRole ?? {}).map(([role, count]) => ({
                role,
                count,
              }))}
              rowKey={(row) => row.role}
              emptyMessage={loading ? 'Loading shift coverage...' : 'No shift coverage data.'}
            />
          </DetailPanel>

          <DetailPanel title="Shift Timeline">
            <DataTable
              columns={[
                { key: 'user', header: 'User', render: (row) => row.userId || '-' },
                { key: 'role', header: 'Role', render: (row) => row.role },
                { key: 'start', header: 'Start', render: (row) => dateTimeLabel(row.startTime) },
                { key: 'end', header: 'End', render: (row) => dateTimeLabel(row.endTime) },
                {
                  key: 'hours',
                  header: 'Hours',
                  render: (row) => hoursLabel(row.totalActiveHours ?? 0),
                },
              ]}
              rows={shiftsReport?.shifts ?? []}
              rowKey={(row) => row.id}
              emptyMessage={loading ? 'Loading shifts...' : 'No shifts found.'}
            />
          </DetailPanel>

          <DetailPanel title="TrackMarshall Timeline">
            <DataTable
              columns={[
                { key: 'staff', header: 'Staff', render: (row) => row.staffName },
                { key: 'branch', header: 'Branch', render: (row) => row.branchName },
                { key: 'start', header: 'Login', render: (row) => dateTimeLabel(row.loginTime) },
                { key: 'end', header: 'Logout', render: (row) => dateTimeLabel(row.logoutTime) },
                {
                  key: 'hours',
                  header: 'Hours',
                  render: (row) => hoursLabel(row.totalActiveHours ?? 0),
                },
              ]}
              rows={shiftsReport?.trackMarshallShifts ?? []}
              rowKey={(row) => row.id}
              emptyMessage={
                loading ? 'Loading TrackMarshall shifts...' : 'No TrackMarshall shifts found.'
              }
            />
          </DetailPanel>
        </div>
      ) : null}

      {view === 'callHistory' ? (
        <>
          <DataTable
            columns={[
              {
                key: 'time',
                header: 'Timestamp',
                render: (record) => fmtDateTimeFullIST(record.timestamp),
              },
              {
                key: 'customer',
                header: 'Customer',
                render: (record) => record.customerName ?? '-',
              },
              { key: 'number', header: 'Number', render: (record) => record.customerNumber },
              { key: 'staff', header: 'Staff', render: (record) => record.userName },
              { key: 'branch', header: 'Branch', render: (record) => record.branchId ?? '-' },
              {
                key: 'type',
                header: 'Type',
                render: (record) => <CallTypeBadge type={record.type} />,
              },
              { key: 'status', header: 'Status', render: (record) => record.status },
              {
                key: 'duration',
                header: 'Duration (s)',
                render: (record) => String(record.durationSeconds),
              },
              {
                key: 'labels',
                header: 'Labels',
                render: (record) => record.labelTitles?.join(', ') || '-',
              },
            ]}
            rows={filteredCallHistory}
            rowKey={(record) => record.id}
            emptyMessage={loading ? 'Loading call history...' : 'No call history records found.'}
          />
          {nextCursor ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(searchParams)
                  next.set('cursor', nextCursor)
                  setSearchParams(next)
                }}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text"
              >
                Load more
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {view === 'bookingRevenue' ? (
        <div className="space-y-4">
          <SummaryCards
            items={[
              {
                id: 'br-rev',
                label: 'Total Revenue',
                value: currency(bookingRevenueData?.totalRevenue ?? 0),
                tone: 'success' as const,
              },
              {
                id: 'br-pending',
                label: 'Pending Revenue',
                value: currency(bookingRevenueData?.pendingRevenue ?? 0),
                tone: 'warning' as const,
              },
              {
                id: 'br-count',
                label: 'Total Bookings',
                value: String(bookingRevenueData?.bookings.length ?? 0),
                tone: 'info' as const,
              },
              {
                id: 'br-qty',
                label: 'Total Quantity',
                value: String(bookingRevenueData?.totalQuantity ?? 0),
                tone: 'muted' as const,
              },
            ]}
          />

          <FilterBar>
            <FilterField label="Location">
              <select
                className="ui-field min-h-10"
                value={bookingRevLocation}
                onChange={(e) => setBookingRevLocation(e.target.value)}
              >
                <option value="">All Locations</option>
                {enabledLocations.map((l) => (
                  <option key={l.slug} value={l.slug}>
                    {l.displayName}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Search">
              <input
                className="ui-field min-h-10"
                placeholder="Name, phone, ID..."
                value={bookingRevSearch}
                onChange={(e) => setBookingRevSearch(e.target.value)}
              />
            </FilterField>
          </FilterBar>

          <DetailPanel title="Booking Revenue">
            <DataTable
              columns={[
                {
                  key: 'id',
                  header: 'Booking ID',
                  render: (b: RevenueBooking) => <span className="font-mono text-xs">{b.id}</span>,
                },
                {
                  key: 'customer',
                  header: 'Customer',
                  render: (b: RevenueBooking) => b.userDisplayName || '—',
                },
                {
                  key: 'phone',
                  header: 'Phone',
                  render: (b: RevenueBooking) => b.userPhone || '—',
                },
                {
                  key: 'location',
                  header: 'Location',
                  render: (b: RevenueBooking) => b.locationId,
                },
                {
                  key: 'date',
                  header: 'Date',
                  render: (b: RevenueBooking) => fmtDateIST(b.sessionDate),
                },
                {
                  key: 'amount',
                  header: 'Amount',
                  render: (b: RevenueBooking) => currency(b.finalAmount),
                },
                {
                  key: 'payment',
                  header: 'Payment',
                  render: (b: RevenueBooking) => (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.paymentStatus === 'completed' ? 'bg-success/15 text-success' : b.paymentStatus === 'pending' ? 'bg-warning/15 text-warning' : 'bg-critical/15 text-critical'}`}
                    >
                      {b.paymentStatus}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (b: RevenueBooking) => (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.bookingStatus === 'completed' || b.bookingStatus === 'confirmed' ? 'bg-success/15 text-success' : b.bookingStatus === 'cancelled' ? 'bg-critical/15 text-critical' : 'bg-info/15 text-info'}`}
                    >
                      {b.bookingStatus}
                    </span>
                  ),
                },
              ]}
              rows={filteredBookingRevenue}
              rowKey={(b) => b.id}
              emptyMessage={
                loading ? 'Loading booking revenue...' : 'No booking data for the selected filters.'
              }
            />
          </DetailPanel>
        </div>
      ) : null}

      {view === 'gameRevenue' ? (
        <div className="space-y-6">
          {/* ── Top-level KPIs ───────────────────────────────────────── */}
          <SummaryCards
            items={[
              {
                id: 'gr-total',
                label: 'Total Revenue',
                value: currency(gameRevenueReport?.totalRevenue ?? 0),
                tone: 'success',
              },
              {
                id: 'gr-branch',
                label: 'Branch Revenue (POS)',
                value: currency(gameRevenueViewData?.totalPosRevenue ?? 0),
                tone: 'warning',
              },
              {
                id: 'gr-online',
                label: 'City Office (Online)',
                value: currency(gameRevenueViewData?.totalOnlineRevenue ?? 0),
                tone: 'info',
              },
              {
                id: 'gr-generated',
                label: 'Generated',
                value: fmtDateTimeReportIST(gameRevenueReport?.generatedAt),
                tone: 'muted',
              },
            ]}
          />

          {/* ── Branch Revenue — Location-wise (POS only) ────────────── */}
          <DetailPanel title="Branch Revenue — Location-wise (POS)">
            <DataTable
              columns={branchLocationRevenueColumns}
              rows={gameRevenueViewData?.branchLocationRows ?? []}
              rowKey={(row) => row.locationId}
              emptyMessage={
                loading ? 'Loading location revenue...' : 'No location revenue data available.'
              }
              onRowClick={handleLocationClick}
            />
          </DetailPanel>

          {/* ── City Office Revenue — Online Channels ────────────────── */}
          <DetailPanel title="City Office Revenue — Online Channels">
            <DataTable
              columns={cityOfficeChannelColumns}
              rows={gameRevenueViewData?.cityOfficeChannels ?? []}
              rowKey={(row) => row.channel}
              emptyMessage="No online revenue data available."
            />
          </DetailPanel>

          {/* ── City Office → Location Distribution ──────────────────── */}
          <DetailPanel title="City Office → Location Distribution">
            <DataTable
              columns={makeCityOfficeDistributionColumns(
                gameRevenueViewData?.totalOnlineRevenue ?? 0,
              )}
              rows={gameRevenueViewData?.cityOfficeLocationRows ?? []}
              rowKey={(row) => row.locationId}
              emptyMessage="No online revenue distribution data."
            />
          </DetailPanel>

          {/* ── Per-branch sections (POS only) ───────────────────────── */}
          {(gameRevenueReport?.branchBreakdowns ?? []).map((branch: BranchGameRevenueBreakdown) => {
            const branchPosRevenue = (branch.gameBreakdown ?? []).reduce(
              (s, g) => s + g.posRevenue,
              0,
            )
            return (
              <div key={branch.locationId} id={`branch-${branch.locationId}`} className="space-y-3">
                <SummaryCards
                  items={[
                    {
                      id: `br-${branch.locationId}-rev`,
                      label: `${branch.displayName} POS Revenue`,
                      value: currency(branchPosRevenue),
                      tone: 'success',
                    },
                    {
                      id: `br-${branch.locationId}-games`,
                      label: 'Games',
                      value: String((branch.gameBreakdown ?? []).length),
                      tone: 'info',
                    },
                    {
                      id: `br-${branch.locationId}-txns`,
                      label: 'Transactions',
                      value: String(branch.transactionCount),
                      tone: 'muted',
                    },
                    {
                      id: `br-${branch.locationId}-share`,
                      label: 'POS Share of Total',
                      value:
                        gameRevenueViewData && gameRevenueViewData.totalPosRevenue > 0
                          ? `${((branchPosRevenue / gameRevenueViewData.totalPosRevenue) * 100).toFixed(1)}%`
                          : '0%',
                      tone: 'warning',
                    },
                  ]}
                />

                <DetailPanel title={`${branch.displayName} — Game-wise Revenue (POS)`}>
                  <DataTable
                    columns={makeBranchGameRevenueColumns(branchPosRevenue)}
                    rows={branch.gameBreakdown ?? []}
                    rowKey={(row) => `${branch.locationId}-${row.gameName}`}
                    emptyMessage="No game revenue data for this branch."
                    onRowClick={(row) =>
                      handleGameClick(row, branch.locationId, branch.displayName)
                    }
                  />
                </DetailPanel>
              </div>
            )
          })}

          {drillDown && gameRevenueReport?.transactionsByGame && (
            <GameDrillDownModal
              gameName={drillDown.gameName}
              transactions={gameRevenueReport.transactionsByGame[drillDown.gameName] ?? []}
              locationId={drillDown.locationId}
              locationName={drillDown.locationName}
              onClose={() => setDrillDown(null)}
            />
          )}
        </div>
      ) : null}

      {view === 'cashierDetails' && isOwnerOrAdmin ? (
        <div className="space-y-4">
          <FilterBar>
            <FilterField label="From">
              <input
                className="ui-field min-h-10"
                type="date"
                value={cashierDetailDateFrom}
                onChange={(e) => setCashierDetailDateFrom(e.target.value)}
              />
            </FilterField>
            <FilterField label="To">
              <input
                className="ui-field min-h-10"
                type="date"
                value={cashierDetailDateTo}
                onChange={(e) => setCashierDetailDateTo(e.target.value)}
              />
            </FilterField>
            <FilterField label="Location">
              <select
                className="ui-field min-h-10"
                value={cashierDetailLocation}
                onChange={(e) => setCashierDetailLocation(e.target.value)}
              >
                <option value="All">All Locations</option>
                {enabledLocations.map((l) => (
                  <option key={l.slug} value={l.slug}>
                    {l.displayName}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Cashier">
              <select
                className="ui-field min-h-10"
                value={cashierDetailUser}
                onChange={(e) => setCashierDetailUser(e.target.value)}
              >
                <option value="All">All Cashiers</option>
                {cashierUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="">
              <button
                type="button"
                className="ui-btn ui-btn-neutral min-h-10 px-4"
                onClick={() => void loadCashierDetails()}
                disabled={cashierShiftsLoading}
              >
                {cashierShiftsLoading ? 'Loading...' : 'Load'}
              </button>
            </FilterField>
          </FilterBar>

          <DetailPanel title="Cashier Shift & Settlement Details">
            <DataTable
              columns={[
                {
                  key: 'cashier',
                  header: 'Cashier',
                  render: (shift: ShiftRecord) => (
                    <span className="font-medium text-text">
                      {cashierNameMap.get(shift.userId) ?? shift.userId}
                    </span>
                  ),
                },
                {
                  key: 'location',
                  header: 'Location',
                  render: (shift: ShiftRecord) =>
                    shift.locationName || getLocationShortName(shift.locationId) || '\u2014',
                },
                {
                  key: 'date',
                  header: 'Date',
                  render: (shift: ShiftRecord) => shift.shiftDate,
                },
                {
                  key: 'checkin',
                  header: 'Check-In',
                  render: (shift: ShiftRecord) => fmtDateTimeFullIST(shift.startTime),
                },
                {
                  key: 'checkout',
                  header: 'Check-Out',
                  render: (shift: ShiftRecord) =>
                    shift.endTime ? fmtDateTimeFullIST(shift.endTime) : 'Active',
                },
                {
                  key: 'txns',
                  header: 'Txns',
                  render: (shift: ShiftRecord) =>
                    String(shift.settlement?.totalTransactions ?? '\u2014'),
                },
                {
                  key: 'revenue',
                  header: 'Revenue',
                  render: (shift: ShiftRecord) => {
                    const s = shift.settlement
                    if (!s) return '\u2014'
                    return currency((s.cashActual ?? 0) + (s.cardActual ?? 0) + (s.upiActual ?? 0))
                  },
                },
                {
                  key: 'cash',
                  header: 'Cash',
                  render: (shift: ShiftRecord) => {
                    const s = shift.settlement
                    if (!s) return '\u2014'
                    return `${currency(s.cashEntered)} / ${currency(s.cashActual)}`
                  },
                },
                {
                  key: 'card',
                  header: 'Card',
                  render: (shift: ShiftRecord) => {
                    const s = shift.settlement
                    if (!s) return '\u2014'
                    return `${currency(s.cardEntered)} / ${currency(s.cardActual)}`
                  },
                },
                {
                  key: 'upi',
                  header: 'UPI',
                  render: (shift: ShiftRecord) => {
                    const s = shift.settlement
                    if (!s) return '\u2014'
                    return `${currency(s.upiEntered)} / ${currency(s.upiActual)}`
                  },
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (shift: ShiftRecord) => {
                    const s = shift.settlement
                    if (!s) return '\u2014'
                    const matched =
                      s.cashEntered === s.cashActual &&
                      s.cardEntered === s.cardActual &&
                      s.upiEntered === s.upiActual
                    return (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          matched ? 'bg-success/15 text-success' : 'bg-critical/15 text-critical'
                        }`}
                      >
                        {matched ? 'Matched' : 'Mismatch'}
                      </span>
                    )
                  },
                },
                {
                  key: 'action',
                  header: '',
                  render: (shift: ShiftRecord) => (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded p-1 text-accent/70 hover:bg-accent/10 hover:text-accent transition-colors"
                        title="Print day sales report"
                        onClick={() => {
                          const name = cashierNameMap.get(shift.userId) ?? shift.userId
                          printCashierShiftReport(shift, name)
                        }}
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-critical/70 hover:bg-critical/10 hover:text-critical transition-colors"
                        title="Delete shift"
                        onClick={async () => {
                          const name = cashierNameMap.get(shift.userId) ?? shift.userId
                          const ok = window.confirm(
                            `Delete shift for "${name}" on ${shift.shiftDate}?\n\nThis will permanently remove this shift record.`,
                          )
                          if (!ok) return
                          try {
                            await shiftsApi.delete(token!, shift.id)
                            await loadCashierDetails()
                          } catch (err) {
                            window.alert(
                              'Failed to delete shift. ' +
                                (err instanceof Error ? err.message : ''),
                            )
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ),
                },
              ]}
              rows={filteredCashierShifts}
              rowKey={(shift) => shift.id}
              emptyMessage={
                cashierShiftsLoading ? 'Loading cashier shifts...' : 'No cashier shift data found.'
              }
            />
          </DetailPanel>
        </div>
      ) : null}

      {view === 'insights' ? (
        <>
          <MetricStrip
            items={[
              {
                id: 'outgoing',
                label: 'Outgoing',
                value: String(insightsSummary?.outgoingCalls ?? 0),
              },
              {
                id: 'incoming',
                label: 'Incoming',
                value: String(insightsSummary?.incomingCalls ?? 0),
              },
              {
                id: 'connected',
                label: 'Connected',
                value: String(insightsSummary?.connectedCalls ?? 0),
              },
              { id: 'missed', label: 'Missed', value: String(insightsSummary?.missedCalls ?? 0) },
            ]}
          />
          <div className="mt-4">
            <DataTable
              columns={[
                { key: 'staff', header: 'Staff', render: (record) => record.staffName },
                {
                  key: 'outgoing',
                  header: 'Outgoing',
                  render: (record) => String(record.outgoingCalls),
                },
                {
                  key: 'incoming',
                  header: 'Incoming',
                  render: (record) => String(record.incomingCalls),
                },
                {
                  key: 'connected',
                  header: 'Connected',
                  render: (record) => String(record.connectedCalls),
                },
                { key: 'missed', header: 'Missed', render: (record) => String(record.missedCalls) },
                {
                  key: 'duration',
                  header: 'Talk Time (s)',
                  render: (record) => String(record.totalDurationSeconds),
                },
                {
                  key: 'average',
                  header: 'Avg Talk (s)',
                  render: (record) => String(record.averageTalkSeconds ?? 0),
                },
              ]}
              rows={staffInsights}
              rowKey={(record) => record.userId}
              emptyMessage={loading ? 'Loading insights...' : 'No staff insights available.'}
            />
          </div>
        </>
      ) : null}

      {view === 'daySales' ? (
        <div className="space-y-4">
          <FilterBar>
            <FilterField label="Date">
              <input
                type="date"
                className="ui-field min-h-10"
                value={daySalesDate}
                onChange={(e) => setDaySalesDate(e.target.value)}
              />
            </FilterField>
            <FilterField label="Location">
              <select
                className="ui-field min-h-10"
                value={daySalesLocation}
                onChange={(e) => setDaySalesLocation(e.target.value)}
              >
                <option value="" disabled>
                  Select Location
                </option>
                {enabledLocations.map((loc) => (
                  <option key={loc.slug} value={loc.slug}>
                    {loc.displayName}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label=" ">
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                disabled={!daySalesLocation || daySalesLoading}
                onClick={() => void loadDaySales()}
              >
                {daySalesLoading ? 'Loading...' : 'Load'}
              </button>
            </FilterField>
          </FilterBar>

          {!daySalesData && !daySalesLoading && !error && (
            <div className="rounded-lg border border-border px-6 py-10 text-center text-muted">
              Select a date and location, then click Load.
            </div>
          )}

          {daySalesData && (
            <>
              <SummaryCards
                items={[
                  {
                    id: 'txns',
                    label: 'Transactions',
                    value: String(daySalesData.transactionCount),
                    tone: 'info',
                  },
                  {
                    id: 'total',
                    label: 'Grand Total',
                    value: currency(daySalesData.salesSummary.grandTotal),
                    tone: 'success',
                  },
                  {
                    id: 'status',
                    label: 'Day Status',
                    value: daySalesDayClosed ? 'Closed' : 'Open',
                    tone: daySalesDayClosed ? 'success' : 'warning',
                  },
                ]}
              />

              <DetailPanel title="Sales Summary">
                <DataTable
                  columns={[
                    {
                      key: 'item',
                      header: 'Item',
                      render: (row: { label: string; value: string; bold?: boolean }) => (
                        <span className={row.bold ? 'font-bold text-text' : ''}>{row.label}</span>
                      ),
                    },
                    {
                      key: 'value',
                      header: 'Value',
                      render: (row: { label: string; value: string; bold?: boolean }) => (
                        <span className={`text-right ${row.bold ? 'font-bold text-text' : ''}`}>
                          {row.value}
                        </span>
                      ),
                    },
                  ]}
                  rows={[
                    { label: 'Cash', value: currency(daySalesData.salesSummary.cash) },
                    { label: 'UPI', value: currency(daySalesData.salesSummary.upi) },
                    { label: 'Card', value: currency(daySalesData.salesSummary.card) },
                    { label: 'Razorpay', value: currency(daySalesData.salesSummary.razorpay) },
                    { label: 'Discount', value: currency(daySalesData.salesSummary.discount) },
                    {
                      label: 'Protocol Entries',
                      value: String(daySalesData.salesSummary.protocolCount),
                    },
                    {
                      label: 'Grand Total',
                      value: currency(daySalesData.salesSummary.grandTotal),
                      bold: true,
                    },
                  ]}
                  rowKey={(row) => row.label}
                  emptyMessage="No sales data."
                />
              </DetailPanel>

              {daySalesData.vendorSummary.baseAmount > 0 && (
                <DetailPanel title="Third Party & Sublease Summary">
                  <DataTable
                    columns={[
                      {
                        key: 'item',
                        header: 'Item',
                        render: (row: { label: string; value: string }) => row.label,
                      },
                      {
                        key: 'value',
                        header: 'Value',
                        render: (row: { label: string; value: string }) => (
                          <span className="text-right">{row.value}</span>
                        ),
                      },
                    ]}
                    rows={[
                      {
                        label: 'Base Amount',
                        value: currency(daySalesData.vendorSummary.baseAmount),
                      },
                      {
                        label: 'GST Amount',
                        value: currency(daySalesData.vendorSummary.gstAmount),
                      },
                      {
                        label: 'Third Party Share',
                        value: currency(daySalesData.vendorSummary.thirdPartyShare),
                      },
                      {
                        label: 'Company Share',
                        value: currency(daySalesData.vendorSummary.companyShare),
                      },
                    ]}
                    rowKey={(row) => row.label}
                    emptyMessage="No vendor data."
                  />
                </DetailPanel>
              )}

              {daySalesData.vendorShares.length > 0 && (
                <DetailPanel title="Vendor Shares">
                  <DataTable
                    columns={[
                      { key: 'vendor', header: 'Vendor', render: (row) => row.vendorName },
                      { key: 'type', header: 'Type', render: (row) => row.vendorType },
                      { key: 'sales', header: 'Sales', render: (row) => currency(row.sales) },
                      { key: 'tax', header: 'Tax (18%)', render: (row) => currency(row.tax) },
                      { key: 'net', header: 'Net', render: (row) => currency(row.net) },
                      {
                        key: 'tpShare',
                        header: 'TP Share',
                        render: (row) => currency(row.tpShare),
                      },
                      {
                        key: 'asgShare',
                        header: 'Co. Share',
                        render: (row) => currency(row.asgShare),
                      },
                    ]}
                    rows={[
                      ...daySalesData.vendorShares,
                      {
                        vendorName: 'Total',
                        vendorType: '',
                        sales: daySalesData.vendorTotals.sales,
                        tax: daySalesData.vendorTotals.tax,
                        net: daySalesData.vendorTotals.net,
                        tpShare: daySalesData.vendorTotals.tpShare,
                        asgShare: daySalesData.vendorTotals.asgShare,
                      },
                    ]}
                    rowKey={(row) => row.vendorName}
                    emptyMessage="No vendor shares."
                  />
                </DetailPanel>
              )}

              {!daySalesDayClosed && (
                <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
                  <span className="text-sm text-warning">
                    Day not closed yet. Complete shift checkout to generate report.
                  </span>
                </div>
              )}

              <button
                type="button"
                disabled={!daySalesDayClosed || daySalesPrintLoading}
                className="ui-btn ui-btn-primary disabled:opacity-50"
                onClick={async () => {
                  setDaySalesPrintLoading(true)
                  try {
                    await printDayReport(daySalesData!, session?.user.name, session?.token)
                  } catch (err) {
                    window.alert(
                      'Failed to print report. ' + (err instanceof Error ? err.message : ''),
                    )
                  } finally {
                    setDaySalesPrintLoading(false)
                  }
                }}
              >
                {daySalesPrintLoading ? 'Generating...' : 'Print Day Report'}
              </button>
            </>
          )}
        </div>
      ) : null}
    </ModulePageLayout>
  )
}

export default ReportsModule
