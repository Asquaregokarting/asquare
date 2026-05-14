import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  collection: vi.fn(),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: () => 'SERVER_TS',
  increment: (n: number) => n,
  runTransaction: vi.fn(),
  Timestamp: { fromDate: (d: Date) => d, now: () => new Date() },
  deleteField: vi.fn(() => 'DELETE_SENTINEL'),
}))
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('./firestore-session', () => ({
  getFirestoreSessionUser: () => ({ uid: 'admin-001', role: 'Admin', location: '0' }),
  isPrivilegedRole: () => true,
}))
vi.mock('../../lib/locations', () => ({
  slugToBranchId: (s: string) => s,
  branchIdToSlug: (id: string) => id,
  branchIdToDisplayName: (id: string) => id,
  getBranchIdToDisplayNameMap: () => ({ '0': 'Vizag', '1': 'Kakinada' }),
}))
vi.mock('./vendor-details-firestore', () => ({
  getVendorBillingConfig: vi.fn(() =>
    Promise.resolve({
      vendorSharePercent: 80,
      billingModel: 'ThirdParty',
    }),
  ),
}))

import {
  computeRevenueSplit,
  GST_PERCENT_DEFAULT,
  VENDOR_SHARE_PERCENT_DEFAULT,
} from './billing-firestore'

describe('billing constants', () => {
  it('GST default is 18%', () => {
    expect(GST_PERCENT_DEFAULT).toBe(18)
  })

  it('vendor share default is 80%', () => {
    expect(VENDOR_SHARE_PERCENT_DEFAULT).toBe(80)
  })
})

describe('computeRevenueSplit', () => {
  it('ThirdParty: vendor gets share of both base + GST', () => {
    const r = computeRevenueSplit(1000, 180, 80, 'ThirdParty')
    expect(r.vendorBase).toBe(800)
    expect(r.vendorGst).toBe(144)
    expect(r.vendorTotal).toBe(944)
    expect(r.companyBase).toBe(200)
    expect(r.companyGst).toBe(36)
    expect(r.companyTotal).toBe(236)
  })

  it('SubLease: vendor gets base share, company keeps all GST', () => {
    const r = computeRevenueSplit(1000, 180, 80, 'SubLease')
    expect(r.vendorBase).toBe(800)
    expect(r.vendorGst).toBe(0)
    expect(r.vendorTotal).toBe(800)
    expect(r.companyBase).toBe(200)
    expect(r.companyGst).toBe(180)
    expect(r.companyTotal).toBe(380)
  })

  it('defaults to ThirdParty when no model specified', () => {
    const r = computeRevenueSplit(1000, 180, 80)
    expect(r.vendorGst).toBe(144)
  })

  it('handles 0% share — company gets everything', () => {
    const r = computeRevenueSplit(1000, 180, 0)
    expect(r.vendorTotal).toBe(0)
    expect(r.companyTotal).toBe(1180)
  })

  it('handles 100% share — vendor gets everything', () => {
    const r = computeRevenueSplit(1000, 180, 100)
    expect(r.vendorTotal).toBe(1180)
    expect(r.companyTotal).toBe(0)
  })

  it('total always sums to base + gst', () => {
    const r = computeRevenueSplit(777, 140, 65, 'ThirdParty')
    expect(r.vendorTotal + r.companyTotal).toBe(777 + 140)
  })

  it('handles zero amounts', () => {
    const r = computeRevenueSplit(0, 0, 80)
    expect(r.vendorTotal).toBe(0)
    expect(r.companyTotal).toBe(0)
  })

  it('handles large amounts', () => {
    const r = computeRevenueSplit(100000, 18000, 75, 'ThirdParty')
    expect(r.vendorBase).toBe(75000)
    expect(r.vendorGst).toBe(13500)
    expect(r.companyBase).toBe(25000)
    expect(r.companyGst).toBe(4500)
  })

  it('SubLease with fractional share rounds correctly', () => {
    const r = computeRevenueSplit(1000, 180, 33, 'SubLease')
    expect(r.vendorBase + r.companyBase).toBe(1000)
    expect(r.vendorGst + r.companyGst).toBe(180)
    expect(r.vendorTotal + r.companyTotal).toBe(1180)
  })
})
