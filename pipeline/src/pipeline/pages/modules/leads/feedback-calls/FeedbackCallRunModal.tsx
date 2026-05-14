import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { feedbackCallsApi } from '../../../../api/feedback-calls'
import type { FeedbackCallRunSummary } from '../../../../api/types'
import { useAuth } from '../../../../features/auth/auth-context'
import { relativeTime } from '../../../../features/leads/lead-utils'
import { BRANCH_MAP } from '../../../../features/leads/lead-constants'

interface Props {
  open: boolean
  onClose: () => void
}

const formatDuration = (ms: number): string => {
  if (ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

/**
 * Resolve a branch slug-or-id to a human display name. The metrics doc
 * stores the slug/branchId as the key — we run it through BRANCH_MAP
 * (branchId → displayName) for the numeric ids and fall back to the
 * raw value (which is the slug like "vizag") for everything else.
 */
const branchLabel = (key: string): string => {
  if (BRANCH_MAP[key]) return BRANCH_MAP[key]
  // Title-case slug fallback ("vizag" → "Vizag")
  return key.charAt(0).toUpperCase() + key.slice(1)
}

const FeedbackCallRunModal = ({ open, onClose }: Props) => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const [run, setRun] = useState<FeedbackCallRunSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the latest run whenever the modal opens
  useEffect(() => {
    if (!open || !token) return
    let cancelled = false
    setLoading(true)
    setError(null)
    feedbackCallsApi
      .listRuns(token, 1)
      .then((runs) => {
        if (cancelled) return
        setRun(runs[0] ?? null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load last run')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, token])

  // Sort the per-branch / per-telecaller maps for stable rendering
  const perBranchRows = useMemo(() => {
    if (!run) return []
    return Object.entries(run.perBranch)
      .map(([branchId, counts]) => ({
        branchId,
        label: branchLabel(branchId),
        distributed: counts.distributed,
        skipped: counts.skipped,
      }))
      .sort((a, b) => b.distributed - a.distributed || a.label.localeCompare(b.label))
  }, [run])

  const perTelecallerRows = useMemo(() => {
    if (!run) return []
    return Object.entries(run.perTelecaller)
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId))
  }, [run])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-base/75 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-call-run-modal-title"
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border/70 bg-panel p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-text"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <h2 id="feedback-call-run-modal-title" className="mb-1 text-lg font-semibold text-text">
          Last Distribution Run
        </h2>
        <p className="mb-4 text-xs text-muted">
          Audit log of the most recent feedback-call distribution.
        </p>

        {/* Loading state */}
        {loading && (
          <div className="py-12 text-center text-sm text-muted">Loading run summary...</div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && !run && (
          <div className="rounded-xl border border-dashed border-border/70 bg-surface/80 px-5 py-10 text-center text-sm text-muted">
            No distribution runs recorded yet. Click <strong>Run Distribution Now</strong> to create
            the first run.
          </div>
        )}

        {/* Loaded state */}
        {!loading && !error && run && (
          <div className="space-y-4">
            {/* Run metadata */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border/40 bg-surface/50 p-3 text-xs">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Visit Date
                </p>
                <p className="text-sm font-medium text-text">{run.visitDate}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Run Date
                </p>
                <p className="text-sm font-medium text-text">{run.runDate}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Trigger
                </p>
                <p className="text-sm font-medium text-text">
                  {run.trigger === 'cron' ? 'Scheduled cron' : 'Manual'}
                  {run.triggeredBy ? ` · ${run.triggeredBy}` : ''}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Created
                </p>
                <p className="text-sm font-medium text-text">{relativeTime(run.createdAt)}</p>
              </div>
            </div>

            {/* Top-level counts */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="ui-panel p-3">
                <p className="font-display text-2xl font-semibold leading-none text-text">
                  {run.totalCustomers}
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Total
                </p>
              </div>
              <div className="rounded-xl border border-success/35 bg-success/10 p-3 shadow-sm">
                <p className="font-display text-2xl font-semibold leading-none text-success">
                  {run.distributed}
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-success">
                  Distributed
                </p>
              </div>
              <div className="rounded-xl border border-warning/35 bg-warning/10 p-3 shadow-sm">
                <p className="font-display text-2xl font-semibold leading-none text-warning">
                  {run.skippedDuplicates}
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-warning">
                  Duplicates
                </p>
              </div>
              <div className="rounded-xl border border-critical/35 bg-critical/10 p-3 shadow-sm">
                <p className="font-display text-2xl font-semibold leading-none text-critical">
                  {run.skippedNoTelecaller}
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-critical">
                  No Telecaller
                </p>
              </div>
            </div>

            {/* Cron error (if any) */}
            {run.error && (
              <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
                <strong>Error:</strong> {run.error}
              </div>
            )}

            {/* Per-branch breakdown */}
            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Per Branch
              </h3>
              {perBranchRows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/60 bg-surface/40 px-3 py-2 text-xs text-muted">
                  No branch breakdown.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border/40">
                  <table className="w-full text-xs">
                    <thead className="bg-surface/70 text-[10px] uppercase tracking-[0.08em] text-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Branch</th>
                        <th className="px-3 py-2 text-right font-semibold">Distributed</th>
                        <th className="px-3 py-2 text-right font-semibold">Skipped</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {perBranchRows.map((row) => (
                        <tr key={row.branchId}>
                          <td className="px-3 py-2 text-text">{row.label}</td>
                          <td className="px-3 py-2 text-right font-medium text-success">
                            {row.distributed}
                          </td>
                          <td className="px-3 py-2 text-right text-warning">{row.skipped}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Per-telecaller breakdown */}
            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Per Telecaller
              </h3>
              {perTelecallerRows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/60 bg-surface/40 px-3 py-2 text-xs text-muted">
                  No telecaller breakdown.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border/40">
                  <table className="w-full text-xs">
                    <thead className="bg-surface/70 text-[10px] uppercase tracking-[0.08em] text-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Telecaller</th>
                        <th className="px-3 py-2 text-right font-semibold">Calls Assigned</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {perTelecallerRows.map((row) => (
                        <tr key={row.userId}>
                          <td className="px-3 py-2 font-mono text-[11px] text-text">
                            {row.userId}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-text">
                            {row.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer metadata */}
            <p className="text-[10px] text-muted">Duration: {formatDuration(run.durationMs)}</p>
          </div>
        )}

        {/* Close button */}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-neutral min-h-9 px-4 text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default FeedbackCallRunModal
