import { useMemo, useState } from 'react'
import { AsquareBooking, asquareBookingsApi } from '../../../api/asquare-bookings'
import { listVendorOptions } from '../../../api/reconciliation-firestore'
import { exportBookingsExcel } from '../../../features/bookings-export/excel-export'
import type { VendorMetaEntry } from '../../../features/bookings-export/aggregate'
import { logger } from '../../../../lib/logger'
import { StatusBadge } from '../../../components/ui/StatusBadge'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { BookingsStateLine } from './BookingsStateLine'
import { BookingsToolbar, type ToolbarMoreItem } from './BookingsToolbar'
import { BookingsFilterChips } from './BookingsFilterChips'
import { useAuth } from '../../../features/auth/auth-context'
import { useLocations } from '../../../hooks/useLocations'
import { fmtDateTimeFullIST, fmtDateIST } from '../../../../lib/date-format'
import { getLocationShortName } from '../../../../lib/locations'
import { useBookingsData } from './useBookingsData'
import { useBookingFilters } from './useBookingFilters'
import { usePrintTicket } from './usePrintTicket'
import EditBookingModal from './EditBookingModal'
import BookingDetailsModal from './BookingDetailsModal'
import ReplaceActivityModal from './ReplaceActivityModal'
import RefundBookingModal from './RefundBookingModal'
import SwapsTodayModal from './SwapsTodayModal'
import ActivityAvailabilityModal from './ActivityAvailabilityModal'
import { ScanBoardingDialog } from './ScanBoardingDialog'
import { RowMoreMenu, type MoreMenuItem } from './RowMoreMenu'
import {
  ASQUARE_WEB_BASE_URL,
  formatBookingItems,
  formatCurrency,
  formatDateInput,
  formatPaymentMethod,
  isGoKartBooking,
  isHelicopter,
  isOnlinePayment,
  normalizeRole,
} from './bookings-utils'

