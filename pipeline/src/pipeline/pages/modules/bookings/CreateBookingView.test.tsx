import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock auth
vi.mock('../../../features/auth/auth-context', () => ({
  useAuth: vi.fn(() => ({
    session: {
      user: { id: 'u1', name: 'Test Owner', role: 'Owner', maxDiscountPercent: 50 },
      token: 'fake',
    },
  })),
}))

// Mock locations
vi.mock('../../../hooks/useLocations', () => ({
  useLocations: vi.fn(() => ({
    enabledLocations: [
      { slug: 'visakhapatnam', displayName: 'Vizag' },
      { slug: 'kakinada', displayName: 'Kakinada' },
    ],
  })),
}))

// Mock MetricStrip
vi.mock('../../../components/ui/MetricStrip', () => ({
  MetricStrip: ({ items }: { items: Array<{ label: string; value: string }> }) => (
    <div data-testid="metric-strip">
      {items.map((i) => (
        <span key={i.id}>
          {i.label}: {i.value}
        </span>
      ))}
    </div>
  ),
}))

// Build a mock return for useCreateBooking
const mockHandleSendLink = vi.fn((e: { preventDefault: () => void }) => {
  e.preventDefault()
})

const defaultHookReturn = {
  createLocation: 'visakhapatnam',
  setCreateLocation: vi.fn(),
  createDate: '2026-04-15',
  setCreateDate: vi.fn(),
  customerName: '',
  setCustomerName: vi.fn(),
  customerPhone: '',
  setCustomerPhone: vi.fn(),
  customerEmail: '',
  setCustomerEmail: vi.fn(),
  customerLookupLoading: false,
  customerLookupMessage: null,
  customerNameEdited: false,
  setCustomerNameEdited: vi.fn(),
  customerLookupSource: null,
  memberInsight: null,
  memberLookupLoading: false,
  normalizedCustomerPhone: '',
  activitiesLoading: false,
  activityCatalog: [],
  activitySearchTerm: '',
  setActivitySearchTerm: vi.fn(),
  activityCategoryFilter: '',
  setActivityCategoryFilter: vi.fn(),
  activityCategories: ['GoKarting', 'Bowling'],
  activeCatalogGameKey: null,
  setActiveCatalogGameKey: vi.fn(),
  activeCatalogSubGameKey: null,
  setActiveCatalogSubGameKey: vi.fn(),
  activeCatalogGroup: null,
  activeCatalogSubGame: null,
  visibleCatalogActivities: [],
  groupedCatalogActivities: [],
  filteredCombos: [],
  selectedActivityIds: [],
  setSelectedActivityIds: vi.fn(),
  activityQty: {},
  setActivityQty: vi.fn(),
  selectedActivities: [],
  selectedCombos: [],
  selectedComboIds: [],
  comboQty: {},
  increaseActivityQty: vi.fn(),
  decreaseActivityQty: vi.fn(),
  removeActivity: vi.fn(),
  addCombo: vi.fn(),
  removeCombo: vi.fn(),
  increaseComboQty: vi.fn(),
  decreaseComboQty: vi.fn(),
  activeBranchKey: 'vizag',
  totalAmount: 0,
  companyTotal: 0,
  vendorTotal: 0,
  discountPercent: 0,
  setDiscountPercent: vi.fn(),
  flatDiscount: 0,
  couponDiscount: 0,
  discountAmount: 0,
  finalAmount: 0,
  benefitMode: 'discount' as const,
  setBenefitMode: vi.fn(),
  couponApplication: {
    couponsApplied: 0,
    couponDiscount: 0,
    perLineUnitsApplied: [],
    perLineDiscount: [],
  },
  perLineCouponDiscount: new Map(),
  projectedEarnedCoupons: 0,
  couponModeAvailable: false,
  hasCompanyItems: false,
  hasVendorItems: false,
  cartIsAllVendor: false,
  isProtocol: false,
  setIsProtocol: vi.fn(),
  protocolReason: '',
  setProtocolReason: vi.fn(),
  sendingLink: false,
  handleSendLink: mockHandleSendLink,
  canSendBookingLinks: true,
  error: null,
  setError: vi.fn(),
  success: null,
  setSuccess: vi.fn(),
}

vi.mock('./useCreateBooking', () => ({
  useCreateBooking: vi.fn(() => defaultHookReturn),
}))

