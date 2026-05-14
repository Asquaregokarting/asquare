import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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
vi.mock('../../api/firestore-session', () => ({ isPrivilegedRole: vi.fn(() => true) }))
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('./kartfluencer/KartfluencerListView', () => ({
  default: () => <div data-testid="kf-list">List</div>,
}))
vi.mock('./kartfluencer/KartfluencerPipelineView', () => ({
  default: () => <div data-testid="kf-pipeline">Pipeline</div>,
}))
vi.mock('./kartfluencer/KartfluencerReelsView', () => ({
  default: () => <div data-testid="kf-reels">Reels</div>,
}))
vi.mock('./kartfluencer/KartfluencerNotificationsView', () => ({
  default: () => <div data-testid="kf-notif">Notif</div>,
}))
vi.mock('./kartfluencer/KartfluencerImportView', () => ({
  default: () => <div data-testid="kf-import">Import</div>,
}))
vi.mock('./kartfluencer/KartfluencerConfigView', () => ({
  default: () => <div data-testid="kf-config">Config</div>,
}))
vi.mock('./kartfluencer/KartfluencerScannerView', () => ({
  default: () => <div data-testid="kf-scanner">Scanner</div>,
}))
vi.mock('./kartfluencer/KartfluencerWithdrawalsView', () => ({
  default: () => <div data-testid="kf-withdrawals">Withdrawals</div>,
}))
vi.mock('./kartfluencer/KartfluencerAnalyticsView', () => ({
  default: () => <div data-testid="kf-analytics">Analytics</div>,
}))
vi.mock('./kartfluencer/KartfluencerProfileView', () => ({
  default: () => <div data-testid="kf-profile">Profile</div>,
}))

import KartfluencerModule from './KartfluencerModule'
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('KartfluencerModule', () => {
  it('renders list view', () => {
    wrap(<KartfluencerModule view="list" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders pipeline view', () => {
    wrap(<KartfluencerModule view="pipeline" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders reels view', () => {
    wrap(<KartfluencerModule view="reels" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders config view', () => {
    wrap(<KartfluencerModule view="config" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders withdrawals view', () => {
    wrap(<KartfluencerModule view="withdrawals" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders analytics view', () => {
    wrap(<KartfluencerModule view="analytics" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
})
