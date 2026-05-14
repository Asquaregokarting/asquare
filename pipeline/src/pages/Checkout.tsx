import { useState, useEffect, useRef } from 'react'
import SEO from '../components/SEO'
import { couponService } from '../services/couponService'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  CreditCard,
  Smartphone,
  Building2,
  CheckCircle,
  Shield,
  Loader,
  Wallet,
  XCircle,
  AlertCircle,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ApplicationError, PaymentError, ValidationError, NetworkError } from '../types/errors'
import { useCart } from '../contexts/CartContext'
import { useAuth } from '../contexts/AuthContext'
import { useGames } from '../contexts/GamesContext'
import { useBooking } from '../contexts/BookingContext'
import {
  bookingService,
  ensureUniqueOrderNumber,
  submitOrderToAPI,
  createRazorpayOrder,
  BRANCH_MAP,
} from '../services/bookingService'
import { formatCurrency } from '../lib/utils'
import { walletService } from '../services/walletService'
import ProfileGate from '../components/ProfileGate'

import OfflineToast from '../components/OfflineToast'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { logger } from '../lib/logger'
import { formatActivityDisplay } from '../lib/format-activity'

interface PaymentOption {
  id: string
  name: string
  icon: React.ReactNode
  description: string
  popular?: boolean
  comingSoon?: boolean
}

