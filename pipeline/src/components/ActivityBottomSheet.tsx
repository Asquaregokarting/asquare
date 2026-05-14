import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Clock, Users, CheckCircle, ShoppingCart, Calendar, MapPin } from 'lucide-react'
import { useCart } from '../contexts/CartContext'
import { formatCurrency, vibrate } from '../lib/utils'
import { fmtDateIST } from '../lib/date-format'
import type { Activity } from '../types'
import { branchIdToDisplayName } from '../lib/locations'
import GokartIcon from './GokartIcon'

const DEFAULT_IMAGE = 'https://asquaregokarting.com/admin_secure/images/games/gokarting%201x1.jpg'

interface ActivityBottomSheetProps {
  activity: Activity
  isOpen: boolean
  onClose: () => void
}

export default function ActivityBottomSheet({
  activity,
  isOpen,
  onClose,
}: ActivityBottomSheetProps) {
  const { addItem: addToGlobalCart } = useCart()

  const isGoKarting = activity.category === 'gokarting' || !!activity.variants
  type ActivityVariant = NonNullable<Activity['variants']>[number]

  const fallbackVariants: ActivityVariant[] = [
    { laps: 8, price: activity.basePrice, apiId: activity.apiId || activity.id },
    { laps: 12, price: Math.round(activity.basePrice * 1.4), apiId: activity.apiId || activity.id },
    { laps: 15, price: Math.round(activity.basePrice * 1.7), apiId: activity.apiId || activity.id },
  ]

  // Use dynamic variants only when the list is non-empty
  const variants: ActivityVariant[] =
    activity.variants && activity.variants.length > 0 ? activity.variants : fallbackVariants
  const [selectedVariant, setSelectedVariant] = useState<ActivityVariant>(
    variants[0] ?? fallbackVariants[0],
  )
  const [cartItems, setCartItems] = useState<
    { laps: number; quantity: number; pricePerUnit: number; apiId: string }[]
  >([])
  const [quantity, setQuantity] = useState(1)
  const [isSuccess, setIsSuccess] = useState(false)

  // Get cart count for a specific lap option
  const getCartCount = (laps: number) => {
    const item = cartItems.find((i) => i.laps === laps)
    return item ? item.quantity : 0
  }

  // Add to cart for selected lap option
  const handleAddToCart = (variant: ActivityVariant) => {
    vibrate(10)
    setSelectedVariant(variant)
    setCartItems((prev) => {
      const existing = prev.find((i) => i.laps === variant.laps)
      if (existing) {
        return prev.map((i) => (i.laps === variant.laps ? { ...i, quantity: i.quantity + 1 } : i))
      }
      return [
        ...prev,
        { laps: variant.laps, quantity: 1, pricePerUnit: variant.price, apiId: variant.apiId },
      ]
    })
  }

  // Update quantity for an item already in cart
  const handleUpdateQuantity = (laps: number, delta: number) => {
    vibrate(10)
    setCartItems((prev) => {
      return prev
        .map((i) => {
          if (i.laps === laps) {
            const newQuantity = i.quantity + delta
            return newQuantity > 0 ? { ...i, quantity: newQuantity } : null
          }
          return i
        })
        .filter((i): i is (typeof cartItems)[0] => i !== null)
    })
  }

  // Calculate total price from cart
  const totalPrice = cartItems.reduce((sum, item) => sum + item.pricePerUnit * item.quantity, 0)
  const handleProceedToBooking = () => {
    vibrate(20)
    // Add all cart items to booking
    cartItems.forEach((item) => {
      const variantActivity = {
        ...activity,
        id: `${activity.id}-${item.laps}`,
        apiId: item.apiId,
        basePrice: item.pricePerUnit,
        name: `${activity.name} (${item.laps} Laps)`,
      }
      // Add to global cart instead of navigate
      addToGlobalCart(variantActivity, item.quantity)

      // GTM Ecommerce Tracking: add_to_cart
      if (typeof window !== 'undefined' && window.dataLayer) {
        window.dataLayer.push({
          event: 'add_to_cart',
          ecommerce: {
            currency: 'INR',
            value: item.pricePerUnit * item.quantity,
            items: [
              {
                item_id: variantActivity.id,
                item_name: variantActivity.name,
                item_category: activity.category,
                price: variantActivity.basePrice,
                quantity: item.quantity,
              },
            ],
          },
        })
      }
    })

    setIsSuccess(true)
    setTimeout(() => {
      setIsSuccess(false)
      onClose()
    }, 1500)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Bottom Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-16 left-0 right-0 bg-dark-900 rounded-t-3xl z-50 max-h-[92vh] overflow-y-auto no-scrollbar shadow-[0_-10px_50px_rgba(0,0,0,0.5)] md:inset-0 md:m-auto md:w-[520px] md:max-w-[90vw] md:h-fit md:rounded-3xl md:max-h-[85vh] lg:w-[620px] xl:w-[680px]"
          >
            {/* Transparent Close Button */}
            <div className="flex justify-end p-4 sticky top-0 right-0 z-30 pointer-events-none">
              <button
                onClick={onClose}
                className="pointer-events-auto text-white/60 hover:text-white transition-all duration-300"
                title="Close"
              >
                <X className="w-8 h-8 drop-shadow-lg" />
              </button>
            </div>

            {/* Content Wrapper */}
            <div className="pb-8 -mt-12">
              {/* Header Image */}
              <div className="relative h-40 md:h-48 lg:h-56 overflow-hidden mb-3">
                <img
                  src={activity.image || DEFAULT_IMAGE}
                  alt={activity.name}
                  loading="lazy"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.src = DEFAULT_IMAGE
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-dark-900/80 to-transparent" />

                {/* Activity Icon (Branded logo for all activities) */}
                <div className="absolute bottom-3 left-3 shadow-lg shadow-black/30">
                  <GokartIcon size="lg" />
                </div>
              </div>

              {/* Activity Info */}
              <div className="px-4 md:px-6 mb-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h2 className="text-lg md:text-xl font-display font-bold text-white">
                      {activity.name}
                    </h2>
                    <p className="text-dark-300 text-[11px] md:text-xs">{activity.description}</p>
                    {activity.longDescription && (
                      <p className="text-dark-300 text-xs md:text-sm mt-2 whitespace-pre-line leading-relaxed">
                        {activity.longDescription}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-display font-bold text-secondary-400">
                      {formatCurrency(activity.basePrice)}
                    </span>
                    {isGoKarting && <p className="text-xs text-dark-400">starting price</p>}
                  </div>
                </div>

                {/* Quick Info */}
                <div className="flex gap-4 pt-2 border-t border-white/10">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary-400" />
                    <span className="text-sm text-dark-300">
                      {isGoKarting ? `${selectedVariant.laps} laps` : `${activity.duration} min`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary-400" />
                    <span className="text-sm text-dark-300">Age {activity.minAge}+</span>
                  </div>
                </div>

                {/* Availability Info */}
                {(activity.startDate ||
                  activity.endDate ||
                  (activity.locationIds && activity.locationIds.length > 0)) && (
                  <div className="flex flex-col gap-2 pt-2 border-t border-white/10 mt-2">
                    {(activity.startDate || activity.endDate) && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-primary-400" />
                        <span className="text-sm text-dark-300">
                          {activity.startDate
                            ? `From ${fmtDateIST(activity.startDate)}`
                            : 'Available'}
                          {activity.endDate ? ` until ${fmtDateIST(activity.endDate)}` : ''}
                        </span>
                      </div>
                    )}
                    {activity.locationIds && activity.locationIds.length > 0 && (
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-primary-400" />
                        <span className="text-sm text-dark-300">
                          Available at:{' '}
                          {activity.locationIds.map((id) => branchIdToDisplayName(id)).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Variant Selection (Go-Karting & Helicopter) */}
              {isGoKarting && (
                <div className="px-4 md:px-6 mb-4">
                  <h3 className="text-sm md:text-base font-display font-bold text-white mb-2 flex items-center gap-2">
                    <span>{activity.category === 'Helicopter' ? '🚁' : '🏁'}</span>
                    {activity.category === 'Helicopter' ? 'Select Duration' : 'Select Laps'}
                  </h3>
                  <div className="grid grid-cols-3 gap-2 md:gap-3">
                    {variants.map((option) => {
                      const cartCount = getCartCount(option.laps)
                      return (
                        <motion.button
                          key={option.laps}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleAddToCart(option)}
                          className={`relative p-2.5 lg:p-3.5 rounded-xl border-2 transition-all ${
                            selectedVariant.laps === option.laps
                              ? 'border-primary-500 bg-primary-500/20 shadow-glow-primary'
                              : 'border-dark-700 bg-dark-800/50'
                          }`}
                        >
                          {/* Cart Count Badge */}
                          {cartCount > 0 && (
                            <div className="absolute top-1 right-1 bg-primary-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tighter whitespace-nowrap z-20">
                              {cartCount} IN CART
                            </div>
                          )}
                          <span
                            className={`text-sm font-bold block ${
                              selectedVariant.laps === option.laps
                                ? 'text-primary-400'
                                : 'text-white'
                            }`}
                          >
                            {option.laps}
                          </span>
                          <span className="text-[10px] text-dark-400">
                            {activity.category === 'Helicopter' ? 'mins' : 'laps'}
                          </span>
                        </motion.button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Terms & Conditions */}
              {activity.terms && activity.terms.length > 0 && (
                <div className="px-4 mb-4 pt-4 border-t border-white/10">
                  <h3 className="font-display font-bold text-white mb-2 text-sm">
                    Terms & Conditions
                  </h3>
                  <ul className="list-disc list-inside space-y-1 text-dark-300 text-xs">
                    {activity.terms.map((term, index) => (
                      <li key={index}>{term}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Safety Instructions */}
              {activity.safetyInstructions && activity.safetyInstructions.length > 0 && (
                <div className="px-4 mb-4 pt-4 border-t border-white/10">
                  <h3 className="font-display font-bold text-white mb-2 text-sm">
                    Safety Instructions
                  </h3>
                  <ul className="list-disc list-inside space-y-1 text-dark-300 text-xs">
                    {activity.safetyInstructions.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* CTA Section - GoKarting */}
            {isGoKarting && cartItems.length > 0 && (
              <div className="sticky bottom-0 left-0 right-0 px-4 pb-8 pt-4 bg-dark-900/90 backdrop-blur-xl border-t border-white/10 z-40">
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mb-3 bg-dark-800/80 backdrop-blur-md rounded-xl border border-white/10 overflow-hidden"
                >
                  <div className="p-3 space-y-2">
                    {cartItems.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center text-sm">
                        <span className="text-dark-300">
                          {item.laps} {activity.category === 'Helicopter' ? 'mins' : 'laps'} ×{' '}
                          {item.quantity}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-white font-bold">
                            {formatCurrency(item.pricePerUnit * item.quantity)}
                          </span>
                          <div className="flex items-center gap-1 bg-dark-700/50 rounded-lg p-0.5 border border-white/5">
                            <motion.button
                              whileTap={{ scale: 0.9 }}
                              onClick={() => handleUpdateQuantity(item.laps, -1)}
                              className="w-6 h-6 flex items-center justify-center bg-dark-600 hover:bg-dark-500 rounded-md text-white transition-colors"
                            >
                              -
                            </motion.button>
                            <motion.button
                              whileTap={{ scale: 0.9 }}
                              onClick={() => handleUpdateQuantity(item.laps, 1)}
                              className="w-6 h-6 flex items-center justify-center bg-primary-500 hover:bg-primary-600 rounded-md text-white transition-colors"
                            >
                              +
                            </motion.button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>

                <div className="flex gap-2">
                  <div className="flex items-center bg-dark-700/80 backdrop-blur-sm px-4 rounded-xl border border-white/5">
                    <div>
                      <p className="text-[10px] text-dark-400 uppercase font-black tracking-wider">
                        Total
                      </p>
                      <p className="text-lg font-bold text-white">{formatCurrency(totalPrice)}</p>
                    </div>
                  </div>

                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={handleProceedToBooking}
                    disabled={isSuccess}
                    className={`btn-primary py-3.5 text-base flex-1 shadow-glow-primary transition-all duration-300 ${
                      isSuccess ? 'bg-green-500 from-green-600 to-green-500 shadow-glow-green' : ''
                    }`}
                  >
                    <AnimatePresence mode="wait">
                      {isSuccess ? (
                        <motion.div
                          key="success"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="flex items-center justify-center gap-2"
                        >
                          <CheckCircle className="w-5 h-5" />
                          Added to Cart!
                        </motion.div>
                      ) : (
                        <motion.div
                          key="cart"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex items-center justify-center gap-2"
                        >
                          <ShoppingCart className="w-5 h-5" />
                          Add to Cart
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </div>
              </div>
            )}

            {/* CTA Section - Non-GoKarting */}
            {!isGoKarting && (
              <div className="sticky bottom-0 left-0 right-0 px-4 pb-8 pt-4 bg-dark-900/90 backdrop-blur-xl border-t border-white/10 z-40">
                <div className="flex items-center gap-3">
                  {/* Quantity Selector */}
                  <div className="flex items-center bg-dark-800 rounded-xl border border-white/10">
                    <button
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="w-10 h-10 flex items-center justify-center text-white hover:bg-dark-700 rounded-l-xl"
                      aria-label="Decrease quantity"
                    >
                      -
                    </button>
                    <span className="w-10 text-center text-white font-bold">{quantity}</span>
                    <button
                      onClick={() => setQuantity(quantity + 1)}
                      className="w-10 h-10 flex items-center justify-center text-white hover:bg-dark-700 rounded-r-xl"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>

                  {/* Add to Cart Button */}
                  <button
                    onClick={() => {
                      vibrate(20)
                      addToGlobalCart(activity, quantity)

                      // GTM Ecommerce Tracking: add_to_cart
                      if (typeof window !== 'undefined' && window.dataLayer) {
                        window.dataLayer.push({
                          event: 'add_to_cart',
                          ecommerce: {
                            currency: 'INR',
                            value: activity.basePrice * quantity,
                            items: [
                              {
                                item_id: activity.id,
                                item_name: activity.name,
                                item_category: activity.category,
                                price: activity.basePrice,
                                quantity: quantity,
                              },
                            ],
                          },
                        })
                      }

                      onClose()
                    }}
                    className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-primary-500/30"
                  >
                    <ShoppingCart className="w-5 h-5" />
                    Add to Cart • {formatCurrency(activity.basePrice * quantity)}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
