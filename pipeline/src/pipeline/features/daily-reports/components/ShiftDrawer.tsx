import { useEffect, useMemo, useRef, useState } from 'react'
import { Flag, Lock, Printer, ShieldCheck, X, Download, Undo2 } from 'lucide-react'
import { fmtDiscrepancy, fmtDuration, fmtLongDate, fmtRupees, fmtTime } from '../format'
import {
  addShiftComment,
  clearShiftFlag,
  deleteShiftComment,
  listShiftComments,
  setShiftReviewed,
} from '../api'
import { shiftsApi } from '../../../api/shifts'
import { logger } from '../../../../lib/logger'
import { CommentComposer, CommentThread } from './CommentThread'
import type { AuditShift, ShiftCommentRecord } from '../types'
import type { ShiftRecord } from '../../../api/shifts'

interface ShiftDrawerProps {
  audit: AuditShift
  cashierName: string
  token: string
  currentUserId: string
  canModerate: boolean
  onClose: () => void
  onChange: (next: AuditShift) => void
  onPrint: (audit: AuditShift) => void
  onExportPdf?: (audit: AuditShift) => void
  /**
   * Trigger a full re-fetch of the day's shifts. Called after a force-
   * close so the merged ledger picks up the new settlement + audit
   * metadata (which involves regrouping, not just patching one audit).
   */
  onRefresh?: () => void
}

const Row = ({
  label,
  entered,
  actual,
  diff,
  isLive,
}: {
  label: string
  entered: number
  actual: number
  diff: number
  isLive: boolean
}) => {
  const { text, tone } = fmtDiscrepancy(diff)
  return (
    <div className="grid grid-cols-[110px_1fr_1fr_1fr] items-baseline gap-3 border-b border-border/40 py-2.5 last:border-b-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="dr-tabular text-right text-sm text-text">{fmtRupees(entered)}</div>
      <div className="dr-tabular text-right text-sm text-muted">
        {isLive ? '—' : fmtRupees(actual)}
      </div>
      <div className={`dr-tabular text-right text-sm font-semibold dr-${tone}`}>
        {isLive ? '—' : text}
      </div>
    </div>
  )
}

