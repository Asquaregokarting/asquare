/**
 * Pure utility functions and constants extracted from BillingModule.
 *
 * Phase 5 decomposition: these are the first extractions. The POSPanel
 * and view components will follow in subsequent sessions.
 */

export type BillingView =
  | 'pos'
  | 'transactions'
  | 'invoice'
  | 'reprint'
  | 'refunds'
  | 'revenue'
  | 'report'
  | 'helicopter'

export const GST_PERCENT = 18

export const subnav = [
  { label: 'POS', to: '/billing/pos' },
  { label: 'Transactions', to: '/billing/transactions' },
  { label: 'Reprint', to: '/billing/reprint' },
  { label: 'Refunds', to: '/billing/refunds' },
  { label: 'Revenue', to: '/billing/revenue' },
  { label: 'Report', to: '/billing/report' },
  { label: 'Helicopter', to: '/billing/helicopter' },
]

export const titleMap: Record<BillingView, string> = {
  pos: 'POS — Point of Sale',
  transactions: 'Transactions',
  invoice: 'Invoice Detail',
  reprint: 'Reprint Receipts',
  refunds: 'Refund Processing',
  revenue: 'Revenue Analytics',
  report: 'Cashier Report',
  helicopter: 'Helicopter Bookings',
}

export const subtitleMap: Record<BillingView, string> = {
  pos: 'Select activities, build a cart, and process payments in seconds.',
  transactions: 'Review transaction history and payment mix.',
  invoice: 'Inspect full invoice details.',
  reprint: 'Request and manage receipt reprints with approval tracking.',
  refunds: 'Issue partial or full refunds with reason tracking.',
  revenue: 'Daily revenue and method-wise breakdown.',
  report: 'Daily payment summary for shift settlement.',
  helicopter: 'Send helicopter payment links and manage activity catalog.',
}

/** Format amount as INR with Indian grouping. */
export const formatBillingCurrency = (amount: number): string =>
  `INR ${Math.round(amount).toLocaleString('en-IN')}`

/** Calculate GST from a base amount. */
export const calculateGst = (baseAmount: number, gstPercent: number = GST_PERCENT): number =>
  Math.round((baseAmount * gstPercent) / 100)

/** Calculate base amount from an inclusive-of-GST total. */
export const calculateBaseFromInclusive = (
  inclusiveAmount: number,
  gstPercent: number = GST_PERCENT,
): number => Math.round((inclusiveAmount * 100) / (100 + gstPercent))

/** Calculate cart total: subtotal - discount + GST on discounted amount. */
export const calculateCartTotal = (
  subtotal: number,
  discount: number,
  gstPercent: number = GST_PERCENT,
): { baseAmount: number; gstAmount: number; total: number } => {
  const baseAmount = Math.max(0, subtotal - discount)
  const gstAmount = calculateGst(baseAmount, gstPercent)
  return { baseAmount, gstAmount, total: baseAmount + gstAmount }
}

/** Check if a role can mutate billing (create transactions, refunds). */
export const canRoleMutateBilling = (role: string): boolean =>
  ['Cashier', 'Admin', 'Owner'].includes(role)

/** Check if a role can view helicopter billing. */
export const canRoleViewHelicopter = (role: string): boolean =>
  ['Owner', 'Admin', 'Developer', 'Backend'].includes(role)

/** Check if a role can mutate helicopter activities. */
export const canRoleMutateHelicopter = (role: string): boolean => ['Owner', 'Admin'].includes(role)

/** Filter subnav items based on user role. */
export const getSubnavForRole = (role: string): typeof subnav => {
  const isCashier = role === 'Cashier'
  return subnav.filter((item) => {
    if (isCashier && item.to.includes('helicopter')) return false
    if (isCashier && item.to.includes('revenue')) return false
    return true
  })
}
