import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { ModulePageLayout } from '../../../components/layout/ModulePageLayout'
import { useAuth } from '../../../features/auth/auth-context'
import {
  type CatalogOption,
  type EventPackageOption,
  type OrphanBooking,
  type RefundCorrection,
  type VendorOption,
  type VendorSuggestionIndex,
  fetchBookingAsOrphan,
  listCatalogOptions,
  listEventPackageOptions,
  listOrphanBookings,
  listRefundCorrections,
  listVendorOptions,
  listVendorSuggestions,
} from '../../../api/reconciliation-firestore'

const RefundReviewModal = lazy(() => import('./RefundReviewModal'))
import { logger } from '../../../../lib/logger'

const OrphanResolverModal = lazy(() => import('./OrphanResolverModal'))
const AuditTab = lazy(() => import('./AuditTab'))
const LedgerDriftTab = lazy(() => import('./LedgerDriftTab'))
const MirrorBillingModal = lazy(() => import('./MirrorBillingModal'))

const currency = (n: number) => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

export type ReconciliationView = 'orphans'

const ReconciliationModule = () => {
  const { session } = useAuth()
  const role = session?.user.role
  const isAuthorised = role === 'Owner' || role === 'Admin'

  const [orphans, setOrphans] = useState<OrphanBooking[]>([])
  const [refundCorrections, setRefundCorrections] = useState<RefundCorrection[]>([])
  const [catalog, setCatalog] = useState<CatalogOption[]>([])
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [packages, setPackages] = useState<EventPackageOption[]>([])
  const [vendorSuggestions, setVendorSuggestions] = useState<VendorSuggestionIndex>(new Map())
  const [loading, setLoading] = useState(false)
  const [refundLoading, setRefundLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<OrphanBooking | null>(null)
  const [activeRefundBookingId, setActiveRefundBookingId] = useState<string | null>(null)
  const [tab, setTab] = useState<'orphans' | 'refunds' | 'audit' | 'drift'>('orphans')
  /** When the orphan list was last refreshed (epoch ms). null = never. */
  const [orphansCheckedAt, setOrphansCheckedAt] = useState<number | null>(null)
  /** Persisted opt-in: when true, refresh orphans every 60s while on tab. */
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => {
    try {
      return localStorage.getItem('reconciliation.orphans.autoRefresh') === '1'
    } catch {
      return false
    }
  })
  /** Tick once a second so "X seconds ago" stays live without re-fetch. */
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  // Bumped after OrphanResolverModal applies a re-attribution opened from
  // the Audit tab. AuditTab listens for changes to re-run the current
  // audit so the row's classification updates.
  const [auditRefreshNonce, setAuditRefreshNonce] = useState(0)
  // Tracks whether the currently-open OrphanResolverModal was opened via
  // Audit's "Re-attribute" (vs. an Orphans-tab "Resolve"). Only the audit
  // path should bump the audit nonce on resolved.
  const [activeFromAudit, setActiveFromAudit] = useState(false)
  const [showMirrorModal, setShowMirrorModal] = useState(false)
  // "Open booking by ID" input — lets admin re-attribute any booking
  // (orphan or not) by pasting its ID. Resolver scoped to that booking.
  const [openByIdInput, setOpenByIdInput] = useState('')
  const [openByIdBusy, setOpenByIdBusy] = useState(false)
  const [openByIdError, setOpenByIdError] = useState<string | null>(null)
  const handleOpenById = useCallback(async () => {
    const id = openByIdInput.trim()
    if (!id) {
      setOpenByIdError('Paste a booking ID first.')
      return
    }
    setOpenByIdBusy(true)
    setOpenByIdError(null)
    try {
      const b = await fetchBookingAsOrphan(id)
      setActiveFromAudit(false)
      setActive(b)
      setOpenByIdInput('')
    } catch (err) {
      setOpenByIdError(
        err instanceof Error ? err.message : 'Booking not found or could not be loaded.',
      )
    } finally {
      setOpenByIdBusy(false)
    }
  }, [openByIdInput])

  // Load static reference data (catalog / vendors / packages) once on
  // mount. None of these change often, and rebuilding the catalog walk
  // takes the longest of any call on this page. The Refresh button below
  // only refetches the dynamic orphan list — much faster.
  const loadStatic = useCallback(async () => {
    if (!isAuthorised) return
    setError(null)
    try {
      const [c, v, p, s] = await Promise.all([
        listCatalogOptions(),
        listVendorOptions(),
        listEventPackageOptions(),
        listVendorSuggestions(),
      ])
      setCatalog(c)
      setVendors(v)
      setPackages(p)
      setVendorSuggestions(s)
    } catch (err) {
      logger.error('reconciliation.static_load_failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load reference data.')
    }
  }, [isAuthorised])

  const refreshOrphans = useCallback(async () => {
    if (!isAuthorised) return
    setLoading(true)
    setError(null)
    try {
      const o = await listOrphanBookings()
      setOrphans(o)
      setOrphansCheckedAt(Date.now())
    } catch (err) {
      logger.error('reconciliation.orphans_load_failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load orphans.')
    } finally {
      setLoading(false)
    }
  }, [isAuthorised])

  const refreshRefunds = useCallback(async () => {
    if (!isAuthorised) return
    setRefundLoading(true)
    setError(null)
    try {
      const r = await listRefundCorrections()
      setRefundCorrections(r)
    } catch (err) {
      logger.error('reconciliation.refunds_load_failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load refund corrections.')
    } finally {
      setRefundLoading(false)
    }
  }, [isAuthorised])

  /**
   * Drop a correction from the local state once the modal has applied it.
   * Avoids a full re-fetch (slow with 100+ corrections) and keeps the
   * table fresh as the admin works through bookings.
   */
  const handleRefundApplied = useCallback((bookingId: string, vendorId: string) => {
    setRefundCorrections((prev) =>
      prev.filter((r) => !(r.bookingId === bookingId && r.vendorId === vendorId)),
    )
  }, [])

  /**
   * Replace this booking's pending corrections with the freshly-computed
   * set after the admin edited refund flags inside the modal. Old rows
   * for the booking get dropped, new rows take their place.
   */
  const handleCorrectionsRecomputed = useCallback((bookingId: string, next: RefundCorrection[]) => {
    setRefundCorrections((prev) => [...prev.filter((r) => r.bookingId !== bookingId), ...next])
  }, [])

  // Used by the modal's onResolved callback so existing call sites work.
  const refresh = refreshOrphans

  // Auto-refresh orphans every 60s when the user opted in AND they're
  // looking at the Orphans tab (no point hammering the DB while they're
  // on Audit / Refunds). Persisted to localStorage so the choice sticks
  // across sessions.
  useEffect(() => {
    if (!autoRefresh || tab !== 'orphans') return
    const id = window.setInterval(() => {
      void refreshOrphans()
    }, 60_000)
    return () => window.clearInterval(id)
  }, [autoRefresh, tab, refreshOrphans])

  const toggleAutoRefresh = useCallback((next: boolean) => {
    setAutoRefresh(next)
    try {
      localStorage.setItem('reconciliation.orphans.autoRefresh', next ? '1' : '0')
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }, [])

  /**
   * Format ms → "just now" / "Xs ago" / "Xm ago" / "Xh ago" so the
   * "last checked" pill stays compact. Uses `tick` indirectly: this is
   * called inside render, and tick changes once a second, so the pill
   * stays current without re-fetching.
   */
  const formatRelative = (then: number | null): string => {
    if (then === null) return 'never'
    const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000))
    if (diffSec < 5) return 'just now'
    if (diffSec < 60) return `${diffSec}s ago`
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
    return `${Math.floor(diffSec / 3600)}h ago`
  }
  // Touch `tick` so the linter doesn't drop the useEffect's purpose.
  void tick

  useEffect(() => {
    void loadStatic()
    void refreshOrphans()
    void refreshRefunds()
  }, [loadStatic, refreshOrphans, refreshRefunds])

  if (!isAuthorised) {
    return (
      <ModulePageLayout
        moduleTab="Reconciliation"
        title="Reconciliation"
        subtitle="Owner / Admin only."
        breadcrumbs={['Pipeline', 'Reconciliation']}
      >
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted">
          This view is restricted to Owner / Admin users.
        </p>
      </ModulePageLayout>
    )
  }

  const totalLeak = orphans.reduce((s, o) => s + o.finalAmount, 0)

  // Group refund corrections by bookingId so each row in the Refund
  // Corrections tab represents one booking with its full set of pending
  // per-vendor corrections. The review modal opens against this group.
  const refundsByBooking = (() => {
    const map = new Map<
      string,
      {
        bookingId: string
        bookingDate: string
        branchId: string
        invoiceNumber: string
        rows: RefundCorrection[]
        netDelta: number
        absTotal: number
      }
    >()
    for (const r of refundCorrections) {
      const acc = map.get(r.bookingId) ?? {
        bookingId: r.bookingId,
        bookingDate: r.bookingDate,
        branchId: r.locationId,
        invoiceNumber: r.invoiceNumber,
        rows: [],
        netDelta: 0,
        absTotal: 0,
      }
      acc.rows.push(r)
      acc.netDelta += r.delta
      acc.absTotal += Math.abs(r.delta)
      map.set(r.bookingId, acc)
    }
    return [...map.values()].sort((a, b) => b.absTotal - a.absTotal)
  })()

  return (
    <ModulePageLayout
      moduleTab="Reconciliation"
      title="Booking Reconciliation"
      subtitle="Bookings that completed payment but are missing game/vendor attribution. Resolve here so vendors get the credits they earned."
      breadcrumbs={['Pipeline', 'Reconciliation']}
    >
      <div className="mb-3 flex gap-1 border-b border-border/60">
        <button
          type="button"
          onClick={() => setTab('orphans')}
          className={`px-3 py-2 text-sm font-medium ${
            tab === 'orphans' ? 'border-b-2 border-accent text-text' : 'text-muted hover:text-text'
          }`}
        >
          Orphans <span className="ml-1 text-xs">({orphans.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('refunds')}
          className={`px-3 py-2 text-sm font-medium ${
            tab === 'refunds' ? 'border-b-2 border-accent text-text' : 'text-muted hover:text-text'
          }`}
        >
          Refund corrections <span className="ml-1 text-xs">({refundCorrections.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('audit')}
          className={`px-3 py-2 text-sm font-medium ${
            tab === 'audit' ? 'border-b-2 border-accent text-text' : 'text-muted hover:text-text'
          }`}
        >
          Audit
        </button>
        <button
          type="button"
          onClick={() => setTab('drift')}
          className={`px-3 py-2 text-sm font-medium ${
            tab === 'drift' ? 'border-b-2 border-accent text-text' : 'text-muted hover:text-text'
          }`}
        >
          Ledger drift
        </button>
      </div>

      {tab !== 'audit' && tab !== 'drift' ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {tab === 'orphans' ? (
            <>
              <button
                type="button"
                onClick={() => void refreshOrphans()}
                disabled={loading}
                className="ui-btn ui-btn-neutral text-sm"
              >
                {loading ? 'Refreshing…' : 'Refresh orphans'}
              </button>
              <button
                type="button"
                onClick={() => void loadStatic()}
                className="ui-btn ui-btn-neutral text-sm"
                title="Reload catalog, vendors, and event packages. Use after editing the catalog or adding a new vendor."
              >
                Reload reference data
              </button>
              <button
                type="button"
                onClick={() => setShowMirrorModal(true)}
                className="ui-btn ui-btn-accent text-sm"
                title="Bulk-fix combo orphans by mirroring billingItems[] catalog IDs onto items[]. Each booking gets a per-field before/after preview before Apply. No money moves."
              >
                Mirror billingItems → items
              </button>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={openByIdInput}
                    onChange={(e) => {
                      setOpenByIdInput(e.target.value)
                      if (openByIdError) setOpenByIdError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !openByIdBusy) {
                        e.preventDefault()
                        void handleOpenById()
                      }
                    }}
                    placeholder="Paste booking ID (e.g. ASG260330…)"
                    className="ui-field min-h-7 w-72 px-2 text-xs font-mono"
                    aria-label="Open booking by ID"
                    disabled={openByIdBusy}
                  />
                  <button
                    type="button"
                    onClick={() => void handleOpenById()}
                    disabled={openByIdBusy || !openByIdInput.trim()}
                    className="ui-btn ui-btn-neutral min-h-7 px-3 text-xs"
                    title="Open the resolver for any booking, even if it isn't in the orphan list. Use to re-attribute a fully-unattributed booking that no other view surfaces."
                  >
                    {openByIdBusy ? 'Opening…' : 'Open'}
                  </button>
                </div>
                {openByIdError ? (
                  <p className="text-[11px] text-critical">{openByIdError}</p>
                ) : null}
              </div>
              {(() => {
                const ageMs = orphansCheckedAt === null ? null : Date.now() - orphansCheckedAt
                const isFresh = ageMs !== null && ageMs < 60_000
                const isStale = ageMs !== null && ageMs >= 5 * 60_000
                const tone = loading
                  ? 'border-info/40 bg-info/5 text-info'
                  : isStale
                    ? 'border-warning/40 bg-warning/5 text-warning'
                    : isFresh
                      ? 'border-success/40 bg-success/5 text-success'
                      : 'border-border/60 bg-surface text-muted'
                const dot = loading
                  ? 'animate-pulse bg-info'
                  : isStale
                    ? 'bg-warning'
                    : isFresh
                      ? 'bg-success'
                      : 'bg-muted'
                return (
                  <span
                    className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}
                    title={
                      orphansCheckedAt
                        ? `Orphan list last refreshed at ${new Date(orphansCheckedAt).toLocaleTimeString()}`
                        : 'Orphan list has not been checked yet'
                    }
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                    {loading ? 'Checking…' : `Last checked ${formatRelative(orphansCheckedAt)}`}
                  </span>
                )
              })()}
              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => toggleAutoRefresh(e.target.checked)}
                  aria-label="Auto-refresh orphans every 60 seconds"
                />
                Auto-refresh (60s)
              </label>
              <p className="text-xs text-muted">
                {orphans.length} orphan{orphans.length === 1 ? '' : 's'} · total revenue at risk:{' '}
                <strong className="text-warning">{currency(totalLeak)}</strong>
                {catalog.length > 0 ? ` · ${catalog.length} catalog rows loaded` : ''}
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void refreshRefunds()}
                disabled={refundLoading}
                className="ui-btn ui-btn-neutral text-sm"
              >
                {refundLoading ? 'Refreshing…' : 'Refresh refund corrections'}
              </button>
              <p className="text-xs text-muted">
                {refundsByBooking.length} booking{refundsByBooking.length === 1 ? '' : 's'} ·{' '}
                {refundCorrections.length} correction
                {refundCorrections.length === 1 ? '' : 's'} pending. Click <strong>Review</strong>{' '}
                to see the full booking context — items, refunded flags, ledger entries — and decide
                each correction.
              </p>
            </>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </div>
      ) : null}

      {tab === 'orphans' ? (
        loading && orphans.length === 0 ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : orphans.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted">
            No orphan bookings detected. Every completed booking has at least a gameId on every
            item.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2 text-left">Booking ID</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Customer</th>
                  <th className="px-4 py-2 text-left">Branch</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-left">Items</th>
                  <th className="px-4 py-2 text-left">State</th>
                  <th className="px-4 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {orphans.map((o) => (
                  <tr key={o.id} className="hover:bg-surface/40">
                    <td className="px-4 py-2 font-mono text-xs">{o.id}</td>
                    <td className="px-4 py-2 text-xs text-muted">{o.date}</td>
                    <td className="px-4 py-2 text-xs">
                      <div>{o.customerName || 'Guest'}</div>
                      <div className="text-muted">{o.customerPhone}</div>
                    </td>
                    <td className="px-4 py-2 text-xs">{o.branchId || '—'}</td>
                    <td className="px-4 py-2 text-right font-medium">{currency(o.finalAmount)}</td>
                    <td className="px-4 py-2 text-xs">
                      {o.items.map((i, idx) => (
                        <div key={idx} className="truncate" title={i.itemName}>
                          {i.itemName} <span className="text-muted">(×{i.quantity})</span>
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {!o.hasBillingItems ? (
                          <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-semibold text-warning">
                            no billingItems
                          </span>
                        ) : null}
                        {!o.hasVendorIds ? (
                          <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-semibold text-warning">
                            no vendorIds
                          </span>
                        ) : null}
                        {o.enrichmentSource ? (
                          <span className="rounded-full border border-info/40 px-2 py-0.5 text-[10px] font-semibold text-info">
                            {o.enrichmentSource}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setActive(o)}
                        className="ui-btn ui-btn-accent min-h-7 px-3 py-1 text-xs"
                      >
                        Resolve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'refunds' ? (
        // ── Refund corrections tab — grouped by bookingId ─────────────────
        refundLoading && refundsByBooking.length === 0 ? (
          <p className="text-sm text-muted">Loading refund corrections…</p>
        ) : refundsByBooking.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted">
            No refund-debit drift detected. Every refunded booking's vendor debits match the
            item-level refund truth.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-panel">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2 text-left">Booking</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Branch</th>
                  <th className="px-4 py-2 text-right">Vendors affected</th>
                  <th className="px-4 py-2 text-right">|Σ delta|</th>
                  <th className="px-4 py-2 text-right">Net delta</th>
                  <th className="px-4 py-2 text-left">Vendors</th>
                  <th className="px-4 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {refundsByBooking.map((g) => (
                  <tr key={g.bookingId} className="hover:bg-surface/40">
                    <td className="px-4 py-2 font-mono text-xs">{g.bookingId}</td>
                    <td className="px-4 py-2 text-xs text-muted">{g.bookingDate.slice(0, 10)}</td>
                    <td className="px-4 py-2 text-xs">{g.branchId || '—'}</td>
                    <td className="px-4 py-2 text-right text-xs">{g.rows.length}</td>
                    <td className="px-4 py-2 text-right font-medium">{currency(g.absTotal)}</td>
                    <td
                      className={`px-4 py-2 text-right font-semibold ${
                        g.netDelta > 0 ? 'text-warning' : g.netDelta < 0 ? 'text-success' : ''
                      }`}
                    >
                      {g.netDelta > 0 ? '+' : ''}
                      {currency(g.netDelta)}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <div className="space-y-0.5">
                        {g.rows.slice(0, 3).map((r) => (
                          <div key={r.vendorId} className="truncate" title={r.vendorName}>
                            <span className="font-mono text-muted">{r.vendorId}</span>{' '}
                            <span className={r.delta > 0 ? 'text-warning' : 'text-success'}>
                              {r.delta > 0 ? '+' : ''}
                              {currency(r.delta)}
                            </span>
                          </div>
                        ))}
                        {g.rows.length > 3 ? (
                          <div className="text-muted">+{g.rows.length - 3} more</div>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setActiveRefundBookingId(g.bookingId)}
                        className="ui-btn ui-btn-accent min-h-7 px-3 py-1 text-xs"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'audit' && session ? (
        <Suspense fallback={<p className="text-sm text-muted">Loading audit…</p>}>
          <AuditTab
            vendors={vendors}
            resolvedBy={{ id: session.user.id, name: session.user.name }}
            refreshSignal={auditRefreshNonce}
            onOpenRefundReview={(bookingId) => setActiveRefundBookingId(bookingId)}
            onOpenById={(bookingId) => {
              void (async () => {
                try {
                  const b = await fetchBookingAsOrphan(bookingId)
                  setActiveFromAudit(true)
                  setActive(b)
                } catch (err) {
                  logger.error('reconciliation.audit_open_by_id_failed', err, { bookingId })
                  setError(
                    err instanceof Error
                      ? err.message
                      : 'Booking not found or could not be loaded.',
                  )
                }
              })()
            }}
            onOpenReattribute={(bookingId) => {
              void (async () => {
                try {
                  const b = await fetchBookingAsOrphan(bookingId)
                  setActiveFromAudit(true)
                  setActive(b)
                } catch (err) {
                  logger.error('reconciliation.audit_reattribute_load_failed', err, { bookingId })
                  setError(
                    err instanceof Error
                      ? err.message
                      : 'Failed to load booking for re-attribution.',
                  )
                }
              })()
            }}
          />
        </Suspense>
      ) : tab === 'drift' && session ? (
        <Suspense fallback={<p className="text-sm text-muted">Loading ledger drift…</p>}>
          <LedgerDriftTab
            vendors={vendors}
            resolvedBy={{ id: session.user.id, name: session.user.name }}
          />
        </Suspense>
      ) : null}

      {active && session ? (
        <Suspense fallback={null}>
          <OrphanResolverModal
            booking={active}
            catalog={catalog}
            vendors={vendors}
            packages={packages}
            vendorSuggestions={vendorSuggestions}
            resolvedBy={{ id: session.user.id, name: session.user.name }}
            onClose={() => {
              setActive(null)
              setActiveFromAudit(false)
            }}
            onResolved={() => {
              const wasFromAudit = activeFromAudit
              setActive(null)
              setActiveFromAudit(false)
              if (wasFromAudit) {
                // Bump the audit nonce so AuditTab re-runs the current
                // audit and the resolved booking's row reclassifies.
                setAuditRefreshNonce((n) => n + 1)
              } else {
                void refresh()
              }
            }}
          />
        </Suspense>
      ) : null}

      {showMirrorModal && session ? (
        <Suspense fallback={null}>
          <MirrorBillingModal
            resolvedBy={{ id: session.user.id, name: session.user.name }}
            onClose={() => setShowMirrorModal(false)}
            onApplied={() => {
              // Refresh orphans so just-fixed bookings disappear from the list.
              void refresh()
            }}
          />
        </Suspense>
      ) : null}

      {activeRefundBookingId && session ? (
        <Suspense fallback={null}>
          <RefundReviewModal
            bookingId={activeRefundBookingId}
            corrections={refundCorrections.filter((r) => r.bookingId === activeRefundBookingId)}
            vendors={vendors}
            resolvedBy={{ id: session.user.id, name: session.user.name }}
            onClose={() => setActiveRefundBookingId(null)}
            onApplied={(vendorId) => handleRefundApplied(activeRefundBookingId, vendorId)}
            onCorrectionsRecomputed={(next) =>
              handleCorrectionsRecomputed(activeRefundBookingId, next)
            }
          />
        </Suspense>
      ) : null}
    </ModulePageLayout>
  )
}

export default ReconciliationModule
