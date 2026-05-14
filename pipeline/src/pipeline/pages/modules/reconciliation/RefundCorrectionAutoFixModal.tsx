import { useMemo, useState } from 'react'
import {
  type AuditBookingRow,
  type AuditResult,
  reconcileRefundCorrectionRows,
} from '../../../api/reconciliation-firestore'

const currency = (n: number): string => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

interface PlannedRow {
  row: AuditBookingRow
  direction: 'credit' | 'debit' | 'in-tolerance' | 'over-cap'
  amount: number
  note: string
}

interface Props {
  result: AuditResult
  resolvedBy: { id: string; name: string }
  onClose: () => void
  /** Called once apply finishes successfully so the audit re-runs. */
  onApplied: () => void
}

const RefundCorrectionAutoFixModal = ({ result, resolvedBy, onClose, onApplied }: Props) => {
  const [perRowCap, setPerRowCap] = useState(2000)
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{
    fixed: number
    skipped: number
    creditApplied: number
    debitApplied: number
    failed: Array<{ bookingId: string; error: string }>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const plan = useMemo<{
    rows: PlannedRow[]
    fixCount: number
    overCapCount: number
    inToleranceCount: number
    totalCredit: number
    totalDebit: number
  }>(() => {
    const rows: PlannedRow[] = []
    let fixCount = 0
    let overCapCount = 0
    let inToleranceCount = 0
    let totalCredit = 0
    let totalDebit = 0
    for (const r of result.rows) {
      if (r.classification !== 'refund-correction') continue
      const diff = r.diffLedgerVsVendorTotal
      const absDiff = Math.abs(diff)
      if (absDiff <= 2) {
        rows.push({
          row: r,
          direction: 'in-tolerance',
          amount: absDiff,
          note: 'Within ±₹2 tolerance, no fix needed.',
        })
        inToleranceCount += 1
        continue
      }
      if (absDiff > perRowCap) {
        rows.push({
          row: r,
          direction: 'over-cap',
          amount: absDiff,
          note: `Over the per-row cap of ${currency(perRowCap)}, will be skipped for individual review.`,
        })
        overCapCount += 1
        continue
      }
      const direction: 'credit' | 'debit' = diff < 0 ? 'credit' : 'debit'
      const note =
        diff < 0
          ? `Vendor was under-credited by ${currency(absDiff)}. A credit will be added so ledger net catches up to billingItems truth.`
          : `Vendor was over-credited by ${currency(absDiff)}. A debit will be added so ledger net steps down to billingItems truth.`
      rows.push({ row: r, direction, amount: absDiff, note })
      fixCount += 1
      if (direction === 'credit') totalCredit += absDiff
      else totalDebit += absDiff
    }
    return { rows, fixCount, overCapCount, inToleranceCount, totalCredit, totalDebit }
  }, [result.rows, perRowCap])

  const netMovement = plan.totalCredit - plan.totalDebit
  const canApply = !busy && !done && plan.fixCount > 0 && reviewed

  const handleApply = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await reconcileRefundCorrectionRows(result, resolvedBy, { perRowCap })
      setDone({
        fixed: r.fixed,
        skipped: r.skipped.length,
        creditApplied: r.totalCreditApplied,
        debitApplied: r.totalDebitApplied,
        failed: r.failed,
      })
      onApplied()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-fix failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/70 p-4">
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-xl">
        <header className="border-b border-border/60 px-5 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-text">
                Auto-fix refund-correction residuals
              </h2>
              <p className="truncate text-xs text-muted">
                {result.vendorName} · {result.fromDate} to {result.toDate}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="ui-btn ui-btn-neutral min-h-7 px-2 text-xs"
              aria-label="Close auto-fix refund-correction modal"
            >
              Close
            </button>
          </div>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          {/* Honest, plain-language explainer of what happens on Apply.
              No card grid, no big-number-small-label cliché — just three
              numbered steps the admin can read in two seconds. */}
          <section className="mb-4 rounded-xl border border-info/40 bg-info/5 px-4 py-3 text-xs">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-info">
              What this does
            </p>
            <ol className="mt-2 space-y-1.5 text-text/90">
              <li>
                <span className="font-mono text-[10px] text-info">1.</span> For every
                refund-correction row with a residual gap between{' '}
                <code className="text-[10px] text-muted">Σ billingItems[].vendorTotal</code> and{' '}
                <code className="text-[10px] text-muted">vendorLedger</code> net, write a corrective
                ledger row sized to close the gap exactly.
              </li>
              <li>
                <span className="font-mono text-[10px] text-info">2.</span> Acknowledge each fixed
                booking at <code className="text-[10px] text-muted">mismatchAmountAtAck = 0</code>{' '}
                so it disappears from the active queue and can&apos;t resurface as a stale ack
                later.
              </li>
              <li>
                <span className="font-mono text-[10px] text-info">3.</span> Re-run the audit so the
                fixed rows reclassify as{' '}
                <code className="text-[10px] text-muted">trigger-correct</code> or{' '}
                <code className="text-[10px] text-muted">rounding</code>. You see the work land
                without leaving the page.
              </li>
            </ol>
            <p className="mt-3 border-t border-info/30 pt-2 text-[11px] text-muted">
              <span className="font-semibold text-info">Money WILL move.</span> Each correction is a
              real <code className="text-[10px]">lc-reconcile-…</code> /{' '}
              <code className="text-[10px]">ld-reconcile-…</code> ledger row, timestamped and fully
              reversible row-by-row from Reconciliation → Ledger Drift → Inspect → Delete.
            </p>
          </section>

          {/* The core question: what's the net effect of clicking Apply?
              One large, plain-spoken summary instead of a 5-tile pyramid. */}
          <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-surface px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Net ledger movement
              </p>
              <p
                className={`mt-1 text-2xl font-semibold ${
                  netMovement === 0
                    ? 'text-text'
                    : netMovement > 0
                      ? 'text-success'
                      : 'text-warning'
                }`}
              >
                {netMovement > 0 ? '+ ' : netMovement < 0 ? '− ' : ''}
                {currency(Math.abs(netMovement))}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                <span className="text-success">{currency(plan.totalCredit)}</span> credits {'− '}
                <span className="text-warning">{currency(plan.totalDebit)}</span> debits across{' '}
                {plan.fixCount} booking{plan.fixCount === 1 ? '' : 's'}.
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-surface px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Per-row safety cap
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[11px] text-muted">INR</span>
                <input
                  type="number"
                  min={0}
                  value={perRowCap}
                  onChange={(e) => setPerRowCap(Math.max(0, Number(e.target.value) || 0))}
                  disabled={busy || !!done}
                  className="ui-field min-h-7 w-24 text-right text-base font-semibold"
                  aria-label="Per-row safety cap"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {plan.overCapCount > 0 ? (
                  <>
                    <span className="text-critical">
                      {plan.overCapCount} row{plan.overCapCount === 1 ? '' : 's'}
                    </span>{' '}
                    above this cap will be skipped. Raise the cap or fix individually.
                  </>
                ) : (
                  <>No rows are above this cap. All eligible rows will be auto-fixed.</>
                )}
              </p>
            </div>
          </section>

          {/* Per-row plan. The user explicitly asked for "all corrections"
              listed clearly. Direction badge + amount + plain-language note
              per row. Skipped rows kept inline so the count adds up. */}
          <section className="rounded-xl border border-border/70 bg-panel">
            <header className="flex items-baseline justify-between border-b border-border/60 bg-surface px-4 py-2 text-xs">
              <span className="font-semibold text-text">
                Plan for {plan.rows.length} refund-correction booking
                {plan.rows.length === 1 ? '' : 's'}
              </span>
              <span className="text-muted">
                <span className="text-text">{plan.fixCount}</span> fix ·{' '}
                <span className="text-critical">{plan.overCapCount}</span> over-cap ·{' '}
                <span className="text-muted">{plan.inToleranceCount}</span> in-tolerance
              </span>
            </header>
            {plan.rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted">
                No refund-correction rows to fix in the current scope.
              </p>
            ) : (
              <ul className="divide-y divide-border/40">
                {plan.rows.map(({ row, direction, amount, note }) => (
                  <li key={row.bookingId} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <code className="font-mono text-[11px] text-text">{row.bookingId}</code>
                        <span className="text-[10px] text-muted">{row.date}</span>
                      </div>
                      <DirectionBadge direction={direction} amount={amount} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted">{note}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      Σ vendorTotal {currency(row.vendorTotalSum)} · ledger net{' '}
                      {currency(row.ledgerNet)} · current diff{' '}
                      <span
                        className={
                          row.diffLedgerVsVendorTotal > 0
                            ? 'text-warning'
                            : row.diffLedgerVsVendorTotal < 0
                              ? 'text-success'
                              : 'text-muted'
                        }
                      >
                        {row.diffLedgerVsVendorTotal > 0 ? '+' : ''}
                        {currency(row.diffLedgerVsVendorTotal)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {done ? (
            <section className="mt-4 rounded-xl border border-success/40 bg-success/5 px-4 py-3 text-xs">
              <p className="font-semibold text-success">Auto-fix complete</p>
              <p className="mt-1 text-text/90">
                {done.fixed} booking{done.fixed === 1 ? '' : 's'} reconciled ·{' '}
                {currency(done.creditApplied)} credits · {currency(done.debitApplied)} debits ·{' '}
                {done.skipped} skipped
                {done.failed.length > 0 ? ` · ${done.failed.length} failed` : ''}.
              </p>
              {done.failed.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-warning">
                    Show failed ({done.failed.length})
                  </summary>
                  <ul className="mt-1 ml-4 list-disc space-y-0.5">
                    {done.failed.map((f) => (
                      <li key={f.bookingId}>
                        <code className="font-mono">{f.bookingId}</code> · {f.error}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          ) : null}

          {error ? (
            <section className="mt-4 rounded-xl border border-critical/45 bg-critical/10 px-4 py-3 text-xs text-critical">
              {error}
            </section>
          ) : null}
        </div>

        {!done ? (
          <div className="border-t border-warning/40 bg-warning/5 px-5 py-3 text-xs">
            <label className="flex items-start gap-2 text-text/90">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
                className="mt-0.5"
                aria-label="Confirm review"
              />
              <span>
                <strong>I have reviewed</strong> the {plan.fixCount} corrective row
                {plan.fixCount === 1 ? '' : 's'} above. Apply will write the corresponding credit /
                debit ledger entries and acknowledge each booking at the post-fix diff.
              </span>
            </label>
          </div>
        ) : null}

        <footer className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
          <p className="text-[11px] text-muted">
            Per-row writes are timestamped and stack additively. Roll back any row from
            Reconciliation → Ledger Drift → Inspect → Delete.
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
                  : `Apply ${plan.fixCount} fix${plan.fixCount === 1 ? '' : 'es'}`}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  )
}

const DirectionBadge = ({
  direction,
  amount,
}: {
  direction: PlannedRow['direction']
  amount: number
}) => {
  if (direction === 'credit') {
    return (
      <span className="rounded-full border border-success/45 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
        + {currency(amount)} credit
      </span>
    )
  }
  if (direction === 'debit') {
    return (
      <span className="rounded-full border border-warning/45 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
        {'− '}
        {currency(amount)} debit
      </span>
    )
  }
  if (direction === 'over-cap') {
    return (
      <span className="rounded-full border border-critical/45 bg-critical/10 px-2 py-0.5 text-[10px] font-semibold text-critical">
        skipped · over cap ({currency(amount)})
      </span>
    )
  }
  return (
    <span className="rounded-full border border-border/60 bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted">
      in tolerance
    </span>
  )
}

export default RefundCorrectionAutoFixModal
