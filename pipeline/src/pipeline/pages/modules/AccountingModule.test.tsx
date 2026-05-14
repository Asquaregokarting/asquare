import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
vi.mock('../../api/billing', () => ({
  billingApi: { listTransactions: vi.fn(() => Promise.resolve([])) },
}))
vi.mock('../../api/vendor-details', () => ({
  vendorDetailsApi: { listVendors: vi.fn(() => Promise.resolve([])) },
}))
vi.mock('../../lib/generate-letterhead-pdf', () => ({
  generateLetterheadPdf: vi.fn(async () => ({
    output: vi.fn(() => 'blob:mock-preview'),
    save: vi.fn(),
  })),
}))

const mockAccountingApi = vi.hoisted(() => ({
  finalizePayoutForLocation: vi.fn(() => Promise.resolve()),
  markPeriodLetterheadDownloaded: vi.fn(() => Promise.resolve()),
  updateChequeForLocation: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../api/accounting', () => ({
  accountingApi: {
    getVendorLedger: vi.fn(() => Promise.resolve([])),
    getInvoices: vi.fn(() => Promise.resolve([])),
    getSettlements: vi.fn(() => Promise.resolve([])),
    ...mockAccountingApi,
  },
}))
vi.mock('../../components/ui/DataTable', () => ({ DataTable: () => null }))
vi.mock('../../components/ui/FilterBar', () => ({
  FilterBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FilterField: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../components/ui/KpiCard', () => ({ KpiCard: () => null }))
vi.mock('../../components/ui/SummaryCards', () => ({ SummaryCards: () => null }))
vi.mock('../../../lib/date-format', () => ({
  fmtDateTimeFullIST: vi.fn(() => ''),
  fmtDateIST: vi.fn(() => ''),
  todayIST: vi.fn(() => '2026-04-13'),
}))
vi.mock('../../../lib/locations', () => ({
  getLocationShortName: vi.fn((s: string) => s),
  getLocationDisplayName: vi.fn((s: string) => s),
  getBranchIdToDisplayNameMap: () => ({ '0': 'Vizag' }),
  slugToBranchId: vi.fn((s: string) => s),
  getAllLocations: vi.fn(() => []),
}))
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import AccountingModule, { ChequeLetterheadModal } from './AccountingModule'
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('AccountingModule', () => {
  it('renders ledger view', () => {
    wrap(<AccountingModule />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders invoices view', () => {
    wrap(<AccountingModule view="invoices" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders settlements view', () => {
    wrap(<AccountingModule view="settlements" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders reports view', () => {
    wrap(<AccountingModule view="reports" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
})

const baseProps = {
  open: true,
  onClose: vi.fn(),
  periodStart: '2026-04-13',
  periodEnd: '2026-04-19',
  locationFilter: 'visakhapatnam',
  session: { user: { id: 'u1', name: 'Owner' } },
  onFinalized: vi.fn(),
  mode: 'pending' as const,
  initialChequeNumber: '',
}

const vendorInvoices = [
  {
    id: 'inv-a',
    vendorId: 'vend-a',
    vendorName: 'Alpha Contact',
    vendorCompanyName: 'Alpha Pvt Ltd',
    periodStart: '2026-04-13',
    periodEnd: '2026-04-19',
    totalAmount: 5000,
    status: 'pending',
  },
  {
    id: 'inv-b',
    vendorId: 'vend-b',
    vendorName: 'Beta Contact',
    vendorCompanyName: 'Beta Co',
    periodStart: '2026-04-13',
    periodEnd: '2026-04-19',
    totalAmount: 3000,
    status: 'pending',
  },
  {
    id: 'inv-mpg',
    vendorId: 'vend-mpg',
    vendorName: 'MPG Contact',
    vendorCompanyName: 'MPG Printing',
    periodStart: '2026-04-13',
    periodEnd: '2026-04-19',
    totalAmount: 999,
    status: 'pending',
  },
] as never

const vendorDetailsList = [
  {
    userId: 'vend-a',
    vendorName: 'Alpha',
    particular: 'Alpha Pvt Ltd',
    mobileNumber: '',
    bankAccountNumber: '111',
    bankName: 'HDFC',
    branch: 'Vizag',
    ifscCode: 'HDFC0001',
  },
  {
    userId: 'vend-b',
    vendorName: 'Beta',
    particular: 'Beta Co',
    mobileNumber: '',
    bankAccountNumber: '222',
    bankName: 'ICICI',
    branch: 'Vizag',
    ifscCode: 'ICIC0001',
  },
  {
    userId: 'vend-mpg',
    vendorName: 'MPG Contact',
    particular: 'MPG Printing',
    mobileNumber: '',
    bankAccountNumber: '999',
    bankName: 'SBI',
    branch: 'Vizag',
    ifscCode: 'SBIN0001',
  },
] as never

describe('ChequeLetterheadModal', () => {
  it('filters MPG vendors out of the preview regardless of checkbox state', async () => {
    const { generateLetterheadPdf } = await import('../../lib/generate-letterhead-pdf')
    render(
      <ChequeLetterheadModal
        {...baseProps}
        vendorInvoices={vendorInvoices}
        vendorDetailsList={vendorDetailsList}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Enter cheque number'), {
      target: { value: 'CHQ-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Generate Preview/i }))
    await screen.findByTitle('Letterhead Preview')

    const lastCall = vi.mocked(generateLetterheadPdf).mock.calls.at(-1)
    expect(lastCall?.[0].vendors).toHaveLength(2)
    expect(lastCall?.[0].vendors.map((v: { vendorName: string }) => v.vendorName)).not.toContain(
      'MPG Printing',
    )
    expect(lastCall?.[0].grandTotal).toBe(8000)
  })

  it('initial render leaves all non-MPG vendors selected', () => {
    render(
      <ChequeLetterheadModal
        {...baseProps}
        vendorInvoices={vendorInvoices}
        vendorDetailsList={vendorDetailsList}
      />,
    )
    expect(screen.getByText(/2 of 2 selected/i)).toBeInTheDocument()
  })

  it('unchecking a vendor drops it from the preview config and total', async () => {
    const { generateLetterheadPdf } = await import('../../lib/generate-letterhead-pdf')
    vi.mocked(generateLetterheadPdf).mockClear()
    render(
      <ChequeLetterheadModal
        {...baseProps}
        vendorInvoices={vendorInvoices}
        vendorDetailsList={vendorDetailsList}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Enter cheque number'), {
      target: { value: 'CHQ-2' },
    })
    const alphaCheckbox = screen.getByLabelText(/Include Alpha Pvt Ltd/i) as HTMLInputElement
    expect(alphaCheckbox.checked).toBe(true)
    fireEvent.click(alphaCheckbox)
    expect(alphaCheckbox.checked).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /Generate Preview/i }))
    await screen.findByTitle('Letterhead Preview')

    const lastCall = vi.mocked(generateLetterheadPdf).mock.calls.at(-1)
    expect(lastCall?.[0].vendors).toHaveLength(1)
    expect(lastCall?.[0].vendors[0].vendorName).toBe('Beta Co')
    expect(lastCall?.[0].vendors[0].sNo).toBe(1)
    expect(lastCall?.[0].grandTotal).toBe(3000)
  })

  it('Select all clears hidden vendors; Clear all hides them all', () => {
    render(
      <ChequeLetterheadModal
        {...baseProps}
        vendorInvoices={vendorInvoices}
        vendorDetailsList={vendorDetailsList}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Clear all/i }))
    expect(screen.getByText(/0 of 2 selected/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Select all/i }))
    expect(screen.getByText(/2 of 2 selected/i)).toBeInTheDocument()
  })
})
