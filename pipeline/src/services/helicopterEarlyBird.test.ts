import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDoc = vi.fn()

vi.mock('../lib/firebase', () => ({
  db: {},
}))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: vi.fn(() => Promise.resolve()),
  increment: (n: number) => n,
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  EARLY_BIRD_PRICE,
  REGULAR_PRICE,
  EARLY_BIRD_LIMIT,
  getHelicopterBookingCount,
  getHelicopterPricing,
  decrementHelicopterCountForCancellation,
} from './helicopterEarlyBird'

describe('helicopter constants', () => {
  it('early bird price is less than regular', () => {
    expect(EARLY_BIRD_PRICE).toBeLessThan(REGULAR_PRICE)
  })

  it('early bird limit is positive', () => {
    expect(EARLY_BIRD_LIMIT).toBeGreaterThan(0)
  })

  it('prices are reasonable (3000-6000 range)', () => {
    expect(EARLY_BIRD_PRICE).toBeGreaterThanOrEqual(3000)
    expect(REGULAR_PRICE).toBeLessThanOrEqual(6000)
  })
})

describe('getHelicopterBookingCount', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns count from counter doc', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ count: 150 }),
    })
    expect(await getHelicopterBookingCount()).toBe(150)
  })

  it('returns 0 when doc does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false })
    expect(await getHelicopterBookingCount()).toBe(0)
  })

  it('returns 0 on error', async () => {
    mockGetDoc.mockRejectedValueOnce(new Error('offline'))
    expect(await getHelicopterBookingCount()).toBe(0)
  })
})

describe('getHelicopterPricing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns early bird pricing when under limit', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ count: 100 }),
    })
    const pricing = await getHelicopterPricing()
    expect(pricing.isEarlyBird).toBe(true)
    expect(pricing.currentPrice).toBe(EARLY_BIRD_PRICE)
    expect(pricing.ticketsSold).toBe(100)
    expect(pricing.earlyBirdRemaining).toBe(200) // 300 - 100
  })

  it('returns regular pricing when at limit', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ count: 300 }),
    })
    const pricing = await getHelicopterPricing()
    expect(pricing.isEarlyBird).toBe(false)
    expect(pricing.currentPrice).toBe(REGULAR_PRICE)
    expect(pricing.earlyBirdRemaining).toBe(0)
  })

  it('returns regular pricing when over limit', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ count: 500 }),
    })
    const pricing = await getHelicopterPricing()
    expect(pricing.isEarlyBird).toBe(false)
    expect(pricing.earlyBirdRemaining).toBe(0) // never negative
  })

  it('returns early bird when no bookings yet', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false })
    const pricing = await getHelicopterPricing()
    expect(pricing.isEarlyBird).toBe(true)
    expect(pricing.ticketsSold).toBe(0)
    expect(pricing.earlyBirdRemaining).toBe(300)
  })
})

describe('decrementHelicopterCountForCancellation', () => {
  it('skips when booking was never incremented (helicopterCountIncremented missing)', async () => {
    const result = await decrementHelicopterCountForCancellation('b1', {
      items: [{ activity: { name: 'Helicopter Ride' }, quantity: 2 }],
    })
    expect(result).toEqual({ decremented: false, seats: 0, reason: 'never_incremented' })
  })

  it('skips when booking is already decremented', async () => {
    const result = await decrementHelicopterCountForCancellation('b1', {
      helicopterCountIncremented: true,
      helicopterCountDecremented: true,
      items: [{ activity: { name: 'Helicopter Ride' }, quantity: 2 }],
    })
    expect(result).toEqual({ decremented: false, seats: 0, reason: 'already_decremented' })
  })

  it('skips when no helicopter items present', async () => {
    const result = await decrementHelicopterCountForCancellation('b1', {
      helicopterCountIncremented: true,
      items: [{ activity: { name: 'Go-Karting Adult' }, quantity: 4 }],
    })
    expect(result).toEqual({ decremented: false, seats: 0, reason: 'no_helicopter_items' })
  })

  it('decrements seats when helicopter items + flag present (by name)', async () => {
    const result = await decrementHelicopterCountForCancellation('b1', {
      helicopterCountIncremented: true,
      items: [{ activity: { name: 'Helicopter Ride' }, quantity: 3 }],
    })
    expect(result).toEqual({ decremented: true, seats: 3 })
  })

  it('decrements seats when helicopter items match by category', async () => {
    const result = await decrementHelicopterCountForCancellation('b1', {
      helicopterCountIncremented: true,
      items: [
        { activity: { name: 'Joyride', category: 'Helicopter' }, quantity: 2 },
        { activity: { name: 'Joyride', category: 'Helicopter' }, quantity: 4 },
      ],
    })
    expect(result).toEqual({ decremented: true, seats: 6 })
  })

  it('match is case-insensitive', async () => {
    const result = await decrementHelicopterCountForCancellation('b1', {
      helicopterCountIncremented: true,
      items: [{ activity: { name: 'HELICOPTER VIP' }, quantity: 1 }],
    })
    expect(result.decremented).toBe(true)
    expect(result.seats).toBe(1)
  })

  it('returns gracefully when items is missing', async () => {
    const result = await decrementHelicopterCountForCancellation('b1', {
      helicopterCountIncremented: true,
    })
    expect(result).toEqual({ decremented: false, seats: 0, reason: 'no_helicopter_items' })
  })

  it('ignores non-positive quantities', async () => {
    const result = await decrementHelicopterCountForCancellation('b1', {
      helicopterCountIncremented: true,
      items: [
        { activity: { name: 'Helicopter' }, quantity: 0 },
        { activity: { name: 'Helicopter' }, quantity: -1 },
      ],
    })
    expect(result.decremented).toBe(false)
    expect(result.seats).toBe(0)
  })
})
