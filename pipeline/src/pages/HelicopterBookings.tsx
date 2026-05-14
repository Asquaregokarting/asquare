import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, CalendarDays, MapPin, ShieldCheck, Clock, Flame, Bell } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useBooking } from '../contexts/BookingContext'
import { useCart } from '../contexts/CartContext'
import { getGames } from '../services/activityService'
import {
  getHelicopterPricing,
  REGULAR_PRICE,
  getHelicopterDailyCounts,
} from '../services/helicopterEarlyBird'
import LottieAnimation from '../components/ui/LottieAnimation'
import type { Activity } from '../types'
import NotifyModal from '../components/NotifyModal'
import SEO from '../components/SEO'
import { logger } from '../lib/logger'

const BOARDING_STEPS = [
  { title: 'Check-in', detail: 'Arrive 20 minutes before slot time.' },
  { title: 'Safety Brief', detail: 'Crew briefing and seat assignment.' },
  { title: 'Takeoff', detail: 'Scenic ride with guided route.' },
]

const SUPPORT_PHONE = '+91 8499888872'
const SUPPORT_EMAIL = 'dev.asquaregokarting@gmail.com'
const HERO_VIDEO_MP4 = '/helicopter-banner.mp4'
const HERO_VIDEO_WEBM = '/helicopter-banner.webm'
const HERO_PLACEHOLDER_SRC = '/helicopter-banner-placeholder.jpg'
const HERO_REVEAL_DELAY_MS = 1000
const HERO_FADE_DURATION_MS = 1400

interface HelicopterService {
  title: string
  features: string[]
  price: string
  icon: LucideIcon
}

const HELICOPTER_SERVICES: HelicopterService[] = [
  {
    title: 'Aerial Sightseeing & Themed Flights',
    features: [
      'City sightseeing tours',
      'Beach/river circuits',
      'Sunrise & sunset flights',
      'Night city tours',
    ],
    price: '₹4,000–12,000 per person',
    icon: MapPin,
  },
  {
    title: 'Proposal, Anniversary & Celebration',
    features: ['Sky proposals', 'Birthday/anniversary surprise', 'Cake, flowers, photo & video'],
    price: '₹25,000–1,00,000 per event',
    icon: Flame,
  },
  {
    title: 'Aerial Photography & Videography',
    features: ['Real estate shoots', 'Resort promotions', 'Infrastructure filming'],
    price: '₹30,000–2,00,000 per project',
    icon: CalendarDays,
  },
  {
    title: 'Corporate & Infrastructure Inspections',
    features: ['Power lines', 'Pipeline & road survey', 'Construction monitoring'],
    price: '₹1.5–3 lakhs/day',
    icon: ShieldCheck,
  },
  {
    title: 'Medical & Emergency Charter',
    features: ['Hospital tie-ups', 'Insurance transfers'],
    price: '₹1–5 lakhs/mission',
    icon: ShieldCheck,
  },
  {
    title: 'Film, TV & OTT Shoots',
    features: ['Helicopter as prop', 'Aerial camera platform'],
    price: '₹2–10 lakhs/day',
    icon: CalendarDays,
  },
  {
    title: 'Destination Transfers & Luxury Pickups',
    features: ['Airport to resort', 'City to beach/temple'],
    price: '₹40,000–2,00,000/trip',
    icon: MapPin,
  },
  {
    title: 'Corporate Team-Building Flights',
    features: ['Bulk bookings', 'Experience incentives'],
    price: '₹3,000–6,000/person',
    icon: ShieldCheck,
  },
  {
    title: 'Brand Activations & Sky Advertising',
    features: ['Banner ads', 'Helicopter branding', 'Event flypast'],
    price: '₹50,000–3 lakhs/campaign',
    icon: Flame,
  },
]

