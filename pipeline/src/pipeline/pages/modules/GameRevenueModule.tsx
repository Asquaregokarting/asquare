import { useCallback, useEffect, useMemo, useState } from 'react'

import { BookingScope, listAllBookings } from '../../api/billing-firestore'
import { listBranchActivityCatalog } from '../../api/activity-catalog-firestore'
import { TransactionRecord } from '../../api/types'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { DetailPanel } from '../../components/ui/DetailPanel'
import { SummaryCards } from '../../components/ui/SummaryCards'
import {
  GameRevenueDrillDownModal,
  type GameRevenueDrillDownSpec,
} from '../../components/ui/GameRevenueDrillDownModal'
import { useAuth } from '../../features/auth/auth-context'
import { useLocations } from '../../hooks/useLocations'
import { logger } from '../../../lib/logger'
import { branchIdToDisplayName } from '../../../lib/locations'

import { todayIST, toISTDateStr } from '../../lib/ist-date'
import {
  aggregateGameRevenue,
  buildCatalogLookup,
  SOURCE_BUCKETS,
  SOURCE_BUCKET_LABELS,
  UNKNOWN_BRANCH_ID,
  type CatalogLookup,
  type SourceBucket,
} from '../../features/game-revenue/aggregate'

const currency = (n: number) => `INR ${Math.round(n).toLocaleString('en-IN')}`

