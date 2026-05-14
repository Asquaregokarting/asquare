import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Clock,
  Users,
  AlertTriangle,
  ShieldCheck,
  Info,
  CheckCircle,
  Loader2,
} from 'lucide-react'
import { useBooking } from '../contexts/BookingContext'
import { useCart } from '../contexts/CartContext'
import { formatCurrency } from '../lib/utils'
import type { Activity } from '../types'
import { getGameById } from '../services/activityService'
import SEO from '../components/SEO'

const DEFAULT_IMAGE = 'https://asquaregokarting.com/admin_secure/images/games/gokarting%201x1.jpg'

// Lap options for go-karting
const lapOptions = [
  { laps: 8, priceMultiplier: 1 },
  { laps: 12, priceMultiplier: 1.4 },
  { laps: 15, priceMultiplier: 1.7 },
  { laps: 20, priceMultiplier: 2.2 },
  { laps: 30, priceMultiplier: 3.0 },
  { laps: 50, priceMultiplier: 4.5 },
]

// Duration options for time-based activities (Helicopter)
const timeOptions = [
  { mins: 5, priceMultiplier: 1 },
  { mins: 10, priceMultiplier: 1.8 },
]

// Instructions for activities
const instructions = [
  'Arrive 15 minutes before your scheduled time',
  'Wear closed-toe shoes and comfortable clothing',
  'Remove all loose accessories and jewelry',
  'Follow staff instructions at all times',
  'Stay in designated areas only',
]

// Safety points
const safetyPoints = [
  'Keep hands inside the kart at all times',
  'Maintain safe distance from other karts',
  'No bumping or aggressive driving',
  'Signal with your hand if you need assistance',
  'Follow all track flags and signals',
]

