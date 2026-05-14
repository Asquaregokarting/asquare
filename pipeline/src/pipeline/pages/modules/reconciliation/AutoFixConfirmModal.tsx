import { useMemo, useState } from 'react'
import {
  type AuditResult,
  type AutoFixApplyResult,
  type AutoFixPlan,
  type AutoFixRowPlan,
  applyAutoFix,
  planAutoFix,
} from '../../../api/reconciliation-firestore'

const currency = (n: number): string => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

const ACTION_TONE: Record<AutoFixRowPlan['action'], string> = {
  'write-credit': 'border-success/40 bg-success/5 text-success',
  'write-debit': 'border-warning/40 bg-warning/5 text-warning',
  acknowledge: 'border-info/40 bg-info/5 text-info',
  'remove-vendor-tag': 'border-info/40 bg-info/5 text-info',
  skip: 'border-border/60 bg-surface text-muted',
}

const ACTION_LABEL: Record<AutoFixRowPlan['action'], string> = {
  'write-credit': 'Write credit',
  'write-debit': 'Write debit',
  acknowledge: 'Acknowledge',
  'remove-vendor-tag': 'Remove stale tag',
  skip: 'Skip',
}

interface Props {
  result: AuditResult
  resolvedBy: { id: string; name: string }
  onClose: () => void
  /** Called once apply finishes successfully so the audit re-runs. */
  onApplied: (result: AutoFixApplyResult) => void
}

