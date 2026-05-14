import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { MapPin, Loader2, AlertCircle, Plus, Minus, Bell } from 'lucide-react'
import type { Activity } from '../types'
import { getEnabledLocations, getLocationByBranchId } from '../lib/locations'
import NotifyModal from '../components/NotifyModal'
import { formatCurrency, vibrate } from '../lib/utils'
import ActivityBottomSheet from '../components/ActivityBottomSheet'
import { useBooking } from '../contexts/BookingContext'
import { useCart } from '../contexts/CartContext'
import { getGameTypes, getGames, type Category } from '../services/activityService'
import { listActiveEventsForLocation } from '../services/eventService'
import type { EventCampaignRecord } from '../pipeline/features/event-campaigns/event-campaign-types'
import LottieAnimation from '../components/ui/LottieAnimation'
import CombosSection from '../components/CombosSection'
import SEO from '../components/SEO'
import { carouselConfigApi } from '../pipeline/api/carousel-config-firestore'
import type { CarouselSlide } from '../pipeline/api/carousel-config-firestore'
import { logger } from '../lib/logger'
import { useHelicopterEnabled } from '../hooks/useHelicopterEnabled'
import '../styles/speed-lines.css'

const DEFAULT_IMAGE = 'https://asquaregokarting.com/admin_secure/images/games/gokarting%201x1.jpg'
const LOGO_DARK =
  'https://asquaregokarting.com/admin_secure/images/games/A%20Square%20logo%20dark%20(1).png'

// Pre-computed starfield particle positions for the helicopter hero slide.
// Previously inlined as `Math.random()` calls inside JSX, which re-rolled
// positions on every render (shifting the stars around every time cart state
// or any parent prop changed). Now stable for the component's lifetime.
const HERO_STARS = Array.from({ length: 20 }, () => ({
  top: `${Math.random() * 100}%`,
  left: `${Math.random() * 100}%`,
  width: `${Math.random() * 3}px`,
  height: `${Math.random() * 3}px`,
  animationDuration: `${Math.random() * 3 + 1}s`,
}))

const DESKTOP_HERO_STARS = Array.from({ length: 30 }, () => ({
  top: `${Math.random() * 100}%`,
  left: `${Math.random() * 100}%`,
  width: `${Math.random() * 3 + 1}px`,
  height: `${Math.random() * 3 + 1}px`,
  animationDuration: `${Math.random() * 3 + 1}s`,
}))

