import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

// Mock AuthContext — CartProvider calls useAuth() internally
const mockUser = { id: 'test-user-001', displayName: 'Test User' }
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

vi.mock('../lib/firebase', () => ({ db: {}, auth: {} }))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockCoupons = [
  {
    code: 'FLAT100',
    discount: 100,
    isPercentage: false,
    minAmount: 200,
    type: 'discount',
  },
  {
    code: 'PERCENT10',
    discount: 10,
    isPercentage: true,
    minAmount: 0,
    type: 'discount',
  },
  {
    code: 'CASHBACK50',
    discount: 50,
    isPercentage: false,
    minAmount: 0,
    type: 'cashback',
  },
  {
    code: 'HELIONLY',
    discount: 200,
    isPercentage: false,
    minAmount: 0,
    type: 'discount',
    isForHelicopterOnly: true,
  },
  {
    code: 'NOHELI',
    discount: 50,
    isPercentage: false,
    minAmount: 0,
    type: 'discount',
    excludeCategories: ['helicopter'],
  },
  {
    code: 'DATEONLY',
    discount: 100,
    isPercentage: false,
    minAmount: 0,
    type: 'discount',
    validDates: ['2026-12-25'],
  },
  {
    code: 'EXPIRED',
    discount: 100,
    isPercentage: false,
    minAmount: 0,
    type: 'discount',
    expiryDate: '2020-01-01',
  },
  {
    code: 'PERTICKET',
    discount: 25,
    isPercentage: false,
    minAmount: 0,
    type: 'discount',
    applyPerTicket: true,
  },
  {
    code: 'ASG1000',
    discount: 1000,
    isPercentage: false,
    minAmount: 0,
    type: 'discount',
    minTickets: 3,
  },
]

vi.mock('../services/couponService', () => ({
  couponService: {
    fetchCoupons: vi.fn(() => Promise.resolve(mockCoupons)),
    fetchUserCoupons: vi.fn(() => Promise.resolve([])),
  },
}))

vi.mock('../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getLocalISODate: () => '2026-04-13',
  }
})

import { CartProvider, useCart } from './CartContext'

const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>

function makeActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gokarting-adult',
    name: 'Go Karting — Adult',
    description: 'Go-kart racing',
    image: '/img/gk.webp',
    basePrice: 500,
    available: true,
    category: 'gokarting',
    platforms: ['web'],
    variants: [],
    locationIds: ['vizag'],
    ...overrides,
  }
}

