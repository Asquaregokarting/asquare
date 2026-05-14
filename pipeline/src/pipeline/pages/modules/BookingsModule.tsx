import { Navigate } from 'react-router-dom'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { useAuth } from '../../features/auth/auth-context'
import { normalizeRole } from './bookings/bookings-utils'
import CreateBookingView from './bookings/CreateBookingView'
import AllBookingsView from './bookings/AllBookingsView'
import TrashView from './bookings/TrashView'
import TicketLookupView from './bookings/TicketLookupView'
import ProtocolApprovalView from './bookings/ProtocolApprovalView'
import OfferApprovalView from './bookings/OfferApprovalView'
import CheckInConfigView from './bookings/CheckInConfigView'

type BookingsView = 'create' | 'list' | 'trash' | 'checkin' | 'ticket' | 'protocol' | 'offers'

const bookingsSubnav = [
  { label: 'Create', to: '/bookings/create' },
  { label: 'All Bookings', to: '/bookings/list' },
  { label: 'Protocol', to: '/bookings/protocol' },
  { label: 'Offers', to: '/bookings/offers' },
  { label: 'Ticket', to: '/bookings/ticket' },
  { label: 'Trash', to: '/bookings/trash' },
  { label: 'Check-In', to: '/bookings/checkin' },
]

const titleMap: Record<BookingsView, string> = {
  create: 'Bookings Operations',
  list: 'All Bookings',
  trash: 'Deleted Bookings',
  checkin: 'Check-In Settings',
  ticket: 'Print Ticket',
  protocol: 'Protocol Bookings',
  offers: 'Offer Bookings',
}

const subtitleMap: Record<BookingsView, string> = {
  create: 'Pipeline uses main Asquare booking records and Razorpay link workflow.',
  list: 'View and manage all bookings across locations.',
  trash: 'Bookings that have been removed.',
  checkin: 'Configure time slots and capacity.',
  ticket: 'Search for a booking and print the ticket.',
  protocol: 'Free Go-Karting entries awaiting Owner approval.',
  offers: 'Go-Karting offer entries awaiting Owner approval.',
}

const TELECALLER_HIDDEN_TABS = [
  '/bookings/protocol',
  '/bookings/ticket',
  '/bookings/trash',
  '/bookings/checkin',
]

const THIRDPARTY_ALLOWED_TABS = ['/bookings/create']

// Accountant has view-only access to bookings (segregation-of-duties:
// they reconcile finance, they don't create/edit transactions). They
// only see the All Bookings list — Create, Trash, Check-In, Protocol,
// Offers, and Ticket-print are all hidden.
const ACCOUNTANT_ALLOWED_TABS = ['/bookings/list']

const BookingsModule = ({ view = 'create' }: { view?: BookingsView }) => {
  const { session } = useAuth()
  const role = normalizeRole(session?.user.role)
  const isTelecaller = role === 'telecaller'
  const isThirdParty = role === 'thirdparty'
  const isAccountant = role === 'accountant'

  if (!session) return null

  // Telecallers cannot access Protocol, Ticket, Trash, Check-In
  if (
    isTelecaller &&
    (view === 'protocol' || view === 'ticket' || view === 'trash' || view === 'checkin')
  ) {
    return <Navigate replace to="/bookings/create" />
  }

  // ThirdParty can only create bookings
  if (isThirdParty && view !== 'create') {
    return <Navigate replace to="/bookings/create" />
  }

  // Accountant can only view the list — anything else redirects.
  if (isAccountant && view !== 'list') {
    return <Navigate replace to="/bookings/list" />
  }

  const filteredSubnav = isAccountant
    ? bookingsSubnav.filter((item) => ACCOUNTANT_ALLOWED_TABS.includes(item.to))
    : isThirdParty
      ? bookingsSubnav.filter((item) => THIRDPARTY_ALLOWED_TABS.includes(item.to))
      : isTelecaller
        ? bookingsSubnav.filter((item) => !TELECALLER_HIDDEN_TABS.includes(item.to))
        : bookingsSubnav

  return (
    <ModulePageLayout
      moduleTab="Bookings"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={['Pipeline', 'Bookings', titleMap[view]]}
      subnav={filteredSubnav}
    >
      {view === 'create' && <CreateBookingView />}
      {view === 'list' && <AllBookingsView />}
      {view === 'trash' && <TrashView />}
      {view === 'ticket' && <TicketLookupView />}
      {view === 'protocol' && <ProtocolApprovalView />}
      {view === 'offers' && <OfferApprovalView />}
      {view === 'checkin' && <CheckInConfigView />}
    </ModulePageLayout>
  )
}

export default BookingsModule
