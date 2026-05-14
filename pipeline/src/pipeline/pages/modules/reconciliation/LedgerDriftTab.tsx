import { useCallback, useMemo, useState } from 'react'
import {
  type ApplyDriftResult,
  type BookingVendorInspection,
  type LedgerDriftRow,
  type VendorOption,
  applyLedgerToBillingTruth,
  detectLedgerVsBillingDrift,
  inspectBookingVendor,
  rollbackReconciliationDocs,
} from '../../../api/reconciliation-firestore'

const currency = (n: number): string => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

const today = (): string => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number): string => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

interface Props {
  vendors: VendorOption[]
  resolvedBy: { id: string; name: string }
}

const LedgerDriftTab = ({ vendors, resolvedBy }: Props) => {
  const [from, setFrom] = useState(daysAgo(60))
  const [to, setTo] = useState(today())
  const [scope, setScope] = useState<'all' | 'event-combo'>('event-combo')
  const [rows, setRows] = useState<LedgerDriftRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showApply, setShowApply] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyDriftResult | null>(null)
  const [reviewedSkipped, setReviewedSkipped] = useState(false)
  // Default cap intentionally low. A single corrective row above ₹2,000
  // is almost always a sign that billingItems is wrong (corrupted
  // vendorTotal, wrong vendor stamp) — fix the booking, don't auto-credit.
  const [perRowCap, setPerRowCap] = useState(2000)
  const [inspect, setInspect] = useState<BookingVendorInspection | null>(null)
  const [inspectLoading, setInspectLoading] = useState(false)
  const [rollbackBusy, setRollbackBusy] = useState(false)
  const [rollbackResult, setRollbackResult] = useState<{
    deleted: number
    skipped: number
  } | null>(null)

  const runScan = useCallback(async () => {
    setLoading(true)
    setError(null)
    setApplyResult(null)
    try {
      const r = await detectLedgerVsBillingDrift(from, to, vendors)
      setRows(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed.')
    } finally {
      setLoading(false)
    }
  }, [from, to, vendors])

  const openInspect = useCallback(async (row: LedgerDriftRow) => {
    setInspectLoading(true)
    setInspect(null)
    try {
      const result = await inspectBookingVendor(row.bookingId, row.vendorId)
      setInspect(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inspect failed.')
    } finally {
      setInspectLoading(false)
    }
  }, [])

  const handleRollback = useCallback(async () => {
    if (!applyResult || applyResult.writtenDocIds.length === 0) return
    if (
      !window.confirm(
        `Roll back ${applyResult.writtenDocIds.length} reconciliation row(s)? ` +
          `This deletes the credit/debit docs this Apply pass just wrote. ` +
          `Original ledger state will be restored.`,
      )
    ) {
      return
    }
    setRollbackBusy(true)
    try {
      const r = await rollbackReconciliationDocs(applyResult.writtenDocIds.map((w) => w.docId))
      setRollbackResult({ deleted: r.deleted.length, skipped: r.skipped.length })
      // Re-scan so the rolled-back rows reappear.
      void runScan()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed.')
    } finally {
      setRollbackBusy(false)
    }
  }, [applyResult, runScan])

  const filteredRows = useMemo(
    () => (scope === 'event-combo' ? rows.filter((r) => r.isEventOrCombo) : rows),
    [rows, scope],
  )
  const eligibleRows = useMemo(
    () => filteredRows.filter((r) => Math.abs(r.drift) <= perRowCap),
    [filteredRows, perRowCap],
  )
  const overCapRows = useMemo(
    () => filteredRows.filter((r) => Math.abs(r.drift) > perRowCap),
    [filteredRows, perRowCap],
  )
  const totalCreditPlanned = useMemo(
    () => eligibleRows.filter((r) => r.drift > 0).reduce((s, r) => s + r.drift, 0),
    [eligibleRows],
  )
  const totalDebitPlanned = useMemo(
    () => eligibleRows.filter((r) => r.drift < 0).reduce((s, r) => s + Math.abs(r.drift), 0),
    [eligibleRows],
  )

  const handleApply = async () => {
    setApplyBusy(true)
    setApplyProgress({ done: 0, total: eligibleRows.length })
    try {
      const r = await applyLedgerToBillingTruth(eligibleRows, resolvedBy, (d, t) => {
        setApplyProgress({ done: d, total: t })
      })
      setApplyResult(r)
      // Refresh scan so applied rows disappear.
      void runScan()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed.')
    } finally {
      setApplyBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-panel p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[140px_140px_1fr_auto]">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="ui-field min-h-8 w-full text-sm"
              aria-label="From date"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="ui-field min-h-8 w-full text-sm"
              aria-label="To date"
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name="scope"
                checked={scope === 'event-combo'}
                onChange={() => setScope('event-combo')}
              />
              Event / combo only
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name="scope"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
              />
              All bookings
            </label>
          </div>
          <div className="self-end">
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={loading}
              className="ui-btn ui-btn-accent min-h-8 px-4 text-sm"
            >
              {loading ? 'Scanning…' : 'Scan drift'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Compares <strong>billingItems[].vendorTotal</strong> (truth) vs the current ledger net per
          (booking, vendor). Drift &gt; ₹2 surfaces a corrective row. Apply writes idempotent
          credit/debit adjustments and verifies the result.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </div>
      ) : null}

      {filteredRows.length > 0 ? (
        <div className="rounded-2xl border border-border bg-panel p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile
              label="Drift rows"
              value={String(filteredRows.length)}
              detail={scope === 'event-combo' ? 'event/combo only' : 'all bookings'}
              tone="info"
            />
            <Tile
              label="Eligible"
              value={String(eligibleRows.length)}
              detail={`under ₹${perRowCap.toLocaleString('en-IN')} cap`}
              tone="success"
            />
            <Tile
              label="Credits planned"
              value={currency(totalCreditPlanned)}
              detail="vendor was under-credited"
              tone="success"
            />
            <Tile
              label="Debits planned"
              value={currency(totalDebitPlanned)}
              detail="vendor was over-credited"
              tone="warning"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-muted">Per-row cap:</span>
              <input
                type="number"
                min={0}
                value={perRowCap}
                onChange={(e) => setPerRowCap(Math.max(0, Number(e.target.value) || 0))}
                disabled={applyBusy}
                className="ui-field min-h-7 w-28 text-xs"
                aria-label="Per-row cap"
              />
            </label>
            <span className="text-[11px] text-muted">
              {overCapRows.length > 0
                ? `${overCapRows.length} over-cap rows excluded — review manually.`
                : 'No over-cap rows.'}
            </span>
            <span className="ml-auto" />
            <button
              type="button"
              onClick={() => setShowApply(true)}
              disabled={eligibleRows.length === 0 || applyBusy}
              className="ui-btn ui-btn-accent min-h-7 px-3 text-xs"
            >
              Reconcile {eligibleRows.length} rows to billingItems truth
            </button>
          </div>
        </div>
      ) : null}

      {filteredRows.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-panel">
          <table className="w-full text-xs">
            <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-1.5 text-left">Booking</th>
                <th className="px-3 py-1.5 text-left">Date</th>
                <th className="px-3 py-1.5 text-left">Vendor</th>
                <th className="px-3 py-1.5 text-right">vendorTotalSum</th>
                <th className="px-3 py-1.5 text-right">Ledger net</th>
                <th className="px-3 py-1.5 text-right">Drift</th>
                <th className="px-3 py-1.5 text-left">Sources</th>
                <th className="px-3 py-1.5 text-left">Tag</th>
                <th className="px-3 py-1.5 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredRows.map((r) => {
                const overCap = Math.abs(r.drift) > perRowCap
                return (
                  <tr key={`${r.bookingId}-${r.vendorId}`}>
                    <td className="px-3 py-1 font-mono text-[10px]">{r.bookingId}</td>
                    <td className="px-3 py-1 text-muted">{r.date}</td>
                    <td className="px-3 py-1">
                      <div>{r.vendorName ?? r.vendorId}</div>
                      <div className="font-mono text-[10px] text-muted">{r.vendorId}</div>
                    </td>
                    <td className="px-3 py-1 text-right font-mono">{currency(r.vendorTotalSum)}</td>
                    <td className="px-3 py-1 text-right font-mono">{currency(r.ledgerNet)}</td>
                    <td
                      className={`px-3 py-1 text-right font-mono ${
                        r.drift > 0 ? 'text-success' : 'text-warning'
                      }`}
                    >
                      {r.drift > 0 ? '+' : ''}
                      {currency(r.drift)}
                    </td>
                    <td className="px-3 py-1 text-[10px] text-muted">
                      {r.ledgerSources.join(', ') || '—'}
                    </td>
                    <td className="px-3 py-1">
                      {r.isEventOrCombo ? (
                        <span className="rounded-full border border-info/40 bg-info/5 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-info">
                          event/combo
                        </span>
                      ) : null}
                      {overCap ? (
                        <span className="ml-1 rounded-full border border-critical/40 bg-critical/5 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-critical">
                          over-cap
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => void openInspect(r)}
                        className="ui-btn ui-btn-neutral min-h-6 px-2 py-0.5 text-[10px]"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : !loading ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted">
          {rows.length === 0
            ? 'Pick a date range and click Scan drift.'
            : 'No event/combo drift in the current scope. Switch to "All bookings" to widen.'}
        </p>
      ) : null}

      {/* Apply confirm modal */}
      {showApply ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-4">
          <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl">
            <header className="border-b border-border/60 px-5 py-3">
              <h2 className="text-base font-semibold text-text">
                Reconcile {eligibleRows.length} rows to billingItems truth
              </h2>
              <p className="mt-1 text-xs text-muted">
                Writes one corrective adjustment per (booking, vendor) so ledger net equals{' '}
                billingItems[].vendorTotal exactly. Idempotent.
              </p>
            </header>
            <div className="overflow-y-auto px-5 py-4 text-xs">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Tile
                  label="Credits"
                  value={currency(totalCreditPlanned)}
                  detail="under-credited rows"
                  tone="success"
                />
                <Tile
                  label="Debits"
                  value={currency(totalDebitPlanned)}
                  detail="over-credited rows"
                  tone="warning"
                />
                <Tile
                  label="Net movement"
                  value={currency(totalCreditPlanned - totalDebitPlanned)}
                  detail="credits − debits"
                  tone="info"
                />
              </div>

              {applyProgress && !applyResult ? (
                <div className="mt-3 rounded-lg border border-info/40 bg-info/5 px-3 py-2 text-xs">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold text-info">Applying…</span>
                    <span className="text-muted">
                      {applyProgress.done} / {applyProgress.total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-surface">
                    <div
                      className="h-full bg-info transition-all"
                      style={{
                        width: `${
                          applyProgress.total > 0
                            ? (applyProgress.done / applyProgress.total) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {applyResult ? (
                <div
                  className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                    applyResult.failed.length === 0 && applyResult.verifyFailures.length === 0
                      ? 'border-success/40 bg-success/5 text-success'
                      : 'border-warning/40 bg-warning/5 text-warning'
                  }`}
                >
                  <p className="font-semibold">
                    {applyResult.failed.length === 0 && applyResult.verifyFailures.length === 0
                      ? '✓ Reconciled and verified'
                      : '⚠ Completed with issues'}
                  </p>
                  <p>
                    {applyResult.succeeded.length} reconciled · {applyResult.failed.length} write
                    failed · {applyResult.verifyFailures.length} verify mismatches ·{' '}
                    {currency(applyResult.totalCreditApplied)} credits applied ·{' '}
                    {currency(applyResult.totalDebitApplied)} debits applied
                  </p>
                  {applyResult.verifyFailures.length > 0 ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer">
                        Verify mismatches ({applyResult.verifyFailures.length})
                      </summary>
                      <ul className="ml-4 mt-1 list-disc">
                        {applyResult.verifyFailures.map((f, i) => (
                          <li key={i}>
                            <code className="font-mono">{f.row.bookingId}</code> · vendor{' '}
                            <code>{f.row.vendorId}</code>: target {currency(f.row.vendorTotalSum)},
                            ledger now {currency(f.ledgerAfter)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {applyResult.writtenDocIds.length > 0 && !rollbackResult ? (
                    <button
                      type="button"
                      onClick={() => void handleRollback()}
                      disabled={rollbackBusy}
                      className="ui-btn ui-btn-critical mt-2 min-h-7 px-3 py-1 text-[11px]"
                    >
                      {rollbackBusy
                        ? 'Rolling back…'
                        : `Rollback this pass (${applyResult.writtenDocIds.length} rows)`}
                    </button>
                  ) : null}
                  {rollbackResult ? (
                    <p className="mt-1 text-[11px] text-text/80">
                      Rolled back {rollbackResult.deleted} row(s)
                      {rollbackResult.skipped > 0
                        ? `, ${rollbackResult.skipped} skipped (not reconciliation rows)`
                        : ''}
                      .
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {!applyResult ? (
              <div className="border-t border-warning/40 bg-warning/5 px-5 py-3 text-xs text-warning">
                <label className="flex items-start gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={reviewedSkipped}
                    onChange={(e) => setReviewedSkipped(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <strong>I have reviewed the per-row drift table.</strong> Apply will write{' '}
                    {eligibleRows.filter((r) => r.drift > 0).length} credits and{' '}
                    {eligibleRows.filter((r) => r.drift < 0).length} debits, then re-read each
                    booking's ledger to verify the per-vendor net matches billingItems exactly.
                    {overCapRows.length > 0 ? (
                      <>
                        {' '}
                        {overCapRows.length} over-cap row{overCapRows.length === 1 ? '' : 's'} will
                        be skipped and remain visible in the table for manual review.
                      </>
                    ) : null}
                  </span>
                </label>
              </div>
            ) : null}

            <footer className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setShowApply(false)
                  setApplyResult(null)
                  setReviewedSkipped(false)
                }}
                disabled={applyBusy}
                className="ui-btn ui-btn-neutral min-h-8 px-3 text-sm"
              >
                {applyResult ? 'Close' : 'Cancel'}
              </button>
              {!applyResult ? (
                <button
                  type="button"
                  onClick={() => void handleApply()}
                  disabled={!reviewedSkipped || applyBusy || eligibleRows.length === 0}
                  className="ui-btn ui-btn-accent min-h-8 px-4 text-sm"
                >
                  {applyBusy ? 'Applying…' : `Apply ${eligibleRows.length}`}
                </button>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}

      {/* Inspect modal — shows billingItems vs ledger entries side-by-side
          so the admin can see WHY a drift row exists before applying. */}
      {inspectLoading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-4">
          <div className="rounded-2xl border border-border bg-panel px-5 py-3 text-sm text-muted">
            Loading…
          </div>
        </div>
      ) : null}
      {inspect ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-4">
          <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl">
            <header className="border-b border-border/60 px-5 py-3">
              <h2 className="text-base font-semibold text-text">Inspect drift row</h2>
              <p className="mt-1 font-mono text-[11px] text-muted">
                {inspect.bookingId} · vendor {inspect.vendorId} · payment{' '}
                {inspect.paymentStatus ?? '—'}
                {inspect.refundStatus && inspect.refundStatus !== 'None'
                  ? ` · refund ${inspect.refundStatus}`
                  : ''}
              </p>
            </header>
            <div className="overflow-y-auto px-5 py-4 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <Tile
                  label="Truth"
                  value={currency(inspect.vendorTotalSum)}
                  detail="Σ billingItems[].vendorTotal"
                  tone="success"
                />
                <Tile
                  label="Ledger net"
                  value={currency(inspect.ledgerNet)}
                  detail="credits − debits"
                  tone="info"
                />
                <Tile
                  label="Drift"
                  value={`${inspect.drift > 0 ? '+' : ''}${currency(inspect.drift)}`}
                  detail={inspect.drift > 0 ? 'under-credited' : 'over-credited'}
                  tone={inspect.drift > 0 ? 'success' : 'warning'}
                />
              </div>

              <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Matching billingItems ({inspect.matchingBillingItems.length})
              </h3>
              {inspect.matchingBillingItems.length === 0 ? (
                <p className="mt-1 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
                  No billingItems[] match this vendor on this booking. The drift row exists because
                  the ledger has rows for this vendor but the billing truth says ₹0 — likely a stale
                  or wrong vendor stamp. Roll back any reconciliation rows; do not apply.
                </p>
              ) : (
                <table className="mt-1 w-full text-[11px]">
                  <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-2 py-1 text-left">Item</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                      <th className="px-2 py-1 text-right">Unit</th>
                      <th className="px-2 py-1 text-right">vBase</th>
                      <th className="px-2 py-1 text-right">vGst</th>
                      <th className="px-2 py-1 text-right">vTotal</th>
                      <th className="px-2 py-1 text-left">Refunded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {inspect.matchingBillingItems.map((m, i) => (
                      <tr key={i} className={m.refunded ? 'opacity-60' : ''}>
                        <td className="px-2 py-1">{m.itemName}</td>
                        <td className="px-2 py-1 text-right">{m.quantity}</td>
                        <td className="px-2 py-1 text-right font-mono">{currency(m.unitPrice)}</td>
                        <td className="px-2 py-1 text-right font-mono">{currency(m.vendorBase)}</td>
                        <td className="px-2 py-1 text-right font-mono">{currency(m.vendorGst)}</td>
                        <td className="px-2 py-1 text-right font-mono">
                          {currency(m.vendorTotal)}
                        </td>
                        <td className="px-2 py-1 text-[10px]">{m.refunded ? 'yes' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Ledger entries ({inspect.ledgerEntries.length})
              </h3>
              {inspect.ledgerEntries.length === 0 ? (
                <p className="mt-1 text-[11px] text-muted">No ledger entries for this vendor.</p>
              ) : (
                <table className="mt-1 w-full text-[11px]">
                  <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-2 py-1 text-left">Doc ID</th>
                      <th className="px-2 py-1 text-left">Type</th>
                      <th className="px-2 py-1 text-left">Source</th>
                      <th className="px-2 py-1 text-right">Amount</th>
                      <th className="px-2 py-1 text-left">Date</th>
                      <th className="px-2 py-1 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {inspect.ledgerEntries.map((e) => (
                      <tr key={e.docId}>
                        <td className="px-2 py-1 font-mono text-[10px]">{e.docId}</td>
                        <td
                          className={`px-2 py-1 ${e.type === 'credit' ? 'text-success' : 'text-warning'}`}
                        >
                          {e.type}
                        </td>
                        <td className="px-2 py-1 text-[10px] text-muted">{e.source}</td>
                        <td className="px-2 py-1 text-right font-mono">{currency(e.amount)}</td>
                        <td className="px-2 py-1 text-[10px] text-muted">{e.date.slice(0, 10)}</td>
                        <td className="px-2 py-1 text-right">
                          {e.isReconciliationRow ? (
                            <button
                              type="button"
                              onClick={async () => {
                                if (
                                  !window.confirm(
                                    `Delete reconciliation row ${e.docId}? Ledger will revert by ${
                                      e.type === 'credit' ? '−' : '+'
                                    }${currency(e.amount)}.`,
                                  )
                                ) {
                                  return
                                }
                                try {
                                  await rollbackReconciliationDocs([e.docId])
                                  // Refresh inspect view
                                  const refreshed = await inspectBookingVendor(
                                    inspect.bookingId,
                                    inspect.vendorId,
                                  )
                                  setInspect(refreshed)
                                  void runScan()
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : 'Rollback failed.')
                                }
                              }}
                              className="ui-btn ui-btn-critical min-h-6 px-2 py-0.5 text-[10px]"
                            >
                              Delete
                            </button>
                          ) : (
                            <span className="text-[10px] text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
              <button
                type="button"
                onClick={() => setInspect(null)}
                className="ui-btn ui-btn-neutral min-h-8 px-3 text-sm"
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const Tile = ({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail: string
  tone: 'success' | 'warning' | 'info' | 'muted'
}) => {
  const cls = {
    success: 'border-success/40 bg-success/5 text-success',
    warning: 'border-warning/40 bg-warning/5 text-warning',
    info: 'border-info/40 bg-info/5 text-info',
    muted: 'border-border/60 bg-surface text-muted',
  }[tone]
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-[10px] opacity-80">{detail}</p>
    </div>
  )
}

export default LedgerDriftTab
