import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { autoMockApi } from '../../../test/auto-mock-api'

vi.mock('../../components/layout/ModulePageLayout', () => ({
  ModulePageLayout: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="module-layout" data-title={title}>
      {children}
    </div>
  ),
}))
vi.mock('../../features/auth/auth-context', () => ({
  useAuth: vi.fn(() => ({
    session: { user: { id: 'u1', name: 'Owner', role: 'Owner' }, token: 'fake' },
  })),
}))
vi.mock('../../hooks/useLocations', () => ({
  useLocations: vi.fn(() => ({
    enabledLocations: [{ slug: 'visakhapatnam', displayName: 'Vizag' }],
    isRoleLocked: false,
  })),
}))
vi.mock('../../../lib/locations', () => ({
  slugToBranchId: vi.fn((s: string) => s),
  getLocationShortName: vi.fn((s: string) => s),
  getLocationDisplayName: vi.fn((s: string) => s),
  getAllLocations: vi.fn(() => []),
}))
vi.mock('../../../lib/date-format', () => ({
  fmtDateTimeFullIST: vi.fn(() => ''),
  fmtDateIST: vi.fn(() => ''),
  todayIST: vi.fn(() => '2026-04-13'),
}))
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../api/track', () => ({ trackApi: autoMockApi() }))
vi.mock('../../api/kart-report', () => ({ subscribeKartReport: vi.fn(() => vi.fn()) }))
vi.mock('../../components/ui/DataTable', () => ({ DataTable: () => null }))
vi.mock('../../components/ui/FilterBar', () => ({
  FilterBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FilterField: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('../../components/ui/StatusBadge', () => ({
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import TrackModule from './TrackModule'
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('TrackModule', () => {
  it('renders board view', () => {
    wrap(<TrackModule />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it.todo('renders karts view — needs trackApi subscription mock (monolith)')
  it('renders sessions view', () => {
    wrap(<TrackModule view="sessions" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders scanner view', () => {
    wrap(<TrackModule view="scanner" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it.todo('renders reports view — needs trackApi subscription mock (monolith)')
})
