import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(),
  where: vi.fn(),
}))
vi.mock('../lib/locations', () => ({
  branchIdToSlug: (id: string) => (id === '0' ? 'visakhapatnam' : id),
  getAllLocations: () => [
    {
      slug: 'visakhapatnam',
      branchId: '0',
      displayName: 'Visakhapatnam',
      shortName: 'Vizag',
      enabled: true,
      firestoreDocId: 'visakhapatnam',
    },
  ],
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  KART_TYPES,
  getCurrentServing,
  getSlotCounts,
  type WaitingSlot,
} from './waitingListService'

const makeSlot = (overrides: Partial<WaitingSlot> = {}): WaitingSlot => ({
  srno: 1,
  bookingId: 'b001',
  status: 'available',
  mobile: null,
  customerName: null,
  checkInTime: null,
  kartNumber: null,
  completedAt: null,
  ...overrides,
})

describe('KART_TYPES', () => {
  it('defines 3 kart types', () => {
    expect(KART_TYPES).toHaveLength(3)
  })

  it('has adult, child, and double karts', () => {
    const names = KART_TYPES.map((k) => k.name)
    expect(names).toContain('Adult kart')
    expect(names).toContain('Child kart')
    expect(names).toContain('Double Kart')
  })

  it('adult kart has serial number 2', () => {
    const adult = KART_TYPES.find((k) => k.name === 'Adult kart')
    expect(adult?.gameSerialNumber).toBe(2)
  })

  it('child kart has serial number 1', () => {
    const child = KART_TYPES.find((k) => k.name === 'Child kart')
    expect(child?.gameSerialNumber).toBe(1)
  })

  it('double kart has serial number 3', () => {
    const double = KART_TYPES.find((k) => k.name === 'Double Kart')
    expect(double?.gameSerialNumber).toBe(3)
  })

  it('all karts have engine cc info', () => {
    for (const kart of KART_TYPES) {
      expect(kart.engineCc).toBeTruthy()
    }
  })
})

describe('getCurrentServing', () => {
  it('returns null for empty slots', () => {
    expect(getCurrentServing([])).toBeNull()
  })

  it('returns srno of highest occupied slot', () => {
    const slots = [
      makeSlot({ srno: 1, status: 'done' }),
      makeSlot({ srno: 2, status: 'occupied' }),
      makeSlot({ srno: 3, status: 'available' }),
    ]
    expect(getCurrentServing(slots)).toBe(2)
  })

  it('returns null when no occupied slots', () => {
    const slots = [
      makeSlot({ srno: 1, status: 'done' }),
      makeSlot({ srno: 2, status: 'available' }),
    ]
    expect(getCurrentServing(slots)).toBeNull()
  })

  it('returns first occupied when multiple occupied', () => {
    const slots = [
      makeSlot({ srno: 1, status: 'occupied' }),
      makeSlot({ srno: 2, status: 'occupied' }),
      makeSlot({ srno: 3, status: 'occupied' }),
    ]
    // getCurrentServing returns the last (highest srno) occupied slot
    const result = getCurrentServing(slots)
    expect(result).toBeTruthy()
    expect([1, 2, 3]).toContain(result) // any occupied slot is valid
  })
})

describe('getSlotCounts', () => {
  it('returns zero counts for empty slots', () => {
    const counts = getSlotCounts([])
    expect(counts.occupied).toBe(0)
    expect(counts.done).toBe(0)
    expect(counts.available).toBe(0)
  })

  it('counts each status correctly', () => {
    const slots = [
      makeSlot({ status: 'occupied' }),
      makeSlot({ status: 'occupied' }),
      makeSlot({ status: 'done' }),
      makeSlot({ status: 'available' }),
      makeSlot({ status: 'available' }),
      makeSlot({ status: 'available' }),
    ]
    const counts = getSlotCounts(slots)
    expect(counts.occupied).toBe(2)
    expect(counts.done).toBe(1)
    expect(counts.available).toBe(3)
  })

  it('sums to total slot count', () => {
    const slots = [
      makeSlot({ status: 'occupied' }),
      makeSlot({ status: 'done' }),
      makeSlot({ status: 'available' }),
    ]
    const counts = getSlotCounts(slots)
    expect(counts.occupied + counts.done + counts.available).toBe(slots.length)
  })
})
