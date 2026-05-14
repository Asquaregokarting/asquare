import { describe, it, expect } from 'vitest'
import {
  getEventGamePrice,
  calculateBuyXGetYFree,
  generateEventSlug,
  calculatePackageTotal,
  computePackageDiscount,
  validateEventCampaign,
} from './event-pricing'
import type { EventGameConfig, EventOfferConfig, EventPackage } from './event-campaign-types'

describe('getEventGamePrice', () => {
  const baseGame: EventGameConfig = { activityId: 'g1', name: 'Go Kart', originalPrice: 500 }

  it('uses overridePrice when set', () => {
    expect(getEventGamePrice({ ...baseGame, overridePrice: 300 }, null)).toBe(300)
  })

  it('applies per-game discountPercent', () => {
    expect(getEventGamePrice({ ...baseGame, discountPercent: 20 }, null)).toBe(400)
  })

  it('applies offer flat_discount when no per-game discount', () => {
    const offer: EventOfferConfig = { type: 'flat_discount', discountPercent: 10 }
    expect(getEventGamePrice(baseGame, offer)).toBe(450)
  })

  it('per-game discount takes priority over offer', () => {
    const offer: EventOfferConfig = { type: 'flat_discount', discountPercent: 10 }
    expect(getEventGamePrice({ ...baseGame, discountPercent: 30 }, offer)).toBe(350)
  })

  it('returns originalPrice when no discounts', () => {
    expect(getEventGamePrice(baseGame, null)).toBe(500)
  })
})

describe('calculateBuyXGetYFree', () => {
  it('buy 2 get 1 free — same game', () => {
    const result = calculateBuyXGetYFree(
      [{ activityId: 'g1', unitPrice: 500, quantity: 3 }],
      2,
      1,
      false,
    )
    expect(result.freeItemsValue).toBe(500)
    expect(result.finalTotal).toBe(1000) // 3*500 - 500
  })

  it('buy 2 get 1 free — not enough for free', () => {
    const result = calculateBuyXGetYFree(
      [{ activityId: 'g1', unitPrice: 500, quantity: 2 }],
      2,
      1,
      false,
    )
    expect(result.freeItemsValue).toBe(0)
    expect(result.finalTotal).toBe(1000)
  })

  it('buy 2 get 1 free — mixed games (cheapest free)', () => {
    const result = calculateBuyXGetYFree(
      [
        { activityId: 'cheap', unitPrice: 200, quantity: 1 },
        { activityId: 'expensive', unitPrice: 500, quantity: 2 },
      ],
      2,
      1,
      true,
    )
    expect(result.freeItemsValue).toBe(200) // cheapest item is free
    expect(result.finalTotal).toBe(1000) // 1200 - 200
  })

  it('multiple free items with large quantity', () => {
    const result = calculateBuyXGetYFree(
      [{ activityId: 'g1', unitPrice: 100, quantity: 6 }],
      2,
      1,
      false,
    )
    expect(result.freeItemsValue).toBe(200) // 2 free out of 6
    expect(result.finalTotal).toBe(400)
  })

  it('handles empty selections', () => {
    const result = calculateBuyXGetYFree([], 2, 1, false)
    expect(result.finalTotal).toBe(0)
    expect(result.freeItemsValue).toBe(0)
  })
})

describe('generateEventSlug', () => {
  it('converts to lowercase kebab-case', () => {
    expect(generateEventSlug('Summer Splash 2026')).toBe('summer-splash-2026')
  })

  it('strips special characters', () => {
    expect(generateEventSlug('Buy 2 Get 1 Free!')).toBe('buy-2-get-1-free')
  })

  it('collapses multiple spaces/dashes', () => {
    expect(generateEventSlug('  Hello   World  ')).toBe('hello-world')
  })

  it('truncates to 60 chars', () => {
    const long = 'a'.repeat(100)
    expect(generateEventSlug(long).length).toBeLessThanOrEqual(60)
  })

  it('handles empty string', () => {
    expect(generateEventSlug('')).toBe('')
  })
})

describe('calculatePackageTotal', () => {
  it('sums item prices', () => {
    const pkg: EventPackage = {
      id: 'p1',
      locationKey: '0',
      title: 'Basic',
      items: [
        { name: 'Item 1', price: 500, quantity: 1, description: '' },
        { name: 'Item 2', price: 300, quantity: 1, description: '' },
      ],
    }
    expect(calculatePackageTotal(pkg)).toBe(800)
  })

  it('ignores invalid prices', () => {
    const pkg: EventPackage = {
      id: 'p1',
      locationKey: '0',
      title: 'Test',
      items: [
        { name: 'Good', price: 500, quantity: 1, description: '' },
        { name: 'Bad', price: -100, quantity: 1, description: '' },
        { name: 'NaN', price: NaN as unknown as number, quantity: 1, description: '' },
      ],
    }
    expect(calculatePackageTotal(pkg)).toBe(500)
  })

  it('returns 0 for empty package', () => {
    const pkg: EventPackage = { id: 'p1', locationKey: '0', title: 'Empty', items: [] }
    expect(calculatePackageTotal(pkg)).toBe(0)
  })
})

