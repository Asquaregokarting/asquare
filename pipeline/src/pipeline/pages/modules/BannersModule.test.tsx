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
vi.mock('./banners/SlideListView', () => ({
  default: () => <div data-testid="slide-list">SlideList</div>,
}))
vi.mock('./banners/SlideEditorView', () => ({
  default: () => <div data-testid="slide-editor">SlideEditor</div>,
}))

import BannersModule from './BannersModule'
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('BannersModule', () => {
  it('renders list view', () => {
    wrap(<BannersModule />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders edit view', () => {
    wrap(<BannersModule view="edit" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
})
