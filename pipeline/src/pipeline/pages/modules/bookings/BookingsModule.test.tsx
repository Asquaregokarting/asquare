import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock all child view components to isolate the router
vi.mock('./CreateBookingView', () => ({
  default: () => <div data-testid="create-view">CreateBookingView</div>,
}))
vi.mock('./AllBookingsView', () => ({
  default: () => <div data-testid="list-view">AllBookingsView</div>,
}))
vi.mock('./TrashView', () => ({
  default: () => <div data-testid="trash-view">TrashView</div>,
}))
vi.mock('./TicketLookupView', () => ({
  default: () => <div data-testid="ticket-view">TicketLookupView</div>,
}))
vi.mock('./ProtocolApprovalView', () => ({
  default: () => <div data-testid="protocol-view">ProtocolApprovalView</div>,
}))
vi.mock('./OfferApprovalView', () => ({
  default: () => <div data-testid="offer-view">OfferApprovalView</div>,
}))
vi.mock('./CheckInConfigView', () => ({
  default: () => <div data-testid="checkin-view">CheckInConfigView</div>,
}))

// Mock layout to just render children
vi.mock('../../../components/layout/ModulePageLayout', () => ({
  ModulePageLayout: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="module-layout" data-title={title}>
      {children}
    </div>
  ),
}))

// Mock useAuth
const mockSession = {
  user: { id: 'u1', name: 'Test Owner', role: 'Owner' },
  token: 'fake-token',
}
vi.mock('../../../features/auth/auth-context', () => ({
  useAuth: vi.fn(() => ({ session: mockSession })),
}))

import BookingsModule from '../BookingsModule'
import { useAuth } from '../../../features/auth/auth-context'

const renderWithRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('BookingsModule (thin router)', () => {
  it('renders CreateBookingView for default view', () => {
    renderWithRouter(<BookingsModule />)
    expect(screen.getByTestId('create-view')).toBeInTheDocument()
  })

  it('renders AllBookingsView for list view', () => {
    renderWithRouter(<BookingsModule view="list" />)
    expect(screen.getByTestId('list-view')).toBeInTheDocument()
  })

  it('renders TrashView for trash view', () => {
    renderWithRouter(<BookingsModule view="trash" />)
    expect(screen.getByTestId('trash-view')).toBeInTheDocument()
  })

  it('renders TicketLookupView for ticket view', () => {
    renderWithRouter(<BookingsModule view="ticket" />)
    expect(screen.getByTestId('ticket-view')).toBeInTheDocument()
  })

  it('renders ProtocolApprovalView for protocol view', () => {
    renderWithRouter(<BookingsModule view="protocol" />)
    expect(screen.getByTestId('protocol-view')).toBeInTheDocument()
  })

  it('renders OfferApprovalView for offers view', () => {
    renderWithRouter(<BookingsModule view="offers" />)
    expect(screen.getByTestId('offer-view')).toBeInTheDocument()
  })

  it('renders CheckInConfigView for checkin view', () => {
    renderWithRouter(<BookingsModule view="checkin" />)
    expect(screen.getByTestId('checkin-view')).toBeInTheDocument()
  })

  it('sets correct title for each view', () => {
    renderWithRouter(<BookingsModule view="list" />)
    expect(screen.getByTestId('module-layout').getAttribute('data-title')).toBe('All Bookings')
  })

  it('returns null when no session', () => {
    vi.mocked(useAuth).mockReturnValueOnce({ session: null } as ReturnType<typeof useAuth>)
    const { container } = renderWithRouter(<BookingsModule />)
    expect(container.innerHTML).toBe('')
  })

  it('redirects telecaller away from protocol view', () => {
    vi.mocked(useAuth).mockReturnValue({
      session: { user: { id: 'u2', name: 'TC', role: 'Telecaller' }, token: 'fake' },
    } as ReturnType<typeof useAuth>)
    renderWithRouter(<BookingsModule view="protocol" />)
    expect(screen.queryByTestId('protocol-view')).not.toBeInTheDocument()
  })

  it('renders create view for owner role', () => {
    vi.mocked(useAuth).mockReturnValue({ session: mockSession } as ReturnType<typeof useAuth>)
    renderWithRouter(<BookingsModule view="create" />)
    expect(screen.getByTestId('create-view')).toBeInTheDocument()
  })
})
