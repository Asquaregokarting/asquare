import { Suspense, lazy, useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import Layout from './components/Layout'
import LoadingScreen from './components/ui/LoadingScreen'
import { useAuth } from './contexts/AuthContext'
import { useBooking } from './contexts/BookingContext'
import { bookingService } from './services/bookingService'
import { normalizeLocationId } from './lib/locations'
import LocationSelectPopup from './components/LocationSelectPopup'
import GTMTracker from './components/GTMTracker'
import { useHelicopterEnabled } from './hooks/useHelicopterEnabled'

// Lazy load pages for code splitting
const HelicopterBookings = lazy(() => import('./pages/HelicopterBookings'))
const EventPage = lazy(() => import('./pages/EventPage'))
const CheckInPage = lazy(() => import('./pages/CheckInPage'))
const BoardingPassPage = lazy(() => import('./pages/BoardingPassPage'))

const Activities = lazy(() => import('./pages/Activities'))
const WaitingListDashboard = lazy(() => import('./pages/WaitingListDashboard'))
const ActivityDetails = lazy(() => import('./pages/ActivityDetails'))
const MyBookings = lazy(() => import('./pages/MyBookings'))
const BookingDetails = lazy(() => import('./pages/BookingDetails'))
const PlayAndWin = lazy(() => import('./pages/PlayAndWin'))
const SpinAndWin = lazy(() => import('./pages/SpinAndWin'))
const Wallet = lazy(() => import('./pages/Wallet'))
const Profile = lazy(() => import('./pages/Profile'))

const Cart = lazy(() => import('./pages/Cart'))
const Checkout = lazy(() => import('./pages/Checkout'))
const Help = lazy(() => import('./pages/Help'))
const HelpTicketDetail = lazy(() => import('./pages/HelpTicketDetail'))
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'))
const TermsAndConditions = lazy(() => import('./pages/TermsAndConditions'))
const ReturnRefundPolicy = lazy(() => import('./pages/ReturnRefundPolicy'))
const PrivacySecurity = lazy(() => import('./pages/PrivacySecurity'))
const LinksPage = lazy(() => import('./pages/LinksPage'))
const LeadCaptureBirthday = lazy(() => import('./pages/LeadCaptureBirthday'))
const LeadCaptureCorporate = lazy(() => import('./pages/LeadCaptureCorporate'))
const LeadCaptureSchool = lazy(() => import('./pages/LeadCaptureSchool'))
const KartfluencerPortalPage = lazy(() => import('./pipeline/pages/KartfluencerPortalPage'))
const PartnerPortalPage = lazy(() => import('./pipeline/pages/PartnerPortalPage'))
const VendorDiscrepancyReport = lazy(() => import('./pages/VendorDiscrepancyReport'))

const LOCATION_PERSIST_KEY = 'asquare_selected_location'

/**
 * When helicopter is globally disabled, the route renders nothing and
 * redirects to /activities. While the config is still loading we render
 * nothing too — a brief blank is better than flashing the page and then
 * yanking it away.
 */
function HelicopterRoute() {
  const { ready, enabled } = useHelicopterEnabled()
  if (!ready) return null
  if (!enabled) return <Navigate to="/activities" replace />
  return <HelicopterBookings />
}

function CustomerApp() {
  const { loading, user } = useAuth()
  const { setLocation } = useBooking()
  const [showLocationPopup, setShowLocationPopup] = useState(false)
  const _location = useLocation()
  void _location

  // Check if location is already selected on mount; auto-select from last booking
  useEffect(() => {
    const savedLocation = localStorage.getItem(LOCATION_PERSIST_KEY)
    if (savedLocation) return

    if (!user) {
      setShowLocationPopup(true)
      return
    }

    bookingService.getLastBookingLocation(user.id).then((locId) => {
      if (locId) {
        setLocation(normalizeLocationId(locId))
      } else {
        setShowLocationPopup(true)
      }
    })
  }, [user, setLocation])

  if (loading) {
    return <LoadingScreen />
  }

  return (
    <>
      {/* Location Selection Popup */}
      {showLocationPopup && <LocationSelectPopup onSelect={() => setShowLocationPopup(false)} />}

      <AnimatePresence mode="wait">
        <Suspense fallback={<LoadingScreen />}>
          <GTMTracker />
          <Routes>
            {/* Public routes */}
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsAndConditions />} />
            <Route path="/refund-policy" element={<ReturnRefundPolicy />} />
            <Route path="/privacy-security" element={<PrivacySecurity />} />
            <Route path="/links" element={<LinksPage />} />
            <Route path="/r/disc/:reference" element={<VendorDiscrepancyReport />} />

            {/* Protected routes - user is logged in */}
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/activities" replace />} />
              <Route path="activities" element={<Activities />} />
              <Route path="activities/:activityId" element={<ActivityDetails />} />
              <Route path="bookings" element={<MyBookings />} />
              <Route path="bookings/:bookingId" element={<BookingDetails />} />
              <Route path="play" element={<PlayAndWin />} />
              <Route path="spin-and-win" element={<SpinAndWin />} />
              <Route path="wallet" element={<Wallet />} />
              <Route path="profile" element={<Profile />} />
              <Route path="cart" element={<Cart />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="waiting-list" element={<WaitingListDashboard />} />
              <Route path="help" element={<Help />} />
              <Route path="help/tickets/:ticketId" element={<HelpTicketDetail />} />
            </Route>

            {/* Helicopter Booking - Standalone Layout */}
            <Route path="/helicopter-bookings" element={<HelicopterRoute />} />

            {/* Dynamic Event Campaign Pages */}
            <Route path="/event/:eventSlug" element={<EventPage />} />
            <Route
              path="/birthday"
              element={
                <Suspense fallback={<LoadingScreen />}>
                  <LeadCaptureBirthday />
                </Suspense>
              }
            />
            <Route
              path="/corporate"
              element={
                <Suspense fallback={<LoadingScreen />}>
                  <LeadCaptureCorporate />
                </Suspense>
              }
            />
            <Route
              path="/school-groups"
              element={
                <Suspense fallback={<LoadingScreen />}>
                  <LeadCaptureSchool />
                </Suspense>
              }
            />
            <Route path="/check-in/:bookingId" element={<CheckInPage />} />
            <Route path="/boarding-pass/:bookingId" element={<BoardingPassPage />} />

            {/* Kartfluencer Influencer Portal */}
            <Route path="/influencer-portal" element={<KartfluencerPortalPage />} />

            {/* Partner Inquiry Portal */}
            <Route path="/partner" element={<PartnerPortalPage />} />

            {/* Catch all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AnimatePresence>
    </>
  )
}

export default CustomerApp
