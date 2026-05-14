/**
 * couponService unit tests
 *
 * Focus: the validation/filtering logic. The audit flagged that coupon
 * validation needs to consider expiry, active flag, and per-user usage.
 * These tests pin the current behaviour of fetchCoupons (active + not expired)
 * and fetchUserCoupons (not used + not expired).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as firestore from 'firebase/firestore'
import { couponService, fetchUserCoupons } from './couponService'
import { createFakeQuerySnapshot } from '../test/mocks/firebase'

const mockedFirestore = vi.mocked(firestore)

describe('couponService.fetchCoupons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns active, not-expired coupons', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    mockedFirestore.getDocs.mockResolvedValueOnce(
      createFakeQuerySnapshot([
        { code: 'WELCOME10', minAmount: 0, discount: 10, isActive: true, expiryDate: future },
      ]) as never,
    )

    const coupons = await couponService.fetchCoupons()
    expect(coupons).toHaveLength(1)
    expect(coupons[0].code).toBe('WELCOME10')
    expect(coupons[0].discount).toBe(10)
  })

  it('filters out expired coupons', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    mockedFirestore.getDocs.mockResolvedValueOnce(
      createFakeQuerySnapshot([
        { code: 'EXPIRED', minAmount: 0, discount: 50, isActive: true, expiryDate: past },
      ]) as never,
    )
    const coupons = await couponService.fetchCoupons()
    expect(coupons).toHaveLength(0)
  })

  it('filters out inactive coupons', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    mockedFirestore.getDocs.mockResolvedValueOnce(
      createFakeQuerySnapshot([
        { code: 'OFF', minAmount: 0, discount: 25, isActive: false, expiryDate: future },
      ]) as never,
    )
    const coupons = await couponService.fetchCoupons()
    expect(coupons).toHaveLength(0)
  })

  it('treats missing isActive as active (default true)', async () => {
    mockedFirestore.getDocs.mockResolvedValueOnce(
      createFakeQuerySnapshot([
        { code: 'NOFLAG', minAmount: 0, discount: 5 },
      ]) as never,
    )
    const coupons = await couponService.fetchCoupons()
    expect(coupons).toHaveLength(1)
  })

  it('returns empty array when Firestore call throws', async () => {
    mockedFirestore.getDocs.mockRejectedValueOnce(new Error('boom'))
    const coupons = await couponService.fetchCoupons()
    expect(coupons).toEqual([])
  })

  it('coerces numeric fields safely', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    mockedFirestore.getDocs.mockResolvedValueOnce(
      createFakeQuerySnapshot([
        { code: 'BAD', minAmount: 'not-a-number', discount: undefined, isActive: true, expiryDate: future },
      ]) as never,
    )
    const coupons = await couponService.fetchCoupons()
    expect(coupons[0].minAmount).toBe(0)
    expect(coupons[0].discount).toBe(0)
  })
})

describe('fetchUserCoupons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when userId is empty', async () => {
    expect(await fetchUserCoupons('')).toEqual([])
  })

  it('filters out expired user coupons', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    mockedFirestore.getDocs.mockResolvedValueOnce(
      createFakeQuerySnapshot([
        { code: 'OLD', minAmount: 0, discount: 100, expiryDate: past },
      ]) as never,
    )
    const coupons = await fetchUserCoupons('user-1')
    expect(coupons).toHaveLength(0)
  })

  it('returns valid user coupons', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    mockedFirestore.getDocs.mockResolvedValueOnce(
      createFakeQuerySnapshot([
        { code: 'rwd5', minAmount: 0, discount: 5, expiryDate: future, type: 'discount' },
      ]) as never,
    )
    const coupons = await fetchUserCoupons('user-1')
    expect(coupons).toHaveLength(1)
    // Code is upper-cased by the service
    expect(coupons[0].code).toBe('RWD5')
  })
})
