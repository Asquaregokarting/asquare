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
vi.mock('./event-campaigns/EventCampaignListView', () => ({
  default: () => <div data-testid="campaign-list">List</div>,
}))
vi.mock('./event-campaigns/EventCampaignFormView', () => ({
  default: () => <div data-testid="campaign-form">Form</div>,
}))

import EventCampaignsModule from './EventCampaignsModule'
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('EventCampaignsModule', () => {
  it('renders manage view', () => {
    wrap(<EventCampaignsModule />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders create view', () => {
    wrap(<EventCampaignsModule view="create" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
})