const shiftIstDate = (iso: string, days: number): string => {
  // Parse YYYY-MM-DD as a UTC midnight, shift, then re-format. The result is
  // always a calendar-date string, never affected by the host browser TZ.
  const ms = new Date(`${iso}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000
  return toISTDateStr(new Date(ms))
}

const GameRevenueModule = () => {
  const { session } = useAuth()
  const role = session?.user.role
  const isVendor = role === 'ThirdParty'
  const vendorId = isVendor ? session?.user.id : undefined
  const { enabledLocations, lockedLocationId } = useLocations()

  // Narrow the Firestore read to just what the authenticated user is allowed
  // to see. Cashiers / TrackMarshalls get a single-branch query; ThirdParty
  // vendors get a vendorId filter; Owner/Admin/Developer/Backend keep the
  // existing full-collection read.
  const scope = useMemo<BookingScope | undefined>(() => {
    if (!session) return undefined
    if (session.user.role === 'ThirdParty') {
      return { role: 'ThirdParty', vendorId: session.user.id }
    }
    const allowed = session.user.allowedLocations
    const branchId = Array.isArray(allowed) && allowed.length === 1 ? allowed[0] : undefined
    return { role: session.user.role, branchId }
  }, [session])

  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [catalogLookup, setCatalogLookup] = useState<CatalogLookup>(() => new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<SourceBucket | 'all'>('all')
  // Branch filter — single-branch users (e.g. Cashier restricted to one
  // location) are implicitly locked to that branch. Others default to 'all'.
  const [branchFilter, setBranchFilter] = useState<string | 'all'>(() => lockedLocationId ?? 'all')

  // Default to the trailing 7 days so the page shows data on first open even
  // when no sale has happened today yet.
  const todayStr = todayIST()
  const [fromDate, setFromDate] = useState(() => shiftIstDate(todayStr, -6))
  const [toDate, setToDate] = useState(todayStr)

  // Drill-down — game-level (gameId only) or variant-level (full spec).
  const [drillDown, setDrillDown] = useState<GameRevenueDrillDownSpec | null>(null)

  // ThirdParty vendors see a "Your Share" tile next to "Total Revenue" so
  // they can read both the gross billed amount AND their post-split take
  // at a glance. The rate comes from `vendorDetails.revenueShare` and is
  // applied to whatever revenue the page is currently displaying (after
  // source / branch filters). Tile is hidden until the value loads, so an
  // unset / failed lookup never shows a misleading 0.
  const [vendorSharePercent, setVendorSharePercent] = useState<number | null>(null)
  useEffect(() => {
    if (!isVendor || !session?.token) return
    let cancelled = false
    ;(async () => {
      try {
        const { vendorDetailsApi } = await import('../../api/vendor-details')
        const details = await vendorDetailsApi.getMine(session.token)
        if (cancelled) return
        const share = typeof details.revenueShare === 'number' ? details.revenueShare : null
        setVendorSharePercent(share != null ? Math.min(100, Math.max(0, share)) : null)
      } catch (reason) {
        logger.warn('game_revenue.vendor_share_load_failed', { reason })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isVendor, session?.token])

  // ── Catalog ───────────────────────────────────────────────────────────────
  // One-shot load. Catalog rarely changes within a session and we only need
  // it for label resolution, not for filtering.
  useEffect(() => {
    let cancelled = false
    listBranchActivityCatalog()
      .then((rows) => {
        if (cancelled) return
        setCatalogLookup(
          buildCatalogLookup(
            rows.map((row) => ({
              gameId: row.gameId,
              gameName: row.gameName ?? row.category,
              subGameId: row.subGameId,
              subGameName: row.subGameName ?? row.subcategory,
              variantId: row.variantId,
              variantLabel: row.variantLabel,
            })),
          ),
        )
      })
      .catch((reason) => {
        // Catalog failure is non-fatal — the aggregator falls back to raw IDs.
        logger.warn('game_revenue.catalog_load_failed', { reason })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ── Bookings ──────────────────────────────────────────────────────────────
  // Fetch the entire bookings collection — date filtering happens in-memory
  // inside `aggregateGameRevenue`. We deliberately do NOT push a
  // `where('createdAt', '>=', ...)` filter into Firestore: `createdAt` is
  // stored as a Firestore Timestamp on Customer-App writes (`new Date()`)
  // and as an ISO string on POS writes (`nowIso()`), and Firestore inequality
  // filters silently exclude documents whose field type differs from the
  // comparison value — which was dropping every App/Website booking from the
  // report. The aggregator already filters on `transactionDate`, which the
  // mapping layer in `billing-firestore.ts` normalizes from either type into
  // an ISO string, so no booking is lost regardless of how it was written.
  const loadTransactions = useCallback(() => {
    if (!scope) {
      setTransactions([])
      return
    }
    setLoading(true)
    setError(null)
    listAllBookings({ scope })
      .then(setTransactions)
      .catch((reason) => {
        logger.error('game_revenue.load_failed', reason, { vendorId })
        setTransactions([])
        setError(reason instanceof Error ? reason.message : 'Failed to load game revenue.')
      })
      .finally(() => setLoading(false))
  }, [scope, vendorId])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  // ── Aggregation ───────────────────────────────────────────────────────────
  const aggregation = useMemo(
    () =>
      aggregateGameRevenue(transactions, {
        fromDate,
        toDate,
        toIstDate: (iso: string) => toISTDateStr(new Date(iso)),
        vendorId,
        catalog: catalogLookup,
      }),
    [transactions, fromDate, toDate, vendorId, catalogLookup],
  )

  // Source and branch filters are mutually exclusive — the aggregator only
  // stores 1D projections, so combining both would produce misleading
  // numbers. Selecting one resets the other.
  const handleSourceFilterChange = useCallback((next: SourceBucket | 'all') => {
    setSourceFilter(next)
    if (next !== 'all') setBranchFilter('all')
  }, [])
  const handleBranchFilterChange = useCallback((next: string | 'all') => {
    setBranchFilter(next)
    if (next !== 'all') setSourceFilter('all')
  }, [])

  const filteredGames = useMemo(() => {
    const sourceActive = sourceFilter !== 'all'
    const branchActive = branchFilter !== 'all'
    if (!sourceActive && !branchActive) return aggregation.games

    const hasContribution = (bucket: (typeof aggregation.games)[number]['totals']) => {
      if (sourceActive) return (bucket.bySource[sourceFilter] ?? 0) > 0
      return (bucket.byBranch[branchFilter] ?? 0) > 0
    }

    return aggregation.games
      .map((game) => ({
        ...game,
        subgames: game.subgames
          .map((sg) => ({
            ...sg,
            variants: sg.variants.filter((v) => hasContribution(v.totals)),
          }))
          .filter((sg) => sg.variants.length > 0),
      }))
      .filter((game) => game.subgames.length > 0)
  }, [aggregation.games, sourceFilter, branchFilter])

  const bucketRevenue = useCallback(
    (bucket: (typeof aggregation.games)[number]['totals']) => {
      if (sourceFilter !== 'all') return bucket.bySource[sourceFilter] ?? 0
      if (branchFilter !== 'all') return bucket.byBranch[branchFilter] ?? 0
      return bucket.revenue
    },
    [sourceFilter, branchFilter],
  )

  const displayedRevenue = bucketRevenue(aggregation.totals)

  const totalGames = filteredGames.length
  const totalSubgames = filteredGames.reduce((s, g) => s + g.subgames.length, 0)
  const totalQuantity = filteredGames.reduce((s, g) => s + g.totals.quantity, 0)

  const branchLabel = (branchId: string) =>
    branchId === UNKNOWN_BRANCH_ID ? 'Unknown' : branchIdToDisplayName(branchId)
  const branchOptions = useMemo(() => {
    const fromData = aggregation.branchIds
    const fromRegistry = enabledLocations.map((l) => l.branchId)
    return Array.from(new Set([...fromRegistry, ...fromData]))
  }, [aggregation.branchIds, enabledLocations])
  const showBranchPicker = !isVendor && !lockedLocationId && branchOptions.length > 1
  const showBranchBreakdown = !isVendor && aggregation.branchIds.length > 1

  const subtitle = isVendor
    ? 'Your revenue breakdown by game and variant.'
    : 'Business-wide revenue by game, variant, and booking source.'

  return (
    <ModulePageLayout
      moduleTab="GameRevenue"
      title="Game-wise Revenue"
      subtitle={subtitle}
      breadcrumbs={['Pipeline', 'Game Revenue']}
    >
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <button
          className="ui-btn ui-btn-accent text-sm"
          onClick={() => {
            setFromDate(todayStr)
            setToDate(todayStr)
          }}
        >
          Today
        </button>
        <button
          className="ui-btn ui-btn-neutral text-sm"
          onClick={() => {
            setFromDate(shiftIstDate(todayStr, -6))
            setToDate(todayStr)
          }}
        >
          Last 7 days
        </button>
        <button
          className="ui-btn ui-btn-neutral text-sm"
          onClick={() => {
            setFromDate(shiftIstDate(todayStr, -29))
            setToDate(todayStr)
          }}
        >
          Last 30 days
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">From</span>
          <input
            type="date"
            className="ui-field min-h-9"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">To</span>
          <input
            type="date"
            className="ui-field min-h-9"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
          />
        </div>
        {showBranchPicker ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Branch</span>
            <select
              className="ui-field min-h-9"
              value={branchFilter}
              onChange={(e) => handleBranchFilterChange(e.target.value)}
              aria-label="Branch filter"
            >
              <option value="all">All branches</option>
              {branchOptions.map((bid) => (
                <option key={bid} value={bid}>
                  {branchLabel(bid)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button
          type="button"
          className="ui-btn ui-btn-neutral text-sm ml-auto"
          onClick={loadTransactions}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </div>
      ) : null}

      <SummaryCards
        items={[
          {
            id: 'total-revenue',
            label:
              sourceFilter !== 'all'
                ? `${SOURCE_BUCKET_LABELS[sourceFilter]} Revenue`
                : branchFilter !== 'all'
                  ? `${branchLabel(branchFilter)} Revenue`
                  : 'Total Revenue',
            value: currency(displayedRevenue),
            tone: 'success',
          },
          // ThirdParty vendors see their post-split take alongside the
          // gross. The gross above is the customer-facing billed amount on
          // items linked to this vendor; the share is `gross × stored
          // revenueShare%`. Tile is hidden until the rate loads — an unset
          // / failed lookup never renders a misleading 0.
          ...(isVendor && vendorSharePercent !== null
            ? ([
                {
                  id: 'vendor-share',
                  label: `Your Share (${vendorSharePercent}%)`,
                  value: currency(Math.round((displayedRevenue * vendorSharePercent) / 100)),
                  tone: 'success',
                },
              ] as const)
            : []),
          {
            id: 'total-bookings',
            label: 'Bookings',
            value: String(aggregation.contributingTransactions),
            tone: 'info',
          },
          { id: 'total-games', label: 'Games', value: String(totalGames), tone: 'info' },
          {
            id: 'total-qty',
            label: 'Units Sold',
            value: String(totalQuantity),
            tone: 'muted',
          },
        ]}
      />

      {/* Source breakdown — only for non-vendor users (vendor view is single-source). */}
      {!isVendor ? (
        <div className="mt-4 rounded-2xl border border-border bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.09em] text-muted">
              Revenue by Source
            </p>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => handleSourceFilterChange('all')}
                className={`ui-btn min-h-7 px-2 text-[11px] ${
                  sourceFilter === 'all' ? 'ui-btn-info' : 'ui-btn-neutral'
                }`}
              >
                All
              </button>
              {SOURCE_BUCKETS.map((bucket) => {
                const value = aggregation.totals.bySource[bucket]
                if (value <= 0 && sourceFilter !== bucket) return null
                return (
                  <button
                    key={bucket}
                    type="button"
                    onClick={() => handleSourceFilterChange(bucket)}
                    className={`ui-btn min-h-7 px-2 text-[11px] ${
                      sourceFilter === bucket ? 'ui-btn-info' : 'ui-btn-neutral'
                    }`}
                  >
                    {SOURCE_BUCKET_LABELS[bucket]}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {SOURCE_BUCKETS.map((bucket) => {
              const value = aggregation.totals.bySource[bucket]
              const pct =
                aggregation.totals.revenue > 0
                  ? Math.round((value / aggregation.totals.revenue) * 100)
                  : 0
              return (
                <div key={bucket} className="rounded-lg border border-border bg-surface px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-muted">
                    {SOURCE_BUCKET_LABELS[bucket]}
                  </p>
                  <p className="mt-1 font-display text-lg font-semibold leading-none text-text">
                    {currency(value)}
                  </p>
                  <p className="mt-1 text-[10px] text-muted">{pct}% of total</p>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {showBranchBreakdown ? (
        <div className="mt-4 rounded-2xl border border-border bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.09em] text-muted">
              Revenue by Branch
            </p>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => handleBranchFilterChange('all')}
                className={`ui-btn min-h-7 px-2 text-[11px] ${
                  branchFilter === 'all' ? 'ui-btn-info' : 'ui-btn-neutral'
                }`}
              >
                All
              </button>
              {aggregation.branchIds.map((bid) => (
                <button
                  key={bid}
                  type="button"
                  onClick={() => handleBranchFilterChange(bid)}
                  className={`ui-btn min-h-7 px-2 text-[11px] ${
                    branchFilter === bid ? 'ui-btn-info' : 'ui-btn-neutral'
                  }`}
                >
                  {branchLabel(bid)}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {aggregation.branchIds.map((bid) => {
              const value = aggregation.totals.byBranch[bid] ?? 0
              const pct =
                aggregation.totals.revenue > 0
                  ? Math.round((value / aggregation.totals.revenue) * 100)
                  : 0
              return (
                <div key={bid} className="rounded-lg border border-border bg-surface px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-muted">
                    {branchLabel(bid)}
                  </p>
                  <p className="mt-1 font-display text-lg font-semibold leading-none text-text">
                    {currency(value)}
                  </p>
                  <p className="mt-1 text-[10px] text-muted">{pct}% of total</p>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {loading && transactions.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Loading…</p>
      ) : filteredGames.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {transactions.length === 0
            ? isVendor
              ? 'No completed transactions are linked to your vendor account yet.'
              : 'No completed bookings in the loaded window.'
            : sourceFilter !== 'all'
              ? `No ${SOURCE_BUCKET_LABELS[sourceFilter]} revenue between ${fromDate} and ${toDate}.`
              : branchFilter !== 'all'
                ? `No ${branchLabel(branchFilter)} revenue between ${fromDate} and ${toDate}.`
                : `No game revenue between ${fromDate} and ${toDate}. Try widening the date range.`}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {filteredGames.map((game) => {
            const gameRevenue = bucketRevenue(game.totals)
            const branchScope = branchFilter !== 'all' ? branchFilter : undefined
            return (
              <DetailPanel key={game.gameId} title={game.gameName}>
                <button
                  type="button"
                  onClick={() =>
                    setDrillDown({
                      gameId: game.gameId,
                      gameName: game.gameName,
                      locationId: branchScope,
                      locationName: branchScope ? branchLabel(branchScope) : undefined,
                    })
                  }
                  className="mb-3 flex w-full flex-wrap items-center gap-4 rounded-lg border border-transparent px-2 py-1 text-left text-sm transition hover:border-info/40 hover:bg-info/5"
                  title="Click to view every booking that contributed to this game"
                >
                  <span className="text-muted">
                    Units: <strong className="text-text">{game.totals.quantity}</strong>
                  </span>
                  <span className="text-muted">
                    Bookings: <strong className="text-text">{game.totals.txnCount}</strong>
                  </span>
                  <span className="text-muted">
                    Total: <strong className="text-success">{currency(gameRevenue)}</strong>
                  </span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-info">
                    View bookings →
                  </span>
                </button>
                {game.subgames.map((subgame) => {
                  const sgRevenue = bucketRevenue(subgame.totals)
                  return (
                    <div key={subgame.subGameId} className="mb-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-info">
                          {subgame.subGameName}
                        </p>
                        <p className="text-xs text-muted">
                          {currency(sgRevenue)} · {subgame.totals.quantity} units
                        </p>
                      </div>
                      <div className="space-y-2">
                        {subgame.variants.map((v) => {
                          const vRevenue = bucketRevenue(v.totals)
                          const sharePct =
                            gameRevenue > 0 ? Math.round((vRevenue / gameRevenue) * 100) : 0
                          return (
                            <button
                              key={v.variantId}
                              type="button"
                              onClick={() =>
                                setDrillDown({
                                  gameId: game.gameId,
                                  gameName: game.gameName,
                                  subGameId: subgame.subGameId,
                                  subGameName: subgame.subGameName,
                                  variantId: v.variantId,
                                  variantName: v.variantName,
                                  locationId: branchScope,
                                  locationName: branchScope ? branchLabel(branchScope) : undefined,
                                })
                              }
                              className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left transition hover:border-info/40 hover:bg-info/5"
                              title={`Click to view every booking for ${v.variantName}`}
                            >
                              <span
                                className="flex-1 truncate text-sm text-text"
                                title={v.variantName}
                              >
                                {v.variantName}
                              </span>
                              <span className="whitespace-nowrap rounded bg-info/15 px-1.5 py-0.5 text-xs font-bold text-info">
                                x{v.totals.quantity}
                              </span>
                              <span className="whitespace-nowrap text-sm font-bold text-text">
                                {currency(vRevenue)}
                              </span>
                              <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-border">
                                <div
                                  className="h-full rounded-full bg-accent"
                                  style={{ width: `${sharePct}%` }}
                                />
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </DetailPanel>
            )
          })}
        </div>
      )}

      {/* Skipped-transactions diagnostic — visible only when something was filtered out, helps debugging "where did my data go?". */}
      {!loading && aggregation.skippedTransactions > 0 ? (
        <p className="mt-3 text-[11px] text-muted">
          {aggregation.skippedTransactions} loaded{' '}
          {aggregation.skippedTransactions === 1 ? 'booking was' : 'bookings were'} skipped (pending
          payment, cancelled, refunded, vendor-mismatch, or outside the date range).
          {totalSubgames > 0 ? ` ${totalSubgames} subgames are visible above.` : ''}
        </p>
      ) : null}

      {drillDown ? (
        <GameRevenueDrillDownModal
          spec={drillDown}
          transactions={transactions}
          vendorId={vendorId}
          fromDate={fromDate}
          toDate={toDate}
          onClose={() => setDrillDown(null)}
        />
      ) : null}
    </ModulePageLayout>
  )
}

export default GameRevenueModule