const AutoFixConfirmModal = ({ result, resolvedBy, onClose, onApplied }: Props) => {
  const [perRowCap, setPerRowCap] = useState(5000)
  const [totalCap, setTotalCap] = useState(50000)
  const [ackBundleDiscount, setAckBundleDiscount] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; last?: string } | null>(
    null,
  )
  const [done, setDone] = useState<AutoFixApplyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSkipped, setShowSkipped] = useState(false)
  // Force-review gate: when the audit contains rows that are skipped for a
  // reason that needs human attention (unexplained-diff, wrong-vendor-stamp
  // with overpay, refund-correction), the admin must tick this box before
  // Apply enables. Stops blind auto-fix runs from being a single click.
  const [reviewedSkipped, setReviewedSkipped] = useState(false)

  const plan: AutoFixPlan = useMemo(
    () =>
      planAutoFix(result, {
        perRowCap,
        totalCap,
        ackBundleDiscount,
      }),
    [result, perRowCap, totalCap, ackBundleDiscount],
  )

  const visibleRows = showSkipped ? plan.rows : plan.rows.filter((r) => r.action !== 'skip')
  const actionableCount = plan.rows.length - plan.counts.skip
  // Rows that need a human eye before applying — they're skipped, so the
  // run won't touch them, but admin must confirm they've seen them so
  // they don't disappear into the noise.
  const needsReviewRows = plan.rows.filter(
    (r) =>
      r.action === 'skip' &&
      (r.classification === 'unexplained-diff' || r.classification === 'refund-correction'),
  )
  const reviewRequired = needsReviewRows.length > 0
  const canApply =
    !plan.abortReason &&
    actionableCount > 0 &&
    !busy &&
    !done &&
    (!reviewRequired || reviewedSkipped)

  const handleApply = async () => {
    setBusy(true)
    setError(null)
    setProgress({ done: 0, total: actionableCount })
    try {
      const r = await applyAutoFix(plan, resolvedBy, (d, t, current) => {
        setProgress({ done: d, total: t, last: current?.bookingId })
      })
      setDone(r)
      onApplied(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-fix failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/70 p-4">
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-xl">
        <header className="flex items-baseline justify-between border-b border-border/60 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-text">Auto-fix audit rows</h2>
            <p className="text-xs text-muted">
              {result.vendorName} · {result.fromDate} to {result.toDate} · {result.rows.length}{' '}
              bookings
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="ui-btn ui-btn-neutral min-h-7 px-2 text-xs"
            aria-label="Close auto-fix modal"
          >
            Close
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          {/* Headline counts */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Tile
              label="Write credit"
              value={String(plan.counts.writeCredit)}
              detail={currency(plan.totalCredit)}
              tone="success"
            />
            <Tile
              label="Write debit"
              value={String(plan.counts.writeDebit)}
              detail={currency(plan.totalDebit)}
              tone="warning"
            />
            <Tile
              label="Acknowledge"
              value={String(plan.counts.acknowledge)}
              detail="metadata only"
              tone="info"
            />
            <Tile
              label="Remove stale tag"
              value={String(plan.counts.removeVendorTag)}
              detail="no money moves"
              tone="info"
            />
            <Tile label="Skip" value={String(plan.counts.skip)} detail="no action" tone="muted" />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-surface px-2 py-1.5 text-xs">
              <p className="text-[10px] uppercase tracking-wider text-muted">Net movement</p>
              <p
                className={`text-lg font-semibold ${
                  plan.netMovement === 0
                    ? 'text-text'
                    : plan.netMovement > 0
                      ? 'text-success'
                      : 'text-warning'
                }`}
              >
                {plan.netMovement > 0 ? '+ ' : plan.netMovement < 0 ? '− ' : ''}
                {currency(Math.abs(plan.netMovement))}
              </p>
              <p className="text-muted">
                {currency(plan.totalCredit)} credits − {currency(plan.totalDebit)} debits
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-surface px-2 py-1.5 text-xs">
              <p className="text-[10px] uppercase tracking-wider text-muted">Caps</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] text-muted">Per-row max</span>
                  <input
                    type="number"
                    min={0}
                    value={perRowCap}
                    onChange={(e) => setPerRowCap(Math.max(0, Number(e.target.value) || 0))}
                    disabled={busy || !!done}
                    className="ui-field min-h-7 w-full text-xs"
                    aria-label="Per-row cap"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-muted">Total max</span>
                  <input
                    type="number"
                    min={0}
                    value={totalCap}
                    onChange={(e) => setTotalCap(Math.max(0, Number(e.target.value) || 0))}
                    disabled={busy || !!done}
                    className="ui-field min-h-7 w-full text-xs"
                    aria-label="Total cap"
                  />
                </label>
              </div>
              <label className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={ackBundleDiscount}
                  onChange={(e) => setAckBundleDiscount(e.target.checked)}
                  disabled={busy || !!done}
                />
                Auto-acknowledge bundle-discount rows
              </label>
            </div>
          </div>

          {plan.abortReason ? (
            <div className="mt-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-xs text-critical">
              <strong>Plan blocked:</strong> {plan.abortReason}
            </div>
          ) : null}

          {/* Per-row preview */}
          <div className="mt-4 rounded-2xl border border-border bg-panel">
            <div className="flex items-center justify-between border-b border-border/60 bg-surface px-3 py-2 text-xs">
              <span className="font-semibold text-text">Per-row plan</span>
              <label className="flex items-center gap-1 text-muted">
                <input
                  type="checkbox"
                  checked={showSkipped}
                  onChange={(e) => setShowSkipped(e.target.checked)}
                />
                Show skipped ({plan.counts.skip})
              </label>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-surface/60 text-[10px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-1.5 text-left">Booking</th>
                  <th className="px-3 py-1.5 text-left">Class</th>
                  <th className="px-3 py-1.5 text-left">Action</th>
                  <th className="px-3 py-1.5 text-right">Amount</th>
                  <th className="px-3 py-1.5 text-left">Reason / skip note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {visibleRows.map((row) => (
                  <tr key={row.bookingId}>
                    <td className="px-3 py-1 font-mono text-[10px]">{row.bookingId}</td>
                    <td className="px-3 py-1 text-[10px] text-muted">{row.classification}</td>
                    <td className="px-3 py-1">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ACTION_TONE[row.action]}`}
                      >
                        {ACTION_LABEL[row.action]}
                      </span>
                    </td>
                    <td className="px-3 py-1 text-right font-mono">
                      {row.amount > 0 ? currency(row.amount) : '—'}
                    </td>
                    <td className="px-3 py-1 text-muted">
                      {row.action === 'skip' ? row.skipReason : row.reason}
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted">
                      No actionable rows. Toggle "Show skipped" to see why.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* Progress / result */}
          {progress && !done ? (
            <div className="mt-4 rounded-lg border border-info/40 bg-info/5 px-3 py-2 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-info">Applying…</span>
                <span className="text-muted">
                  {progress.done} / {progress.total}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-surface">
                <div
                  className="h-full bg-info transition-all"
                  style={{
                    width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              {progress.last ? (
                <p className="mt-1 truncate font-mono text-[10px] text-muted">
                  Last: {progress.last}
                </p>
              ) : null}
            </div>
          ) : null}

          {done ? (
            <div className="mt-4 rounded-lg border border-success/40 bg-success/5 px-3 py-2 text-xs">
              <p className="font-semibold text-success">Auto-fix complete</p>
              <p className="text-muted">
                {done.succeeded.length} succeeded · {done.failed.length} failed ·{' '}
                {currency(done.totalCreditApplied)} credits · {currency(done.totalDebitApplied)}{' '}
                debits
              </p>
              {done.failed.length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-warning">
                    Show failed ({done.failed.length})
                  </summary>
                  <ul className="mt-1 ml-4 list-disc space-y-0.5">
                    {done.failed.map((f) => (
                      <li key={f.row.bookingId}>
                        <code className="font-mono">{f.row.bookingId}</code> · {f.error}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-xs text-critical">
              {error}
            </div>
          ) : null}
        </div>

        {reviewRequired && !done ? (
          <div className="border-t border-warning/40 bg-warning/5 px-5 py-3 text-xs text-warning">
            <p className="mb-1 font-semibold">
              {needsReviewRows.length} skipped row{needsReviewRows.length === 1 ? '' : 's'} need
              human review:
            </p>
            <ul className="ml-4 list-disc space-y-0.5">
              {needsReviewRows.length <= 5 ? (
                needsReviewRows.map((r) => (
                  <li key={r.bookingId}>
                    <code className="font-mono">{r.bookingId}</code> · {r.classification} ·{' '}
                    {r.skipReason}
                  </li>
                ))
              ) : (
                <>
                  {needsReviewRows.slice(0, 5).map((r) => (
                    <li key={r.bookingId}>
                      <code className="font-mono">{r.bookingId}</code> · {r.classification}
                    </li>
                  ))}
                  <li className="text-muted">
                    …and {needsReviewRows.length - 5} more (toggle "Show skipped" above to see all)
                  </li>
                </>
              )}
            </ul>
            <label className="mt-2 flex items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={reviewedSkipped}
                onChange={(e) => setReviewedSkipped(e.target.checked)}
              />
              <span>
                <strong>I have reviewed</strong> the skipped rows above. They will be left untouched
                — auto-fix will only write the {actionableCount} actionable row
                {actionableCount === 1 ? '' : 's'}.
              </span>
            </label>
          </div>
        ) : null}

        <footer className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
          <p className="text-[11px] text-muted">
            Per-row writes are idempotent — re-running with the same plan is a no-op.
            Unexplained-diff and refund-correction rows are never auto-fixed.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="ui-btn ui-btn-neutral min-h-8 px-3 text-sm"
            >
              {done ? 'Close' : 'Cancel'}
            </button>
            {!done ? (
              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={!canApply}
                className="ui-btn ui-btn-accent min-h-8 px-4 text-sm"
              >
                {busy
                  ? 'Applying…'
                  : `Apply ${actionableCount} fix${actionableCount === 1 ? '' : 'es'}`}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
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

export default AutoFixConfirmModal
