import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Download, ChevronRight } from 'lucide-react'
import { fmtDateTimeReportIST, fmtDateReportIST } from '../../../lib/date-format'
import type { GameTransactionDetail } from '../../api/types'
import { useAuth } from '../../features/auth/auth-context'
import { DataTable } from './DataTable'
import { SummaryCards } from './SummaryCards'

const PAGE_SIZE = 20

const currency = (value: number): string => `INR ${Math.round(value || 0).toLocaleString('en-IN')}`

const formatDateTime = (value: string): string => {
  // Date-only strings (legacy YYYY-MM-DD records) — show date only, no fake 05:30 AM time
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fmtDateReportIST(value)
  }
  return fmtDateTimeReportIST(value)
}

const sourceBadgeClass: Record<string, string> = {
  POS: 'bg-warning/15 text-warning',
  Booking: 'bg-info/15 text-info',
  Admin: 'bg-accent/15 text-accent',
}

const exportToCsv = (filename: string, headers: string[], rows: string[][]) => {
  const escape = (val: string) => `"${val.replace(/"/g, '""')}"`
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) {
    lines.push(row.map(escape).join(','))
  }
  const blob = new Blob([lines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export interface GameDrillDownModalProps {
  gameName: string
  transactions: GameTransactionDetail[]
  locationId?: string
  locationName?: string
  onClose: () => void
}

export const GameDrillDownModal = ({
  gameName,
  transactions,
  locationId,
  locationName,
  onClose,
}: GameDrillDownModalProps) => {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const { session } = useAuth()
  // Vendors have a dedicated vendor-facing revenue page with download
  // controls tuned to their data. Exposing the generic cross-transaction
  // export here just confuses the vendor UX — hide it for ThirdParty.
  const canExport = session?.user.role !== 'ThirdParty'

  // Keep onClose in a ref so the listener-binding effect stays stable across
  // re-renders. Otherwise a fresh `onClose` from the parent re-binds the
  // global keydown listener on every keystroke in any descendant input.
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

  // Filter by location if branch-specific drill-down
  const filtered = useMemo(
    () => (locationId ? transactions.filter((t) => t.locationId === locationId) : transactions),
    [transactions, locationId],
  )

  const summary = useMemo(() => {
    let totalRevenue = 0
    let bookingRevenue = 0
    let posRevenue = 0
    let adminBookingRevenue = 0
    let telecallerRevenue = 0
    for (const t of filtered) {
      totalRevenue += t.amount
      if (t.source === 'POS') posRevenue += t.amount
      else if (t.source === 'Telecaller') telecallerRevenue += t.amount
      else if (t.source === 'Admin') adminBookingRevenue += t.amount
      else bookingRevenue += t.amount
    }
    return {
      totalRevenue,
      bookingRevenue,
      posRevenue,
      adminBookingRevenue,
      telecallerRevenue,
      totalTransactions: filtered.length,
    }
  }, [filtered])

  const visibleTransactions = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  )

  const hasMore = visibleCount < filtered.length

  const handleExport = useCallback(() => {
    const headers = [
      'Booking ID',
      'Date & Time',
      'Amount',
      'Source',
      'Payment Status',
      'Location',
      'Items',
    ]
    const rows = filtered.map((t) => [
      t.bookingId,
      formatDateTime(t.dateTime),
      String(t.amount),
      t.source,
      t.paymentStatus,
      t.locationName,
      t.items.join('; '),
    ])
    const branchSuffix = locationName ? `_${locationName}` : ''
    exportToCsv(`${gameName}${branchSuffix}_transactions.csv`, headers, rows)
  }, [filtered, gameName, locationName])

  const breadcrumb = ['Reports', ...(locationName ? [locationName] : []), gameName]

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-base/75 p-4 pt-12 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-5xl rounded-2xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="min-w-0">
            <nav className="mb-1 flex items-center gap-1 text-xs text-muted">
              {breadcrumb.map((segment, i) => (
                <span key={segment} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3" />}
                  <span className={i === breadcrumb.length - 1 ? 'font-semibold text-text' : ''}>
                    {segment}
                  </span>
                </span>
              ))}
            </nav>
            <h2 className="text-lg font-semibold text-text">{gameName} — Transaction Details</h2>
          </div>
          <div className="flex items-center gap-2">
            {filtered.length > 0 && canExport && (
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface/80"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-text"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-6">
          <div className="space-y-5">
            {/* Summary */}
            <SummaryCards
              items={[
                {
                  id: 'dd-total',
                  label: 'Total Revenue',
                  value: currency(summary.totalRevenue),
                  tone: 'success',
                },
                {
                  id: 'dd-txns',
                  label: 'Transactions',
                  value: String(summary.totalTransactions),
                  tone: 'info',
                },
                {
                  id: 'dd-booking',
                  label: 'Booking Revenue',
                  value: currency(summary.bookingRevenue),
                  tone: 'info',
                },
                {
                  id: 'dd-pos',
                  label: 'POS Revenue',
                  value: currency(summary.posRevenue),
                  tone: 'warning',
                },
              ]}
            />

            {summary.adminBookingRevenue > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface/40 px-4 py-2 text-sm text-muted">
                Admin Booking Revenue:{' '}
                <span className="font-semibold text-text">
                  {currency(summary.adminBookingRevenue)}
                </span>
              </div>
            )}

            {summary.telecallerRevenue > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface/40 px-4 py-2 text-sm text-muted">
                Telecaller Revenue:{' '}
                <span className="font-semibold text-text">
                  {currency(summary.telecallerRevenue)}
                </span>
              </div>
            )}

            {/* Transactions table */}
            <DataTable
              columns={[
                {
                  key: 'bookingId',
                  header: 'Booking ID',
                  render: (row: GameTransactionDetail) => (
                    <span className="font-mono text-xs">
                      {row.bookingId.length > 12
                        ? `${row.bookingId.slice(0, 12)}...`
                        : row.bookingId}
                    </span>
                  ),
                },
                {
                  key: 'dateTime',
                  header: 'Date & Time',
                  render: (row: GameTransactionDetail) => formatDateTime(row.dateTime),
                },
                {
                  key: 'amount',
                  header: 'Amount',
                  render: (row: GameTransactionDetail) => currency(row.amount),
                },
                {
                  key: 'source',
                  header: 'Source',
                  render: (row: GameTransactionDetail) => (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sourceBadgeClass[row.source] ?? 'bg-surface text-muted'}`}
                    >
                      {row.source}
                    </span>
                  ),
                },
                {
                  key: 'paymentStatus',
                  header: 'Payment',
                  render: (row: GameTransactionDetail) => (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.paymentStatus === 'completed'
                          ? 'bg-success/15 text-success'
                          : row.paymentStatus === 'pending'
                            ? 'bg-warning/15 text-warning'
                            : 'bg-critical/15 text-critical'
                      }`}
                    >
                      {row.paymentStatus}
                    </span>
                  ),
                },
                {
                  key: 'location',
                  header: 'Location',
                  render: (row: GameTransactionDetail) => row.locationName,
                },
                {
                  key: 'items',
                  header: 'Items',
                  render: (row: GameTransactionDetail) => (
                    <span className="text-xs text-muted">{row.items.join(', ')}</span>
                  ),
                },
              ]}
              rows={visibleTransactions}
              rowKey={(row) => row.bookingId}
              emptyMessage="No transactions found for this game."
            />

            {/* Load More */}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                  className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface/80"
                >
                  Load More ({filtered.length - visibleCount} remaining)
                </button>
              </div>
            )}

            {filtered.length > 0 && (
              <p className="text-center text-xs text-muted">
                Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} transactions
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
