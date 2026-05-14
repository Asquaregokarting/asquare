/**
 * Checkout Day Report — aggregates today's transactions for a location
 * into a printable sales + third-party shares report.
 */
import { collection, doc, getDoc } from 'firebase/firestore'
import { initializeFirestore } from '../../lib/firebase'
import { listFilteredBillingTransactions } from '../../api/billing-firestore'
import { getLocationDisplayName } from '../../../lib/locations'

export interface DayReportSalesRow {
  type: string
  amount: number
}

export interface DayReportVendorRow {
  vendorName: string
  vendorType: string
  sales: number
  tax: number
  net: number
  tpShare: number
  asgShare: number
}

export interface DayReportSalesSummary {
  cash: number
  upi: number
  card: number
  razorpay: number
  discount: number
  protocolCount: number
  grandTotal: number
}

export interface DayReportVendorSummary {
  baseAmount: number
  gstAmount: number
  thirdPartyShare: number
  companyShare: number
}

export interface DayReportData {
  locationName: string
  date: string
  sales: DayReportSalesRow[]
  totalSales: number
  vendorShares: DayReportVendorRow[]
  vendorTotals: { sales: number; tax: number; net: number; tpShare: number; asgShare: number }
  transactionCount: number
  salesSummary: DayReportSalesSummary
  vendorSummary: DayReportVendorSummary
  settlement?: {
    cashEntered: number
    cardEntered: number
    upiEntered: number
    cashActual: number
    cardActual: number
    upiActual: number
  }
}

const resolveLocationSlug = (raw: string): string => {
  // Normalize various location ID formats to a comparable key
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '')
}

/** Fetch vendor display names and vendorType from the vendorDetails collection. */
const fetchVendorInfo = async (
  vendorIds: string[],
): Promise<Map<string, { name: string; vendorType: string }>> => {
  const infoMap = new Map<string, { name: string; vendorType: string }>()
  const firestore = initializeFirestore()
  if (!firestore || vendorIds.length === 0) return infoMap

  await Promise.all(
    vendorIds.map(async (vid) => {
      try {
        const snap = await getDoc(doc(collection(firestore, 'vendorDetails'), vid))
        if (snap.exists()) {
          const data = snap.data() as Record<string, unknown>
          const name = data.vendorName ? String(data.vendorName) : ''
          const vt = String(data.vendorType ?? '')
          const vendorType = vt === 'SubLease' ? 'Sublease' : 'Third-Party'
          if (name) infoMap.set(vid, { name, vendorType })
        }
      } catch {
        /* ignore individual fetch failures */
      }
    }),
  )
  return infoMap
}

/**
 * Aggregate all completed transactions for a location + date into a day report.
 */
