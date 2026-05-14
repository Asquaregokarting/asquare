import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBookingFilters } from './useBookingFilters'
import type { AsquareBooking } from '../../../api/asquare-bookings'

const makeBooking = (overrides: Partial<AsquareBooking> = {}): AsquareBooking =>
  ({
    id: 'ASG260413120000100ABCD',
    userId: 'user-1',
    userDisplayName: 'Test Customer',
    userPhone: '9876543210',
    bookingStatus: 'confirmed',
    paymentStatus: 'completed',
    checkInStatus: 'pending',
    finalAmount: 1000,
    totalAmount: 1000,
    discountAmount: 0,
    sessionDate: new Date('2026-04-15'),
    createdAt: new Date('2026-04-13'),
    locationId: 'visakhapatnam',
    items: [{ activity: { name: 'Go Karting' }, quantity: 2, price: 500 }],
    ...overrides,
  }) as unknown as AsquareBooking

describe('useBookingFilters', () => {
  it('returns all bookings when no filters active', () => {
    const bookings = [makeBooking(), makeBooking({ id: 'ASG260413120000200EFGH' })]
    const { result } = renderHook(() => useBookingFilters(bookings, 'owner'))
    expect(result.current.filteredBookings).toHaveLength(2)
    expect(result.current.paged).toHaveLength(2)
  })

  it('filters by search term (name)', () => {
    const bookings = [
      makeBooking({ userDisplayName: 'Alice' }),
      makeBooking({ id: 'ASG2', userDisplayName: 'Bob' }),
    ]
    const { result } = renderHook(() => useBookingFilters(bookings, 'owner'))

    act(() => {
      result.current.setSearchTerm('alice')
    })

    expect(result.current.filteredBookings).toHaveLength(1)
    expect(result.current.filteredBookings[0].userDisplayName).toBe('Alice')
  })

  it('filters by search term (phone)', () => {
    const bookings = [
      makeBooking({ userPhone: '9876543210' }),
      makeBooking({ id: 'ASG2', userPhone: '1234567890' }),
    ]
    const { result } = renderHook(() => useBookingFilters(bookings, 'owner'))

    act(() => {
      result.current.setSearchTerm('98765')
    })

    expect(result.current.filteredBookings).toHaveLength(1)
  })

  it('filters by booking status', () => {
    const bookings = [
      makeBooking({ bookingStatus: 'confirmed' }),
      makeBooking({ id: 'ASG2', bookingStatus: 'cancelled' }),
    ]
    const { result } = renderHook(() => useBookingFilters(bookings, 'owner'))

    act(() => {
      result.current.setStatusFilter('cancelled')
    })

    expect(result.current.filteredBookings).toHaveLength(1)
    expect(result.current.filteredBookings[0].bookingStatus).toBe('cancelled')
  })

  it('filters by payment status', () => {
    const bookings = [
      makeBooking({ paymentStatus: 'completed' }),
      makeBooking({ id: 'ASG2', paymentStatus: 'pending' }),
    ]
    const { result } = renderHook(() => useBookingFilters(bookings, 'owner'))

    act(() => {
      result.current.setPaymentStatusFilter('pending')
    })

    expect(result.current.filteredBookings).toHaveLength(1)
    expect(result.current.filteredBookings[0].paymentStatus).toBe('pending')
  })

  it('computes paymentStats correctly', () => {
    const bookings = [
      makeBooking({ paymentStatus: 'completed', finalAmount: 500 }),
      makeBooking({ id: 'ASG2', paymentStatus: 'completed', finalAmount: 700 }),
      makeBooking({ id: 'ASG3', paymentStatus: 'pending', finalAmount: 300 }),
      makeBooking({ id: 'ASG4', paymentStatus: 'failed', finalAmount: 200 }),
    ]
    const { result } = renderHook(() => useBookingFilters(bookings, 'owner'))

    expect(result.current.paymentStats.completed).toBe(2)
    expect(result.current.paymentStats.pending).toBe(1)
    expect(result.current.paymentStats.failed).toBe(1)
    expect(result.current.paymentStats.revenue).toBe(1200)
  })

  it('sorts by amount ascending', () => {
    const bookings = [
      makeBooking({ id: 'ASG1', finalAmount: 500 }),
      makeBooking({ id: 'ASG2', finalAmount: 200 }),
      makeBooking({ id: 'ASG3', finalAmount: 800 }),
    ]
    const { result } = renderHook(() => useBookingFilters(bookings, 'owner'))

    act(() => {
      result.current.setSortConfig({ key: 'amount', direction: 'asc' })
    })

    expect(result.current.filteredBookings[0].finalAmount).toBe(200)
    expect(result.current.filteredBookings[2].finalAmount).toBe(800)
  })

  it('paginates at 20 items per page', () => {
    const bookings = Array.from({ length: 25 }, (_, i) =>
      makeBooking({ id: `ASG${String(i).padStart(3, '0')}` }),
    )
    const { result } = renderHook(() => useBookingFilters(bookings, 'owner'))

    expect(result.current.paged).toHaveLength(20)
    expect(result.current.totalPages).toBe(2)
    expect(result.current.page).toBe(1)

    act(() => {
      result.current.setCurrentPage(2)
    })

    expect(result.current.paged).toHaveLength(5)
    expect(result.current.page).toBe(2)
  })

  it('resets page to 1 when filter changes', () => {
    const bookings = Array.from({ length: 25 }, (_, i) =>
      makeBooking({ id: `ASG${String(i).padStart(3, '0')}` }),
    )
    const { result } = renderHook(() => useBookingFilters(bookings, 'owner'))

    act(() => {
      result.current.setCurrentPage(2)
    })
    expect(result.current.page).toBe(2)

    act(() => {
      result.current.setSearchTerm('something')
    })
    expect(result.current.page).toBe(1)
  })

  it('extracts unique game names', () => {
    const bookings = [
      makeBooking({
        items: [
          { activity: { name: 'Go Karting' }, quantity: 1, price: 500 },
        ] as AsquareBooking['items'],
      }),
      makeBooking({
        id: 'ASG2',
        items: [
          { activity: { name: 'Bowling' }, quantity: 1, price: 300 },
        ] as AsquareBooking['items'],
      }),
      makeBooking({
        id: 'ASG3',
        items: [
          { activity: { name: 'Go Karting' }, quantity: 2, price: 500 },
        ] as AsquareBooking['items'],
      }),
    ]
    const { result } = renderHook(() => useBookingFilters(bookings, 'owner'))

    expect(result.current.uniqueGames).toEqual(['Bowling', 'Go Karting'])
  })

  it('thirdparty role only sees helicopter bookings', () => {
    const bookings = [
      makeBooking({
        items: [
          { activity: { name: 'Helicopter Ride' }, quantity: 1, price: 5000 },
        ] as AsquareBooking['items'],
      }),
      makeBooking({
        id: 'ASG2',
        items: [
          { activity: { name: 'Go Karting' }, quantity: 1, price: 500 },
        ] as AsquareBooking['items'],
      }),
    ]
    const { result } = renderHook(() => useBookingFilters(bookings, 'thirdparty'))

    expect(result.current.filteredBookings).toHaveLength(1)
    expect(result.current.filteredBookings[0].items[0].activity?.name).toBe('Helicopter Ride')
  })

  it('filters by date range', () => {
    const bookings = [
      makeBooking({ sessionDate: new Date('2026-04-10') }),
      makeBooking({ id: 'ASG2', sessionDate: new Date('2026-04-15') }),
      makeBooking({ id: 'ASG3', sessionDate: new Date('2026-04-20') }),
    ]
    const { result } = renderHook(() => useBookingFilters(bookings, 'owner'))

    act(() => {
      result.current.setDateFrom('2026-04-12')
      result.current.setDateTo('2026-04-18')
    })

    expect(result.current.filteredBookings).toHaveLength(1)
    expect(result.current.filteredBookings[0].id).toBe('ASG2')
  })
})