export default function ActivityDetails() {
  const { activityId } = useParams<{ activityId: string }>()
  const navigate = useNavigate()
  const { selectedLocation } = useBooking()
  const { addItem } = useCart()
  const [activity, setActivity] = useState<Activity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedLaps, setSelectedLaps] = useState(lapOptions[0])
  const [selectedTime, setSelectedTime] = useState(timeOptions[0])

  useEffect(() => {
    async function loadActivity() {
      if (!selectedLocation || !activityId) return

      setLoading(true)
      try {
        const data = await getGameById(selectedLocation, activityId)
        if (data) {
          setActivity(data)
        } else {
          setError('Activity not found')
        }
      } catch {
        setError('Failed to load activity')
      } finally {
        setLoading(false)
      }
    }
    loadActivity()
  }, [selectedLocation, activityId])

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin mb-4" />
        <p className="text-dark-400">Loading details...</p>
      </div>
    )
  }

  if (!activity || error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <h2 className="text-xl font-bold text-white mb-2">{error || 'Activity Not Found'}</h2>
          <p className="text-dark-300 mb-4">
            The activity you're looking for doesn't exist or could not be loaded.
          </p>
          <button onClick={() => navigate('/activities')} className="btn-primary px-8">
            Back to Activities
          </button>
        </div>
      </div>
    )
  }

  const isGoKarting =
    activity.category === 'gokarting' || activity.name.toLowerCase().includes('kart')
  const isHelicopter =
    activity.category?.toLowerCase() === 'helicopter' || activity.gameTypeId === 'helicopter'

  // Calculate price based on activity type
  let calculatedPrice = activity.basePrice
  if (isGoKarting) {
    calculatedPrice = Math.round(activity.basePrice * selectedLaps.priceMultiplier)
  } else if (isHelicopter && activity.variants && activity.variants.length > 0) {
    // Use variant pricing for helicopter
    const variant = activity.variants.find((v) => v.laps === selectedTime.mins)
    calculatedPrice = variant?.price || activity.basePrice
  }

  const handleBookNow = () => {
    addItem(activity, 1)
    navigate('/cart')
  }

  return (
    <div className="min-h-screen bg-dark-950 safe-bottom">
      <SEO
        title={activity.name}
        description={
          activity.description ||
          `Book ${activity.name} at A Square GoKarting. Starting from ₹${activity.basePrice}.`
        }
        path={`/activities/${activityId}`}
        image={activity.image || undefined}
      />
      {/* Hero Image */}
      <div className="relative h-72 overflow-hidden">
        <img
          src={activity.image || DEFAULT_IMAGE}
          alt={activity.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            const target = e.target as HTMLImageElement
            target.src = DEFAULT_IMAGE
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-dark-950/50 via-transparent to-dark-950" />

        {/* Back Button */}
        <motion.button
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-dark-950/50 backdrop-blur-md flex items-center justify-center border border-white/10"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </motion.button>

        {/* Activity Icon Badge */}
        <div className="absolute bottom-4 left-4 w-16 h-16 rounded-2xl bg-primary-500 flex items-center justify-center text-3xl shadow-lg shadow-primary-500/30 border-2 border-primary-400">
          {activity.icon}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 -mt-4 relative z-10">
        {/* Activity Info Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-5 mb-4"
        >
          <div className="flex justify-between items-start mb-3">
            <div>
              <h1 className="text-2xl font-display font-bold text-white mb-1">{activity.name}</h1>
              <p className="text-dark-300 text-sm">{activity.description}</p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-display font-bold text-secondary-400">
                {formatCurrency(calculatedPrice)}
              </span>
              {isGoKarting && <p className="text-xs text-dark-400">for {selectedLaps.laps} laps</p>}
              {isHelicopter && (
                <p className="text-xs text-dark-400">for {selectedTime.mins} mins</p>
              )}
            </div>
          </div>

          {/* Quick Info */}
          <div className="flex gap-4 pt-3 border-t border-white/10">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary-400" />
              <span className="text-sm text-dark-300">
                {isGoKarting
                  ? `${selectedLaps.laps} laps`
                  : isHelicopter
                    ? `${selectedTime.mins} mins`
                    : `${activity.duration} min`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary-400" />
              <span className="text-sm text-dark-300">Age {activity.minAge}+</span>
            </div>
          </div>
        </motion.div>

        {/* Lap Selection (for Go-Karting only) */}
        {isGoKarting && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card p-5 mb-4"
          >
            <h2 className="text-base font-display font-bold text-white mb-3 flex items-center gap-2">
              <span className="text-xl">🏁</span> Select Laps
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {lapOptions.map((option) => (
                <motion.button
                  key={option.laps}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSelectedLaps(option)}
                  className={`p-3 rounded-xl border-2 transition-all ${
                    selectedLaps.laps === option.laps
                      ? 'border-primary-500 bg-primary-500/20 shadow-glow-primary'
                      : 'border-dark-700 bg-dark-800/50 hover:border-dark-600'
                  }`}
                >
                  <span
                    className={`text-lg font-bold block ${
                      selectedLaps.laps === option.laps ? 'text-primary-400' : 'text-white'
                    }`}
                  >
                    {option.laps}
                  </span>
                  <span className="text-xs text-dark-400">laps</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Duration Selection (for Helicopter) */}
        {isHelicopter && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card p-5 mb-4"
          >
            <h2 className="text-base font-display font-bold text-white mb-3 flex items-center gap-2">
              <span className="text-xl">🚁</span> Select Duration
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {timeOptions.map((option) => (
                <motion.button
                  key={option.mins}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSelectedTime(option)}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    selectedTime.mins === option.mins
                      ? 'border-primary-500 bg-primary-500/20 shadow-glow-primary'
                      : 'border-dark-700 bg-dark-800/50 hover:border-dark-600'
                  }`}
                >
                  <span
                    className={`text-2xl font-bold block ${selectedTime.mins === option.mins ? 'text-primary-400' : 'text-white'}`}
                  >
                    {option.mins}
                  </span>
                  <span className="text-sm text-dark-400">minutes</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Instructions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card p-5 mb-4"
        >
          <h2 className="text-base font-display font-bold text-white mb-3 flex items-center gap-2">
            <Info className="w-5 h-5 text-primary-400" /> Instructions
          </h2>
          <ul className="space-y-2">
            {instructions.map((instruction, idx) => (
              <li key={idx} className="flex items-start gap-3 text-sm text-dark-300">
                <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                {instruction}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Safety Points */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-card p-5 mb-20"
        >
          <h2 className="text-base font-display font-bold text-white mb-3 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-secondary-400" /> Safety Guidelines
          </h2>
          <ul className="space-y-2">
            {safetyPoints.map((point, idx) => (
              <li key={idx} className="flex items-start gap-3 text-sm text-dark-300">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                {point}
              </li>
            ))}
          </ul>
        </motion.div>
      </div>

      {/* Fixed Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-dark-950 via-dark-950 to-transparent">
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleBookNow}
          className="w-full btn-primary flex items-center justify-center gap-2 py-4 text-lg"
        >
          Book Now • {formatCurrency(calculatedPrice)}
        </motion.button>
      </div>
    </div>
  )
}
