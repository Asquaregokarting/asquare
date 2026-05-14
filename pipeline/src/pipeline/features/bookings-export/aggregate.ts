import type { AsquareBooking, AsquareBookingItem } from '../../api/asquare-bookings'
import { computeGst, computeRevenueSplit } from '../../../lib/unified-booking'

export type BookingExportVendorType = 'ThirdParty' | 'SubLease'

export interface VendorMetaEntry {
  id: string
  name: string
  vendorType: BookingExportVendorType
  revenueShare: number
}

export interface VendorColumn {
  vendorId: string
  vendorName: string
  vendorType: BookingExportVendorType
  totalAmount: number
}

export interface BookingExportRow {
  serial: number
  bookingId: string
  bookedOn: Date | null
  sessionDate: Date | null
  activity: string
  customerPaid: number
  bookingStatus: string
  companyShare: number
  companyGst: number
  vendorAmounts: Record<string, number>
}

export interface VendorLineItem {
  bookingId: string
  bookedOn: Date | null
  sessionDate: Date | null
  activity: string
  vendorId: string
  vendorName: string
  vendorType: BookingExportVendorType
  sharePercent: number
  vendorBase: number
  vendorGst: number
  vendorTotal: number
}

export interface BookingExportPayload {
  bookingRows: BookingExportRow[]
  vendorColumns: VendorColumn[]
  subleaseColumns: VendorColumn[]
  vendorLineItems: VendorLineItem[]
  subleaseLineItems: VendorLineItem[]
}

interface RawBillingItem {
  itemName?: string
  quantity?: number
  unitPrice?: number
  vendorId?: string
  itemBaseAmount?: number
  itemGstAmount?: number
  vendorSharePercent?: number
  vendorBase?: number
  vendorGst?: number
  vendorTotal?: number
  companyBase?: number
  companyGst?: number
  companyTotal?: number
}

const DEFAULT_VENDOR_SHARE = 80

const toFiniteNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

