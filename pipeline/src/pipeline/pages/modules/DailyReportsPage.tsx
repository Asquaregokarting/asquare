import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { DailyReportsHub } from '../../features/daily-reports/DailyReportsHub'

const SUBNAV = [
  { label: 'Daily', to: '/reports/daily' },
  { label: 'Operations', to: '/reports/operations' },
  { label: 'Revenue', to: '/reports/revenue' },
  { label: 'Shifts', to: '/reports/shifts' },
  { label: 'Call History', to: '/reports/call-history' },
  { label: 'Insights', to: '/reports/insights' },
  { label: 'Booking Revenue', to: '/reports/booking-revenue' },
  { label: 'Game Revenue', to: '/reports/game-revenue' },
  { label: 'Day Sales', to: '/reports/day-sales' },
]

const DailyReportsPage = () => (
  <ModulePageLayout
    moduleTab="Reports"
    title="Daily Reports"
    subtitle="Audit cashier-submitted settlements across every branch — spot, drill, flag, re-print."
    breadcrumbs={['Pipeline', 'Reports', 'Daily']}
    subnav={SUBNAV}
  >
    <DailyReportsHub mode="owner" />
  </ModulePageLayout>
)

export default DailyReportsPage
