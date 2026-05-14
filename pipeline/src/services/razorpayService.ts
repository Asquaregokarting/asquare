// Razorpay Payment Service
// Integration with Razorpay checkout for UPI, Card, and Net Banking payments
import { PaymentError } from '../types/errors'
import { bookingService } from './bookingService'
import { logger } from '../lib/logger'

interface RazorpayPaymentFailedResponse {
  error: {
    code?: string
    description?: string
    reason?: string
    source?: string
    step?: string
    metadata?: Record<string, unknown>
  }
}

interface RazorpayInstance {
  on(event: 'payment.failed', handler: (response: RazorpayPaymentFailedResponse) => void): void
  open(): void
}

interface RazorpayConstructor {
  new (options: Record<string, unknown>): RazorpayInstance
}

declare global {
  interface Window {
    Razorpay: RazorpayConstructor
  }
}

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID

if (!RAZORPAY_KEY_ID?.trim()) {
  throw new Error('Missing RAZORPAY_KEY_ID (VITE_RAZORPAY_KEY_ID)')
}

/** Dynamically load Razorpay SDK on first use instead of render-blocking in index.html */
let razorpayLoadPromise: Promise<void> | null = null
export function loadRazorpaySDK(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  if (razorpayLoadPromise) return razorpayLoadPromise
  razorpayLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () =>
      reject(new PaymentError('Failed to load Razorpay SDK. Check your internet connection.'))
    document.head.appendChild(script)
  })
  return razorpayLoadPromise
}

export interface RazorpayPaymentOptions {
  amount: number // Amount in paise (INR * 100)
  razorpay_order_id: string
  name: string
  email: string
  phone: string
  description?: string
  orderNumber?: string // Added for webhook identification
}

export interface RazorpayResponse {
  razorpay_payment_id: string
  razorpay_order_id?: string
  razorpay_signature?: string
}

export const razorpayService = {
  /**
   * Initialize and open Razorpay checkout
   * @param options Payment options
   * @returns Promise that resolves with payment response or rejects on failure/cancellation
   */
  async initiatePayment(options: RazorpayPaymentOptions): Promise<RazorpayResponse> {
    // Dynamically load Razorpay SDK if not already loaded
    await loadRazorpaySDK()

    return new Promise((resolve, reject) => {
      if (!window.Razorpay) {
        reject(new PaymentError('Razorpay SDK not loaded. Please refresh the page.'))
        return
      }

      const razorpayOptions = {
        key: RAZORPAY_KEY_ID,
        amount: options.amount, // Amount in paise
        currency: 'INR',
        name: 'A Square Gokarting',
        description: options.description || 'Booking Payment',
        image: '/asquare-logo.webp',
        order_id: options.razorpay_order_id,
        prefill: {
          name: options.name,
          email: options.email,
          contact: options.phone,
        },
        notes: {
          customer_name: options.name,
          order_number: options.orderNumber || '', // Pass order number for webhook
        },
        theme: {
          color: '#0066FF',
        },
        payment_capture: 1,
        handler: function (response: RazorpayResponse) {
          logger.info('razorpay.payment.success', {
            orderId: response.razorpay_order_id,
          })
          resolve(response)
        },
        modal: {
          ondismiss: function () {
            reject(new PaymentError('Payment cancelled by user'))
          },
          escape: true,
          animation: true,
        },
      }

      try {
        const rzp = new window.Razorpay(razorpayOptions)

        rzp.on('payment.failed', function (response: RazorpayPaymentFailedResponse) {
          logger.error('razorpay.payment.failed', response?.error, {
            code: response?.error?.code,
            reason: response?.error?.reason,
          })
          if (options.orderNumber) {
            bookingService
              .triggerPaymentFailedNotification(options.orderNumber, options.phone, options.name)
              .catch((err) => logger.error('razorpay.notify_failed', err))
          }
          reject(
            new PaymentError(response.error.description || 'Payment failed', { ...response.error }),
          )
        })

        rzp.open()
      } catch (error) {
        logger.error('razorpay.open_failed', error)
        reject(error)
      }
    })
  },

  /**
   * Check if Razorpay SDK is loaded
   */
  isLoaded(): boolean {
    return typeof window !== 'undefined' && !!window.Razorpay
  },
}
