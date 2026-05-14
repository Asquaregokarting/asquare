import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Outlet, useLocation, useNavigate, NavLink } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingBag,
  ChevronRight,
  Minus,
  Plus,
  MapPin,
  ChevronDown,
  Check,
  Crown,
  Gift,
  ShoppingCart,
  X,
  Ticket,
  Sparkles,
  Loader2,
} from 'lucide-react'
import { HeaderLogo, HeaderUser } from './Header'
import BottomNav, { navItems } from './BottomNav'
import { useCart } from '../contexts/CartContext'
import { useAuth } from '../contexts/AuthContext'
import { useBooking } from '../contexts/BookingContext'
import { couponService, type Coupon } from '../services/couponService'
import { formatCurrency, vibrate } from '../lib/utils'
import Footer from './Footer'
import logo from '../assets/logo.webp'
import { logger } from '../lib/logger'
import { formatActivityLabel } from '../lib/format-activity'
import OfflineToast from './OfflineToast'

/**
 * DesktopNav - Top navigation bar for desktop (lg+)
 * Absorbs HeaderLogo + HeaderUser + BottomNav roles
 */
function DesktopNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { itemCount } = useCart()
  const { selectedLocation, setLocation, locations, fetchLocations } = useBooking()
  const [showLocationDropdown, setShowLocationDropdown] = useState(false)
  const [showOffers, setShowOffers] = useState(false)
  const [offers, setOffers] = useState<Coupon[]>([])
  const [loadingOffers, setLoadingOffers] = useState(false)

  const userName = user?.displayName || user?.email?.split('@')[0] || 'Guest'
  const membershipTier = user?.tier || 'Bronze'
  const currentLocation = locations.find((loc) => loc.id === selectedLocation)

  const handleLocationClick = async () => {
    if (!showLocationDropdown) {
      await fetchLocations()
    }
    setShowLocationDropdown(!showLocationDropdown)
  }

  useEffect(() => {
    if (showOffers && offers.length === 0) {
      setLoadingOffers(true)
      const fetchAll = async () => {
        const [globalCoupons, userCoupons] = await Promise.all([
          couponService.fetchCoupons(),
          user?.id ? couponService.fetchUserCoupons(user.id) : Promise.resolve([]),
        ])
        setOffers([...userCoupons, ...globalCoupons])
      }
      fetchAll()
        .catch((err) => logger.error('layout.load_offers_failed', err))
        .finally(() => setLoadingOffers(false))
    }
  }, [showOffers, user?.id])

  const displayNavItems = navItems.map((item) => {
    if (item.path === '/profile' && !user) {
      return { ...item, label: 'Login' }
    }
    return item
  })

  return (
    <header className="hidden lg:flex bg-dark-900/80 backdrop-blur-xl border-b border-white/10 z-50 flex-shrink-0">
      <div className="flex items-center justify-between w-full max-w-7xl mx-auto px-8 py-3">
        {/* Left: Logo + Nav Links */}
        <div className="flex items-center gap-8">
          <img
            src={logo}
            alt="A Square"
            className="h-10 cursor-pointer"
            onClick={() => navigate('/activities')}
          />
          <nav className="flex items-center gap-1">
            {displayNavItems.map((item) => {
              const isActive =
                item.path === '/'
                  ? location.pathname === '/'
                  : location.pathname === item.path || location.pathname.startsWith(item.path + '/')
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-primary-500/15 text-primary-400'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </nav>
        </div>

        {/* Right: Location + Offers + Cart + User */}
        <div className="flex items-center gap-4">
          {/* Location Selector */}
          <div className="relative">
            <button
              onClick={handleLocationClick}
              className="flex items-center gap-2 px-3 py-2 bg-white/5 rounded-full text-white text-sm hover:bg-white/10 transition-colors"
            >
              <MapPin className="w-4 h-4 text-blue-500" />
              <span>{currentLocation?.name || 'Set Location'}</span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${showLocationDropdown ? 'rotate-180' : ''}`}
              />
            </button>

            {showLocationDropdown && (
              <>
                <div
                  className="fixed inset-0 z-[100]"
                  onClick={() => setShowLocationDropdown(false)}
                />
                <div className="absolute top-full right-0 mt-2 w-72 bg-dark-700 rounded-2xl shadow-xl z-[101] p-2">
                  <p className="px-3 py-2 text-xs text-gray-500 uppercase">Select Branch</p>
                  {locations.map((loc) => (
                    <button
                      key={loc.id}
                      onClick={() => {
                        setLocation(loc.id)
                        setShowLocationDropdown(false)
                      }}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl ${selectedLocation === loc.id ? 'bg-blue-500/20' : 'hover:bg-white/5'}`}
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
              </>
            )}
          </div>

          {/* Offers */}
          <button
            onClick={() => setShowOffers(true)}
            className="flex items-center gap-1.5 text-blue-400 text-sm hover:text-blue-300 transition-colors"
          >
            <Gift className="w-4 h-4" />
            <span>Offers</span>
          </button>

          {/* Cart */}
          <button
            onClick={() => navigate('/cart')}
            className="relative p-2 bg-white/5 rounded-full hover:bg-white/10 transition-colors"
          >
            <ShoppingCart className="w-5 h-5 text-white" />
            {itemCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                {itemCount > 9 ? '9+' : itemCount}
              </span>
            )}
          </button>

          {/* User Avatar */}
          <button
            onClick={() => navigate('/profile')}
            className="flex items-center gap-2 hover:bg-white/5 rounded-xl px-3 py-1.5 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-white font-medium text-sm">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="text-left">
              <p className="text-white text-sm font-medium leading-tight">{userName}</p>
              <div className="flex items-center gap-1 text-orange-400 text-[10px]">
                <Crown className="w-3 h-3" />
                <span>{membershipTier}</span>
              </div>
            </div>
          </button>
        </div>
      </div>
      {/* end max-w-7xl container */}

      {/* Offers Modal Portal */}
      {showOffers &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4"
            onClick={() => setShowOffers(false)}
          >
            <div
              className="w-96 lg:w-[480px] max-h-[70vh] bg-dark-700 rounded-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-blue-500" />
                  <span className="text-lg font-bold text-white" role="heading" aria-level={2}>
                    Active Offers
                  </span>
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
    </header>
  )
}

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { items, itemCount, updateQuantity, getTotal, getDiscountedTotal } = useCart()

  const { total: finalTotal } = getDiscountedTotal()

  // Reset scroll position on route change
  useEffect(() => {
    const mainElement = document.getElementById('main-scroll')
    if (mainElement) {
      mainElement.scrollTop = 0
    }
  }, [location.pathname])

  const showCartButton =
    itemCount > 0 && location.pathname !== '/cart' && location.pathname !== '/checkout'

  return (
    <div className="h-screen bg-transparent flex flex-col relative">
      {/* Aurora Background */}
      <div className="bg-aurora" />

      {/* Global offline indicator */}
      <OfflineToast />

      {/* Desktop Top Navigation - hidden on mobile */}
      <DesktopNav />

      {/* Main content area - explicit height for sticky to work */}
      <main id="main-scroll" className="z-10 flex-1 overflow-y-auto">
        {/* HeaderLogo at the very top - scrolls away (mobile only) */}
        {location.pathname !== '/cart' && location.pathname !== '/checkout' && <HeaderLogo />}

        {/* HeaderUser - STICKY at top when scrolling (mobile only) */}
        {location.pathname !== '/cart' && location.pathname !== '/checkout' && <HeaderUser />}

        {/* Content — pb-24 on mobile ensures the fixed BottomNav never occludes the last
         *           row of a page; desktop has no bottom nav so padding is stripped at lg. */}
        <div
          className={`pb-24 lg:pb-0 ${
            location.pathname === '/activities' ? '-mt-[116px] lg:mt-0' : ''
          }`}
        >
          <Outlet />
        </div>

        {/* Spacer for floating cart button overlay */}
        {showCartButton && <div className="h-[20rem] md:h-48 lg:h-32" />}

        {/* Footer — pb clears the fixed BottomNav on mobile */}
        <Footer />

        {/* Proceed to Cart Button & Progress Bar */}
        <AnimatePresence>
          {showCartButton && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="fixed bottom-[104px] left-4 right-4 z-40 flex items-end gap-3 md:left-auto md:right-4 md:max-w-sm lg:bottom-8 lg:right-8 lg:max-w-md"
            >
              {/* Mini Cart List */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-dark-900/90 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl max-h-28 w-48 overflow-y-auto no-scrollbar flex-shrink-0"
              >
                <div className="divide-y divide-white/10">
                  {items.map((item) => (
                    <div
                      key={item.activity.id}
                      className="p-2 border-b border-white/5 last:border-0"
                    >
                      <div className="min-w-0 mb-1">
                        <span className="text-[10px] text-white/90 font-bold leading-tight block">
                          {formatActivityLabel(item.activity)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-primary-400">
                          {formatCurrency(item.activity.basePrice * item.quantity)}
                        </span>
                        <div className="flex items-center gap-1.5 bg-dark-800/30 rounded-lg p-0.5 border border-white/5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              updateQuantity(item.activity.id, item.quantity - 1)
                              vibrate(10)
                            }}
                            className="w-4 h-4 flex items-center justify-center rounded bg-dark-700/50 text-white/50 hover:text-white transition-colors"
                          >
                            <Minus className="w-2 h-2" />
                          </button>
                          <span className="text-white font-bold text-[10px] w-3 text-center">
                            {item.quantity}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              updateQuantity(item.activity.id, item.quantity + 1)
                              vibrate(10)
                            }}
                            className="w-4 h-4 flex items-center justify-center rounded bg-primary-500 text-white transition-colors"
                          >
                            <Plus className="w-2 h-2" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>

              <div className="flex-1 flex flex-col gap-2 min-w-0">
                {/* Main Button */}
                <button
                  onClick={() => navigate('/cart')}
                  className="w-full bg-primary-500 text-white rounded-2xl p-3 shadow-[0_8px_30px_rgb(0,102,255,0.4)] flex items-center justify-between group overflow-hidden relative"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />

                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                      <ShoppingBag className="w-5 h-5 text-white" />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div className="flex flex-col items-end leading-tight">
                      {getTotal() !== finalTotal && (
                        <span className="text-[8px] text-white/60 line-through">₹{getTotal()}</span>
                      )}
                      <span className="text-lg font-display font-black leading-none">
                        ₹{finalTotal}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation - mobile only */}
      <BottomNav />
    </div>
  )
}
