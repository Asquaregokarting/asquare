import { describe, it, expect } from 'vitest'
import {
  applyMemberCoupons,
  projectEarnedCoupons,
  buildMemberCouponSentinel,
  parseMemberCouponSentinel,
  COUPON_FACE_VALUE,
} from './coupon-application'

describe('applyMemberCoupons', () => {
  it('returns all-zero result for an empty cart', () => {
    const r = applyMemberCoupons({ items: [], couponsAvailable: 5 })
    expect(r).toEqual({
      perLineUnitsApplied: [],
      perLineDiscount: [],
      couponsApplied: 0,
      couponDiscount: 0,
    })
  })

  it('applies nothing when no items are eligible (no Go-Karting)', () => {
    const r = applyMemberCoupons({
      items: [
        { category: 'bowling', price: 400, qty: 2 },
        { category: 'lasertag', price: 350, qty: 1 },
      ],
      couponsAvailable: 5,
    })
    expect(r.couponsApplied).toBe(0)
    expect(r.couponDiscount).toBe(0)
    expect(r.perLineUnitsApplied).toEqual([0, 0])
    expect(r.perLineDiscount).toEqual([0, 0])
  })

  it('applies nothing when couponsAvailable is 0 even if eligible items exist', () => {
    const r = applyMemberCoupons({
      items: [{ category: 'gokarting', price: 750, qty: 3 }],
      couponsAvailable: 0,
    })
    expect(r.couponsApplied).toBe(0)
    expect(r.perLineUnitsApplied).toEqual([0])
  })

  it('applies coupons per unit on a single Go-Karting line capped by qty', () => {
    // qty=2, 3 coupons available → 2 units consumed, 1 left over
    const r = applyMemberCoupons({
      items: [{ category: 'gokarting', price: 750, qty: 2 }],
      couponsAvailable: 3,
    })
    expect(r.couponsApplied).toBe(2)
    expect(r.couponDiscount).toBe(2 * COUPON_FACE_VALUE)
    expect(r.perLineUnitsApplied).toEqual([2])
    expect(r.perLineDiscount).toEqual([300])
  })

  it('applies coupons per unit capped by couponsAvailable when qty exceeds it', () => {
    // qty=5, only 2 coupons available → 2 units consumed
    const r = applyMemberCoupons({
      items: [{ category: 'gokarting', price: 750, qty: 5 }],
      couponsAvailable: 2,
    })
    expect(r.couponsApplied).toBe(2)
    expect(r.perLineUnitsApplied).toEqual([2])
    expect(r.perLineDiscount).toEqual([300])
  })

  it('greedy fills the first eligible line, then spills into the next', () => {
    // line 0: gokart qty 2, line 1: gokart qty 3 → 4 coupons → 2 + 2
    const r = applyMemberCoupons({
      items: [
        { category: 'gokarting', price: 750, qty: 2 },
        { category: 'gokarting', price: 950, qty: 3 },
      ],
      couponsAvailable: 4,
    })
    expect(r.couponsApplied).toBe(4)
    expect(r.perLineUnitsApplied).toEqual([2, 2])
    expect(r.perLineDiscount).toEqual([300, 300])
  })

  it('skips ineligible lines while distributing coupons across mixed cart', () => {
    // gokart qty 2, bowling qty 1, gokart qty 1 → 1 coupon → all on first gokart line
    const r = applyMemberCoupons({
      items: [
        { category: 'gokarting', price: 750, qty: 2 },
        { category: 'bowling', price: 400, qty: 1 },
        { category: 'gokarting', price: 950, qty: 1 },
      ],
      couponsAvailable: 1,
    })
    expect(r.couponsApplied).toBe(1)
    expect(r.perLineUnitsApplied).toEqual([1, 0, 0])
    expect(r.perLineDiscount).toEqual([150, 0, 0])
  })

  it('skips ineligible lines and spills across two gokart lines when supply allows', () => {
    // gokart qty 2 (consume 2) → bowling (skip) → gokart qty 1 (consume 1)
    const r = applyMemberCoupons({
      items: [
        { category: 'gokarting', price: 750, qty: 2 },
        { category: 'bowling', price: 400, qty: 1 },
        { category: 'gokarting', price: 950, qty: 1 },
      ],
      couponsAvailable: 3,
    })
    expect(r.couponsApplied).toBe(3)
    expect(r.perLineUnitsApplied).toEqual([2, 0, 1])
    expect(r.perLineDiscount).toEqual([300, 0, 150])
  })

  it('floors fractional quantity and ignores zero-qty lines', () => {
    const r = applyMemberCoupons({
      items: [
        { category: 'gokarting', price: 750, qty: 0 },
        { category: 'gokarting', price: 750, qty: 2.7 },
      ],
      couponsAvailable: 5,
    })
    expect(r.couponsApplied).toBe(2)
    expect(r.perLineUnitsApplied).toEqual([0, 2])
  })

  it('treats negative couponsAvailable as zero', () => {
    const r = applyMemberCoupons({
      items: [{ category: 'gokarting', price: 750, qty: 2 }],
      couponsAvailable: -3,
    })
    expect(r.couponsApplied).toBe(0)
  })
})

