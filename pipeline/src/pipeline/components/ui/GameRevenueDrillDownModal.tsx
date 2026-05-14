import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Download, ChevronRight, ExternalLink } from 'lucide-react'
import { fmtSmartDateTimeIST } from '../../../lib/date-format'
import { branchIdToDisplayName } from '../../../lib/locations'
import { useAuth } from '../../features/auth/auth-context'
import type { TransactionRecord } from '../../api/types'

const currency = (value: number): string => `INR ${Math.round(value || 0).toLocaleString('en-IN')}`

/**
 * Drill-down spec. Always carries a gameId for game-level drill, optionally
 * narrows to a sub-game / variant for the variant-level drill.
 */
export interface GameRevenueDrillDownSpec {
  gameId: string
  gameName: string
  subGameId?: string
  subGameName?: string
  variantId?: string
  variantName?: string
  /** Optional location scope (only show bookings at this branch). */
  locationId?: string
  locationName?: string
}

export interface GameRevenueDrillDownModalProps {
  spec: GameRevenueDrillDownSpec
  /** All transactions already loaded by the parent module — filtered here. */
  transactions: TransactionRecord[]
  /** Vendor scope from the page filter, if any (matches `aggregateGameRevenue`). */
  vendorId?: string
  /** Window (YYYY-MM-DD inclusive) the parent has applied; we filter to the same. */
  fromDate: string
  toDate: string
  /** Caller for opening the full booking-details modal on click. */
  onOpenBooking?: (booking: TransactionRecord) => void
  onClose: () => void
}

interface Row {
  txn: TransactionRecord
  matchedQuantity: number
  matchedTotal: number
  matchedVendorTotal: number
  itemNames: string[]
  refundedItems: number
}

type SortKey = 'date' | 'customer' | 'amount' | 'qty' | 'source' | 'paymentStatus' | 'location'

type Item = NonNullable<TransactionRecord['items']>[number]

const matchesSpec = (item: Item, spec: GameRevenueDrillDownSpec): boolean => {
  if (!item) return false
  if ((item.gameId ?? 'unknown') !== spec.gameId) return false
  if (spec.subGameId && (item.subGameId ?? 'unknown') !== spec.subGameId) return false
  if (spec.variantId && (item.variantId ?? item.itemName ?? 'unknown') !== spec.variantId) {
    return false
  }
  return true
}

