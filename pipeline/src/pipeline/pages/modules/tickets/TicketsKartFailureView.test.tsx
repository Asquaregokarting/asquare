import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Ticket, TicketLinkedEntity } from '../../../api/types'
import { TicketsKartFailureView } from './TicketsKartFailureView'

const baseTicket: Ticket = {
  id: 'TKT-1',
  schemaVersion: 2,
  title: 'sample',
  description: 'sample',
  categoryId: 'track-safety',
  priority: 'Critical',
  tags: [],
  status: 'Open',
  role: 'TrackMarshall',
  raisedBy: 'u1',
  raisedByName: 'User One',
  raisedByKind: 'staff',
  branchId: 'vizag',
  branchDisplayName: 'Vizag',
  assignedTo: 'Developer',
  assigneeId: 'a1',
  assigneeRole: 'TrackMarshall',
  assigneeName: 'Marshall',
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
  assignedToName: 'Marshall',
  createdAt: '2026-04-20T04:30:00.000Z',
  updatedAt: '2026-04-20T04:30:00.000Z',
}

const kart = (id: string): TicketLinkedEntity => ({ type: 'kart', id, label: id })

let role: string = 'Owner'
let mockTickets: Ticket[] = [
  { ...baseTicket, id: 'A', linkedEntities: [kart('K-01')] },
  { ...baseTicket, id: 'B', linkedEntities: [kart('K-01')] },
  { ...baseTicket, id: 'C', linkedEntities: [kart('K-02')] },
]

vi.mock('../../../features/auth/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1', name: 'U', role } } }),
}))

vi.mock('../../../api/tickets', () => ({
  subscribeToTickets: (
    onData: (rows: Ticket[]) => void,
    _onError: (err: Error) => void,
  ): (() => void) => {
    onData(mockTickets)
    return () => {}
  },
}))

describe('TicketsKartFailureView', () => {
  it('renders the failure table for an authorized role', () => {
    role = 'Owner'
    mockTickets = [
      { ...baseTicket, id: 'A', linkedEntities: [kart('K-01')] },
      { ...baseTicket, id: 'B', linkedEntities: [kart('K-01')] },
      { ...baseTicket, id: 'C', linkedEntities: [kart('K-02')] },
    ]
    render(
      <MemoryRouter>
        <TicketsKartFailureView />
      </MemoryRouter>,
    )
    expect(screen.getByText('K-01')).toBeInTheDocument()
    expect(screen.getByText('K-02')).toBeInTheDocument()
    // K-01 has count 2.
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('blocks unauthorized roles', () => {
    role = 'Cashier'
    render(
      <MemoryRouter>
        <TicketsKartFailureView />
      </MemoryRouter>,
    )
    expect(screen.getByText(/restricted to track-ops/i)).toBeInTheDocument()
  })

  it('shows an empty state when there are no kart incidents', () => {
    role = 'Owner'
    mockTickets = []
    render(
      <MemoryRouter>
        <TicketsKartFailureView />
      </MemoryRouter>,
    )
    expect(screen.getByText(/no kart-linked track/i)).toBeInTheDocument()
  })
})
