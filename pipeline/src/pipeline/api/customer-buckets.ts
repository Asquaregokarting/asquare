/**
 * Pure derivation of customer bucket fields used by the admin Customers
 * list for multi-dimensional filtering. Mirrored on the Cloud Function
 * trigger `onUserWriteCustomerBuckets` so the same logic runs server-side
 * whenever a user document changes.
 */

export type SpendBucket = '0' | '1-5k' | '5-25k' | '25k+'
export type BookingBucket = '0' | '1' | '2-5' | '6+'

export interface CustomerBuckets {
  spendBucket: SpendBucket
  bookingBucket: BookingBucket
  hasWalletBalance: boolean
  hasTires: boolean
  hasUnredeemedCoupons150: boolean
}

export interface BucketSourceFields {
  totalSpent: number
  bookingCount: number
  walletBalance: number
  tires: number
  coupons150Available: number
}

const safeNonNegative = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) return 0
  return value
}

export const spendBucketFor = (totalSpent: number): SpendBucket => {
  const v = safeNonNegative(totalSpent)
  if (v === 0) return '0'
  if (v < 5000) return '1-5k'
  if (v < 25000) return '5-25k'
  return '25k+'
}

export const bookingBucketFor = (count: number): BookingBucket => {
  const v = safeNonNegative(count)
  if (v === 0) return '0'
  if (v === 1) return '1'
  if (v <= 5) return '2-5'
  return '6+'
}

export const computeCustomerBuckets = (s: BucketSourceFields): CustomerBuckets => ({
  spendBucket: spendBucketFor(s.totalSpent),
  bookingBucket: bookingBucketFor(s.bookingCount),
  hasWalletBalance: s.walletBalance > 0,
  hasTires: s.tires > 0,
  hasUnredeemedCoupons150: s.coupons150Available > 0,
})
