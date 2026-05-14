import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Ticket } from '../../../api/types'
import { TicketsAnalyticsView } from './TicketsAnalyticsView'

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
  raisedBy: 'u1',
  raisedByName: 'User One',
  raisedByKind: 'staff',
  branchId: 'vizag',
  branchDisplayName: 'Vizag',
  assignedTo: 'Developer',
  assigneeId: 'a1',
  assigneeRole: 'Admin',
  assigneeName: 'Assignee',
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
  assignedToId: 'a1',
  assignedToName: 'Assignee',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const mk = (over: Partial<Ticket>): Ticket => ({ ...baseTicket, ...over })

let role: string = 'Owner'

vi.mock('../../../features/auth/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1', name: 'U', role } } }),
}))

vi.mock('../../../api/tickets', () => ({
  subscribeToTickets: (
    onData: (rows: Ticket[]) => void,
    _onError: (err: Error) => void,
  ): (() => void) => {
    onData([
      mk({ id: 'A', branchId: 'vizag', status: 'Open' }),
      mk({ id: 'B', branchId: 'vizag', status: 'In Progress' }),
      mk({ id: 'C', branchId: 'guntur', status: 'Open' }),
      mk({ id: 'D', branchId: 'vizag', status: 'Resolved' }),
    ])
    return () => {}
  },
}))

vi.mock('../../../api/ticket-categories', () => ({
  subscribeToTicketCategories: (
    onData: (rows: unknown[]) => void,
    _onError: (err: Error) => void,
  ): (() => void) => {
    onData([])
    return () => {}
  },
}))

describe('TicketsAnalyticsView', () => {
  it('renders the Owner cards', () => {
    role = 'Owner'
    render(
      <MemoryRouter>
        <TicketsAnalyticsView />
      </MemoryRouter>,
    )
    expect(screen.getByText(/open by branch/i)).toBeInTheDocument()
    expect(screen.getByText(/mttr per branch/i)).toBeInTheDocument()
    expect(screen.getByText(/sla breach rate/i)).toBeInTheDocument()
  })

  it('blocks non-owner roles', () => {
    role = 'Cashier'
    render(
      <MemoryRouter>
        <TicketsAnalyticsView />
      </MemoryRouter>,
    )
    expect(screen.getByText(/owner-tier analytics is restricted/i)).toBeInTheDocument()
  })
})
