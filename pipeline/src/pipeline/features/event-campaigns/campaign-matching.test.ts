import { describe, it, expect } from 'vitest'
import type { TransactionRecord, VendorLedgerEntry } from '../../api/types'
import type { EventCampaignRecord } from './event-campaign-types'
import {
  buildCampaignResolver,
  extractCampaignIdFromString,
  extractCampaignIdFromTxn,
  extractCampaignIdFromLedgerEntry,
  matchesCampaignFilter,
} from './campaign-matching'

// Minimal EventCampaign fixture matching the production shape's required
// fields. Only `id`, `packages[].id`, `packages[].items[].name` are read by
// the matcher — the rest is filler to satisfy the type.
const makeCampaign = (id: string, itemNames: string[]): EventCampaignRecord =>
  ({
    id,
    title: id,
    slug: id,
    description: '',
    heroImageUrl: '',
    locationKeys: [],
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: 'active',
    packages: [
      {
        id: `${id}-pkg-1`,
        title: 'Default',
        items: itemNames.map((name, i) => ({
          id: `${id}-item-${i}`,
          type: 'thirdParty',
          name,
          price: 100,
        })),
      },
    ],
    applicability: { showOnline: true, enableInBooking: true, enableInBilling: true },
    couponPolicy: { allowCouponUsage: false, grantCoupons: false },
    promoText: '',
    endedNotificationMessage: null,
    endedNotificationSentAt: null,
  }) as unknown as EventCampaignRecord

const baseTxn: TransactionRecord = {
  id: 'b1',
  invoiceNumber: 'INV-001',
  totalAmount: 1000,
  paymentMethod: 'Cash',
  refundStatus: 'None',
  transactionDate: '2026-04-20',
  paymentStatus: 'completed',
}

describe('extractCampaignIdFromString', () => {
  it('returns undefined for empty / missing input', () => {
    expect(extractCampaignIdFromString(undefined)).toBeUndefined()
    expect(extractCampaignIdFromString('')).toBeUndefined()
  })

  it('returns undefined for a normal game id', () => {
    expect(extractCampaignIdFromString('go-karting')).toBeUndefined()
    expect(extractCampaignIdFromString('zorbing')).toBeUndefined()
  })

  it('extracts the campaignId from an event-package id', () => {
    expect(extractCampaignIdFromString('event-summer-vibes-pkg-combo2')).toBe('summer-vibes')
    expect(extractCampaignIdFromString('event-evt1-pkg-combo2-free')).toBe('evt1')
  })

  it('handles long campaign ids with hyphens', () => {
    expect(extractCampaignIdFromString('event-summer-vibes-2026-pkg-fun-combo')).toBe(
      'summer-vibes-2026',
    )
  })
})

describe('extractCampaignIdFromTxn', () => {
  it('returns the campaign id when txn.gameId is event-shaped', () => {
    expect(extractCampaignIdFromTxn({ ...baseTxn, gameId: 'event-summer-vibes-pkg-combo2' })).toBe(
      'summer-vibes',
    )
  })

  it('returns undefined for non-event txns', () => {
    expect(extractCampaignIdFromTxn({ ...baseTxn, gameId: 'go-karting' })).toBeUndefined()
    expect(extractCampaignIdFromTxn(baseTxn)).toBeUndefined()
  })

  it('falls back to items[].id when txn.gameId is missing', () => {
    const txnWithItems = {
      ...baseTxn,
      items: [
        { itemName: 'Combo 2', quantity: 1, unitPrice: 999, id: 'event-summer-vibes-pkg-combo2' },
      ],
    } as unknown as TransactionRecord
    expect(extractCampaignIdFromTxn(txnWithItems)).toBe('summer-vibes')
  })
})

describe('extractCampaignIdFromLedgerEntry', () => {
  const ledgerEntry: VendorLedgerEntry = {
    id: 'le-b1-v1',
    vendorId: 'v1',
    amount: 800,
    type: 'credit',
    referenceId: 'b1',
    date: '2026-04-20',
    createdAt: '2026-04-20',
  }

  it('resolves campaignId via the booking lookup', () => {
    const txnMap = new Map<string, TransactionRecord>([
      ['b1', { ...baseTxn, gameId: 'event-summer-vibes-pkg-combo2' }],
    ])
    expect(extractCampaignIdFromLedgerEntry(ledgerEntry, txnMap)).toBe('summer-vibes')
  })

  it('returns undefined when the booking is not in the map (orphan)', () => {
    expect(extractCampaignIdFromLedgerEntry(ledgerEntry, new Map())).toBeUndefined()
  })

  it('returns undefined when the booking is not an event-package', () => {
    const txnMap = new Map<string, TransactionRecord>([
      ['b1', { ...baseTxn, gameId: 'go-karting' }],
    ])
    expect(extractCampaignIdFromLedgerEntry(ledgerEntry, txnMap)).toBeUndefined()
  })

  it('returns undefined when the entry has no referenceId', () => {
    const noRef: VendorLedgerEntry = { ...ledgerEntry, referenceId: '' }
    expect(extractCampaignIdFromLedgerEntry(noRef, new Map())).toBeUndefined()
  })
})

