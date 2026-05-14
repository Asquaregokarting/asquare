import { useState, useEffect, useRef } from 'react'
import SEO from '../components/SEO'
import { motion } from 'framer-motion'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Share2,
  Clock,
  MapPin,
  Download,
  CheckCircle,
  Ticket,
  AlertTriangle,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { formatCurrency, formatDate, formatTime, getLocationName } from '../lib/utils'
import { fmtDateIST } from '../lib/date-format'
import type { Booking } from '../types'
import { bookingService } from '../services/bookingService'
import { useAuth } from '../contexts/AuthContext'
import LottieAnimation from '../components/ui/LottieAnimation'
import CustomerRaiseTicketModal from '../components/tickets/CustomerRaiseTicketModal'
import { logger } from '../lib/logger'

export default function BookingDetails() {
  const { bookingId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const ticketRef = useRef<HTMLDivElement>(null)

  const [booking, setBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [showConfetti, setShowConfetti] = useState(false)
  const [copyMsg, setCopyMsg] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)

  useEffect(() => {
    async function loadBooking() {
      if (!user || !bookingId) {
        setLoading(false)
        return
      }

      try {
        // Fetch booking details
        // Ideally we have a direct getBookingById in service, but using getUserBookings for now as per existing pattern
        const bookings = await bookingService.getUserBookings(user.id, user.phone, 1, 100)
        const found = bookings.find((b) => b.id === bookingId)
        setBooking(found || null)

        if (found && found.bookingStatus === 'confirmed') {
          setShowConfetti(true)
        }
      } catch (error) {
        logger.error('booking_details.load_failed', error)
      } finally {
        setLoading(false)
      }
    }

    loadBooking()
  }, [user, bookingId, user?.phone])

  // Print/Download Handler
  const handleDownload = () => {
    if (booking?.paymentStatus !== 'completed') {
      return
    }
    window.print()
  }

  const handleShare = async () => {
    if (!booking) return
    const shareData = {
      title: 'My Ticket - A Square Gokarting',
      text: `Here is my booking for A Square Gokarting!\nOrder: ${booking.id}\nDate: ${formatDate(booking.sessionDate)}`,
      url: window.location.href,
    }
    if (navigator.share) {
      await navigator.share(shareData)
    } else {
      navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`)
      setCopyMsg(true)
      setTimeout(() => setCopyMsg(false), 2000)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LottieAnimation src="/animations/loading-racing.json" className="w-32 h-32" />
          <p className="text-white/50 animate-pulse">Loading Ticket...</p>
        </div>
      </div>
    )
  }

  if (!booking) {
    return (
      <div className="min-h-screen bg-dark-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
          <Ticket className="w-10 h-10 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Ticket Not Found</h2>
        <p className="text-white/50 mb-8 max-w-xs mx-auto">
          We couldn't find the booking details you're looking for.
        </p>
        <button
          onClick={() => navigate('/bookings')}
          className="px-6 py-3 bg-white text-dark-950 rounded-xl font-bold hover:bg-gray-200 transition-colors"
        >
          Back to Bookings
        </button>
      </div>
    )
  }

  const locationName = getLocationName(booking.locationId)

  return (
    <div className="min-h-screen bg-dark-950 relative overflow-hidden font-sans">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary-500/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/10 blur-[100px]" />
      </div>

      {/* Navbar */}
      <div className="relative z-10 px-4 py-6 flex items-center justify-between">
        <button
          onClick={() => navigate('/bookings')}
          className="w-10 h-10 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-white">My Ticket</h1>
        <div className="w-10" /> {/* Spacer */}
      </div>

      <SEO
        title="Booking Details"
        description="View your booking details and ticket at A Square GoKarting."
        path="/bookings"
        noindex
      />

      {/* Ticket Content */}
      <div className="relative z-10 px-4 max-w-md mx-auto print:max-w-none print:px-0">
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="w-full"
          ref={ticketRef}
        >
          {/* CONFIRMED ANIMATION */}
          {showConfetti && (
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-16 z-50">
              <LottieAnimation
                src="/animations/success-check.json"
                loop={false}
                className="w-32 h-32"
              />
            </div>
          )}

          {/* TICKET CARD TOP */}
          <div className="bg-white text-dark-950 rounded-t-3xl p-6 relative shadow-2xl overflow-hidden print:shadow-none">
            {/* Abstract Pattern background */}
            <div className="absolute inset-0 opacity-5 pointer-events-none">
              <div className="absolute top-0 right-0 w-32 h-32 bg-dark-950 rounded-bl-full" />
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-dark-950 rounded-tr-full" />
            </div>

            <div className="relative z-10">
              <div className="flex justify-between items-start mb-6">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold tracking-widest uppercase opacity-40 mb-1">
                    Pass Type
                  </span>
                  <span className="text-sm font-bold bg-dark-950 text-white px-2 py-0.5 rounded inline-block self-start">
                    ADMIT ONE
                  </span>
                </div>
                <div className="text-right">
                  <h3 className="text-lg font-black tracking-tight leading-none text-primary-600">
                    A SQUARE
                  </h3>
                  <p className="text-[10px] uppercase font-bold tracking-wider opacity-50">
                    GOKARTING
                  </p>
                </div>
              </div>

              <div className="mb-0">
                <div className="text-center mb-6">
                  <span className="text-xs font-bold text-dark-400 uppercase tracking-widest">
                    Date
                  </span>
                  <h2 className="text-4xl font-black text-dark-950 tracking-tight my-1">
                    {new Date(booking.sessionDate).getDate()}
                  </h2>
                  <p className="text-sm font-bold uppercase text-dark-500">
                    {fmtDateIST(booking.sessionDate)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 bg-dark-50 rounded-xl p-4 border border-dark-100">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-dark-400">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-bold uppercase tracking-wide">Time</span>
                    </div>
                    <p className="text-sm font-bold text-dark-900">
                      {booking.items[0]?.timeSlot
                        ? formatTime(booking.items[0].timeSlot)
                        : 'Flexible'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-dark-400">
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-bold uppercase tracking-wide">Venue</span>
                    </div>
                    <p className="text-sm font-bold text-dark-900 capitalize truncate">
                      {locationName}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CUTOUT SECTION */}
          <div className="relative h-8 bg-dark-950 print:bg-white overflow-hidden">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t-2 border-dashed border-dark-950/20 bg-white h-full" />
            </div>
            {/* The Cutouts - Circles matching body bg */}
            <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-dark-950 print:bg-white" />
            <div className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-dark-950 print:bg-white" />
          </div>

          {/* TICKET CARD BOTTOM */}
          <div className="bg-white text-dark-950 rounded-b-3xl p-6 relative shadow-2xl print:shadow-none pb-8">
            <div className="flex flex-col items-center justify-center text-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="bg-white p-2 border-2 border-dark-950 rounded-xl mb-4"
              >
                <QRCodeSVG value={booking.qrCode} size={160} level="H" />
              </motion.div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-dark-400 mb-1">
                Booking Reference
              </p>
              <p className="text-lg font-mono font-bold text-dark-900 tracking-wider mb-6">
                #{booking.id}
              </p>

              {/* Items Summary */}
              <div className="w-full border-t border-dark-100 pt-4 flex flex-col gap-2">
                {booking.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 bg-dark-100 rounded flex items-center justify-center text-[10px] font-bold text-dark-600">
                        {item.quantity}
                      </span>
                      <span className="font-medium text-dark-700 truncate max-w-[150px]">
                        {item.activity?.name}
                      </span>
                    </div>
                    <span className="font-bold text-dark-900">{formatCurrency(item.price)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center text-sm pt-2 mt-2 border-t border-dashed border-dark-100">
                  <span className="font-bold text-dark-500">Total Paid</span>
                  <span className="font-bold text-lg text-primary-600">
                    {formatCurrency(booking.finalAmount)}
                  </span>
                </div>
              </div>
            </div>

            {/* Barcode Strip Effect at Bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-4 bg-[repeating-linear-gradient(90deg,transparent,transparent_2px,#000_2px,#000_4px)] opacity-5 rounded-b-3xl pointer-events-none" />
          </div>
        </motion.div>

        {/* Status Indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex justify-center mt-6"
        >
          <div
            className={`
                        flex items-center gap-2 px-4 py-2 rounded-full border backdrop-blur-md shadow-lg
                        ${
                          booking.bookingStatus === 'confirmed'
                            ? 'bg-green-500/20 border-green-500/30 text-green-400'
                            : 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
                        }
                    `}
          >
            {booking.bookingStatus === 'confirmed' ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <Clock className="w-4 h-4" />
            )}
            <span className="text-xs font-bold uppercase tracking-wider">
              {booking.bookingStatus === 'confirmed' ? 'Booking Confirmed' : 'Payment Pending'}
            </span>
          </div>
        </motion.div>

        {/* Report an issue */}
        <div className="flex justify-center mt-4 print:hidden">
          <button
            type="button"
            onClick={() => setReportModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/15 transition-colors text-xs font-bold uppercase tracking-wider"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Report an issue
          </button>
        </div>
      </div>

      <CustomerRaiseTicketModal
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        bookingId={booking.id}
        defaultBranchId={booking.locationId}
      />

      {/* Bottom Actions Floating Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-dark-950 via-dark-950 to-transparent z-20 print:hidden">
        <div className="max-w-md mx-auto grid grid-cols-2 gap-3">
          <button
            onClick={handleDownload}
            disabled={booking?.paymentStatus !== 'completed'}
            className={`flex items-center justify-center gap-2 py-3.5 rounded-xl border font-bold backdrop-blur-md transition-all active:scale-95 ${booking?.paymentStatus === 'completed' ? 'bg-dark-800/80 border-white/10 text-white hover:bg-dark-700' : 'bg-dark-800/40 border-white/5 text-white/40 cursor-not-allowed'}`}
          >
            <Download className="w-4 h-4" />
            <span>{booking?.paymentStatus === 'completed' ? 'Save PDF' : 'Payment Pending'}</span>
          </button>
          <button
            onClick={handleShare}
            className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-white text-dark-950 font-bold hover:bg-gray-100 transition-all shadow-lg active:scale-95"
          >
            <Share2 className="w-4 h-4" />
            <span>{copyMsg ? 'Copied!' : 'Share Ticket'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
