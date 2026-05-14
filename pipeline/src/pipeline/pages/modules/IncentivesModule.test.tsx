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
vi.mock('../../api/incentives-firestore', () => ({
  incentivesApi: autoMockApi({
    getDashboard: vi.fn(() => Promise.resolve(null)),
    getConfig: vi.fn(() => Promise.resolve(null)),
  }),
  DEFAULT_INCENTIVE_CONFIG: {},
}))
vi.mock('../../api/billing', () => ({
  billingApi: autoMockApi({ listTransactions: vi.fn(() => Promise.resolve([])) }),
}))
vi.mock('../../features/game-revenue/aggregate', () => ({
  aggregateGameRevenue: vi.fn(() => ({
    totals: { revenue: 0, bySource: {} },
    games: [],
    contributingTransactions: 0,
    skippedTransactions: 0,
  })),
}))
vi.mock('../../components/ui/DataTable', () => ({ DataTable: () => null }))
vi.mock('../../components/ui/FilterBar', () => ({
  FilterBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FilterField: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../components/ui/KpiCard', () => ({ KpiCard: () => null }))
vi.mock('../../components/ui/SummaryCards', () => ({ SummaryCards: () => null }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ ConfirmDialog: () => null }))

import IncentivesModule from './IncentivesModule'
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('IncentivesModule', () => {
  it('renders dashboard view', () => {
    wrap(<IncentivesModule />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders weeklyReport view', () => {
    wrap(<IncentivesModule view="weeklyReport" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it.todo('renders config view — monolith import chain fails in jsdom')
})
