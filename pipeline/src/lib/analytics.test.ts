import { describe, it, expect, vi } from 'vitest'

// Mock Capacitor before import
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}))
vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('./firebase', () => ({ firebaseApp: {} }))

import { analytics, AnalyticsEvent } from './analytics'

describe('AnalyticsEvent', () => {
  it('exposes auth events', () => {
    expect(AnalyticsEvent.SignUpStarted).toBe('sign_up_started')
    expect(AnalyticsEvent.LoginCompleted).toBe('login_completed')
    expect(AnalyticsEvent.LogoutCompleted).toBe('logout_completed')
  })

  it('exposes booking funnel events', () => {
    expect(AnalyticsEvent.BookingStarted).toBe('booking_started')
    expect(AnalyticsEvent.AddedToCart).toBe('added_to_cart')
    expect(AnalyticsEvent.CheckoutStarted).toBe('checkout_started')
    expect(AnalyticsEvent.CheckoutCompleted).toBe('checkout_completed')
    expect(AnalyticsEvent.PaymentFailed).toBe('payment_failed')
  })

  it('exposes engagement events', () => {
    expect(AnalyticsEvent.SpinAndWinPlayed).toBe('spin_and_win_played')
    expect(AnalyticsEvent.CouponApplied).toBe('coupon_applied')
  })

  it('exposes wallet events', () => {
    expect(AnalyticsEvent.WalletTopUp).toBe('wallet_top_up')
    expect(AnalyticsEvent.WalletDeducted).toBe('wallet_deducted')
  })

  it('has no duplicate event names', () => {
    const values = Object.values(AnalyticsEvent)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('analytics facade', () => {
  it('track does not throw without measurement ID', async () => {
    // VITE_FIREBASE_MEASUREMENT_ID is not set in test env → no-op
    await expect(
      analytics.track(AnalyticsEvent.BookingStarted, { branchId: 'vizag' }),
    ).resolves.toBeUndefined()
  })

  it('identify does not throw without measurement ID', async () => {
    await expect(analytics.identify('user-001', { tier: 'silver' })).resolves.toBeUndefined()
  })

  it('track accepts params', async () => {
    await analytics.track(AnalyticsEvent.AddedToCart, {
      activityId: 'gokarting',
      quantity: 2,
      isCombo: true,
    })
    // No error — just ensures the interface works
  })
})
