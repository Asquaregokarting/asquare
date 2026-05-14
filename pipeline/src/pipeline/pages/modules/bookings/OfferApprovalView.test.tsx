import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const mockListOffers = vi.fn()

vi.mock('../../../api/asquare-bookings', () => ({
  asquareBookingsApi: {
    listOfferBookings: (...args: unknown[]) => mockListOffers(...args),
    approveOffer: vi.fn(() => Promise.resolve()),
    rejectOffer: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock('../../../features/auth/auth-context', () => ({
  useAuth: vi.fn(() => ({
    session: { user: { id: 'u1', name: 'Test Owner', role: 'Owner' }, token: 'fake' },
  })),
}))

vi.mock('../../../../lib/date-format', () => ({
  fmtDateIST: vi.fn(() => '2026-04-13'),
}))

vi.mock('../../../components/ui/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div data-testid="confirm-dialog">{title}</div> : null,
}))

import OfferApprovalView from './OfferApprovalView'
import { useAuth } from '../../../features/auth/auth-context'

describe('OfferApprovalView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListOffers.mockResolvedValue([])
  })

  it('shows loading state', () => {
    mockListOffers.mockReturnValue(new Promise(() => {}))
    render(<OfferApprovalView />)
    expect(screen.getByText('Loading offer bookings...')).toBeInTheDocument()
  })

  it('shows empty state', async () => {
    render(<OfferApprovalView />)
    await waitFor(() => {
      expect(screen.getByText('No offer bookings found.')).toBeInTheDocument()
    })
  })

  it('renders pending offers', async () => {
    mockListOffers.mockResolvedValue([
      {
        id: 'ASG001',
        locationId: 'vizag',
        createdAt: new Date(),
        items: [],
        offerStatus: 'pending_approval',
        userDisplayName: 'Customer',
        userPhone: '9876543210',
        totalAmount: 500,
        paymentMethod: 'Cash',
      },
    ])
    render(<OfferApprovalView />)
    await waitFor(() => {
      expect(screen.getByText('Pending Approval (1)')).toBeInTheDocument()
    })
    expect(screen.getByText('ASG001')).toBeInTheDocument()
  })

  it('renders resolved offers with status badges', async () => {
    mockListOffers.mockResolvedValue([
      {
        id: 'ASG002',
        locationId: 'vizag',
        createdAt: new Date(),
        items: [],
        offerStatus: 'approved',
        userDisplayName: 'Jane',
        userPhone: '1234567890',
        offerApprovedBy: 'Owner',
        totalAmount: 300,
        paymentMethod: 'Cash',
      },
    ])
    render(<OfferApprovalView />)
    await waitFor(() => {
      expect(screen.getByText('History (1)')).toBeInTheDocument()
    })
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  it('shows approve/reject buttons for owner', async () => {
    mockListOffers.mockResolvedValue([
      {
        id: 'ASG001',
        locationId: 'vizag',
        createdAt: new Date(),
        items: [],
        offerStatus: 'pending_approval',
        userDisplayName: 'Customer',
        userPhone: '9876543210',
        totalAmount: 500,
        paymentMethod: 'Cash',
      },
    ])
    render(<OfferApprovalView />)
    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeInTheDocument()
    })
    expect(screen.getByText('Reject')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Rejection reason')).toBeInTheDocument()
  })

  it('non-owner sees restricted message', async () => {
    vi.mocked(useAuth).mockReturnValue({
      session: { user: { id: 'u2', name: 'Admin', role: 'Admin' }, token: 'fake' },
    } as ReturnType<typeof useAuth>)
    mockListOffers.mockResolvedValue([
      {
        id: 'ASG001',
        locationId: 'vizag',
        createdAt: new Date(),
        items: [],
        offerStatus: 'pending_approval',
        userDisplayName: 'Customer',
        userPhone: '9876543210',
        totalAmount: 500,
        paymentMethod: 'Cash',
      },
    ])
    render(<OfferApprovalView />)
    await waitFor(() => {
      expect(screen.getByText(/Only the Owner can approve/)).toBeInTheDocument()
    })
  })

  it('shows error on load failure', async () => {
    mockListOffers.mockRejectedValue(new Error('API failure'))
    render(<OfferApprovalView />)
    await waitFor(() => {
      expect(screen.getByText('API failure')).toBeInTheDocument()
    })
  })
})
