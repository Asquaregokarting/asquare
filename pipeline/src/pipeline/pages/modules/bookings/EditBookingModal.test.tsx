import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EditBookingModal from './EditBookingModal'
import type { AsquareBooking } from '../../../api/asquare-bookings'

const makeBooking = (overrides: Partial<AsquareBooking> = {}): AsquareBooking =>
  ({
    id: 'ASG260413120000100ABCD',
    userId: 'user-1',
    userDisplayName: 'Test Customer',
    userPhone: '9876543210',
    bookingStatus: 'confirmed',
    paymentStatus: 'completed',
    paymentMethod: 'razorpay',
    checkInStatus: 'pending',
    totalAmount: 1000,
    discountAmount: 100,
    finalAmount: 900,
    tires: 90,
    sessionDate: new Date('2026-04-15'),
    createdAt: new Date('2026-04-13'),
    locationId: 'visakhapatnam',
    source: 'ADMIN_BOOKING',
    items: [
      {
        activity: { name: 'Go Karting', id: 'gk1', basePrice: 500 },
        quantity: 2,
        price: 1000,
        date: '2026-04-15',
        timeSlot: '10:00 AM',
      },
    ],
    passengers: [{ name: 'John', weight: 70, age: 25, gender: 'male' }],
    ...overrides,
  }) as unknown as AsquareBooking

const locations = [
  { id: 'visakhapatnam', name: 'Vizag' },
  { id: 'kakinada', name: 'Kakinada' },
]

describe('EditBookingModal', () => {
  it('renders nothing when booking is null', () => {
    const { container } = render(
      <EditBookingModal booking={null} locations={locations} onSave={vi.fn()} onClose={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders the booking ID in the header', () => {
    render(
      <EditBookingModal
        booking={makeBooking()}
        locations={locations}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('ASG260413120000100ABCD')).toBeInTheDocument()
  })

  it('populates form fields from booking data', () => {
    render(
      <EditBookingModal
        booking={makeBooking()}
        locations={locations}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByDisplayValue('Test Customer')).toBeInTheDocument()
    expect(screen.getByDisplayValue('9876543210')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1000')).toBeInTheDocument()
  })

  it('computes derived finalAmount from totalAmount and discountPercent', () => {
    render(
      <EditBookingModal
        booking={makeBooking({ totalAmount: 2000, discountAmount: 400 })}
        locations={locations}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    // discount was 400 out of 2000 = 20%
    // finalAmount = 2000 - 20% = 1600
    expect(screen.getByText(/1,600/)).toBeInTheDocument()
  })

  it('calls onClose when Cancel button clicked', () => {
    const onClose = vi.fn()
    render(
      <EditBookingModal
        booking={makeBooking()}
        locations={locations}
        onSave={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onSave with updates when Save clicked', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(
      <EditBookingModal
        booking={makeBooking()}
        locations={locations}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce()
    })
    const [booking, updates] = onSave.mock.calls[0]
    expect(booking.id).toBe('ASG260413120000100ABCD')
    expect(updates).toHaveProperty('bookingStatus')
    expect(updates).toHaveProperty('finalAmount')
  })

  it('shows error when confirming without payment', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    const booking = makeBooking({
      bookingStatus: 'confirmed',
      paymentStatus: 'pending',
      paymentMethod: 'link',
      finalAmount: 500,
      totalAmount: 500,
      discountAmount: 0,
    })
    render(
      <EditBookingModal
        booking={booking}
        locations={locations}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )
    // Wait for the form to populate (booking ID is always visible once mounted)
    await waitFor(() => {
      expect(screen.getByText(booking.id)).toBeInTheDocument()
    })
    // bookingStatus is already 'confirmed' and paymentStatus is 'pending' with method 'link'
    // so clicking Save should trigger the validation error
    fireEvent.click(screen.getByText('Save Changes'))
    await waitFor(() => {
      expect(screen.getByText(/Cannot set booking to "confirmed"/)).toBeInTheDocument()
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('allows adding a passenger', () => {
    render(
      <EditBookingModal
        booking={makeBooking()}
        locations={locations}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Passengers (1)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('+ Add'))
    expect(screen.getByText('Passengers (2)')).toBeInTheDocument()
  })

  it('allows removing a passenger', () => {
    render(
      <EditBookingModal
        booking={makeBooking()}
        locations={locations}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Passengers (1)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Remove'))
    expect(screen.getByText('Passengers (0)')).toBeInTheDocument()
  })
})
