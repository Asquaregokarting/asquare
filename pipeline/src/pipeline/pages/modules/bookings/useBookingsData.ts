import { useCallback, useEffect, useMemo, useState } from 'react'
import { AsquareBooking, asquareBookingsApi } from '../../../api/asquare-bookings'
import { logger } from '../../../../lib/logger'
import { onBookingPaidById } from '../../../../lib/booking-vendor-payout'
import { decrementHelicopterCountForCancellation } from '../../../../services/helicopterEarlyBird'

interface Actor {
  id: string
  name: string
  role: string
}

export const useBookingsData = (activeLocation: string, actor: Actor) => {
  const [bookings, setBookings] = useState<AsquareBooking[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [verifyingPayment, setVerifyingPayment] = useState<string | null>(null)

  // Auto-clear messages after 5s
  useEffect(() => {
    if (!error && !success) return
    const timer = setTimeout(() => {
      setError(null)
      setSuccess(null)
    }, 8000)
    return () => clearTimeout(timer)
  }, [error, success])

  const patchBooking = useCallback((bookingId: string, updates: Partial<AsquareBooking>) => {
    setBookings((current) =>
      current.map((booking) => (booking.id === bookingId ? { ...booking, ...updates } : booking)),
    )
  }, [])

  const applyUpdate = useCallback(
    async (booking: AsquareBooking, updates: Partial<AsquareBooking>, message: string) => {
      const ok = await asquareBookingsApi.updateBooking(booking.id, booking.userId, updates)
      if (!ok) {
        setError(`Failed to update booking ${booking.id}.`)
        return false
      }
      patchBooking(booking.id, updates)
      setSuccess(message)
      return true
    },
    [patchBooking],
  )

  const cancelBooking = useCallback(
    async (booking: AsquareBooking) => {
      const wasPaid = booking.paymentStatus === 'completed'
      const updates: Partial<AsquareBooking> = {
        bookingStatus: 'cancelled',
        paymentStatus: booking.paymentStatus === 'pending' ? 'failed' : booking.paymentStatus,
      }
      const ok = await applyUpdate(booking, updates, `Cancelled ${booking.id}.`)
      if (!ok) return

      // For paid bookings, reverse the vendor credit. Without this, the
      // original sale credits stay in `vendorLedger` forever — the trigger
      // `syncVendorLedger` only deletes/reverses when `cancelled === true`,
      // and AllBookingsView intentionally does NOT set that flag.
      if (wasPaid) {
        asquareBookingsApi
          .reverseVendorCreditsForBooking(booking.id, { id: actor.id, name: actor.name })
          .catch((reason) =>
            logger.error('bookings_module.cancel_vendor_credit_reverse_failed', reason, {
              bookingId: booking.id,
            }),
          )

        // Helicopter early-bird counter decrement. Pre-fix only the
        // delete-booking Cloud Function did this — the Admin Cancel path
        // (AllBookingsView) left the count inflated so early-bird sold
        // out earlier than real ticket sales. Idempotent — the helper
        // refuses to double-decrement (checks `helicopterCountDecremented`
        // marker on the booking).
        decrementHelicopterCountForCancellation(
          booking.id,
          booking as unknown as Record<string, unknown>,
        ).catch((reason) =>
          logger.error('bookings_module.cancel_helicopter_decrement_failed', reason, {
            bookingId: booking.id,
          }),
        )
      }

      asquareBookingsApi
        .triggerPaymentFailedNotification(
          booking.id,
          String(booking.userPhone ?? ''),
          String(booking.userDisplayName ?? 'Customer'),
        )
        .catch((reason) =>
          logger.error('bookings_module.payment_failed_notification_error', reason),
        )
    },
    [applyUpdate, actor.id, actor.name],
  )

  const verifyPaymentFromRazorpay = useCallback(
    async (booking: AsquareBooking) => {
      setVerifyingPayment(booking.id)
      setError(null)
      try {
        const resp = await fetch(
          'https://asia-south1-a-square-6720c.cloudfunctions.net/verifyRazorpayPayment',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderNumber: booking.id }),
          },
        )
        const data = (await resp.json()) as Record<string, unknown>
        if (!resp.ok || !data.success) {
          setError(String(data.error ?? 'Verification failed'))
          return
        }
        if (data.updated) {
          const after = data.bookingAfter as Record<string, string> | undefined
          setSuccess(
            `Payment verified for ${booking.id}: ${after?.paymentStatus ?? 'updated'}. ${
              data.amountMismatch
                ? `Amount mismatch: paid ₹${(data.amountMismatch as Record<string, number>).paid}, expected ₹${(data.amountMismatch as Record<string, number>).expected}`
                : 'Booking confirmed.'
            }`,
          )
          // Write vendor-ledger credits for event-package items now that the
          // booking is paid. Idempotent — safe if the Razorpay webhook also
          // fired this (they share the deterministic doc id).
          if (after?.paymentStatus === 'completed') {
            void onBookingPaidById(booking.id).catch((err) =>
              logger.error('bookings_module.verify_vendor_payout_failed', err, {
                bookingId: booking.id,
              }),
            )
          }
          void loadBookings()
        } else {
          const before = data.bookingBefore as Record<string, string> | undefined
          setSuccess(
            `Razorpay status: order ${data.razorpayOrderStatus ?? 'unknown'}, ${data.paymentsCount ?? 0} payment(s). ` +
              `Booking is already ${before?.paymentStatus ?? 'unknown'}. No update needed.`,
          )
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to verify payment')
      } finally {
        setVerifyingPayment(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const loadBookings = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      setError(null)
      try {
        const locationId = activeLocation === 'all' ? undefined : activeLocation
        const data = await asquareBookingsApi.listAdminBookings(locationId)
        const now = Date.now()
        const staleMs = 12 * 60 * 60 * 1000

        for (const booking of data) {
          if (booking.paymentStatus === 'pending' || booking.bookingStatus === 'pending') {
            const createdAt = new Date(booking.createdAt).getTime()
            const expiredLink = String(booking.paymentLinkStatus ?? '').toLowerCase() === 'expired'
            if (createdAt === 0) continue
            if (now - createdAt > staleMs || expiredLink) {
              booking.paymentStatus = 'failed'
              booking.bookingStatus = 'cancelled'
              void asquareBookingsApi
                .updateBooking(booking.id, booking.userId, {
                  paymentStatus: 'failed',
                  bookingStatus: 'cancelled',
                })
                .then(() =>
                  asquareBookingsApi.triggerPaymentFailedNotification(
                    booking.id,
                    String(booking.userPhone ?? ''),
                    String(booking.userDisplayName ?? 'Customer'),
                  ),
                )
                .catch((reason) => logger.error('bookings_module.auto_fail_pending_failed', reason))
            }
          }
        }

        setBookings(data)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Failed to load bookings.')
      } finally {
        if (!opts?.silent) setLoading(false)
      }
    },
    [activeLocation],
  )

  // Initial load + reload on location change
  useEffect(() => {
    void loadBookings()
  }, [loadBookings])

  // Auto-poll every 30s when there are pending payment-link bookings
  const hasPendingPaymentLinks = useMemo(
    () =>
      bookings.some(
        (b) => (b.paymentStatus === 'pending' || b.bookingStatus === 'pending') && b.paymentLink,
      ),
    [bookings],
  )

  useEffect(() => {
    if (!hasPendingPaymentLinks) return
    const interval = setInterval(() => {
      void loadBookings({ silent: true })
    }, 30_000)
    return () => clearInterval(interval)
  }, [hasPendingPaymentLinks, loadBookings])

  return {
    bookings,
    loading,
    error,
    setError,
    success,
    setSuccess,
    verifyingPayment,
    patchBooking,
    applyUpdate,
    cancelBooking,
    verifyPaymentFromRazorpay,
    loadBookings,
  }
}