export default function HelicopterBookings() {
  const navigate = useNavigate()
  const { selectedLocation, locations } = useBooking()
  const { setCartDate, addItem } = useCart()

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [selectedSeats, setSelectedSeats] = useState<number>(1)
  const [availableDateObjects, setAvailableDateObjects] = useState<Date[]>([])
  const [dailyCounts, setDailyCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [packageActivity, setPackageActivity] = useState<Activity | null>(null)
  const [isHeroGifReady, setIsHeroGifReady] = useState(false)
  const [isHeroGifVisible, setIsHeroGifVisible] = useState(false)
  const [isHeroCrossfadeActive, setIsHeroCrossfadeActive] = useState(false)
  const [isNotifyModalOpen, setIsNotifyModalOpen] = useState(false)

  // Check availability state
  // const [availableLocationIds, setAvailableLocationIds] = useState<string[]>([])
  // const [checkingAvailability, setCheckingAvailability] = useState(true)

  // Early bird pricing state
  const [earlyBirdRemaining, setEarlyBirdRemaining] = useState(0)
  const [isEarlyBird, setIsEarlyBird] = useState(false)
  const [currentPrice, setCurrentPrice] = useState(REGULAR_PRICE)
  const [pricingLoaded, setPricingLoaded] = useState(false)

  const MAX_SEATS = 6 // Helicopter capacity per trip

  // Video is ready immediately — no preloading needed like the old GIF.
  useEffect(() => {
    setIsHeroGifReady(true)
  }, [])

  useEffect(() => {
    if (!isHeroGifReady) return
    const revealTimer = window.setTimeout(() => {
      setIsHeroGifVisible(true)
    }, HERO_REVEAL_DELAY_MS)

    return () => {
      window.clearTimeout(revealTimer)
    }
  }, [isHeroGifReady])

  useEffect(() => {
    if (!isHeroGifVisible) return
    const raf = window.requestAnimationFrame(() => {
      setIsHeroCrossfadeActive(true)
    })

    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [isHeroGifVisible])

  // Fetch early bird pricing on mount
  useEffect(() => {
    getHelicopterPricing().then((pricing) => {
      setCurrentPrice(pricing.currentPrice)
      setIsEarlyBird(pricing.isEarlyBird)
      setEarlyBirdRemaining(pricing.earlyBirdRemaining)
      setPricingLoaded(true)
    })
  }, [])

  // Fetch booking counts when dates are available
  useEffect(() => {
    if (availableDateObjects.length > 0) {
      getHelicopterDailyCounts(availableDateObjects).then(setDailyCounts)
    }
  }, [availableDateObjects])

  // Helper to format date for display
  const formatDate = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const localISO = `${year}-${month}-${day}`

    return {
      dayName: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' }), // Mon
      dayNumber: date.getDate(), // 16
      month: date.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Kolkata' }), // Feb
      full: localISO,
    }
  }

  // Fetch activity and determine available dates
  useEffect(() => {
    const fetchDetails = async () => {
      if (!selectedLocation) {
        setPackageActivity(null)
        setAvailableDateObjects([])
        return
      }

      setLoading(true)
      try {
        const games = await getGames(selectedLocation, 'all')

        // Find Helicopter Activity - prioritizing "Joy Rides" or generic "Helicopter"
        const activity =
          games.find(
            (g) =>
              (g.name || '').toLowerCase().includes('helicopter') &&
              (g.name || '').toLowerCase().includes('joy rides'),
          ) ||
          games.find(
            (g) =>
              g.category === 'Helicopter' || (g.name || '').toLowerCase().includes('helicopter'),
          )

        setPackageActivity(activity || null)

        if (activity) {
          const generatedDates: Date[] = []
          const today = new Date()
          today.setHours(0, 0, 0, 0)

          // 1. Check specific availableDates array
          if (activity.availableDates && activity.availableDates.length > 0) {
            activity.availableDates.forEach((dateStr) => {
              const d = new Date(dateStr)
              d.setHours(0, 0, 0, 0)
              if (d >= today) {
                generatedDates.push(d)
              }
            })
          }
          // 2. Check schedule range
          else if (activity.schedule && activity.schedule.length > 0) {
            activity.schedule.forEach((sched) => {
              if (sched.locationId === selectedLocation) {
                const start = new Date(sched.startDate)
                const end = new Date(sched.endDate)

                // Loop from start to end (clamped to today if start is past)
                const current = start < today ? new Date(today) : new Date(start)

                while (current <= end) {
                  generatedDates.push(new Date(current))
                  current.setDate(current.getDate() + 1)
                }
              }
            })
          }
          // 3. Fallback: If no dates specified, assume available for next 7 days
          else {
            for (let i = 0; i < 7; i++) {
              const d = new Date(today)
              d.setDate(today.getDate() + i)
              generatedDates.push(d)
            }
          }

          // Sort dates
          generatedDates.sort((a, b) => a.getTime() - b.getTime())

          // Remove duplicates
          const uniqueDates: Date[] = []
          const seen = new Set<string>()
          generatedDates.forEach((d) => {
            const str = formatDate(d).full
            if (!seen.has(str)) {
              seen.add(str)
              uniqueDates.push(d)
            }
          })

          setAvailableDateObjects(uniqueDates)

          // Auto-select first date if available
          if (uniqueDates.length > 0) {
            setSelectedDate(uniqueDates[0])
          } else {
            setSelectedDate(undefined)
          }
        } else {
          // No activity found
          setAvailableDateObjects([])
        }
      } catch (err) {
        logger.error('helicopter.fetch_details_failed', err)
      } finally {
        setLoading(false)
      }
    }

    fetchDetails()
  }, [selectedLocation])

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/activities', { replace: true })
  }

  const handleProceed = async () => {
    if (!selectedLocation || !selectedDate || !packageActivity) return

    setIsProcessing(true)
    try {
      // Format date as YYYY-MM-DD using local timezone (not UTC)
      const dateStr = formatDate(selectedDate).full

      // Override basePrice with early bird or regular price
      const activityToAdd = {
        ...packageActivity,
        name: 'Helicopter Joy Rides',
        basePrice: currentPrice,
      }
      addItem(activityToAdd, selectedSeats)
      setCartDate(dateStr)
      navigate('/cart')
    } catch (e) {
      logger.error('helicopter.add_to_cart_failed', e)
      navigate('/activities?category=helicopter')
    } finally {
      setIsProcessing(false)
    }
  }

  // Check availability for all locations
  /*
  useEffect(() => {
    let isMounted = true
    const checkAvailability = async () => {
      setCheckingAvailability(true)
      const availableIds: string[] = []

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      // Parallel fetch for all locations
      await Promise.all(locations.map(async (loc) => {
        try {
          const games = await getGames(loc.id, 'all')

          // Find Helicopter Activity matches
          const activity = games.find(g =>
            (g.name || '').toLowerCase().includes('helicopter') &&
            (g.name || '').toLowerCase().includes('joy rides')
          ) || games.find(g =>
            (g.category === 'Helicopter' || (g.name || '').toLowerCase().includes('helicopter'))
          )

          if (activity) {
            // Check for ANY valid dates
            let hasDates = false

            // 1. Check specific availableDates array
            if (activity.availableDates && activity.availableDates.length > 0) {
              const validDates = activity.availableDates.filter(dateStr => {
                const d = new Date(dateStr)
                d.setHours(0, 0, 0, 0)
                return d >= today
              })
              if (validDates.length > 0) hasDates = true
            }
            // 2. Check schedule range
            else if (activity.schedule && activity.schedule.length > 0) {
              activity.schedule.forEach(sched => {
                if (sched.locationId === loc.id) {
                  const end = new Date(sched.endDate)
                  if (end >= today) hasDates = true
                }
              })
            }
            // 3. Fallback: Assume available if not restricted
            else {
              hasDates = true
            }

            if (hasDates) {
              if (isMounted) availableIds.push(loc.id)
            }
          }
        } catch (e) {
          // ignore error
        }
      }))

      if (isMounted) {
        setAvailableLocationIds(availableIds)
        setCheckingAvailability(false)
      }
    }

    if (locations.length > 0) {
      checkAvailability()
    }

    return () => {
      isMounted = false
    }
  }, [locations])
  */

  return (
    <div className="min-h-screen bg-dark-950 text-white font-sans">
      <SEO
        title="Helicopter Rides & Aerial Experiences"
        description="Book scenic helicopter rides at A Square GoKarting. Aerial sightseeing, themed flights, VIP transfers, and sky advertising across Andhra Pradesh."
        path="/helicopter-bookings"
      />

      {/* Fixed Hero Banner - Stays in place while content scrolls over */}
      <div className="fixed top-0 left-0 right-0 h-[60vh] md:h-[50vh] lg:h-[55vh] min-h-[350px] z-0">
        <img
          src={HERO_PLACEHOLDER_SRC}
          alt=""
          aria-hidden
          loading="eager"
          decoding="async"
          fetchPriority="high"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity ease-out ${
            isHeroCrossfadeActive ? 'opacity-0' : 'opacity-100'
          }`}
          style={{ transitionDuration: `${HERO_FADE_DURATION_MS}ms` }}
        />
        {isHeroGifVisible && (
          <video
            autoPlay
            muted
            loop
            playsInline
            poster={HERO_PLACEHOLDER_SRC}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity ease-out ${
              isHeroCrossfadeActive ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ transitionDuration: `${HERO_FADE_DURATION_MS}ms` }}
            onCanPlay={() => {
              setIsHeroCrossfadeActive(true)
            }}
          >
            <source src={HERO_VIDEO_WEBM} type="video/webm" />
            <source src={HERO_VIDEO_MP4} type="video/mp4" />
          </video>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-dark-950/40 via-transparent to-dark-950" />
      </div>

      {/* Back Button - Sticky at top */}
      <div className="fixed top-0 left-0 right-0 z-50 p-4 safe-top">
        <motion.button
          onClick={handleBack}
          className="h-10 px-4 rounded-full bg-dark-950/50 backdrop-blur-md border border-white/20 flex items-center gap-2 shadow-lg hover:bg-dark-950/70 transition-colors"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Back</span>
        </motion.button>
      </div>

      {/* Spacer to push content below the fixed banner */}
      <div className="h-[50vh] md:h-[40vh] lg:h-[45vh] min-h-[300px]" />

      {/* Content - Scrolls over the banner */}
      <div
        className="relative z-10 -mt-10 px-4 md:px-6 lg:px-8 pb-32 max-w-lg md:max-w-2xl lg:max-w-5xl xl:max-w-6xl mx-auto bg-dark-950"
        style={{ backgroundImage: 'linear-gradient(to bottom, rgba(3,7,18,0) 0px, #030712 50px)' }}
      >
        {/* Desktop 2-column layout: info+booking left, details right */}
        <div className="lg:grid lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] lg:gap-8 lg:items-start">
          {/* ===== LEFT COLUMN ===== */}
          <div>
            {/* Info Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl lg:rounded-3xl bg-dark-900/90 border border-white/10 p-5 md:p-6 lg:p-8 backdrop-blur-xl shadow-2xl mb-8"
            >
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-500/20 border border-primary-500/30 mb-3">
                <ShieldCheck className="w-3 h-3 text-primary-300" />
                <span className="text-[10px] font-bold tracking-wide text-primary-100 uppercase">
                  Premium Experience
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white leading-tight">
                Helicopter Ride
              </h1>
              <p className="text-sm text-white/60 mt-1">
                Experience the city from the skies with our exclusive joy rides. This ride is for 7
                min covering major parts of the city.
              </p>

              {/* Pricing & Early Bird Badge */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-white">
                    ₹{currentPrice.toLocaleString('en-IN')}
                  </span>
                  {isEarlyBird && (
                    <span className="text-sm text-white/40 line-through">
                      ₹{REGULAR_PRICE.toLocaleString('en-IN')}
                    </span>
                  )}
                  <span className="text-xs text-white/50">per seat</span>
                </div>
                {pricingLoaded && isEarlyBird && (
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/30"
                  >
                    <Flame className="w-3.5 h-3.5 text-orange-400" />
                    <span className="text-xs font-bold text-orange-300">
                      {earlyBirdRemaining} Early Bird{' '}
                      {earlyBirdRemaining === 1 ? 'ticket' : 'tickets'} left!
                    </span>
                  </motion.div>
                )}
              </div>

              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-dark-800/60 border border-white/10">
                <Clock className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-xs font-semibold text-white/90">9:30 AM - 5:00 PM</span>
              </div>
            </motion.div>

            {/* Location Selection */}
            {/*
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8"
        >
          <div className="flex items-center gap-2 mb-4 px-1">
            <MapPin className="w-4 h-4 text-primary-400" />
            <span className="text-sm font-bold tracking-wide uppercase text-white/80">Select Location</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {checkingAvailability ? (
              <div className="flex gap-2">
                {[1, 2, 3].map(i => <div key={i} className="h-8 w-24 bg-white/5 animate-pulse rounded-lg" />)}
              </div>
            ) : (
              (() => {
                const displayLocations = [...locations]
                // Force add Visakhapatnam if not present (lookup from location registry)
                const vizagLoc = getLocationBySlug("visakhapatnam");
                if (vizagLoc && !displayLocations.find(l => l.id === vizagLoc.slug || l.name.toLowerCase().includes(vizagLoc.displayName.toLowerCase()))) {
                  displayLocations.push({
                    id: vizagLoc.slug,
                    name: vizagLoc.displayName,
                    address: 'Coming Soon',
                    coordinates: { lat: 17.6868, lng: 83.2185 },
                    image: '',
                    isOpen: true,
                    openingHours: { weekday: '9:00 - 18:00', weekend: '9:00 - 18:00' }
                  })
                }

                return displayLocations
                  .filter(loc => availableLocationIds.includes(loc.id) || loc.id === 'visakhapatnam' || loc.name.toLowerCase().includes('visakhapatnam'))
                  .sort((a, b) => {
                    const order: Record<string, number> = { kakinada: 0, rajahmundry: 1, visakhapatnam: 2 }
                    const aIdx = order[a.name.toLowerCase()] ?? 99
                    const bIdx = order[b.name.toLowerCase()] ?? 99
                    return aIdx - bIdx
                  })
                  .map((loc) => {
                    const isActive = selectedLocation === loc.id;
                    return (
                      <button
                        key={loc.id}
                        onClick={() => setLocation(loc.id)}
                        className={`
                      relative px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-300
                      ${isActive
                            ? 'bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/25 scale-105'
                            : 'bg-dark-800/50 border border-white/10 text-white/60 hover:bg-dark-800 hover:border-white/20'
                          }
                    `}
                      >
                        {loc.name}
                      </button>
                    )
                  })
              })()
            )}
          </div>
        </motion.div>
        */}

            {/* Date Selection */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-8"
            >
              <div className="mb-4 px-1 text-center">
                <span className="text-sm font-bold tracking-[0.18em] uppercase text-cyan-300">
                  Event Details
                </span>
              </div>

              {!selectedLocation ? (
                <div className="p-6 rounded-2xl border border-dashed border-white/10 bg-white/5 text-center">
                  <p className="text-sm text-white/40">Please select a location first</p>
                </div>
              ) : loading ? (
                <div className="flex gap-3 overflow-hidden">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="w-16 h-20 rounded-2xl bg-white/5 animate-pulse shrink-0"
                    />
                  ))}
                </div>
              ) : availableDateObjects.length === 0 ? (
                <div className="p-6 rounded-2xl border border-white/10 bg-dark-800/50 text-center">
                  <p
                    className="text-2xl sm:text-3xl font-black leading-tight text-cyan-200 mb-4"
                    style={{
                      textShadow: '0',
                    }}
                  >
                    Thank you all for your love and support towards our Helicopter Joy Rides event.
                  </p>
                  <button
                    onClick={() => setIsNotifyModalOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm font-bold transition-colors"
                  >
                    <Bell size={16} />
                    Notify Me When Available
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableDateObjects.map((date) => {
                    const { dayName, dayNumber, month, full: dateStr } = formatDate(date)
                    const isSelected = selectedDate?.getTime() === date.getTime()
                    const overrideStatus = packageActivity?.dateStatuses?.[dateStr]
                    const isBookedFull = overrideStatus === 'booked_full'
                    const isFastFilling =
                      overrideStatus === 'fast_filling' ||
                      (!overrideStatus && dailyCounts[dateStr] > 10)

                    return (
                      <motion.button
                        key={date.toISOString()}
                        onClick={() => {
                          if (!isBookedFull) setSelectedDate(isSelected ? undefined : date)
                        }}
                        whileTap={!isBookedFull ? { scale: 0.95 } : undefined}
                        className={`
                        relative w-14 h-16 rounded-xl flex flex-col items-center justify-center gap-0 border transition-all duration-300
                        ${
                          isBookedFull
                            ? 'opacity-60 cursor-not-allowed bg-dark-800/30 border-white/5 text-white/30'
                            : isSelected
                              ? 'bg-white text-dark-950 border-white shadow-lg shadow-white/10 scale-105 z-10'
                              : 'bg-dark-800/40 border-white/10 text-white/60 hover:bg-dark-800 hover:border-white/20'
                        }
                      `}
                      >
                        <span
                          className={`text-[8px] font-medium uppercase tracking-wide ${isSelected && !isBookedFull ? 'text-primary-600' : 'text-white/40'}`}
                        >
                          {month}
                        </span>
                        <span
                          className={`text-lg font-bold leading-tight ${isSelected && !isBookedFull ? 'text-dark-950' : isBookedFull ? 'text-white/40' : 'text-white'}`}
                        >
                          {dayNumber}
                        </span>
                        <span
                          className={`text-[8px] font-medium ${isSelected && !isBookedFull ? 'text-dark-600' : 'text-white/40'}`}
                        >
                          {dayName}
                        </span>

                        {/* Booked Full Badge */}
                        {isBookedFull && (
                          <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-gray-500/90 text-white text-[7px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap backdrop-blur-sm border border-white/10 shadow-sm z-30">
                            SOLD OUT
                          </div>
                        )}

                        {/* Fast Filling Badge */}
                        {!isBookedFull && isFastFilling && (
                          <>
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="absolute -top-2 -right-2 z-20"
                            >
                              <div className="relative flex items-center justify-center">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-5 w-5 bg-red-500 items-center justify-center border border-white/20 shadow-lg">
                                  <Flame size={10} className="text-white fill-white" />
                                </span>
                              </div>
                            </motion.div>
                            <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-red-500/90 text-white text-[7px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap backdrop-blur-sm border border-white/10 shadow-sm z-30">
                              FAST FILLING
                            </div>
                          </>
                        )}

                        {isSelected && !isBookedFull && (
                          <motion.div
                            layoutId="activeDate"
                            className="absolute -bottom-0.5 w-1 h-1 rounded-full bg-primary-500"
                          />
                        )}
                      </motion.button>
                    )
                  })}
                </div>
              )}
            </motion.div>

            {/* Seat Selection - Only show when date is selected */}
            <AnimatePresence>
              {selectedDate && selectedLocation && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="mb-8 overflow-hidden"
                >
                  <div className="rounded-2xl bg-dark-900/60 border border-white/10 p-4">
                    <div className="flex items-center justify-between">
                      {/* Left side: Activity name and location */}
                      <div className="flex-1 min-w-0 pr-4">
                        <h3 className="text-sm font-bold text-white truncate">Helicopter Ride</h3>
                        <p className="text-xs text-white/50 capitalize">
                          {locations.find((l) => l.id === selectedLocation)?.name ||
                            selectedLocation}
                        </p>
                      </div>

                      {/* Right side: Stepper */}
                      <div className="flex items-center gap-2">
                        <motion.button
                          onClick={() => setSelectedSeats((prev) => Math.max(1, prev - 1))}
                          whileTap={{ scale: 0.9 }}
                          disabled={selectedSeats <= 1}
                          className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-lg border transition-all
                        ${
                          selectedSeats <= 1
                            ? 'bg-dark-800/20 border-white/5 text-white/20 cursor-not-allowed'
                            : 'bg-dark-800/60 border-white/10 text-white hover:bg-dark-700'
                        }
                      `}
                        >
                          −
                        </motion.button>

                        <span className="text-xl font-bold text-white min-w-[2rem] text-center">
                          {selectedSeats}
                        </span>

                        <motion.button
                          onClick={() => setSelectedSeats((prev) => prev + 1)}
                          whileTap={{ scale: 0.9 }}
                          className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-lg border transition-all bg-primary-500 border-primary-400 text-white hover:bg-primary-600"
                        >
                          +
                        </motion.button>
                      </div>
                    </div>

                    {/* Warning for more than 6 seats */}
                    {selectedSeats > MAX_SEATS && (
                      <div className="mt-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
                        <span className="text-amber-500 text-sm">⚠️</span>
                        <p className="text-xs text-amber-400">
                          Helicopter capacity is 6 per trip. Your booking of {selectedSeats} seats
                          will require{' '}
                          <span className="font-bold">
                            {Math.ceil(selectedSeats / MAX_SEATS)} trips
                          </span>
                          .
                        </p>
                      </div>
                    )}

                    {/* Seat count info */}
                    <p className="text-[10px] text-white/40 mt-2">
                      {selectedSeats} {selectedSeats === 1 ? 'seat' : 'seats'} selected
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* end left column */}

          {/* ===== RIGHT COLUMN (sticky sidebar on desktop) ===== */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            {/* Info Cards */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="grid gap-3 mb-8"
            >
              <div className="p-4 rounded-2xl bg-dark-800/30 border border-white/5 backdrop-blur-sm">
                <h3 className="text-sm font-semibold text-white/90 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary-400" />
                  Process & Safety
                </h3>
                <div className="space-y-4">
                  {BOARDING_STEPS.map((step, idx) => (
                    <div key={idx} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[10px] font-bold text-white/60 shrink-0">
                        {idx + 1}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-white/80">{step.title}</p>
                        <p className="text-[11px] text-white/40 leading-relaxed">{step.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-dark-900/50 border border-white/5">
                <span className="text-xs text-white/40">Need help?</span>
                <div className="flex gap-4 text-xs font-medium">
                  <a
                    href={`tel:${SUPPORT_PHONE}`}
                    className="text-white hover:text-primary-300 transition-colors"
                  >
                    Call Support
                  </a>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="text-white hover:text-primary-300 transition-colors"
                  >
                    Email Us
                  </a>
                </div>
              </div>
            </motion.div>
          </div>
          {/* end right column */}
        </div>
        {/* end desktop grid */}

        {/* Beyond Joy Rides - specialized services */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mb-8"
        >
          <div className="flex items-center gap-2 mb-4 px-1">
            <Flame className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-bold tracking-wide uppercase text-white/80">
              Beyond Joy Rides
            </span>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {HELICOPTER_SERVICES.map((service, idx) => (
              <div
                key={idx}
                className="p-4 md:p-5 rounded-2xl bg-dark-800/40 border border-white/5 backdrop-blur-sm hover:bg-dark-800/60 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary-500/10 flex items-center justify-center">
                      <service.icon className="w-4 h-4 text-primary-400" />
                    </div>
                    <h3 className="text-sm font-bold text-white leading-tight">{service.title}</h3>
                  </div>
                </div>

                <ul className="space-y-1.5 mb-4 pl-1">
                  {service.features.map((feature, fIdx) => (
                    <li key={fIdx} className="text-xs text-white/60 flex items-start gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-white/20 mt-1.5 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between pt-3 border-t border-white/5">
                  <div className="text-xs font-medium text-white/40">{service.price}</div>
                  <a
                    href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`}
                    className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-bold text-white border border-white/10 transition-colors flex items-center gap-1.5"
                  >
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    Call to Book
                  </a>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Notify Modal */}
      <NotifyModal
        locationId={selectedLocation || ''}
        locationName={
          locations.find((l) => l.id === selectedLocation)?.name || selectedLocation || ''
        }
        isOpen={isNotifyModalOpen}
        onClose={() => setIsNotifyModalOpen(false)}
      />

      {/* Bottom Floating Action Button */}
      <AnimatePresence>
        {selectedDate && (
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: [0, -2, 0] }}
            exit={{ y: 100 }}
            transition={{ y: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } }}
            className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none"
          >
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-dark-950 via-dark-950/85 to-transparent pointer-events-none" />

            <div className="relative w-full max-w-lg lg:max-w-xl mx-auto p-4 pointer-events-auto">
              {!isProcessing && (
                <div className="absolute inset-x-8 -top-10 h-24 pointer-events-none z-30">
                  <motion.div
                    className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-gradient-to-r from-transparent via-sky-200/60 to-transparent"
                    animate={{ opacity: [0.25, 0.6, 0.25] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-10 h-10 drop-shadow-[0_6px_18px_rgba(56,189,248,0.35)] z-40"
                    animate={{
                      left: ['4%', '90%', '90%', '4%', '4%'],
                      y: [0, -2, 0, 2, 0],
                      // Flip so the nose points in the travel direction; base asset faces left.
                      scaleX: [-1, -1, 1, 1, -1],
                    }}
                    transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <LottieAnimation
                      src="/animations/helicopter.json"
                      className="w-10 h-10 drop-shadow-[0_0_10px_rgba(125,211,252,0.7)]"
                    />
                  </motion.div>
                </div>
              )}

              <motion.div
                className="absolute inset-4 rounded-2xl bg-gradient-to-r from-sky-400/50 via-cyan-300/45 to-sky-500/50 blur-xl"
                animate={
                  isProcessing
                    ? { opacity: 0.35, scale: 1 }
                    : { opacity: [0.35, 0.8, 0.35], scale: [1, 1.05, 1] }
                }
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              />

              <motion.button
                onClick={handleProceed}
                disabled={isProcessing}
                whileTap={{ scale: 0.98 }}
                animate={isProcessing ? { scale: 1 } : { scale: [1, 1.01, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                className="relative overflow-hidden w-full h-16 rounded-2xl bg-gradient-to-r from-sky-300 via-cyan-300 to-sky-400 text-sky-950 font-bold text-base disabled:opacity-70 disabled:scale-100 flex items-center justify-center gap-3 border border-sky-100/80 shadow-[0_10px_32px_rgba(56,189,248,0.45)]"
              >
                {!isProcessing && (
                  <>
                    <div className="absolute inset-0 opacity-60 pointer-events-none overflow-hidden">
                      <motion.div
                        className="absolute left-[-30%] top-2 h-12 w-32 rounded-full bg-white/45 blur-md"
                        animate={{ x: ['-30%', '120%'] }}
                        transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
                      >
                        <div className="absolute -left-3 top-1 h-7 w-14 bg-white/55 rounded-full" />
                        <div className="absolute left-8 -top-2 h-9 w-[4.5rem] bg-white/40 rounded-full" />
                      </motion.div>
                      <motion.div
                        className="absolute left-[15%] bottom-4 h-10 w-28 rounded-full bg-white/35 blur-md"
                        animate={{ x: ['120%', '-40%'] }}
                        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                      >
                        <div className="absolute left-1 -top-2 h-6 w-12 bg-white/50 rounded-full" />
                        <div className="absolute left-10 -1 h-8 w-14 bg-white/40 rounded-full" />
                      </motion.div>
                    </div>
                    <motion.span
                      aria-hidden
                      className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/80 to-transparent"
                      animate={{ x: ['0%', '370%'] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
                    />
                    <motion.span
                      aria-hidden
                      className="absolute inset-0 rounded-2xl border border-sky-50/80"
                      animate={{ opacity: [0.4, 0.95, 0.4] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </>
                )}

                {isProcessing ? (
                  <div className="relative z-10 w-5 h-5 border-2 border-sky-900/30 border-t-sky-900 rounded-full animate-spin" />
                ) : (
                  <span className="relative z-10 flex items-center justify-center gap-3">
                    <span className="tracking-wide">
                      Book for{' '}
                      {selectedDate.toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        timeZone: 'Asia/Kolkata',
                      })}
                    </span>
                    <motion.span
                      animate={{ x: [0, 4, 0] }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <ArrowLeft className="w-4 h-4 rotate-180" />
                    </motion.span>
                  </span>
                )}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
