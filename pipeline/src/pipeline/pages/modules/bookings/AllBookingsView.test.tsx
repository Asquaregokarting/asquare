import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AsquareBooking } from '../../../api/asquare-bookings'
import type { PaymentStats } from './useBookingFilters'

// ─── Sub-component mocks ──────────────────────────────────────────────────
// The real components require Framer Motion / popover machinery that
// jsdom can't render reliably. The tests below assert on the page-level
// composition (banners, table rows, bulk bar, dialogs) rather than the
// inner widget chrome.

vi.mock('./BookingsStateLine', () => ({
  BookingsStateLine: ({ total }: { stats: PaymentStats; total: number }) => (
    <div data-testid="state-line">Total: {total}</div>
  ),
}))

vi.mock('./BookingsToolbar', () => ({
  BookingsToolbar: () => <div data-testid="toolbar">toolbar</div>,
  // re-export the type so the parent's `import { BookingsToolbar, type ToolbarMoreItem }`
  // type-checks during the mocked render.
}))

vi.mock('./BookingsFilterChips', () => ({
  BookingsFilterChips: () => <div data-testid="filter-chips">chips</div>,
}))

vi.mock('./RowMoreMenu', () => ({
  RowMoreMenu: ({ items }: { items: Array<{ label: string }>; label?: string }) => (
    <div data-testid="row-more-menu">{items.length}-actions</div>
  ),
}))

vi.mock('../../../components/ui/StatusBadge', () => ({
  StatusBadge: ({ children }: { children: React.ReactNode; tone: string }) => (
    <span data-testid="status-badge">{children}</span>
  ),
}))

vi.mock('../../../components/ui/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title }: { open: boolean; title: string }) =>
    open ? (
      <div data-testid={`confirm-${title.toLowerCase().replace(/\s+/g, '-')}`}>{title}</div>
    ) : null,
}))

vi.mock('./EditBookingModal', () => ({
  default: () => <div data-testid="edit-booking-modal">EditBookingModal</div>,
}))

vi.mock('./BookingDetailsModal', () => ({
  default: () => <div data-testid="booking-details-modal">BookingDetailsModal</div>,
}))

vi.mock('./ReplaceActivityModal', () => ({
  default: () => <div data-testid="replace-activity-modal">ReplaceActivityModal</div>,
}))

vi.mock('./RefundBookingModal', () => ({
  default: () => <div data-testid="refund-booking-modal">RefundBookingModal</div>,
}))

vi.mock('./SwapsTodayModal', () => ({
  default: () => <div data-testid="swaps-today-modal">SwapsTodayModal</div>,
}))

vi.mock('./ActivityAvailabilityModal', () => ({
  default: () => <div data-testid="activity-availability-modal">ActivityAvailabilityModal</div>,
}))

vi.mock('./ScanBoardingDialog', () => ({
  ScanBoardingDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="scan-boarding-dialog">ScanBoardingDialog</div> : null,
}))

// ─── Context / hook mocks ─────────────────────────────────────────────────

vi.mock('../../../features/auth/auth-context', () => ({
  useAuth: vi.fn(() => ({
    session: { user: { id: 'u1', name: 'Test Owner', role: 'Owner' }, token: 'fake' },
  })),
}))

vi.mock('../../../hooks/useLocations', () => ({
  useLocations: vi.fn(() => ({
    enabledLocations: [
      { slug: 'visakhapatnam', displayName: 'Vizag' },
      { slug: 'kakinada', displayName: 'Kakinada' },
    ],
  })),
}))

vi.mock('../../../../lib/date-format', () => ({
  fmtDateTimeFullIST: vi.fn((d: Date) => d?.toISOString?.() ?? ''),
  fmtDateIST: vi.fn((d: Date) => d?.toISOString?.()?.split('T')[0] ?? ''),
}))

vi.mock('../../../../lib/locations', () => ({
  getLocationShortName: vi.fn((id: string) => id),
}))

// API module — only mock the subset AllBookingsView calls.
const mockSoftDelete = vi.fn(() => Promise.resolve(true))
const mockTriggerInteraktConfirm = vi.fn(() => Promise.resolve())
const mockConfirmRazorpay = vi.fn(() => Promise.resolve())
vi.mock('../../../api/asquare-bookings', () => ({
  asquareBookingsApi: {
    softDeleteBooking: (...args: unknown[]) => mockSoftDelete(...args),
    triggerInteraktBookingConfirmation: (...args: unknown[]) => mockTriggerInteraktConfirm(...args),
    confirmRazorpayOrder: (...args: unknown[]) => mockConfirmRazorpay(...args),
  },
}))

