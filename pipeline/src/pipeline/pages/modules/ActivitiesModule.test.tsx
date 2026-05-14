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
vi.mock('./activities/ActivityHierarchyView', () => ({
  default: () => <div data-testid="hierarchy">Hierarchy</div>,
}))
vi.mock('./activities/ComboBuilder', () => ({
  default: () => <div data-testid="combos">Combos</div>,
}))
vi.mock('./activities/VendorGameImportView', () => ({
  default: () => <div data-testid="import">Import</div>,
}))

import ActivitiesModule from './ActivitiesModule'

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('ActivitiesModule', () => {
  it('renders list view', () => {
    wrap(<ActivitiesModule />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders combos view', () => {
    wrap(<ActivitiesModule view="combos" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders bulk-import view', () => {
    wrap(<ActivitiesModule view="bulk-import" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
})
