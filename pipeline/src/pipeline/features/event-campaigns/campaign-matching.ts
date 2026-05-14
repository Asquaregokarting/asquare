/**
 * Helpers for filtering ledger entries / billing transactions / vendor
 * invoices by EventCampaign membership. Used by AccountingModule to surface
 * "Summer Vibes only" / "Exclude events" / per-campaign breakdown views
 * without changing the underlying data model.
 *
 * Event-package bookings persist as plain billing transactions — there is
 * NO direct `campaignId` field on `billingTransactions` or its `items[]`.
 * The relationship is implicit: each `item.itemName` matches one of the
 * `name` strings configured on `EventCampaign.packages[].items[]`. This
 * mirrors `findEventMatcher` / `eventTokenise` in
 * `functions/lib/vendor-ledger-sync.js` which the server uses to credit
 * vendors for event-package items.
 *
 * For backward compatibility we also accept a tagged `gameId` of shape
 * `event-{campaignId}-pkg-{packageId}` — used by some early POS writers —
 * but the primary path is the token-name lookup.
 */
import { useEffect, useMemo, useState } from 'react'
import type { TransactionRecord, VendorLedgerEntry } from '../../api/types'
import type { EventCampaignRecord } from './event-campaign-types'

const EVENT_PKG_PATTERN = /^event-(.+?)-pkg-/

/** Returns the campaignId encoded in a string, or undefined if not an event-package id. */
export const extractCampaignIdFromString = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined
  const match = EVENT_PKG_PATTERN.exec(raw)
  return match?.[1]
}

/**
 * Mirror of `eventTokenise` in vendor-ledger-sync.js. Lowercases the input
 * and splits on non-alphanumeric runs so that "Cricket 3 overs" tokenises
 * to {cricket, 3, overs}. Empty tokens are dropped.
 */
const eventTokenise = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)

/**
 * Resolver that maps an item name → campaignId, built once per render
 * cycle from the active EventCampaign list. Internally precomputes a
 * `(campaignId, gameTokens[])` index and matches an itemName by checking
 * that every gameToken appears in the itemName's tokens — same algorithm
 * the server uses to credit vendors for event-package items.
 */
export interface CampaignResolver {
  fromItemName(itemName: string | undefined): string | undefined
  fromTxn(txn: TransactionRecord): string | undefined
  fromLedgerEntry(
    entry: VendorLedgerEntry,
    txnMap: Map<string, TransactionRecord>,
  ): string | undefined
}

interface CampaignMatcher {
  campaignId: string
  packageId: string
  gameTokens: string[]
  /** Campaign window for the temporal gate on token-fallback matches. */
  startDate: string | undefined
  endDate: string | undefined
}

/**
 * Build a CampaignResolver from the active EventCampaign list. Heavy
 * indexing happens once; per-item lookups are O(matchers × tokens).
 * Equivalent to `loadEventPackageMatchers` in vendor-ledger-sync.js.
 */
export const buildCampaignResolver = (campaigns: EventCampaignRecord[]): CampaignResolver => {
  const matchers: CampaignMatcher[] = []
  const campaignWindows = new Map<string, { startDate?: string; endDate?: string }>()
  for (const c of campaigns) {
    campaignWindows.set(c.id, { startDate: c.startDate, endDate: c.endDate })
    for (const pkg of c.packages ?? []) {
      for (const it of pkg.items ?? []) {
        const tokens = eventTokenise(typeof it.name === 'string' ? it.name : '')
        if (tokens.length === 0) continue
        matchers.push({
          campaignId: c.id,
          packageId: pkg.id,
          gameTokens: tokens,
          startDate: c.startDate,
          endDate: c.endDate,
        })
      }
    }
  }

  const fromItemName = (itemName: string | undefined): string | undefined => {
    if (!itemName) return undefined
    const itemTokens = new Set(eventTokenise(itemName))
    if (itemTokens.size === 0) return undefined
    for (const m of matchers) {
      let ok = true
      for (const t of m.gameTokens) {
        if (!itemTokens.has(t)) {
          ok = false
          break
        }
      }
      if (ok) return m.campaignId
    }
    return undefined
  }

  const fromTxn = (txn: TransactionRecord): string | undefined => {
    // 1. Tagged gameId path (some early POS writers).
    const fromGameId = extractCampaignIdFromString(txn.gameId)
    if (fromGameId) return fromGameId

    const items = (txn as unknown as { items?: Array<Record<string, unknown>> }).items
    if (!Array.isArray(items)) return undefined

    // 2. Structured-ID path. Modern event-package bookings store the
    //    canonical id `evt-event-{campaignId}-pkg-{packageId}-{itemId}`
    //    on `items[i].activity.id` (and historically also on
    //    `items[i].id` for some early POS writers). This is the
    //    high-confidence path — when present it's unambiguous and
    //    immune to name-collision false positives.
    for (const it of items) {
      const itemId = typeof it.id === 'string' ? it.id : undefined
      const activity = it.activity as { id?: unknown; apiId?: unknown } | undefined
      const activityId = typeof activity?.id === 'string' ? activity.id : undefined
      const activityApiId = typeof activity?.apiId === 'string' ? activity.apiId : undefined
      const cid =
        extractCampaignIdFromString(itemId) ??
        extractCampaignIdFromString(activityId) ??
        extractCampaignIdFromString(activityApiId)
      if (cid) return cid
    }

    // 3. Token-fallback path. Used only for legacy bookings that lack
    //    structured event-package ids on their items. Single-token
    //    campaign-item names ("VR", "Zipline") would otherwise match
    //    every regular-catalog booking that happens to mention the
    //    same word. Defense: require the booking's transactionDate to
    //    fall inside the matched campaign's [startDate, endDate].
    //    Pre-campaign and post-campaign POS sales can't structurally
    //    be campaign bookings.
    const txnDate =
      typeof (txn as unknown as { transactionDate?: unknown }).transactionDate === 'string'
        ? String((txn as unknown as { transactionDate: string }).transactionDate).slice(0, 10)
        : ''
    for (const it of items) {
      const itemName = typeof it.itemName === 'string' ? it.itemName : undefined
      const matched = fromItemName(itemName)
      if (!matched) continue
      const window = campaignWindows.get(matched)
      if (window?.startDate && txnDate && txnDate < window.startDate) continue
      if (window?.endDate && txnDate && txnDate > window.endDate) continue
      return matched
    }
    return undefined
  }

  const fromLedgerEntry = (
    entry: VendorLedgerEntry,
    txnMap: Map<string, TransactionRecord>,
  ): string | undefined => {
    if (!entry.referenceId) return undefined
    const txn = txnMap.get(entry.referenceId)
    if (!txn) return undefined
    return fromTxn(txn)
  }

  return { fromItemName, fromTxn, fromLedgerEntry }
}

