import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockListAdminBookings = vi.fn()

vi.mock('../../../api/asquare-bookings', () => ({
  asquareBookingsApi: {
    listAdminBookings: (...args: unknown[]) => mockListAdminBookings(...args),
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

const mockPrintTicket = vi.fn(() => Promise.resolve({ success: true }))
vi.mock('./usePrintTicket', () => ({
  usePrintTicket: vi.fn(() => ({
    printTicket: mockPrintTicket,
    printing: false,
    reprintMessage: null,
    clearReprintMessage: vi.fn(),
    reprintConfirm: null,
    resolveReprintConfirm: vi.fn(),
  })),
}))

vi.mock('../../../components/ui/ConfirmDialog', () => ({
  ConfirmDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="confirm-dialog">ConfirmDialog</div> : null,
}))

import TicketLookupView from './TicketLookupView'

describe('TicketLookupView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders search input and button', () => {
    render(<TicketLookupView />)
    expect(screen.getByPlaceholderText(/Phone, Name, Booking ID/)).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()
  })

  it('disables search button when query is empty', () => {
    render(<TicketLookupView />)
    expect(screen.getByText('Search')).toBeDisabled()
  })

  it('shows search results after query', async () => {
    mockListAdminBookings.mockResolvedValue([
      {
        id: 'ASG001',
        userDisplayName: 'John',
        userPhone: '9876543210',
        bookingStatus: 'confirmed',
        paymentStatus: 'completed',
        finalAmount: 1000,
        sessionDate: new Date('2026-04-15'),
        items: [{ activity: { name: 'Go Karting' }, quantity: 2 }],
      },
    ])
    render(<TicketLookupView />)
    fireEvent.change(screen.getByPlaceholderText(/Phone, Name, Booking ID/), {
      target: { value: '9876543210' },
    })
    fireEvent.click(screen.getByText('Search'))
    await waitFor(() => {
      expect(screen.getByText('ASG001')).toBeInTheDocument()
    })
    expect(screen.getByText(/John/)).toBeInTheDocument()
    expect(screen.getByText('Print Ticket')).toBeInTheDocument()
  })

  it('shows no results message', async () => {
    mockListAdminBookings.mockResolvedValue([])
    render(<TicketLookupView />)
    fireEvent.change(screen.getByPlaceholderText(/Phone, Name, Booking ID/), {
      target: { value: 'nonexistent' },
    })
    fireEvent.click(screen.getByText('Search'))
    await waitFor(() => {
      expect(screen.getByText(/No bookings found/)).toBeInTheDocument()
    })
  })

  it('disables print for non-completed payments', async () => {
    mockListAdminBookings.mockResolvedValue([
      {
        id: 'ASG002',
        userDisplayName: 'Jane',
        userPhone: '1234567890',
        bookingStatus: 'pending',
        paymentStatus: 'pending',
        finalAmount: 500,
        sessionDate: new Date('2026-04-15'),
        items: [{ activity: { name: 'Bowling' }, quantity: 1 }],
      },
    ])
    render(<TicketLookupView />)
    fireEvent.change(screen.getByPlaceholderText(/Phone, Name, Booking ID/), {
      target: { value: '1234567890' },
    })
    fireEvent.click(screen.getByText('Search'))
    await waitFor(() => {
      expect(screen.getByText('Payment Pending')).toBeInTheDocument()
    })
    expect(screen.getByText('Payment Pending')).toBeDisabled()
  })

  it('shows searching state', async () => {
    mockListAdminBookings.mockReturnValue(new Promise(() => {}))
    render(<TicketLookupView />)
    fireEvent.change(screen.getByPlaceholderText(/Phone, Name, Booking ID/), {
      target: { value: 'test' },
    })
    fireEvent.click(screen.getByText('Search'))
    expect(screen.getByText('Searching...')).toBeInTheDocument()
  })
})
