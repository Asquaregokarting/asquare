/**
 * Pure utilities for the coupon outreach feature.
 *
 * Kept dependency-free so they can be exercised by Vitest without any
 * Firebase or DOM mocks. The cron uses a CommonJS clone in
 * functions/lib/coupon-outreach-helpers.js.
 */

import type {
  CouponOutreachItem,
  CouponOutreachStatus,
  CustomerValueTier,
} from '../../api/coupon-outreach'

export const COUPON_EARN_THRESHOLD = 600

export interface CustomerValueThresholds {
  tierHighSpend: number
  tierHighVisits: number
  tierMidSpend: number
}

export const DEFAULT_VALUE_THRESHOLDS: CustomerValueThresholds = {
  tierHighSpend: 10000,
  tierHighVisits: 10,
  tierMidSpend: 3000,
}

/** Pure: how many ₹150 coupons a member has unused. */
export const computeAvailableCoupons = (totalBillAmount: number, redeemed: number): number => {
  const earned = Math.floor(Math.max(0, totalBillAmount) / COUPON_EARN_THRESHOLD)
  return Math.max(0, earned - Math.max(0, redeemed))
}

/** Pure: derive customer value tier from spend + visits. */
export const computeCustomerValueTier = (
  totalBillAmount: number,
  totalVisits: number,
  thresholds: CustomerValueThresholds = DEFAULT_VALUE_THRESHOLDS,
): CustomerValueTier => {
  const spend = Math.max(0, totalBillAmount)
  const visits = Math.max(0, totalVisits)
  if (spend >= thresholds.tierHighSpend || visits >= thresholds.tierHighVisits) {
    return 'high'
  }
  if (spend >= thresholds.tierMidSpend) return 'mid'
  return 'low'
}

/**
 * Pure: split items evenly across N owners, round-robin order.
 * Returns Map<ownerId, itemIndices[]> so callers can build their own
 * partition shape without us caring about item type.
 */
export const roundRobinPartition = <T>(items: T[], ownerIds: string[]): Map<string, T[]> => {
  const out = new Map<string, T[]>()
  if (ownerIds.length === 0) return out
  ownerIds.forEach((id) => out.set(id, []))
  for (let i = 0; i < items.length; i += 1) {
    const owner = ownerIds[i % ownerIds.length]
    out.get(owner)!.push(items[i])
  }
  return out
}

/** Format an integer rupee value for display: "₹12,300" */
export const formatRupees = (value: number): string =>
  `₹${Math.round(value || 0).toLocaleString('en-IN')}`

/** Short relative-time formatter — "today", "2d ago", "—" */
export const relativeDateLabel = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const diffDays = Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 30) return `${diffDays}d ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

/** Order items by status (pending first), then by tier, then by available coupons. */
export const sortInboxItems = (items: CouponOutreachItem[]): CouponOutreachItem[] => {
  const statusRank: Record<CouponOutreachStatus, number> = {
    pending: 0,
    contacted: 1,
    skipped: 2,
    done: 3,
  }
  const tierRank: Record<CustomerValueTier, number> = { high: 0, mid: 1, low: 2 }
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return statusRank[a.status] - statusRank[b.status]
    if (a.snapshot.customerValueTier !== b.snapshot.customerValueTier) {
      return tierRank[a.snapshot.customerValueTier] - tierRank[b.snapshot.customerValueTier]
    }
    return b.snapshot.coupons150Available - a.snapshot.coupons150Available
  })
}

/** Group items into KPI counts for the inbox header. */
export const computeKpis = (
  items: CouponOutreachItem[],
): { pending: number; contacted: number; done: number; skipped: number } => {
  const counts = { pending: 0, contacted: 0, done: 0, skipped: 0 }
  for (const item of items) counts[item.status] += 1
  return counts
}