describe('CartContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('throws when used outside provider', () => {
    expect(() => renderHook(() => useCart())).toThrow('useCart must be used within a CartProvider')
  })

  it('initializes with empty cart', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    expect(result.current.items).toEqual([])
    expect(result.current.itemCount).toBe(0)
    expect(result.current.appliedCoupon).toBeNull()
  })

  it('addItem adds activity to cart', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    const activity = makeActivity()
    act(() => result.current.addItem(activity as never))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].quantity).toBe(1)
    expect(result.current.itemCount).toBe(1)
  })

  it('addItem increments quantity for existing item', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    const activity = makeActivity()
    act(() => {
      result.current.addItem(activity as never)
      result.current.addItem(activity as never, 2)
    })
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].quantity).toBe(3)
    expect(result.current.itemCount).toBe(3)
  })

  it('removeItem removes activity from cart', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => result.current.addItem(makeActivity() as never))
    act(() => result.current.removeItem('gokarting-adult'))
    expect(result.current.items).toHaveLength(0)
  })

  it('updateQuantity changes item quantity', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => result.current.addItem(makeActivity() as never))
    act(() => result.current.updateQuantity('gokarting-adult', 5))
    expect(result.current.items[0].quantity).toBe(5)
  })

  it('updateQuantity removes item when quantity <= 0', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => result.current.addItem(makeActivity() as never))
    act(() => result.current.updateQuantity('gokarting-adult', 0))
    expect(result.current.items).toHaveLength(0)
  })

  it('getTotal returns sum of base prices * quantities', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => {
      result.current.addItem(makeActivity({ id: 'a1', basePrice: 300 }) as never, 2)
      result.current.addItem(makeActivity({ id: 'a2', basePrice: 500 }) as never, 1)
    })
    expect(result.current.getTotal()).toBe(1100) // 300*2 + 500*1
  })

  it('getTotal applies offerPercent discount', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => result.current.addItem(makeActivity({ basePrice: 1000, offerPercent: 20 }) as never))
    expect(result.current.getTotal()).toBe(800) // 1000 * 0.8
  })

  it('clearCart empties items and coupon', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => result.current.addItem(makeActivity() as never))
    act(() => result.current.clearCart())
    expect(result.current.items).toHaveLength(0)
    expect(result.current.appliedCoupon).toBeNull()
  })

  it('getItemQuantity returns 0 for missing item', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    expect(result.current.getItemQuantity('nonexistent')).toBe(0)
  })

  it('persists items to localStorage', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => result.current.addItem(makeActivity() as never))
    const stored = JSON.parse(localStorage.getItem('asquare_cart_items') || '[]')
    expect(stored).toHaveLength(1)
  })

  it('cartDate defaults to today', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    expect(result.current.cartDate).toBe('2026-04-13')
  })

  it('setCartDate updates and persists', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    act(() => result.current.setCartDate('2026-05-01'))
    expect(result.current.cartDate).toBe('2026-05-01')
    expect(localStorage.getItem('asquare_cart_date')).toBe('2026-05-01')
  })

  it('hasGokartingActivity detects kart items', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    expect(result.current.hasGokartingActivity()).toBe(false)
    act(() =>
      result.current.addItem(makeActivity({ category: 'gokarting', name: 'Go Kart' }) as never),
    )
    expect(result.current.hasGokartingActivity()).toBe(true)
  })

  it('isUsingWallet toggle works', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    expect(result.current.isUsingWallet).toBe(false)
    act(() => result.current.setIsUsingWallet(true))
    expect(result.current.isUsingWallet).toBe(true)
  })

  // ── Coupon tests ─────────────────────────────────────────────────

  it('applyCoupon returns error for invalid code', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    let res: string | true = true
    act(() => {
      res = result.current.applyCoupon('DOESNOTEXIST')
    })
    expect(res).toBe('Invalid coupon code')
  })

  it('applyCoupon succeeds for valid code', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 500 }) as never))
    let res: string | true = ''
    act(() => {
      res = result.current.applyCoupon('FLAT100')
    })
    expect(res).toBe(true)
    expect(result.current.appliedCoupon).toBe('FLAT100')
  })

  it('applyCoupon rejects when below min amount', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 100 }) as never))
    let res: string | true = true
    act(() => {
      res = result.current.applyCoupon('FLAT100')
    })
    expect(res).toContain('Minimum cart amount')
  })

  it('applyCoupon rejects expired coupons', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 500 }) as never))
    let res: string | true = true
    act(() => {
      res = result.current.applyCoupon('EXPIRED')
    })
    expect(res).toBe('This coupon has expired')
  })

  it('applyCoupon rejects date-restricted coupon on wrong date', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 500 }) as never))
    let res: string | true = true
    act(() => {
      res = result.current.applyCoupon('DATEONLY')
    })
    expect(typeof res).toBe('string')
    expect(res).toContain('only valid for visits')
  })

  it('applyCoupon enforces helicopter-only restriction', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ category: 'gokarting' }) as never))
    let res: string | true = true
    act(() => {
      res = result.current.applyCoupon('HELIONLY')
    })
    expect(res).toBe('A helicopter joy ride is required for this coupon')
  })

  it('applyCoupon enforces excluded categories', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() =>
      result.current.addItem(
        makeActivity({ category: 'helicopter', name: 'Helicopter Ride' }) as never,
      ),
    )
    let res: string | true = true
    act(() => {
      res = result.current.applyCoupon('NOHELI')
    })
    expect(typeof res).toBe('string')
    expect(res).toContain('not valid for')
  })

  it('applyCoupon enforces ASG1000 minimum 6 tickets', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 500 }) as never, 3))
    let res: string | true = true
    act(() => {
      res = result.current.applyCoupon('ASG1000')
    })
    expect(typeof res).toBe('string')
    expect(res).toContain('Minimum')
    expect(res).toContain('tickets')
  })

  it('removeCoupon clears applied coupon', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 500 }) as never))
    act(() => {
      result.current.applyCoupon('PERCENT10')
    })
    act(() => result.current.removeCoupon())
    expect(result.current.appliedCoupon).toBeNull()
  })

  it('getDiscountedTotal applies flat discount', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 500 }) as never))
    act(() => {
      result.current.applyCoupon('FLAT100')
    })
    const dt = result.current.getDiscountedTotal()
    expect(dt.discount).toBe(100)
    expect(dt.total).toBe(400)
  })

  it('getDiscountedTotal applies percentage discount', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 1000 }) as never))
    act(() => {
      result.current.applyCoupon('PERCENT10')
    })
    const dt = result.current.getDiscountedTotal()
    expect(dt.discount).toBe(100) // 10% of 1000
    expect(dt.total).toBe(900)
  })

  it('getDiscountedTotal returns cashback instead of discount', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 500 }) as never))
    act(() => {
      result.current.applyCoupon('CASHBACK50')
    })
    const dt = result.current.getDiscountedTotal()
    expect(dt.cashback).toBe(50)
    expect(dt.discount).toBe(0)
    expect(dt.total).toBe(500) // total unchanged for cashback
  })

  it('getDiscountedTotal applies per-ticket discount', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 500 }) as never, 3))
    act(() => {
      result.current.applyCoupon('PERTICKET')
    })
    const dt = result.current.getDiscountedTotal()
    expect(dt.discount).toBe(75) // 25 * 3 tickets
  })

  it('getDiscountedTotal returns zero discount when using wallet', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 500 }) as never))
    act(() => {
      result.current.applyCoupon('FLAT100')
    })
    act(() => result.current.setIsUsingWallet(true))
    const dt = result.current.getDiscountedTotal()
    expect(dt.discount).toBe(0)
  })

  it('getDiscountedTotal previews a different coupon', async () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => expect(result.current.coupons.length).toBeGreaterThan(0))
    act(() => result.current.addItem(makeActivity({ basePrice: 1000 }) as never))
    // No coupon applied, but preview PERCENT10
    const preview = result.current.getDiscountedTotal('PERCENT10')
    expect(preview.discount).toBe(100)
  })

  // ── BOGO re-evaluation (event packages / legacy event games) ─────

  it('keeps the BOGO free line after EventPage adds paid + free for buy_x_get_y', () => {
    // Regression: EventPage splits 3 combos under a Buy 2 Get 1 Free offer
    // into 2 paid + 1 free. The cart's BOGO useEffect must NOT immediately
    // remove the free line just because paid.quantity (2) alone is below the
    // groupSize (3). It must consider the tied free line's quantity too.
    const { result } = renderHook(() => useCart(), { wrapper })
    const paid = makeActivity({
      id: 'event-evt1-pkg-combo2',
      name: 'Summer Vibes — Combo 2',
      basePrice: 999,
      category: 'Summer Vibes',
    })
    const free = makeActivity({
      id: 'event-evt1-pkg-combo2-free',
      name: 'Summer Vibes — Combo 2 (FREE)',
      basePrice: 0,
      category: 'Summer Vibes',
      __bogoTie: {
        parentIds: ['event-evt1-pkg-combo2'],
        buyCount: 2,
        getCount: 1,
        mode: 'mixed',
      },
    })
    act(() => {
      result.current.addItem(paid as never, 2)
      result.current.addItem(free as never, 1)
    })
    const freeLine = result.current.items.find(
      (i) => i.activity.id === 'event-evt1-pkg-combo2-free',
    )
    expect(freeLine).toBeDefined()
    expect(freeLine?.quantity).toBe(1)
  })

  it('drops the BOGO free line when paid items fall below the buy_x_get_y threshold', () => {
    const { result } = renderHook(() => useCart(), { wrapper })
    const paid = makeActivity({
      id: 'event-evt1-pkg-combo2',
      basePrice: 999,
    })
    const free = makeActivity({
      id: 'event-evt1-pkg-combo2-free',
      basePrice: 0,
      __bogoTie: {
        parentIds: ['event-evt1-pkg-combo2'],
        buyCount: 2,
        getCount: 1,
        mode: 'mixed',
      },
    })
    act(() => {
      result.current.addItem(paid as never, 2)
      result.current.addItem(free as never, 1)
    })
    // Remove all paid; total drops to 1 — below B2G1's groupSize=3
    act(() => result.current.removeItem('event-evt1-pkg-combo2'))
    const freeLine = result.current.items.find(
      (i) => i.activity.id === 'event-evt1-pkg-combo2-free',
    )
    expect(freeLine).toBeUndefined()
  })
})
