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
vi.mock('../../api/files', () => ({ filesApi: { listFiles: vi.fn(() => Promise.resolve([])) } }))
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import FilesModule from './FilesModule'
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('FilesModule', () => {
  it('renders library view', () => {
    wrap(<FilesModule />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders uploads view', () => {
    wrap(<FilesModule view="uploads" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
})
