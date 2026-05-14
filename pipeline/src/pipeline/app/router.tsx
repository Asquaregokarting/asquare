import { lazy, ReactNode, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { vendorDetailsApi } from '../api/vendor-details'
import { useAuth } from '../features/auth/auth-context'
import { rolePathMap } from '../features/dashboard/role-config'
import { getTabsForRole } from '../features/navigation/module-manifest'
import LoginPage from '../pages/LoginPage'
import RoleGuardRoute from './RoleGuardRoute'

const OwnerDashboard = lazy(() => import('../pages/dashboard/OwnerDashboard'))
const AdminDashboard = lazy(() => import('../pages/dashboard/AdminDashboard'))
const TelecallerDashboard = lazy(() => import('../pages/dashboard/TelecallerDashboard'))
const CashierDashboard = lazy(() => import('../pages/dashboard/CashierDashboard'))
const TrackMarshallDashboard = lazy(() => import('../pages/dashboard/TrackMarshallDashboard'))
const EditorDashboard = lazy(() => import('../pages/dashboard/EditorDashboard'))
const DeveloperDashboard = lazy(() => import('../pages/dashboard/DeveloperDashboard'))
const BackendDashboard = lazy(() => import('../pages/dashboard/BackendDashboard'))
const ThirdPartyDashboard = lazy(() => import('../pages/dashboard/ThirdPartyDashboard'))
const HRDashboard = lazy(() => import('../pages/dashboard/HRDashboard'))
const AccountantDashboard = lazy(() => import('../pages/dashboard/AccountantDashboard'))

const ShiftsModule = lazy(() => import('../pages/modules/ShiftsModule'))
const BillingModule = lazy(() => import('../pages/modules/BillingModule'))
const BookingsModule = lazy(() => import('../pages/modules/BookingsModule'))
const HelicopterModule = lazy(() => import('../pages/modules/HelicopterModule'))
const ActivitiesModule = lazy(() => import('../pages/modules/ActivitiesModule'))
const TrackModule = lazy(() => import('../pages/modules/TrackModule'))
const InchargeModule = lazy(() => import('../pages/modules/InchargeModule'))
const WorkspacesModule = lazy(() => import('../pages/modules/WorkspacesModule'))
const TasksModule = lazy(() => import('../pages/modules/TasksModule'))
const FilesModule = lazy(() => import('../pages/modules/FilesModule'))
const ReportsModule = lazy(() => import('../pages/modules/ReportsModule'))
const DailyReportsPage = lazy(() => import('../pages/modules/DailyReportsPage'))
const AdminModule = lazy(() => import('../pages/modules/AdminModule'))
const CustomerDetailPage = lazy(() => import('../pages/modules/customer-detail/CustomerDetailPage'))
const CleanupDeletedTelecallers = lazy(() =>
  import('../pages/CleanupDeletedTelecallers').then((m) => ({
    default: m.CleanupDeletedTelecallers,
  })),
)
const AccountingModule = lazy(() => import('../pages/modules/AccountingModule'))
const GameRevenueModule = lazy(() => import('../pages/modules/GameRevenueModule'))
const CouponsModule = lazy(() => import('../pages/modules/CouponsModule'))
const LeadsModule = lazy(() => import('../pages/modules/LeadsModule'))
const CouponOutreachModule = lazy(() => import('../pages/modules/CouponOutreachModule'))
const LocationsModule = lazy(() => import('../pages/modules/LocationsModule'))
const KartfluencerModule = lazy(() => import('../pages/modules/KartfluencerModule'))
const IncentivesModule = lazy(() => import('../pages/modules/IncentivesModule'))
const SettingsModule = lazy(() => import('../pages/modules/SettingsModule'))
const BannersModule = lazy(() => import('../pages/modules/BannersModule'))
const EventCampaignsModule = lazy(() => import('../pages/modules/EventCampaignsModule'))
const ReconciliationModule = lazy(
  () => import('../pages/modules/reconciliation/ReconciliationModule'),
)
const ThirdPartyPortalPage = lazy(() => import('../pages/ThirdPartyPortalPage'))
const PartnerPortalPage = lazy(() => import('../pages/PartnerPortalPage'))
const MonitorModule = lazy(() => import('../pages/modules/MonitorModule'))
const TicketsModule = lazy(() => import('../pages/modules/tickets/TicketsModule'))
const TicketDetailRoute = lazy(() => import('../pages/modules/tickets/TicketDetailRoute'))
const GrievancesModule = lazy(() => import('../pages/modules/grievances/GrievancesModule'))
const HRDocumentsModule = lazy(() => import('../pages/modules/hr/HRDocumentsModule'))
const HRCalendarModule = lazy(() => import('../pages/modules/hr/HRCalendarModule'))
const EmployeesModule = lazy(() => import('../pages/modules/hr/EmployeesModule'))
const HRAppraisalsModule = lazy(() => import('../pages/modules/hr/HRAppraisalsModule'))
const HRPayrollModule = lazy(() => import('../pages/modules/hr/HRPayrollModule'))
const KartMonitorModule = lazy(() => import('../pages/modules/hr/KartMonitorModule'))

const CriticalSound = lazy(() =>
  import('../components/tickets/CriticalSound').then((m) => ({ default: m.CriticalSound })),
)

const Protected = ({ children }: { children: ReactNode }) => {
  const { session } = useAuth()
  if (!session) {
    return <Navigate replace to="/login" />
  }
  return (
    <>
      <Suspense fallback={null}>
        <CriticalSound />
      </Suspense>
      {children}
    </>
  )
}

const getPreferredLandingPath = (userId: string): string | null => {
  const raw = localStorage.getItem(`pipeline-preferences:${userId}`)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as { defaultTabPath?: string }
    if (typeof parsed.defaultTabPath === 'string' && parsed.defaultTabPath.startsWith('/')) {
      return parsed.defaultTabPath
    }
  } catch {
    return null
  }

  return null
}

