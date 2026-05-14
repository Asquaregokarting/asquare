import { describe, expect, it } from 'vitest'
import type { AsquareBooking } from '../../api/asquare-bookings'
import { buildBookingExportRows, type VendorMetaEntry } from './aggregate'

const vendorMeta: VendorMetaEntry[] = [
  { id: 'v-acme', name: 'ACME', vendorType: 'ThirdParty', revenueShare: 80 },
  { id: 'v-beta', name: 'BetaCo', vendorType: 'ThirdParty', revenueShare: 70 },
  { id: 'v-sub', name: 'SubLeaseCo', vendorType: 'SubLease', revenueShare: 90 },
]

const makeBooking = (
  overrides: Partial<AsquareBooking> & Record<string, unknown>,
): AsquareBooking =>
  ({
    id: 'BK-1',
    userId: 'u-1',
    locationId: 'visakhapatnam',
    items: [],
    totalAmount: 0,
    discountAmount: 0,
    finalAmount: 0,
    paymentStatus: 'completed',
    bookingStatus: 'confirmed',
    qrCode: '',
    createdAt: new Date('2026-05-01T08:00:00Z'),
    sessionDate: new Date('2026-05-02T08:00:00Z'),
    tires: 0,
    ...overrides,
  }) as AsquareBooking

