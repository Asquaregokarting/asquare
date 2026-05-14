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
  getBranchIdToDisplayNameMap: () => ({ '0': 'Vizag', '1': 'Kakinada' }),
}))
vi.mock('../../../lib/date-format', () => ({
  fmtDateTimeFullIST: vi.fn(() => ''),
  fmtDateIST: vi.fn(() => ''),
}))
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../api/admin', () => ({ adminApi: autoMockApi() }))
vi.mock('../../api/asquare-customers', () => ({
  asquareCustomersApi: autoMockApi(),
  lookupCustomerByPhone: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('../../api/asquare-members', () => ({
  listMembersPage: vi.fn(() => Promise.resolve({ members: [], nextCursor: null })),
  lookupMemberByPhone: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('../../api/asquare-locations', () => ({ asquareLocationsApi: autoMockApi() }))
vi.mock('../../api/asquare-notifications', () => ({ asquareNotificationsApi: autoMockApi() }))
vi.mock('../../api/telecaller-performance', () => ({
  telecallerPerformanceApi: autoMockApi({ getCurrentMonthKey: vi.fn(() => '2026-04') }),
}))
vi.mock('../../api/vendor-details', () => ({ vendorDetailsApi: autoMockApi() }))
vi.mock('../../api/vendor-registration', () => ({ vendorRegistrationApi: autoMockApi() }))
vi.mock('../../api/users', () => ({ usersApi: autoMockApi() }))
vi.mock('../../features/toast/toast-context', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}))
vi.mock('../../components/ui/DataTable', () => ({ DataTable: () => null }))
vi.mock('../../components/ui/DetailPanel', () => ({
  DetailPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../components/ui/FilterBar', () => ({
  FilterBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FilterField: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('../../components/ui/StatusBadge', () => ({
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import AdminModule from './AdminModule'
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('AdminModule', () => {
  it('renders users view', () => {
    wrap(<AdminModule view="users" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders audit view', () => {
    wrap(<AdminModule view="audit" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders roles view', () => {
    wrap(<AdminModule view="roles" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders vendors view', () => {
    wrap(<AdminModule view="vendors" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders customers view', () => {
    wrap(<AdminModule view="customers" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders notifications view', () => {
    wrap(<AdminModule view="notifications" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders members view', () => {
    wrap(<AdminModule view="members" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
})
