import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  MapPin,
  ChevronDown,
  Crown,
  Gift,
  Check,
  ShoppingCart,
  X,
  Ticket,
  Sparkles,
  Loader2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useBooking } from '../contexts/BookingContext'
import { useCart } from '../contexts/CartContext'
import { couponService, type Coupon } from '../services/couponService'
import logo from '../assets/logo.webp'
import { logger } from '../lib/logger'

/**
 * HeaderLogo - Top row with logo and location selector
 * Scrolls away naturally (no sticky)
 */
export function HeaderLogo() {
  const { selectedLocation, setLocation, locations, fetchLocations } = useBooking()
  const [showLocationDropdown, setShowLocationDropdown] = useState(false)

  const handleLocationClick = async () => {
    if (!showLocationDropdown) {
      await fetchLocations()
    }
    setShowLocationDropdown(!showLocationDropdown)
  }

  const currentLocation = locations.find((loc) => loc.id === selectedLocation)

  return (
    <div className="relative z-[9998] bg-black/30 backdrop-blur-md px-4 py-3 flex items-center justify-between lg:hidden">
      {/* Logo */}
      <img src={logo} alt="A Square" className="h-10" />

      {/* Location Button */}
      <button
        onClick={handleLocationClick}
        className="flex items-center gap-2 px-3 py-2 bg-white/5 rounded-full text-white text-sm"
      >
        <MapPin className="w-4 h-4 text-blue-500" />
        <span>{currentLocation?.name || 'Set Location'}</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${showLocationDropdown ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Location Dropdown Portal */}
      {showLocationDropdown &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[100] bg-black/50"
              onClick={() => setShowLocationDropdown(false)}
            />
            <div className="fixed top-16 right-4 w-72 bg-dark-700 rounded-2xl shadow-xl z-[101] p-2">
              <p className="px-3 py-2 text-xs text-gray-500 uppercase">Select Branch</p>
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => {
                    setLocation(loc.id)
                    setShowLocationDropdown(false)
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl ${
                    selectedLocation === loc.id ? 'bg-blue-500/20' : 'hover:bg-white/5'
                  }`}
                >
                  <MapPin className="w-5 h-5 text-blue-500" />
                  <div className="text-left flex-1">
                    <p className="text-white font-medium">{loc.name}</p>
                    <p className="text-xs text-gray-500">{loc.address}</p>
                  </div>
                  {selectedLocation === loc.id && <Check className="w-5 h-5 text-blue-500" />}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}

/**
 * HeaderUser - Profile row that STICKS at top when scrolling
 * Returns a SINGLE div as root - critical for sticky to work
 */
export function HeaderUser() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { itemCount } = useCart()
  const [showOffers, setShowOffers] = useState(false)
  const [offers, setOffers] = useState<Coupon[]>([])
  const [loadingOffers, setLoadingOffers] = useState(false)
  const userName = user?.displayName || user?.email?.split('@')[0] || 'Guest'
  const membershipTier = user?.tier || 'Bronze'

  // Fetch offers (global + user rewards) when modal opens
  useEffect(() => {
    if (showOffers && offers.length === 0) {
      setLoadingOffers(true)
      const fetchAll = async () => {
        const [globalCoupons, userCoupons] = await Promise.all([
          couponService.fetchCoupons(),
          user?.id ? couponService.fetchUserCoupons(user.id) : Promise.resolve([]),
        ])
        // Mark user coupons with userId so we can badge them
        setOffers([...userCoupons, ...globalCoupons])
      }
      fetchAll()
        .catch((err) => logger.error('header.load_offers_failed', err))
        .finally(() => setLoadingOffers(false))
    }
  }, [showOffers, user?.id])

  return (
    <div
      style={{ position: 'sticky', top: 0, zIndex: 9999 }}
      className="bg-black/30 backdrop-blur-md px-4 py-3 flex items-center justify-between border-b border-white/10 lg:hidden"
    >
      {/* Offers Modal Portal */}
      {showOffers &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4"
            onClick={() => setShowOffers(false)}
          >
            <div
              className="w-80 md:w-96 max-h-[70vh] bg-dark-700 rounded-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-blue-500" />
                  <h2 className="text-lg font-bold text-white">Active Offers</h2>
                </div>
                <button
                  onClick={() => setShowOffers(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-3 overflow-y-auto max-h-[50vh]">
                {loadingOffers ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                  </div>
                ) : offers.length === 0 ? (
                  <p className="text-center text-gray-400 py-8">No active offers</p>
                ) : (
                  offers.map((offer, idx) => (
                    <div
                      key={offer.code + idx}
                      className={`p-4 rounded-xl ${offer.userId ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-white/5'}`}
                    >
                      <span
                        className={`text-xs font-bold uppercase ${offer.userId ? 'text-orange-400' : 'text-blue-400'}`}
                      >
                        {offer.userId
                          ? 'Your Reward'
                          : offer.type === 'cashback'
                            ? 'Cashback'
                            : offer.isNewUserOnly
                              ? 'New Users'
                              : 'Special'}
                      </span>
                      <h3 className="text-white font-bold mt-1">
                        {offer.type === 'cashback'
                          ? `₹${offer.discount} Cashback`
                          : offer.isPercentage
                            ? `${offer.discount}% OFF`
                            : `₹${offer.discount} OFF`}
                      </h3>
                      <p className="text-gray-400 text-sm mt-1">{offer.description}</p>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                        <div className="flex items-center gap-2 text-white">
                          <Ticket className="w-4 h-4 text-blue-500" />
                          <span className="font-mono">{offer.code}</span>
                        </div>
                        <button
                          onClick={(e) => {
                            navigator.clipboard.writeText(offer.code)
                            const btn = e.currentTarget
                            btn.textContent = 'COPIED!'
                            btn.classList.add('text-green-400')
                            setTimeout(() => {
                              btn.textContent = 'COPY'
                              btn.classList.remove('text-green-400')
                            }, 1500)
                          }}
                          className="text-blue-400 text-sm font-bold transition-colors"
                        >
                          COPY
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* User Profile */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-white font-medium">
          {userName.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-white text-sm font-medium">{userName}</p>
          <div className="flex items-center gap-1 text-orange-400 text-xs">
            <Crown className="w-3 h-3" />
            <span>{membershipTier} Member</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        {/* Cart */}
        <button onClick={() => navigate('/cart')} className="relative p-2 bg-white/5 rounded-full">
          <ShoppingCart className="w-5 h-5 text-white" />
          {itemCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
              {itemCount > 9 ? '9+' : itemCount}
            </span>
          )}
        </button>

        {/* Offers */}
        <button
          onClick={() => setShowOffers(true)}
          className="flex items-center gap-1 text-blue-400 text-sm"
        >
          <Gift className="w-4 h-4" />
          <span>Offers</span>
        </button>
      </div>
    </div>
  )
}
