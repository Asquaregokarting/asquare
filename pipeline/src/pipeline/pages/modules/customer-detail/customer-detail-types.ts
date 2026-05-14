/**
 * Tab keys for the Customer 360 detail page. Used in the URL (?tab=...)
 * and in the page-shell tab nav.
 */
export type CustomerDetailTab =
  | 'overview'
  | 'bookings'
  | 'games'
  | 'wallet'
  | 'tires'
  | 'coupons'
  | 'referrals'

export const CUSTOMER_DETAIL_TABS: { key: CustomerDetailTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'games', label: 'Games' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'tires', label: 'Tires' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'referrals', label: 'Referrals' },
]

export const isCustomerDetailTab = (value: string | null): value is CustomerDetailTab =>
  value !== null && CUSTOMER_DETAIL_TABS.some((t) => t.key === value)