/**
 * Returns the campaignId of a billing transaction, or undefined if it
 * isn't an event-package booking.
 *
 * If `campaigns` is supplied, item-name token matching is used. Without
 * it, only the legacy tagged-gameId path is checked — most modern
 * bookings will return undefined, so prefer the campaigns-aware overload.
 */
export const extractCampaignIdFromTxn = (
  txn: TransactionRecord,
  campaigns?: EventCampaignRecord[],
): string | undefined => {
  if (campaigns && campaigns.length > 0) {
    return buildCampaignResolver(campaigns).fromTxn(txn)
  }
  // Legacy / test-only fallback: tagged gameId path only.
  const fromGameId = extractCampaignIdFromString(txn.gameId)
  if (fromGameId) return fromGameId
  const items = (txn as unknown as { items?: Array<Record<string, unknown>> }).items
  if (Array.isArray(items)) {
    for (const it of items) {
      const id = typeof it.id === 'string' ? it.id : undefined
      const cid = extractCampaignIdFromString(id)
      if (cid) return cid
    }
  }
  return undefined
}

/**
 * Returns the campaignId for a ledger entry by looking up its
 * `referenceId` in a pre-built txn map. Returns undefined if the
 * underlying booking is missing or isn't an event-package.
 */
export const extractCampaignIdFromLedgerEntry = (
  entry: VendorLedgerEntry,
  txnMap: Map<string, TransactionRecord>,
  campaigns?: EventCampaignRecord[],
): string | undefined => {
  if (!entry.referenceId) return undefined
  const txn = txnMap.get(entry.referenceId)
  if (!txn) return undefined
  return extractCampaignIdFromTxn(txn, campaigns)
}

/** Memoized resolver hook so consumers don't rebuild matchers on every render. */
export const useCampaignResolver = (campaigns: EventCampaignRecord[]): CampaignResolver =>
  useMemo(() => buildCampaignResolver(campaigns), [campaigns])

/**
 * Filter type used by the Campaign filter dropdown on
 * Ledger / Invoices / Settlements tabs.
 *
 *   { kind: 'all' }       — show everything (default)
 *   { kind: 'campaign', campaignId } — only entries whose campaignId === id
 *   { kind: 'exclude_events' } — only non-event-package entries
 */
export type CampaignFilter =
  | { kind: 'all' }
  | { kind: 'campaign'; campaignId: string }
  | { kind: 'exclude_events' }

/** True if the record's campaignId (or absence thereof) matches the active filter. */
export const matchesCampaignFilter = (
  campaignId: string | undefined,
  filter: CampaignFilter,
): boolean => {
  switch (filter.kind) {
    case 'all':
      return true
    case 'campaign':
      return campaignId === filter.campaignId
    case 'exclude_events':
      return campaignId === undefined
  }
}

/**
 * Loads all EventCampaigns once. Shared between Ledger / Invoices /
 * Settlements tabs so each one renders the same dropdown options.
 */
export const useEventCampaigns = (): EventCampaignRecord[] => {
  const [campaigns, setCampaigns] = useState<EventCampaignRecord[]>([])
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const { listEventCampaigns } = await import('./event-campaigns-firestore')
        const all = await listEventCampaigns()
        if (!cancelled) setCampaigns(all)
      } catch {
        /* non-fatal — dropdown just stays empty */
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])
  return campaigns
}