export default function Activities() {
  const navigate = useNavigate()
  const { selectedLocation } = useBooking()
  const { addItem, getItemQuantity, updateQuantity, items } = useCart()
  const { enabled: heliEnabled } = useHelicopterEnabled()
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null)
  const [currentSlide, setCurrentSlide] = useState(0)
  const [carouselPaused, setCarouselPaused] = useState(false)
  const [carouselSlides, setCarouselSlides] = useState<CarouselSlide[]>([])
  const [autoRotateInterval, setAutoRotateInterval] = useState(100000)

  const [searchParams] = useSearchParams()

  const [activities, setActivities] = useState<Activity[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [events, setEvents] = useState<EventCampaignRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notifyModalOpen, setNotifyModalOpen] = useState(false)

  const selectedLocationData = selectedLocation
    ? getLocationByBranchId(selectedLocation)
    : undefined
  const isComingSoonLocation = selectedLocationData?.slug === 'srikakulam'

  // Fetch all data when location changes
  useEffect(() => {
    async function loadData() {
      if (!selectedLocation) {
        setCategories([])
        setActivities([])
        return
      }

      setLoading(true)
      setError(null)
      setSelectedCategory('all')

      try {
        // Fetch everything in parallel
        const [gameTypes, allGames, activeEvents] = await Promise.all([
          getGameTypes(selectedLocation),
          getGames(selectedLocation, 'all'),
          listActiveEventsForLocation(selectedLocation).catch(() => [] as EventCampaignRecord[]),
        ])

        // filter categories that have at least one activity
        const nonPointsCategories = gameTypes.filter((cat) =>
          allGames.some((game) => game.gameTypeId === cat.id),
        )

        setCategories([...nonPointsCategories.filter((c) => c.id !== 'helicopter')])
        setActivities(allGames)
        setEvents(activeEvents)

        // Find gokarting category to set as default
        const gokartingCat = nonPointsCategories.find(
          (cat) =>
            cat.name.toLowerCase().includes('gokarting') || cat.name.toLowerCase().includes('kart'),
        )

        // Check for category query param
        const categoryParam = searchParams.get('category')
        if (categoryParam) {
          if (categoryParam.toLowerCase() === 'helicopter') {
            if (heliEnabled) {
              navigate('/helicopter-bookings')
              return
            }
            // helicopter disabled — fall through to default category
          } else {
            const targetCat = nonPointsCategories.find(
              (cat) =>
                cat.id === categoryParam ||
                cat.name.toLowerCase().includes(categoryParam.toLowerCase()),
            )
            if (targetCat) {
              setSelectedCategory(targetCat.id)
            } else if (gokartingCat) {
              setSelectedCategory(gokartingCat.id)
            }
          }
        } else if (gokartingCat) {
          setSelectedCategory(gokartingCat.id)
        }
      } catch (err: unknown) {
        logger.error('activities.load_failed', err)
        setError('Failed to load data. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [selectedLocation, searchParams, navigate, heliEnabled])
  // heliEnabled is a dep so the helicopter category deep-link respects the master switch on live toggle.

  // Scroll lock when activity sheet is open
  useEffect(() => {
    if (selectedActivity) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [selectedActivity])

  // Local filtering for the grid. Memoized so changing unrelated state
  // (cart, selected activity, slide index) doesn't re-filter the entire
  // activity list on every render — only when activities or the selected
  // category actually change.
  const filteredActivities = useMemo(() => {
    if (selectedCategory === 'all') return activities
    const selectedCatLower = selectedCategory.toLowerCase()
    return activities.filter((a) => {
      const activityGameTypeId = (a.gameTypeId || '').toLowerCase()
      const activityCategory = (a.category || '').toLowerCase()
      return activityGameTypeId === selectedCatLower || activityCategory === selectedCatLower
    })
  }, [activities, selectedCategory])

  // Fetch carousel config from Firestore
  useEffect(() => {
    void carouselConfigApi
      .getConfig()
      .then((cfg) => {
        const active = cfg.slides.filter((s) => s.isActive).sort((a, b) => a.position - b.position)
        setCarouselSlides(active)
        setAutoRotateInterval(cfg.autoRotateInterval)
      })
      .catch(() => {
        // Fallback: show all 4 default slides
        setCarouselSlides(carouselConfigApi.getDefaultSlides())
      })
  }, [])

  // Map slide IDs to indices for rendering
  const slideIdToIndex: Record<string, number> = {
    gokart: 0,
    helicopter: 1,
    influencer: 2,
    partner: 3,
  }
  const activeSlideIndices = carouselSlides
    .map((s) => slideIdToIndex[s.id] ?? -1)
    .filter((i) => i >= 0)
  const totalSlides = activeSlideIndices.length || 4
  const currentSlideIndex = activeSlideIndices[currentSlide % totalSlides] ?? currentSlide

  // Helper to get config data for a slide by ID
  const slideConfigMap = new Map(carouselSlides.map((s) => [s.id, s]))
  const getSlide = (id: string) => slideConfigMap.get(id)

  // Auto-rotate banner carousel
  useEffect(() => {
    if (totalSlides <= 1 || carouselPaused) return
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % totalSlides)
    }, autoRotateInterval)
    return () => clearInterval(timer)
  }, [totalSlides, autoRotateInterval, carouselPaused])

  return (
    <div className="safe-bottom">
      <SEO
        title="Go-Kart Racing & Adventure Activities"
        description="Race go-karts, fly helicopters & enjoy adventure sports at A Square — Andhra Pradesh's top entertainment destination. Book online across 4 locations!"
        path="/activities"
      />

      {/* ============ MOBILE BANNER CAROUSEL ============ */}
      <div className="relative h-[18rem] md:h-[22rem] overflow-hidden lg:hidden mx-3 md:mx-4 mt-2 rounded-2xl md:rounded-3xl">
        <AnimatePresence mode="wait">
          {currentSlideIndex === 0 && (
            <motion.div
              key="slide-0"
              className="absolute inset-0 bg-hero-navy"
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -100 }}
              transition={{ duration: 0.5 }}
            >
              <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-40">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className={`speed-line speed-line-${i}`} />
                ))}
              </div>
              <motion.div
                className="absolute right-[-20px] bottom-0 w-56 h-48 md:w-72 md:h-64 z-30"
                initial={{ x: 100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              >
                <motion.img
                  src="/gokart.webp"
                  alt="Go Kart Racing"
                  className="w-full h-full object-contain drop-shadow-2xl"
                  animate={{ y: [0, -5, 0], rotate: [0, 0.5, 0, -0.5, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                />
              </motion.div>
              <div className="absolute left-0 right-0 bottom-6 p-4 pt-8 flex flex-col justify-end z-20 bg-gradient-to-t from-hero-navy via-hero-navy/60 to-transparent">
                <motion.h2
                  className="text-white font-display font-extrabold text-xl leading-tight drop-shadow-lg"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                >
                  High-Speed
                  <br />
                  <span className="text-2xl text-primary-500 whitespace-nowrap">
                    Adventure Awaits
                  </span>
                </motion.h2>
              </div>
            </motion.div>
          )}
          {currentSlideIndex === 1 && (
            <motion.div
              key="slide-1"
              className="absolute inset-0 bg-gradient-to-b from-hero-purple-950 via-hero-purple-900 to-hero-purple-800"
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -100 }}
              transition={{ duration: 0.5 }}
            >
              <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
                {HERO_STARS.map((star, i) => (
                  <div
                    key={i}
                    className="absolute bg-white rounded-full animate-pulse"
                    style={star}
                  />
                ))}
              </div>
              <div className="absolute inset-0 z-0">
                <LottieAnimation
                  src="/animations/night-sky.json"
                  className="w-full h-full opacity-90"
                />
              </div>
              <motion.div
                className="absolute right-[-20px] bottom-0 w-56 h-48 md:w-72 md:h-64 z-30"
                initial={{ x: 150, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 1, ease: 'easeOut' }}
              >
                <LottieAnimation
                  src="/animations/helicopter.json"
                  className="w-full h-full drop-shadow-2xl"
                />
              </motion.div>
              <div className="absolute left-0 right-0 bottom-4 p-4 z-30">
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                >
                  <h2 className="text-white font-display font-extrabold text-xl leading-tight drop-shadow-lg mb-3">
                    Joy Rides
                    <br />
                    <span className="text-lg text-slate-300">
                      Helicopter adventures in 3 cities
                    </span>
                  </h2>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => navigate('/helicopter-bookings')}
                    className="px-6 py-2 bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold rounded-full shadow-lg shadow-orange-500/30 flex items-center gap-2 hover:shadow-xl transition-all"
                  >
                    Book Now
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </motion.button>
                </motion.div>
              </div>
            </motion.div>
          )}
          {/* Slide 2: Influencer Banner */}
          {currentSlideIndex === 2 &&
            (() => {
              const s = getSlide('influencer')
              return (
                <motion.div
                  key="slide-2"
                  className="absolute inset-0"
                  style={{ backgroundColor: s?.backgroundColor ?? '#15151E' }}
                  initial={{ opacity: 0, x: 100 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ duration: 0.5 }}
                >
                  <div
                    className="absolute inset-0 opacity-[0.04]"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)',
                    }}
                  />
                  <div
                    className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full blur-[100px]"
                    style={{ backgroundColor: `${s?.accentColor ?? '#E10600'}15` }}
                  />
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ backgroundColor: s?.accentColor ?? '#E10600' }}
                  />
                  {/* Readability scrim — keeps headline crisp over accent glow */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                  <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-6 pt-8">
                    <img
                      src="/asquare-logo.webp"
                      alt="A Square"
                      className="h-12 mb-4 object-contain"
                    />
                    <h2 className="text-white font-display font-black text-xl uppercase tracking-tight mb-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                      {s?.title ?? 'Are you an Influencer?'}
                    </h2>
                    <p className="text-white/75 text-sm mb-5 max-w-xs drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
                      {s?.subtitle ?? 'Create reels about your GoKarting experience and earn up to'}{' '}
                      {s?.highlightText && (
                        <span className="font-bold" style={{ color: s.highlightColor }}>
                          {s.highlightText}
                        </span>
                      )}
                      {!s?.highlightText && (
                        <span className="text-instagram font-bold">₹10,000</span>
                      )}{' '}
                      {!s?.highlightText && 'per reel'}
                    </p>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => navigate(s?.buttonLink ?? '/influencer-portal')}
                      className="px-6 py-2.5 text-white font-bold rounded-full shadow-lg flex items-center gap-2 transition-all uppercase tracking-wider text-sm cursor-pointer"
                      style={{
                        backgroundColor: s?.accentColor ?? '#E10600',
                        boxShadow: `0 10px 15px -3px ${s?.accentColor ?? '#E10600'}4D`,
                      }}
                    >
                      {s?.buttonText ?? 'Join Kartfluencer'}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </motion.button>
                  </div>
                </motion.div>
              )
            })()}
          {/* Slide 3: Partner Banner */}
          {currentSlideIndex === 3 &&
            (() => {
              const s = getSlide('partner')
              return (
                <motion.div
                  key="slide-3"
                  className="absolute inset-0"
                  style={{ backgroundColor: s?.backgroundColor ?? '#0a1628' }}
                  initial={{ opacity: 0, x: 100 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ duration: 0.5 }}
                >
                  <div
                    className="absolute top-1/3 right-1/4 w-[300px] h-[300px] rounded-full blur-[80px]"
                    style={{ backgroundColor: `${s?.accentColor ?? '#0066FF'}15` }}
                  />
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ backgroundColor: s?.accentColor ?? '#0066FF' }}
                  />
                  <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-6 pt-8">
                    <img
                      src="/asquare-logo.webp"
                      alt="A Square"
                      className="h-12 mb-4 object-contain"
                    />
                    <h2 className="text-white font-display font-black text-xl uppercase tracking-tight mb-2">
                      {s?.title ?? 'Partner with Us'}
                    </h2>
                    <p className="text-white/40 text-sm mb-5 max-w-xs">
                      {s?.subtitle ??
                        'Become an A Square GoKarting franchise partner. Expanding to'}{' '}
                      {s?.highlightText && (
                        <span className="font-bold" style={{ color: s.highlightColor }}>
                          {s.highlightText}
                        </span>
                      )}
                      {!s?.highlightText && (
                        <span className="text-primary-500 font-bold">Srikakulam</span>
                      )}
                      !
                    </p>
                    <div className="flex gap-3">
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => navigate(s?.buttonLink ?? '/partner')}
                        className="px-5 py-2.5 text-white font-bold rounded-full shadow-lg flex items-center gap-2 transition-all uppercase tracking-wider text-xs cursor-pointer"
                        style={{
                          backgroundColor: s?.accentColor ?? '#0066FF',
                          boxShadow: `0 10px 15px -3px ${s?.accentColor ?? '#0066FF'}4D`,
                        }}
                      >
                        {s?.buttonText ?? 'Become a Partner'}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12h14" />
                          <path d="m12 5 7 7-7 7" />
                        </svg>
                      </motion.button>
                      {(s?.secondaryButtonText || !s) && (
                        <a
                          href={s?.secondaryButtonLink ?? '/brochure-srikakulam.pdf'}
                          download={!s?.secondaryButtonLink?.startsWith('/') ? undefined : true}
                          className="px-5 py-2.5 border border-white/15 text-white font-bold rounded-full flex items-center gap-2 hover:bg-white/5 transition-all uppercase tracking-wider text-xs cursor-pointer"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" x2="12" y1="15" y2="3" />
                          </svg>
                          {s?.secondaryButtonText ?? 'Brochure'}
                        </a>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })()}
        </AnimatePresence>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2">
          {Array.from({ length: totalSlides }, (_, i) => i).map((idx) => (
            <button
              key={idx}
              onClick={() => setCurrentSlide(idx)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${currentSlide % totalSlides === idx ? 'bg-white w-6' : 'bg-white/50'}`}
              aria-label={`Slide ${idx + 1}`}
            />
          ))}
          <button
            type="button"
            onClick={() => setCarouselPaused((p) => !p)}
            className="ml-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-all hover:bg-white/30"
            aria-label={carouselPaused ? 'Play carousel' : 'Pause carousel'}
          >
            {carouselPaused ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="white"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="white"
              >
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ============ DESKTOP BANNER ============ */}
      <div className="hidden lg:block relative overflow-hidden mx-6 xl:mx-8 2xl:mx-auto my-6 xl:my-8 rounded-3xl max-w-[1400px]">
        <AnimatePresence mode="wait">
          {currentSlideIndex === 0 && (
            <motion.div
              key="desktop-slide-0"
              className="relative min-h-[420px] xl:min-h-[480px] bg-hero-navy overflow-hidden rounded-3xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
            >
              {/* Animated grid background */}
              <div
                className="absolute inset-0 opacity-[0.07]"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                  backgroundSize: '60px 60px',
                }}
              />

              {/* Radial glow behind kart */}
              <div className="absolute top-1/2 right-[25%] -translate-y-1/2 w-[600px] h-[600px] bg-primary-500/10 rounded-full blur-[120px]" />
              <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-hero-navy to-transparent z-10" />

              {/* Speed Lines */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
                {[...Array(16)].map((_, i) => (
                  <div key={i} className={`speed-line speed-line-${i}`} />
                ))}
              </div>

              {/* Go-Kart - centered right */}
              <motion.div
                className="absolute right-[5%] xl:right-[8%] 2xl:right-[10%] bottom-0 w-[420px] xl:w-[500px] 2xl:w-[560px] h-[360px] xl:h-[420px] 2xl:h-[460px] z-20"
                initial={{ x: 200, opacity: 0, scale: 0.8 }}
                animate={{ x: 0, opacity: 1, scale: 1 }}
                transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
              >
                <motion.img
                  src="/gokart.webp"
                  alt="Go Kart Racing"
                  className="w-full h-full object-contain drop-shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
                  animate={{ y: [0, -8, 0], rotate: [0, 0.3, 0, -0.3, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                />
              </motion.div>

              {/* Text Content - left side */}
              <div className="relative z-30 flex flex-col justify-center h-full min-h-[420px] xl:min-h-[480px] pl-16 xl:pl-24 pr-8 py-10 xl:py-14 max-w-[55%]">
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  className="mb-4"
                >
                  <span className="inline-block px-4 py-1.5 rounded-full bg-primary-500/15 border border-primary-500/30 text-primary-400 text-sm font-bold tracking-wide uppercase">
                    Go Karting & More
                  </span>
                </motion.div>

                <motion.h1
                  className="text-white font-display font-black text-5xl xl:text-6xl 2xl:text-7xl leading-[1.1] tracking-tight"
                  initial={{ y: 40, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                >
                  High-Speed
                  <br />
                  <span className="bg-gradient-to-r from-primary-400 via-primary-500 to-secondary-400 bg-clip-text text-transparent">
                    Adventure Awaits
                  </span>
                </motion.h1>

                <motion.p
                  className="mt-5 text-dark-300 text-lg xl:text-xl max-w-md leading-relaxed"
                  initial={{ y: 30, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.35 }}
                >
                  Experience the thrill of professional-grade go-karts, paintball, and more at
                  India's premier adventure park.
                </motion.p>

                <motion.div
                  className="flex items-center gap-4 mt-8"
                  initial={{ y: 30, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.5 }}
                >
                  <motion.button
                    whileHover={{ scale: 1.03, y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setSelectedCategory('all')}
                    className="px-8 py-3.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white font-bold rounded-full shadow-lg shadow-primary-500/30 flex items-center gap-2.5 text-lg hover:shadow-xl hover:shadow-primary-500/40 transition-shadow"
                  >
                    Explore Activities
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => navigate('/waiting-list')}
                    className="px-6 py-3.5 border border-white/20 text-white font-semibold rounded-full flex items-center gap-2 text-base hover:bg-white/5 hover:border-white/30 transition-all"
                  >
                    View Live Queue
                  </motion.button>
                </motion.div>

                {/* Stats row */}
                <motion.div
                  className="flex items-center gap-8 mt-10"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.65 }}
                >
                  {[
                    { value: '3+', label: 'Locations' },
                    { value: '15+', label: 'Activities' },
                    { value: '50K+', label: 'Happy Riders' },
                  ].map((stat) => (
                    <div key={stat.label} className="text-center">
                      <div className="text-2xl xl:text-3xl font-display font-black text-white">
                        {stat.value}
                      </div>
                      <div className="text-xs xl:text-sm text-dark-400 font-medium mt-0.5">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </motion.div>
              </div>
            </motion.div>
          )}
          {currentSlideIndex === 1 && (
            <motion.div
              key="desktop-slide-1"
              className="relative min-h-[420px] xl:min-h-[480px] overflow-hidden rounded-3xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
            >
              {/* Night sky gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-hero-purple-950 via-hero-purple-900 to-hero-purple-800" />

              {/* Starry background */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-40">
                {DESKTOP_HERO_STARS.map((star, i) => (
                  <div
                    key={i}
                    className="absolute bg-white rounded-full animate-pulse"
                    style={star}
                  />
                ))}
              </div>

              {/* Night sky lottie */}
              <div className="absolute inset-0 z-0 opacity-80">
                <LottieAnimation src="/animations/night-sky.json" className="w-full h-full" />
              </div>

              {/* Radial glow */}
              <div className="absolute top-1/2 right-[20%] -translate-y-1/2 w-[500px] h-[500px] bg-orange-500/8 rounded-full blur-[100px]" />

              {/* Helicopter Animation */}
              <motion.div
                className="absolute right-[5%] xl:right-[8%] 2xl:right-[10%] bottom-4 w-[400px] xl:w-[480px] 2xl:w-[540px] h-[340px] xl:h-[400px] 2xl:h-[420px] z-20"
                initial={{ x: 200, y: -50, opacity: 0 }}
                animate={{ x: 0, y: 0, opacity: 1 }}
                transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
              >
                <LottieAnimation
                  src="/animations/helicopter.json"
                  className="w-full h-full drop-shadow-[0_20px_60px_rgba(0,0,0,0.4)]"
                />
              </motion.div>

              {/* Clouds layer */}
              <div className="absolute bottom-0 left-0 right-0 h-40 z-10 opacity-40">
                <LottieAnimation src="/animations/clouds.json" className="w-full h-full" />
              </div>

              {/* Text Content */}
              <div className="relative z-30 flex flex-col justify-center h-full min-h-[420px] xl:min-h-[480px] pl-16 xl:pl-24 pr-8 py-10 xl:py-14 max-w-[55%]">
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  className="mb-4"
                >
                  <span className="inline-block px-4 py-1.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400 text-sm font-bold tracking-wide uppercase">
                    New Experience
                  </span>
                </motion.div>

                <motion.h1
                  className="text-white font-display font-black text-5xl xl:text-6xl 2xl:text-7xl leading-[1.1] tracking-tight"
                  initial={{ y: 40, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                >
                  Helicopter
                  <br />
                  <span className="bg-gradient-to-r from-orange-400 via-red-400 to-pink-400 bg-clip-text text-transparent">
                    Joy Rides
                  </span>
                </motion.h1>

                <motion.p
                  className="mt-5 text-slate-300 text-lg xl:text-xl max-w-md leading-relaxed"
                  initial={{ y: 30, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.35 }}
                >
                  Soar above the skyline with breathtaking helicopter adventures. A memory that
                  lasts a lifetime.
                </motion.p>

                <motion.div
                  className="flex items-center gap-4 mt-8"
                  initial={{ y: 30, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.5 }}
                >
                  <motion.button
                    whileHover={{ scale: 1.03, y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => navigate('/helicopter-bookings')}
                    className="px-8 py-3.5 bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold rounded-full shadow-lg shadow-orange-500/30 flex items-center gap-2.5 text-lg hover:shadow-xl hover:shadow-orange-500/40 transition-shadow"
                  >
                    Book a Ride
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </motion.button>
                </motion.div>

                {/* City badges */}
                <motion.div
                  className="flex items-center gap-3 mt-10"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.65 }}
                >
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wider mr-1">
                    Available in
                  </span>
                  {getEnabledLocations()
                    .map((loc) => loc.displayName)
                    .map((city) => (
                      <span
                        key={city}
                        className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-sm text-white/80 font-medium"
                      >
                        {city}
                      </span>
                    ))}
                </motion.div>
              </div>
            </motion.div>
          )}
          {/* Desktop Slide 2: Influencer */}
          {currentSlideIndex === 2 &&
            (() => {
              const s = getSlide('influencer')
              return (
                <motion.div
                  key="desktop-slide-2"
                  className="relative min-h-[420px] xl:min-h-[480px] overflow-hidden rounded-3xl"
                  style={{ backgroundColor: s?.backgroundColor ?? '#15151E' }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6 }}
                >
                  <div
                    className="absolute inset-0 opacity-[0.04]"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)',
                    }}
                  />
                  <div
                    className="absolute top-1/3 right-1/3 w-[600px] h-[600px] rounded-full blur-[120px]"
                    style={{ backgroundColor: `${s?.accentColor ?? '#E10600'}12` }}
                  />
                  {/* Readability scrim — anchors headline over the accent glow */}
                  <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ backgroundColor: s?.accentColor ?? '#E10600' }}
                  />

                  {/* Go-kart image on right */}
                  <motion.div
                    className="absolute right-[5%] xl:right-[8%] bottom-0 w-[380px] xl:w-[460px] h-[320px] xl:h-[400px] z-20"
                    initial={{ x: 200, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <motion.img
                      src={s?.imageUrl || '/gokart.webp'}
                      alt="Go Kart"
                      className="w-full h-full object-contain"
                      style={{
                        filter: `drop-shadow(0 20px 60px ${s?.accentColor ?? '#E10600'}26)`,
                      }}
                      animate={{ y: [0, -8, 0] }}
                      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </motion.div>

                  <div className="relative z-30 flex flex-col justify-center h-full min-h-[420px] xl:min-h-[480px] pl-16 xl:pl-24 pr-8 py-10 xl:py-14 max-w-[55%]">
                    {(s?.badgeText || !s) && (
                      <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                        className="mb-4"
                      >
                        <span
                          className="inline-block px-4 py-1.5 rounded-full text-sm font-bold tracking-wide uppercase"
                          style={{
                            backgroundColor: `${s?.accentColor ?? '#E10600'}26`,
                            borderColor: `${s?.accentColor ?? '#E10600'}4D`,
                            color: s?.accentColor ?? '#E10600',
                            border: `1px solid ${s?.accentColor ?? '#E10600'}4D`,
                          }}
                        >
                          {s?.badgeText ?? 'Influencer Program'}
                        </span>
                      </motion.div>
                    )}
                    <motion.h1
                      className="text-white font-display font-black text-5xl xl:text-6xl 2xl:text-7xl leading-[1.1] tracking-tight uppercase drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)]"
                      initial={{ y: 40, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.2 }}
                    >
                      {s?.title ?? 'Are You An Influencer?'}
                    </motion.h1>
                    <motion.p
                      className="mt-5 text-white/80 text-lg xl:text-xl max-w-md leading-relaxed drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]"
                      initial={{ y: 30, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.35 }}
                    >
                      {s?.subtitle ??
                        'Create Instagram reels about your GoKarting experience and earn up to'}{' '}
                      {s?.highlightText && (
                        <span className="text-white font-bold">{s.highlightText}</span>
                      )}
                      {!s?.highlightText && <span className="text-white font-bold">₹10,000</span>}{' '}
                      {!s?.highlightText && 'per reel based on views.'}
                    </motion.p>
                    <motion.div
                      className="flex items-center gap-4 mt-8"
                      initial={{ y: 30, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.5 }}
                    >
                      <motion.button
                        whileHover={{ scale: 1.03, y: -2 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => navigate(s?.buttonLink ?? '/influencer-portal')}
                        className="px-8 py-3.5 text-white font-bold rounded-full shadow-lg flex items-center gap-2.5 text-lg hover:shadow-xl transition-shadow uppercase tracking-wider cursor-pointer"
                        style={{
                          backgroundColor: s?.accentColor ?? '#E10600',
                          boxShadow: `0 10px 15px -3px ${s?.accentColor ?? '#E10600'}4D`,
                        }}
                      >
                        {s?.buttonText ?? 'Join Kartfluencer'}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12h14" />
                          <path d="m12 5 7 7-7 7" />
                        </svg>
                      </motion.button>
                    </motion.div>
                    <motion.div
                      className="flex items-center gap-8 mt-10"
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.65 }}
                    >
                      {[
                        { value: '90+', label: 'Influencers' },
                        { value: '₹10K', label: 'Max / Reel' },
                        { value: '5', label: 'View Tiers' },
                      ].map((stat) => (
                        <div key={stat.label} className="text-center">
                          <div className="text-2xl xl:text-3xl font-display font-black text-white">
                            {stat.value}
                          </div>
                          <div className="text-xs xl:text-sm text-white/30 font-medium mt-0.5">
                            {stat.label}
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  </div>
                </motion.div>
              )
            })()}
          {/* Desktop Slide 3: Partner */}
          {currentSlideIndex === 3 &&
            (() => {
              const s = getSlide('partner')
              return (
                <motion.div
                  key="desktop-slide-3"
                  className="relative min-h-[420px] xl:min-h-[480px] overflow-hidden rounded-3xl"
                  style={{ backgroundColor: s?.backgroundColor ?? '#0a1628' }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6 }}
                >
                  <div
                    className="absolute top-1/3 right-1/4 w-[500px] h-[500px] rounded-full blur-[120px]"
                    style={{ backgroundColor: `${s?.accentColor ?? '#0066FF'}12` }}
                  />
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ backgroundColor: s?.accentColor ?? '#0066FF' }}
                  />

                  <div className="relative z-30 flex flex-col justify-center h-full min-h-[420px] xl:min-h-[480px] pl-16 xl:pl-24 pr-8 py-10 xl:py-14 max-w-[65%]">
                    {(s?.badgeText || !s) && (
                      <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                        className="mb-4"
                      >
                        <span
                          className="inline-block px-4 py-1.5 rounded-full text-sm font-bold tracking-wide uppercase"
                          style={{
                            backgroundColor: `${s?.accentColor ?? '#0066FF'}26`,
                            color: s?.accentColor ?? '#0066FF',
                            border: `1px solid ${s?.accentColor ?? '#0066FF'}4D`,
                          }}
                        >
                          {s?.badgeText ?? 'Franchise Opportunity'}
                        </span>
                      </motion.div>
                    )}
                    <motion.h1
                      className="text-white font-display font-black text-5xl xl:text-6xl 2xl:text-7xl leading-[1.1] tracking-tight uppercase"
                      initial={{ y: 40, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.2 }}
                    >
                      {s?.title ?? 'Partner With Us'}
                    </motion.h1>
                    <motion.p
                      className="mt-5 text-white/40 text-lg xl:text-xl max-w-lg leading-relaxed"
                      initial={{ y: 30, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.35 }}
                    >
                      {s?.subtitle ??
                        'Become an A Square GoKarting franchise partner. Now expanding to'}{' '}
                      {s?.highlightText && (
                        <span className="font-bold" style={{ color: s.highlightColor }}>
                          {s.highlightText}
                        </span>
                      )}
                      {!s?.highlightText && (
                        <span className="text-primary-500 font-bold">Srikakulam</span>
                      )}
                      {!s?.highlightText && '. Download our project brochure.'}
                    </motion.p>
                    <motion.div
                      className="flex items-center gap-4 mt-8"
                      initial={{ y: 30, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.5 }}
                    >
                      <motion.button
                        whileHover={{ scale: 1.03, y: -2 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => navigate(s?.buttonLink ?? '/partner')}
                        className="px-8 py-3.5 text-white font-bold rounded-full shadow-lg flex items-center gap-2.5 text-lg hover:shadow-xl transition-shadow uppercase tracking-wider cursor-pointer"
                        style={{
                          backgroundColor: s?.accentColor ?? '#0066FF',
                          boxShadow: `0 10px 15px -3px ${s?.accentColor ?? '#0066FF'}4D`,
                        }}
                      >
                        {s?.buttonText ?? 'Become a Partner'}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12h14" />
                          <path d="m12 5 7 7-7 7" />
                        </svg>
                      </motion.button>
                      {(s?.secondaryButtonText || !s) && (
                        <a
                          href={s?.secondaryButtonLink ?? '/brochure-srikakulam.pdf'}
                          download={!s?.secondaryButtonLink?.startsWith('/') ? undefined : true}
                          className="px-6 py-3.5 border border-white/20 text-white font-semibold rounded-full flex items-center gap-2 text-base hover:bg-white/5 hover:border-white/30 transition-all uppercase tracking-wider cursor-pointer"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" x2="12" y1="15" y2="3" />
                          </svg>
                          {s?.secondaryButtonText ?? 'Download Brochure'}
                        </a>
                      )}
                    </motion.div>
                    <motion.div
                      className="flex items-center gap-6 mt-10"
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.65 }}
                    >
                      {[
                        'Prime Locations',
                        'Full Setup Support',
                        'Proven Business Model',
                        'Training Included',
                      ].map((item) => (
                        <div key={item} className="flex items-center gap-1.5">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            stroke={s?.accentColor ?? '#0066FF'}
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span className="text-xs text-white/50 font-medium">{item}</span>
                        </div>
                      ))}
                    </motion.div>
                  </div>
                </motion.div>
              )
            })()}
        </AnimatePresence>

        {/* Desktop Carousel Controls */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3">
          {Array.from({ length: totalSlides }, (_, i) => i).map((idx) => (
            <button
              key={idx}
              onClick={() => setCurrentSlide(idx)}
              className={`h-2 rounded-full transition-all duration-500 ${currentSlide % totalSlides === idx ? 'bg-white w-10' : 'bg-white/30 w-3 hover:bg-white/50'}`}
              aria-label={`Slide ${idx + 1}`}
            />
          ))}
          <button
            type="button"
            onClick={() => setCarouselPaused((p) => !p)}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm transition-all hover:bg-white/25"
            aria-label={carouselPaused ? 'Play carousel' : 'Pause carousel'}
          >
            {carouselPaused ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="white"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="white"
              >
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Location Prompt when no location selected */}
      {!selectedLocation && (
        <div className="sticky top-[62px] lg:top-0 z-40 bg-dark-950/95 backdrop-blur-md px-4 py-3 lg:py-6 shadow-lg border-b border-white/5">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <motion.div
              className="w-20 h-20 rounded-full bg-primary-500/10 flex items-center justify-center mb-6 relative"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <div className="absolute inset-0 rounded-full bg-primary-500/20 animate-ping" />
              <MapPin className="w-10 h-10 text-primary-500 relative z-10" />
            </motion.div>
            <h3 className="text-2xl font-display font-black text-white mb-3 uppercase tracking-tight">
              Select Your Location
            </h3>
            <p className="text-dark-400 max-w-xs leading-relaxed">
              To see activities, games, and pricing, please select your nearest branch from the{' '}
              <span className="text-primary-400 font-bold">pulsing button</span> at the top.
            </p>
          </div>
        </div>
      )}

      {/* Mobile Category Bar - horizontal scroll */}
      {selectedLocation && (
        <div className="sticky top-[62px] z-40 bg-dark-950/95 backdrop-blur-md px-4 py-3 shadow-lg border-b border-white/5 lg:hidden">
          <div className="flex gap-4 overflow-x-auto no-scrollbar md:justify-center md:flex-wrap">
            {heliEnabled && (
              <motion.button
                onClick={() => navigate('/helicopter-bookings')}
                className="flex-shrink-0 flex flex-col items-center gap-1 group"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.02 }}
                whileTap={{ scale: 0.95 }}
              >
                <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl overflow-hidden border-2 transition-all flex items-center justify-center border-white/10 group-hover:border-white/30">
                  <img
                    src="/helicopter-banner-placeholder.jpg"
                    alt="Helicopter"
                    width={96}
                    height={96}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="text-[11px] md:text-xs font-bold text-center leading-tight transition-colors w-20 md:w-24 line-clamp-2 text-dark-300 group-hover:text-white">
                  Helicopter
                </span>
              </motion.button>
            )}

            {events.map((evt, idx) => (
              <motion.button
                key={evt.id}
                onClick={() => navigate(`/event/${evt.slug}`)}
                className="flex-shrink-0 flex flex-col items-center gap-1 group"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 + idx * 0.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl overflow-hidden border-2 border-orange-500/30 transition-all flex items-center justify-center group-hover:border-orange-500/60">
                  <img
                    src={evt.heroImageUrl || DEFAULT_IMAGE}
                    alt={evt.title}
                    width={96}
                    height={96}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).src = DEFAULT_IMAGE
                    }}
                  />
                </div>
                <span className="text-[11px] md:text-xs font-bold text-center leading-tight transition-colors w-20 md:w-24 line-clamp-2 text-orange-300 group-hover:text-orange-200">
                  {evt.title}
                </span>
              </motion.button>
            ))}

            {categories.map((category, idx) => (
              <motion.button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className="flex-shrink-0 flex flex-col items-center gap-1 group"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <div
                  className={`w-20 h-20 md:w-24 md:h-24 rounded-2xl overflow-hidden border-2 transition-all flex items-center justify-center ${
                    selectedCategory === category.id
                      ? 'border-primary-500 shadow-glow-primary'
                      : 'border-transparent'
                  }`}
                >
                  <img
                    src={category.image || DEFAULT_IMAGE}
                    alt={category.name}
                    width={96}
                    height={96}
                    loading="lazy"
                    className={`${category.id === 'all' ? 'w-[65%] h-[65%] object-contain' : 'w-full h-full object-cover'}`}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.src = category.id === 'all' ? LOGO_DARK : DEFAULT_IMAGE
                    }}
                  />
                </div>
                <span
                  className={`text-[11px] md:text-xs font-bold text-center leading-tight transition-colors w-20 md:w-24 line-clamp-2 ${
                    selectedCategory === category.id ? 'text-primary-400' : 'text-dark-300'
                  }`}
                >
                  {category.name}
                </span>
                {selectedCategory === category.id && (
                  <motion.div
                    className="w-8 h-1 bg-primary-500 rounded-full"
                    layoutId="categoryIndicator"
                  />
                )}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Desktop: Sidebar + Grid layout / Mobile: Grid only */}
      {selectedLocation && (
        <div className="lg:flex lg:max-w-[1400px] lg:mx-auto">
          {/* Desktop Category Sidebar */}
          <aside className="hidden lg:block lg:sticky lg:top-0 lg:self-start lg:w-56 xl:w-64 lg:shrink-0 lg:h-[calc(100vh-0px)] lg:overflow-y-auto lg:py-6 lg:pl-6 lg:pr-2 no-scrollbar">
            <h3 className="text-xs font-bold text-dark-400 uppercase tracking-widest mb-4 px-2">
              Categories
            </h3>
            <nav className="flex flex-col gap-1">
              {heliEnabled && (
                <motion.button
                  onClick={() => navigate('/helicopter-bookings')}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group hover:bg-white/5"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.02 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/10 group-hover:border-white/30 transition-all flex-shrink-0">
                    <img
                      src="/helicopter-banner-placeholder.jpg"
                      alt="Helicopter"
                      width={40}
                      height={40}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="text-sm font-semibold text-dark-300 group-hover:text-white transition-colors truncate">
                    Helicopter
                  </span>
                </motion.button>
              )}

              {events.map((evt, idx) => (
                <motion.button
                  key={evt.id}
                  onClick={() => navigate(`/event/${evt.slug}`)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group hover:bg-orange-500/5 border border-transparent"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.04 + idx * 0.05 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <div className="w-10 h-10 rounded-xl overflow-hidden border border-orange-500/30 group-hover:border-orange-500/50 transition-all flex-shrink-0">
                    <img
                      src={evt.heroImageUrl || DEFAULT_IMAGE}
                      alt={evt.title}
                      width={40}
                      height={40}
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).src = DEFAULT_IMAGE
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-dark-300 group-hover:text-white transition-colors truncate block">
                      {evt.title}
                    </span>
                    {evt.promoText && (
                      <p className="text-[10px] text-orange-400 truncate">{evt.promoText}</p>
                    )}
                  </div>
                </motion.button>
              ))}

              {categories.map((category, idx) => (
                <motion.button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
                    selectedCategory === category.id
                      ? 'bg-primary-500/10 border border-primary-500/30'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <div
                    className={`w-10 h-10 rounded-xl overflow-hidden border-2 transition-all flex-shrink-0 ${
                      selectedCategory === category.id ? 'border-primary-500' : 'border-transparent'
                    }`}
                  >
                    <img
                      src={category.image || DEFAULT_IMAGE}
                      alt={category.name}
                      className={`${category.id === 'all' ? 'w-[65%] h-[65%] object-contain m-auto' : 'w-full h-full object-cover'}`}
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.src = category.id === 'all' ? LOGO_DARK : DEFAULT_IMAGE
                      }}
                    />
                  </div>
                  <span
                    className={`text-sm font-semibold transition-colors truncate ${
                      selectedCategory === category.id
                        ? 'text-primary-400'
                        : 'text-dark-300 group-hover:text-white'
                    }`}
                  >
                    {category.name}
                  </span>
                  {selectedCategory === category.id && (
                    <motion.div
                      className="ml-auto w-1.5 h-6 bg-primary-500 rounded-full flex-shrink-0"
                      layoutId="categoryIndicatorDesktop"
                    />
                  )}
                </motion.button>
              ))}
            </nav>
          </aside>

          {/* Activities Grid */}
          <div className="pt-1 px-3 pb-3 lg:flex-1 lg:min-w-0 lg:px-8 lg:py-6">
            {/* Waiting List Banner */}
            <motion.button
              onClick={() => navigate('/waiting-list')}
              className="w-full mb-3 lg:mb-6 p-3 lg:p-5 rounded-2xl lg:rounded-[20px] bg-gradient-to-r from-primary-500/20 via-secondary-500/20 to-primary-500/20 border border-primary-500/30 flex items-center justify-between group hover:border-primary-500/50 transition-all lg:hover:shadow-lg lg:hover:shadow-primary-500/10"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="flex items-center gap-3 lg:gap-4">
                <div className="w-10 h-10 lg:w-14 lg:h-14 rounded-xl lg:rounded-2xl bg-primary-500/30 flex items-center justify-center text-xl lg:text-2xl">
                  🏁
                </div>
                <div className="text-left">
                  <h3 className="font-display font-bold text-white text-sm lg:text-lg">
                    Waiting List Dashboard
                  </h3>
                  <p className="text-xs lg:text-sm text-dark-400">
                    View live queue for all branches
                  </p>
                </div>
              </div>
              <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-400 group-hover:bg-primary-500/30 transition-colors">
                <svg
                  className="w-4 h-4 lg:w-5 lg:h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </motion.button>

            {/* Featured Event Campaign Cards */}
            {events.length > 0 && (
              <div className="mb-3 lg:mb-6 space-y-2.5">
                {events.map((evt) => (
                  <motion.button
                    key={evt.id}
                    onClick={() => navigate(`/event/${evt.slug}`)}
                    className="w-full relative h-24 md:h-32 lg:h-36 rounded-2xl overflow-hidden border border-orange-500/20 group text-left hover:border-orange-500/40 transition-all"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <img
                      src={evt.heroImageUrl || DEFAULT_IMAGE}
                      alt={evt.title}
                      className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-60 group-hover:scale-105 transition-all duration-500"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).src = DEFAULT_IMAGE
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-dark-950/80 via-dark-950/50 to-transparent" />
                    <div className="relative h-full flex items-center px-4 md:px-6">
                      <div className="min-w-0 flex-1">
                        {evt.promoText && (
                          <span className="inline-block px-2 py-0.5 bg-orange-500/20 border border-orange-500/30 rounded-full text-[10px] font-bold text-orange-300 mb-1">
                            {evt.promoText}
                          </span>
                        )}
                        <h3 className="text-sm md:text-base lg:text-lg font-display font-bold text-white truncate">
                          {evt.title}
                        </h3>
                        {evt.description && (
                          <p className="text-[11px] md:text-xs text-dark-300 mt-0.5 line-clamp-1">
                            {evt.description}
                          </p>
                        )}
                      </div>
                      <div className="ml-3 w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 group-hover:bg-orange-500/30 transition-colors flex-shrink-0">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            )}

            {/* Combos: curated bundles for the selected location. The
                section self-hides if there are no active combos, so this
                stays free of empty-state padding. */}
            <CombosSection locationKey={selectedLocationData?.slug} />

            <div id="activities-grid" className="flex items-center justify-between mb-2">
              <h2 className="text-base md:text-lg lg:text-xl font-display font-bold text-white">
                {selectedCategory === 'all'
                  ? 'All Activities'
                  : categories.find((c) => c.id === selectedCategory)?.name}
              </h2>
            </div>

            {/* Loading State */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-primary-500 animate-spin mb-4" />
                <p className="text-dark-400">Loading activities...</p>
              </div>
            )}

            {/* Error State */}
            {error && !loading && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                <p className="text-red-400 mb-4">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg font-bold"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Empty State */}
            {!loading &&
              !error &&
              filteredActivities.length === 0 &&
              (isComingSoonLocation ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-20 h-20 rounded-full bg-primary-500/20 flex items-center justify-center mb-6">
                    <MapPin className="w-10 h-10 text-primary-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-2">A Square Gokarting</h3>
                  <p className="text-orange-400 font-semibold text-sm mb-1">Coming Soon!</p>
                  <p className="text-dark-400 max-w-xs mb-6">
                    We're bringing the thrill to your city. Be the first to know when we launch!
                  </p>
                  <button
                    onClick={() => setNotifyModalOpen(true)}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-colors"
                  >
                    <Bell size={16} />
                    Notify Me When Available
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-full bg-dark-800 flex items-center justify-center mb-4">
                    <AlertCircle className="w-8 h-8 text-dark-500" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">No Activities Found</h3>
                  <p className="text-dark-400 max-w-xs">
                    {activities.length === 0
                      ? 'No activities are available at this location yet.'
                      : 'No activities match this category.'}
                  </p>
                </div>
              ))}

            {/* Activities Grid */}
            {!loading && !error && filteredActivities.length > 0 && (
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-3 lg:gap-4">
                {filteredActivities.map((activity, idx) => (
                  <motion.div
                    key={activity.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.05 }}
                    onClick={() => {
                      if (activity.variants) {
                        setSelectedActivity(activity)
                      } else {
                        addItem(activity, 1)
                        vibrate(15)
                      }
                    }}
                    className="cursor-pointer group relative h-32 md:h-40 lg:h-44 rounded-xl overflow-hidden border border-white/5 bg-dark-800/40 backdrop-blur-sm text-left hover:border-primary-500/50 transition-all active:scale-[0.98]"
                  >
                    {/* Background Image with Gradient */}
                    <div className="absolute inset-0">
                      <img
                        src={activity.image || DEFAULT_IMAGE}
                        alt={activity.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 opacity-70"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement
                          target.src = DEFAULT_IMAGE
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-dark-950/40 to-dark-950" />
                    </div>

                    {/* Content */}
                    <div className="absolute inset-0 p-2 md:p-3 lg:p-4 flex flex-col justify-end">
                      {(() => {
                        const qty = getItemQuantity(activity.id)
                        const totalQty = activity.variants
                          ? items
                              .filter((item) => item.activity.id.startsWith(activity.id))
                              .reduce((sum, item) => sum + item.quantity, 0)
                          : qty

                        if (totalQty > 0) {
                          return (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.8, x: -10 }}
                              animate={{ opacity: 1, scale: 1, x: 0 }}
                              className="absolute top-2 left-2 flex items-center justify-center bg-gradient-to-r from-primary-600 to-primary-500 backdrop-blur-md text-white px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest shadow-lg shadow-primary-500/20 z-10 border border-white/10"
                            >
                              {totalQty} IN CART
                            </motion.div>
                          )
                        }
                        return null
                      })()}

                      <h3 className="font-display font-bold text-white text-[11px] md:text-sm lg:text-base leading-tight mb-0.5 group-hover:text-primary-400 transition-colors line-clamp-2">
                        {activity.name}
                      </h3>

                      {activity.description && (
                        <p className="hidden md:block text-[9px] md:text-[10px] lg:text-xs text-gray-300/80 leading-tight line-clamp-1 md:line-clamp-2 mb-0.5">
                          {activity.description}
                        </p>
                      )}

                      <div className="flex items-center justify-between mt-1 pt-1 border-t border-white/10">
                        <div className="flex items-center gap-1">
                          <span className="text-secondary-400 font-bold font-display text-xs md:text-sm">
                            {formatCurrency(activity.basePrice)}
                          </span>
                        </div>
                        {/* Add to Cart / Quantity Controls */}
                        {(() => {
                          const qty = getItemQuantity(activity.id)
                          if (qty > 0) {
                            return (
                              <div
                                className="flex items-center gap-0.5 bg-dark-800/80 rounded-full"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    updateQuantity(activity.id, qty - 1)
                                    vibrate(10)
                                  }}
                                  className="w-4 h-4 rounded-full bg-dark-700 flex items-center justify-center text-white hover:bg-dark-600 transition-colors"
                                  aria-label="Decrease quantity"
                                >
                                  <Minus className="w-2 h-2" />
                                </button>
                                <span className="text-white font-bold text-[10px] min-w-[12px] text-center">
                                  {qty}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    updateQuantity(activity.id, qty + 1)
                                    vibrate(10)
                                  }}
                                  className="w-4 h-4 rounded-full bg-primary-500 flex items-center justify-center text-white hover:bg-primary-600 transition-colors"
                                  aria-label="Increase quantity"
                                >
                                  <Plus className="w-2 h-2" />
                                </button>
                              </div>
                            )
                          }
                          return (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                if (activity.variants) {
                                  setSelectedActivity(activity)
                                } else {
                                  addItem(activity, 1)
                                  vibrate(15)
                                }
                              }}
                              className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-primary-500 flex items-center justify-center text-white hover:bg-primary-600 transition-colors"
                              aria-label="Add to cart"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          )
                        })()}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Activity Bottom Sheet */}
      {selectedActivity && (
        <ActivityBottomSheet
          activity={selectedActivity}
          isOpen={!!selectedActivity}
          onClose={() => setSelectedActivity(null)}
        />
      )}

      <NotifyModal
        locationId={selectedLocation ?? ''}
        locationName={selectedLocationData?.displayName ?? 'Srikakulam'}
        isOpen={notifyModalOpen}
        onClose={() => setNotifyModalOpen(false)}
      />
    </div>
  )
}