const RootRedirect = () => {
  const { session } = useAuth()
  if (!session) {
    return <Navigate replace to="/login" />
  }

  const allowedTabPaths = new Set(getTabsForRole(session.user.role).map((tab) => tab.path))
  const preferredPath = getPreferredLandingPath(session.user.id)
  if (preferredPath && allowedTabPaths.has(preferredPath)) {
    return <Navigate replace to={preferredPath} />
  }

  return <Navigate replace to={rolePathMap[session.user.role]} />
}

const RouteFallback = () => (
  <div className="grid min-h-screen place-items-center bg-base px-4 text-sm text-muted">
    Loading page...
  </div>
)

const VendorRegistrationGate = ({ children }: { children: ReactNode }) => {
  const { session } = useAuth()
  const location = useLocation()
  const [checking, setChecking] = useState(false)
  const [hasVendorDetails, setHasVendorDetails] = useState(false)

  useEffect(() => {
    if (!session || session.user.role !== 'ThirdParty') {
      setChecking(false)
      setHasVendorDetails(false)
      return
    }

    let cancelled = false
    setChecking(true)
    void vendorDetailsApi
      .getMine(session.token)
      .then(() => {
        if (!cancelled) {
          setHasVendorDetails(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasVendorDetails(false)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setChecking(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [session])

  if (!session || session.user.role !== 'ThirdParty') {
    return children
  }

  const isExemptPath =
    location.pathname === rolePathMap.ThirdParty ||
    location.pathname.startsWith('/settings') ||
    location.pathname.startsWith('/activities') ||
    location.pathname.startsWith('/accounting') ||
    location.pathname.startsWith('/game-revenue') ||
    location.pathname.startsWith('/bookings')
  if (checking && !isExemptPath) {
    return <RouteFallback />
  }

  if (!hasVendorDetails && !isExemptPath) {
    return <Navigate replace to={rolePathMap.ThirdParty} state={{ vendorRequired: true }} />
  }

  return children
}

const ProtectedRoute = ({ children }: { children: ReactNode }) => (
  <Protected>
    <VendorRegistrationGate>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </VendorRegistrationGate>
  </Protected>
)

const DashboardRedirect = () => {
  const { session } = useAuth()
  if (!session) {
    return <Navigate replace to="/login" />
  }
  return <Navigate replace to={rolePathMap[session.user.role]} />
}

const DashboardRoleRoute = () => {
  const { role } = useParams<{ role: string }>()
  switch ((role ?? '').toLowerCase()) {
    case 'owner':
      return <OwnerDashboard />
    case 'admin':
      return <AdminDashboard />
    case 'telecaller':
      return <TelecallerDashboard />
    case 'cashier':
      return <CashierDashboard />
    case 'track-marshall':
    case 'trackmarshall':
      return <TrackMarshallDashboard />
    case 'incharge':
      // Incharge users land on /incharge/tasks via rolePathMap, but if a user
      // explicitly hits /dashboard/incharge, reuse the TrackMarshall dashboard
      // as a placeholder so the route table stays exhaustive.
      return <TrackMarshallDashboard />
    case 'editor':
      return <EditorDashboard />
    case 'developer':
      return <DeveloperDashboard />
    case 'backend':
      return <BackendDashboard />
    case 'third-party':
    case 'thirdparty':
      return <ThirdPartyDashboard />
    case 'hr':
      return <HRDashboard />
    case 'accountant':
      return <AccountantDashboard />
    default:
      return <Navigate replace to="/dashboard" />
  }
}

const KartfluencerProfileRoute = () => {
  const { influencerId } = useParams<{ influencerId: string }>()
  if (!influencerId) return <Navigate replace to="/kartfluencer/list" />
  return <KartfluencerModule view="profile" influencerId={influencerId} />
}

const routerBasename = (() => {
  const baseUrl = import.meta.env.BASE_URL
  if (!baseUrl || baseUrl === '/') {
    return undefined
  }
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
})()

export const AppRouter = () => (
  <BrowserRouter basename={routerBasename}>
    <PipelineRoutes />
  </BrowserRouter>
)

export const PipelineRoutes = () => (
  <Routes>
    <Route path="/" element={<RootRedirect />} />
    <Route path="/login" element={<LoginPage />} />
    <Route
      path="/third-party"
      element={
        <Suspense fallback={<RouteFallback />}>
          <ThirdPartyPortalPage />
        </Suspense>
      }
    />
    <Route
      path="/partner"
      element={
        <Suspense fallback={<RouteFallback />}>
          <PartnerPortalPage />
        </Suspense>
      }
    />
    <Route
      path="/cleanup-telecallers"
      element={
        <ProtectedRoute>
          <CleanupDeletedTelecallers />
        </ProtectedRoute>
      }
    />
    <Route
      path="/dashboard"
      element={
        <ProtectedRoute>
          <DashboardRedirect />
        </ProtectedRoute>
      }
    />
    <Route
      path="/dashboard/:role"
      element={
        <ProtectedRoute>
          <DashboardRoleRoute />
        </ProtectedRoute>
      }
    />
    <Route
      path="/shifts/my"
      element={
        <ProtectedRoute>
          <ShiftsModule view="my" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/shifts/team"
      element={
        <ProtectedRoute>
          <ShiftsModule view="team" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/shifts/reports"
      element={
        <ProtectedRoute>
          <ShiftsModule view="reports" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/shifts/leave"
      element={
        <ProtectedRoute>
          <ShiftsModule view="leave" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/billing/pos"
      element={
        <ProtectedRoute>
          <BillingModule view="pos" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/billing/transactions"
      element={
        <ProtectedRoute>
          <BillingModule view="transactions" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/billing/invoices/:invoiceNumber"
      element={
        <ProtectedRoute>
          <BillingModule view="invoice" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/billing/reprint"
      element={
        <ProtectedRoute>
          <BillingModule view="reprint" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/billing/refunds"
      element={
        <ProtectedRoute>
          <BillingModule view="refunds" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/billing/revenue"
      element={
        <ProtectedRoute>
          <BillingModule view="revenue" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/billing/report"
      element={
        <ProtectedRoute>
          <BillingModule view="report" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/billing/printlogs"
      element={
        <ProtectedRoute>
          <BillingModule view="printlogs" />
        </ProtectedRoute>
      }
    />
    <Route path="/billing/helicopter" element={<Navigate replace to="/helicopter/pricing" />} />
    <Route path="/helicopter" element={<Navigate replace to="/helicopter/dashboard" />} />
    <Route
      path="/helicopter/dashboard"
      element={
        <ProtectedRoute>
          <HelicopterModule view="dashboard" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/helicopter/slots"
      element={
        <ProtectedRoute>
          <HelicopterModule view="slots" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/helicopter/bookings"
      element={
        <ProtectedRoute>
          <HelicopterModule view="bookings" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/helicopter/manifest"
      element={
        <ProtectedRoute>
          <HelicopterModule view="manifest" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/helicopter/pricing"
      element={
        <ProtectedRoute>
          <HelicopterModule view="pricing" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/helicopter/reports"
      element={
        <ProtectedRoute>
          <HelicopterModule view="reports" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/accounting/ledger"
      element={
        <ProtectedRoute>
          <AccountingModule view="ledger" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/accounting/invoices"
      element={
        <ProtectedRoute>
          <AccountingModule view="invoices" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/accounting/settlements"
      element={
        <ProtectedRoute>
          <AccountingModule view="settlements" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/accounting/reports"
      element={
        <ProtectedRoute>
          <AccountingModule view="reports" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/accounting/discrepancies"
      element={
        <ProtectedRoute>
          <AccountingModule view="discrepancies" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/game-revenue"
      element={
        <ProtectedRoute>
          <GameRevenueModule />
        </ProtectedRoute>
      }
    />
    <Route
      path="/incentives/dashboard"
      element={
        <ProtectedRoute>
          <IncentivesModule view="dashboard" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/incentives/weekly"
      element={
        <ProtectedRoute>
          <IncentivesModule view="weeklyReport" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/incentives/cashiers"
      element={
        <ProtectedRoute>
          <IncentivesModule view="cashierBreakdown" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/incentives/monthly"
      element={
        <ProtectedRoute>
          <IncentivesModule view="monthly" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/incentives/config"
      element={
        <ProtectedRoute>
          <IncentivesModule view="config" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/activities/list"
      element={
        <ProtectedRoute>
          <ActivitiesModule view="list" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/activities/combos"
      element={
        <ProtectedRoute>
          <ActivitiesModule view="combos" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/activities/bulk-import"
      element={
        <ProtectedRoute>
          <ActivitiesModule view="bulk-import" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/bookings"
      element={
        <ProtectedRoute>
          <Navigate replace to="/bookings/create" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/bookings/create"
      element={
        <ProtectedRoute>
          <BookingsModule />
        </ProtectedRoute>
      }
    />
    <Route
      path="/activities/bookings"
      element={
        <ProtectedRoute>
          <Navigate replace to="/bookings/create" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/track/board"
      element={
        <ProtectedRoute>
          <TrackModule view="board" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/track/karts"
      element={
        <ProtectedRoute>
          <TrackModule view="karts" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/track/reports"
      element={
        <ProtectedRoute>
          <TrackModule view="reports" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/track/sessions"
      element={
        <ProtectedRoute>
          <TrackModule view="sessions" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/track/queue"
      element={
        <ProtectedRoute>
          <TrackModule view="queue" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/track/incidents"
      element={
        <ProtectedRoute>
          <TrackModule view="incidents" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/track/waiting"
      element={
        <ProtectedRoute>
          <TrackModule view="waiting" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/track/scanner"
      element={
        <ProtectedRoute>
          <TrackModule view="scanner" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/incharge/tasks"
      element={
        <ProtectedRoute>
          <InchargeModule view="tasks" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/incharge/vehicle"
      element={
        <ProtectedRoute>
          <InchargeModule view="vehicle" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/incharge/reports"
      element={
        <ProtectedRoute>
          <InchargeModule view="reports" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/workspaces"
      element={
        <ProtectedRoute>
          <WorkspacesModule view="list" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/workspaces/recycle-bin"
      element={
        <ProtectedRoute>
          <WorkspacesModule view="recycleBin" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/workspaces/:workspaceId"
      element={
        <ProtectedRoute>
          <WorkspacesModule view="detail" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/workspaces/:workspaceId/task/:taskId"
      element={
        <ProtectedRoute>
          <WorkspacesModule view="taskDetail" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/workspaces/contacts"
      element={
        <ProtectedRoute>
          <WorkspacesModule view="contacts" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/workspaces/work-report"
      element={
        <ProtectedRoute>
          <WorkspacesModule view="workReport" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/tasks/my"
      element={
        <ProtectedRoute>
          <TasksModule view="my" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/tasks/board"
      element={
        <ProtectedRoute>
          <TasksModule view="board" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/tasks/overdue"
      element={
        <ProtectedRoute>
          <TasksModule view="overdue" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/tasks/:taskId"
      element={
        <ProtectedRoute>
          <TasksModule view="detail" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/tasks/todos"
      element={
        <ProtectedRoute>
          <TasksModule view="todos" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/files/library"
      element={
        <ProtectedRoute>
          <FilesModule view="library" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/files/uploads"
      element={
        <ProtectedRoute>
          <FilesModule view="uploads" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/reports/daily"
      element={
        <ProtectedRoute>
          <DailyReportsPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/reports/operations"
      element={
        <ProtectedRoute>
          <ReportsModule view="operations" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/reports/revenue"
      element={
        <ProtectedRoute>
          <ReportsModule view="revenue" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/reports/shifts"
      element={
        <ProtectedRoute>
          <ReportsModule view="shifts" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/reports/call-history"
      element={
        <ProtectedRoute>
          <ReportsModule view="callHistory" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/reports/insights"
      element={
        <ProtectedRoute>
          <ReportsModule view="insights" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/reports/game-revenue"
      element={
        <ProtectedRoute>
          <ReportsModule view="gameRevenue" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/reports/cashier-details"
      element={
        <ProtectedRoute>
          <ReportsModule view="cashierDetails" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/reports/day-sales"
      element={
        <ProtectedRoute>
          <ReportsModule view="daySales" />
        </ProtectedRoute>
      }
    />
    <Route path="/reports/tickets" element={<Navigate replace to="/tickets" />} />
    <Route
      path="/tickets"
      element={
        <ProtectedRoute>
          <TicketsModule view="list" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/tickets/analytics"
      element={
        <ProtectedRoute>
          <TicketsModule view="analytics" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/tickets/branch"
      element={
        <ProtectedRoute>
          <TicketsModule view="branch" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/tickets/heatmap"
      element={
        <ProtectedRoute>
          <TicketsModule view="heatmap" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/tickets/karts"
      element={
        <ProtectedRoute>
          <TicketsModule view="karts" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/tickets/mine"
      element={
        <ProtectedRoute>
          <TicketsModule view="mine" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/tickets/:ticketId"
      element={
        <ProtectedRoute>
          <TicketDetailRoute />
        </ProtectedRoute>
      }
    />
    <Route
      path="/grievances"
      element={
        <ProtectedRoute>
          <GrievancesModule />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/users"
      element={
        <ProtectedRoute>
          <AdminModule view="users" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/audit"
      element={
        <ProtectedRoute>
          <AdminModule view="audit" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/roles"
      element={
        <ProtectedRoute>
          <AdminModule view="roles" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/vendors"
      element={
        <ProtectedRoute>
          <AdminModule view="vendors" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/registrations"
      element={
        <ProtectedRoute>
          <AdminModule view="registrations" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/telecallers"
      element={
        <ProtectedRoute>
          <Navigate replace to="/incentives/telecallers" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/incentives/telecallers"
      element={
        <ProtectedRoute>
          <AdminModule view="telecallers" moduleContext="incentives" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/customers"
      element={
        <ProtectedRoute>
          <AdminModule view="customers" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/customers/:customerId"
      element={
        <ProtectedRoute>
          <CustomerDetailPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/locations"
      element={
        <ProtectedRoute>
          <AdminModule view="locations" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/notifications"
      element={
        <ProtectedRoute>
          <AdminModule view="notifications" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/admin/customer-controls"
      element={
        <ProtectedRoute>
          <AdminModule view="customer-controls" />
        </ProtectedRoute>
      }
    />
    <Route path="/admin/members" element={<Navigate to="/admin/customers" replace />} />
    <Route
      path="/bookings/list"
      element={
        <ProtectedRoute>
          <BookingsModule view="list" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/bookings/trash"
      element={
        <ProtectedRoute>
          <BookingsModule view="trash" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/bookings/ticket"
      element={
        <ProtectedRoute>
          <BookingsModule view="ticket" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/bookings/checkin"
      element={
        <ProtectedRoute>
          <BookingsModule view="checkin" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/bookings/protocol"
      element={
        <ProtectedRoute>
          <BookingsModule view="protocol" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/bookings/offers"
      element={
        <ProtectedRoute>
          <BookingsModule view="offers" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/coupons/list"
      element={
        <ProtectedRoute>
          <CouponsModule view="list" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/coupons/game-coupons"
      element={
        <ProtectedRoute>
          <CouponsModule view="gameCoupons" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/coupons/user-coupons"
      element={
        <ProtectedRoute>
          <CouponsModule view="userCoupons" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/reports/booking-revenue"
      element={
        <ProtectedRoute>
          <ReportsModule view="bookingRevenue" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/leads/pipeline"
      element={
        <ProtectedRoute>
          <RoleGuardRoute blockedRoles={['Telecaller']} fallbackPath="/leads/inbox">
            <LeadsModule view="pipeline" />
          </RoleGuardRoute>
        </ProtectedRoute>
      }
    />
    <Route
      path="/leads/inbox"
      element={
        <ProtectedRoute>
          <LeadsModule view="inbox" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/leads/feedback-calls"
      element={
        <ProtectedRoute>
          <LeadsModule view="feedbackcalls" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/leads/feedback-metrics"
      element={
        <ProtectedRoute>
          <RoleGuardRoute blockedRoles={['Telecaller']} fallbackPath="/leads/feedback-calls">
            <LeadsModule view="feedbackmetrics" />
          </RoleGuardRoute>
        </ProtectedRoute>
      }
    />
    <Route
      path="/leads/performance"
      element={
        <ProtectedRoute>
          <LeadsModule view="performance" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/leads/metrics"
      element={
        <ProtectedRoute>
          <RoleGuardRoute blockedRoles={['Telecaller']} fallbackPath="/leads/inbox">
            <LeadsModule view="metrics" />
          </RoleGuardRoute>
        </ProtectedRoute>
      }
    />
    <Route
      path="/leads/interakt"
      element={
        <ProtectedRoute>
          <RoleGuardRoute blockedRoles={['Telecaller']} fallbackPath="/leads/inbox">
            <LeadsModule view="interakt" />
          </RoleGuardRoute>
        </ProtectedRoute>
      }
    />
    <Route
      path="/leads/import"
      element={
        <ProtectedRoute>
          <RoleGuardRoute blockedRoles={['Telecaller']} fallbackPath="/leads/inbox">
            <LeadsModule view="import" />
          </RoleGuardRoute>
        </ProtectedRoute>
      }
    />
    <Route
      path="/leads/config"
      element={
        <ProtectedRoute>
          <RoleGuardRoute blockedRoles={['Telecaller']} fallbackPath="/leads/inbox">
            <LeadsModule view="config" />
          </RoleGuardRoute>
        </ProtectedRoute>
      }
    />
    <Route
      path="/coupon-outreach/inbox"
      element={
        <ProtectedRoute>
          <CouponOutreachModule view="inbox" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/coupon-outreach/batch"
      element={
        <ProtectedRoute>
          <RoleGuardRoute blockedRoles={['Telecaller']} fallbackPath="/coupon-outreach/inbox">
            <CouponOutreachModule view="batch" />
          </RoleGuardRoute>
        </ProtectedRoute>
      }
    />
    <Route
      path="/coupon-outreach/history"
      element={
        <ProtectedRoute>
          <RoleGuardRoute blockedRoles={['Telecaller']} fallbackPath="/coupon-outreach/inbox">
            <CouponOutreachModule view="history" />
          </RoleGuardRoute>
        </ProtectedRoute>
      }
    />
    <Route
      path="/locations"
      element={
        <ProtectedRoute>
          <LocationsModule />
        </ProtectedRoute>
      }
    />
    <Route
      path="/kartfluencer/list"
      element={
        <ProtectedRoute>
          <KartfluencerModule view="list" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/kartfluencer/pipeline"
      element={
        <ProtectedRoute>
          <KartfluencerModule view="pipeline" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/kartfluencer/reels"
      element={
        <ProtectedRoute>
          <KartfluencerModule view="reels" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/kartfluencer/notifications"
      element={
        <ProtectedRoute>
          <KartfluencerModule view="notifications" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/kartfluencer/import"
      element={
        <ProtectedRoute>
          <KartfluencerModule view="import" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/kartfluencer/config"
      element={
        <ProtectedRoute>
          <KartfluencerModule view="config" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/kartfluencer/scanner"
      element={
        <ProtectedRoute>
          <KartfluencerModule view="scanner" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/kartfluencer/withdrawals"
      element={
        <ProtectedRoute>
          <KartfluencerModule view="withdrawals" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/kartfluencer/analytics"
      element={
        <ProtectedRoute>
          <KartfluencerModule view="analytics" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/kartfluencer/profile/:influencerId"
      element={
        <ProtectedRoute>
          <KartfluencerProfileRoute />
        </ProtectedRoute>
      }
    />
    <Route
      path="/banners/list"
      element={
        <ProtectedRoute>
          <BannersModule view="list" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/banners/edit"
      element={
        <ProtectedRoute>
          <BannersModule view="edit" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/banners/edit/:slideId"
      element={
        <ProtectedRoute>
          <BannersModule view="edit" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/event-campaigns/manage"
      element={
        <ProtectedRoute>
          <EventCampaignsModule view="manage" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/event-campaigns/create"
      element={
        <ProtectedRoute>
          <EventCampaignsModule view="create" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/event-campaigns/edit/:campaignId"
      element={
        <ProtectedRoute>
          <EventCampaignsModule view="edit" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/reconciliation/orphans"
      element={
        <ProtectedRoute>
          <ReconciliationModule />
        </ProtectedRoute>
      }
    />
    <Route
      path="/monitor"
      element={
        <ProtectedRoute>
          <MonitorModule />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/employees"
      element={
        <ProtectedRoute>
          <EmployeesModule view="list" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/employees/:employeeId"
      element={
        <ProtectedRoute>
          <EmployeesModule view="detail" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/documents"
      element={
        <ProtectedRoute>
          <HRDocumentsModule />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/calendar"
      element={
        <ProtectedRoute>
          <HRCalendarModule view="calendar" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/calendar/todos"
      element={
        <ProtectedRoute>
          <HRCalendarModule view="todos" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/calendar/reminders"
      element={
        <ProtectedRoute>
          <HRCalendarModule view="reminders" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/appraisals"
      element={
        <ProtectedRoute>
          <HRAppraisalsModule view="list" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/appraisals/:appraisalId"
      element={
        <ProtectedRoute>
          <HRAppraisalsModule view="detail" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/payroll"
      element={
        <ProtectedRoute>
          <HRPayrollModule view="runs" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/payroll/runs/:runId"
      element={
        <ProtectedRoute>
          <HRPayrollModule view="runDetail" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/payroll/slips/:slipId"
      element={
        <ProtectedRoute>
          <HRPayrollModule view="slipDetail" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/kart-monitor"
      element={
        <ProtectedRoute>
          <KartMonitorModule view="board" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/kart-monitor/daily"
      element={
        <ProtectedRoute>
          <KartMonitorModule view="daily" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/hr/kart-monitor/scanner"
      element={
        <ProtectedRoute>
          <KartMonitorModule view="scanner" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/settings/gamification"
      element={
        <ProtectedRoute>
          <SettingsModule view="gamification" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/settings/profile"
      element={
        <ProtectedRoute>
          <SettingsModule view="profile" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/settings/password"
      element={
        <ProtectedRoute>
          <SettingsModule view="password" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/settings/preferences"
      element={
        <ProtectedRoute>
          <SettingsModule view="preferences" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/settings/devices"
      element={
        <ProtectedRoute>
          <SettingsModule view="devices" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/settings/template-images"
      element={
        <ProtectedRoute>
          <SettingsModule view="template-images" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/settings/tickets/categories"
      element={
        <ProtectedRoute>
          <SettingsModule view="tickets-categories" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/settings/tickets/kb"
      element={
        <ProtectedRoute>
          <SettingsModule view="tickets-kb" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/settings/tickets/canned"
      element={
        <ProtectedRoute>
          <SettingsModule view="tickets-canned" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/telecallers"
      element={
        <ProtectedRoute>
          <Navigate replace to="/incentives/telecallers" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/call-history"
      element={
        <ProtectedRoute>
          <Navigate replace to="/reports/call-history" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/insights"
      element={
        <ProtectedRoute>
          <Navigate replace to="/reports/insights" />
        </ProtectedRoute>
      }
    />
    <Route path="/helicopter-bookings" element={<Navigate replace to="/helicopter/bookings" />} />
    <Route
      path="/todos"
      element={
        <ProtectedRoute>
          <Navigate replace to="/workspaces" />
        </ProtectedRoute>
      }
    />
    <Route
      path="/contacts"
      element={
        <ProtectedRoute>
          <Navigate replace to="/workspaces/contacts" />
        </ProtectedRoute>
      }
    />
    <Route path="*" element={<Navigate replace to="/" />} />
  </Routes>
)