describe('buildCampaignResolver — item-name token matching', () => {
  const summer = makeCampaign('summer-vibes', ['Cricket 3 overs', 'Roller Water Zorbing'])
  const diwali = makeCampaign('diwali-vibes', ['VR Experience', 'Bumper Cars'])
  const resolver = buildCampaignResolver([summer, diwali])

  it('matches an item by exact tokenised name', () => {
    expect(resolver.fromItemName('Cricket 3 overs')).toBe('summer-vibes')
    expect(resolver.fromItemName('VR Experience')).toBe('diwali-vibes')
  })

  it('matches item names regardless of case and punctuation', () => {
    expect(resolver.fromItemName('cricket 3 OVERS')).toBe('summer-vibes')
    expect(resolver.fromItemName('Cricket-3-overs')).toBe('summer-vibes')
    expect(resolver.fromItemName('vr_experience')).toBe('diwali-vibes')
  })

  it('matches when the booking adds extra descriptive words', () => {
    // Server-side eventTokenise is a "all-tokens-present" check, so extra
    // tokens in the itemName don't break the match.
    expect(resolver.fromItemName('Cricket 3 overs (Junior)')).toBe('summer-vibes')
  })

  it('returns undefined for non-event item names', () => {
    expect(resolver.fromItemName('Go-Karting Adult Pass')).toBeUndefined()
    expect(resolver.fromItemName('')).toBeUndefined()
    expect(resolver.fromItemName(undefined)).toBeUndefined()
  })

  it('resolves a transaction by its first matching item.itemName', () => {
    const txn = {
      ...baseTxn,
      items: [
        { itemName: 'Some other item', quantity: 1, unitPrice: 100 },
        { itemName: 'Cricket 3 overs', quantity: 1, unitPrice: 200 },
      ],
    } as unknown as TransactionRecord
    expect(resolver.fromTxn(txn)).toBe('summer-vibes')
  })
})

describe('extractCampaignIdFromTxn with campaigns', () => {
  const summer = makeCampaign('summer-vibes', ['Cricket 3 overs'])
  it('uses the campaigns argument to do token matching', () => {
    const txn = {
      ...baseTxn,
      items: [{ itemName: 'Cricket 3 overs', quantity: 1, unitPrice: 200 }],
    } as unknown as TransactionRecord
    expect(extractCampaignIdFromTxn(txn, [summer])).toBe('summer-vibes')
  })

  it('falls back to legacy gameId path when no campaigns provided', () => {
    expect(extractCampaignIdFromTxn({ ...baseTxn, gameId: 'event-summer-vibes-pkg-combo2' })).toBe(
      'summer-vibes',
    )
  })
})

describe('matchesCampaignFilter', () => {
  it('"all" matches every record regardless of campaignId', () => {
    const f = { kind: 'all' as const }
    expect(matchesCampaignFilter(undefined, f)).toBe(true)
    expect(matchesCampaignFilter('summer-vibes', f)).toBe(true)
    expect(matchesCampaignFilter('diwali-vibes', f)).toBe(true)
  })

  it('"campaign" matches only the specified campaignId', () => {
    const f = { kind: 'campaign' as const, campaignId: 'summer-vibes' }
    expect(matchesCampaignFilter('summer-vibes', f)).toBe(true)
    expect(matchesCampaignFilter('diwali-vibes', f)).toBe(false)
    expect(matchesCampaignFilter(undefined, f)).toBe(false)
  })

  it('"exclude_events" matches only non-event records', () => {
    const f = { kind: 'exclude_events' as const }
    expect(matchesCampaignFilter(undefined, f)).toBe(true)
    expect(matchesCampaignFilter('summer-vibes', f)).toBe(false)
    expect(matchesCampaignFilter('diwali-vibes', f)).toBe(false)
  })
})