vi.mock('../../../api/reconciliation-firestore', () => ({
  listVendorOptions: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../../../features/bookings-export/excel-export', () => ({
  exportBookingsExcel: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// useBookingsData / useBookingFilters / usePrintTicket — return shapes
// MUST stay in lockstep with the real hooks. AllBookingsView destructures
// every one of these fields; a missing key crashes downstream renders.
const mockLoadBookings = vi.fn()
const mockApplyUpdate = vi.fn(() => Promise.resolve(true))
const mockCancelBooking = vi.fn()
const mockVerifyPayment = vi.fn()

vi.mock('./useBookingsData', () => ({
  useBookingsData: vi.fn(() => ({
    bookings: [],
    loading: false,
    error: null,
    setError: vi.fn(),
    success: null,
    setSuccess: vi.fn(),
    verifyingPayment: null,
    patchBooking: vi.fn(),
    applyUpdate: mockApplyUpdate,
    cancelBooking: mockCancelBooking,
    verifyPaymentFromRazorpay: mockVerifyPayment,
    loadBookings: mockLoadBookings,
  })),
}))

const buildFiltersReturn = (
  overrides: Partial<ReturnType<typeof _useBookingFiltersStub>> = {},
) => ({
  searchTerm: '',
  setSearchTerm: vi.fn(),
  dateFrom: '',
  setDateFrom: vi.fn(),
  dateTo: '',
  setDateTo: vi.fn(),
  gameFilter: 'all',
  setGameFilter: vi.fn(),
  statusFilter: 'all',
  setStatusFilter: vi.fn(),
  checkInFilter: 'all',
  setCheckInFilter: vi.fn(),
  paymentStatusFilter: 'all',
  setPaymentStatusFilter: vi.fn(),
  paymentMethodFilter: 'all',
  setPaymentMethodFilter: vi.fn(),
  initiatedByFilter: 'all',
  setInitiatedByFilter: vi.fn(),
  amountMin: '',
  setAmountMin: vi.fn(),
  amountMax: '',
  setAmountMax: vi.fn(),
  eventsOnly: false,
  setEventsOnly: vi.fn(),
  sortConfig: { key: 'createdAt', direction: 'desc' as const },
  setSortConfig: vi.fn(),
  setCurrentPage: vi.fn(),
  selectedBookings: new Set<string>(),
  setSelectedBookings: vi.fn(),
  uniqueGames: ['Go Karting', 'Bowling'],
  uniquePaymentMethods: ['Cash', 'Razorpay'],
  uniqueInitiators: ['Customer', 'Admin'],
  filteredBookings: [],
  paymentStats: {
    pending: 0,
    completed: 0,
    failed: 0,
    disputed: 0,
    refunded: 0,
    revenue: 0,
  },
  totalPages: 1,
  page: 1,
  paged: [],
  clearFilters: vi.fn(),
  ...overrides,
})

// Helper type stub so `buildFiltersReturn` keeps its shape under
// `as ReturnType<typeof useBookingFilters>` without depending on the
// real generic type. The underscore prefix marks it as intentionally
// only-used-as-a-type (the eslint @typescript-eslint/no-unused-vars
// allowlist matches /^_/).
function _useBookingFiltersStub() {
  return buildFiltersReturn()
}

vi.mock('./useBookingFilters', () => ({
  useBookingFilters: vi.fn(() => buildFiltersReturn()),
}))

vi.mock('./usePrintTicket', () => ({
  usePrintTicket: vi.fn(() => ({
    printTicket: vi.fn(() => Promise.resolve({ success: true })),
    printing: false,
    reprintMessage: null,
    clearReprintMessage: vi.fn(),
    reprintConfirm: null,
    resolveReprintConfirm: vi.fn(),
  })),
}))

// Import AFTER the mocks are registered.
import AllBookingsView from './AllBookingsView'
import { useBookingsData } from './useBookingsData'
import { useBookingFilters } from './useBookingFilters'

const makeBooking = (overrides: Partial<AsquareBooking> = {}): AsquareBooking =>
  ({
    id: 'ASG260413120000100ABCD',
    userId: 'user-1',
    userDisplayName: 'Test Customer',
    userPhone: '9876543210',
    bookingStatus: 'confirmed',
    paymentStatus: 'completed',
    paymentMethod: 'Cash',
    checkInStatus: 'pending',
    finalAmount: 1000,
    totalAmount: 1000,
    discountAmount: 0,
    sessionDate: new Date('2026-04-15'),
    createdAt: new Date('2026-04-13'),
    locationId: 'visakhapatnam',
    items: [{ activity: { name: 'Go Karting' }, quantity: 2, price: 1000 }],
    source: 'ADMIN_BOOKING',
    createdByAdminName: 'Admin',
    createdByAdminId: 'admin-1',
    createdByRole: 'Owner',
    razorpayOrderId: '',
    paymentId: '',
    ...overrides,
  }) as unknown as AsquareBooking

describe('AllBookingsView (post-redesign)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the filter mock to its default shape so per-test overrides
    // don't leak across tests.
    vi.mocked(useBookingFilters).mockReturnValue(buildFiltersReturn())
  })

  it('renders the toolbar and filter chips', () => {
    render(<AllBookingsView />)
    expect(screen.getByTestId('toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('filter-chips')).toBeInTheDocument()
  })

  it('shows loading state in the table', () => {
    vi.mocked(useBookingsData).mockReturnValue({
      bookings: [],
      loading: true,
      error: null,
      setError: vi.fn(),
      success: null,
      setSuccess: vi.fn(),
      verifyingPayment: null,
      patchBooking: vi.fn(),
      applyUpdate: vi.fn(),
      cancelBooking: vi.fn(),
      verifyPaymentFromRazorpay: vi.fn(),
      loadBookings: vi.fn(),
    } as unknown as ReturnType<typeof useBookingsData>)
    render(<AllBookingsView />)
    expect(screen.getByText('Loading bookings...')).toBeInTheDocument()
  })

  it('shows the empty-state row when there are no bookings', () => {
    render(<AllBookingsView />)
    expect(screen.getByText('No bookings found.')).toBeInTheDocument()
  })

  it('does not render the state line when there are zero filtered bookings', () => {
    render(<AllBookingsView />)
    expect(screen.queryByTestId('state-line')).not.toBeInTheDocument()
  })

  it('renders the state line and a booking row when bookings are present', () => {
    const booking = makeBooking()
    vi.mocked(useBookingFilters).mockReturnValue(
      buildFiltersReturn({
        filteredBookings: [booking],
        paymentStats: {
          pending: 0,
          completed: 1,
          failed: 0,
          disputed: 0,
          refunded: 0,
          revenue: 1000,
        },
        paged: [booking],
      }) as unknown as ReturnType<typeof useBookingFilters>,
    )
    render(<AllBookingsView />)
    expect(screen.getByTestId('state-line')).toBeInTheDocument()
    expect(screen.getByText('ASG260413120000100ABCD')).toBeInTheDocument()
    expect(screen.getByText('Test Customer')).toBeInTheDocument()
    // Per-row More menu is rendered (mock prints the action count)
    expect(screen.getByTestId('row-more-menu')).toBeInTheDocument()
  })

  it('shows the error banner when an error is set on the data hook', () => {
    vi.mocked(useBookingsData).mockReturnValue({
      bookings: [],
      loading: false,
      error: 'Something went wrong',
      setError: vi.fn(),
      success: null,
      setSuccess: vi.fn(),
      verifyingPayment: null,
      patchBooking: vi.fn(),
      applyUpdate: vi.fn(),
      cancelBooking: vi.fn(),
      verifyPaymentFromRazorpay: vi.fn(),
      loadBookings: vi.fn(),
    } as unknown as ReturnType<typeof useBookingsData>)
    render(<AllBookingsView />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('shows the success banner when success is set on the data hook', () => {
    vi.mocked(useBookingsData).mockReturnValue({
      bookings: [],
      loading: false,
      error: null,
      setError: vi.fn(),
      success: 'Booking moved to Trash.',
      setSuccess: vi.fn(),
      verifyingPayment: null,
      patchBooking: vi.fn(),
      applyUpdate: vi.fn(),
      cancelBooking: vi.fn(),
      verifyPaymentFromRazorpay: vi.fn(),
      loadBookings: vi.fn(),
    } as unknown as ReturnType<typeof useBookingsData>)
    render(<AllBookingsView />)
    expect(screen.getByText('Booking moved to Trash.')).toBeInTheDocument()
  })

  it('renders the bulk action bar when rows are selected', () => {
    const a = makeBooking({ id: 'A1' })
    const b = makeBooking({ id: 'B2' })
    vi.mocked(useBookingFilters).mockReturnValue(
      buildFiltersReturn({
        filteredBookings: [a, b],
        paged: [a, b],
        selectedBookings: new Set(['A1', 'B2']),
      }) as unknown as ReturnType<typeof useBookingFilters>,
    )
    render(<AllBookingsView />)
    // The selection counter ("2 selected") and the destructive action
    // labels live inside the bulk bar.
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeInTheDocument()
    expect(screen.getByText('Trash')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.getByText('Re-check')).toBeInTheDocument()
  })

  it('renders pagination controls', () => {
    render(<AllBookingsView />)
    expect(screen.getByText('Prev')).toBeInTheDocument()
    expect(screen.getByText('Next')).toBeInTheDocument()
  })
})
