import { Navigate } from 'react-router-dom'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { useAuth } from '../../features/auth/auth-context'
import { normalizeRole } from './bookings/bookings-utils'
import HelicopterDashboardView from './helicopter/HelicopterDashboardView'
import HelicopterSlotsView from './helicopter/HelicopterSlotsView'
import HelicopterBookingsView from './helicopter/HelicopterBookingsView'
import HelicopterManifestView from './helicopter/HelicopterManifestView'
import HelicopterPricingView from './helicopter/HelicopterPricingView'
import HelicopterReportsView from './helicopter/HelicopterReportsView'

type HelicopterView = 'dashboard' | 'slots' | 'bookings' | 'manifest' | 'pricing' | 'reports'

const subnav = [
  { label: 'Dashboard', to: '/helicopter/dashboard' },
  { label: 'Slots', to: '/helicopter/slots' },
  { label: 'Bookings', to: '/helicopter/bookings' },
  { label: 'Manifest', to: '/helicopter/manifest' },
  { label: 'Pricing', to: '/helicopter/pricing' },
  { label: 'Reports', to: '/helicopter/reports' },
]

const titleMap: Record<HelicopterView, string> = {
  dashboard: 'Helicopter Joy Rides',
  slots: 'Slot Management',
  bookings: 'Helicopter Bookings',
  manifest: 'Passenger Manifest',
  pricing: 'Pricing & Payments',
  reports: 'Helicopter Reports',
}

const subtitleMap: Record<HelicopterView, string> = {
  dashboard: "Today's capacity, revenue, and availability at a glance.",
  slots: 'Schedule dates, times, capacity, and branch availability.',
  bookings: 'All helicopter bookings — filter, check-in, or cancel.',
  manifest: 'Printable passenger list with weight and check-in state.',
  pricing: 'Package catalog, payment links, and early-bird thresholds.',
  reports: 'Revenue, occupancy, and branch breakdown.',
}

// Views each role may access. Others redirect to a safe landing view.
const roleAllowedViews: Record<string, HelicopterView[]> = {
  owner: ['dashboard', 'slots', 'bookings', 'manifest', 'pricing', 'reports'],
  admin: ['dashboard', 'slots', 'bookings', 'manifest', 'pricing', 'reports'],
  developer: ['dashboard', 'slots', 'bookings', 'manifest', 'pricing', 'reports'],
  backend: ['dashboard', 'slots', 'bookings', 'manifest', 'pricing', 'reports'],
  cashier: ['dashboard', 'bookings', 'pricing'],
  incharge: ['dashboard', 'bookings', 'manifest'],
}

const roleDefaultView: Record<string, HelicopterView> = {
  cashier: 'pricing',
  incharge: 'manifest',
}

const HelicopterModule = ({ view = 'dashboard' }: { view?: HelicopterView }) => {
  const { session } = useAuth()
  if (!session) return null

  const role = normalizeRole(session.user.role)
  const allowed = roleAllowedViews[role] ?? ['dashboard']

  if (!allowed.includes(view)) {
    const fallback = roleDefaultView[role] ?? 'dashboard'
    return <Navigate replace to={`/helicopter/${fallback}`} />
  }

  const filteredSubnav = subnav.filter((entry) => {
    const viewKey = entry.to.split('/').pop() as HelicopterView
    return allowed.includes(viewKey)
  })

  return (
    <ModulePageLayout
      moduleTab="Helicopter"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={['Pipeline', 'Helicopter', titleMap[view]]}
      subnav={filteredSubnav}
    >
      {view === 'dashboard' && <HelicopterDashboardView />}
      {view === 'slots' && <HelicopterSlotsView />}
      {view === 'bookings' && <HelicopterBookingsView />}
      {view === 'manifest' && <HelicopterManifestView />}
      {view === 'pricing' && <HelicopterPricingView />}
      {view === 'reports' && <HelicopterReportsView />}
    </ModulePageLayout>
  )
}

export default HelicopterModule
