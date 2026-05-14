import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'

// Mock dependencies before importing context
vi.mock('../lib/firebase', () => ({ db: {}, auth: {} }))
vi.mock('../lib/locations', () => ({
  getAllLocations: () => [
    {
      slug: 'visakhapatnam',
      branchId: '0',
      displayName: 'Visakhapatnam',
      shortName: 'Vizag',
      enabled: true,
      firestoreDocId: 'visakhapatnam',
    },
    {
      slug: 'kakinada',
      branchId: '1',
      displayName: 'Kakinada',
      shortName: 'Kakinada',
      enabled: true,
      firestoreDocId: 'kakinada',
    },
  ],
  normalizeStoredLocation: () => null,
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    isPeakHours: (_date: Date, time: string) => {
      const [hours] = time.split(':').map(Number)
      return hours >= 16 && hours < 22
    },
    calculateComboDiscount: (count: number) => {
      if (count >= 5) return 20
      if (count >= 3) return 10
      if (count >= 2) return 5
      return 0
    },
  }
})

import { BookingProvider, useBooking } from './BookingContext'
import { createMockActivity } from '../test/test-utils'

const wrapper = ({ children }: { children: ReactNode }) => (
  <BookingProvider>{children}</BookingProvider>
)

describe('BookingContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('throws when used outside provider', () => {
    expect(() => renderHook(() => useBooking())).toThrow(
      'useBooking must be used within a BookingProvider',
    )
  })

  it('initializes with default state', () => {
    const { result } = renderHook(() => useBooking(), { wrapper })
    expect(result.current.items).toEqual([])
    expect(result.current.totalAmount).toBe(0)
    expect(result.current.step).toBe('location')
    expect(result.current.selectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('loads static locations on mount', () => {
    const { result } = renderHook(() => useBooking(), { wrapper })
    expect(result.current.locations).toHaveLength(2)
    expect(result.current.locations[0].name).toBe('Vizag')
    expect(result.current.loadingLocations).toBe(false)
  })

  it('setLocation persists to localStorage', () => {
    const { result } = renderHook(() => useBooking(), { wrapper })
    act(() => result.current.setLocation('1'))
    expect(result.current.selectedLocation).toBe('1')
    expect(localStorage.getItem('asquare_selected_location')).toBe('1')
  })

  it('setDate updates selected date', () => {
    const { result } = renderHook(() => useBooking(), { wrapper })
    act(() => result.current.setDate('2026-05-01'))
    expect(result.current.selectedDate).toBe('2026-05-01')
  })

  it('setStep progresses through wizard', () => {
    const { result } = renderHook(() => useBooking(), { wrapper })
    act(() => result.current.setStep('activities'))
    expect(result.current.step).toBe('activities')
    act(() => result.current.setStep('review'))
    expect(result.current.step).toBe('review')
  })

  it('addItem adds activity to cart with calculated price', () => {
    const activity = createMockActivity({ basePrice: 500, duration: 10 })
    const { result } = renderHook(() => useBooking(), { wrapper })
    act(() => result.current.addItem(activity, 2, 10, '12:00'))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].quantity).toBe(2)
    expect(result.current.items[0].price).toBe(1000) // 500 * 2 * (10/10) * 1 (non-peak)
    expect(result.current.totalAmount).toBe(1000)
  })

  it('applies peak multiplier for evening slots', () => {
    const activity = createMockActivity({ basePrice: 500, duration: 10, peakMultiplier: 1.5 })
    const { result } = renderHook(() => useBooking(), { wrapper })
    // Set to a weekday date so peak hours logic applies
    act(() => result.current.setDate('2026-04-15')) // Wednesday
    act(() => result.current.addItem(activity, 1, 10, '18:00'))
    // 500 * 1 * 1 * 1.5 = 750
    expect(result.current.items[0].price).toBe(750)
  })

  it('removeItem removes by index', () => {
    const activity1 = createMockActivity({ id: 'a1', basePrice: 300, duration: 10 })
    const activity2 = createMockActivity({ id: 'a2', basePrice: 500, duration: 10 })
    const { result } = renderHook(() => useBooking(), { wrapper })
    act(() => {
      result.current.addItem(activity1, 1, 10, '12:00')
      result.current.addItem(activity2, 1, 10, '12:00')
    })
    expect(result.current.items).toHaveLength(2)
    act(() => result.current.removeItem(0))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].activity.id).toBe('a2')
  })

  it('updateItemQuantity recalculates price', () => {
    const activity = createMockActivity({ basePrice: 500, duration: 10 })
    const { result } = renderHook(() => useBooking(), { wrapper })
    act(() => result.current.addItem(activity, 1, 10, '12:00'))
    expect(result.current.totalAmount).toBe(500)
    act(() => result.current.updateItemQuantity(0, 3))
    expect(result.current.items[0].quantity).toBe(3)
    expect(result.current.items[0].price).toBe(1500)
    expect(result.current.totalAmount).toBe(1500)
  })

  it('applies combo discount for multiple items', () => {
    const activity = createMockActivity({ basePrice: 100, duration: 10 })
    const { result } = renderHook(() => useBooking(), { wrapper })
    // Add 3 items → 10% combo discount
    act(() => {
      result.current.addItem(activity, 1, 10, '12:00')
      result.current.addItem(activity, 1, 10, '12:00')
      result.current.addItem(activity, 1, 10, '12:00')
    })
    expect(result.current.totalAmount).toBe(300)
    expect(result.current.discountAmount).toBe(30) // 10% of 300
    expect(result.current.finalAmount).toBe(270)
  })

  it('clearCart resets items but keeps location', () => {
    const activity = createMockActivity({ basePrice: 500, duration: 10 })
    const { result } = renderHook(() => useBooking(), { wrapper })
    act(() => {
      result.current.setLocation('1')
      result.current.addItem(activity, 1, 10, '12:00')
    })
    act(() => result.current.clearCart())
    expect(result.current.items).toEqual([])
    expect(result.current.totalAmount).toBe(0)
    expect(result.current.selectedLocation).toBe('1') // preserved
  })

  it('calculateItemPrice is exposed and accurate', () => {
    const activity = createMockActivity({ basePrice: 400, duration: 20 })
    const { result } = renderHook(() => useBooking(), { wrapper })
    // 400 * 2 * (30/20) * 1 = 1200
    const price = result.current.calculateItemPrice(activity, 2, 30, '2026-04-15', '12:00')
    expect(price).toBe(1200)
  })

  it('fetchLocations resolves with static locations', async () => {
    const { result } = renderHook(() => useBooking(), { wrapper })
    await act(async () => result.current.fetchLocations())
    expect(result.current.locations.length).toBeGreaterThan(0)
  })
})
