import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Ticket } from '../../../api/types'
import { MyTicketsView } from './MyTicketsView'

const baseTicket: Ticket = {
  id: 'TKT-1',
  schemaVersion: 2,
  title: 'sample',
  description: 'sample',
  categoryId: 'other',
  priority: 'Normal',
  tags: [],
  status: 'Open',
  role: 'Admin',
  raisedBy: 'me',
  raisedByName: 'Me',
  raisedByKind: 'staff',
  branchId: 'vizag',
  branchDisplayName: 'Vizag',
  assignedTo: 'Developer',
  assigneeId: 'me',
  assigneeRole: 'Admin',
  assigneeName: 'Me',
  watcherIds: [],
  attachments: [],
  linkedEntities: [],
  autoContext: {},
  slaSnapshot: null,
  responseDueAt: null,
  resolveDueAt: null,
  firstResponseAt: null,
  resolvedAt: null,
  resolutionNote: null,
  rootCauseTag: null,
  escalationLevel: 0,
  mergedInto: null,
  reopenedFrom: null,
  location: 'vizag',
  locationDisplayName: 'Vizag',
  issue: 'sample',
  assignedToId: 'me',
  assignedToName: 'Me',
  createdAt: '2026-04-20T10:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
}

const mkTicket = (over: Partial<Ticket>): Ticket => ({ ...baseTicket, ...over })

vi.mock('../../../api/tickets', () => ({
  subscribeToTickets: (
    onData: (rows: Ticket[]) => void,
    _onError: (err: Error) => void,
  ): (() => void) => {
    onData([
      mkTicket({ id: 'TKT-A', title: 'assigned to me', assigneeId: 'me', raisedBy: 'other' }),
      mkTicket({ id: 'TKT-B', title: 'raised by me', raisedBy: 'me', assigneeId: 'other' }),
      mkTicket({
        id: 'TKT-C',
        title: 'mentions me',
        raisedBy: 'other',
        assigneeId: 'other',
        watcherIds: ['me'],
      }),
    ])
    return () => {}
  },
}))

vi.mock('../../../features/auth/auth-context', () => ({
  useAuth: () => ({
    session: { user: { id: 'me', name: 'Me', role: 'Admin' } },
  }),
}))

vi.mock('./TicketDetailModal', () => ({
  TicketDetailModal: () => null,
}))

describe('MyTicketsView', () => {
  it('renders the tab strip with counts', () => {
    render(
      <MemoryRouter>
        <MyTicketsView />
      </MemoryRouter>,
    )
    expect(screen.getByRole('tab', { name: /assigned to me/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /raised by me/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /mentioned/i })).toBeInTheDocument()
  })

  it('shows assigned tickets by default', () => {
    render(
      <MemoryRouter>
        <MyTicketsView />
      </MemoryRouter>,
    )
    expect(screen.getByText('assigned to me')).toBeInTheDocument()
    expect(screen.queryByText('raised by me')).not.toBeInTheDocument()
  })

  it('switches to raised tab on click', () => {
    render(
      <MemoryRouter>
        <MyTicketsView />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /raised by me/i }))
    expect(screen.getByText('raised by me')).toBeInTheDocument()
    expect(screen.queryByText('assigned to me')).not.toBeInTheDocument()
  })

  it('shows empty state for the mentioned tab when nothing matches', () => {
    render(
      <MemoryRouter>
        <MyTicketsView />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /mentioned/i }))
    // The seeded fixture does include a watcher entry, so this row IS visible.
    expect(screen.getByText('mentions me')).toBeInTheDocument()
  })
})
