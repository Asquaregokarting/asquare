import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockListDeletedBookings = vi.fn()

vi.mock('../../../api/asquare-bookings', () => ({
  asquareBookingsApi: {
    listDeletedBookings: (...args: unknown[]) => mockListDeletedBookings(...args),
  },
}))

vi.mock('../../../hooks/useLocations', () => ({
  useLocations: vi.fn(() => ({
    enabledLocations: [
      { slug: 'visakhapatnam', displayName: 'Vizag' },
      { slug: 'kakinada', displayName: 'Kakinada' },
    ],
  })),
}))

vi.mock('../../../../lib/date-format', () => ({
  fmtDateIST: vi.fn(() => '2026-04-13'),
}))

import TrashView from './TrashView'

describe('TrashView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    mockListDeletedBookings.mockReturnValue(new Promise(() => {}))
    render(<TrashView />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows empty state when no deleted bookings', async () => {
    mockListDeletedBookings.mockResolvedValue([])
    render(<TrashView />)
    await waitFor(() => {
      expect(screen.getByText('No deleted bookings found.')).toBeInTheDocument()
    })
  })

  it('renders deleted booking rows', async () => {
    mockListDeletedBookings.mockResolvedValue([
      {
        id: 'ASG001',
        userDisplayName: 'Deleted User',
        userPhone: '9876543210',
        locationId: 'visakhapatnam',
        finalAmount: 1000,
        deletedAt: new Date('2026-04-12'),
        deletedBy: { id: 'admin1', name: 'Admin', role: 'Owner' },
      },
    ])
    render(<TrashView />)
    await waitFor(() => {
      expect(screen.getByText('ASG001')).toBeInTheDocument()
    })
    expect(screen.getByText('Deleted User')).toBeInTheDocument()
    expect(screen.getByText('9876543210')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('renders search input', async () => {
    mockListDeletedBookings.mockResolvedValue([])
    render(<TrashView />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search by ID, name, or phone...')).toBeInTheDocument()
    })
  })

  it('filters by search term', async () => {
    mockListDeletedBookings.mockResolvedValue([
      {
        id: 'ASG001',
        userDisplayName: 'Alice',
        userPhone: '1111111111',
        locationId: 'visakhapatnam',
        finalAmount: 500,
        deletedAt: new Date(),
        deletedBy: { id: 'a', name: 'Admin', role: 'Owner' },
      },
      {
        id: 'ASG002',
        userDisplayName: 'Bob',
        userPhone: '2222222222',
        locationId: 'kakinada',
        finalAmount: 700,
        deletedAt: new Date(),
        deletedBy: { id: 'a', name: 'Admin', role: 'Owner' },
      },
    ])
    render(<TrashView />)
    await waitFor(() => {
      expect(screen.getByText('ASG001')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('Search by ID, name, or phone...'), {
      target: { value: 'Bob' },
    })
    expect(screen.queryByText('ASG001')).not.toBeInTheDocument()
    expect(screen.getByText('ASG002')).toBeInTheDocument()
  })

  it('shows error on load failure', async () => {
    mockListDeletedBookings.mockRejectedValue(new Error('Failed to fetch'))
    render(<TrashView />)
    await waitFor(() => {
      expect(screen.getByText('Failed to fetch')).toBeInTheDocument()
    })
  })
})