export const aggregateDayReport = async (
  locationSlug: string,
  date: string, // YYYY-MM-DD
): Promise<DayReportData> => {
  if (!locationSlug?.trim()) throw new Error('Location is required to generate Day Report.')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error('Valid date (YYYY-MM-DD) is required for Day Report.')

  const allTransactions = await listFilteredBillingTransactions({ from: date, to: date })

  // Filter to this location AND to POS-only transactions. Online customer-
  // app bookings settle directly via Razorpay → company merchant account;
  // they never touch the cashier's till, so they must not appear in the
  // shift day report. `sourceType === 'BILLING'` is the canonical POS
  // marker (set explicitly by POS checkout, matches BillingModule's
  // transaction list filter). Post-2026-05-11 locationId normalization,
  // online and POS rows share the same slug — without this filter the
  // printed report would diverge from the settlement totals.
  const normalizedTarget = resolveLocationSlug(locationSlug)
  const transactions = allTransactions.filter((txn) => {
    if (txn.sourceType !== 'BILLING') return false
    const normalizedTxn = resolveLocationSlug(txn.locationId ?? '')
    return (
      normalizedTxn === normalizedTarget ||
      resolveLocationSlug(getLocationDisplayName(txn.locationId ?? '')) ===
        resolveLocationSlug(getLocationDisplayName(locationSlug))
    )
  })

  // ── Sales by payment method ───────────────────────────────────────────
  const salesMap: Record<string, number> = { Cash: 0, Card: 0, UPI: 0, Razorpay: 0 }

  for (const txn of transactions) {
    const method = txn.paymentMethod ?? ''
    const amount = txn.totalAmount || 0

    if (method === 'Split') {
      salesMap.Cash += txn.splitCash ?? 0
      salesMap.UPI += txn.splitUpi ?? 0
      salesMap.Card += txn.splitCard ?? 0
    } else if (method === 'Razorpay') {
      salesMap.Razorpay += amount
    } else if (method === 'Cash' || method === 'Card' || method === 'UPI') {
      salesMap[method] += amount
    } else {
      // Protocol, other — skip or add to a catch-all
      salesMap.Cash += amount
    }
  }

  const sales: DayReportSalesRow[] = Object.entries(salesMap)
    .filter(([, amount]) => amount > 0)
    .map(([type, amount]) => ({ type, amount: Math.round(amount) }))
  const totalSales = sales.reduce((sum, row) => sum + row.amount, 0)

  // ── Sales Summary (new — correct split handling, discount, protocol) ──
  let sumCash = 0,
    sumUpi = 0,
    sumCard = 0,
    sumRazorpay = 0
  let sumDiscount = 0
  let protocolCount = 0

  for (const txn of transactions) {
    const method = txn.paymentMethod ?? ''
    const amount = txn.totalAmount || 0

    if (method === 'Protocol') {
      protocolCount++
      continue // exclude from monetary sums
    }

    if (method === 'Split') {
      sumCash += txn.splitCash ?? 0
      sumUpi += txn.splitUpi ?? 0
      sumCard += txn.splitCard ?? 0
    } else if (method === 'Razorpay') {
      sumRazorpay += amount
    } else if (method === 'Cash') {
      sumCash += amount
    } else if (method === 'Card') {
      sumCard += amount
    } else if (method === 'UPI') {
      sumUpi += amount
    }

    sumDiscount += txn.discount ?? txn.couponDiscount ?? 0

    // Refunds: subtract from the bucket of the original payment method
    // regardless of refund mode. A refunded sale is no longer revenue for
    // the day — wallet refunds reduce the company's recognised takings
    // even though the cash physically stayed in the drawer.
    const refunded = txn.refundAmount ?? 0
    if (refunded > 0) {
      if (method === 'Split') {
        // Apportion across split components by their share of the total.
        const splitTotal = (txn.splitCash ?? 0) + (txn.splitUpi ?? 0) + (txn.splitCard ?? 0)
        if (splitTotal > 0) {
          sumCash -= refunded * ((txn.splitCash ?? 0) / splitTotal)
          sumUpi -= refunded * ((txn.splitUpi ?? 0) / splitTotal)
          sumCard -= refunded * ((txn.splitCard ?? 0) / splitTotal)
        } else {
          sumCash -= refunded
        }
      } else if (method === 'Razorpay') {
        sumRazorpay -= refunded
      } else if (method === 'Card') {
        sumCard -= refunded
      } else if (method === 'UPI') {
        sumUpi -= refunded
      } else {
        sumCash -= refunded
      }
    }
  }

  const salesSummary: DayReportSalesSummary = {
    cash: Math.round(sumCash),
    upi: Math.round(sumUpi),
    card: Math.round(sumCard),
    razorpay: Math.round(sumRazorpay),
    discount: Math.round(sumDiscount),
    protocolCount,
    grandTotal: Math.round(sumCash + sumUpi + sumCard + sumRazorpay),
  }

  // ── Third-party vendor shares ─────────────────────────────────────────
  const vendorAgg = new Map<
    string,
    {
      sales: number
      tax: number
      net: number
      tpShare: number
      asgShare: number
      vendorGst: number
      companyGst: number
      vendorTotal: number
      companyTotal: number
    }
  >()

  const emptyAgg = () => ({
    sales: 0,
    tax: 0,
    net: 0,
    tpShare: 0,
    asgShare: 0,
    vendorGst: 0,
    companyGst: 0,
    vendorTotal: 0,
    companyTotal: 0,
  })

  for (const txn of transactions) {
    const items = txn.items ?? []
    const hasItemVendorData = items.some((item) => item.vendorId)

    // Prefer item-level aggregation when items carry per-vendor data.
    // This correctly handles multi-vendor transactions (e.g. SEERAMREDDY + Karthik
    // in the same cart) where each item has its own vendorId and split amounts.
    if (hasItemVendorData) {
      for (const item of items) {
        if (!item.vendorId) continue

        const existing = vendorAgg.get(item.vendorId) ?? emptyAgg()
        const vBase = item.vendorBase ?? 0
        const vGst = item.vendorGst ?? 0
        const cBase = item.companyBase ?? 0
        const cGst = item.companyGst ?? 0
        const vTotal = item.vendorTotal ?? vBase + vGst
        const cTotal = item.companyTotal ?? cBase + cGst

        existing.sales += vBase + vGst + cBase + cGst
        existing.tax += vGst + cGst
        existing.net += vBase + cBase
        existing.tpShare += vBase
        existing.asgShare += cBase
        existing.vendorGst += vGst
        existing.companyGst += cGst
        existing.vendorTotal += vTotal
        existing.companyTotal += cTotal
        vendorAgg.set(item.vendorId, existing)
      }
      continue
    }

    // Fallback: transaction-level vendor data (old records without item-level splits)
    if (txn.vendorId) {
      const vTotal = txn.vendorTotal ?? (txn.vendorBase ?? 0) + (txn.vendorGst ?? 0)
      const cTotal = txn.companyTotal ?? (txn.companyBase ?? 0) + (txn.companyGst ?? 0)

      const existing = vendorAgg.get(txn.vendorId) ?? emptyAgg()
      existing.sales += txn.totalAmount || 0
      existing.tax += txn.gstAmount ?? 0
      existing.net += txn.baseAmount ?? 0
      existing.tpShare += txn.vendorBase ?? 0
      existing.asgShare += txn.companyBase ?? 0
      existing.vendorGst += txn.vendorGst ?? 0
      existing.companyGst += txn.companyGst ?? 0
      existing.vendorTotal += vTotal
      existing.companyTotal += cTotal
      vendorAgg.set(txn.vendorId, existing)
    }
  }

  // Fetch vendor names + type (non-critical — fallback to empty if Firestore fails)
  const vendorIds = [...vendorAgg.keys()]
  let vendorInfoMap: Map<string, { name: string; vendorType: string }>
  try {
    vendorInfoMap = await fetchVendorInfo(vendorIds)
  } catch {
    vendorInfoMap = new Map()
  }

  const vendorShares: DayReportVendorRow[] = vendorIds.map((vid) => {
    const agg = vendorAgg.get(vid)!
    const info = vendorInfoMap.get(vid)
    // Fallback: infer type from vendorGst — SubLease has vendorGst=0
    const vendorType = info?.vendorType ?? (agg.vendorGst === 0 ? 'Sublease' : 'Third-Party')
    return {
      vendorName: info?.name ?? vid,
      vendorType,
      sales: Math.round(agg.sales * 100) / 100,
      tax: Math.round(agg.tax * 100) / 100,
      net: Math.round(agg.net * 100) / 100,
      tpShare: Math.round(agg.vendorTotal * 100) / 100,
      asgShare: Math.round(agg.companyTotal * 100) / 100,
    }
  })

  const vendorTotals = vendorShares.reduce(
    (acc, row) => ({
      sales: acc.sales + row.sales,
      tax: acc.tax + row.tax,
      net: acc.net + row.net,
      tpShare: acc.tpShare + row.tpShare,
      asgShare: acc.asgShare + row.asgShare,
    }),
    { sales: 0, tax: 0, net: 0, tpShare: 0, asgShare: 0 },
  )

  // ── Vendor Summary (new — aggregate third-party/sublease totals) ────
  // Reserved for future per-vendor/per-company breakdown rendering — keep
  // the accumulator logic so the shape is ready when consumers need it.
  let _totalVendorShare = 0,
    _totalCompanyShare = 0
  for (const [, agg] of vendorAgg) {
    _totalVendorShare += agg.vendorTotal
    _totalCompanyShare += agg.companyTotal
  }

  const vendorSummary: DayReportVendorSummary = {
    baseAmount: Math.round(vendorTotals.net * 100) / 100,
    gstAmount: Math.round(vendorTotals.tax * 100) / 100,
    thirdPartyShare: Math.round(vendorTotals.tpShare * 100) / 100,
    companyShare: Math.round(vendorTotals.asgShare * 100) / 100,
  }

  return {
    locationName: getLocationDisplayName(locationSlug),
    date,
    sales,
    totalSales,
    vendorShares,
    vendorTotals,
    transactionCount: transactions.length,
    salesSummary,
    vendorSummary,
  }
}
