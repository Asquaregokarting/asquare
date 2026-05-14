import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Ticket } from '../../../api/types'
import { TicketsBranchView } from './TicketsBranchView'

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
  createdAt: '2026-04-20T10:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
}

const mk = (over: Partial<Ticket>): Ticket => ({ ...baseTicket, ...over })

let role: string = 'Incharge'
let allowedLocations: string[] = ['vizag']

vi.mock('../../../features/auth/auth-context', () => ({
  useAuth: () => ({
    session: { user: { id: 'u1', name: 'U', role, allowedLocations } },
  }),
}))

vi.mock('../../../api/tickets', () => ({
  subscribeToTickets: (
    onData: (rows: Ticket[]) => void,
    _onError: (err: Error) => void,
  ): (() => void) => {
    onData([
      mk({ id: 'A', branchId: 'vizag', status: 'Open', title: 'oldest' }),
      mk({ id: 'B', branchId: 'vizag', status: 'In Progress' }),
      mk({ id: 'C', branchId: 'guntur', status: 'Open' }),
    ])
    return () => {}
  },
}))

describe('TicketsBranchView', () => {
  it('shows the four cards for an Incharge user with a branch', () => {
    role = 'Incharge'
    allowedLocations = ['vizag']
    render(
      <MemoryRouter>
        <TicketsBranchView />
      </MemoryRouter>,
    )
    expect(screen.getByText(/open in my branch/i)).toBeInTheDocument()
    expect(screen.getByText(/breaches today/i)).toBeInTheDocument()
    expect(screen.getByText(/team mttr/i)).toBeInTheDocument()
    expect(screen.getByText(/oldest unresolved/i)).toBeInTheDocument()
  })

  it('blocks unauthorized roles', () => {
    role = 'Cashier'
    allowedLocations = ['vizag']
    render(
      <MemoryRouter>
        <TicketsBranchView />
      </MemoryRouter>,
    )
    expect(screen.getByText(/restricted to incharge or admin/i)).toBeInTheDocument()
  })

  it('warns the user when they have no branch assigned', () => {
    role = 'Incharge'
    allowedLocations = []
    render(
      <MemoryRouter>
        <TicketsBranchView />
      </MemoryRouter>,
    )
    expect(screen.getByText(/no branch assigned/i)).toBeInTheDocument()
  })
})