export default function Checkout() {
  const navigate = useNavigate()
  const { user, updateUserProfile } = useAuth()
  const { earnSpin } = useGames()
  const { selectedLocation } = useBooking()
  const {
    items,
    getTotal,
    getDiscountedTotal,
    clearCart,
    appliedCoupon,
    removeCoupon,
    setIsUsingWallet,
    hasGokartingActivity,
  } = useCart()
  const { isOnline } = useOnlineStatus()

  // Split payment: wallet toggle + online payment method
  const [useWallet, setUseWallet] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const paymentInFlight = useRef(false) // Prevents duplicate submissions
  // Idempotency token — one per attempted checkout. Survives retries (so
  // server-side dedup catches a second write) and is reset after success.
  const clientRequestIdRef = useRef<string | null>(null)
  const [showProfileGate, setShowProfileGate] = useState(false)

  const [statusModal, setStatusModal] = useState<{
    show: boolean
    type: 'processing' | 'failed' | 'delayed'
    message: string
  }>({ show: false, type: 'processing', message: '' })
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [confirmedOrderNumber, setConfirmedOrderNumber] = useState<string | null>(null)

  const subtotal = getTotal()
  const { total: finalAmount, discount, cashback } = getDiscountedTotal()

  const walletBalance = user?.walletBalance || 0

  // Calculate amounts for split payment
  const walletAmountToUse = useWallet ? Math.min(walletBalance, finalAmount) : 0
  const remainingAmount = finalAmount - walletAmountToUse

  // When wallet toggle changes, update the cart context for coupon/cashback restriction
  useEffect(() => {
    setIsUsingWallet(useWallet)
    // If enabling wallet, remove any applied coupon since they can't be combined
    if (useWallet && appliedCoupon) {
      removeCoupon()
    }
  }, [useWallet, appliedCoupon, removeCoupon, setIsUsingWallet])

  // Reset wallet mode when leaving checkout
  useEffect(() => {
    return () => {
      setIsUsingWallet(false)
    }
  }, [setIsUsingWallet])

  const handleProfileComplete = async (data: { phone: string; email: string }) => {
    try {
      await updateUserProfile({ phone: data.phone, email: data.email })
      setShowProfileGate(false)
    } catch (error) {
      logger.error('checkout.update_profile_failed', error)
    }
  }

  const paymentOptions: PaymentOption[] = [
    {
      id: 'upi',
      name: 'UPI',
      icon: <Smartphone className="w-6 h-6" />,
      description: 'Pay using GPay, PhonePe, Paytm',
      popular: true,
    },
    {
      id: 'card',
      name: 'Credit/Debit Card',
      icon: <CreditCard className="w-6 h-6" />,
      description: 'Visa, Mastercard, Rupay',
    },
    {
      id: 'netbanking',
      name: 'Net Banking',
      icon: <Building2 className="w-6 h-6" />,
      description: 'All major banks supported',
    },
  ]

  // Redirect if cart empty
  useEffect(() => {
    if (items.length === 0 && !paymentSuccess) {
      navigate('/cart')
    }
  }, [items, paymentSuccess, navigate])

  // GTM Ecommerce Tracking: begin_checkout
  useEffect(() => {
    if (items.length > 0 && !paymentSuccess) {
      if (typeof window !== 'undefined' && window.dataLayer) {
        window.dataLayer.push({
          event: 'begin_checkout',
          ecommerce: {
            currency: 'INR',
            value: finalAmount,
            items: items.map((item) => ({
              item_id: item.activity.id,
              item_name: item.activity.name,
              item_category: item.activity.category,
              price: item.activity.offerPercent
                ? Math.round(item.activity.basePrice * (1 - item.activity.offerPercent / 100))
                : item.activity.basePrice,
              quantity: item.quantity,
            })),
          },
        })
      }
    }
  }, [items, finalAmount, paymentSuccess])

  if (items.length === 0 && !paymentSuccess) {
    return null
  }

  const handlePayment = async () => {
    // Prevent duplicate submissions (ref guard is synchronous, unlike setState)
    if (paymentInFlight.current) return
    paymentInFlight.current = true

    // Tracks whether the wallet was actually debited in THIS attempt. The auto-
    // refund catches below only fire when this is true — otherwise a failed
    // deduction followed by a catch would credit money that was never taken.
    // See: multi-tab race where deductBalance returns false and the catch path
    // still ran addBalance, creating free wallet credit.
    let walletWasDebited = false

    // If user is not logged in, show feedback then redirect
    if (!user) {
      paymentInFlight.current = false
      setStatusModal({
        show: true,
        type: 'failed',
        message: 'Please log in to complete your booking',
      })
      setTimeout(() => navigate('/activities'), 2000)
      return
    }

    // Block locked customers from making bookings
    if (user.locked) {
      paymentInFlight.current = false
      setStatusModal({
        show: true,
        type: 'failed',
        message: 'Your account is restricted. Please contact support.',
      })
      return
    }

    // If there's remaining amount after wallet, must select a payment method
    if (remainingAmount > 0 && !selectedPayment) {
      paymentInFlight.current = false
      return
    }
    setProcessing(true)
    setStatusModal({
      show: true,
      type: 'processing',
      message: remainingAmount === 0 ? 'Processing wallet payment...' : 'Validating order...',
    })

    const orderNumber = await ensureUniqueOrderNumber()

    setConfirmedOrderNumber(orderNumber)

    // Prepare items and parameters for both API and Local creation
    const bookingItems = items.map((item) => {
      const unitPrice = item.activity.offerPercent
        ? Math.round(item.activity.basePrice * (1 - item.activity.offerPercent / 100))
        : item.activity.basePrice

      return {
        activity: item.activity,
        quantity: item.quantity,
        duration: item.activity.duration || 10,
        date: item.date,
        timeSlot: item.timeSlot || 'Flexible',
        price: unitPrice * item.quantity,
      }
    })

    const discountPercent = subtotal > 0 ? Math.round((discount / subtotal) * 100) : 0
    const billingId = bookingService.generateBillingId()

    const currentLocation = selectedLocation ?? ''
    const locationName = BRANCH_MAP[currentLocation] || currentLocation

    // Generate a high-entropy random name (1 in 1,000,000 chance of collision)
    const randomDigits = Math.floor(100000 + Math.random() * 900000)
    const defaultName = user.displayName || `Racer${randomDigits}`

    // Determine payment method string
    let paymentMethodStr = 'online'
    if (useWallet && remainingAmount === 0) {
      paymentMethodStr = 'wallet'
    } else if (useWallet && remainingAmount > 0) {
      paymentMethodStr = `wallet+${selectedPayment}`
    } else if (finalAmount === 0) {
      paymentMethodStr = 'free'
    } else {
      paymentMethodStr = selectedPayment || 'online'
    }

    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `cri_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    }

    const bookingParams = {
      userId: user.id,
      locationId: locationName,
      branchId: currentLocation,
      items: bookingItems,
      totalAmount: subtotal,
      discountAmount: discount,
      finalAmount: finalAmount,
      paymentMethod: paymentMethodStr,
      mobile: user.phone || '',
      name: defaultName,
      email: user.email || 'customer@asquaregokarting.com',
      couponCode: appliedCoupon || '',
      couponAmount: discount,
      walletAmountUsed: walletAmountToUse,
      discountPercent: discountPercent,
      cashbackAmount: cashback || 0,
      clientRequestId: clientRequestIdRef.current,
    }

    try {
      // 1. Create Draft Booking in Firestore (Pending Payment)
      setStatusModal({ show: true, type: 'processing', message: 'Initiating booking...' })
      await bookingService.createDraftBooking(bookingParams, orderNumber)

      // CRITICAL: Submit order to API BEFORE payment gateway
      setStatusModal({ show: true, type: 'processing', message: 'Creating order on server...' })
      const apiResult = await submitOrderToAPI(bookingParams, billingId, orderNumber)
      const apiSuccess = apiResult.status === 'yes' || apiResult.status === 'success'

      if (!apiSuccess && remainingAmount > 0 && selectedPayment) {
        setStatusModal({
          show: true,
          type: 'failed',
          message:
            (apiResult.message as string) ||
            'Failed to initialize payment with server. Please try again.',
        })
        setProcessing(false)
        paymentInFlight.current = false
        return
      }

      if (!apiSuccess) {
        logger.warn('checkout.api_pre_submission_failed')
      }

      // Create Razorpay order with the exact amount going to payment gateway
      let razorpayOrderId = ''
      if (
        remainingAmount > 0 &&
        selectedPayment &&
        ['upi', 'card', 'netbanking'].includes(selectedPayment)
      ) {
        setStatusModal({ show: true, type: 'processing', message: 'Initializing payment...' })
        razorpayOrderId = await createRazorpayOrder({
          amount: remainingAmount,
          orderNumber,
          customerName: user.displayName || 'Guest',
          customerPhone: user.phone || '',
          customerEmail: user.email || '',
        })
        await bookingService.updateBooking(orderNumber, user.id, {
          razorpayOrderId: razorpayOrderId,
        })
      }

      // Handle FREE booking (₹0 total)
      if (finalAmount === 0) {
        setStatusModal({ show: true, type: 'processing', message: 'Finalizing free booking...' })
        // Skip all payment, go straight to booking creation
      }
      // Handle wallet deduction first (if using wallet)
      else if (useWallet && walletAmountToUse > 0) {
        setStatusModal({ show: true, type: 'processing', message: 'Deducting from wallet...' })
        const freshBalance = await walletService.getBalance(user.id)
        if (freshBalance < walletAmountToUse) {
          setStatusModal({ show: true, type: 'failed', message: 'Insufficient wallet balance!' })
          setProcessing(false)
          paymentInFlight.current = false
          return
        }
        const debited = await walletService.deductBalance(
          user.id,
          walletAmountToUse,
          `Booking Payment #${orderNumber}`,
        )
        // deductBalance swallows errors and returns false (insufficient balance,
        // contention with another tab, wallet doc missing). Must abort here —
        // proceeding to Razorpay would let the catch handler credit a refund
        // for a debit that never happened.
        if (!debited) {
          setStatusModal({
            show: true,
            type: 'failed',
            message: 'Wallet payment could not be processed. Please try again.',
          })
          setProcessing(false)
          paymentInFlight.current = false
          return
        }
        walletWasDebited = true
      }

      // Handle remaining payment via Razorpay (if any)
      if (
        remainingAmount > 0 &&
        selectedPayment &&
        ['upi', 'card', 'netbanking'].includes(selectedPayment)
      ) {
        const { razorpayService } = await import('../services/razorpayService')

        try {
          setStatusModal({
            show: true,
            type: 'processing',
            message: `Pay remaining ${formatCurrency(remainingAmount)}...`,
          })

          // Open Razorpay checkout for remaining amount
          const paymentResponse = await razorpayService.initiatePayment({
            amount: Math.round(remainingAmount * 100), // Convert to paise
            name: user.displayName || 'Guest',
            email: user.email || 'customer@asquare.com',
            phone: user.phone || '',
            description: `Booking #${orderNumber}`,
            razorpay_order_id: razorpayOrderId, // Pass the mandatory order_id
            orderNumber: orderNumber, // Include order number in notes for webhook
          })

          setStatusModal({
            show: true,
            type: 'processing',
            message: 'Notifying server of payment...',
          })

          try {
            await bookingService.confirmRazorpayOrder({
              paymentId: paymentResponse.razorpay_payment_id,
              razorpayOrderId: razorpayOrderId,
              razorpaySignature: paymentResponse.razorpay_signature || '',
              orderNumber: orderNumber,
            })
          } catch (confirmErr) {
            logger.error('checkout.notify_server_payment_failed', confirmErr)
          }

          setStatusModal({ show: true, type: 'processing', message: 'Confirming your payment...' })

          // Confirm Booking (Client-side)
          // We skip API submission here because we already did it successfully above
          try {
            await bookingService.confirmDraftBooking(
              orderNumber,
              paymentResponse.razorpay_payment_id,
              apiSuccess,
              paymentResponse.razorpay_signature,
            )
          } catch (confirmError) {
            // Payment was already captured by Razorpay — do NOT refund or cancel.
            // The Razorpay webhook will confirm the booking as a fallback.
            logger.error('checkout.post_payment_confirmation_failed', confirmError)
          }
        } catch (paymentError: unknown) {
          logger.error('checkout.payment_failed', paymentError)

          // Refund wallet ONLY if it was actually debited in this attempt.
          // Previously this ran on the mere intent to use wallet, which
          // allowed multi-tab races to print free credit. Idempotency key
          // ties the refund to the orderNumber so retries (or a concurrent
          // outer-catch firing after this one) can't double-credit.
          if (walletWasDebited) {
            try {
              const refundDesc = `Refund for failed booking #${orderNumber}`
              setStatusModal({ show: true, type: 'processing', message: 'Refunding wallet...' })
              await walletService.addBalance(
                user.id,
                walletAmountToUse,
                refundDesc,
                `refund-${orderNumber}`,
              )
              walletWasDebited = false
            } catch (refundError) {
              logger.error('checkout.wallet_refund_failed', refundError)
            }
          }

          // Always mark booking as failed/cancelled
          try {
            await bookingService.updateBooking(orderNumber, user.id, {
              bookingStatus: 'cancelled',
              paymentStatus: 'failed',
            })
          } catch (updateErr) {
            logger.error('checkout.update_booking_status_failed', updateErr)
          }

          // Trigger payment failed WhatsApp notification
          bookingService
            .triggerPaymentFailedNotification(
              orderNumber,
              user.phone || '',
              user.displayName || 'Customer',
            )
            .catch((err) =>
              logger.error('checkout.trigger_payment_failed_notification_failed', err),
            )

          const errMsg =
            paymentError instanceof Error
              ? paymentError.message
              : 'Payment was cancelled or failed.'
          setStatusModal({ show: true, type: 'failed', message: errMsg })
          setProcessing(false)
          return
        }
      } else {
        // Free or Full Wallet Payment
        // Confirm without payment ID (or use 'wallet'/'free')
        const paymentId = remainingAmount === 0 ? (useWallet ? 'wallet' : 'free') : 'unknown'
        await bookingService.confirmDraftBooking(orderNumber, paymentId, apiSuccess, undefined)
      }

      // Non-blocking: write vendor ledger credits for any event-package items.
      // Uses the unified onBookingPaid hook (also called from the admin and
      // Razorpay-verify paths) so all sources share the same BOGO-correct
      // computation and idempotent deterministic ledger doc IDs.
      try {
        const { onBookingPaidById } = await import('../lib/booking-vendor-payout')
        await onBookingPaidById(orderNumber)
      } catch (ledgerErr) {
        logger.error('checkout.event_package_ledger_failed', ledgerErr)
      }

      setStatusModal({ show: true, type: 'processing', message: 'Finalizing your booking...' })

      // Award spin for first booking
      const existingBookings = await bookingService.getUserBookings(user.id, user.phone)
      if (existingBookings.length <= 1) {
        // 1 because we just created one
        earnSpin(1, 'booking')
      }

      // Mark coupon as used (if applied)
      if (appliedCoupon && user.id) {
        try {
          await couponService.markCouponAsUsed(user.id, appliedCoupon)
        } catch (couponErr) {
          logger.error('checkout.mark_coupon_used_failed', couponErr)
        }
      }

      // Apply Cashback to Wallet (only if not using wallet for this payment).
      //
      // Before crediting, re-read the booking doc and verify it actually
      // reached confirmed+completed state. Previously we credited cashback
      // unconditionally at this point — but `confirmDraftBooking` errors are
      // swallowed on line ~389 (to avoid double-refunding a captured Razorpay
      // payment), so a booking that ended up pending/failed/cancelled could
      // still trigger the cashback credit. The detector flagged 8 wallets
      // credited on cancelled bookings this way; this gate stops new cases.
      if (cashback > 0 && !useWallet) {
        try {
          const confirmed = await bookingService.getBookingById(orderNumber)
          const isConfirmed =
            confirmed?.paymentStatus === 'completed' &&
            (confirmed?.bookingStatus === 'confirmed' || confirmed?.bookingStatus === 'completed')
          if (!isConfirmed) {
            logger.warn('checkout.skip_cashback_booking_not_confirmed', {
              orderNumber,
              paymentStatus: confirmed?.paymentStatus,
              bookingStatus: confirmed?.bookingStatus,
            })
          } else {
            await walletService.addBalance(
              user.id,
              cashback,
              `Cashback for booking #${orderNumber}`,
              `cashback-${orderNumber}`,
            )
          }
        } catch (cashErr) {
          logger.error('checkout.credit_cashback_failed', cashErr)
        }
      }

      // GTM Ecommerce Tracking: purchase
      if (typeof window !== 'undefined' && window.dataLayer) {
        window.dataLayer.push({
          event: 'purchase',
          ecommerce: {
            transaction_id: orderNumber,
            value: finalAmount,
            currency: 'INR',
            coupon: appliedCoupon || undefined,
            items: items.map((item) => ({
              item_id: item.activity.id,
              item_name: item.activity.name,
              item_category: item.activity.category,
              price: item.activity.offerPercent
                ? Math.round(item.activity.basePrice * (1 - item.activity.offerPercent / 100))
                : item.activity.basePrice,
              quantity: item.quantity,
            })),
          },
        })
      }

      setProcessing(false)
      paymentInFlight.current = false
      // Sale wrote successfully — drop the idempotency token so a re-checkout
      // (e.g. user backs out and rebuilds their cart) gets a fresh one.
      clientRequestIdRef.current = null
      setStatusModal({ show: false, type: 'processing', message: '' })
      setPaymentSuccess(true)

      // Clear cart and redirect after success
      setTimeout(() => {
        clearCart()
        navigate('/bookings')
      }, 2500)
    } catch (error) {
      logger.error('checkout.process_failed', error)
      setProcessing(false)
      paymentInFlight.current = false

      // Refund wallet ONLY if it was actually debited in this attempt.
      // `walletWasDebited` is cleared by the inner catch after a successful
      // refund so we never double-credit here. Idempotency key ties the
      // refund to the orderNumber as belt-and-suspenders in case both the
      // inner and outer catch somehow fire for the same attempt.
      if (walletWasDebited) {
        try {
          setStatusModal({ show: true, type: 'processing', message: 'Refunding wallet...' })
          await walletService.addBalance(
            user.id,
            walletAmountToUse,
            `Auto-refund: booking #${orderNumber} failed`,
            `refund-${orderNumber}`,
          )
          walletWasDebited = false
        } catch (refundErr) {
          logger.error('checkout.outer_wallet_refund_failed', {
            error: refundErr,
            orderNumber,
            walletAmountToUse,
            context: 'Wallet was deducted but refund failed — requires manual credit',
          })
        }
      }

      // Trigger payment failed WhatsApp notification (skip for cancellations/validation errors)
      const isCancellation = error instanceof Error && error.message.includes('cancelled')
      const isValidation = error instanceof ValidationError
      if (!isCancellation && !isValidation && orderNumber) {
        bookingService
          .triggerPaymentFailedNotification(
            orderNumber,
            user.phone || '',
            user.displayName || 'Customer',
          )
          .catch((err) => logger.error('checkout.trigger_payment_failed_notification_failed', err))
      }

      let errorMessage = 'Something went wrong during booking. Please check your internet.'

      if (error instanceof ValidationError) {
        errorMessage = error.message
      } else if (error instanceof PaymentError) {
        errorMessage = `Payment error: ${error.message}`
      } else if (error instanceof NetworkError) {
        errorMessage = 'Network connection issue. Please check your internet and try again.'
      } else if (error instanceof ApplicationError) {
        errorMessage = error.message
      } else if (error instanceof Error) {
        if (error.message.includes('cancelled')) {
          errorMessage = 'Payment was cancelled. You can try again when ready.'
        }
      }

      setStatusModal({
        show: true,
        type: 'failed',
        message: errorMessage,
      })
    }
  }

  if (paymentSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mb-6"
        >
          <CheckCircle className="w-12 h-12 text-green-400" />
        </motion.div>
        <h1 className="text-3xl font-bold text-white mb-2">Payment Successful!</h1>
        <p className="text-dark-400 mb-8">
          Your order {confirmedOrderNumber} has been confirmed. You will be redirected to your
          bookings page.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen pt-8 px-4 overflow-y-auto lg:max-w-6xl xl:max-w-7xl lg:mx-auto lg:px-8">
      {/* Header */}
      <SEO
        title="Checkout"
        description="Complete your booking payment at A Square GoKarting."
        path="/checkout"
        noindex
      />
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => navigate(-1)}
          title="Go back"
          className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl md:text-2xl font-display font-bold text-white">Checkout</h1>
      </div>

      <div className="space-y-6 lg:grid lg:grid-cols-[1fr,380px] lg:gap-8 lg:space-y-0">
        <div className="space-y-6">
          {/* Order Summary */}
          <div className="bg-dark-800/50 border border-white/5 rounded-2xl p-4">
            <h3 className="text-lg font-bold text-white mb-3">Summary</h3>
            <div className="space-y-4">
              {items.map((item) => {
                const itemPrice =
                  (item.activity.offerPercent
                    ? Math.round(item.activity.basePrice * (1 - item.activity.offerPercent / 100))
                    : item.activity.basePrice) * item.quantity
                return (
                  <div key={item.activity.id} className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-white">
                        {formatActivityDisplay(item.activity, item.quantity)}
                      </span>
                    </div>
                    <span
                      className={`font-bold ${itemPrice === 0 ? 'text-green-400' : 'text-white'}`}
                    >
                      {itemPrice === 0 ? 'FREE' : formatCurrency(itemPrice)}
                    </span>
                  </div>
                )
              })}
              <div className="border-t border-white/10 pt-3 flex justify-between items-center">
                <span className="text-dark-300">Subtotal</span>
                <span className="text-white">
                  {subtotal === 0 ? 'FREE' : formatCurrency(subtotal)}
                </span>
              </div>
              {discount > 0 && !useWallet && (
                <div className="flex justify-between items-center text-green-400">
                  <span>Discount</span>
                  <span>-{formatCurrency(discount)}</span>
                </div>
              )}
              {cashback > 0 && !useWallet && (
                <div className="flex justify-between items-center text-primary-400 animate-pulse">
                  <div className="flex items-center gap-1">
                    <Wallet size={14} />
                    <span>Cashback (to wallet)</span>
                  </div>
                  <span className="font-bold">+{formatCurrency(cashback)}</span>
                </div>
              )}
              {useWallet && walletAmountToUse > 0 && (
                <div className="flex justify-between items-center text-green-400">
                  <div className="flex items-center gap-1">
                    <Wallet size={14} />
                    <span>Wallet Balance</span>
                  </div>
                  <span>-{formatCurrency(walletAmountToUse)}</span>
                </div>
              )}
              <div className="border-t border-white/10 pt-2 flex justify-between items-center">
                <span className="text-white font-bold text-base">Total to Pay</span>
                <span
                  className={`font-bold text-lg ${remainingAmount === 0 ? 'text-green-400' : 'text-primary-400'}`}
                >
                  {remainingAmount === 0
                    ? useWallet
                      ? 'Using Wallet'
                      : 'FREE'
                    : formatCurrency(remainingAmount)}
                </span>
              </div>
            </div>
          </div>

          {/* Wallet Toggle Section */}
          {walletBalance > 0 && finalAmount > 0 && (
            <div className="bg-dark-800/50 border border-white/5 rounded-2xl p-4">
              <button
                onClick={() => hasGokartingActivity() && setUseWallet(!useWallet)}
                disabled={!hasGokartingActivity()}
                className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all ${
                  !hasGokartingActivity()
                    ? 'bg-dark-900/50 border-white/5 opacity-60 cursor-not-allowed'
                    : useWallet
                      ? 'bg-green-500/10 border-green-500'
                      : 'bg-dark-900 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      useWallet ? 'bg-green-500/20 text-green-400' : 'bg-dark-700 text-dark-300'
                    }`}
                  >
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <p className={`font-bold ${useWallet ? 'text-white' : 'text-dark-200'}`}>
                      Use Wallet Balance
                    </p>
                    <p className="text-xs text-dark-400">
                      Available: {formatCurrency(walletBalance)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {useWallet && (
                    <span className="text-green-400 font-bold text-sm">
                      -{formatCurrency(walletAmountToUse)}
                    </span>
                  )}
                  {useWallet ? (
                    <ToggleRight className="w-8 h-8 text-green-400" />
                  ) : (
                    <ToggleLeft className="w-8 h-8 text-dark-500" />
                  )}
                </div>
              </button>

              {/* Wallet restriction notice */}
              {useWallet && (
                <div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <p className="text-amber-400 text-xs">
                    Coupons and cashback offers cannot be used with wallet payments.
                  </p>
                </div>
              )}
              {/* Gokarting requirement notice */}
              {useWallet && !hasGokartingActivity() && (
                <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                  <p className="text-red-400 text-xs">
                    Wallet can only be used when at least 1 Go-Karting activity is in cart.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Payment Methods - only show if remaining amount > 0 */}
          {remainingAmount > 0 && (
            <div>
              <h3 className="text-lg font-bold text-white mb-3">
                {useWallet
                  ? `Pay Remaining ${formatCurrency(remainingAmount)}`
                  : 'Select Payment Method'}
              </h3>
              <div className="space-y-3">
                {paymentOptions.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => !option.comingSoon && setSelectedPayment(option.id)}
                    disabled={option.comingSoon}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${
                      option.comingSoon
                        ? 'bg-dark-900/50 border-white/5 opacity-50 cursor-not-allowed'
                        : selectedPayment === option.id
                          ? 'bg-primary-500/10 border-primary-500'
                          : 'bg-dark-800 border-transparent hover:border-white/10'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        selectedPayment === option.id
                          ? 'bg-primary-500/20 text-primary-400'
                          : 'bg-dark-700 text-dark-300'
                      }`}
                    >
                      {option.icon}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium ${selectedPayment === option.id ? 'text-white' : 'text-dark-200'}`}
                        >
                          {option.name}
                        </span>
                        {option.popular && (
                          <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs font-bold rounded-full">
                            Popular
                          </span>
                        )}
                        {option.comingSoon && (
                          <span className="px-2 py-0.5 bg-primary-500/20 text-primary-400 text-[10px] font-black uppercase tracking-wider rounded-full border border-primary-500/30">
                            Coming Soon
                          </span>
                        )}
                      </div>
                      <p className="text-dark-500 text-xs">{option.description}</p>
                    </div>
                    {selectedPayment === option.id && (
                      <CheckCircle className="w-5 h-5 text-primary-400" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* end left column */}

        <div className="space-y-6 lg:sticky lg:top-4 lg:self-start">
          {/* Security Badge */}
          <div className="flex items-center justify-center gap-2 text-dark-500 bg-dark-800/30 p-3 rounded-lg">
            <Shield className="w-4 h-4" />
            <span className="text-xs">100% Secure & Encrypted Payments</span>
          </div>

          {/* Pay Button */}
          <button
            onClick={handlePayment}
            disabled={
              (!!user && remainingAmount > 0 && !selectedPayment) || processing || !isOnline
            }
            className={`w-full py-3 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all shadow-lg ${
              (!user ||
                (remainingAmount === 0 && useWallet) ||
                (remainingAmount > 0 && selectedPayment) ||
                finalAmount === 0) &&
              !processing &&
              isOnline
                ? !user
                  ? 'bg-gradient-to-r from-secondary-600 to-secondary-500 text-white shadow-secondary-500/30 hover:shadow-secondary-500/50 hover:-translate-y-0.5'
                  : 'bg-gradient-to-r from-primary-600 to-primary-500 text-white shadow-primary-500/30 hover:shadow-primary-500/50 hover:-translate-y-0.5'
                : 'bg-dark-700 text-dark-500 cursor-not-allowed'
            }`}
          >
            {processing ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Processing Payment...
              </>
            ) : !isOnline ? (
              'You are offline'
            ) : !user ? (
              'Login to Continue'
            ) : remainingAmount === 0 && useWallet ? (
              <>
                <Wallet className="w-5 h-5" />
                Pay with Wallet
              </>
            ) : finalAmount === 0 ? (
              '🎉 Confirm Free Booking'
            ) : (
              <>
                Pay {formatCurrency(remainingAmount)}
                {useWallet && walletAmountToUse > 0 && (
                  <span className="text-xs opacity-75 ml-1">
                    (+ {formatCurrency(walletAmountToUse)} from wallet)
                  </span>
                )}
              </>
            )}
          </button>
        </div>
        {/* end right column */}
      </div>
      {/* end grid */}

      {/* Offline Toast */}
      <OfflineToast />
      {/* Status Modal Overlay */}
      {statusModal.show && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          role="dialog"
          aria-label="Payment status"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-dark-950/80 backdrop-blur-md"
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            role={statusModal.type === 'failed' ? 'alert' : 'status'}
            aria-live="polite"
            className="bg-dark-900 border border-white/10 rounded-3xl p-8 w-full max-w-sm lg:max-w-md relative z-10 text-center shadow-2xl"
          >
            {statusModal.type === 'processing' && (
              <>
                <div className="w-20 h-20 bg-primary-500/20 rounded-full flex items-center justify-center mx-auto mb-6 relative">
                  <Loader className="w-10 h-10 text-primary-400 animate-spin" />
                  <div className="absolute inset-0 rounded-full border-2 border-primary-500/20 animate-ping" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Processing</h3>
                <p className="text-dark-400 text-sm leading-relaxed">{statusModal.message}</p>
              </>
            )}

            {statusModal.type === 'failed' && (
              <>
                <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <XCircle className="w-10 h-10 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Payment Failed</h3>
                <p className="text-dark-400 text-sm mb-6 leading-relaxed">{statusModal.message}</p>
                <button
                  onClick={() => setStatusModal({ ...statusModal, show: false })}
                  className="w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </button>
              </>
            )}

            {statusModal.type === 'delayed' && (
              <>
                <div className="w-20 h-20 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <AlertCircle className="w-10 h-10 text-amber-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Almost Done!</h3>
                <p className="text-dark-400 text-sm mb-6 leading-relaxed">{statusModal.message}</p>
                <button
                  onClick={() => {
                    clearCart()
                    navigate('/bookings')
                  }}
                  className="w-full bg-primary-500 text-white py-3 rounded-xl font-bold shadow-lg shadow-primary-500/20"
                >
                  Go to My Bookings
                </button>
              </>
            )}
          </motion.div>
        </div>
      )}

      {/* Profile Completion Gate Modal */}
      {showProfileGate && user && (
        <ProfileGate
          user={user}
          onComplete={handleProfileComplete}
          onClose={() => navigate('/cart')}
        />
      )}
    </div>
  )
}
