import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Ticket } from '../../../api/types'
import { TicketsHeatmapView } from './TicketsHeatmapView'

const baseTicket: Ticket = {
  id: 'TKT-1',
  schemaVersion: 2,
  title: 'sample',
  description: 'sample',
  categoryId: 'track-safety',
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
  createdAt: '2026-04-20T04:30:00.000Z', // 10:00 IST
  updatedAt: '2026-04-20T04:30:00.000Z',
}

let role: string = 'Owner'
const tickets: Ticket[] = [
  { ...baseTicket, id: 'A' },
  { ...baseTicket, id: 'B', createdAt: '2026-04-20T05:30:00.000Z' }, // 11 IST
]

vi.mock('../../../features/auth/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1', name: 'U', role } } }),
}))

vi.mock('../../../api/tickets', () => ({
  subscribeToTickets: (
    onData: (rows: Ticket[]) => void,
    _onError: (err: Error) => void,
  ): (() => void) => {
    onData(tickets)
    return () => {}
  },
}))

vi.mock('../../../api/ticket-categories', () => ({
  subscribeToTicketCategories: (
    onData: (rows: unknown[]) => void,
    _onError: (err: Error) => void,
  ): (() => void) => {
    onData([
      {
        id: 'track-safety',
        label: 'Track / Safety',
        priorityFloor: 'Critical',
        responseSlaSeconds: 900,
        resolveSlaSeconds: 7200,
        routingChain: ['TrackMarshall'],
        active: true,
        sortOrder: 10,
      },
    ])
    return () => {}
  },
}))

describe('TicketsHeatmapView', () => {
  it('renders the heatmap header for Owner', () => {
    role = 'Owner'
    render(
      <MemoryRouter>
        <TicketsHeatmapView />
      </MemoryRouter>,
    )
    expect(screen.getByText(/branch · category · hour/i)).toBeInTheDocument()
    // The "Branch · Category" cell label is shown.
    expect(screen.getByText('Branch · Category')).toBeInTheDocument()
  })

  it('blocks unauthorized roles', () => {
    role = 'Cashier'
    render(
      <MemoryRouter>
        <TicketsHeatmapView />
      </MemoryRouter>,
    )
    expect(screen.getByText(/restricted to owner/i)).toBeInTheDocument()
  })
})