const exportToCsv = (filename: string, headers: string[], rows: string[][]) => {
  const escape = (val: string) => `"${val.replace(/"/g, '""')}"`
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) lines.push(row.map(escape).join(','))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export const GameRevenueDrillDownModal = ({
  spec,
  transactions,
  vendorId,
  fromDate,
  toDate,
  onOpenBooking,
  onClose,
}: GameRevenueDrillDownModalProps) => {
  const { session } = useAuth()
  const isPrivileged = session
    ? ['Owner', 'Admin', 'Developer', 'Backend'].includes(session.user.role)
    : false
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Keep onClose in a ref so the listener-binding effect stays stable. The
  // search input below would otherwise lose typing rhythm whenever the
  // parent re-rendered with a new onClose identity.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [])

  // Build one row per transaction whose items contain at least one match.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const txn of transactions) {
      if (txn.cancelled) continue
      if (txn.paymentStatus && txn.paymentStatus !== 'completed') continue
      if (txn.refundStatus === 'Full') continue
      const txnDay = (txn.transactionDate ?? '').slice(0, 10)
      if (txnDay && (txnDay < fromDate || txnDay > toDate)) continue
      if (spec.locationId && txn.locationId !== spec.locationId) continue

      const items = txn.items ?? []
      let matchedQuantity = 0
      let matchedTotal = 0
      let matchedVendorTotal = 0
      let refunded = 0
      const matchedNames = new Set<string>()
      for (const it of items) {
        if (!matchesSpec(it, spec)) continue
        if (vendorId && it.vendorId !== vendorId) continue
        const qty = Number(it.quantity) || 0
        const baseGst = (Number(it.itemBaseAmount) || 0) + (Number(it.itemGstAmount) || 0)
        const lineTotal = baseGst > 0 ? baseGst : (Number(it.unitPrice) || 0) * qty
        const vendorLine = it.vendorTotal !== undefined ? Number(it.vendorTotal) : 0
        if (it.refunded === true) {
          refunded += 1
          continue
        }
        matchedQuantity += qty
        matchedTotal += lineTotal
        matchedVendorTotal += vendorLine
        if (it.itemName) matchedNames.add(it.itemName)
      }
      if (matchedQuantity === 0 && refunded === 0) continue
      out.push({
        txn,
        matchedQuantity,
        matchedTotal: Math.round(matchedTotal),
        matchedVendorTotal: Math.round(matchedVendorTotal),
        itemNames: Array.from(matchedNames),
        refundedItems: refunded,
      })
    }
    return out
  }, [transactions, spec, vendorId, fromDate, toDate])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const t = r.txn
      const haystack = [
        t.id,
        t.bookingId,
        t.invoiceNumber,
        t.customerName,
        t.customerPhone,
        t.customerEmail,
        t.paymentMethod,
        t.couponCode,
        t.notes,
        t.adminNotes,
        t.locationId,
        t.razorpayOrderId,
        t.razorpayPaymentId,
        ...r.itemNames,
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
        .join(' | ')
      return haystack.includes(q)
    })
  }, [rows, search])

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const copy = [...filteredRows]
    copy.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return (a.txn.transactionDate ?? '').localeCompare(b.txn.transactionDate ?? '') * dir
        case 'customer':
          return (
            (a.txn.customerName ?? '')
              .toLowerCase()
              .localeCompare((b.txn.customerName ?? '').toLowerCase()) * dir
          )
        case 'amount':
          return (a.matchedTotal - b.matchedTotal) * dir
        case 'qty':
          return (a.matchedQuantity - b.matchedQuantity) * dir
        case 'source':
          return (a.txn.source ?? '').localeCompare(b.txn.source ?? '') * dir
        case 'paymentStatus':
          return (a.txn.paymentStatus ?? '').localeCompare(b.txn.paymentStatus ?? '') * dir
        case 'location':
          return (a.txn.locationId ?? '').localeCompare(b.txn.locationId ?? '') * dir
        default:
          return 0
      }
    })
    return copy
  }, [filteredRows, sortBy, sortDir])

  const summary = useMemo(() => {
    let revenue = 0
    let qty = 0
    let vendorRevenue = 0
    for (const r of filteredRows) {
      revenue += r.matchedTotal
      qty += r.matchedQuantity
      vendorRevenue += r.matchedVendorTotal
    }
    return { revenue, qty, vendorRevenue, bookings: filteredRows.length }
  }, [filteredRows])

  const handleExport = useCallback(() => {
    const headers = [
      'Booking ID',
      'Invoice',
      'Date & Time',
      'Customer',
      'Phone',
      'Email',
      'Branch',
      'Source',
      'Payment Method',
      'Payment Status',
      'Items',
      'Quantity',
      'Item Total',
      'Booking Total',
      'Discount',
      'Coupon',
      'Wallet Redeemed',
      'Gift Card Redeemed',
      'Refund Status',
      'Notes',
      'Admin Notes',
    ]
    if (isPrivileged) {
      headers.push('Vendor Total', 'Razorpay Order', 'Razorpay Payment')
    }
    const csvRows = sortedRows.map((r) => {
      const t = r.txn
      const base = [
        t.bookingId ?? t.id,
        t.invoiceNumber ?? '',
        t.transactionDate ?? '',
        t.customerName ?? '',
        t.customerPhone ?? '',
        t.customerEmail ?? '',
        branchIdToDisplayName(t.locationId ?? '') || (t.locationId ?? ''),
        t.source ?? '',
        t.paymentMethod ?? '',
        t.paymentStatus ?? '',
        r.itemNames.join('; '),
        String(r.matchedQuantity),
        String(r.matchedTotal),
        String(t.totalAmount ?? 0),
        String(t.discount ?? t.couponDiscount ?? 0),
        t.couponCode ?? '',
        String(t.walletRedeemed ?? 0),
        String(t.giftCardRedeemed ?? 0),
        t.refundStatus ?? 'None',
        t.notes ?? '',
        t.adminNotes ?? '',
      ]
      if (isPrivileged) {
        base.push(String(r.matchedVendorTotal), t.razorpayOrderId ?? '', t.razorpayPaymentId ?? '')
      }
      return base
    })
    const variantSuffix = spec.variantName ? `_${spec.variantName}` : ''
    const branchSuffix = spec.locationName ? `_${spec.locationName}` : ''
    exportToCsv(
      `${spec.gameName}${variantSuffix}${branchSuffix}_bookings.csv`.replace(/\s+/g, '_'),
      headers,
      csvRows,
    )
  }, [sortedRows, spec, isPrivileged])

  const breadcrumb = [
    'Game Revenue',
    spec.locationName ?? 'All Branches',
    spec.gameName,
    ...(spec.subGameName ? [spec.subGameName] : []),
    ...(spec.variantName ? [spec.variantName] : []),
  ]

  const SortHeader = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => {
        if (sortBy === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
        else {
          setSortBy(k)
          setSortDir('desc')
        }
      }}
      className="inline-flex items-center gap-1 hover:text-text"
    >
      {label}
      {sortBy === k ? <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-base/75 p-4 pt-12 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-7xl rounded-2xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted">
              {breadcrumb.map((segment, i) => (
                <span key={`${segment}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3" />}
                  <span className={i === breadcrumb.length - 1 ? 'font-semibold text-text' : ''}>
                    {segment}
                  </span>
                </span>
              ))}
            </nav>
            <h2 className="text-lg font-semibold text-text">
              {spec.variantName
                ? `${spec.variantName} — Booking Details`
                : `${spec.gameName} — Booking Details`}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {fromDate} → {toDate} · {summary.bookings} bookings · {summary.qty} units · Revenue{' '}
              {currency(summary.revenue)}
              {isPrivileged && summary.vendorRevenue > 0
                ? ` · Vendor share ${currency(summary.vendorRevenue)}`
                : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input
              type="search"
              placeholder="Search name / phone / email / booking…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ui-field min-h-9 w-72"
            />
            {sortedRows.length > 0 ? (
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface/80"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-text"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-4">
          {sortedRows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">
              No bookings match this drill-down.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="min-w-full divide-y divide-border/60 text-sm">
                <thead className="bg-surface/45">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">
                      <SortHeader k="date" label="Date & Time" />
                    </th>
                    <th className="px-3 py-2">Booking</th>
                    <th className="px-3 py-2">
                      <SortHeader k="customer" label="Customer" />
                    </th>
                    <th className="px-3 py-2">Phone / Email</th>
                    <th className="px-3 py-2">
                      <SortHeader k="location" label="Branch" />
                    </th>
                    <th className="px-3 py-2">
                      <SortHeader k="source" label="Source" />
                    </th>
                    <th className="px-3 py-2">Item(s)</th>
                    <th className="px-3 py-2 text-right">
                      <SortHeader k="qty" label="Qty" />
                    </th>
                    <th className="px-3 py-2 text-right">
                      <SortHeader k="amount" label="Item Total" />
                    </th>
                    {isPrivileged && <th className="px-3 py-2 text-right">Vendor Share</th>}
                    <th className="px-3 py-2">Payment</th>
                    <th className="px-3 py-2">
                      <SortHeader k="paymentStatus" label="Status" />
                    </th>
                    <th className="px-3 py-2 text-right">Booking Total</th>
                    <th className="px-3 py-2">Coupon / Wallet / Gift</th>
                    <th className="px-3 py-2">Notes</th>
                    {isPrivileged && <th className="px-3 py-2">Razorpay</th>}
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {sortedRows.map((r) => {
                    const t = r.txn
                    return (
                      <tr key={t.id} className="align-top hover:bg-panel/50">
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-text">
                          {fmtSmartDateTimeIST(t.transactionDate)}
                          {t.paymentCompletedAt && t.paymentCompletedAt !== t.transactionDate ? (
                            <div className="mt-0.5 text-[10px] text-muted">
                              Paid {fmtSmartDateTimeIST(t.paymentCompletedAt)}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-mono text-xs text-text">{t.bookingId ?? t.id}</div>
                          {t.invoiceNumber && t.invoiceNumber !== t.id ? (
                            <div className="text-[10px] text-muted">{t.invoiceNumber}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-text">
                          {t.customerName ?? '—'}
                          {t.createdByName ? (
                            <div className="text-[10px] text-muted">via {t.createdByName}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-text">
                          {t.customerPhone ?? '—'}
                          {t.customerEmail ? (
                            <div className="break-all text-[10px] text-muted">
                              {t.customerEmail}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-text">
                          {branchIdToDisplayName(t.locationId ?? '') || (t.locationId ?? '—')}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-text">{t.source ?? '—'}</td>
                        <td className="px-3 py-2.5 text-xs text-text">
                          {r.itemNames.length > 0 ? r.itemNames.join(' · ') : '—'}
                          {r.refundedItems > 0 ? (
                            <div className="text-[10px] text-critical">
                              {r.refundedItems} refunded line(s)
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-text">
                          {r.matchedQuantity}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-text">
                          {currency(r.matchedTotal)}
                        </td>
                        {isPrivileged && (
                          <td className="px-3 py-2.5 text-right text-xs text-muted">
                            {r.matchedVendorTotal > 0 ? currency(r.matchedVendorTotal) : '—'}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-xs text-text">{t.paymentMethod ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              t.paymentStatus === 'completed'
                                ? 'bg-success/15 text-success'
                                : t.paymentStatus === 'failed'
                                  ? 'bg-critical/15 text-critical'
                                  : 'bg-warning/15 text-warning'
                            }`}
                          >
                            {t.paymentStatus ?? '—'}
                          </span>
                          {t.refundStatus && t.refundStatus !== 'None' ? (
                            <div className="mt-1 text-[10px] text-critical">
                              Refund: {t.refundStatus}
                              {t.refundAmount ? ` · ${currency(t.refundAmount)}` : ''}
                            </div>
                          ) : null}
                          {t.cancelled ? (
                            <div className="text-[10px] text-critical">Cancelled</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-text">
                          {currency(t.totalAmount ?? 0)}
                          {t.discount || t.couponDiscount ? (
                            <div className="text-[10px] text-muted">
                              − {currency((t.discount ?? 0) + (t.couponDiscount ?? 0))}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-text">
                          {t.couponCode ? <div>Coupon: {t.couponCode}</div> : null}
                          {t.walletRedeemed ? (
                            <div className="text-muted">Wallet: {currency(t.walletRedeemed)}</div>
                          ) : null}
                          {t.giftCardRedeemed ? (
                            <div className="text-muted">Gift: {currency(t.giftCardRedeemed)}</div>
                          ) : null}
                          {!t.couponCode && !t.walletRedeemed && !t.giftCardRedeemed ? '—' : null}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-text">
                          {t.notes ? <div>{t.notes}</div> : null}
                          {t.adminNotes ? (
                            <div className="text-muted">Admin: {t.adminNotes}</div>
                          ) : null}
                          {!t.notes && !t.adminNotes ? '—' : null}
                        </td>
                        {isPrivileged && (
                          <td className="px-3 py-2.5 text-[10px] text-muted">
                            {t.razorpayOrderId ? <div>Order: {t.razorpayOrderId}</div> : null}
                            {t.razorpayPaymentId ? <div>Pay: {t.razorpayPaymentId}</div> : null}
                            {!t.razorpayOrderId && !t.razorpayPaymentId ? '—' : null}
                          </td>
                        )}
                        <td className="px-3 py-2.5">
                          {onOpenBooking ? (
                            <button
                              type="button"
                              onClick={() => onOpenBooking(t)}
                              className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[10px] font-medium text-text hover:bg-surface/80"
                            >
                              <ExternalLink className="h-3 w-3" />
                              View
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
