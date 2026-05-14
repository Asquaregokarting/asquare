import { describe, it, expect } from 'vitest'
import {
  spendBucketFor,
  bookingBucketFor,
  computeCustomerBuckets,
  type CustomerBuckets,
} from './customer-buckets'

describe('spendBucketFor', () => {
  it.each([
    [0, '0'],
    [1, '1-5k'],
    [4999, '1-5k'],
    [5000, '5-25k'],
    [24999, '5-25k'],
    [25000, '25k+'],
    [1_000_000, '25k+'],
  ] as const)('totalSpent=%d → %s', (input, expected) => {
    expect(spendBucketFor(input)).toBe(expected)
  })

  it('clamps negatives to 0 bucket', () => {
    expect(spendBucketFor(-100)).toBe('0')
  })

  it('treats NaN as 0', () => {
    expect(spendBucketFor(Number.NaN)).toBe('0')
  })
})

describe('bookingBucketFor', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [2, '2-5'],
    [5, '2-5'],
    [6, '6+'],
    [500, '6+'],
  ] as const)('count=%d → %s', (input, expected) => {
    expect(bookingBucketFor(input)).toBe(expected)
  })

  it('clamps negatives to 0', () => {
    expect(bookingBucketFor(-3)).toBe('0')
  })
})

describe('computeCustomerBuckets', () => {
  it('derives all bucket fields from source values', () => {
    const result = computeCustomerBuckets({
      totalSpent: 7500,
      bookingCount: 3,
      walletBalance: 100,
      tires: 0,
      coupons150Available: 2,
    })
    const expected: CustomerBuckets = {
      spendBucket: '5-25k',
      bookingBucket: '2-5',
      hasWalletBalance: true,
      hasTires: false,
      hasUnredeemedCoupons150: true,
    }
    expect(result).toEqual(expected)
  })

  it('handles all-zero customer', () => {
    expect(
      computeCustomerBuckets({
        totalSpent: 0,
        bookingCount: 0,
        walletBalance: 0,
        tires: 0,
        coupons150Available: 0,
      }),
    ).toEqual({
      spendBucket: '0',
      bookingBucket: '0',
      hasWalletBalance: false,
      hasTires: false,
      hasUnredeemedCoupons150: false,
    })
  })

  it('treats negative wallet/tires as no-balance flags', () => {
    expect(
      computeCustomerBuckets({
        totalSpent: 0,
        bookingCount: 0,
        walletBalance: -50, // refund overshoot edge case
        tires: -1,
        coupons150Available: 0,
      }),
    ).toMatchObject({
      hasWalletBalance: false,
      hasTires: false,
    })
  })
})
