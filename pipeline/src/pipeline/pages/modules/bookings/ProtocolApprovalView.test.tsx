import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockListProtocol = vi.fn()
const mockApproveProtocol = vi.fn()
const mockRejectProtocol = vi.fn()

vi.mock('../../../api/asquare-bookings', () => ({
  asquareBookingsApi: {
    listProtocolBookings: (...args: unknown[]) => mockListProtocol(...args),
    approveProtocol: (...args: unknown[]) => mockApproveProtocol(...args),
    rejectProtocol: (...args: unknown[]) => mockRejectProtocol(...args),
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

vi.mock('../../../../lib/locations', () => ({
  getLocationDisplayName: vi.fn((id: string) => id),
}))

// Mock ConfirmDialog to auto-render and capture props
vi.mock('../../../components/ui/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    onConfirm,
    onCancel,
  }: {
    open: boolean
    title: string
    onConfirm: () => void
    onCancel: () => void
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onCancel}>Cancel Dialog</button>
      </div>
    ) : null,
}))

import ProtocolApprovalView from './ProtocolApprovalView'
import { useAuth } from '../../../features/auth/auth-context'

describe('ProtocolApprovalView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListProtocol.mockResolvedValue([])
  })

  it('shows loading state initially', () => {
    mockListProtocol.mockReturnValue(new Promise(() => {}))
    render(<ProtocolApprovalView />)
    expect(screen.getByText('Loading protocol bookings...')).toBeInTheDocument()
  })

  it('shows empty state when no bookings', async () => {
    mockListProtocol.mockResolvedValue([])
    render(<ProtocolApprovalView />)
    await waitFor(() => {
      expect(screen.getByText('No protocol bookings found.')).toBeInTheDocument()
    })
  })

  it('renders pending protocol bookings', async () => {
    mockListProtocol.mockResolvedValue([
      {
        id: 'ASG001',
        locationId: 'vizag',
        createdAt: new Date(),
        items: [],
        protocolStatus: 'pending_approval',
        userDisplayName: 'John',
        userPhone: '9876543210',
        createdByAdminName: 'Admin',
        createdByRole: 'Admin',
        protocolReason: 'VIP guest',
      },
    ])
    render(<ProtocolApprovalView />)
    await waitFor(() => {
      expect(screen.getByText('Pending Approval (1)')).toBeInTheDocument()
    })
    expect(screen.getByText('ASG001')).toBeInTheDocument()
    expect(screen.getByText(/VIP guest/)).toBeInTheDocument()
  })

  it('renders resolved protocol bookings', async () => {
    mockListProtocol.mockResolvedValue([
      {
        id: 'ASG002',
        locationId: 'vizag',
        createdAt: new Date(),
        items: [],
        protocolStatus: 'approved',
        userDisplayName: 'Jane',
        userPhone: '1234567890',
        protocolApprovedBy: 'Owner',
      },
    ])
    render(<ProtocolApprovalView />)
    await waitFor(() => {
      expect(screen.getByText('History (1)')).toBeInTheDocument()
    })
    expect(screen.getByText('ASG002')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  it('opens confirm dialog on approve click', async () => {
    mockListProtocol.mockResolvedValue([
      {
        id: 'ASG001',
        locationId: 'vizag',
        createdAt: new Date(),
        items: [],
        protocolStatus: 'pending_approval',
        userDisplayName: 'John',
        userPhone: '9876543210',
      },
    ])
    render(<ProtocolApprovalView />)
    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Approve'))
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText('Approve Protocol Booking')).toBeInTheDocument()
  })

  it('shows rejection reason input', async () => {
    mockListProtocol.mockResolvedValue([
      {
        id: 'ASG001',
        locationId: 'vizag',
        createdAt: new Date(),
        items: [],
        protocolStatus: 'pending_approval',
        userDisplayName: 'John',
        userPhone: '9876543210',
      },
    ])
    render(<ProtocolApprovalView />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Rejection reason')).toBeInTheDocument()
    })
  })

  it('non-owner sees restricted message', async () => {
    vi.mocked(useAuth).mockReturnValue({
      session: { user: { id: 'u2', name: 'Admin', role: 'Admin' }, token: 'fake' },
    } as ReturnType<typeof useAuth>)
    mockListProtocol.mockResolvedValue([
      {
        id: 'ASG001',
        locationId: 'vizag',
        createdAt: new Date(),
        items: [],
        protocolStatus: 'pending_approval',
        userDisplayName: 'John',
        userPhone: '9876543210',
      },
    ])
    render(<ProtocolApprovalView />)
    await waitFor(() => {
      expect(screen.getByText(/Only the Owner can approve/)).toBeInTheDocument()
    })
  })

  it('shows error on load failure', async () => {
    mockListProtocol.mockRejectedValue(new Error('Network error'))
    render(<ProtocolApprovalView />)
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })
})