const toDateOrNull = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (value && typeof value === 'object' && 'toDate' in value) {
    const candidate = value as { toDate?: () => Date }
    if (typeof candidate.toDate === 'function') {
      const d = candidate.toDate()
      return Number.isNaN(d.getTime()) ? null : d
    }
  }
  if (typeof value === 'number') {
    const d = value < 1e12 ? new Date(value * 1000) : new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

const formatActivityLabel = (booking: AsquareBooking): string => {
  const billingItems = (booking as Record<string, unknown>).billingItems as
    | RawBillingItem[]
    | undefined
  const items: Array<{ name: string; quantity: number }> = []
  if (billingItems && billingItems.length > 0) {
    for (const bi of billingItems) {
      items.push({
        name: bi.itemName?.trim() || 'Item',
        quantity: toFiniteNumber(bi.quantity) || 1,
      })
    }
  } else if (booking.items && booking.items.length > 0) {
    for (const it of booking.items) {
      const row = it as AsquareBookingItem
      const name = row.itemName?.trim() || row.activity?.name?.trim() || 'Activity'
      items.push({ name, quantity: row.quantity || 1 })
    }
  }
  if (items.length === 0) return 'No items'
  return items.map((i) => `${i.name} ×${i.quantity}`).join('; ')
}

interface PerVendorAggregate {
  vendorBase: number
  vendorGst: number
  vendorTotal: number
  sharePercent: number
}

interface PerBookingAggregate {
  vendorTotalsByVendorId: Map<string, PerVendorAggregate>
  companyBase: number
  companyGst: number
}

const aggregateFromBillingItems = (billingItems: RawBillingItem[]): PerBookingAggregate => {
  const byVendor = new Map<string, PerVendorAggregate>()
  let companyBase = 0
  let companyGst = 0
  for (const bi of billingItems) {
    const vendorId = bi.vendorId?.trim()
    const vBase = toFiniteNumber(bi.vendorBase)
    const vGst = toFiniteNumber(bi.vendorGst)
    const vTotal = toFiniteNumber(bi.vendorTotal) || vBase + vGst
    const cBase = toFiniteNumber(bi.companyBase)
    const cGst = toFiniteNumber(bi.companyGst)
    const sharePercent = toFiniteNumber(bi.vendorSharePercent)
    companyBase += cBase
    companyGst += cGst
    if (vendorId && (vBase > 0 || vGst > 0 || vTotal > 0)) {
      const prev = byVendor.get(vendorId)
      if (prev) {
        prev.vendorBase += vBase
        prev.vendorGst += vGst
        prev.vendorTotal += vTotal
      } else {
        byVendor.set(vendorId, {
          vendorBase: vBase,
          vendorGst: vGst,
          vendorTotal: vTotal,
          sharePercent,
        })
      }
    }
  }
  return { vendorTotalsByVendorId: byVendor, companyBase, companyGst }
}

const aggregateFromItemsFallback = (
  booking: AsquareBooking,
  vendorMeta: Map<string, VendorMetaEntry>,
): PerBookingAggregate => {
  const byVendor = new Map<string, PerVendorAggregate>()
  let companyBase = 0
  let companyGst = 0
  const items = booking.items || []
  for (const item of items) {
    const qty = item.quantity || 1
    const unitPrice = toFiniteNumber(item.unitPrice ?? item.price)
    const gross = unitPrice * qty
    if (gross <= 0) continue
    const { baseAmount, gstAmount } = computeGst(gross)
    const vendorId = item.vendorId?.trim()
    if (vendorId) {
      const meta = vendorMeta.get(vendorId)
      const sharePercent = meta?.revenueShare ?? DEFAULT_VENDOR_SHARE
      const vendorType = meta?.vendorType ?? 'ThirdParty'
      const split = computeRevenueSplit(baseAmount, gstAmount, sharePercent, vendorType)
      const prev = byVendor.get(vendorId)
      if (prev) {
        prev.vendorBase += split.vendorBase
        prev.vendorGst += split.vendorGst
        prev.vendorTotal += split.vendorTotal
      } else {
        byVendor.set(vendorId, {
          vendorBase: split.vendorBase,
          vendorGst: split.vendorGst,
          vendorTotal: split.vendorTotal,
          sharePercent,
        })
      }
      companyBase += split.companyBase
      companyGst += split.companyGst
    } else {
      companyBase += baseAmount
      companyGst += gstAmount
    }
  }
  return { vendorTotalsByVendorId: byVendor, companyBase, companyGst }
}

const resolveBookingFinancials = (
  booking: AsquareBooking,
  vendorMeta: Map<string, VendorMetaEntry>,
): PerBookingAggregate => {
  const billingItems = (booking as Record<string, unknown>).billingItems as
    | RawBillingItem[]
    | undefined
  if (billingItems && billingItems.length > 0) {
    const fromBilling = aggregateFromBillingItems(billingItems)
    if (
      fromBilling.companyBase > 0 ||
      fromBilling.companyGst > 0 ||
      fromBilling.vendorTotalsByVendorId.size > 0
    ) {
      return fromBilling
    }
  }
  const txnCompanyBase = toFiniteNumber((booking as Record<string, unknown>).companyBase)
  const txnCompanyGst = toFiniteNumber((booking as Record<string, unknown>).companyGst)
  const txnVendorBase = toFiniteNumber((booking as Record<string, unknown>).vendorBase)
  const txnVendorId =
    typeof (booking as Record<string, unknown>).vendorId === 'string'
      ? String((booking as Record<string, unknown>).vendorId)
      : ''
  if (
    (txnCompanyBase > 0 || txnCompanyGst > 0 || txnVendorBase > 0) &&
    !(booking.items && booking.items.some((i) => i.vendorId))
  ) {
    const byVendor = new Map<string, PerVendorAggregate>()
    if (txnVendorId && txnVendorBase > 0) {
      const txnVendorGst = toFiniteNumber((booking as Record<string, unknown>).vendorGst)
      byVendor.set(txnVendorId, {
        vendorBase: txnVendorBase,
        vendorGst: txnVendorGst,
        vendorTotal: txnVendorBase + txnVendorGst,
        sharePercent: toFiniteNumber((booking as Record<string, unknown>).vendorSharePercent),
      })
    }
    return {
      vendorTotalsByVendorId: byVendor,
      companyBase: txnCompanyBase,
      companyGst: txnCompanyGst,
    }
  }
  return aggregateFromItemsFallback(booking, vendorMeta)
}

const lookupVendor = (
  vendorId: string,
  vendorMeta: Map<string, VendorMetaEntry>,
): VendorMetaEntry => {
  const meta = vendorMeta.get(vendorId)
  if (meta) return meta
  return {
    id: vendorId,
    name: `Unknown (${vendorId.slice(0, 6)})`,
    vendorType: 'ThirdParty',
    revenueShare: DEFAULT_VENDOR_SHARE,
  }
}

export const buildBookingExportRows = (
  bookings: AsquareBooking[],
  vendorMetaList: VendorMetaEntry[],
): BookingExportPayload => {
  const vendorMeta = new Map<string, VendorMetaEntry>(vendorMetaList.map((v) => [v.id, v]))

  const bookingRows: BookingExportRow[] = []
  const vendorLineItems: VendorLineItem[] = []
  const subleaseLineItems: VendorLineItem[] = []
  const vendorTotals = new Map<string, VendorColumn>()

  bookings.forEach((booking, idx) => {
    const aggregate = resolveBookingFinancials(booking, vendorMeta)
    const bookedOn = toDateOrNull((booking as Record<string, unknown>).createdAt)
    const sessionDate = toDateOrNull((booking as Record<string, unknown>).sessionDate)
    const activity = formatActivityLabel(booking)
    const vendorAmounts: Record<string, number> = {}

    for (const [vendorId, agg] of aggregate.vendorTotalsByVendorId.entries()) {
      const meta = lookupVendor(vendorId, vendorMeta)
      vendorAmounts[vendorId] = agg.vendorTotal

      const lineItem: VendorLineItem = {
        bookingId: booking.id,
        bookedOn,
        sessionDate,
        activity,
        vendorId,
        vendorName: meta.name,
        vendorType: meta.vendorType,
        sharePercent: agg.sharePercent || meta.revenueShare,
        vendorBase: agg.vendorBase,
        vendorGst: agg.vendorGst,
        vendorTotal: agg.vendorTotal,
      }
      if (meta.vendorType === 'SubLease') {
        subleaseLineItems.push(lineItem)
      } else {
        vendorLineItems.push(lineItem)
      }

      const existing = vendorTotals.get(vendorId)
      if (existing) {
        existing.totalAmount += agg.vendorTotal
      } else {
        vendorTotals.set(vendorId, {
          vendorId,
          vendorName: meta.name,
          vendorType: meta.vendorType,
          totalAmount: agg.vendorTotal,
        })
      }
    }

    bookingRows.push({
      serial: idx + 1,
      bookingId: booking.id,
      bookedOn,
      sessionDate,
      activity,
      customerPaid: toFiniteNumber(booking.finalAmount),
      bookingStatus: String(booking.bookingStatus ?? ''),
      companyShare: aggregate.companyBase,
      companyGst: aggregate.companyGst,
      vendorAmounts,
    })
  })

  const sortedColumns = Array.from(vendorTotals.values()).sort((a, b) => {
    if (b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount
    return a.vendorName.localeCompare(b.vendorName)
  })
  const vendorColumns = sortedColumns.filter((c) => c.vendorType === 'ThirdParty')
  const subleaseColumns = sortedColumns.filter((c) => c.vendorType === 'SubLease')

  return {
    bookingRows,
    vendorColumns,
    subleaseColumns,
    vendorLineItems,
    subleaseLineItems,
  }
}
