/**
 * Analytics facade — Firebase Analytics on web, no-op on native (Capacitor).
 *
 * Why a facade and not direct firebase/analytics imports at call sites?
 *   1. Firebase Analytics only works in browser environments. On Capacitor
 *      we'd need a different bridge (Firebase Crashlytics + Analytics native
 *      plugin), so the facade lets call sites stay agnostic.
 *   2. Centralizing event names prevents typos and makes it easy to add
 *      tests around the taxonomy.
 *   3. Lets us swap providers (e.g. Mixpanel, Segment) without touching call
 *      sites.
 *
 * Usage:
 *   import { analytics, AnalyticsEvent } from '@/lib/analytics'
 *   analytics.track(AnalyticsEvent.BookingStarted, { branchId: 'vizag' })
 *   analytics.identify(user.id, { tier: 'silver' })
 */

import type { Analytics } from 'firebase/analytics'
import { Capacitor } from '@capacitor/core'
import { logger } from './logger'

/**
 * The full set of allowed analytics events.
 *
 * KEEP THIS LIST IN SYNC with the team's GA4 dashboard. Adding events here
 * is cheap; renaming them is expensive (it breaks historical reporting).
 */
export const AnalyticsEvent = {
  // Auth
  SignUpStarted: 'sign_up_started',
  SignUpCompleted: 'sign_up_completed',
  LoginCompleted: 'login_completed',
  LogoutCompleted: 'logout_completed',
  // Browse
  BranchSelected: 'branch_selected',
  ActivityViewed: 'activity_viewed',
  // Booking funnel
  BookingStarted: 'booking_started',
  AddedToCart: 'added_to_cart',
  CheckoutStarted: 'checkout_started',
  CheckoutCompleted: 'checkout_completed',
  PaymentFailed: 'payment_failed',
  // Engagement
  SpinAndWinPlayed: 'spin_and_win_played',
  CouponApplied: 'coupon_applied',
  // Wallet
  WalletTopUp: 'wallet_top_up',
  WalletDeducted: 'wallet_deducted',
} as const

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent]

export interface AnalyticsParams {
  [key: string]: string | number | boolean | undefined
}

let firebaseAnalytics: Analytics | null = null
let initPromise: Promise<void> | null = null

/**
 * Lazy-load and initialize Firebase Analytics. Safe to call multiple times.
 * No-op on native (Capacitor) and in test environments.
 */
async function ensureInitialized(): Promise<void> {
  if (firebaseAnalytics || initPromise) return initPromise ?? undefined

  // Skip on native — Capacitor needs a different SDK.
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return

  // Skip when no measurement id is configured (e.g. tests, local dev).
  if (!import.meta.env.VITE_FIREBASE_MEASUREMENT_ID) return

  initPromise = (async () => {
    try {
      const [{ getAnalytics, isSupported }, { firebaseApp }] = await Promise.all([
        import('firebase/analytics'),
        // Reuse the existing app — no need to call initializeApp again.
        import('./firebase'),
      ])
      const supported = await isSupported()
      if (!supported) return
      firebaseAnalytics = getAnalytics(firebaseApp)
      logger.debug('analytics.initialized')
    } catch (err) {
      logger.warn('analytics.init_failed', { error: String(err) })
    }
  })()

  return initPromise
}

export const analytics = {
  /**
   * Track a typed analytics event. Use AnalyticsEvent.* constants — never
   * pass a raw string, that defeats the type safety.
   */
  async track(event: AnalyticsEventName, params?: AnalyticsParams): Promise<void> {
    await ensureInitialized()
    if (!firebaseAnalytics) {
      logger.debug(`analytics.skip:${event}`, params as Record<string, unknown> | undefined)
      return
    }
    try {
      const { logEvent } = await import('firebase/analytics')
      logEvent(firebaseAnalytics, event, params)
    } catch (err) {
      logger.warn('analytics.track_failed', { event, error: String(err) })
    }
  },

  /**
   * Associate the current session with a user id and optional traits.
   */
  async identify(
    userId: string,
    traits?: Record<string, string | number | boolean>,
  ): Promise<void> {
    await ensureInitialized()
    if (!firebaseAnalytics) return
    try {
      const { setUserId, setUserProperties } = await import('firebase/analytics')
      setUserId(firebaseAnalytics, userId)
      if (traits) setUserProperties(firebaseAnalytics, traits)
    } catch (err) {
      logger.warn('analytics.identify_failed', { error: String(err) })
    }
  },
}
