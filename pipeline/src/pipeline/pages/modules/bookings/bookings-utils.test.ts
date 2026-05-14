import { describe, it, expect } from 'vitest'
import {
  formatDateInput,
  formatCurrency,
  formatBookingItems,
  normalizeRole,
  isHelicopter,
  isGoKartActivity,
  getCatalogPrice,
  formatCatalogMetric,
  ITEMS_PER_PAGE,
  PROTOCOL_MAX_LAPS,
} from './bookings-utils'
import type { AsquareBooking } from '../../../api/asquare-bookings'
import type { ActivityCatalogRecord } from '../../../api/types'

describe('formatDateInput', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(formatDateInput(new Date(2026, 3, 13))).toBe('2026-04-13')
  })

  it('pads single-digit month and day', () => {
    expect(formatDateInput(new Date(2025, 0, 5))).toBe('2025-01-05')
  })
})

describe('formatCurrency', () => {
  it('formats a number as INR with comma separators', () => {
    expect(formatCurrency(12500)).toBe('INR 12,500')
  })

  it('rounds to nearest integer', () => {
    expect(formatCurrency(999.7)).toBe('INR 1,000')
  })

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('INR 0')
  })

  it('handles falsy value', () => {
    expect(formatCurrency(NaN)).toBe('INR 0')
  })
})

describe('formatBookingItems', () => {
  it('returns "No items" for empty items', () => {
    const booking = { items: [] } as unknown as AsquareBooking
    expect(formatBookingItems(booking)).toBe('No items')
  })

  it('formats items from activity.name', () => {
    const booking = {
      items: [
        { activity: { name: 'Go Karting' }, quantity: 2 },
        { activity: { name: 'Bowling' }, quantity: 1 },
      ],
    } as unknown as AsquareBooking
    const result = formatBookingItems(booking)
    expect(result).toContain('1.')
    expect(result).toContain('×2')
    expect(result).toContain('2.')
    expect(result).toContain('×1')
  })

  it('prefers billingItems when present', () => {
    const booking = {
      items: [{ activity: { name: 'Ignored' }, quantity: 1 }],
      billingItems: [{ itemName: 'Billing Item', quantity: 3 }],
    } as unknown as AsquareBooking
    const result = formatBookingItems(booking)
    expect(result).toContain('Billing Item')
    expect(result).toContain('×3')
    expect(result).not.toContain('Ignored')
  })
})

describe('normalizeRole', () => {
  it('lowercases and trims', () => {
    expect(normalizeRole('  Owner ')).toBe('owner')
  })

  it('returns empty string for undefined', () => {
    expect(normalizeRole(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(normalizeRole('')).toBe('')
  })
})

describe('isHelicopter', () => {
  it('returns true when an item contains helicopter', () => {
    const booking = {
      items: [{ activity: { name: 'Helicopter Ride' }, quantity: 1 }],
    } as unknown as AsquareBooking
    expect(isHelicopter(booking)).toBe(true)
  })

  it('returns false when no helicopter items', () => {
    const booking = {
      items: [{ activity: { name: 'Go Karting' }, quantity: 1 }],
    } as unknown as AsquareBooking
    expect(isHelicopter(booking)).toBe(false)
  })

  it('returns false for empty items', () => {
    const booking = { items: [] } as unknown as AsquareBooking
    expect(isHelicopter(booking)).toBe(false)
  })
})

describe('isGoKartActivity', () => {
  it.each(['GoKarting', 'go-karting', 'Go Karting', 'gokart', 'Go-Kart', 'go kart'])(
    'returns true for "%s"',
    (name) => {
      expect(isGoKartActivity(name)).toBe(true)
    },
  )

  it('returns false for non-gokart names', () => {
    expect(isGoKartActivity('Bowling')).toBe(false)
    expect(isGoKartActivity('Laser Tag')).toBe(false)
  })
})

describe('getCatalogPrice', () => {
  it('returns the price for the given branch key', () => {
    const activity = {
      branchPrices: { vizag: 500, kakinada: 400 },
    } as unknown as ActivityCatalogRecord
    expect(getCatalogPrice(activity, 'vizag')).toBe(500)
  })

  it('falls back to first branch price when key not found', () => {
    const activity = { branchPrices: { vizag: 500 } } as unknown as ActivityCatalogRecord
    expect(getCatalogPrice(activity, 'guntur')).toBe(500)
  })

  it('returns 0 for negative prices', () => {
    const activity = { branchPrices: { vizag: -100 } } as unknown as ActivityCatalogRecord
    expect(getCatalogPrice(activity, 'vizag')).toBe(0)
  })
})

describe('formatCatalogMetric', () => {
  it('returns laps when laps > 0', () => {
    const activity = { laps: 5, durationMinutes: 15 } as unknown as ActivityCatalogRecord
    expect(formatCatalogMetric(activity)).toBe('5 laps')
  })

  it('returns duration when no laps', () => {
    const activity = { durationMinutes: 30 } as unknown as ActivityCatalogRecord
    expect(formatCatalogMetric(activity)).toBe('30 min')
  })

  it('returns Flexible when no laps and no duration', () => {
    const activity = {} as unknown as ActivityCatalogRecord
    expect(formatCatalogMetric(activity)).toBe('Flexible')
  })
})

describe('constants', () => {
  it('ITEMS_PER_PAGE is 20', () => {
    expect(ITEMS_PER_PAGE).toBe(20)
  })

  it('PROTOCOL_MAX_LAPS is 5', () => {
    expect(PROTOCOL_MAX_LAPS).toBe(5)
  })
})
