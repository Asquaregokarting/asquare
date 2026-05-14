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
  })),
}))
vi.mock('../../api/workspaces', () => ({
  workspacesApi: { listWorkspaces: vi.fn(() => Promise.resolve([])) },
}))
vi.mock('../../api/contacts', () => ({
  contactsApi: { listContacts: vi.fn(() => Promise.resolve([])) },
}))
vi.mock('../../components/ui/DataTable', () => ({ DataTable: () => null }))
vi.mock('../../components/ui/FilterBar', () => ({
  FilterBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FilterField: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('../../../lib/date-format', () => ({
  fmtDateTimeFullIST: vi.fn(() => ''),
  fmtDateIST: vi.fn(() => ''),
}))
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import WorkspacesModule from './WorkspacesModule'
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('WorkspacesModule', () => {
  it('renders list view', () => {
    wrap(<WorkspacesModule />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders recycleBin view', () => {
    wrap(<WorkspacesModule view="recycleBin" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders contacts view', () => {
    wrap(<WorkspacesModule view="contacts" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
})
