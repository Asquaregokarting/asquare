import { describe, expect, it } from 'vitest'
import { throwIfInvalid, validateBooking } from './booking-validator'

const goodBooking = () => ({
  id: 'TEST_OK',
  finalAmount: 1000,
  discountAmount: 0,
  walletAmountUsed: 0,
  vendorIds: ['9999999999'],
  items: [
    {
      itemName: 'Cricket - 5 overs',
      quantity: 1,
      unitPrice: 1000,
      gameId: 'cricket',
      subGameId: 'cricket',
      variantId: 'single_pass_5_overs',
      vendorId: '9999999999',
    },
  ],
  billingItems: [
    {
      itemName: 'Cricket - 5 overs',
      quantity: 1,
      unitPrice: 1000,
      gameId: 'cricket',
      subGameId: 'cricket',
      variantId: 'single_pass_5_overs',
      vendorId: '9999999999',
      vendorTotal: 678,
    },
  ],
})

describe('validateBooking', () => {
  it('passes a fully canonical booking', () => {
    const r = validateBooking(goodBooking())
    expect(r.ok).toBe(true)
    expect(r.failures).toEqual([])
  })

  it('flags items[i] missing gameId/subGameId', () => {
    const b = goodBooking()
    b.items[0].gameId = ''
    const r = validateBooking(b)
    expect(r.ok).toBe(false)
    expect(r.failures.map((f) => f.code)).toContain('item-missing-catalog-ids')
  })

  it('allows _isMisc:true items without catalog IDs', () => {
    const b = goodBooking()
    b.items[0] = {
      itemName: 'Misc',
      quantity: 1,
      unitPrice: 1000,
      _isMisc: true,
    } as never
    // billingItems still match by itemName so the cross-check passes
    b.billingItems[0] = {
      ...b.billingItems[0],
      itemName: 'Misc',
      gameId: '',
      subGameId: '',
      variantId: '',
    }
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code).includes('item-missing-catalog-ids')).toBe(false)
  })

  it('flags blank itemName', () => {
    const b = goodBooking()
    b.items[0].itemName = ''
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code)).toContain('item-name-blank')
  })

  it('flags cart-total mismatch (phantom duplicate combo case)', () => {
    const b = goodBooking()
    // Add a phantom duplicate that doubles the items sum but bill stays
    // at 1000 (the ASG260330... type bug).
    b.items.push({ ...b.items[0] })
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code)).toContain('cart-total-mismatch')
  })

  it('flags vendorIds[] out of sync with items', () => {
    const b = goodBooking()
    b.vendorIds = ['9999999999', '8885215060'] // ghost extra vendor
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code)).toContain('vendor-ids-out-of-sync')
  })

  it('flags billingItems vendor different from items vendor', () => {
    const b = goodBooking()
    b.billingItems[0].vendorId = '0000000000'
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code)).toContain('billing-vs-items-vendor-mismatch')
  })

  it('flags billingItems catalog IDs different from items catalog IDs', () => {
    const b = goodBooking()
    b.billingItems[0].variantId = 'wrong_variant'
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code)).toContain('billing-vs-items-catalog-mismatch')
  })

  it('flags billingItems unitPrice different from items unitPrice (Prathyusha case)', () => {
    const b = goodBooking()
    b.items[0].unitPrice = 520
    b.billingItems[0].unitPrice = 130
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code)).toContain('billing-vs-items-price-mismatch')
  })

  it('flags billingItems quantity different from items quantity', () => {
    const b = goodBooking()
    b.items[0].quantity = 4
    b.billingItems[0].quantity = 2
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code)).toContain('billing-vs-items-price-mismatch')
  })

  it('tolerates ±2 INR rounding on cart total', () => {
    const b = goodBooking()
    b.items[0].unitPrice = 1001 // off by 1 → still within tolerance
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code)).not.toContain('cart-total-mismatch')
  })

  // ── Check 6: zero-out via negative billingItems[] ─────────────────────
  // Pattern observed on ASG260502190314957WKJS and ASG260411235153111CP7L:
  // cashier flips the second line's itemBaseAmount/itemGstAmount negative
  // to cancel the first line's positive amounts, making finalAmount=0
  // while the booking stays confirmed and uncancelled. This breaks vendor
  // accounting and surfaces as wrong-vendor-stamp audit rows.
  const zeroOutBooking = () => ({
    id: 'TEST_ZERO_OUT',
    finalAmount: 0,
    totalAmount: 3777,
    discountAmount: 0,
    walletAmountUsed: 0,
    cancelled: false,
    refundStatus: 'None',
    vendorIds: ['8282823696'],
    items: [
      {
        itemName: 'Gokarting',
        quantity: 3,
        unitPrice: 907,
        gameId: 'gokarting',
        subGameId: 'adult',
        variantId: 'lap_12',
      },
      {
        itemName: 'Paint Ball',
        quantity: 3,
        unitPrice: 352,
        gameId: 'paintball',
        subGameId: 'paint_ball',
        variantId: 'bullet_25',
        vendorId: '8282823696',
      },
    ],
    billingItems: [
      {
        itemName: 'Gokarting',
        quantity: 3,
        unitPrice: 907,
        gameId: 'gokarting',
        subGameId: 'adult',
        variantId: 'lap_12',
        itemBaseAmount: 2306,
        itemGstAmount: 415,
      },
      {
        itemName: 'Paint Ball',
        quantity: 3,
        unitPrice: 352,
        gameId: 'paintball',
        subGameId: 'paint_ball',
        variantId: 'bullet_25',
        vendorId: '8282823696',
        itemBaseAmount: -2306,
        itemGstAmount: -415,
      },
    ],
  })

  it('flags zero-out via negative line items on a non-cancelled booking', () => {
    const r = validateBooking(zeroOutBooking())
    expect(r.failures.map((f) => f.code)).toContain('billing-zero-out-via-negative-lines')
  })

  it('allows zero-out when booking is cancelled', () => {
    const b = zeroOutBooking()
    b.cancelled = true
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code)).not.toContain('billing-zero-out-via-negative-lines')
  })

  it('allows zero-out when refundStatus is full', () => {
    const b = zeroOutBooking()
    b.refundStatus = 'full'
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code)).not.toContain('billing-zero-out-via-negative-lines')
  })

  it('does not flag legitimate discount-line bookings (finalAmount > 0)', () => {
    // Real pattern from the sweep: total=2049, final=1849, one positive
    // line and one negative line that net to a non-zero positive total.
    const b = {
      id: 'TEST_DISCOUNT_LINE',
      finalAmount: 1849,
      totalAmount: 2049,
      discountAmount: 0,
      walletAmountUsed: 0,
      cancelled: false,
      refundStatus: 'None',
      vendorIds: [],
      items: [],
      billingItems: [
        {
          itemName: 'Game',
          quantity: 1,
          unitPrice: 2900,
          itemBaseAmount: 2458,
          itemGstAmount: 442,
        },
        {
          itemName: 'Discount',
          quantity: 1,
          unitPrice: 0,
          itemBaseAmount: -891,
          itemGstAmount: -160,
        },
      ],
    }
    const r = validateBooking(b)
    expect(r.failures.map((f) => f.code)).not.toContain('billing-zero-out-via-negative-lines')
  })
})

describe('throwIfInvalid', () => {
  it('does not throw on a valid booking', () => {
    expect(() => throwIfInvalid(goodBooking(), 'test')).not.toThrow()
  })

  it('throws ValidationError listing every failure', () => {
    const b = goodBooking()
    b.items[0].gameId = ''
    b.vendorIds = ['ghost']
    // Match by message + name — class identity is fragile in test
    // module resolution; the runtime contract is the message + name.
    let thrown: Error | null = null
    try {
      throwIfInvalid(b, 'test')
    } catch (err) {
      thrown = err as Error
    }
    expect(thrown).not.toBeNull()
    expect(thrown?.name).toBe('ValidationError')
    expect(thrown?.message).toMatch(/Booking invariants failed/)
    expect(thrown?.message).toMatch(/item-missing-catalog-ids/)
    expect(thrown?.message).toMatch(/vendor-ids-out-of-sync/)
  })
})
