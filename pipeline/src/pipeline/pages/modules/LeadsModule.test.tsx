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
vi.mock('../../api/firestore-session', () => ({ isPrivilegedRole: vi.fn(() => true) }))
vi.mock('./leads/LeadPipelineView', () => ({
  default: () => <div data-testid="pipeline-view">Pipeline</div>,
}))
vi.mock('./leads/LeadInboxView', () => ({
  default: () => <div data-testid="inbox-view">Inbox</div>,
}))
vi.mock('./leads/LeadMetricsView', () => ({
  default: () => <div data-testid="metrics-view">Metrics</div>,
}))
vi.mock('./leads/LeadImportView', () => ({
  default: () => <div data-testid="import-view">Import</div>,
}))
vi.mock('./leads/LeadConfigView', () => ({
  default: () => <div data-testid="config-view">Config</div>,
}))
vi.mock('./leads/InteraktDashboard', () => ({
  default: () => <div data-testid="interakt-view">Interakt</div>,
}))
vi.mock('./leads/feedback-calls/FeedbackCallsInboxView', () => ({
  default: () => <div data-testid="feedback-view">Feedback</div>,
}))
vi.mock('./leads/feedback-calls/FeedbackMetricsView', () => ({
  default: () => <div data-testid="feedback-metrics">FeedbackMetrics</div>,
}))
vi.mock('./leads/LeadPerformanceView', () => ({
  default: () => <div data-testid="performance-view">Performance</div>,
}))

import LeadsModule from './LeadsModule'

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('LeadsModule', () => {
  it('renders pipeline view', () => {
    wrap(<LeadsModule view="pipeline" />)
    expect(screen.getByTestId('pipeline-view')).toBeInTheDocument()
  })
  it('renders inbox view', () => {
    wrap(<LeadsModule view="inbox" />)
    expect(screen.getByTestId('inbox-view')).toBeInTheDocument()
  })
  it('renders metrics view', () => {
    wrap(<LeadsModule view="metrics" />)
    expect(screen.getByTestId('metrics-view')).toBeInTheDocument()
  })
  it('renders import view', () => {
    wrap(<LeadsModule view="import" />)
    expect(screen.getByTestId('import-view')).toBeInTheDocument()
  })
  it('renders config view', () => {
    wrap(<LeadsModule view="config" />)
    expect(screen.getByTestId('config-view')).toBeInTheDocument()
  })
  it('renders interakt view', () => {
    wrap(<LeadsModule view="interakt" />)
    expect(screen.getByTestId('interakt-view')).toBeInTheDocument()
  })
  it('renders feedback calls view', () => {
    wrap(<LeadsModule view="feedbackcalls" />)
    expect(screen.getByTestId('feedback-view')).toBeInTheDocument()
  })
  it('renders performance view', () => {
    wrap(<LeadsModule view="performance" />)
    expect(screen.getByTestId('performance-view')).toBeInTheDocument()
  })
  it('sets correct title', () => {
    wrap(<LeadsModule view="pipeline" />)
    expect(screen.getByTestId('module-layout').getAttribute('data-title')).toBe('Lead Pipeline')
  })
})