export const ShiftDrawer = ({
  audit,
  cashierName,
  token,
  currentUserId,
  canModerate,
  onClose,
  onChange,
  onPrint,
  onExportPdf,
  onRefresh,
}: ShiftDrawerProps) => {
  const { shift, review } = audit
  const isLive = !shift.endTime

  const [comments, setComments] = useState<ShiftCommentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [undoFlag, setUndoFlag] = useState<{ commentId: string; expiresAt: number } | null>(null)
  const undoTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listShiftComments(shift.id)
      .then((rows) => {
        if (!cancelled) setComments(rows)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load comments.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [shift.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleAddComment = async (body: string, severity: 'comment' | 'flag') => {
    const next = await addShiftComment(token, shift.id, body, severity)
    setComments((prev) => [...prev, next])
    if (severity === 'flag') {
      onChange({
        ...audit,
        review: {
          ...audit.review,
          flagged: true,
          flaggedAt: next.createdAt,
          flaggedBy: next.authorId,
          flaggedByName: next.authorName,
        },
        flagCount: audit.flagCount + 1,
        commentCount: audit.commentCount + 1,
      })
      // Offer a 10-second undo. Tracked locally; clearing flag deletes the
      // comment + clears the root flag mirror.
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
      const expiresAt = Date.now() + 10_000
      setUndoFlag({ commentId: next.id, expiresAt })
      undoTimerRef.current = window.setTimeout(() => {
        setUndoFlag(null)
        undoTimerRef.current = null
      }, 10_000)
    } else {
      onChange({ ...audit, commentCount: audit.commentCount + 1 })
    }
  }

  const undoLastFlag = async () => {
    if (!undoFlag) return
    const target = comments.find((c) => c.id === undoFlag.commentId)
    if (!target) return
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setUndoFlag(null)
    setComments((prev) => prev.filter((c) => c.id !== target.id))
    onChange({
      ...audit,
      commentCount: Math.max(0, audit.commentCount - 1),
      flagCount: Math.max(0, audit.flagCount - 1),
      review: {
        ...audit.review,
        flagged: false,
        flaggedAt: undefined,
        flaggedBy: undefined,
        flaggedByName: undefined,
      },
    })
    try {
      await deleteShiftComment(shift.id, target.id)
      await clearShiftFlag(token, shift.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not undo flag.')
    }
  }

  useEffect(
    () => () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
    },
    [],
  )

  const handleDeleteComment = async (id: string) => {
    const wasFlag = comments.find((c) => c.id === id)?.severity === 'flag'
    setComments((prev) => prev.filter((c) => c.id !== id))
    onChange({
      ...audit,
      commentCount: Math.max(0, audit.commentCount - 1),
      flagCount: Math.max(0, audit.flagCount - (wasFlag ? 1 : 0)),
    })
    try {
      await deleteShiftComment(shift.id, id)
    } catch {
      /* swallow — list is now optimistic; a refresh will reconcile */
    }
  }

  const toggleReviewed = async () => {
    const next = !review.reviewedAt
    try {
      const updated = await setShiftReviewed(token, shift.id, next)
      onChange({ ...audit, review: { ...audit.review, ...updated } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update review state.')
    }
  }

  const clearFlag = async () => {
    try {
      await clearShiftFlag(token, shift.id)
      onChange({
        ...audit,
        review: {
          ...audit.review,
          flagged: false,
          flaggedAt: undefined,
          flaggedBy: undefined,
          flaggedByName: undefined,
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear flag.')
    }
  }

  // ── Force-close (Owner / Admin) ────────────────────────────────────────
  // The merged-cluster cleanup path: stale shift docs that never got a
  // settlement (the May-11 residue) can be closed in bulk with ₹0 amounts
  // and an audit reason. A single un-settled shift can also be closed
  // here when the cashier is unreachable. Popup styled per impeccable
  // (no native dialogs).
  const [forceCloseTargets, setForceCloseTargets] = useState<ShiftRecord[]>([])
  const [forceCloseReason, setForceCloseReason] = useState('')
  const [forceCloseAmounts, setForceCloseAmounts] = useState({ cash: '0', card: '0', upi: '0' })
  const [forceCloseSubmitting, setForceCloseSubmitting] = useState(false)
  const [forceCloseError, setForceCloseError] = useState<string | null>(null)
  const [forceCloseDone, setForceCloseDone] = useState<{ ok: number; failed: number } | null>(null)

  // The single canonical shift an Owner closes on behalf of the cashier.
  // Per the operating model — one location = one checkout per day — only
  // ONE shift in a merged cluster needs a settlement; the others are
  // login artifacts. We target the LONGEST unsettled sub-shift (covers
  // most of the cashier's actual time at the till), or the primary if
  // this row isn't a merge. Falls to null when everything is already
  // settled — the Force-close button hides in that case.
  const canonicalCloseTarget = useMemo<ShiftRecord | null>(() => {
    const subs = audit.subShifts && audit.subShifts.length > 1
      ? audit.subShifts.map((s) => s.shift)
      : [audit.shift]
    const unsettled = subs.filter((s) => !s.settlement)
    if (unsettled.length === 0) return null
    const durationMs = (s: ShiftRecord) => {
      const start = new Date(s.startTime).getTime()
      const end = s.endTime ? new Date(s.endTime).getTime() : Date.now()
      return Number.isFinite(end - start) ? end - start : 0
    }
    return [...unsettled].sort((a, b) => durationMs(b) - durationMs(a))[0]
  }, [audit])

  const openForceClose = (targets: ShiftRecord[]) => {
    setForceCloseTargets(targets)
    setForceCloseReason('')
    // Bulk default: ₹0 across all targets (typical for noise shifts).
    // Single default: ₹0 too — Owner edits if there were real takings.
    setForceCloseAmounts({ cash: '0', card: '0', upi: '0' })
    setForceCloseError(null)
    setForceCloseDone(null)
  }

  const closeForceClose = () => {
    if (forceCloseSubmitting) return
    setForceCloseTargets([])
    setForceCloseReason('')
    setForceCloseError(null)
    setForceCloseDone(null)
  }

  const submitForceClose = async () => {
    const reason = forceCloseReason.trim()
    if (!reason || forceCloseTargets.length === 0) return
    const cash = Number(forceCloseAmounts.cash) || 0
    const card = Number(forceCloseAmounts.card) || 0
    const upi = Number(forceCloseAmounts.upi) || 0
    setForceCloseSubmitting(true)
    setForceCloseError(null)
    try {
      // Bulk: every target gets the same settlement payload (typically ₹0
      // for the cluster-cleanup case). Single: only one target, full amounts.
      const settledAt = new Date().toISOString()
      const results = await Promise.allSettled(
        forceCloseTargets.map((target) =>
          shiftsApi.forceClose(
            token,
            target.id,
            {
              cashEntered: cash,
              cardEntered: card,
              upiEntered: upi,
              cashActual: cash,
              cardActual: card,
              upiActual: upi,
              settledAt,
              totalTransactions: target.settlement?.totalTransactions ?? 0,
              locationId: target.locationId,
            },
            reason,
          ),
        ),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - ok
      if (failed === 0) {
        logger.warn('daily_reports.shifts_force_closed', {
          count: ok,
          reason,
          shiftIds: forceCloseTargets.map((t) => t.id),
        })
      } else {
        logger.error(
          'daily_reports.shifts_force_close_partial',
          results.find((r) => r.status === 'rejected') as PromiseRejectedResult,
          { ok, failed, shiftIds: forceCloseTargets.map((t) => t.id) },
        )
      }
      setForceCloseDone({ ok, failed })
      if (failed === 0) {
        window.setTimeout(() => {
          closeForceClose()
          if (onRefresh) onRefresh()
          onClose()
        }, 1100)
      } else {
        setForceCloseError(
          `${failed} of ${results.length} shifts failed to close. Refresh and retry the rest.`,
        )
      }
    } catch (err) {
      logger.error('daily_reports.force_close_unexpected', err)
      setForceCloseError(err instanceof Error ? err.message : 'Could not force-close.')
    } finally {
      setForceCloseSubmitting(false)
    }
  }

  const totalDiff = fmtDiscrepancy(audit.totalDiff)

  return (
    <>
      <div
        className="dr-drawer-backdrop"
        role="presentation"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="dr-drawer"
        role="dialog"
        aria-label={`Shift detail · ${cashierName} at ${audit.branchDisplayName}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              {audit.branchDisplayName} · {fmtLongDate(shift.shiftDate)}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-text">{cashierName}</h2>
            <p className="text-xs text-muted dr-tabular">
              {fmtTime(shift.startTime)} → {isLive ? 'Active' : fmtTime(shift.endTime)} ·{' '}
              {fmtDuration(shift.startTime, shift.endTime)}
              {shift.settlement?.totalTransactions !== undefined && (
                <> · {shift.settlement.totalTransactions} transactions</>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:text-text hover:bg-surface"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Status banners */}
          {review.flagged && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-critical/40 bg-critical/10 px-3 py-2.5">
              <Flag className="mt-0.5 h-4 w-4 text-critical" />
              <div className="flex-1 text-sm">
                <p className="font-semibold text-critical">Flagged for review</p>
                {review.flaggedByName && (
                  <p className="text-xs text-muted">
                    Raised by {review.flaggedByName}
                    {review.flaggedAt ? ` · ${fmtTime(review.flaggedAt)}` : ''}
                  </p>
                )}
              </div>
              {canModerate && (
                <button
                  type="button"
                  onClick={() => void clearFlag()}
                  className="rounded-md border border-border bg-panel px-2 py-1 text-[11px] font-semibold text-muted transition-colors hover:text-text"
                >
                  Clear flag
                </button>
              )}
            </div>
          )}

          {review.reviewedAt && !review.flagged && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              <ShieldCheck className="h-4 w-4" />
              <span>
                Reviewed {review.reviewedByName ? `by ${review.reviewedByName}` : ''}
                {review.reviewedAt ? ` · ${fmtTime(review.reviewedAt)}` : ''}
              </span>
            </div>
          )}

          {/* Settlement breakdown */}
          <section className="rounded-2xl border border-border bg-panel p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Settlement
              </h3>
              <span className="text-[11px] uppercase tracking-wider text-muted">
                Entered · Actual · Diff
              </span>
            </div>

            <div className="grid grid-cols-[110px_1fr_1fr_1fr] gap-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted/70">
              <div />
              <div className="text-right">Entered</div>
              <div className="text-right">Actual</div>
              <div className="text-right">Diff</div>
            </div>

            <Row
              label="Cash"
              entered={audit.cash.entered}
              actual={audit.cash.actual}
              diff={audit.cash.diff}
              isLive={isLive}
            />
            <Row
              label="Card"
              entered={audit.card.entered}
              actual={audit.card.actual}
              diff={audit.card.diff}
              isLive={isLive}
            />
            <Row
              label="UPI"
              entered={audit.upi.entered}
              actual={audit.upi.actual}
              diff={audit.upi.diff}
              isLive={isLive}
            />
            <div className="mt-2.5 grid grid-cols-[110px_1fr_1fr_1fr] items-baseline gap-3 border-t border-border pt-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text">
                Total
              </div>
              <div className="dr-tabular text-right text-sm font-semibold text-text">
                {fmtRupees(audit.totalEntered)}
              </div>
              <div className="dr-tabular text-right text-sm font-semibold text-muted">
                {isLive ? '—' : fmtRupees(audit.totalActual)}
              </div>
              <div className={`dr-tabular text-right text-base font-bold dr-${totalDiff.tone}`}>
                {isLive ? '—' : totalDiff.text}
              </div>
            </div>
          </section>

          {/* Sub-shifts — only when the row is a merge of multiple
              same-day check-in / check-out attempts. Lists each underlying
              shift doc so the Owner can verify which attempt carried
              transactions vs. which were no-op artifacts. Per-row diff
              column reuses the same tone tokens as the ledger. */}
          {audit.subShifts && audit.subShifts.length > 1 ? (
            <section className="mt-5 rounded-2xl border border-border bg-panel p-4">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
                  Merged check-ins
                </h3>
                <span className="dr-tabular text-[11px] uppercase tracking-wider text-muted">
                  {audit.subShifts.length} attempts
                </span>
              </div>
              <p className="mb-3 text-[11px] text-muted">
                Multiple shift records for this cashier on this day are rolled into the totals
                above. Each row below is one Firestore doc — the audit trail is intact.
              </p>
              <ol className="dr-tabular space-y-1.5 text-[12px]">
                {audit.subShifts.map((sub, idx) => {
                  const subDiff = fmtDiscrepancy(sub.totalDiff)
                  const subLive = !sub.shift.endTime
                  const txnCount = sub.shift.settlement?.totalTransactions
                  const subForced = Boolean(sub.shift.forceClosedAt)
                  return (
                    <li
                      key={sub.shift.id}
                      className="grid grid-cols-[28px_1fr_auto] items-baseline gap-3 rounded-md border border-border/40 bg-base/40 px-2.5 py-1.5"
                    >
                      <span className="text-[10px] font-semibold text-muted">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 truncate text-text">
                        {fmtTime(sub.shift.startTime)} → {subLive ? 'Active' : fmtTime(sub.shift.endTime)}
                        <span className="ml-1.5 text-muted">
                          · {fmtDuration(sub.shift.startTime, sub.shift.endTime)}
                          {txnCount !== undefined ? ` · ${txnCount} txn` : ''}
                          {subForced ? ' · force-closed' : ''}
                        </span>
                      </span>
                      <span className={`text-right font-semibold dr-${subDiff.tone}`}>
                        {subLive ? '—' : subDiff.text}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </section>
          ) : null}

          {/* Comments */}
          <section className="mt-5">
            <h3 className="mb-2.5 text-sm font-semibold uppercase tracking-wider text-muted">
              Audit notes ({comments.length})
            </h3>
            {error && (
              <p className="mb-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-xs text-critical">
                {error}
              </p>
            )}
            {loading ? (
              <div className="dr-skeleton h-20 w-full" />
            ) : (
              <CommentThread
                comments={comments}
                currentUserId={currentUserId}
                canDelete
                onDelete={(id) => void handleDeleteComment(id)}
              />
            )}
            <div className="mt-3">
              <CommentComposer
                onSubmit={handleAddComment}
                canFlag={canModerate}
                shiftOwnerName={cashierName}
              />
            </div>
          </section>
        </div>

        {undoFlag ? (
          <div role="status" className="absolute bottom-20 left-1/2 -translate-x-1/2 transform">
            <div className="flex items-center gap-3 rounded-full border border-critical/40 bg-base/95 px-3 py-1.5 text-xs shadow-panel">
              <Flag className="h-3 w-3 text-critical" />
              <span className="text-text">Flag posted.</span>
              <button
                type="button"
                onClick={() => void undoLastFlag()}
                className="inline-flex items-center gap-1 rounded-md border border-critical/50 px-2 py-0.5 text-[11px] font-semibold text-critical transition-colors hover:bg-critical/10"
              >
                <Undo2 className="h-3 w-3" />
                Undo
              </button>
            </div>
          </div>
        ) : null}

        <footer className="flex items-center justify-between gap-2 border-t border-border bg-base/30 px-5 py-3">
          <div className="flex items-center gap-1.5">
            {!isLive && (
              <button
                type="button"
                onClick={() => onPrint(audit)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12px] font-semibold text-text transition-colors hover:border-text/30"
              >
                <Printer className="h-3.5 w-3.5" />
                Re-print
              </button>
            )}
            {onExportPdf && !isLive && canModerate && (
              <button
                type="button"
                onClick={() => onExportPdf(audit)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:text-text hover:border-text/30"
              >
                <Download className="h-3.5 w-3.5" />
                PDF
              </button>
            )}
            {canModerate && canonicalCloseTarget && (
              <button
                type="button"
                onClick={() => openForceClose([canonicalCloseTarget])}
                title="One settlement closes this location's day — the other login attempts collapse into the merged view."
                className="inline-flex items-center gap-1.5 rounded-lg border border-critical/45 bg-critical/10 px-3 py-1.5 text-[12px] font-semibold text-critical transition-colors hover:bg-critical/15"
              >
                <Lock className="h-3.5 w-3.5" />
                Force close
              </button>
            )}
          </div>

          {canModerate && !isLive && (
            <button
              type="button"
              onClick={() => void toggleReviewed()}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                review.reviewedAt
                  ? 'border border-success/50 bg-success/10 text-success hover:bg-success/15'
                  : 'bg-text text-base hover:bg-text/90'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {review.reviewedAt ? 'Reviewed · clear' : 'Mark reviewed'}
            </button>
          )}
        </footer>
      </aside>

      {/* ── Force-close Popup ──────────────────────────────────────────────
          Auditor-register confirmation surface. Single-target shows full
          amount inputs (Owner closing on behalf of an unreachable cashier
          who had real takings); multi-target collapses to one shared set
          of inputs that defaults to ₹0 (typical for the merged-cluster
          noise-shift cleanup). Mandatory reason; all force-closes are
          stamped with the Owner's identity on the underlying shift doc. */}
      {forceCloseTargets.length > 0 ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-base/75 px-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="force-close-title"
            className="w-full max-w-md rounded-xl border border-critical/40 bg-panel p-6 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-critical/15 text-critical"
              >
                <Lock className="h-4 w-4" />
              </span>
              <div className="flex-1">
                <h2 id="force-close-title" className="text-base font-semibold text-text">
                  Close location for the day
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {cashierName} · {audit.branchDisplayName} · {fmtLongDate(audit.shift.shiftDate)}
                  {forceCloseTargets.length > 0
                    ? ` · settling shift started at ${fmtTime(forceCloseTargets[0].startTime)}.`
                    : '.'}
                  {audit.subShifts && audit.subShifts.length > 1
                    ? ` This cashier has ${audit.subShifts.length} check-in attempts on this day — one settlement is enough; the other logins stay as session artifacts and roll into the merged view.`
                    : ' The cashier did not submit a settlement; closing on their behalf is logged with your name.'}
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {(['cash', 'card', 'upi'] as const).map((method) => (
                <label key={method} className="block">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {method === 'upi' ? 'UPI' : method[0].toUpperCase() + method.slice(1)}
                  </span>
                  <div className="dr-tabular mt-1 flex items-center rounded-lg border border-border/70 bg-base px-2 py-1.5 text-sm text-text focus-within:border-critical/60 focus-within:ring-2 focus-within:ring-critical/30">
                    <span className="mr-1 text-muted">₹</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={forceCloseAmounts[method]}
                      onChange={(e) =>
                        setForceCloseAmounts((prev) => ({ ...prev, [method]: e.target.value }))
                      }
                      disabled={forceCloseSubmitting || Boolean(forceCloseDone)}
                      className="w-full bg-transparent outline-none"
                    />
                  </div>
                </label>
              ))}
            </div>

            <label
              htmlFor="force-close-reason"
              className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              Reason for force close
            </label>
            <textarea
              id="force-close-reason"
              value={forceCloseReason}
              onChange={(e) => setForceCloseReason(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  if (forceCloseReason.trim() && !forceCloseSubmitting) void submitForceClose()
                }
                if (e.key === 'Escape' && !forceCloseSubmitting) closeForceClose()
              }}
              rows={3}
              placeholder="e.g. Cashier unreachable; noise shifts from the 2026-05-11 check-out bug."
              disabled={forceCloseSubmitting || Boolean(forceCloseDone)}
              className="mt-2 w-full rounded-lg border border-border/70 bg-base px-3 py-2 text-sm text-text placeholder:text-muted focus:border-critical/60 focus:outline-none focus:ring-2 focus:ring-critical/30 disabled:opacity-60"
            />

            <p className="mt-2 font-mono text-[11px] tabular-nums text-muted">
              Signed: Owner action · stamps `forceClosedBy`, `forceClosedAt`, reason on every doc.
            </p>

            {forceCloseError ? (
              <p className="mt-3 rounded-md border border-critical/45 bg-critical/10 px-3 py-2 text-xs text-critical">
                {forceCloseError}
              </p>
            ) : null}

            {forceCloseDone ? (
              <p
                className={`mt-3 rounded-md border px-3 py-2 text-xs ${
                  forceCloseDone.failed === 0
                    ? 'border-success/45 bg-success/10 text-success'
                    : 'border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                }`}
              >
                {forceCloseDone.failed === 0
                  ? `Closed ${forceCloseDone.ok} shift${forceCloseDone.ok === 1 ? '' : 's'}. Refreshing…`
                  : `Closed ${forceCloseDone.ok} of ${forceCloseDone.ok + forceCloseDone.failed}. The rest failed — refresh and retry.`}
              </p>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeForceClose}
                disabled={forceCloseSubmitting}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-text disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitForceClose()}
                disabled={
                  forceCloseSubmitting ||
                  Boolean(forceCloseDone) ||
                  !forceCloseReason.trim()
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-critical px-4 py-2 text-sm font-semibold text-base transition-colors hover:bg-critical/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Lock className="h-3.5 w-3.5" />
                {forceCloseSubmitting ? 'Closing…' : 'Close shift'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
