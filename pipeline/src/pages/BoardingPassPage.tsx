import { useEffect, useState } from 'react'
import SEO from '../components/SEO'
import { useParams } from 'react-router-dom'
import type { Booking } from '../types'
import BoardingPass from '../components/BoardingPass'
import { bookingService } from '../services/bookingService'
import { logger } from '../lib/logger'

export default function BoardingPassPage() {
  const { bookingId } = useParams<{ bookingId: string }>()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchBooking() {
      if (!bookingId) {
        setError('No booking ID')
        setLoading(false)
        return
      }
      try {
        const data = await bookingService.getBookingById(bookingId)
        if (!data) {
          setError('Booking not found')
          setLoading(false)
          return
        }
        setBooking(data)
      } catch (err) {
        logger.error('boarding_pass.load_failed', err, { bookingId })
        setError('Failed to load booking')
      } finally {
        setLoading(false)
      }
    }
    fetchBooking()
  }, [bookingId])

  if (loading)
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: 'var(--dark-800)',
          color: 'var(--gold-400)',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        Loading...
      </div>
    )
  if (error || !booking)
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: 'var(--dark-800)',
          color: 'rgb(239 68 68)',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        {error || 'Booking not found'}
      </div>
    )

  return (
    <div
      style={{
        padding: '20px',
        minHeight: '100vh',
        backgroundColor: 'var(--dark-800)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SEO
        title="Boarding Pass"
        description="Your boarding pass for A Square GoKarting."
        path="/boarding-pass"
        noindex
      />
      <BoardingPass
        booking={booking}
        passengerName={
          booking.passengers && booking.passengers.length > 0
            ? booking.passengers.map((p) => p.name || 'Passenger').join(', ')
            : booking.userDisplayName || 'Guest'
        }
        onDownload={() => {
          if (booking.paymentStatus === 'completed') window.print()
        }}
        paymentPending={booking.paymentStatus !== 'completed'}
      />
    </div>
  )
}