describe('buildBookingExportRows', () => {
  it('aggregates per-booking from billingItems (happy path)', () => {
    const booking = makeBooking({
      id: 'BK-A',
      finalAmount: 1000,
      billingItems: [
        {
          itemName: 'Go-Karting Adult',
          quantity: 1,
          vendorId: 'v-acme',
          vendorBase: 400,
          vendorGst: 72,
          vendorTotal: 472,
          companyBase: 100,
          companyGst: 18,
          vendorSharePercent: 80,
        },
      ],
    })
    const result = buildBookingExportRows([booking], vendorMeta)
    expect(result.bookingRows).toHaveLength(1)
    const row = result.bookingRows[0]
    expect(row.bookingId).toBe('BK-A')
    expect(row.companyShare).toBe(100)
    expect(row.companyGst).toBe(18)
    expect(row.vendorAmounts['v-acme']).toBe(472)
    expect(result.vendorColumns).toHaveLength(1)
    expect(result.vendorColumns[0].vendorName).toBe('ACME')
    expect(result.vendorLineItems).toHaveLength(1)
    expect(result.vendorLineItems[0].vendorBase).toBe(400)
    expect(result.vendorLineItems[0].vendorGst).toBe(72)
    expect(result.subleaseColumns).toHaveLength(0)
    expect(result.subleaseLineItems).toHaveLength(0)
  })

  it('falls back to items[].vendorId + computeRevenueSplit when billingItems missing', () => {
    const booking = makeBooking({
      id: 'BK-B',
      finalAmount: 1180,
      items: [
        {
          quantity: 1,
          duration: 0,
          date: '2026-05-01',
          timeSlot: '10:00',
          price: 1180,
          unitPrice: 1180,
          vendorId: 'v-acme',
          activity: { name: 'Go-Karting' } as never,
        },
      ],
    })
    const result = buildBookingExportRows([booking], vendorMeta)
    const row = result.bookingRows[0]
    expect(row.vendorAmounts['v-acme']).toBeGreaterThan(0)
    expect(row.companyShare).toBeGreaterThan(0)
    expect(row.companyGst).toBeGreaterThan(0)
    expect(row.companyShare + row.companyGst + row.vendorAmounts['v-acme']).toBe(1180)
    expect(result.vendorLineItems).toHaveLength(1)
    expect(result.vendorLineItems[0].vendorName).toBe('ACME')
  })

  it('preserves SubLease GST = 0 invariant from billingItems', () => {
    const booking = makeBooking({
      id: 'BK-C',
      finalAmount: 1180,
      billingItems: [
        {
          itemName: 'Sublease Game',
          quantity: 1,
          vendorId: 'v-sub',
          vendorBase: 900,
          vendorGst: 0,
          vendorTotal: 900,
          companyBase: 100,
          companyGst: 180,
          vendorSharePercent: 90,
        },
      ],
    })
    const result = buildBookingExportRows([booking], vendorMeta)
    expect(result.subleaseColumns).toHaveLength(1)
    expect(result.subleaseColumns[0].vendorName).toBe('SubLeaseCo')
    expect(result.vendorColumns).toHaveLength(0)
    const lineItem = result.subleaseLineItems[0]
    expect(lineItem.vendorGst).toBe(0)
    expect(lineItem.vendorBase).toBe(900)
    expect(result.bookingRows[0].companyGst).toBe(180)
  })

  it('orders vendor columns by total revenue descending', () => {
    const bookingHigh = makeBooking({
      id: 'BK-D1',
      billingItems: [
        {
          itemName: 'Game A',
          quantity: 1,
          vendorId: 'v-acme',
          vendorBase: 800,
          vendorGst: 144,
          vendorTotal: 944,
          companyBase: 200,
          companyGst: 36,
          vendorSharePercent: 80,
        },
      ],
    })
    const bookingLow = makeBooking({
      id: 'BK-D2',
      billingItems: [
        {
          itemName: 'Game B',
          quantity: 1,
          vendorId: 'v-beta',
          vendorBase: 200,
          vendorGst: 36,
          vendorTotal: 236,
          companyBase: 100,
          companyGst: 18,
          vendorSharePercent: 70,
        },
      ],
    })
    const result = buildBookingExportRows([bookingLow, bookingHigh], vendorMeta)
    expect(result.vendorColumns.map((c) => c.vendorId)).toEqual(['v-acme', 'v-beta'])
  })

  it('handles bookings with no vendor items (in-house only)', () => {
    const booking = makeBooking({
      id: 'BK-E',
      finalAmount: 590,
      items: [
        {
          quantity: 1,
          duration: 0,
          date: '2026-05-01',
          timeSlot: '10:00',
          price: 590,
          unitPrice: 590,
          activity: { name: 'In-house Go-Karting' } as never,
        },
      ],
    })
    const result = buildBookingExportRows([booking], vendorMeta)
    const row = result.bookingRows[0]
    expect(Object.keys(row.vendorAmounts)).toHaveLength(0)
    expect(row.companyShare + row.companyGst).toBe(590)
    expect(result.vendorColumns).toHaveLength(0)
    expect(result.subleaseColumns).toHaveLength(0)
  })

  it('sums multiple billing items for the same vendor into one cell', () => {
    const booking = makeBooking({
      id: 'BK-F',
      billingItems: [
        {
          itemName: 'Game 1',
          quantity: 1,
          vendorId: 'v-acme',
          vendorBase: 400,
          vendorGst: 72,
          vendorTotal: 472,
          companyBase: 100,
          companyGst: 18,
          vendorSharePercent: 80,
        },
        {
          itemName: 'Game 2',
          quantity: 1,
          vendorId: 'v-acme',
          vendorBase: 200,
          vendorGst: 36,
          vendorTotal: 236,
          companyBase: 50,
          companyGst: 9,
          vendorSharePercent: 80,
        },
      ],
    })
    const result = buildBookingExportRows([booking], vendorMeta)
    expect(result.bookingRows[0].vendorAmounts['v-acme']).toBe(472 + 236)
    expect(result.vendorLineItems).toHaveLength(1)
    expect(result.vendorLineItems[0].vendorBase).toBe(600)
    expect(result.vendorLineItems[0].vendorGst).toBe(108)
  })

  it('labels unknown vendors and buckets them as ThirdParty', () => {
    const booking = makeBooking({
      id: 'BK-G',
      billingItems: [
        {
          itemName: 'Mystery',
          quantity: 1,
          vendorId: 'v-unknown-xyz',
          vendorBase: 200,
          vendorGst: 36,
          vendorTotal: 236,
          companyBase: 50,
          companyGst: 9,
          vendorSharePercent: 80,
        },
      ],
    })
    const result = buildBookingExportRows([booking], vendorMeta)
    expect(result.vendorColumns).toHaveLength(1)
    expect(result.vendorColumns[0].vendorName).toContain('Unknown')
    expect(result.subleaseColumns).toHaveLength(0)
  })

  it('serial numbers are 1-indexed in input order', () => {
    const a = makeBooking({ id: 'X1' })
    const b = makeBooking({ id: 'X2' })
    const c = makeBooking({ id: 'X3' })
    const result = buildBookingExportRows([a, b, c], vendorMeta)
    expect(result.bookingRows.map((r) => r.serial)).toEqual([1, 2, 3])
    expect(result.bookingRows.map((r) => r.bookingId)).toEqual(['X1', 'X2', 'X3'])
  })
})