describe('projectEarnedCoupons', () => {
  it('returns 0 when the booking does not cross a ₹600 boundary', () => {
    // current 1500 → bucket 2; final 50 → 1550 → bucket 2 → no new coupon
    expect(projectEarnedCoupons(1500, 50)).toBe(0)
  })

  it('returns 1 when the booking crosses exactly one ₹600 boundary', () => {
    // current 1500 → bucket 2; final 700 → 2200 → bucket 3 → +1
    expect(projectEarnedCoupons(1500, 700)).toBe(1)
  })

  it('returns N when the booking crosses N ₹600 boundaries', () => {
    // current 1500 → bucket 2; final 1700 → 3200 → bucket 5 → +3
    expect(projectEarnedCoupons(1500, 1700)).toBe(3)
  })

  it('returns 0 from a zero-spend customer making a tiny booking', () => {
    expect(projectEarnedCoupons(0, 100)).toBe(0)
  })

  it('returns 1 from a zero-spend customer crossing the first boundary', () => {
    expect(projectEarnedCoupons(0, 600)).toBe(1)
  })

  it('clamps negative inputs to zero', () => {
    expect(projectEarnedCoupons(-50, -100)).toBe(0)
  })
})

describe('buildMemberCouponSentinel / parseMemberCouponSentinel', () => {
  it('round-trips a positive count', () => {
    const code = buildMemberCouponSentinel(3)
    expect(code).toBe('MEMBER150x3')
    expect(parseMemberCouponSentinel(code)).toBe(3)
  })

  it('builds MEMBER150x0 for zero or negative input', () => {
    expect(buildMemberCouponSentinel(0)).toBe('MEMBER150x0')
    expect(buildMemberCouponSentinel(-2)).toBe('MEMBER150x0')
  })

  it('parses null/undefined/empty as zero', () => {
    expect(parseMemberCouponSentinel(null)).toBe(0)
    expect(parseMemberCouponSentinel(undefined)).toBe(0)
    expect(parseMemberCouponSentinel('')).toBe(0)
  })

  it('returns 0 for unrelated coupon codes', () => {
    expect(parseMemberCouponSentinel('PROMO20')).toBe(0)
    expect(parseMemberCouponSentinel('ASQ150-abc123')).toBe(0)
    expect(parseMemberCouponSentinel('member150x2')).toBe(0) // case-sensitive
  })

  it('returns 0 for malformed sentinels', () => {
    expect(parseMemberCouponSentinel('MEMBER150x')).toBe(0)
    expect(parseMemberCouponSentinel('MEMBER150xfoo')).toBe(0)
    expect(parseMemberCouponSentinel('MEMBER150x-2')).toBe(0)
  })

  it('parses MEMBER150x0 as zero (no redemption)', () => {
    expect(parseMemberCouponSentinel('MEMBER150x0')).toBe(0)
  })
})
