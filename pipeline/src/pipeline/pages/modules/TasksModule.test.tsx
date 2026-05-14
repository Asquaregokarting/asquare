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
vi.mock('../../api/tasks', () => ({
  tasksApi: {
    listTasks: vi.fn(() => Promise.resolve([])),
    getUnreadCount: vi.fn(() => Promise.resolve(0)),
  },
}))
vi.mock('../../components/ui/DataTable', () => ({ DataTable: () => null }))
vi.mock('../../components/ui/FilterBar', () => ({
  FilterBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FilterField: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('../../components/ui/StatusBadge', () => ({
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock('../../../lib/date-format', () => ({
  fmtDateTimeFullIST: vi.fn(() => ''),
  fmtDateIST: vi.fn(() => ''),
}))
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import TasksModule from './TasksModule'
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('TasksModule', () => {
  it('renders my tasks view', () => {
    wrap(<TasksModule />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders board view', () => {
    wrap(<TasksModule view="board" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders overdue view', () => {
    wrap(<TasksModule view="overdue" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders todos view', () => {
    wrap(<TasksModule view="todos" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
})
