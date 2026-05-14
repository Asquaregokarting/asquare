import { useEffect, useMemo, useState } from 'react'
import type { AsquareBooking } from '../../../api/asquare-bookings'
import { isEventBooking, isHelicopter, ITEMS_PER_PAGE } from './bookings-utils'

export type SortKey =
  | 'id'
  | 'createdAt'
  | 'scheduledDate'
  | 'amount'
  | 'bookingStatus'
  | 'paymentStatus'
  | 'paymentMethod'
  | 'initiatedBy'
  | 'customerName'
  | 'gameName'

export interface SortConfig {
  key: SortKey | string
  direction: 'asc' | 'desc'
}

export interface PaymentStats {
  pending: number
  completed: number
  failed: number
  disputed: number
  refunded: number
  revenue: number
}

/**
 * "Initiated By" is a synthetic field: admin name if present, otherwise
 * the literal label "Customer" (matches the column rendering). Centralised
 * here so filter, sort, and search stay consistent.
 */
const getInitiatedBy = (b: AsquareBooking): string =>
  String(b.createdByAdminName || '').trim() || 'Customer'

const firstGameName = (b: AsquareBooking): string =>
  String(b.items?.[0]?.activity?.name ?? '').trim()

export const useBookingFilters = (bookings: AsquareBooking[], role: string) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [gameFilter, setGameFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [checkInFilter, setCheckInFilter] = useState('all')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('all')
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('all')
  const [initiatedByFilter, setInitiatedByFilter] = useState('all')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [eventsOnly, setEventsOnly] = useState(false)
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: 'createdAt',
    direction: 'desc',
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedBookings, setSelectedBookings] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSelectedBookings(new Set())
    setCurrentPage(1)
  }, [
    searchTerm,
    dateFrom,
    dateTo,
    gameFilter,
    statusFilter,
    checkInFilter,
    paymentStatusFilter,
    paymentMethodFilter,
    initiatedByFilter,
    amountMin,
    amountMax,
    eventsOnly,
  ])

  const uniqueGames = useMemo(
    () =>
      Array.from(
        new Set(
          bookings.flatMap((b) =>
            (b.items || []).map((i) => String(i.activity?.name ?? '')).filter(Boolean),
          ),
        ),
      ).sort(),
    [bookings],
  )

  // Payment method is case-insensitive: a booking with "Cash" and one with
  // "cash" are the same method. We dedupe by the lowercased form and
  // present a single canonical label (the first occurrence of each form,
  // lowercased) so the dropdown doesn't show duplicates.
  const uniquePaymentMethods = useMemo(() => {
    const seen = new Set<string>()
    const labels: string[] = []
    for (const b of bookings) {
      const raw = String(b.paymentMethod ?? '').trim()
      if (!raw) continue
      const key = raw.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      labels.push(key)
    }
    return labels.sort()
  }, [bookings])

  const uniqueInitiators = useMemo(
    () => Array.from(new Set(bookings.map(getInitiatedBy))).sort(),
    [bookings],
  )

  const filteredBookings = useMemo(() => {
    const roleFiltered =
      role === 'thirdparty' ? bookings.filter((booking) => isHelicopter(booking)) : bookings
    const allowed = eventsOnly ? roleFiltered.filter(isEventBooking) : roleFiltered

    const minAmt = amountMin.trim() === '' ? null : Number(amountMin)
    const maxAmt = amountMax.trim() === '' ? null : Number(amountMax)

    return allowed
      .filter((booking) => {
        const searchLower = searchTerm.trim().toLowerCase()
        // Extended search: id, user id, customer name, phone, admin name,
        // payment method, game name, exact/numeric amount.
        const matchesSearch =
          !searchLower ||
          booking.id.toLowerCase().includes(searchLower) ||
          booking.userId.toLowerCase().includes(searchLower) ||
          String(booking.userDisplayName ?? '')
            .toLowerCase()
            .includes(searchLower) ||
          String(booking.userPhone ?? '')
            .toLowerCase()
            .includes(searchLower) ||
          getInitiatedBy(booking).toLowerCase().includes(searchLower) ||
          String(booking.paymentMethod ?? '')
            .toLowerCase()
            .includes(searchLower) ||
          (booking.items || []).some((i) =>
            String(i.activity?.name ?? '')
              .toLowerCase()
              .includes(searchLower),
          ) ||
          String(Math.round(booking.finalAmount || 0)).includes(searchLower)

        // Bucket by the stamped visitDate field (YYYY-MM-DD, IST). Previously
        // this derived the bucket from sessionDate via the browser's LOCAL
        // timezone, so two admins in different timezones saw the same
        // booking under different days. Fall back to deriving from
        // sessionDate in IST for legacy rows that pre-date the visitDate
        // field — the backfill covered everything currently in production
        // but the fallback keeps the filter safe if any new orphan appears.
        const bookingDate =
          (booking as { visitDate?: string }).visitDate ||
          (() => {
            try {
              return new Date(booking.sessionDate).toLocaleDateString('en-CA', {
                timeZone: 'Asia/Kolkata',
              })
            } catch {
              return ''
            }
          })()
        const matchesDate =
          (!dateFrom || bookingDate >= dateFrom) && (!dateTo || bookingDate <= dateTo)

        const matchesGame =
          gameFilter === 'all' ||
          (booking.items || []).some((item) => String(item.activity?.name ?? '') === gameFilter)

        const matchesStatus = statusFilter === 'all' || booking.bookingStatus === statusFilter

        const matchesCheckIn =
          checkInFilter === 'all' ||
          (checkInFilter === 'pending'
            ? !booking.checkInStatus || booking.checkInStatus === 'pending'
            : booking.checkInStatus === checkInFilter)

        // Refunded and disputed are tracked on side-fields, not on
        // booking.paymentStatus (a refunded booking still reads
        // paymentStatus: 'completed' because the customer paid). Match
        // the actual signal field for those two pseudo-statuses.
        const refundRaw = String((booking as Record<string, unknown>).refundStatus ?? '')
        const isRefunded = refundRaw !== '' && refundRaw !== 'None'
        const matchesPaymentStatus =
          paymentStatusFilter === 'all' ||
          (paymentStatusFilter === 'refunded'
            ? isRefunded
            : paymentStatusFilter === 'disputed'
              ? !!(booking as Record<string, unknown>).disputeStatus
              : booking.paymentStatus === paymentStatusFilter)

        const matchesPaymentMethod =
          paymentMethodFilter === 'all' ||
          String(booking.paymentMethod ?? '').toLowerCase() === paymentMethodFilter.toLowerCase()

        const matchesInitiatedBy =
          initiatedByFilter === 'all' || getInitiatedBy(booking) === initiatedByFilter

        const amount = Number(booking.finalAmount || 0)
        const matchesAmount =
          (minAmt == null || Number.isNaN(minAmt) || amount >= minAmt) &&
          (maxAmt == null || Number.isNaN(maxAmt) || amount <= maxAmt)

        return (
          matchesSearch &&
          matchesDate &&
          matchesGame &&
          matchesStatus &&
          matchesCheckIn &&
          matchesPaymentStatus &&
          matchesPaymentMethod &&
          matchesInitiatedBy &&
          matchesAmount
        )
      })
      .sort((a, b) => {
        const dir = sortConfig.direction === 'asc' ? 1 : -1
        switch (sortConfig.key) {
          case 'amount':
            return (a.finalAmount - b.finalAmount) * dir
          case 'id':
            return a.id.localeCompare(b.id) * dir
          case 'bookingStatus':
            return a.bookingStatus.localeCompare(b.bookingStatus) * dir
          case 'paymentStatus':
            return String(a.paymentStatus).localeCompare(String(b.paymentStatus)) * dir
          case 'paymentMethod':
            return String(a.paymentMethod ?? '').localeCompare(String(b.paymentMethod ?? '')) * dir
          case 'initiatedBy':
            return getInitiatedBy(a).localeCompare(getInitiatedBy(b)) * dir
          case 'customerName':
            return (
              String(a.userDisplayName ?? '').localeCompare(String(b.userDisplayName ?? '')) * dir
            )
          case 'gameName':
            return firstGameName(a).localeCompare(firstGameName(b)) * dir
          case 'scheduledDate':
            return (new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime()) * dir
          case 'createdAt':
          default:
            return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
        }
      })
  }, [
    bookings,
    role,
    searchTerm,
    dateFrom,
    dateTo,
    gameFilter,
    statusFilter,
    checkInFilter,
    paymentStatusFilter,
    paymentMethodFilter,
    initiatedByFilter,
    amountMin,
    amountMax,
    eventsOnly,
    sortConfig,
  ])

  const paymentStats = useMemo<PaymentStats>(() => {
    let pending = 0,
      completed = 0,
      failed = 0,
      disputed = 0,
      refunded = 0,
      revenue = 0
    for (const b of filteredBookings) {
      const amount = b.finalAmount || 0
      if (b.paymentStatus === 'pending') pending++
      else if (b.paymentStatus === 'completed') {
        completed++
        revenue += amount
      } else if (b.paymentStatus === 'failed') failed++
      // Refunded counts the side-field, not paymentStatus (a refunded
      // booking keeps paymentStatus: 'completed'). Refund includes any
      // partial / full / processing / processed value.
      const refundRaw = String((b as Record<string, unknown>).refundStatus ?? '')
      if (refundRaw !== '' && refundRaw !== 'None') refunded++
      if ((b as Record<string, unknown>).disputeStatus) disputed++
    }
    return { pending, completed, failed, disputed, refunded, revenue }
  }, [filteredBookings])

  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / ITEMS_PER_PAGE))
  const page = Math.min(currentPage, totalPages)
  const paged = filteredBookings.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  const clearFilters = () => {
    setSearchTerm('')
    setDateFrom('')
    setDateTo('')
    setGameFilter('all')
    setStatusFilter('all')
    setCheckInFilter('all')
    setPaymentStatusFilter('all')
    setPaymentMethodFilter('all')
    setInitiatedByFilter('all')
    setAmountMin('')
    setAmountMax('')
    setEventsOnly(false)
  }

  return {
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
    currentPage,
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
  }
}
