import { useState, useEffect, useMemo } from 'react'
import SEO from '../components/SEO'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, ChevronRight, ArrowLeft, Clock, Phone, Check } from 'lucide-react'
import HelicopterIcon from '../components/icons/HelicopterIcon'
import type { Booking } from '../types'
import { bookingService } from '../services/bookingService'
import { logger } from '../lib/logger'
import BoardingPass from '../components/BoardingPass'
import LoadingScreen from '../components/ui/LoadingScreen'
import Confetti from 'react-confetti'
import { FlightStatusTracker } from '../components/FlightStatusTracker'
import { FlightCertificate } from '../components/FlightCertificate'
import {
  getCheckInConfig,
  getCheckedInCounts,
  getEffectiveSlotStatus,
  getEffectiveSlotCapacity,
  type CheckInConfig,
  DEFAULT_CHECKIN_CONFIG,
} from '../lib/checkInConfig'
import { Users } from 'lucide-react'

export default function CheckInPage() {
  const { bookingId } = useParams<{ bookingId: string }>()
  const navigate = useNavigate()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentStep, setCurrentStep] = useState(0)

  // Dynamic Config
  const [config, setConfig] = useState<CheckInConfig>(DEFAULT_CHECKIN_CONFIG)

  // Passengers is a dynamic record keyed by CheckInConfig field IDs (values may be string|number)
  const [passengers, setPassengers] = useState<Array<Record<string, string | number | undefined>>>(
    [],
  )

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>('')

  // Slot count state
  const [slotCounts, setSlotCounts] = useState<Record<string, number>>({})

  const dateKey = useMemo(() => {
    if (!booking || !booking.sessionDate) return ''
    try {
      // Handle Firestore Timestamp, Date, or string
      const sd = booking.sessionDate
      const d =
        sd && typeof sd === 'object' && 'toDate' in sd
          ? (sd as { toDate: () => Date }).toDate()
          : new Date(sd as string | number | Date)
      if (isNaN(d.getTime())) return ''
      return d.toISOString().split('T')[0]
    } catch {
      return ''
    }
  }, [booking])

  const availableSlots = useMemo(() => {
    if (!booking || !booking.sessionDate || !dateKey) return []

    let timings: string[] = []

    // 1. Check Location Specific Timings
    if (booking.locationId && config.locationTimings?.[booking.locationId]?.[dateKey]) {
      timings = config.locationTimings[booking.locationId][dateKey]
    }
    // 2. Check Global Date Timings
    else if (
      config.dateTimings &&
      config.dateTimings[dateKey] &&
      config.dateTimings[dateKey].length > 0
    ) {
      timings = config.dateTimings[dateKey]
    }
    // 3. Fallback to default
    else {
      timings = config.availableTimings || []
    }

    // Filter out blocked/lunch slots (these should be hidden from users)
    return timings.filter((time) => {
      const status = getEffectiveSlotStatus(config, dateKey, time, booking.locationId || undefined)
      return status !== 'blocked' && status !== 'lunch'
    })
  }, [booking, config, dateKey])

  // Load Config first
  useEffect(() => {
    getCheckInConfig()
      .then(setConfig)
      .catch((err) => logger.error('checkin.config_load_failed', err))
  }, [])

  // Fetch check-in counts when config & booking are ready
  useEffect(() => {
    if (!dateKey || !booking) return
    getCheckedInCounts(dateKey, booking.locationId || undefined)
      .then(setSlotCounts)
      .catch((err) => logger.error('checkin.counts_load_failed', err))
  }, [dateKey, booking])

  // Auto-select first available (non-full) slot
  useEffect(() => {
    if (selectedTimeSlot || availableSlots.length === 0) return
    const firstAvailable = availableSlots.find((time) => {
      const capacity = getEffectiveSlotCapacity(
        config,
        dateKey,
        time,
        booking?.locationId || undefined,
      )
      const count = slotCounts[time] || 0
      const status = getEffectiveSlotStatus(config, dateKey, time, booking?.locationId || undefined)
      return status !== 'booked' && count < capacity
    })
    if (firstAvailable) setSelectedTimeSlot(firstAvailable)
  }, [availableSlots, slotCounts, config, dateKey, booking, selectedTimeSlot])

  // Fetch booking on mount
  useEffect(() => {
    const fetchBooking = async () => {
      if (!bookingId) return
      try {
        const data = await bookingService.getBookingById(bookingId)
        if (data) {
          setBooking(data)

          // Initialize or load existing passengers
          if (data.passengers && data.passengers.length > 0) {
            setPassengers(data.passengers)
            // If already checked in, go to pass
            if (data.checkInStatus === 'completed') {
              setCurrentStep(3)
            }
          } else {
            // Pre-fill based on item quantity
            const totalSeats = data.items.reduce((acc, item) => acc + item.quantity, 0)
            // Initialize with empty strings for all enabled fields to avoid uncontrolled input warnings
            const initialPassenger = config.fields.reduce(
              (acc, field) => ({ ...acc, [field.id]: '' }),
              {},
            )
            setPassengers(Array(totalSeats).fill(initialPassenger))

            // Set time slot if exists
            if (data.items && data.items.length > 0 && data.items[0].timeSlot) {
              setSelectedTimeSlot(data.items[0].timeSlot)
            }
          }
        } else {
          logger.warn('checkin.booking_not_found', { bookingId })
        }
      } catch (err) {
        logger.error('checkin.fetch_failed', err, { bookingId })
      } finally {
        setLoading(false)
      }
    }

    if (bookingId) {
      if (bookingId === 'TEST-MODE') {
        // Mock Booking for Testing
        logger.info('checkin.test_mode_loaded', { bookingId })
        const mockBooking = {
          id: 'TEST-MODE',
          userId: 'test-user',
          locationId: '0', // Visakhapatnam
          sessionDate: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
          bookingStatus: 'confirmed',
          paymentStatus: 'completed',
          userDisplayName: 'Test Customer',
          items: [
            {
              activity: { id: 'heli-1', name: 'Helicopter Joy Ride', category: 'Helicopter' },
              quantity: 2,
              price: 3500,
              timeSlot: '',
            },
          ],
          totalAmount: 7000,
          finalAmount: 7000,
        } as unknown as Booking
        setBooking(mockBooking)

        // Initialize passengers for mock
        const initialPassenger = config.fields.reduce(
          (acc, field) => ({ ...acc, [field.id]: '' }),
          {},
        )
        setPassengers(Array(2).fill(initialPassenger))
        setLoading(false)
        return
      }

      fetchBooking()
    }
  }, [bookingId, config]) // Re-run if config changes (though config loads fast)

  const handlePassengerChange = (index: number, fieldId: string, value: string) => {
    setPassengers((prev) => {
      const newPassengers = [...prev]
      newPassengers[index] = {
        ...newPassengers[index],
        [fieldId]: value,
      }
      return newPassengers
    })
  }

  const isStep1Valid = useMemo(() => {
    if (availableSlots.length > 0 && !selectedTimeSlot) return false

    // Ensure all required + enabled fields are filled for every passenger
    for (const p of passengers) {
      for (const field of config.fields) {
        if (field.enabled && field.required) {
          const val = p[field.id]
          if (val === undefined || val === null || String(val).trim() === '') {
            return false
          }
        }
      }
    }
    return true
  }, [availableSlots.length, selectedTimeSlot, passengers, config.fields])

  const [isTermsAccepted, setIsTermsAccepted] = useState(false)

  const handleCompleteCheckIn = async () => {
    if (!bookingId || !booking || !isTermsAccepted) return
    setIsSubmitting(true)
    try {
      // Cast through unknown: this booking write includes fields that
      // are not in the typed Booking shape (`updatedAt`) and the
      // `passengers` shape comes from the dynamic check-in config.
      // Preserves the prior runtime behavior of the page.
      const updates = {
        passengers,
        checkInStatus: 'completed',
        updatedAt: new Date(),
        ...(selectedTimeSlot
          ? {
              items: booking.items.map((item) => ({ ...item, timeSlot: selectedTimeSlot })),
            }
          : {}),
      } as unknown as Partial<Booking>
      const ok = await bookingService.updateBooking(bookingId, booking.userId || '', updates)
      if (!ok) throw new Error('updateBooking returned false')

      setShowConfetti(true)
      setTimeout(() => setShowConfetti(false), 5000)
      setCurrentStep(3)
    } catch (err) {
      logger.error('checkin.submit_failed', err, { bookingId })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (loading) return <LoadingScreen />
  if (!booking)
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        Booking not found
      </div>
    )

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans overflow-hidden relative">
      {showConfetti && <Confetti numberOfPieces={200} recycle={false} />}
      <SEO
        title="Check In"
        description="Check in for your go-karting session at A Square GoKarting."
        path="/check-in"
        noindex
      />

      {/* Background Ambience */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1517400508447-f8dd518b86db?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center opacity-20 filter blur-sm scale-110" />
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-transparent" />
      </div>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 p-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-widest">
            Flight H-{booking.id.slice(-3)}
          </span>
          <span className="text-xs text-white/60 font-medium">Web Check-In</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 min-h-screen pt-24 pb-20 px-6 flex flex-col">
        <AnimatePresence mode="wait">
          {/* STEP 0: WELCOME */}
          {currentStep === 0 && (
            <motion.div
              key="step0"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col justify-center items-center text-center space-y-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', delay: 0.2 }}
                className="w-24 h-24 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center relative"
              >
                <div className="absolute inset-0 rounded-full border border-yellow-500/30 animate-ping" />
                <HelicopterIcon className="w-10 h-10 text-yellow-400" />
              </motion.div>

              <div>
                <motion.h1
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="text-4xl font-light text-white mb-2"
                >
                  Welcome,{' '}
                  <span className="text-yellow-400 font-bold block mt-1">
                    {booking.userDisplayName?.split(' ')[0] || 'Guest'}
                  </span>
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                  className="text-neutral-400 max-w-xs mx-auto"
                >
                  Your premium helicopter experience awaits. Let's get you ready for boarding.
                </motion.p>
              </div>

              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 }}
                onClick={() => setCurrentStep(1)}
                className="w-full max-w-xs bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-4 rounded-xl shadow-[0_0_20px_rgba(234,179,8,0.3)] transition-all transform hover:scale-105 flex items-center justify-center gap-2"
              >
                <span>Begin Check-In</span>
                <ChevronRight className="w-4 h-4" />
              </motion.button>
            </motion.div>
          )}

          {/* STEP 1: MANIFEST */}
          {currentStep === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 max-w-lg mx-auto w-full"
            >
              <>
                {availableSlots.length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                      <Clock className="w-5 h-5 text-yellow-500" />
                      Select Flight Time
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {availableSlots.map((time) => {
                        const capacity = getEffectiveSlotCapacity(
                          config,
                          dateKey,
                          time,
                          booking?.locationId || undefined,
                        )
                        const count = slotCounts[time] || 0
                        const isFull = count >= capacity
                        const status = getEffectiveSlotStatus(
                          config,
                          dateKey,
                          time,
                          booking?.locationId || undefined,
                        )
                        const isBooked = status === 'booked'
                        const isFastFilling = status === 'fast-filling'
                        const remaining = Math.max(0, capacity - count)
                        const disabled = isFull || isBooked

                        return (
                          <button
                            key={time}
                            onClick={() => !disabled && setSelectedTimeSlot(time)}
                            disabled={disabled}
                            className={`relative px-4 py-3 rounded-xl border font-medium transition-all ${
                              disabled
                                ? 'bg-neutral-900/30 border-white/5 text-neutral-600 cursor-not-allowed'
                                : selectedTimeSlot === time
                                  ? 'bg-yellow-500 text-black border-yellow-500 shadow-lg shadow-yellow-500/20'
                                  : 'bg-neutral-900/50 border-white/10 text-neutral-400 hover:border-yellow-500/50 hover:text-white'
                            }`}
                          >
                            <span className="block">{time}</span>
                            <span className="text-[10px] mt-1 opacity-70 flex items-center justify-center gap-1">
                              <Users className="w-3 h-3" />
                              {disabled ? 'FULL' : `${remaining} left`}
                            </span>
                            {isFastFilling && !disabled && (
                              <span className="absolute -top-1.5 -right-1.5 text-[8px] bg-blue-500 text-white px-1.5 py-0.5 rounded-full font-bold animate-pulse">
                                ⚡ Fast
                              </span>
                            )}
                            {(isFull || isBooked) && (
                              <span className="absolute -top-1.5 -right-1.5 text-[8px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                                FULL
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                    {!selectedTimeSlot && (
                      <p className="text-red-400 text-xs mt-2">* Please select a flight time.</p>
                    )}
                    {availableSlots.every((time) => {
                      const cap = getEffectiveSlotCapacity(
                        config,
                        dateKey,
                        time,
                        booking?.locationId || undefined,
                      )
                      return (
                        (slotCounts[time] || 0) >= cap ||
                        getEffectiveSlotStatus(
                          config,
                          dateKey,
                          time,
                          booking?.locationId || undefined,
                        ) === 'booked'
                      )
                    }) && (
                      <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
                        <p className="text-red-400 text-sm">
                          All flight slots are full for this date. Please contact support.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-6">
                  {passengers.map((passenger, idx) => (
                    <div
                      key={idx}
                      className="bg-neutral-900/50 border border-white/10 rounded-xl p-4"
                    >
                      <h4 className="text-yellow-500 font-bold mb-4 text-sm flex items-center justify-between">
                        <span>Passenger {idx + 1}</span>
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {config.fields
                          .filter((f) => f.enabled)
                          .map((field) => (
                            <div
                              key={field.id}
                              className={field.type === 'email' ? 'sm:col-span-2' : ''}
                            >
                              <label className="block text-xs font-medium text-neutral-400 mb-1">
                                {field.label}{' '}
                                {field.required && <span className="text-red-500">*</span>}
                              </label>
                              {field.type === 'select' ? (
                                <select
                                  value={passenger[field.id] || ''}
                                  onChange={(e) =>
                                    handlePassengerChange(idx, field.id, e.target.value)
                                  }
                                  required={field.required}
                                  className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-yellow-500 text-sm transition-colors"
                                >
                                  <option value="" disabled>
                                    Select {field.label}
                                  </option>
                                  {field.options?.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              ) : field.type === 'checkbox' ? (
                                <label className="flex items-center gap-2 cursor-pointer mt-2">
                                  <input
                                    type="checkbox"
                                    checked={!!passenger[field.id]}
                                    onChange={(e) =>
                                      handlePassengerChange(
                                        idx,
                                        field.id,
                                        e.target.checked ? 'true' : 'false',
                                      )
                                    }
                                    className="w-4 h-4 accent-yellow-500"
                                  />
                                  <span className="text-sm text-neutral-300">{field.label}</span>
                                </label>
                              ) : (
                                <input
                                  type={field.type}
                                  value={passenger[field.id] || ''}
                                  onChange={(e) =>
                                    handlePassengerChange(idx, field.id, e.target.value)
                                  }
                                  placeholder={field.placeholder}
                                  required={field.required}
                                  min={
                                    field.type === 'number' && field.id === 'weight'
                                      ? '0'
                                      : undefined
                                  }
                                  step={
                                    field.type === 'number' && field.id === 'weight'
                                      ? '0.1'
                                      : undefined
                                  }
                                  className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/20 focus:outline-none focus:border-yellow-500 text-sm transition-colors"
                                />
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => setCurrentStep(2)}
                  disabled={!isStep1Valid}
                  className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-400 hover:to-yellow-500 text-black font-bold py-4 rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 mt-8"
                >
                  <span>Continue to Safety Briefing</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            </motion.div>
          )}

          {/* STEP 2: SAFETY */}
          {currentStep === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 max-w-lg mx-auto w-full flex flex-col"
            >
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <ShieldCheck className="w-6 h-6 text-green-400" />
                Safety Briefing
              </h2>

              <div className="flex-1 space-y-4 mb-8 overflow-y-auto pr-2 custom-scrollbar">
                {[
                  {
                    icon: '🚫',
                    title: 'No Loose Items',
                    desc: 'Hats, scarves, and loose items must be secured.',
                  },
                  {
                    icon: '⚖️',
                    title: 'Weight Distribution',
                    desc: 'Seating is assigned by pilot for weight balance.',
                  },
                  {
                    icon: '🚁',
                    title: 'Approach Carefully',
                    desc: 'Never approach from the rear. Wait for crew signal.',
                  },
                  {
                    icon: '📱',
                    title: 'Devices',
                    desc: 'Phones must be in flight mode. Photography allowed.',
                  },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="bg-neutral-900/50 border border-white/5 p-4 rounded-xl flex gap-4 items-start"
                  >
                    <div className="text-2xl pt-1">{item.icon}</div>
                    <div>
                      <h3 className="font-bold text-white text-sm mb-1">{item.title}</h3>
                      <p className="text-xs text-neutral-400 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}

                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl mt-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 w-4 h-4 accent-yellow-500"
                      checked={isTermsAccepted}
                      onChange={(e) => setIsTermsAccepted(e.target.checked)}
                    />
                    <span className="text-xs text-yellow-500/90 leading-relaxed">
                      I confirm that all passengers are fit to fly and understand the safety
                      protocols. I declare the information provided is accurate.
                    </span>
                  </label>
                </div>
              </div>

              <button
                onClick={handleCompleteCheckIn}
                disabled={isSubmitting || !isTermsAccepted}
                className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-4 rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <span className="animate-spin w-5 h-5 border-2 border-black/30 border-t-black rounded-full" />
                ) : (
                  <>
                    <span>Sign & Generate Pass</span>
                    <Check className="w-4 h-4" />
                  </>
                )}
              </button>
            </motion.div>
          )}

          {/* STEP 3: BOARDING PASS / DASHBOARD */}
          {currentStep === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex-1 w-full flex flex-col items-center justify-start pt-4 pb-12"
            >
              <FlightStatusTracker booking={booking} />

              <div className="text-center mb-6 mt-4">
                <h2 className="text-xl font-light text-white">
                  <span className="text-green-400 font-bold block mb-1">Boarding Pass</span>
                </h2>
                <p className="text-xs text-neutral-400">Keep this screen open or save to wallet</p>
              </div>

              {/* Combined Single Pass */}
              <div className="w-full max-w-sm space-y-8 mb-12">
                <div className="relative">
                  <BoardingPass
                    booking={booking}
                    passengerName={
                      passengers.length > 0
                        ? passengers.map((p) => p.name || 'Passenger').join(', ')
                        : booking.userDisplayName || 'Guest'
                    }
                  />
                </div>
              </div>

              {/* Certificate Section - Shows only if Landed (simulated by >15 mins past start) */}
              {new Date().getTime() - new Date(booking.sessionDate).getTime() > 15 * 60000 && (
                <motion.div
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1 }}
                  className="w-full max-w-2xl border-t border-white/10 pt-12 mt-4"
                >
                  <div className="text-center mb-8">
                    <h2 className="text-2xl font-serif text-yellow-500 mb-2">Captain's Club</h2>
                    <p className="text-neutral-400 text-sm">
                      Your flight is complete. Here is your official record.
                    </p>
                  </div>

                  {passengers.map((p, idx) => (
                    <div key={idx} className="mb-8">
                      <FlightCertificate
                        booking={booking}
                        passengerName={String(p.name || 'Passenger')}
                      />
                    </div>
                  ))}
                </motion.div>
              )}

              {/* Reschedule Option */}
              <div className="w-full max-w-sm mt-6">
                <div className="bg-neutral-900/50 backdrop-blur-md border border-white/10 rounded-2xl p-5 text-center">
                  <p className="text-sm text-neutral-400 mb-3">Need to reschedule your flight?</p>
                  <a
                    href="tel:+918499888872"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 rounded-xl text-sm font-bold transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    Contact Admin
                  </a>
                </div>
              </div>

              <button
                onClick={() => navigate('/bookings')}
                className="mt-8 text-neutral-500 text-sm hover:text-white transition-colors"
              >
                Return to Bookings
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