describe('computePackageDiscount', () => {
  it('no discount returns subtotal as total', () => {
    const result = computePackageDiscount([{ packageId: 'p1', unitPrice: 1000, quantity: 2 }], null)
    expect(result.subtotal).toBe(2000)
    expect(result.total).toBe(2000)
    expect(result.discountAmount).toBe(0)
  })

  it('flat percentage discount', () => {
    const result = computePackageDiscount([{ packageId: 'p1', unitPrice: 1000, quantity: 2 }], {
      type: 'flat',
      flatMode: 'percentage',
      flatValue: 10,
    })
    expect(result.subtotal).toBe(2000)
    expect(result.flatValue).toBe(200)
    expect(result.total).toBe(1800)
  })

  it('flat fixed discount', () => {
    const result = computePackageDiscount([{ packageId: 'p1', unitPrice: 500, quantity: 1 }], {
      type: 'flat',
      flatMode: 'fixed',
      flatValue: 100,
    })
    expect(result.flatValue).toBe(100)
    expect(result.total).toBe(400)
  })

  it('flat discount capped at subtotal', () => {
    const result = computePackageDiscount([{ packageId: 'p1', unitPrice: 50, quantity: 1 }], {
      type: 'flat',
      flatMode: 'fixed',
      flatValue: 500,
    })
    expect(result.total).toBe(0) // can't go negative
    expect(result.flatValue).toBe(50) // capped at subtotal
  })

  it('buy_x_get_y applies free items', () => {
    const result = computePackageDiscount([{ packageId: 'p1', unitPrice: 1000, quantity: 3 }], {
      type: 'buy_x_get_y',
      buyCount: 2,
      getCount: 1,
    })
    expect(result.bxgyFreeValue).toBe(1000)
    expect(result.total).toBe(2000)
  })

  it('buy_x_get_y with getCount=0 returns no discount', () => {
    const result = computePackageDiscount([{ packageId: 'p1', unitPrice: 1000, quantity: 3 }], {
      type: 'buy_x_get_y',
      buyCount: 2,
      getCount: 0,
    })
    expect(result.total).toBe(3000)
  })

  it('buy_x_get_y requires same package — three of same combo gets 1 free', () => {
    const result = computePackageDiscount(
      [{ packageId: 'combo-1', unitPrice: 1000, quantity: 3 }],
      {
        type: 'buy_x_get_y',
        buyCount: 2,
        getCount: 1,
      },
    )
    expect(result.bxgyFreeValue).toBe(1000)
    expect(result.total).toBe(2000)
  })

  it('buy_x_get_y does not apply across different packages', () => {
    const result = computePackageDiscount(
      [
        { packageId: 'combo-1', unitPrice: 1000, quantity: 2 },
        { packageId: 'combo-2', unitPrice: 800, quantity: 1 },
      ],
      { type: 'buy_x_get_y', buyCount: 2, getCount: 1 },
    )
    expect(result.bxgyFreeValue).toBe(0)
    expect(result.total).toBe(2800)
  })

  it('buy_x_get_y scales with multiples of the same package', () => {
    const result = computePackageDiscount(
      [{ packageId: 'combo-1', unitPrice: 1000, quantity: 6 }],
      {
        type: 'buy_x_get_y',
        buyCount: 2,
        getCount: 1,
      },
    )
    expect(result.bxgyFreeValue).toBe(2000)
    expect(result.total).toBe(4000)
  })
})

describe('validateEventCampaign', () => {
  it('returns errors for empty data', () => {
    const errors = validateEventCampaign({})
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('Title'))).toBe(true)
    expect(errors.some((e) => e.includes('location'))).toBe(true)
    expect(errors.some((e) => e.includes('package'))).toBe(true)
  })

  it('returns no errors for valid data', () => {
    const errors = validateEventCampaign({
      title: 'Summer Event',
      locationKeys: ['visakhapatnam'],
      packages: [
        {
          id: 'p1',
          locationKey: 'visakhapatnam',
          title: 'Basic',
          items: [{ name: 'Go Kart', price: 500, quantity: 1, description: '' }],
        },
      ],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    })
    expect(errors).toHaveLength(0)
  })

  it('catches end date before start date', () => {
    const errors = validateEventCampaign({
      title: 'Test',
      locationKeys: ['v'],
      packages: [
        {
          id: 'p',
          locationKey: 'v',
          title: 'P',
          items: [{ name: 'I', price: 100, quantity: 1, description: '' }],
        },
      ],
      startDate: '2026-06-01',
      endDate: '2026-05-01',
    })
    expect(errors.some((e) => e.includes('End date'))).toBe(true)
  })

  it('catches package with no items', () => {
    const errors = validateEventCampaign({
      title: 'Test',
      locationKeys: ['v'],
      packages: [{ id: 'p', locationKey: 'v', title: 'P', items: [] }],
    })
    expect(errors.some((e) => e.includes('at least one item'))).toBe(true)
  })

  it('catches item with zero price', () => {
    const errors = validateEventCampaign({
      title: 'Test',
      locationKeys: ['v'],
      packages: [
        {
          id: 'p',
          locationKey: 'v',
          title: 'P',
          items: [{ name: 'Free', price: 0, quantity: 1, description: '' }],
        },
      ],
    })
    expect(errors.some((e) => e.includes('price must be greater'))).toBe(true)
  })
})
