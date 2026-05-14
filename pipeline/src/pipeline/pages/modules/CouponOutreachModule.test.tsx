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
vi.mock('./coupon-outreach/CouponOutreachInboxView', () => ({
  default: () => <div data-testid="inbox">Inbox</div>,
}))
vi.mock('./coupon-outreach/CouponOutreachBatchView', () => ({
  default: () => <div data-testid="batch">Batch</div>,
}))
vi.mock('./coupon-outreach/CouponOutreachHistoryView', () => ({
  default: () => <div data-testid="history">History</div>,
}))

import CouponOutreachModule from './CouponOutreachModule'
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('CouponOutreachModule', () => {
  it('renders inbox view', () => {
    wrap(<CouponOutreachModule />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders batch view', () => {
    wrap(<CouponOutreachModule view="batch" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders history view', () => {
    wrap(<CouponOutreachModule view="history" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
})
