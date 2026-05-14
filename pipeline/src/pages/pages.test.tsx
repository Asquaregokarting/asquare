import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock SEO component (used by most pages)
vi.mock('../components/SEO', () => ({ default: () => null }))

// Mock lucide-react icons
vi.mock(
  'lucide-react',
  () =>
    new Proxy({} as Record<string, unknown>, {
      get: (_target, prop) => {
        if (prop === '__esModule') return true
        return (props: Record<string, unknown>) => (
          <svg data-testid={`icon-${String(prop)}`} {...props} />
        )
      },
    }),
)

// Mock LeadCaptureForm for lead pages
vi.mock('../components/LeadCaptureForm', () => ({
  default: ({ sourceRef }: { sourceRef: string }) => (
    <div data-testid="lead-capture-form" data-source={sourceRef} />
  ),
}))

vi.mock('../lib/firebase', () => ({ db: {}, auth: {} }))
vi.mock('../lib/locations', () => ({
  getAllLocations: () => [],
  getLocationBySlug: () => null,
  resolveLocation: () => null,
  branchIdToSlug: (id: string) => id,
  slugToBranchId: (s: string) => s,
}))

// Static imports for pages that don't have deep transitive deps
import LinksPage from './LinksPage'
import LeadCaptureBirthday from './LeadCaptureBirthday'
import LeadCaptureCorporate from './LeadCaptureCorporate'
import LeadCaptureSchool from './LeadCaptureSchool'

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

// ── Static / Legal Pages ───────────────────────────────────────────
// These pages use motion.* heavily and have deep transitive imports
// that cause timeouts in jsdom. They render correctly in E2E tests.

describe('PrivacyPolicy', () => {
  it.todo('renders privacy policy — covered by E2E (deep imports timeout in jsdom)')
})

describe('TermsAndConditions', () => {
  it.todo('renders terms — covered by E2E (deep imports timeout in jsdom)')
})

describe('ReturnRefundPolicy', () => {
  it.todo('renders refund policy — covered by E2E (deep imports timeout in jsdom)')
})

describe('PrivacySecurity', () => {
  it.todo('renders privacy security — covered by E2E (deep imports timeout in jsdom)')
})

describe('LinksPage', () => {
  it('renders social links', () => {
    wrap(<LinksPage />)
    expect(screen.getByText(/Instagram/i)).toBeInTheDocument()
    expect(screen.getByText(/Facebook/i)).toBeInTheDocument()
  })
})

// ── Lead Capture Pages ─────────────────────────────────────────────

describe('LeadCaptureBirthday', () => {
  it('renders birthday party form', () => {
    wrap(<LeadCaptureBirthday />)
    expect(screen.getByText(/Birthday Party/i)).toBeInTheDocument()
    expect(screen.getByTestId('lead-capture-form')).toHaveAttribute('data-source', 'birthday')
  })
})

describe('LeadCaptureCorporate', () => {
  it('renders corporate event form', () => {
    wrap(<LeadCaptureCorporate />)
    expect(screen.getByText(/Corporate/i)).toBeInTheDocument()
    expect(screen.getByTestId('lead-capture-form')).toHaveAttribute('data-source', 'corporate')
  })
})

describe('LeadCaptureSchool', () => {
  it('renders school group form', () => {
    wrap(<LeadCaptureSchool />)
    expect(screen.getByText(/School/i)).toBeInTheDocument()
    expect(screen.getByTestId('lead-capture-form')).toHaveAttribute('data-source', 'school')
  })
})

// ── Complex Pages (need deep service integration) ──────────────────

describe('MyBookings page', () => {
  it.todo('renders bookings list — needs deeper service integration')
})

describe('Wallet page', () => {
  it.todo('renders wallet UI — needs deeper walletService integration')
})

describe('Profile page', () => {
  it.todo('renders profile sections — needs deeper auth integration')
})

describe('Activities page', () => {
  it.todo('renders activity grid — needs deeper activityService integration')
})

describe('PlayAndWin page', () => {
  it.todo('renders gamification dashboard — needs deeper games integration')
})

describe('Cart page', () => {
  it.todo('renders cart items — needs deeper cart integration')
})

describe('Checkout page', () => {
  it.todo('renders checkout form — needs Razorpay mock')
})
