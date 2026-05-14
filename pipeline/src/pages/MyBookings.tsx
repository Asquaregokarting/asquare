import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  Calendar,
  Clock,
  MapPin,
  Download,
  ImageIcon,
  Disc,
  Loader,
  RefreshCw,
  AlertTriangle,
  Wallet,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { formatCurrency, formatDate, formatTime, getCountdown, getLocationName } from '../lib/utils'
import type { Booking } from '../types'
import { NetworkError } from '../types/errors'
import { bookingService, type BookingsCursor } from '../services/bookingService'
import { useAuth } from '../contexts/AuthContext'
import LottieAnimation from '../components/ui/LottieAnimation'
import logo from '../assets/logo.webp'
import HelicopterIcon from '../components/icons/HelicopterIcon'
import { logger } from '../lib/logger'
import SEO from '../components/SEO'

export default function MyBookings() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming')
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Cursor-based pagination state. `nextCursor === null` means either we
  // haven't loaded yet or there is no more data; `hasMore` disambiguates.
  const [nextCursor, setNextCursor] = useState<BookingsCursor | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const ITEMS_PER_PAGE = 20

  useEffect(() => {
    fetchInitialBookings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function fetchInitialBookings() {
    if (!user) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await bookingService.getUserBookingsPage(user.id, user.phone, {
        pageLimit: ITEMS_PER_PAGE,
        cursor: null,
      })
      setBookings(res.bookings)
      setNextCursor(res.nextCursor)
      setHasMore(res.hasMore)
    } catch (err) {
      logger.error('my_bookings.load_failed', err)
      setError(
        err instanceof NetworkError
          ? 'Network connection issue. Please check your internet.'
          : 'Failed to load bookings. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  const handleLoadMore = async () => {
    if (!user || loadingMore || !hasMore) return

    setLoadingMore(true)
    try {
      const res = await bookingService.getUserBookingsPage(user.id, user.phone, {
        pageLimit: ITEMS_PER_PAGE,
        cursor: nextCursor,
      })

      if (res.bookings.length > 0) {
        setBookings((prev) => {
          // Guard against duplicates in the rare case of overlapping cursors.
          const seen = new Set(prev.map((b) => b.id))
          return [...prev, ...res.bookings.filter((b) => !seen.has(b.id))]
        })
      }
      setNextCursor(res.nextCursor)
      setHasMore(res.hasMore)
    } catch (err) {
      logger.error('my_bookings.load_more_failed', err)
      setError('Failed to load more bookings. Tap to retry.')
    } finally {
      setLoadingMore(false)
    }
  }

  // Memoized partitioning — previously rebuilt on every render (including
  // every modal open, scroll, and parent update) and constructed Date objects
  // in each filter iteration.
  const { upcomingBookings, pastBookings } = useMemo(() => {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const startOfTodayMs = startOfToday.getTime()

    const upcoming: Booking[] = []
    const past: Booking[] = []
    for (const b of bookings) {
      const sessionMs = new Date(b.sessionDate).getTime()
      if (b.bookingStatus === 'confirmed' && sessionMs >= startOfTodayMs) {
        upcoming.push(b)
      } else if (
        b.bookingStatus === 'completed' ||
        b.bookingStatus === 'cancelled' ||
        sessionMs < startOfTodayMs
      ) {
        past.push(b)
      }
    }
    return { upcomingBookings: upcoming, pastBookings: past }
  }, [bookings])

  const displayBookings = activeTab === 'upcoming' ? upcomingBookings : pastBookings

  // Set of upcoming booking ids for an O(1) lookup inside the render loop.
  const upcomingIds = useMemo(() => new Set(upcomingBookings.map((b) => b.id)), [upcomingBookings])

  if (loading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-8">
        <Loader className="w-10 h-10 text-primary-500 animate-spin mb-4" />
        <p className="text-dark-400 text-sm">Loading your bookings...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">Oops! Something went wrong</h3>
        <p className="text-dark-400 text-sm mb-6 max-w-xs">{error}</p>
        <button
          onClick={() => fetchInitialBookings()}
          className="btn-primary flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="pt-0 px-4 md:px-6 lg:px-8 safe-bottom lg:max-w-6xl xl:max-w-7xl lg:mx-auto">
      <SEO
        title="My Bookings"
        description="View and manage your go-karting bookings, check-in details, and session history at A Square GoKarting."
        path="/bookings"
        noindex
      />
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-display font-bold text-white mb-0.5">
          My Bookings
        </h1>
        <p className="text-xs md:text-sm text-dark-300">Manage your sessions</p>
      </div>

      {/* Dashboard Layout: sidebar + main on lg+ */}
      <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-8">
        {/* ===== DESKTOP SIDEBAR ===== */}
        <aside className="hidden lg:block lg:sticky lg:top-4 lg:self-start space-y-5">
          {/* Tabs as vertical nav */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-dark-400 uppercase tracking-widest mb-3 px-2">
              Filter
            </h3>
            <div role="tablist" aria-label="Booking filters" className="space-y-2">
              <button
                role="tab"
                aria-selected={activeTab === 'upcoming'}
                onClick={() => setActiveTab('upcoming')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'upcoming'
                    ? 'bg-primary-500/10 border border-primary-500/30 text-primary-400'
                    : 'text-dark-300 hover:bg-white/5 border border-transparent'
                }`}
              >
                <span>Upcoming</span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${activeTab === 'upcoming' ? 'bg-primary-500/20 text-primary-400' : 'bg-dark-800 text-dark-400'}`}
                >
                  {upcomingBookings.length}
                </span>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'past'}
                onClick={() => setActiveTab('past')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'past'
                    ? 'bg-primary-500/10 border border-primary-500/30 text-primary-400'
                    : 'text-dark-300 hover:bg-white/5 border border-transparent'
                }`}
              >
                <span>Past</span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${activeTab === 'past' ? 'bg-primary-500/20 text-primary-400' : 'bg-dark-800 text-dark-400'}`}
                >
                  {pastBookings.length}
                </span>
              </button>
            </div>
          </div>

          {/* Stats summary */}
          <div className="bg-dark-800/40 border border-white/5 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-dark-400 text-xs">Total Bookings</span>
              <span className="text-white font-bold text-sm">{bookings.length}</span>
            </div>
            {upcomingBookings.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-dark-400 text-xs">Next Session</span>
                <span className="text-primary-400 font-bold text-xs">
                  {formatDate(upcomingBookings[0]?.sessionDate)}
                </span>
              </div>
            )}
          </div>
        </aside>

        {/* ===== MAIN CONTENT ===== */}
        <div>
          {/* Mobile Tabs (hidden on desktop) */}
          <div className="flex bg-dark-800 rounded-xl p-1 mb-6 md:max-w-md lg:hidden">
            <button
              onClick={() => setActiveTab('upcoming')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'upcoming'
                  ? 'bg-primary-500 text-white shadow-glow-primary'
                  : 'text-dark-300 hover:text-white'
              }`}
            >
              Upcoming ({upcomingBookings.length})
            </button>
            <button
              onClick={() => setActiveTab('past')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'past'
                  ? 'bg-primary-500 text-white shadow-glow-primary'
                  : 'text-dark-300 hover:text-white'
              }`}
            >
              Past ({pastBookings.length})
            </button>
          </div>

          {/* Bookings List */}
          {displayBookings.length === 0 ? (
            <div className="text-center py-12 lg:py-20">
              <LottieAnimation
                src="/animations/no-bookings.json"
                className="w-32 h-32 lg:w-40 lg:h-40 mx-auto mb-4"
              />
              <p className="text-dark-400 lg:text-lg">No {activeTab} bookings</p>
              {activeTab === 'upcoming' && (
                <button onClick={() => navigate('/activities')} className="btn-primary mt-4">
                  Book Now
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:grid-cols-3">
              {displayBookings.map((booking) => {
                const countdown = getCountdown(new Date(booking.sessionDate))
                const isUpcoming = upcomingIds.has(booking.id)

                const isHelicopter = booking.items?.some(
                  (i) =>
                    (i.activity.name || '').toLowerCase().includes('helicopter') ||
                    (i.activity.category || '').toLowerCase().includes('helicopter'),
                )
                const showCheckIn =
                  isHelicopter &&
                  booking.bookingStatus === 'confirmed' &&
                  (!booking.checkInStatus || booking.checkInStatus === 'pending') &&
                  isUpcoming

                return (
                  <motion.div
                    key={booking.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card overflow-hidden p-0 cursor-pointer group"
                    onClick={() => navigate(`/bookings/${booking.id}`)}
                  >
                    {/* Status bar */}
                    <div className="px-4 py-2 border-b border-white/5 flex justify-end">
                      <span className="text-[10px] font-bold uppercase tracking-wider opacity-50 text-white">
                        #{booking.id}
                      </span>
                    </div>

                    <div className={`p-4 md:p-5 lg:p-6 ${!isUpcoming ? 'opacity-70' : ''}`}>
                      {/* Booking details */}
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <h3 className="font-display font-bold text-white flex items-center gap-2 text-base md:text-lg">
                            {booking.items?.length > 0 ? (
                              <>
                                {booking.items[0]?.activity?.icon === 'ASQUARE_LOGO' ? (
                                  <img
                                    src={logo}
                                    alt="A Square"
                                    loading="lazy"
                                    decoding="async"
                                    className="w-6 h-6 object-contain"
                                  />
                                ) : (
                                  <span className="text-lg">
                                    {booking.items[0]?.activity?.icon || '🏎️'}
                                  </span>
                                )}
                                {booking.items[0]?.activity?.name || 'Activity'}
                                {booking.items.length > 1 && (
                                  <span className="text-dark-400 text-sm">
                                    +{booking.items.length - 1}
                                  </span>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="text-lg">🏎️</span>
                                Booking
                              </>
                            )}
                          </h3>

                          <div className="mt-2 space-y-1.5 text-xs text-dark-300">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary-400" />
                              <span>{getLocationName(booking.locationId)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary-400" />
                              {formatDate(booking.sessionDate)}
                            </div>
                            <div className="flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary-400" />
                              {booking.items &&
                              booking.items.length > 0 &&
                              booking.items[0]?.timeSlot
                                ? formatTime(booking.items[0].timeSlot)
                                : 'Flexible'}
                            </div>
                          </div>

                          {/* Countdown for upcoming */}
                          {isUpcoming && (
                            <div className="mt-3 flex gap-3">
                              {[
                                { label: 'Days', value: countdown.days },
                                { label: 'Hrs', value: countdown.hours },
                                { label: 'Min', value: countdown.minutes },
                              ].map((item) => (
                                <div
                                  key={item.label}
                                  className="bg-dark-900/50 rounded-lg px-2 py-1 min-w-[36px] md:px-3 md:py-1.5 md:min-w-[44px]"
                                >
                                  <div className="text-sm md:text-base font-bold text-primary-400">
                                    {item.value}
                                  </div>
                                  <div className="text-[8px] text-dark-500 uppercase font-bold">
                                    {item.label}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* QR Code */}
                        <div className="flex flex-col items-center gap-2">
                          <div className="bg-white p-2 md:p-3 rounded-lg">
                            <QRCodeSVG value={booking.qrCode} size={64} />
                          </div>
                          <span className="text-[10px] text-dark-500">Scan at venue</span>
                        </div>
                      </div>

                      {/* Web Check-in Button */}
                      {showCheckIn && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/check-in/${booking.id}`)
                          }}
                          className="w-full mt-4 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-500 rounded-lg py-2 flex items-center justify-center gap-2 transition-colors group-hover:bg-yellow-500 group-hover:text-black font-bold text-sm"
                        >
                          <HelicopterIcon className="w-4 h-4" />
                          Web Check-in
                        </button>
                      )}

                      {/* Footer */}
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                        <div>
                          <span className="text-dark-500 text-[10px] uppercase font-bold tracking-widest">
                            Total Paid
                          </span>
                          <p className="text-white font-display font-bold text-sm">
                            {formatCurrency(booking.finalAmount)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {booking.cashbackAmount && booking.cashbackAmount > 0 ? (
                            <div className="flex items-center gap-1 text-green-400 text-xs font-bold">
                              <Wallet size={12} />+{formatCurrency(booking.cashbackAmount)} Cashback
                            </div>
                          ) : null}
                          <div className="flex items-center gap-1 text-secondary-500 text-xs font-bold">
                            +{booking.tires} Tires
                            <Disc className="w-3 h-3" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
              })}

              {hasMore && (
                <div className="pt-2 pb-6">
                  <button
                    onClick={() => {
                      if (error) setError(null)
                      handleLoadMore()
                    }}
                    disabled={loadingMore}
                    className={`w-full py-4 glass-card border-none font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${
                      error
                        ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                        : 'bg-dark-800/50 text-primary-400 hover:bg-dark-700/50'
                    }`}
                  >
                    {loadingMore ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        Loading...
                      </>
                    ) : error ? (
                      'Tap to Retry'
                    ) : (
                      'Load More Bookings'
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {/* end main content */}
      </div>
      {/* end dashboard grid */}

      {/* Booking Detail Modal - Portal to body to cover Header/BottomNav */}
      {selectedBooking &&
        createPortal(
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-dark-950 z-[9999] flex items-center justify-center p-4"
            onClick={() => setSelectedBooking(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-dark-900 border border-white/10 rounded-2xl p-6 w-full max-w-md lg:max-w-lg shadow-2xl relative"
            >
              <button
                onClick={() => setSelectedBooking(null)}
                className="absolute top-4 right-4 text-dark-400 hover:text-white"
              >
                <div className="sr-only">Close</div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>

              <h2 className="text-xl font-bold text-white mb-4">Booking Details</h2>

              {/* QR Code */}
              <div className="bg-white p-4 rounded-xl mx-auto w-fit mb-4">
                <QRCodeSVG value={selectedBooking.qrCode} size={160} />
              </div>
              <p className="text-center text-dark-400 mb-6">Show this QR code at the venue</p>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-3">
                <button className="btn-ghost flex items-center justify-center gap-2">
                  <Download className="w-4 h-4" />
                  Download
                </button>
                <button className="btn-ghost flex items-center justify-center gap-2">
                  <ImageIcon className="w-4 h-4" />
                  Photos
                </button>
              </div>

              {/* Reschedule/Cancel for upcoming */}
              {new Date(selectedBooking.sessionDate) > new Date() && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <button className="btn-primary">Reschedule</button>
                  <button className="btn-ghost text-red-400 border-red-500/30 hover:bg-red-500/10">
                    Cancel
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>,
          document.body,
        )}
    </div>
  )
}
