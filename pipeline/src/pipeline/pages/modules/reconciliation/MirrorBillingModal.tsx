import { useCallback, useState } from 'react'
import {
  type ApplyMirrorResult,
  type MirrorPreview,
  applyComboOrphanMirror,
  previewCombooOrphanMirror,
} from '../../../api/reconciliation-firestore'

interface Props {
  resolvedBy: { id: string; name: string }
  onClose: () => void
  /** Called after Apply succeeds so the parent tab refreshes. */
  onApplied: () => void
  /** Optional scoping: only scan these booking IDs. When omitted, scans
   *  the whole bookings collection (the Orphans-tab default). When set,
   *  the title and CTA copy adapt to reflect the scoped intent. */
  scopedBookingIds?: string[]
  /** Optional scope label (e.g., "Manoja audit · 2026-04-01 to 04-30"). */
  scopeLabel?: string
}

const MirrorBillingModal = ({
  resolvedBy,
  onClose,
  onApplied,
  scopedBookingIds,
  scopeLabel,
}: Props) => {
  const [previews, setPreviews] = useState<MirrorPreview[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewedSkipped, setReviewedSkipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<ApplyMirrorResult | null>(null)
  // Per-booking selection — admin can opt out of any booking before Apply.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const runScan = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const r = await previewCombooOrphanMirror(scopedBookingIds)
      setPreviews(r)
      setExcluded(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed.')
    } finally {
      setLoading(false)
    }
  }, [scopedBookingIds])

  const eligible = previews.filter((p) => !excluded.has(p.bookingId) && p.changes.length > 0)
  const totalItemsToChange = eligible.reduce((s, p) => s + p.changes.length, 0)
  const totalUnmatched = previews.reduce((s, p) => s + p.unmatched.length, 0)

  const handleApply = async () => {
    setBusy(true)
    setProgress({ done: 0, total: eligible.length })
    try {
      const r = await applyComboOrphanMirror(eligible, resolvedBy, (d, t) => {
        setProgress({ done: d, total: t })
      })
      setResult(r)
      onApplied()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-4">
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl">
        <header className="border-b border-border/60 px-5 py-3">
          <h2 className="text-base font-semibold text-text">
            Mirror billingItems → items (combo orphan fix)
          </h2>
          <p className="mt-1 text-xs text-muted">
            Copies <code>gameId / subGameId / variantId / vendorId</code> from each booking's
            <code> billingItems[]</code> onto its <code>items[]</code> when the latter has empty
            IDs. <strong>No money moves.</strong> No ledger writes. Pure metadata propagation.
          </p>
          {scopeLabel ? (
            <p className="mt-1 text-[11px] text-info">
              Scoped: <strong>{scopeLabel}</strong>
              {scopedBookingIds
                ? ` · ${scopedBookingIds.length} booking${scopedBookingIds.length === 1 ? '' : 's'}`
                : null}
            </p>
          ) : null}
        </header>

        <div className="border-b border-border/60 bg-surface px-5 py-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={loading || busy}
              className="ui-btn ui-btn-neutral min-h-7 px-3"
            >
              {loading ? 'Scanning…' : previews.length === 0 ? 'Scan orphans' : 'Re-scan'}
            </button>
            {previews.length > 0 ? (
              <>
                <span className="text-muted">·</span>
                <span>
                  <strong className="text-text">{previews.length}</strong> orphan booking
                  {previews.length === 1 ? '' : 's'} found
                </span>
                <span className="text-muted">·</span>
                <span>
                  <strong className="text-success">{eligible.length}</strong> selected for fix
                </span>
                <span className="text-muted">·</span>
                <span>
                  <strong className="text-success">{totalItemsToChange}</strong> items to change
                </span>
                {totalUnmatched > 0 ? (
                  <>
                    <span className="text-muted">·</span>
                    <span className="text-warning">
                      <strong>{totalUnmatched}</strong> unmatched (left as-is)
                    </span>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {previews.length === 0 && !loading ? (
            <p className="text-sm text-muted">
              Click <strong>Scan orphans</strong> to find combo bookings whose items[] have empty
              gameIds but whose billingItems[] has the truth.
            </p>
          ) : null}

          {previews.length > 0 ? (
            <div className="space-y-3">
              {previews.map((pv) => {
                const isExcluded = excluded.has(pv.bookingId)
                return (
                  <div
                    key={pv.bookingId}
                    className={`rounded-xl border p-3 ${
                      isExcluded
                        ? 'border-border/40 bg-surface opacity-50'
                        : 'border-info/30 bg-info/5'
                    }`}
                  >
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="font-mono text-sm text-text">{pv.bookingId}</p>
                        <p className="text-[11px] text-muted">
                          {pv.date} · branch {pv.branchId} · {pv.totalItems} item
                          {pv.totalItems === 1 ? '' : 's'} ({pv.alreadyClean} already clean,{' '}
                          <span className="text-success">{pv.changes.length}</span> to fix
                          {pv.unmatched.length > 0 ? (
                            <>
                              , <span className="text-warning">{pv.unmatched.length}</span>{' '}
                              unmatched
                            </>
                          ) : null}
                          )
                        </p>
                      </div>
                      <label className="flex items-center gap-1 text-[11px] text-muted">
                        <input
                          type="checkbox"
                          checked={!isExcluded}
                          onChange={(e) => {
                            const next = new Set(excluded)
                            if (e.target.checked) next.delete(pv.bookingId)
                            else next.add(pv.bookingId)
                            setExcluded(next)
                          }}
                        />
                        Include in fix
                      </label>
                    </div>

                    {/* The "what will change" table — per-item, before → after. */}
                    {pv.changes.length > 0 ? (
                      <table className="w-full text-xs">
                        <thead className="text-[10px] uppercase tracking-wider text-muted">
                          <tr>
                            <th className="px-2 py-1 text-left">#</th>
                            <th className="px-2 py-1 text-left">Item</th>
                            <th className="px-2 py-1 text-left">Field</th>
                            <th className="px-2 py-1 text-left">Before</th>
                            <th className="px-2 py-1 text-left">After</th>
                            <th className="px-2 py-1 text-left">Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pv.changes.map((ch) => {
                            const fields = [
                              'gameId',
                              'subGameId',
                              'variantId',
                              'vendorId',
                              'unitPrice',
                              'quantity',
                            ] as const
                            const changed = fields.filter((ff) => ch.before[ff] !== ch.after[ff])
                            return changed.map((f, fIdx) => {
                              const beforeVal = ch.before[f]
                              const afterVal = ch.after[f]
                              const showVal = (v: string | number) =>
                                v === '' || v === 0 ? (
                                  <span className="italic">(empty)</span>
                                ) : (
                                  String(v)
                                )
                              return (
                                <tr
                                  key={`${ch.itemIndex}-${f}`}
                                  className="border-t border-border/30"
                                >
                                  {fIdx === 0 ? (
                                    <>
                                      <td
                                        className="px-2 py-0.5 align-top text-muted"
                                        rowSpan={changed.length}
                                      >
                                        {ch.itemIndex + 1}
                                      </td>
                                      <td
                                        className="px-2 py-0.5 align-top"
                                        rowSpan={changed.length}
                                      >
                                        <div className="truncate max-w-[200px]" title={ch.itemName}>
                                          {ch.itemName}
                                        </div>
                                      </td>
                                    </>
                                  ) : null}
                                  <td className="px-2 py-0.5 font-mono text-[10px]">{f}</td>
                                  <td className="px-2 py-0.5 font-mono text-[10px] text-warning">
                                    {showVal(beforeVal)}
                                  </td>
                                  <td className="px-2 py-0.5 font-mono text-[10px] text-success">
                                    {showVal(afterVal)}
                                  </td>
                                  {fIdx === 0 ? (
                                    <td
                                      className="px-2 py-0.5 align-top text-[10px] text-muted"
                                      rowSpan={changed.length}
                                    >
                                      {ch.matchedVia === 'billing-variantId' ||
                                      ch.matchedVia === 'billing-itemName'
                                        ? 'billingItems[]'
                                        : ch.matchedVia === 'combo-doc'
                                          ? 'combo doc'
                                          : ch.matchedVia === 'event-package-doc'
                                            ? 'event package'
                                            : ch.matchedVia === 'catalog-exact'
                                              ? 'catalog'
                                              : 'none'}
                                      <br />
                                      <span className="opacity-60">via {ch.matchedVia}</span>
                                    </td>
                                  ) : null}
                                </tr>
                              )
                            })
                          })}
                        </tbody>
                      </table>
                    ) : null}

                    {pv.unmatched.length > 0 ? (
                      <div className="mt-2 rounded border border-warning/40 bg-warning/5 px-2 py-1 text-[11px] text-warning">
                        <p className="font-semibold">
                          {pv.unmatched.length} item{pv.unmatched.length === 1 ? '' : 's'} cannot be
                          auto-fixed:
                        </p>
                        <ul className="ml-4 mt-1 list-disc">
                          {pv.unmatched.map((u) => (
                            <li key={u.itemIndex}>
                              <span className="font-mono">#{u.itemIndex + 1}</span>{' '}
                              <span className="opacity-90">{u.itemName}</span> — {u.reason}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1 text-[10px] opacity-80">
                          These rows stay orphan. Use Resolve in the Orphans tab for manual
                          attribution.
                        </p>
                      </div>
                    ) : null}

                    {pv.changes.length === 0 && pv.unmatched.length === 0 ? (
                      <p className="text-[11px] text-muted">Nothing to change.</p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

          {progress && !result ? (
            <div className="mt-3 rounded-lg border border-info/40 bg-info/5 px-3 py-2 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-info">Applying mirror…</span>
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

          {result ? (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                result.failed.length === 0
                  ? 'border-success/40 bg-success/5 text-success'
                  : 'border-warning/40 bg-warning/5 text-warning'
              }`}
            >
              <p className="font-semibold">
                {result.failed.length === 0 ? '✓ Mirror complete' : '⚠ Completed with issues'}
              </p>
              <p>
                {result.succeeded.length} bookings updated ·{' '}
                {result.succeeded.reduce((s, x) => s + x.itemsChanged, 0)} items now have catalog
                IDs · {result.failed.length} failed
              </p>
              {result.failed.length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer">Failures ({result.failed.length})</summary>
                  <ul className="ml-4 mt-1 list-disc">
                    {result.failed.map((f) => (
                      <li key={f.bookingId}>
                        <code>{f.bookingId}</code> · {f.error}
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

        {!result && eligible.length > 0 ? (
          <div className="border-t border-warning/40 bg-warning/5 px-5 py-3 text-xs text-warning">
            <label className="flex items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={reviewedSkipped}
                onChange={(e) => setReviewedSkipped(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>I have reviewed each booking's per-item before/after.</strong> The fix will
                copy IDs from billingItems[] onto items[] for the {eligible.length} selected booking
                {eligible.length === 1 ? '' : 's'} ({totalItemsToChange} items total). It will NOT
                change ledger entries, money, or any vendor that is already stamped on items[].
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
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result ? (
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={!reviewedSkipped || busy || eligible.length === 0}
              className="ui-btn ui-btn-accent min-h-8 px-4 text-sm"
            >
              {busy ? 'Applying…' : `Mirror ${eligible.length} bookings`}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  )
}

export default MirrorBillingModal
