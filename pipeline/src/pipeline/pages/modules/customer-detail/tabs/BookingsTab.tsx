/**
 * Customer 360 — Bookings tab.
 *
 * Lists every booking for one customer with branch / status / date-range
 * filters and an "include cancelled / deleted" toggle. Cursor paginated
 * 50/page so loyal customers with hundreds of rows still render fast.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import {
  customerBookingsApi,
  type CustomerBookingRow,
  type CustomerBookingsFilters,
} from '../../../../api/customer-detail/customer-bookings'
import type { BookingStatus, PaymentStatus } from '../../../../api/asquare-bookings'
import { DataTable } from '../../../../components/ui/DataTable'
import { FilterBar, FilterField } from '../../../../components/ui/FilterBar'
import { useLocations } from '../../../../hooks/useLocations'
import { fmtDateIST } from '../../../../../lib/date-format'
import ErrorState from '../../../../../components/ui/ErrorState'

const PAGE_SIZE = 50

const fmt = (n: number) => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

interface Props {
  customerId: string
}

export const BookingsTab = ({ customerId }: Props) => {
  const { enabledLocations } = useLocations()
  const [locationId, setLocationId] = useState('')
  const [bookingStatus, setBookingStatus] = useState<'' | BookingStatus>('')
  const [paymentStatus, setPaymentStatus] = useState<'' | PaymentStatus>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [cursorStack, setCursorStack] = useState<QueryDocumentSnapshot<DocumentData>[]>([])

  // Reset pagination when filters change so the cursor doesn't mismatch.
  // (We deliberately recompute the queryKey rather than wiring an effect —
  // React Query treats the new key as a fresh query, and the cursorStack
  // resets via the explicit setCursorStack([]) below.)
  const filters: CustomerBookingsFilters = {
    locationId: locationId || undefined,
    bookingStatus: bookingStatus || undefined,
    paymentStatus: paymentStatus || undefined,
    // dateFrom / dateTo are already YYYY-MM-DD strings from the date inputs
    // (HTML <input type="date"> emits this exact format), which matches the
    // stamped `visitDate` field. No timezone conversion needed.
    visitDateAfter: dateFrom || undefined,
    visitDateBefore: dateTo || undefined,
  }

  const cursor = cursorStack[cursorStack.length - 1]
  const queryKey = [
    'customer-detail',
    customerId,
    'bookings',
    filters,
    includeDeleted,
    cursorStack.length,
  ] as const

  const q = useQuery({
    queryKey,
    queryFn: () =>
      customerBookingsApi.listBookings(customerId, {
        pageSize: PAGE_SIZE,
        cursor,
        filters,
        includeDeleted,
      }),
    staleTime: 60_000,
  })

  const onFilterChange =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setCursorStack([])
      setter(value)
    }

  const rows: CustomerBookingRow[] = q.data?.items ?? []
  const nextCursor = q.data?.nextCursor ?? null

  return (
    <div>
      <FilterBar>
        <FilterField label="Branch">
          <select
            title="Filter bookings by branch"
            className="ui-field min-h-10"
            value={locationId}
            onChange={(e) => onFilterChange(setLocationId)(e.target.value)}
          >
            <option value="">All branches</option>
            {enabledLocations.map((loc) => (
              <option key={loc.slug} value={loc.slug}>
                {loc.displayName}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Status">
          <select
            title="Booking status"
            className="ui-field min-h-10"
            value={bookingStatus}
            onChange={(e) => onFilterChange(setBookingStatus)(e.target.value as '' | BookingStatus)}
          >
            <option value="">All</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no-show">No-show</option>
          </select>
        </FilterField>
        <FilterField label="Payment">
          <select
            title="Payment status"
            className="ui-field min-h-10"
            value={paymentStatus}
            onChange={(e) => onFilterChange(setPaymentStatus)(e.target.value as '' | PaymentStatus)}
          >
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
        </FilterField>
        <FilterField label="Date from">
          <input
            title="Session date from"
            type="date"
            className="ui-field min-h-10"
            value={dateFrom}
            onChange={(e) => onFilterChange(setDateFrom)(e.target.value)}
          />
        </FilterField>
        <FilterField label="Date to">
          <input
            title="Session date to"
            type="date"
            className="ui-field min-h-10"
            value={dateTo}
            onChange={(e) => onFilterChange(setDateTo)(e.target.value)}
          />
        </FilterField>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-text">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => {
              setCursorStack([])
              setIncludeDeleted(e.target.checked)
            }}
          />
          Include cancelled / deleted
        </label>
      </FilterBar>

      {q.isError ? (
        <ErrorState
          title="Couldn't load bookings"
          description={q.error instanceof Error ? q.error.message : undefined}
          onRetry={() => q.refetch()}
        />
      ) : (
        <DataTable
          columns={[
            {
              key: 'date',
              header: 'Session',
              render: (b: CustomerBookingRow) => (b.sessionDate ? fmtDateIST(b.sessionDate) : '—'),
            },
            { key: 'branch', header: 'Branch', render: (b) => b.locationId || '—' },
            {
              key: 'items',
              header: 'Items',
              render: (b) =>
                b.items?.length
                  ? b.items.map((it) => `${it.activity?.name ?? '?'} × ${it.quantity}`).join(', ')
                  : '—',
            },
            {
              key: 'status',
              header: 'Status',
              render: (b) => (
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    b.deleted
                      ? 'bg-critical/15 text-critical'
                      : b.bookingStatus === 'confirmed' || b.bookingStatus === 'completed'
                        ? 'bg-success/15 text-success'
                        : b.bookingStatus === 'cancelled'
                          ? 'bg-critical/15 text-critical'
                          : 'bg-warning/15 text-warning'
                  }`}
                >
                  {b.deleted ? 'deleted' : b.bookingStatus}
                </span>
              ),
            },
            {
              key: 'amount',
              header: 'Final',
              render: (b) => fmt(b.finalAmount),
            },
            {
              key: 'payment',
              header: 'Payment',
              render: (b) => b.paymentStatus || '—',
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (b) => (
                <Link
                  to={`/bookings/${b.id}`}
                  className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  View
                </Link>
              ),
            },
          ]}
          rows={rows}
          rowKey={(b) => b.id}
          emptyMessage={q.isLoading ? 'Loading bookings…' : 'No bookings found.'}
        />
      )}

      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>
          {rows.length} on this page
          {cursorStack.length > 0 ? ` · page ${cursorStack.length + 1}` : ''}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={cursorStack.length === 0}
            onClick={() => setCursorStack((s) => s.slice(0, -1))}
            className="ui-btn ui-btn-neutral min-h-7 px-3 text-xs"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={!nextCursor}
            onClick={() => {
              if (nextCursor) setCursorStack((s) => [...s, nextCursor])
            }}
            className="ui-btn ui-btn-neutral min-h-7 px-3 text-xs"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
