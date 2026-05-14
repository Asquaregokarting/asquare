import { describe, it, expect } from 'vitest'
import {
  aggregateGameRevenue,
  bucketSource,
  buildCatalogLookup,
  computeItemRevenues,
  isEligibleTransaction,
  type CatalogLookup,
} from './aggregate'
import type { TransactionRecord } from '../../api/types'

// ─── Test fixtures ────────────────────────────────────────────────────────
// Mirror the IST date helper used in production but keep it pure: take an ISO
// string and return its IST calendar date `YYYY-MM-DD`. Tests pin a fake
// implementation so date math is deterministic.
const fakeToIstDate = (iso: string): string => {
  // Add IST offset (+5h30m) and slice
  const ms = new Date(iso).getTime() + 5.5 * 60 * 60 * 1000
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const baseTxn = (overrides: Partial<TransactionRecord>): TransactionRecord =>
  ({
    id: 'tx_1',
    invoiceNumber: 'ASG001',
    totalAmount: 1000,
    paymentMethod: 'UPI',
    refundStatus: 'None',
    transactionDate: '2026-04-08T10:00:00.000Z',
    paymentStatus: 'completed',
    cancelled: false,
    source: 'POS',
    items: [],
    ...overrides,
  }) as TransactionRecord

// ─── bucketSource ──────────────────────────────────────────────────────────

describe('bucketSource', () => {
  it('maps POS to pos', () => {
    expect(bucketSource('POS')).toBe('pos')
  })

  it('maps APP_BOOKING to app', () => {
    expect(bucketSource('APP_BOOKING')).toBe('app')
  })

  it('maps Booking and Website to website', () => {
    expect(bucketSource('Booking')).toBe('website')
    expect(bucketSource('Website')).toBe('website')
  })

  it('maps ADMIN_BOOKING with Telecaller role to telecaller', () => {
    expect(bucketSource('ADMIN_BOOKING', 'Telecaller')).toBe('telecaller')
    expect(bucketSource('ADMIN_BOOKING', 'telecaller')).toBe('telecaller')
  })

  it('maps ADMIN_BOOKING with any other role to admin', () => {
    expect(bucketSource('ADMIN_BOOKING', 'Owner')).toBe('admin')
    expect(bucketSource('ADMIN_BOOKING', 'Admin')).toBe('admin')
    expect(bucketSource('ADMIN_BOOKING')).toBe('admin')
  })

  it('falls back to other for unknown sources and missing values', () => {
    expect(bucketSource(undefined)).toBe('other')
    expect(bucketSource('')).toBe('other')
    expect(bucketSource('SOMETHING_ELSE')).toBe('other')
  })
})

// ─── isEligibleTransaction ─────────────────────────────────────────────────

describe('isEligibleTransaction', () => {
  it('accepts a completed booking that is not cancelled or refunded', () => {
    expect(isEligibleTransaction(baseTxn({}))).toBe(true)
  })

  it('rejects a pending booking', () => {
    expect(isEligibleTransaction(baseTxn({ paymentStatus: 'pending' }))).toBe(false)
  })

  it('rejects a failed payment', () => {
    expect(isEligibleTransaction(baseTxn({ paymentStatus: 'failed' }))).toBe(false)
  })

  it('rejects a cancelled booking even if completed', () => {
    expect(isEligibleTransaction(baseTxn({ cancelled: true }))).toBe(false)
  })

  it('rejects a fully refunded booking', () => {
    expect(isEligibleTransaction(baseTxn({ refundStatus: 'Full' }))).toBe(false)
  })

  it('accepts a partially refunded booking — partial refunds keep the rest', () => {
    expect(isEligibleTransaction(baseTxn({ refundStatus: 'Partial' }))).toBe(true)
  })
})

// ─── computeItemRevenues ───────────────────────────────────────────────────

describe('computeItemRevenues', () => {
  it('uses item-level base+gst when available', () => {
    const txn = baseTxn({
      totalAmount: 1180,
      items: [
        { itemName: 'A', quantity: 1, unitPrice: 1000, itemBaseAmount: 500, itemGstAmount: 90 },
        { itemName: 'B', quantity: 1, unitPrice: 1000, itemBaseAmount: 500, itemGstAmount: 90 },
      ],
    })
    expect(computeItemRevenues(txn)).toEqual([590, 590])
  })

  it('zeroes out refunded items but keeps the rest at item-level breakdown', () => {
    const txn = baseTxn({
      items: [
        { itemName: 'A', quantity: 1, unitPrice: 1000, itemBaseAmount: 500, itemGstAmount: 90 },
        {
          itemName: 'B',
          quantity: 1,
          unitPrice: 1000,
          itemBaseAmount: 500,
          itemGstAmount: 90,
          refunded: true,
        },
      ],
    })
    expect(computeItemRevenues(txn)).toEqual([590, 0])
  })

  it('proportionally splits the booking finalAmount when items lack item-level fields', () => {
    // Subtotals 750 and 250 → 75% / 25% → 600 / 200 of the post-discount 800
    const txn = baseTxn({
      totalAmount: 800,
      items: [
        { itemName: 'A', quantity: 1, unitPrice: 750 },
        { itemName: 'B', quantity: 1, unitPrice: 250 },
      ],
    })
    const result = computeItemRevenues(txn)
    expect(result[0]).toBeCloseTo(600, 1)
    expect(result[1]).toBeCloseTo(200, 1)
  })

  it('falls back to unitPrice × quantity if there is no finalAmount and no breakdown', () => {
    const txn = baseTxn({
      totalAmount: 0,
      items: [
        { itemName: 'A', quantity: 2, unitPrice: 100 },
        { itemName: 'B', quantity: 1, unitPrice: 50 },
      ],
    })
    expect(computeItemRevenues(txn)).toEqual([200, 50])
  })

  it('returns empty array for booking with no items', () => {
    expect(computeItemRevenues(baseTxn({ items: [] }))).toEqual([])
  })
})

// ─── aggregateGameRevenue ──────────────────────────────────────────────────

const goKartCatalog: CatalogLookup = buildCatalogLookup([
  {
    gameId: 'gokarting',
    gameName: 'Go-Karting',
    subGameId: 'sg_kart',
    subGameName: 'Standard Kart',
    variantId: 'v_8laps',
    variantLabel: '8 Laps',
  },
  {
    gameId: 'gokarting',
    gameName: 'Go-Karting',
    subGameId: 'sg_kart',
    subGameName: 'Standard Kart',
    variantId: 'v_12laps',
    variantLabel: '12 Laps',
  },
  {
    gameId: 'bowling',
    gameName: 'Bowling',
    subGameId: 'sg_bowling',
    subGameName: 'Lane',
    variantId: 'v_1game',
    variantLabel: '1 Game',
  },
])

describe('aggregateGameRevenue', () => {
  const baseOptions = {
    fromDate: '2026-04-01',
    toDate: '2026-04-30',
    toIstDate: fakeToIstDate,
  }

  it('returns empty result for an empty input', () => {
    const r = aggregateGameRevenue([], { ...baseOptions, catalog: goKartCatalog })
    expect(r.games).toEqual([])
    expect(r.totals.revenue).toBe(0)
    expect(r.totals.txnCount).toBe(0)
    expect(r.contributingTransactions).toBe(0)
    expect(r.skippedTransactions).toBe(0)
  })

  it('aggregates a single POS booking by game/subgame/variant', () => {
    const txn = baseTxn({
      id: 'tx_pos1',
      source: 'POS',
      totalAmount: 1180,
      items: [
        {
          itemName: '8 Laps',
          quantity: 2,
          unitPrice: 590,
          gameId: 'gokarting',
          subGameId: 'sg_kart',
          variantId: 'v_8laps',
          itemBaseAmount: 1000,
          itemGstAmount: 180,
        },
      ],
    })
    const r = aggregateGameRevenue([txn], { ...baseOptions, catalog: goKartCatalog })

    expect(r.games).toHaveLength(1)
    expect(r.games[0].gameName).toBe('Go-Karting')
    expect(r.games[0].subgames).toHaveLength(1)
    expect(r.games[0].subgames[0].subGameName).toBe('Standard Kart')
    expect(r.games[0].subgames[0].variants).toHaveLength(1)
    expect(r.games[0].subgames[0].variants[0].variantName).toBe('8 Laps')
    expect(r.games[0].subgames[0].variants[0].totals.revenue).toBe(1180)
    expect(r.games[0].subgames[0].variants[0].totals.quantity).toBe(2)
    expect(r.games[0].subgames[0].variants[0].totals.bySource.pos).toBe(1180)
    expect(r.totals.txnCount).toBe(1)
  })

  it('splits revenue across two source buckets', () => {
    const posTxn = baseTxn({
      id: 'tx_pos1',
      source: 'POS',
      totalAmount: 1180,
      items: [
        {
          itemName: '8 Laps',
          quantity: 2,
          unitPrice: 590,
          gameId: 'gokarting',
          subGameId: 'sg_kart',
          variantId: 'v_8laps',
          itemBaseAmount: 1000,
          itemGstAmount: 180,
        },
      ],
    })
    const appTxn = baseTxn({
      id: 'tx_app1',
      source: 'APP_BOOKING',
      totalAmount: 590,
      items: [
        {
          itemName: '8 Laps',
          quantity: 1,
          unitPrice: 590,
          gameId: 'gokarting',
          subGameId: 'sg_kart',
          variantId: 'v_8laps',
        },
      ],
    })
    const r = aggregateGameRevenue([posTxn, appTxn], { ...baseOptions, catalog: goKartCatalog })

    const variant = r.games[0].subgames[0].variants[0]
    expect(variant.totals.revenue).toBe(1180 + 590)
    expect(variant.totals.bySource.pos).toBe(1180)
    expect(variant.totals.bySource.app).toBe(590)
    expect(variant.totals.quantity).toBe(3)
    expect(r.totals.txnCount).toBe(2)
  })

  it('skips pending and cancelled bookings', () => {
    const txns = [
      baseTxn({ paymentStatus: 'pending', id: 'a' }),
      baseTxn({ paymentStatus: 'failed', id: 'b' }),
      baseTxn({ cancelled: true, id: 'c' }),
      baseTxn({ refundStatus: 'Full', id: 'd' }),
    ]
    const r = aggregateGameRevenue(txns, baseOptions)
    expect(r.contributingTransactions).toBe(0)
    expect(r.skippedTransactions).toBe(4)
    expect(r.totals.revenue).toBe(0)
  })

  it('skips bookings whose IST date falls outside the range', () => {
    // 2026-04-01T00:00:00Z is 2026-04-01 05:30 IST, so the IST date is 2026-04-01.
    // Range starts on 2026-04-02 → should be skipped.
    const txn = baseTxn({
      id: 'tx_old',
      transactionDate: '2026-04-01T00:00:00.000Z',
      items: [
        {
          itemName: '8 Laps',
          quantity: 1,
          unitPrice: 590,
          gameId: 'gokarting',
          subGameId: 'sg_kart',
          variantId: 'v_8laps',
        },
      ],
    })
    const r = aggregateGameRevenue([txn], {
      fromDate: '2026-04-02',
      toDate: '2026-04-30',
      toIstDate: fakeToIstDate,
    })
    expect(r.contributingTransactions).toBe(0)
    expect(r.skippedTransactions).toBe(1)
  })

  it('keeps bookings made between 00:00–05:30 IST in the IST date, not the UTC date', () => {
    // 2026-04-08T19:30:00Z is 2026-04-09 01:00 IST → IST date is 2026-04-09.
    // The buggy slice(0,10) would have given 2026-04-08, missing the booking
    // when the user filters to 2026-04-09. The new aggregator must keep it.
    const txn = baseTxn({
      id: 'tx_late_night',
      transactionDate: '2026-04-08T19:30:00.000Z',
      totalAmount: 590,
      items: [
        {
          itemName: '8 Laps',
          quantity: 1,
          unitPrice: 590,
          gameId: 'gokarting',
          subGameId: 'sg_kart',
          variantId: 'v_8laps',
        },
      ],
    })
    const r = aggregateGameRevenue([txn], {
      fromDate: '2026-04-09',
      toDate: '2026-04-09',
      toIstDate: fakeToIstDate,
    })
    expect(r.contributingTransactions).toBe(1)
    expect(r.totals.revenue).toBe(590)
  })

  it('zeroes refunded items while still counting the rest of the booking', () => {
    const txn = baseTxn({
      id: 'tx_partial_refund',
      refundStatus: 'Partial',
      items: [
        {
          itemName: '8 Laps',
          quantity: 1,
          unitPrice: 590,
          gameId: 'gokarting',
          subGameId: 'sg_kart',
          variantId: 'v_8laps',
          itemBaseAmount: 500,
          itemGstAmount: 90,
        },
        {
          itemName: '12 Laps',
          quantity: 1,
          unitPrice: 950,
          gameId: 'gokarting',
          subGameId: 'sg_kart',
          variantId: 'v_12laps',
          itemBaseAmount: 805,
          itemGstAmount: 145,
          refunded: true,
        },
      ],
    })
    const r = aggregateGameRevenue([txn], { ...baseOptions, catalog: goKartCatalog })
    expect(r.games[0].subgames[0].variants).toHaveLength(1)
    expect(r.games[0].subgames[0].variants[0].variantName).toBe('8 Laps')
    expect(r.games[0].subgames[0].variants[0].totals.revenue).toBe(590)
    expect(r.totals.revenue).toBe(590)
  })

  it('aggregates multiple items from one booking under the right game/subgame', () => {
    const txn = baseTxn({
      id: 'tx_multi',
      totalAmount: 990,
      items: [
        {
          itemName: '8 Laps',
          quantity: 1,
          unitPrice: 590,
          gameId: 'gokarting',
          subGameId: 'sg_kart',
          variantId: 'v_8laps',
          itemBaseAmount: 500,
          itemGstAmount: 90,
        },
        {
          itemName: '1 Game',
          quantity: 1,
          unitPrice: 400,
          gameId: 'bowling',
          subGameId: 'sg_bowling',
          variantId: 'v_1game',
          itemBaseAmount: 339,
          itemGstAmount: 61,
        },
      ],
    })
    const r = aggregateGameRevenue([txn], { ...baseOptions, catalog: goKartCatalog })

    // Two top-level games, sorted by revenue desc — Go-Karting (590) is first
    expect(r.games).toHaveLength(2)
    expect(r.games[0].gameName).toBe('Go-Karting')
    expect(r.games[0].totals.revenue).toBe(590)
    expect(r.games[1].gameName).toBe('Bowling')
    expect(r.games[1].totals.revenue).toBe(400)
    // The booking only counts once at the grand total even though it touched two games
    expect(r.totals.txnCount).toBe(1)
    expect(r.totals.revenue).toBe(990)
  })

  it('respects vendor scope by skipping items whose vendorId does not match', () => {
    const txn = baseTxn({
      id: 'tx_vendor',
      items: [
        {
          itemName: 'A',
          quantity: 1,
          unitPrice: 500,
          gameId: 'gokarting',
          subGameId: 'sg_kart',
          variantId: 'v_8laps',
          vendorId: 'vendor_xyz',
          itemBaseAmount: 425,
          itemGstAmount: 75,
        },
        {
          itemName: 'B',
          quantity: 1,
          unitPrice: 500,
          gameId: 'bowling',
          subGameId: 'sg_bowling',
          variantId: 'v_1game',
          // company-owned (no vendorId)
          itemBaseAmount: 425,
          itemGstAmount: 75,
        },
      ],
    })
    const r = aggregateGameRevenue([txn], {
      ...baseOptions,
      catalog: goKartCatalog,
      vendorId: 'vendor_xyz',
    })

    expect(r.games).toHaveLength(1)
    expect(r.games[0].gameName).toBe('Go-Karting')
    expect(r.totals.revenue).toBe(500)
  })

  it('uses raw IDs as labels when catalog has no entry', () => {
    const txn = baseTxn({
      id: 'tx_unknown',
      items: [
        {
          itemName: 'Mystery',
          quantity: 1,
          unitPrice: 100,
          gameId: 'unknown_game',
          subGameId: 'unknown_sg',
          variantId: 'unknown_variant',
          itemBaseAmount: 85,
          itemGstAmount: 15,
        },
      ],
    })
    const r = aggregateGameRevenue([txn], baseOptions)
    expect(r.games).toHaveLength(1)
    expect(r.games[0].gameName).toBe('unknown_game')
    expect(r.games[0].subgames[0].variants[0].variantName).toBe('Mystery')
    expect(r.totals.revenue).toBe(100)
  })
})

describe('buildCatalogLookup', () => {
  it('keys entries by game::sub::variant and ignores duplicates', () => {
    const m = buildCatalogLookup([
      {
        gameId: 'gokarting',
        subGameId: 'sg',
        variantId: 'v',
        gameName: 'Go-Karting',
        subGameName: 'Sub',
        variantLabel: 'V',
      },
      {
        gameId: 'gokarting',
        subGameId: 'sg',
        variantId: 'v',
        gameName: 'IGNORED',
        subGameName: 'IGNORED',
        variantLabel: 'IGNORED',
      },
    ])
    expect(m.get('gokarting::sg::v')?.gameName).toBe('Go-Karting')
    expect(m.size).toBe(1)
  })

  it('uses unknown placeholder for missing fields', () => {
    const m = buildCatalogLookup([{ gameName: 'X' }])
    expect(m.get('unknown::unknown::unknown')?.gameName).toBe('X')
  })
})