import CreateBookingView from './CreateBookingView'
import { useCreateBooking } from './useCreateBooking'

describe('CreateBookingView', () => {
  it('renders Create Booking Link heading', () => {
    render(<CreateBookingView />)
    expect(screen.getByText('Create Booking Link')).toBeInTheDocument()
  })

  it('renders Open Asquare link', () => {
    render(<CreateBookingView />)
    expect(screen.getByText('Open Asquare')).toBeInTheDocument()
  })

  it('renders customer form fields', () => {
    render(<CreateBookingView />)
    expect(screen.getByPlaceholderText('10-digit mobile')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Customer name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Email (optional)')).toBeInTheDocument()
  })

  it('renders Activity Catalog section', () => {
    render(<CreateBookingView />)
    expect(screen.getByText('Activity Catalog')).toBeInTheDocument()
  })

  it('renders Booking Summary sidebar', () => {
    render(<CreateBookingView />)
    expect(screen.getByText('Booking Summary')).toBeInTheDocument()
  })

  it('renders category filter tabs', () => {
    render(<CreateBookingView />)
    // GoKarting appears in both <option> and <button> — check at least 2 matches
    expect(screen.getAllByText('GoKarting').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Bowling').length).toBeGreaterThanOrEqual(2)
  })

  it('renders submit button as Send Payment Link', () => {
    render(<CreateBookingView />)
    expect(screen.getByText('Send Payment Link')).toBeInTheDocument()
  })

  it('disables submit when no activities selected', () => {
    render(<CreateBookingView />)
    const submitBtn = screen.getByText('Send Payment Link')
    expect(submitBtn).toBeDisabled()
  })

  it('shows Sending... when sendingLink is true', () => {
    vi.mocked(useCreateBooking).mockReturnValue({ ...defaultHookReturn, sendingLink: true })
    render(<CreateBookingView />)
    expect(screen.getByText('Sending...')).toBeInTheDocument()
  })

  it('shows error banner', () => {
    vi.mocked(useCreateBooking).mockReturnValue({ ...defaultHookReturn, error: 'Name required' })
    render(<CreateBookingView />)
    expect(screen.getByText('Name required')).toBeInTheDocument()
  })

  it('shows success banner', () => {
    vi.mocked(useCreateBooking).mockReturnValue({
      ...defaultHookReturn,
      success: 'Booking created!',
    })
    render(<CreateBookingView />)
    expect(screen.getByText('Booking created!')).toBeInTheDocument()
  })

  it('renders member insight panel when member found', () => {
    vi.mocked(useCreateBooking).mockReturnValue({
      ...defaultHookReturn,
      memberInsight: {
        id: 'm1',
        name: 'VIP Member',
        mobile: '9876543210',
        membership: 'Gold',
        totalVisits: 15,
        totalBillAmount: 25000,
        coupons150Available: 3,
        coupons150Redeemed: 2,
        email: '',
        walletBalance: 0,
        starStatus: '',
        lastVisitDate: new Date(),
        lastVisitLocation: '',
        updatedAt: new Date(),
      },
    })
    render(<CreateBookingView />)
    expect(screen.getByText('Member Insight')).toBeInTheDocument()
    expect(screen.getByText('Gold')).toBeInTheDocument()
  })

  it('shows Protocol toggle', () => {
    render(<CreateBookingView />)
    expect(screen.getByText('Protocol')).toBeInTheDocument()
  })

  it('shows protocol reason input when protocol enabled', () => {
    vi.mocked(useCreateBooking).mockReturnValue({ ...defaultHookReturn, isProtocol: true })
    render(<CreateBookingView />)
    expect(screen.getByPlaceholderText('Reason for protocol *')).toBeInTheDocument()
    expect(screen.getByText('Create Protocol Booking')).toBeInTheDocument()
  })

  it('shows benefit mode radios when not protocol', () => {
    render(<CreateBookingView />)
    expect(screen.getByText('Discount')).toBeInTheDocument()
  })

  it('shows loading state for catalog', () => {
    vi.mocked(useCreateBooking).mockReturnValue({ ...defaultHookReturn, activitiesLoading: true })
    render(<CreateBookingView />)
    expect(screen.getByText('Loading Firestore activity catalog...')).toBeInTheDocument()
  })
})