const AllBookingsView = () => {
  const { session } = useAuth()
  const { enabledLocations } = useLocations()
  const ADMIN_LOCATIONS = useMemo(
    () => enabledLocations.map((l) => ({ id: l.slug, name: l.displayName })),
    [enabledLocations],
  )
  const role = normalizeRole(session?.user.role)
  const actor = {
    id: session?.user.id || 'unknown',
    name: session?.user.name || 'Unknown',
    role,
  }

  const canManageAdvanced = !['thirdparty', 'telecaller'].includes(role)
  const canDelete = ['owner', 'admin'].includes(role)
  const canBulkDelete = !['thirdparty', 'telecaller', 'cashier'].includes(role)

  const [activeLocation, setActiveLocation] = useState('all')
  const {
    bookings,
    loading,
    error,
    setError,
    success,
    setSuccess,
    verifyingPayment,
    applyUpdate,
    cancelBooking,
    verifyPaymentFromRazorpay,
    loadBookings,
  } = useBookingsData(activeLocation, actor)

  const {
    searchTerm,
    setSearchTerm,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    gameFilter,
    setGameFilter,
    statusFilter,
    setStatusFilter,
    checkInFilter,
    setCheckInFilter,
    paymentStatusFilter,
    setPaymentStatusFilter,
    paymentMethodFilter,
    setPaymentMethodFilter,
    initiatedByFilter,
    setInitiatedByFilter,
    amountMin,
    setAmountMin,
    amountMax,
    setAmountMax,
    eventsOnly,
    setEventsOnly,
    sortConfig,
    setSortConfig,
    setCurrentPage,
    selectedBookings,
    setSelectedBookings,
    uniqueGames,
    uniquePaymentMethods,
    uniqueInitiators,
    filteredBookings,
    paymentStats,
    totalPages,
    page,
    paged,
    clearFilters,
  } = useBookingFilters(bookings, role)

  const toggleSort = (key: string) => {
    setSortConfig((c) => ({
      key,
      direction: c.key === key && c.direction === 'desc' ? 'asc' : 'desc',
    }))
  }

  const sortArrow = (key: string) =>
    sortConfig.key === key ? (sortConfig.direction === 'asc' ? ' \u2191' : ' \u2193') : ''

  const {
    printTicket,
    reprintConfirm,
    resolveReprintConfirm,
    reprintMessage,
    clearReprintMessage,
  } = usePrintTicket(actor)

  const [confirmDeleteBooking, setConfirmDeleteBooking] = useState<AsquareBooking | null>(null)
  const [editAllBooking, setEditAllBooking] = useState<AsquareBooking | null>(null)
  const [swapBooking, setSwapBooking] = useState<AsquareBooking | null>(null)
  const [refundBooking, setRefundBooking] = useState<AsquareBooking | null>(null)
  const [showSwapsToday, setShowSwapsToday] = useState(false)
  const [showAvailability, setShowAvailability] = useState(false)
  const [detailsBooking, setDetailsBooking] = useState<AsquareBooking | null>(null)
  const [showScanDialog, setShowScanDialog] = useState(false)
  const canViewSwapDigest = ['owner', 'admin'].includes(role)
  const canManageAvailability = ['owner', 'admin'].includes(role)

  // Delete from the live list = move to Trash. Always allowed (no lock
  // or vendor-paid guards); the booking can be restored from Trash, and
  // the strict guards run on permanent-delete from the Trash view.
  const handleDeleteBooking = async (booking: AsquareBooking) => {
    setError(null)
    setConfirmDeleteBooking(booking)
  }

  const executeDelete = async () => {
    if (!confirmDeleteBooking) return
    const booking = confirmDeleteBooking
    setConfirmDeleteBooking(null)
    const ok = await asquareBookingsApi.softDeleteBooking(booking.id, booking.userId, actor)
    if (ok) {
      setSuccess(`Booking ${booking.id} moved to Trash. Restore from Trash if needed.`)
      void loadBookings()
    } else {
      setError('Failed to move booking to Trash. Please try again.')
    }
  }

  // Bulk actions — bulk-Verify + bulk-Cancel run sequentially per booking
  // so a single failure doesn't block the rest. Status messages summarize
  // counts the way the existing bulk-delete bar does.
  const [bulkRunning, setBulkRunning] = useState(false)

  const handleBulkVerify = async () => {
    if (!selectedBookings.size || bulkRunning) return
    setBulkRunning(true)
    setError(null)
    const targets = Array.from(selectedBookings)
      .map((id) => bookings.find((b) => b.id === id))
      .filter(
        (b): b is AsquareBooking =>
          Boolean(b) && b!.paymentStatus !== 'completed' && isOnlinePayment(b!),
      )
    // verifyPaymentFromRazorpay is fire-and-forget (no boolean return).
    // Run sequentially so Razorpay rate-limits don't trip; surface only
    // the attempt count to the user. Per-booking failure goes to the
    // existing per-booking error path inside the hook.
    for (const b of targets) {
      await verifyPaymentFromRazorpay(b)
    }
    setBulkRunning(false)
    if (targets.length > 0) setSuccess(`Re-checked ${targets.length} payment(s).`)
    else setError('None of the selected bookings have a re-checkable online payment.')
  }

  const handleBulkCancel = async () => {
    if (!selectedBookings.size || bulkRunning) return
    setBulkRunning(true)
    setError(null)
    const targets = Array.from(selectedBookings)
      .map((id) => bookings.find((b) => b.id === id))
      .filter(
        (b): b is AsquareBooking =>
          Boolean(b) && b!.bookingStatus !== 'cancelled' && b!.bookingStatus !== 'completed',
      )
    for (const b of targets) {
      await cancelBooking(b)
    }
    setBulkRunning(false)
    if (targets.length > 0) {
      setSuccess(`Cancelled ${targets.length} booking(s).`)
      setSelectedBookings(new Set())
      void loadBookings()
    } else {
      setError('None of the selected bookings can be cancelled (already cancelled or completed).')
    }
  }

  // Bulk move-to-Trash. No lock or vendor-paid pre-flight: soft-delete
  // is reversible, so the strict guards run only on permanent-delete
  // from the Trash UI.
  const handleBulkDelete = async () => {
    if (!selectedBookings.size) return
    const targets = Array.from(selectedBookings)
      .map((id) => bookings.find((e) => e.id === id))
      .filter((b): b is AsquareBooking => Boolean(b))
    const results = await Promise.all(
      targets.map(async (booking) => {
        const ok = await asquareBookingsApi.softDeleteBooking(booking.id, booking.userId, actor)
        return { booking, ok }
      }),
    )
    const moved = results.filter((r) => r.ok)
    const failed = results.filter((r) => !r.ok).map((r) => r.booking.id)
    setSelectedBookings(new Set())
    if (moved.length) {
      setSuccess(`Moved ${moved.length} booking(s) to Trash. Restore from the Trash tab if needed.`)
      void loadBookings()
    }
    if (failed.length)
      setError(`${failed.length} booking(s) failed to move to Trash:\n${failed.join('\n')}`)
  }

  // Reschedule and Quantity used to live as separate row buttons backed by
  // window.prompt(). Both operations are already covered by the
  // EditBookingModal (opened via the "Edit All" button), and a styled
  // form is strictly better than a native prompt — so the inline
  // prompt-based handlers were removed. Owners now click "Edit All" and
  // change the relevant field there.

  const onScanSubmit = async (payload: string) => {
    setShowScanDialog(false)
    const cleaned = payload.trim()
    const bookingId = cleaned.includes(':') ? cleaned.split(':')[1] || '' : cleaned
    if (!bookingId) {
      setError('Invalid scan payload.')
      return
    }
    const booking = bookings.find((e) => e.id === bookingId)
    if (!booking) return setError('Booking not found.')
    if (booking.bookingStatus === 'cancelled')
      return setError(`Booking ${booking.id} is cancelled.`)
    if (booking.checkInStatus === 'boarded')
      return setError(`Booking ${booking.id} already boarded.`)
    await applyUpdate(booking, { checkInStatus: 'boarded' }, `Boarded ${booking.id}.`)
  }

  const handleEditAllSave = async (booking: AsquareBooking, updates: Partial<AsquareBooking>) => {
    await applyUpdate(booking, updates, `Updated ${booking.id}.`)
    setEditAllBooking(null)
    if (updates.paymentStatus === 'completed') {
      void asquareBookingsApi.confirmRazorpayOrder({
        orderNumber: booking.id,
        razorpayPaymentId: String(booking.paymentId ?? ''),
        razorpayOrderId: String(booking.razorpayOrderId ?? ''),
      })
      const { onBookingPaidById } = await import('../../../../lib/booking-vendor-payout')
      void onBookingPaidById(booking.id)
    }
  }

  const handlePrintTicket = async (booking: AsquareBooking) => {
    const result = await printTicket(booking)
    if (!result.success && result.message) setError(result.message)
  }

  const [exportingExcel, setExportingExcel] = useState(false)

  const exportExcel = async () => {
    if (exportingExcel) return
    setExportingExcel(true)
    try {
      const vendors = await listVendorOptions()
      const vendorMeta: VendorMetaEntry[] = vendors.map((v) => ({
        id: v.id,
        name: v.name,
        vendorType: v.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty',
        revenueShare: v.revenueShare,
      }))
      const filename = `bookings_full_${formatDateInput(new Date())}.xlsx`
      await exportBookingsExcel(filteredBookings, vendorMeta, filename)
      setSuccess(`Exported ${filteredBookings.length} booking(s) to Excel.`)
    } catch (err) {
      logger.error('bookings.excelExport.failed', err, {
        bookingCount: filteredBookings.length,
      })
      setError('Failed to export bookings to Excel. Please try again.')
    } finally {
      setExportingExcel(false)
    }
  }

  const exportCSV = () => {
    const headers = [
      'Booking ID',
      'Customer',
      'Phone',
      'Amount',
      'Booking Status',
      'Payment Status',
      'Payment Method',
    ]
    const rows = filteredBookings.map((b) =>
      [
        b.id,
        String(b.userDisplayName ?? 'Unknown'),
        String(b.userPhone ?? b.userId),
        String(b.finalAmount),
        b.bookingStatus,
        b.paymentStatus,
        String(b.paymentMethod ?? ''),
      ]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(','),
    )
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `bookings_export_${formatDateInput(new Date())}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const getSourceBadge = (booking: AsquareBooking) => {
    const bRole = String(booking.createdByRole ?? '').toLowerCase()
    const src = String(booking.source ?? '')
    const isTc = bRole === 'telecaller'
    const isAdmin = src === 'ADMIN_BOOKING' || (!src && !!booking.createdByAdminId)
    const label =
      booking.sourceType === 'BILLING'
        ? 'Billing'
        : src === 'POS'
          ? 'POS'
          : isTc
            ? 'Telecaller'
            : isAdmin
              ? 'Admin'
              : 'App'
    const cls =
      booking.sourceType === 'BILLING'
        ? 'bg-accent/15 text-accent'
        : isAdmin || isTc
          ? 'bg-info/15 text-info'
          : src === 'POS'
            ? 'bg-warning/15 text-warning'
            : 'bg-success/15 text-success'
    return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
        </p>
      )}
      {reprintMessage && (
        <p className="rounded-lg border border-warning/45 bg-warning/10 px-3 py-2 text-sm text-warning">
          {reprintMessage}
          <button type="button" onClick={clearReprintMessage} className="ml-2 text-xs underline">
            Dismiss
          </button>
        </p>
      )}

      {!loading && filteredBookings.length > 0 && (
        <BookingsStateLine stats={paymentStats} total={filteredBookings.length} />
      )}

      {(() => {
        const moreActions: ToolbarMoreItem[] = []
        if (role !== 'telecaller') {
          moreActions.push({
            label: 'Scan boarding',
            title: 'Scan a QR or paste a booking ID to mark a customer as boarded',
            onClick: () => setShowScanDialog(true),
          })
        }
        if (canViewSwapDigest) {
          moreActions.push({
            label: 'Swaps today',
            title: "Owner/admin: review today's in-store activity swaps",
            onClick: () => setShowSwapsToday(true),
          })
        }
        if (canManageAvailability) {
          moreActions.push({
            label: 'Activity availability',
            title: 'Mark a game offline temporarily so it stops accepting bookings',
            onClick: () => setShowAvailability(true),
          })
        }
        return (
          <BookingsToolbar
            branches={ADMIN_LOCATIONS}
            activeBranch={activeLocation}
            onBranchChange={setActiveLocation}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            onRefresh={() => void loadBookings()}
            exportingExcel={exportingExcel}
            onExportCsv={exportCSV}
            onExportExcel={() => void exportExcel()}
            moreActions={moreActions}
          />
        )
      })()}

      <BookingsFilterChips
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        paymentStatusFilter={paymentStatusFilter}
        setPaymentStatusFilter={setPaymentStatusFilter}
        eventsOnly={eventsOnly}
        setEventsOnly={(next: boolean) => setEventsOnly(next)}
        gameFilter={gameFilter}
        setGameFilter={setGameFilter}
        uniqueGames={uniqueGames}
        paymentMethodFilter={paymentMethodFilter}
        setPaymentMethodFilter={setPaymentMethodFilter}
        uniquePaymentMethods={uniquePaymentMethods}
        initiatedByFilter={initiatedByFilter}
        setInitiatedByFilter={setInitiatedByFilter}
        uniqueInitiators={uniqueInitiators}
        checkInFilter={checkInFilter}
        setCheckInFilter={setCheckInFilter}
        amountMin={amountMin}
        setAmountMin={setAmountMin}
        amountMax={amountMax}
        setAmountMax={setAmountMax}
        onClear={clearFilters}
      />

      {/* Table — sits directly on the page surface, no wrapping container.
          PRODUCT.md: density with hierarchy, never nested cards. */}
      <div className="overflow-x-auto rounded-xl border border-border/60 bg-panel/60">
        <table className="min-w-full divide-y divide-border/60 text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-left text-xs uppercase tracking-[0.08em] text-muted">
            <tr>
              {canBulkDelete && (
                <th className="px-3 py-2">
                  <span className="sr-only">Select all</span>
                  <input
                    type="checkbox"
                    aria-label="Select all bookings"
                    title="Select all bookings"
                    checked={
                      filteredBookings.length > 0 &&
                      selectedBookings.size === filteredBookings.length
                    }
                    onChange={() =>
                      setSelectedBookings(
                        selectedBookings.size === filteredBookings.length
                          ? new Set()
                          : new Set(filteredBookings.map((b) => b.id)),
                      )
                    }
                  />
                </th>
              )}
              <th className="px-3 py-2">
                <button type="button" onClick={() => toggleSort('id')}>
                  Order{sortArrow('id')}
                </button>
              </th>
              <th className="px-3 py-2">
                <button type="button" onClick={() => toggleSort('customerName')}>
                  Customer{sortArrow('customerName')}
                </button>
              </th>
              <th className="px-3 py-2">
                <button type="button" onClick={() => toggleSort('gameName')}>
                  Games{sortArrow('gameName')}
                </button>
              </th>
              <th className="px-3 py-2">
                <button type="button" onClick={() => toggleSort('scheduledDate')}>
                  Date{sortArrow('scheduledDate')}
                </button>
              </th>
              <th className="px-3 py-2">
                <button type="button" onClick={() => toggleSort('paymentMethod')}>
                  Payment{sortArrow('paymentMethod')}
                </button>
              </th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">
                <button type="button" onClick={() => toggleSort('initiatedBy')}>
                  Initiated By{sortArrow('initiatedBy')}
                </button>
              </th>
              <th className="px-3 py-2">
                <button type="button" onClick={() => toggleSort('amount')}>
                  Amount{sortArrow('amount')}
                </button>
              </th>
              <th className="px-3 py-2">
                <button type="button" onClick={() => toggleSort('bookingStatus')}>
                  Status{sortArrow('bookingStatus')}
                </button>
              </th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/55">
            {loading ? (
              <tr>
                <td className="px-3 py-6 text-center text-muted" colSpan={canBulkDelete ? 11 : 10}>
                  Loading bookings...
                </td>
              </tr>
            ) : paged.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-muted" colSpan={canBulkDelete ? 11 : 10}>
                  No bookings found.
                </td>
              </tr>
            ) : (
              paged.map((booking) => {
                // Per-row tint mirrors booking state. PRODUCT.md commits
                // to "discrepancy is the loudest signal," so the scale
                // intentionally narrows after critical: pending = quiet
                // amber, completed = whisper green, confirmed = neutral,
                // cancelled = de-emphasized. Selection overrides the
                // state tint so the user can always see their picks.
                const refundStatus = String((booking as Record<string, unknown>).refundStatus ?? '')
                const disputeStatus = (booking as Record<string, unknown>).disputeStatus
                const isCritical =
                  booking.paymentStatus === 'failed' ||
                  !!disputeStatus ||
                  refundStatus === 'processing' ||
                  refundStatus === 'Partial'
                const isCancelled = booking.bookingStatus === 'cancelled'
                const isPending = booking.paymentStatus === 'pending'
                const isCompleted = booking.bookingStatus === 'completed'
                const isSelected = selectedBookings.has(booking.id)
                const rowClass = isSelected
                  ? 'bg-accent/12 hover:bg-accent/15'
                  : isCritical
                    ? 'bg-critical/8 hover:bg-critical/12'
                    : isPending
                      ? 'bg-warning/5 hover:bg-warning/8'
                      : isCancelled
                        ? 'opacity-70 hover:opacity-90 hover:bg-panel/40'
                        : isCompleted
                          ? 'bg-success/4 hover:bg-success/8'
                          : 'hover:bg-panel/40'
                return (
                  <tr
                    key={booking.id}
                    onClick={() => setDetailsBooking(booking)}
                    className={`cursor-pointer ${rowClass}`}
                    title="Click to view full details"
                  >
                    {canBulkDelete && (
                      <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select booking ${booking.id}`}
                          checked={selectedBookings.has(booking.id)}
                          onChange={() =>
                            setSelectedBookings((c) => {
                              const n = new Set(c)
                              if (n.has(booking.id)) n.delete(booking.id)
                              else n.add(booking.id)
                              return n
                            })
                          }
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 align-top">
                      <p className="font-mono text-xs font-semibold text-text">{booking.id}</p>
                      <p className="text-xs text-muted">{fmtDateTimeFullIST(booking.createdAt)}</p>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <p className="font-medium text-text">
                        {String(booking.userDisplayName ?? 'Unknown')}
                      </p>
                      <p className="text-xs text-muted">
                        {String(booking.userPhone ?? booking.userId)}
                      </p>
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-muted">
                      {(() => {
                        // Compact summary: first item name + "+N more" chip
                        // when there are extras. Hovering the row's Games
                        // cell reveals the full list via title; clicking
                        // the row already opens the drawer with every item.
                        const bi = (booking as Record<string, unknown>).billingItems as
                          | Array<{ itemName?: string; activity?: { name?: string } }>
                          | undefined
                        const list = bi && bi.length > 0 ? bi : booking.items || []
                        if (list.length === 0) return <span>No items</span>
                        const firstName =
                          (list[0] as { itemName?: string; activity?: { name?: string } })
                            .itemName ||
                          (list[0] as { activity?: { name?: string } }).activity?.name ||
                          'Activity'
                        const extras = list.length - 1
                        return (
                          <span
                            title={formatBookingItems(booking)}
                            className="inline-flex max-w-[180px] items-center gap-1.5 align-middle"
                          >
                            <span className="truncate text-text">{firstName}</span>
                            {extras > 0 && (
                              <span className="shrink-0 rounded-full border border-border/55 bg-panel px-1.5 py-px text-[10px] font-medium tabular-nums text-muted">
                                +{extras}
                              </span>
                            )}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <p className="text-sm text-text">{fmtDateIST(booking.sessionDate)}</p>
                      <p className="text-xs text-muted">
                        {getLocationShortName(booking.locationId)}
                      </p>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <p className="text-sm text-text">
                        {formatPaymentMethod(booking.paymentMethod)}
                      </p>
                      <p className="text-xs text-muted">Payment: {booking.paymentStatus}</p>
                      {booking.paymentMethod?.toLowerCase() === 'link' && (
                        <p className="text-xs text-muted">
                          Link: {String(booking.paymentLinkStatus ?? 'sent')}
                        </p>
                      )}
                      {booking.razorpayOrderId && (
                        <p className="text-[11px] font-mono text-muted">
                          OID: {booking.razorpayOrderId}
                        </p>
                      )}
                      {booking.paymentId &&
                        !['wallet', 'free', 'unknown'].includes(booking.paymentId) && (
                          <p className="text-[11px] font-mono text-muted">
                            PID: {booking.paymentId}
                          </p>
                        )}
                      {(booking as Record<string, unknown>).disputeStatus ? (
                        <StatusBadge
                          tone={
                            String((booking as Record<string, unknown>).disputeStatus) === 'won'
                              ? 'success'
                              : String((booking as Record<string, unknown>).disputeStatus) ===
                                  'lost'
                                ? 'critical'
                                : 'warning'
                          }
                        >
                          {'Dispute: ' + String((booking as Record<string, unknown>).disputeStatus)}
                        </StatusBadge>
                      ) : null}
                      {(() => {
                        const raw = (booking as Record<string, unknown>).refundStatus
                        if (raw == null) return null
                        const status = String(raw)
                        // Canonical booking values: 'None' | 'Partial' | 'Full'.
                        // Razorpay webhook may also write 'processing' / 'processed'.
                        if (status === 'None' || status === '') return null
                        if (status === 'Full' || status === 'processed') {
                          return <StatusBadge tone="info">Refunded</StatusBadge>
                        }
                        if (status === 'Partial') {
                          return <StatusBadge tone="warning">Partially Refunded</StatusBadge>
                        }
                        if (status === 'processing') {
                          return <StatusBadge tone="warning">Refund Processing</StatusBadge>
                        }
                        return null
                      })()}
                    </td>
                    <td className="px-3 py-2 align-top">{getSourceBadge(booking)}</td>
                    <td className="px-3 py-2 align-top text-xs text-text">
                      {booking.createdByAdminName || <span className="text-muted">Customer</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-right text-sm font-semibold tabular-nums text-text">
                      {formatCurrency(booking.finalAmount)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <p className="text-sm capitalize text-text">{booking.bookingStatus}</p>
                      <p className="text-xs capitalize text-muted">
                        {booking.checkInStatus || 'pending'}
                      </p>
                    </td>
                    <td
                      className="px-3 py-2 align-top text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex justify-end whitespace-nowrap">
                        {/* Single overflow menu — every row action lives
                            here. State-dependent items appear conditionally
                            in priority order so the most-likely-needed
                            action is always at the top of the menu. */}
                        {(() => {
                          const items: MoreMenuItem[] = []
                          // Mark Used — TrackMarshall scan fallback for the
                          // only company-operated game (GoKarting). Hidden
                          // for non-paid or already-used bookings.
                          if (
                            isGoKartBooking(booking) &&
                            booking.bookingStatus !== 'completed' &&
                            (booking.paymentStatus === 'completed' ||
                              booking.paymentMethod?.toLowerCase() === 'cash' ||
                              Number(booking.finalAmount) === 0)
                          ) {
                            items.push({
                              label: 'Mark used',
                              title:
                                'Mark this GoKarting ticket as used (TrackMarshall scan fallback)',
                              onClick: () =>
                                void applyUpdate(
                                  booking,
                                  { bookingStatus: 'completed', checkInStatus: 'boarded' },
                                  `Marked ${booking.id} as used.`,
                                ),
                            })
                          }
                          // Re-check Payment — only when payment is not yet
                          // confirmed and the channel is online.
                          if (booking.paymentStatus !== 'completed' && isOnlinePayment(booking)) {
                            items.push({
                              label:
                                verifyingPayment === booking.id ? 'Checking…' : 'Re-check payment',
                              title: "Re-check this booking's payment status with Razorpay",
                              onClick: () =>
                                verifyingPayment === booking.id
                                  ? undefined
                                  : void verifyPaymentFromRazorpay(booking),
                            })
                          }
                          // Helicopter has its own primary check-in flow
                          // (separate scanner, not GoKart's TrackMarshall).
                          if (
                            isHelicopter(booking) &&
                            (booking.bookingStatus === 'confirmed' ||
                              booking.bookingStatus === 'completed')
                          ) {
                            items.push({
                              label: 'Check-in',
                              title: 'Mark this helicopter passenger as checked-in',
                              onClick: () =>
                                void applyUpdate(
                                  booking,
                                  { checkInStatus: 'completed' },
                                  `Checked-in ${booking.id}.`,
                                ),
                            })
                          }
                          items.push({
                            label: 'Print ticket',
                            title: 'Print or reprint the customer ticket',
                            onClick: () => void handlePrintTicket(booking),
                          })
                          if (canDelete) {
                            items.push({
                              label: 'Edit booking',
                              title: 'Edit any booking field (reschedule, quantity, payment, etc.)',
                              onClick: () => setEditAllBooking(booking),
                            })
                          }
                          if (
                            canManageAdvanced &&
                            (booking.bookingStatus === 'confirmed' ||
                              booking.bookingStatus === 'completed')
                          ) {
                            items.push({
                              label: 'Resend confirmation',
                              title: 'Re-send the Interakt booking-confirmation message',
                              onClick: () =>
                                void asquareBookingsApi.triggerInteraktBookingConfirmation(
                                  booking.id,
                                  true,
                                  actor.id,
                                ),
                            })
                          }
                          if (canManageAdvanced) {
                            items.push({
                              label: 'Swap activity',
                              title: 'Replace this booking’s activity (game unavailable in-store)',
                              onClick: () => setSwapBooking(booking),
                            })
                          }
                          if (
                            isHelicopter(booking) &&
                            (booking.bookingStatus === 'confirmed' ||
                              booking.bookingStatus === 'completed')
                          ) {
                            items.push({
                              label: 'Open web check-in',
                              title: 'Open the customer-facing helicopter check-in page',
                              onClick: () =>
                                window.open(
                                  `${ASQUARE_WEB_BASE_URL}/check-in/${booking.id}`,
                                  '_blank',
                                ),
                            })
                          }
                          return <RowMoreMenu items={items} label="Booking actions" />
                        })()}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Page {page} / {totalPages} &middot; {filteredBookings.length} bookings
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setCurrentPage((c) => Math.max(1, c - 1))}
            className="ui-btn ui-btn-neutral min-h-8 px-3 py-1 text-xs disabled:opacity-50"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setCurrentPage((c) => Math.min(totalPages, c + 1))}
            className="ui-btn ui-btn-neutral min-h-8 px-3 py-1 text-xs disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {/* Bulk action bar — thin sticky strip pinned to bottom of the
          page when any rows are selected. Lives outside the table card
          so it floats over content; backdrop is the panel surface tint. */}
      {selectedBookings.size > 0 && canBulkDelete && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border/70 bg-panel px-4 py-2 shadow-2xl backdrop-blur-sm"
        >
          <p className="whitespace-nowrap text-xs font-medium text-text">
            <span className="tabular-nums">{selectedBookings.size}</span> selected
          </p>
          <span aria-hidden className="h-4 w-px bg-border/60" />
          <button
            type="button"
            disabled={bulkRunning}
            onClick={() => void handleBulkVerify()}
            className="text-xs font-medium text-text hover:text-info disabled:opacity-50"
            title="Re-check Razorpay payment status for selected pending online bookings"
          >
            {bulkRunning ? 'Working…' : 'Re-check'}
          </button>
          <button
            type="button"
            disabled={bulkRunning}
            onClick={() => void handleBulkCancel()}
            className="text-xs font-medium text-text hover:text-warning disabled:opacity-50"
            title="Cancel all selected bookings that aren't already cancelled or completed"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={bulkRunning}
            onClick={() => void handleBulkDelete()}
            className="text-xs font-medium text-text hover:text-warning disabled:opacity-50"
            title="Move selected bookings to Trash"
          >
            Trash
          </button>
          <span aria-hidden className="h-4 w-px bg-border/60" />
          <button
            type="button"
            disabled={bulkRunning}
            onClick={() => setSelectedBookings(new Set())}
            aria-label="Clear selection"
            className="text-base text-muted hover:text-text disabled:opacity-50"
          >
            ✕
          </button>
        </div>
      )}

      {/* Move-to-Trash confirm dialog */}
      <ConfirmDialog
        open={confirmDeleteBooking !== null}
        title="Move booking to Trash"
        description={
          confirmDeleteBooking
            ? `Move booking ${confirmDeleteBooking.id} to Trash? It will be hidden from the live list but can be restored from the Trash tab. Vendor ledger and invoices stay intact until permanent delete.`
            : ''
        }
        confirmLabel="Move to Trash"
        onConfirm={() => void executeDelete()}
        onCancel={() => setConfirmDeleteBooking(null)}
      />

      {/* Reprint confirm dialog */}
      <ConfirmDialog
        open={reprintConfirm !== null}
        title="Reprint Ticket"
        description={
          reprintConfirm
            ? `This ticket has already been printed ${reprintConfirm.printCount} time(s). This reprint will be logged for admin review. Continue?`
            : ''
        }
        confirmLabel="Reprint"
        onConfirm={() => resolveReprintConfirm(true)}
        onCancel={() => resolveReprintConfirm(false)}
      />

      {/* Edit All Modal */}
      {editAllBooking && (
        <EditBookingModal
          booking={editAllBooking}
          locations={ADMIN_LOCATIONS}
          onSave={handleEditAllSave}
          onClose={() => setEditAllBooking(null)}
        />
      )}

      {/* Replace Activity (Swap) Modal */}
      {swapBooking && (
        <ReplaceActivityModal
          booking={swapBooking}
          actor={actor}
          onClose={() => setSwapBooking(null)}
          onSwapped={() => {
            setSuccess(`Activity swapped on ${swapBooking.id}.`)
            setSwapBooking(null)
            void loadBookings()
          }}
        />
      )}

      {/* Refund Modal — Owner/Admin only, completed bookings, not yet fully refunded. */}
      {refundBooking && (
        <RefundBookingModal
          booking={refundBooking}
          actor={actor}
          onClose={() => setRefundBooking(null)}
          onRefunded={(message) => {
            setSuccess(message)
            setRefundBooking(null)
            void loadBookings()
          }}
        />
      )}

      {/* Owner/Admin: Today's swap digest */}
      {showSwapsToday && <SwapsTodayModal onClose={() => setShowSwapsToday(false)} />}

      {/* Scan Boarding dialog — replaces the legacy window.prompt with a
          themed input that auto-focuses for USB QR scanners. */}
      <ScanBoardingDialog
        open={showScanDialog}
        onSubmit={(payload) => void onScanSubmit(payload)}
        onCancel={() => setShowScanDialog(false)}
      />

      {/* Owner/Admin: Per-game availability toggle */}
      {showAvailability && (
        <ActivityAvailabilityModal
          actor={actor}
          locations={ADMIN_LOCATIONS}
          onClose={() => setShowAvailability(false)}
        />
      )}

      {/* Details Modal — opens when a row is clicked. Destructive actions
          (Refund / Cancel / Delete) live here under a collapsed "Manage"
          section instead of being scattered across the row's Actions cell. */}
      {detailsBooking && (
        <BookingDetailsModal
          booking={detailsBooking}
          onClose={() => setDetailsBooking(null)}
          onRefund={canDelete ? (b) => setRefundBooking(b) : undefined}
          onCancel={canDelete ? (b) => void cancelBooking(b) : undefined}
          onDelete={canDelete ? (b) => void handleDeleteBooking(b) : undefined}
        />
      )}
    </div>
  )
}

export default AllBookingsView
