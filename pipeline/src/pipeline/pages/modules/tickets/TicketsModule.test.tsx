import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TicketsModule from './TicketsModule'

vi.mock('../../../api/tickets', () => ({
  subscribeToTickets: (
    onData: (rows: unknown[]) => void,
    _onError: (err: Error) => void,
  ): (() => void) => {
    onData([])
    return () => {}
  },
}))

vi.mock('../../../api/ticket-categories', () => ({
  subscribeToTicketCategories: (_onData: unknown, _onError: unknown) => () => {},
  ensureSeedCategories: () => Promise.resolve(),
}))

vi.mock('../../../features/auth/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1', name: 'U', role: 'Owner' } } }),
}))

vi.mock('../../../features/toast/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

describe('TicketsModule', () => {
  it('renders the list view heading', () => {
    render(
      <MemoryRouter initialEntries={['/tickets']}>
        <TicketsModule view="list" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /tickets/i })).toBeInTheDocument()
  })

  it('renders the sub-nav with all six tabs', () => {
    render(
      <MemoryRouter initialEntries={['/tickets']}>
        <TicketsModule view="list" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /^list$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /analytics/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /branch/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /heatmap/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /karts/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /my tickets/i })).toBeInTheDocument()
  })

  it('dispatches to the analytics view when view="analytics"', () => {
    render(
      <MemoryRouter initialEntries={['/tickets/analytics']}>
        <TicketsModule view="analytics" />
      </MemoryRouter>,
    )
    expect(screen.getByText(/open by branch/i)).toBeInTheDocument()
  })

  it('dispatches to the My tickets view when view="mine"', () => {
    render(
      <MemoryRouter initialEntries={['/tickets/mine']}>
        <TicketsModule view="mine" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('tab', { name: /assigned to me/i })).toBeInTheDocument()
  })
})
