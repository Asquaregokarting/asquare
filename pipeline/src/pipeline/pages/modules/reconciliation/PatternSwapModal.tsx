import { useState } from 'react'
import { type MisattributionPattern, applyPatternSwap } from '../../../api/reconciliation-firestore'

const currency = (n: number): string => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

interface Props {
  pattern: MisattributionPattern
  resolvedBy: { id: string; name: string }
  onClose: () => void
  /** Called after the swap completes (whether or not verification failed). */
  onApplied: () => void
}

const PatternSwapModal = ({ pattern, resolvedBy, onClose, onApplied }: Props) => {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [reviewedSkipped, setReviewedSkipped] = useState(false)
  const [done, setDone] = useState<{
    succeeded: string[]
    failed: Array<{ bookingId: string; error: string }>
    verifyFailures: Array<{ bookingId: string; vendorId: string; expected: number; actual: number }>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canApply = !busy && !done && reviewedSkipped

  const handleApply = async () => {
    setBusy(true)
    setError(null)
    setProgress({ done: 0, total: pattern.instances.length })
    try {
      const r = await applyPatternSwap(pattern, resolvedBy, (d, t) => {
        setProgress({ done: d, total: t })
      })
      setDone(r)
      onApplied()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pattern swap failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-4">
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl">
        <header className="border-b border-border/60 px-5 py-3">
          <h2 className="text-base font-semibold text-text">Pattern swap</h2>
          <p className="mt-1 text-xs text-muted">
            <span className="font-mono">
              {pattern.gameId} / {pattern.subGameId} / {pattern.variantId}
            </span>{' '}
            @ branch {pattern.branchId}
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-3 text-xs">
            <span className="rounded-full border border-warning/40 bg-warning/5 px-2 py-0.5 text-warning">
              Observed vendor (wrong)
            </span>
            <span className="font-medium text-text">
              {pattern.observedVendorName ?? pattern.observedVendorId}
            </span>
            <span className="font-mono text-muted">{pattern.observedVendorId}</span>
            <span className="text-muted">→</span>
            <span className="rounded-full border border-success/40 bg-success/5 px-2 py-0.5 text-success">
              Expected vendor (right)
            </span>
            <span className="font-medium text-text">
              {pattern.expectedVendorName ?? pattern.expectedVendorId}
            </span>
            <span className="font-mono text-muted">{pattern.expectedVendorId}</span>
          </div>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile
              label="Affected bookings"
              value={String(pattern.instances.length)}
              detail="will swap"
              tone="info"
            />
            <Tile
              label="Debit observed"
              value={currency(pattern.totalObservedCredit)}
              detail={pattern.observedVendorName ?? pattern.observedVendorId}
              tone="warning"
            />
            <Tile
              label="Credit expected"
              value={currency(pattern.totalExpectedCredit)}
              detail={pattern.expectedVendorName ?? pattern.expectedVendorId}
              tone="success"
            />
            <Tile
              label="Net cost to company"
              value={currency(pattern.totalExpectedCredit - pattern.totalObservedCredit)}
              detail="(should be ≈ 0)"
              tone={
                Math.abs(pattern.totalExpectedCredit - pattern.totalObservedCredit) <= 5
                  ? 'success'
                  : 'warning'
              }
            />
          </div>

          <div className="mt-4 rounded-2xl border border-border bg-panel">
            <div className="border-b border-border/60 bg-surface px-3 py-2 text-xs font-semibold text-text">
              Per-booking plan
            </div>
            <table className="w-full text-xs">
              <thead className="bg-surface/60 text-[10px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-1.5 text-left">Booking</th>
                  <th className="px-3 py-1.5 text-left">Date</th>
                  <th className="px-3 py-1.5 text-left">Item</th>
                  <th className="px-3 py-1.5 text-right">Debit</th>
                  <th className="px-3 py-1.5 text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {pattern.instances.map((inst) => (
                  <tr key={inst.bookingId}>
                    <td className="px-3 py-1 font-mono text-[10px]">{inst.bookingId}</td>
                    <td className="px-3 py-1 text-muted">{inst.date}</td>
                    <td className="px-3 py-1 truncate" title={inst.itemName}>
                      {inst.itemName}
                    </td>
                    <td className="px-3 py-1 text-right font-mono text-warning">
                      − {currency(inst.observedAmount)}
                    </td>
                    <td className="px-3 py-1 text-right font-mono text-success">
                      + {currency(inst.expectedAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {progress && !done ? (
            <div className="mt-4 rounded-lg border border-info/40 bg-info/5 px-3 py-2 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-info">Applying swap…</span>
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
            </div>
          ) : null}

          {done ? (
            <div className="mt-4 space-y-2">
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  done.failed.length === 0 && done.verifyFailures.length === 0
                    ? 'border-success/40 bg-success/5 text-success'
                    : 'border-warning/40 bg-warning/5 text-warning'
                }`}
              >
                <p className="font-semibold">
                  {done.failed.length === 0 && done.verifyFailures.length === 0
                    ? '✓ Swap complete and ledger verified'
                    : '⚠ Swap completed with issues'}
                </p>
                <p>
                  {done.succeeded.length} swapped · {done.failed.length} write failed ·{' '}
                  {done.verifyFailures.length} verify mismatches
                </p>
              </div>
              {done.failed.length > 0 ? (
                <details className="rounded border border-critical/40 bg-critical/5 px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-semibold text-critical">
                    Failed writes ({done.failed.length})
                  </summary>
                  <ul className="ml-4 mt-1 list-disc">
                    {done.failed.map((f) => (
                      <li key={f.bookingId}>
                        <code>{f.bookingId}</code> · {f.error}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {done.verifyFailures.length > 0 ? (
                <details className="rounded border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-semibold text-warning">
                    Verify mismatches ({done.verifyFailures.length}) — ledger doesn't match expected
                  </summary>
                  <ul className="ml-4 mt-1 list-disc">
                    {done.verifyFailures.map((f, i) => (
                      <li key={`${f.bookingId}-${f.vendorId}-${i}`}>
                        <code>{f.bookingId}</code> · vendor <code>{f.vendorId}</code>: expected{' '}
                        {currency(f.expected)}, ledger has {currency(f.actual)}. Open this booking
                        and inspect manually.
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

        {!done ? (
          <div className="border-t border-warning/40 bg-warning/5 px-5 py-3 text-xs text-warning">
            <p className="mb-1 font-semibold">Force-review confirmation required</p>
            <label className="flex items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={reviewedSkipped}
                onChange={(e) => setReviewedSkipped(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>I have reviewed the per-booking plan above.</strong> The swap will write{' '}
                {pattern.instances.length} debits on{' '}
                {pattern.observedVendorName ?? pattern.observedVendorId} and{' '}
                {pattern.instances.length} credits on{' '}
                {pattern.expectedVendorName ?? pattern.expectedVendorId}. Each write is idempotent —
                re-running this swap is a no-op.
              </span>
            </label>
          </div>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
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
              {busy ? 'Applying…' : `Swap ${pattern.instances.length} bookings`}
            </button>
          ) : null}
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

export default PatternSwapModal
