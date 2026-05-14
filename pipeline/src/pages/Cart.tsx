import { useState, useRef } from 'react'
import SEO from '../components/SEO'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Tag,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Calendar,
  MapPin,
  Wallet,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../contexts/CartContext'
import { formatCurrency, formatDateLong, getLocationName, getLocalISODate } from '../lib/utils'
import { useBooking } from '../contexts/BookingContext'
import { useAuth } from '../contexts/AuthContext'
import GokartIcon from '../components/GokartIcon'
import VerificationModal from '../components/VerificationModal'
import { formatActivityLabel } from '../lib/format-activity'

export default function Cart() {
  const navigate = useNavigate()
  const dateRef = useRef<HTMLInputElement>(null)
  const { selectedLocation } = useBooking()
  const { user } = useAuth()
  const {
    items,
    updateQuantity,
    removeItem,
    clearCart,
    getTotal,
    getDiscountedTotal,
    applyCoupon,
    removeCoupon,
    appliedCoupon,
    cartDate,
    setCartDate,
  } = useCart()

  const [couponCode, setCouponCode] = useState('')
  const [couponError, setCouponError] = useState('')
  const [couponSuccess, setCouponSuccess] = useState('')
  const [showVerification, setShowVerification] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const subtotal = getTotal()
  const { total: finalAmount, discount, cashback, code: activeCode } = getDiscountedTotal()
  const isEmpty = items.length === 0

  const handleApplyCoupon = () => {
    setCouponError('')
    setCouponSuccess('')

    if (!couponCode.trim()) {
      setCouponError('Please enter a coupon code')
      return
    }

    const result = applyCoupon(couponCode)
    if (result === true) {
      setCouponSuccess(`Coupon ${couponCode} applied successfully!`)
      setCouponCode('')
    } else {
      setCouponError(result)
    }
  }

  const handleRemoveCoupon = () => {
    removeCoupon()
    setCouponSuccess('')
    setCouponError('')
  }

  const handleProceedToCheckout = () => {
    if (!cartDate) {
      document.querySelector('input[type="date"]')?.classList.add('border-red-500')
      return
    }

    // Check if user is logged in and verified
    if (user && user.phone && user.phone.length >= 10) {
      navigate('/checkout')
    } else {
      setShowVerification(true)
    }
  }

  return (
    <div className="min-h-screen pt-8 px-4 md:px-6 lg:px-8 overflow-y-auto overflow-x-hidden lg:max-w-6xl xl:max-w-7xl lg:mx-auto">
      <SEO
        title="Your Cart"
        description="Review your selected activities and proceed to checkout at A Square GoKarting."
        path="/cart"
        noindex
      />
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => navigate(-1)}
          title="Go Back"
          className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex flex-col">
          <h1 className="text-xl md:text-2xl lg:text-3xl font-display font-bold text-white leading-tight">
            My Cart
          </h1>
          <div className="flex items-center gap-1.5 text-primary-400">
            <MapPin className="w-3 h-3" />
            <span className="text-[10px] font-bold uppercase tracking-widest">
              {getLocationName(selectedLocation ?? '')}
            </span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {!isEmpty && (
            <button
              onClick={() => {
                if (showClearConfirm) {
                  clearCart()
                  setShowClearConfirm(false)
                } else {
                  setShowClearConfirm(true)
                  setTimeout(() => setShowClearConfirm(false), 3000)
                }
              }}
              aria-label={showClearConfirm ? 'Confirm clear cart' : 'Clear all items'}
              className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest transition-colors px-3 py-1.5 rounded-lg border ${
                showClearConfirm
                  ? 'text-white bg-red-600 border-red-500 animate-pulse'
                  : 'text-red-500 hover:text-red-400 bg-red-500/10 border-red-500/20'
              }`}
            >
              <Trash2 className="w-3 h-3" />
              {showClearConfirm ? 'Tap to Confirm' : 'Clear All'}
            </button>
          )}
          <div className="bg-primary-500/20 px-3 py-1 rounded-full border border-primary-500/30">
            <span className="text-primary-400 text-sm font-bold">{items.length} Items</span>
          </div>
        </div>
      </div>

      {isEmpty ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center py-16 text-center"
        >
          {/* Racing Illustration */}
          <div className="relative mb-8">
            <div className="w-32 h-32 bg-gradient-to-br from-primary-500/20 to-secondary-500/20 rounded-full flex items-center justify-center">
              <motion.div
                animate={{ rotate: [0, -10, 10, -10, 0] }}
                transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              >
                <ShoppingCart className="w-16 h-16 text-primary-400" />
              </motion.div>
            </div>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.3 }}
              className="absolute -top-2 -right-2 shadow-xl"
            >
              <GokartIcon size="md" />
            </motion.div>
          </div>

          <h2 className="text-2xl font-display font-bold text-white mb-2">Your Cart is Lonely!</h2>
          <p className="text-dark-400 mb-8 max-w-xs mx-auto leading-relaxed">
            No racing adventures yet? Let's fix that and get you on the track!
          </p>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/activities')}
            className="px-8 py-4 bg-gradient-to-r from-primary-600 to-primary-500 text-white rounded-2xl font-bold shadow-lg shadow-primary-500/30 flex items-center gap-2"
          >
            <span>🏁</span>
            Go Racing!
            <ChevronRight className="w-5 h-5" />
          </motion.button>
        </motion.div>
      ) : (
        <div className="space-y-6 lg:grid lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] lg:gap-8 lg:space-y-0">
          {/* Left Column: Cart Items + Date + Coupon */}
          <div className="space-y-6">
            {/* Cart Items List */}
            <div className="bg-dark-800/30 border border-white/5 rounded-2xl overflow-hidden shadow-sm">
              <div className="divide-y divide-white/5">
                <AnimatePresence mode="popLayout">
                  {items.map((item) => (
                    <motion.div
                      key={item.activity.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="p-3.5 md:p-4 lg:p-5 flex items-center justify-between gap-4"
                    >
                      {/* One Line Item Detail */}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-white font-bold text-xs leading-tight">
                          {formatActivityLabel(item.activity)}
                        </h3>
                      </div>

                      <div className="flex items-center gap-4 flex-shrink-0">
                        {/* Quantity */}
                        <div className="flex items-center gap-1.5 bg-dark-900/50 rounded-lg p-0.5 border border-white/10">
                          <button
                            onClick={() => updateQuantity(item.activity.id, item.quantity - 1)}
                            aria-label={`Decrease quantity of ${item.activity.name}`}
                            className="w-6 h-6 flex items-center justify-center rounded bg-dark-800 text-white/50 hover:text-white transition-colors"
                          >
                            <Minus className="w-2.5 h-2.5" />
                          </button>
                          <span
                            className="text-white font-bold text-xs w-4 text-center"
                            aria-label={`Quantity: ${item.quantity}`}
                          >
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.activity.id, item.quantity + 1)}
                            aria-label={`Increase quantity of ${item.activity.name}`}
                            className="w-6 h-6 flex items-center justify-center rounded bg-primary-500 text-white transition-colors"
                          >
                            <Plus className="w-2.5 h-2.5" />
                          </button>
                        </div>

                        {/* Price */}
                        <div className="text-right min-w-[70px]">
                          {item.activity.offerPercent ? (
                            <div className="flex flex-col">
                              <span className="text-[10px] text-dark-500 line-through">
                                ₹{formatCurrency(item.activity.basePrice * item.quantity)}
                              </span>
                              <span className="text-sm font-display font-black text-secondary-400">
                                ₹
                                {formatCurrency(
                                  item.activity.basePrice *
                                    (1 - item.activity.offerPercent / 100) *
                                    item.quantity,
                                )}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm font-display font-black text-secondary-400">
                              {formatCurrency(item.activity.basePrice * item.quantity)}
                            </span>
                          )}
                        </div>

                        {/* Trash */}
                        <button
                          onClick={() => removeItem(item.activity.id)}
                          aria-label={`Remove ${item.activity.name} from cart`}
                          className="text-dark-500 hover:text-red-400 transition-colors p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>

            {/* Date of Visit - Racing Style */}
            <div className="bg-dark-800/50 border border-white/5 rounded-3xl p-5 shadow-xl relative overflow-hidden group">
              {/* Racing Flair Background */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary-500/5 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-primary-500/10 transition-all duration-500" />

              <div className="relative z-10">
                <h3 className="text-white font-bold mb-4 flex items-center gap-2 text-sm">
                  <span className="w-1.5 h-6 bg-primary-500 rounded-full inline-block" />
                  VISIT SCHEDULE <span className="text-red-500">*</span>
                </h3>

                {/* Custom Date Trigger Button */}
                <button
                  onClick={() => dateRef.current?.showPicker()}
                  className={`w-full relative group/btn overflow-hidden rounded-2xl p-4 flex items-center gap-4 transition-all active:scale-[0.98] border-2 ${
                    !cartDate
                      ? 'bg-red-500/5 border-red-500/20'
                      : 'bg-gradient-to-br from-dark-900 to-dark-800 border-white/5 shadow-glow-primary/5'
                  }`}
                >
                  {/* Left Icon Column */}
                  <div className="w-12 h-12 rounded-xl bg-primary-500/10 flex items-center justify-center border border-primary-500/20 group-hover/btn:bg-primary-500/20 transition-colors">
                    <Calendar className="w-6 h-6 text-primary-400" />
                  </div>

                  {/* Date Text */}
                  <div className="text-left flex-1">
                    <p className="text-[10px] font-bold text-dark-400 uppercase tracking-widest mb-0.5">
                      Race Day Selection
                    </p>
                    <h4 className="text-white font-display font-bold text-lg">
                      {formatDateLong(cartDate)}
                    </h4>
                  </div>

                  {/* "Edit" or "Go" Badge */}
                  <div className="bg-dark-900/50 px-3 py-1.5 rounded-lg border border-white/5 flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                    <span className="text-[10px] font-bold text-white uppercase italic">GO</span>
                  </div>

                  {/* Hidden Input Overlay */}
                  <input
                    ref={dateRef}
                    type="date"
                    min={getLocalISODate()}
                    value={cartDate}
                    onChange={(e) => setCartDate(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                </button>

                {/* Checkered Edge - Racing Style Decoration */}
                <div className="mt-4 flex gap-1 opacity-20 overflow-hidden select-none pointer-events-none">
                  {[...Array(20)].map((_, i) => (
                    <div
                      key={i}
                      className={`w-3 h-1.5 ${i % 2 === 0 ? 'bg-white' : 'bg-transparent'}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Coupon Section */}
            <div className="bg-dark-800/50 border border-white/5 rounded-2xl p-4">
              <h3 className="text-white font-bold mb-3 flex items-center gap-2">
                <Tag className="w-4 h-4 text-primary-400" />
                Offers & Coupons
              </h3>

              {activeCode ? (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    <div className="min-w-0">
                      <p className="text-green-400 font-bold text-sm truncate uppercase tracking-wide">
                        {activeCode}
                      </p>
                      <p className="text-green-500/70 text-[10px]">
                        {cashback > 0
                          ? `You will earn ${formatCurrency(cashback)} cashback`
                          : `You saved ${formatCurrency(discount)}`}
                      </p>
                    </div>
                  </div>
                  {appliedCoupon && (
                    <button
                      onClick={handleRemoveCoupon}
                      title="Remove Coupon"
                      className="text-dark-400 hover:text-white transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Enter Coupon Code"
                    className="flex-1 bg-dark-900 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-dark-500 focus:outline-none focus:border-primary-500 transition-colors text-sm"
                  />
                  <button
                    onClick={handleApplyCoupon}
                    className="bg-dark-700 text-white px-4 rounded-xl font-bold hover:bg-dark-600 transition-colors text-sm"
                  >
                    Apply
                  </button>
                </div>
              )}

              {(couponError || couponSuccess) && (
                <p
                  className={`text-xs mt-2 flex items-center gap-1 ${couponError ? 'text-red-400' : 'text-green-400'}`}
                >
                  {couponError ? (
                    <AlertCircle className="w-3 h-3" />
                  ) : (
                    <CheckCircle className="w-3 h-3" />
                  )}
                  {couponError || couponSuccess}
                </p>
              )}
            </div>
          </div>

          {/* Right Column: Bill Details + Proceed (sticky on desktop) */}
          <div className="space-y-6 lg:sticky lg:top-4 lg:self-start">
            {/* Bill Details */}
            <div className="bg-dark-800/50 border border-white/5 rounded-2xl p-4 lg:p-6 xl:p-8">
              <h3 className="text-white font-bold mb-4">Bill Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-dark-300">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-green-400">
                    <span>Discount</span>
                    <span>-{formatCurrency(discount)}</span>
                  </div>
                )}
                {cashback > 0 && (
                  <div className="flex justify-between text-primary-400 font-bold italic animate-pulse">
                    <div className="flex items-center gap-1">
                      <Wallet size={12} />
                      <span>Wallet Cashback</span>
                    </div>
                    <span>+{formatCurrency(cashback)}</span>
                  </div>
                )}
                <div className="border-t border-white/10 pt-3 mt-3 flex justify-between items-center">
                  <span className="text-white font-bold text-base">To Pay</span>
                  <span className="text-white font-bold text-xl">
                    {formatCurrency(finalAmount)}
                  </span>
                </div>
              </div>
            </div>

            {/* Proceed Button */}
            <button
              onClick={handleProceedToCheckout}
              disabled={!cartDate}
              className={`w-full py-4 rounded-xl font-bold shadow-lg transition-all flex flex-col items-center justify-center relative overflow-hidden ${
                !cartDate
                  ? 'bg-dark-800 text-dark-500 cursor-not-allowed opacity-50'
                  : 'bg-gradient-to-r from-primary-600 to-primary-500 text-white shadow-primary-500/30 hover:shadow-primary-500/50 active:scale-[0.98]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span>Proceed to Checkout</span>
                <ChevronRight className="w-5 h-5" />
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Verification Modal */}
      <VerificationModal
        isOpen={showVerification}
        onClose={() => setShowVerification(false)}
        onSuccess={() => {
          setShowVerification(false)
          navigate('/checkout')
        }}
      />
    </div>
  )
}
