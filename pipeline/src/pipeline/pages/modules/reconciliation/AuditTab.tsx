import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AuditBookingRow,
  type AuditClassification,
  type AuditResult,
  type MisattributionPattern,
  type RefundCorrection,
  type VendorOption,
  acknowledgeAuditRow,
  acknowledgeExpectedRows,
  detectMisattributionPatterns,
  listAllVendorAudits,
  listVendorAudit,
  planAutoFix,
  revokeAuditAck,
  writeManualCreditAdjustment,
  writeManualDebitAdjustment,
} from '../../../api/reconciliation-firestore'

const AutoFixConfirmModal = lazy(() => import('./AutoFixConfirmModal'))
const PatternSwapModal = lazy(() => import('./PatternSwapModal'))
const MirrorBillingModal = lazy(() => import('./MirrorBillingModal'))
const RefundCorrectionAutoFixModal = lazy(() => import('./RefundCorrectionAutoFixModal'))

const currency = (n: number): string => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

const today = (): string => {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}
const daysAgo = (n: number): string => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const CLASSIFICATION_META: Record<
  AuditClassification,
  { label: string; tone: 'success' | 'warning' | 'critical' | 'info' | 'muted' }
> = {
  'trigger-correct': { label: 'OK · trigger correct', tone: 'success' },
  rounding: { label: 'OK · rounding', tone: 'success' },
  'refund-debit': { label: 'OK · refund debit', tone: 'success' },
  acknowledged: { label: 'OK · acknowledged', tone: 'muted' },
  'acknowledged-stale': { label: 'review · stale ack', tone: 'critical' },
  'bundle-discount': { label: 'expected · bundle discount', tone: 'warning' },
  'refund-correction': { label: 'expected · refund correction', tone: 'warning' },
  'unexplained-diff': { label: 'review · unexplained diff', tone: 'critical' },
  'missing-credit': { label: 'fix · missing credit', tone: 'critical' },
  'wrong-vendor-stamp': { label: 'fix · wrong vendor stamp', tone: 'critical' },
}

const TONE_CLASS: Record<string, string> = {
  success: 'border-success/40 text-success',
  warning: 'border-warning/40 text-warning',
  critical: 'border-critical/40 text-critical',
  info: 'border-info/40 text-info',
  muted: 'border-border/60 text-muted',
}

interface Props {
  vendors: VendorOption[]
  resolvedBy: { id: string; name: string }
  onOpenRefundReview: (bookingId: string, corrections: RefundCorrection[]) => void
  onOpenReattribute: (bookingId: string) => void
  /**
   * Open the resolver for any booking by ID — used by the "Open booking
   * by ID" input. Lets admin re-attribute bookings that don't appear in
   * audit / orphan / pattern views (e.g., fully-unattributed bookings
   * with empty vendorId everywhere).
   */
  onOpenById?: (bookingId: string) => void
  /**
   * Bump this number from the parent to force the current audit to re-run
   * (e.g., after the OrphanResolverModal applies a re-attribution and the
   * row classification needs to refresh).
   */
  refreshSignal?: number
}

export const AuditTab = ({
  vendors,
  resolvedBy,
  onOpenRefundReview,
  onOpenReattribute,
  onOpenById,
  refreshSignal,
}: Props) => {
  const [vendorFilter, setVendorFilter] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [result, setResult] = useState<AuditResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<
    'all' | 'fix' | 'review' | 'stale-ack' | 'acknowledged' | 'matched'
  >('all')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [showAutoFix, setShowAutoFix] = useState(false)
  const [showRefundCorrectionAutoFix, setShowRefundCorrectionAutoFix] = useState(false)
  const [showMirror, setShowMirror] = useState(false)
  // Sweep mode state — runs the audit for every visible vendor in parallel
  // and shows a master table. Click a row to drill into single-vendor view.
  const [mode, setMode] = useState<'single' | 'sweep'>('single')
  const [sweepResults, setSweepResults] = useState<Map<string, AuditResult>>(new Map())
  const [sweepFailures, setSweepFailures] = useState<Array<{ vendorId: string; error: string }>>([])
  const [sweepProgress, setSweepProgress] = useState<{ done: number; total: number } | null>(null)
  const [sweepError, setSweepError] = useState<string | null>(null)
  // Bulk-ack-expected state for the single-vendor view.
  const [ackBusy, setAckBusy] = useState(false)
  // Pattern detection state (cross-vendor stamp swaps).
  const [patterns, setPatterns] = useState<MisattributionPattern[]>([])
  const [patternsLoading, setPatternsLoading] = useState(false)
  const [activePattern, setActivePattern] = useState<MisattributionPattern | null>(null)
  // "Open booking by ID" — for bookings that don't surface in audit
  // (e.g., fully unattributed: no vendorId anywhere → no audit row).
  const [openByIdInput, setOpenByIdInput] = useState('')

  // Quick preview of how many rows the auto-fix run would touch — used to
  // gate the button (hidden when there's nothing to fix) and show a
  // "(N fixable)" hint without opening the modal.
  const autoFixPreview = useMemo(() => {
    if (!result) return null
    const plan = planAutoFix(result, { perRowCap: 5000, totalCap: 50000 })
    return {
      writeCredit: plan.counts.writeCredit,
      writeDebit: plan.counts.writeDebit,
      acknowledge: plan.counts.acknowledge,
      actionable: plan.rows.length - plan.counts.skip,
    }
  }, [result])

  const filteredVendors = (() => {
    const q = vendorFilter.trim().toLowerCase()
    if (!q) return vendors
    const tokens = q.split(/\s+/).filter(Boolean)
    return vendors.filter((v) => {
      const hay = `${v.name} ${v.branch} ${v.preferredActivity} ${v.id}`.toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
  })()

  const runAudit = useCallback(async () => {
    if (!vendorId) {
      setError('Pick a vendor first.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = await listVendorAudit(vendorId, from, to)
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run audit.')
    } finally {
      setLoading(false)
    }
  }, [vendorId, from, to])

  /**
   * Run audits for every vendor (or the filtered subset) in parallel.
   * Updates progress as each completes. Failures don't poison successes.
   */
  const runSweep = useCallback(async () => {
    const ids = filteredVendors.map((v) => v.id)
    if (ids.length === 0) {
      setSweepError('No vendors match the filter.')
      return
    }
    setSweepError(null)
    setSweepProgress({ done: 0, total: ids.length })
    try {
      const { results, failures } = await listAllVendorAudits(ids, from, to, (d, t) => {
        setSweepProgress({ done: d, total: t })
      })
      setSweepResults(results)
      setSweepFailures(failures)
    } catch (err) {
      setSweepError(err instanceof Error ? err.message : 'Sweep failed.')
    } finally {
      setSweepProgress(null)
    }
  }, [filteredVendors, from, to])

  const runPatternScan = useCallback(async () => {
    setPatternsLoading(true)
    try {
      const p = await detectMisattributionPatterns(from, to, vendors)
      setPatterns(p)
    } finally {
      setPatternsLoading(false)
    }
  }, [from, to, vendors])

  const ackExpectedClasses = async (
    classifications: AuditClassification[],
    label: string,
    reasonText: string,
  ) => {
    if (!result) return
    const targetCount = result.rows.filter((r) => classifications.includes(r.classification)).length
    if (targetCount === 0) return
    if (
      !window.confirm(
        `Acknowledge ${targetCount} ${label} row(s)?\n\nThis writes auditAcknowledged metadata only — no money moves. Each ack snapshots the current diff so the row auto-resurfaces if the underlying state changes.`,
      )
    ) {
      return
    }
    setAckBusy(true)
    try {
      const r = await acknowledgeExpectedRows(result, resolvedBy, reasonText, classifications)
      // Update local rows to reflect ack so UI doesn't need a re-run.
      setResult((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          rows: prev.rows.map((row) =>
            classifications.includes(row.classification)
              ? {
                  ...row,
                  classification: 'acknowledged',
                  classificationReason: `Bulk-ack · ${label} (diff at ack: ${row.diffLedgerVsVendorTotal})`,
                  acknowledged: {
                    by: resolvedBy.id,
                    byName: resolvedBy.name,
                    at: new Date().toISOString(),
                    reason: reasonText,
                    mismatchAmountAtAck: row.diffLedgerVsVendorTotal,
                  },
                }
              : row,
          ),
        }
      })
      if (r.failed.length > 0) {
        window.alert(
          `Acknowledged ${r.acknowledged}, but ${r.failed.length} failed:\n` +
            r.failed.map((f) => `${f.bookingId}: ${f.error}`).join('\n'),
        )
      }
    } finally {
      setAckBusy(false)
    }
  }

  const handleAckExpected = () =>
    ackExpectedClasses(
      ['bundle-discount', 'refund-correction'],
      'expected (bundle discount + refund correction)',
      'Bulk-ack · expected (bundle discount or refund correction)',
    )

  // "Ack as-is" — keep the residual drift, just record that it's expected.
  // Use only when the diff is intentional (company absorbed cost, goodwill, etc.).
  const handleAckRefundCorrection = () =>
    ackExpectedClasses(
      ['refund-correction'],
      'refund-correction (ack as-is, leaves residual drift)',
      'Bulk-ack · refund-correction · residual drift accepted as-is',
    )

  // "Auto-fix" — opens the RefundCorrectionAutoFixModal which shows every
  // planned correction (per-row credit/debit, per-row note, over-cap
  // skips, in-tolerance no-ops) before any write happens. Money MOVES on
  // the ledger when the user confirms inside the modal.
  const handleAutoFixRefundCorrection = () => {
    if (!result) return
    const targets = result.rows.filter((r) => r.classification === 'refund-correction')
    if (targets.length === 0) return
    setShowRefundCorrectionAutoFix(true)
  }

  const handleAckBundleDiscount = () =>
    ackExpectedClasses(
      ['bundle-discount'],
      'bundle-discount',
      'Bulk-ack · bundle-discount (configPrice ledger vs adjusted billing — company absorbs)',
    )

  // Re-run audit when parent bumps `refreshSignal`. We track the previous
  // value via a ref so the very first render (signal=undefined) doesn't
  // trigger an empty audit.
  const prevRefreshSignal = useRef(refreshSignal)
  useEffect(() => {
    if (prevRefreshSignal.current === refreshSignal) return
    prevRefreshSignal.current = refreshSignal
    if (vendorId && result) {
      void runAudit()
    }
  }, [refreshSignal, vendorId, result, runAudit])

  const updateRow = (bookingId: string, patch: Partial<AuditBookingRow>) => {
    setResult((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        rows: prev.rows.map((r) => (r.bookingId === bookingId ? { ...r, ...patch } : r)),
      }
    })
  }

  const handleAcknowledge = async (row: AuditBookingRow) => {
    if (!result) return
    const absDiff = Math.abs(row.diffLedgerVsVendorTotal)
    // Tier-based gating: large mismatches require an extra confirm step.
    if (absDiff >= 500) {
      const proceed = window.confirm(
        `LARGE MISMATCH: ₹${absDiff} on booking ${row.bookingId}.\n\n` +
          `Acknowledging instead of fixing will leave this drift in the ledger and the invoice.\n` +
          `Owner-level review recommended.\n\nContinue to enter a reason?`,
      )
      if (!proceed) return
    }
    const reason = window.prompt(
      `Acknowledge ₹${row.diffLedgerVsVendorTotal} drift on booking ${row.bookingId}.\n` +
        `Classification: ${row.classification}.\n` +
        `Why is this expected? (≥5 chars; saved with audit log + booking + invalidated automatically if drift moves)`,
      row.classificationReason,
    )
    if (!reason || reason.trim().length < 5) {
      if (reason !== null) window.alert('Acknowledgment reason must be at least 5 characters.')
      return
    }
    setBusyKey(row.bookingId)
    try {
      await acknowledgeAuditRow(
        row.bookingId,
        result.vendorId,
        reason,
        resolvedBy,
        row.diffLedgerVsVendorTotal,
      )
      updateRow(row.bookingId, {
        classification: 'acknowledged',
        classificationReason: `Marked expected (diff at ack: ${row.diffLedgerVsVendorTotal}). Current diff still matches.`,
        acknowledged: {
          by: resolvedBy.id,
          byName: resolvedBy.name,
          at: new Date().toISOString(),
          reason: reason.trim(),
          mismatchAmountAtAck: row.diffLedgerVsVendorTotal,
        },
      })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to acknowledge.')
    } finally {
      setBusyKey(null)
    }
  }

  const handleRevokeAck = async (row: AuditBookingRow) => {
    if (!result) return
    const proceed = window.confirm(
      `Revoke acknowledgment on ${row.bookingId}?\n\n` +
        `The row will return to its underlying classification (likely "${row.classification === 'acknowledged-stale' ? 'unexplained-diff' : 'unexplained-diff'}") and become a candidate for fix or re-acknowledgment.`,
    )
    if (!proceed) return
    setBusyKey(row.bookingId)
    try {
      await revokeAuditAck(row.bookingId, result.vendorId, resolvedBy)
      updateRow(row.bookingId, {
        classification: 'unexplained-diff',
        classificationReason: 'Acknowledgment revoked — row returned to active queue.',
        acknowledged: undefined,
      })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to revoke.')
    } finally {
      setBusyKey(null)
    }
  }

  const handleWriteMissingCredit = async (row: AuditBookingRow) => {
    if (!result) return
    const suggested = row.vendorTotalSum > 0 ? row.vendorTotalSum : 0
    const input = window.prompt(
      `WRITE CREDIT — Adds a manual_adjustment ledger row that increases ${result.vendorName}'s payable.\n\n` +
        `Use this when billingItems show the vendor earned money but the ledger has no matching credit (trigger never ran).\n` +
        `After this saves, the next cheque will include this amount.\n\n` +
        `Booking: ${row.bookingId}\n` +
        `Suggested (Σ vendorTotal from billingItems): ${currency(suggested)}\n\n` +
        `Enter amount in INR (or cancel):`,
      String(suggested),
    )
    if (!input) return
    const amount = Number(input)
    if (!Number.isFinite(amount) || amount <= 0) return
    const reason =
      window.prompt(
        `Reason for the manual credit (saved on the ledger row):`,
        'Missing credit — backfilled by audit',
      ) || 'Missing credit — backfilled by audit'
    setBusyKey(row.bookingId)
    try {
      await writeManualCreditAdjustment({
        bookingId: row.bookingId,
        vendorId: result.vendorId,
        amount,
        invoiceNumber: row.bookingId,
        locationId: row.branchId,
        date: row.date ? `${row.date}T12:00:00.000Z` : undefined,
        reason,
        resolvedBy,
      })
      updateRow(row.bookingId, {
        ledgerNet: row.ledgerNet + amount,
        diffLedgerVsVendorTotal: row.ledgerNet + amount - row.vendorTotalSum,
        classification: 'trigger-correct',
        classificationReason: 'Manual credit adjustment written.',
        ledgerEntries: [
          ...row.ledgerEntries,
          {
            id: `lc-manual-${row.bookingId}-${result.vendorId}`,
            type: 'credit',
            source: 'manual_adjustment',
            amount,
          },
        ],
      })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to write credit.')
    } finally {
      setBusyKey(null)
    }
  }

  const handleWriteDebit = async (row: AuditBookingRow) => {
    if (!result) return
    const overpaid = row.ledgerNet - row.vendorTotalSum
    const suggested = overpaid > 0 ? overpaid : 0
    const input = window.prompt(
      `WRITE DEBIT — Adds a manual_adjustment ledger row that REDUCES ${result.vendorName}'s payable.\n\n` +
        `Use this when the ledger has a credit the vendor should not have got (wrong vendor stamp, double-credit, captain freebie billed by mistake).\n` +
        `After this saves, the next cheque is reduced by this amount.\n\n` +
        `Booking: ${row.bookingId}\n` +
        `Ledger net: ${currency(row.ledgerNet)} · Σ vendorTotal: ${currency(row.vendorTotalSum)}\n` +
        `Suggested overpayment: ${currency(suggested)}\n\n` +
        `Enter amount in INR (or cancel):`,
      String(suggested),
    )
    if (!input) return
    const amount = Number(input)
    if (!Number.isFinite(amount) || amount <= 0) return
    const reason =
      window.prompt(
        `Reason for the debit (saved on the ledger row):`,
        'Wrong vendor stamp / overpayment — corrected by audit',
      ) || 'Wrong vendor stamp / overpayment — corrected by audit'
    setBusyKey(row.bookingId)
    try {
      await writeManualDebitAdjustment({
        bookingId: row.bookingId,
        vendorId: result.vendorId,
        amount,
        invoiceNumber: row.bookingId,
        locationId: row.branchId,
        date: row.date ? `${row.date}T12:00:00.000Z` : undefined,
        reason,
        resolvedBy,
      })
      updateRow(row.bookingId, {
        ledgerNet: row.ledgerNet - amount,
        diffLedgerVsVendorTotal: row.ledgerNet - amount - row.vendorTotalSum,
        classification: 'trigger-correct',
        classificationReason: 'Manual debit adjustment written.',
        ledgerEntries: [
          ...row.ledgerEntries,
          {
            id: `ld-manual-${row.bookingId}-${result.vendorId}`,
            type: 'debit',
            source: 'manual_adjustment',
            amount,
          },
        ],
      })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to write debit.')
    } finally {
      setBusyKey(null)
    }
  }

  const isFix = (c: AuditClassification) =>
    c === 'missing-credit' || c === 'wrong-vendor-stamp' || c === 'unexplained-diff'
  const isReview = (c: AuditClassification) => c === 'bundle-discount' || c === 'refund-correction'
  const isMatched = (c: AuditClassification) =>
    c === 'trigger-correct' || c === 'rounding' || c === 'refund-debit'
  const visibleRows = (() => {
    if (!result) return []
    if (filter === 'all') return result.rows
    if (filter === 'fix') return result.rows.filter((r) => isFix(r.classification))
    if (filter === 'review') return result.rows.filter((r) => isReview(r.classification))
    if (filter === 'stale-ack')
      return result.rows.filter((r) => r.classification === 'acknowledged-stale')
    if (filter === 'acknowledged')
      return result.rows.filter((r) => r.classification === 'acknowledged')
    if (filter === 'matched') return result.rows.filter((r) => isMatched(r.classification))
    return result.rows
  })()

  const fixCount = result ? result.rows.filter((r) => isFix(r.classification)).length : 0
  const reviewCount = result ? result.rows.filter((r) => isReview(r.classification)).length : 0
  const staleAckCount = result
    ? result.rows.filter((r) => r.classification === 'acknowledged-stale').length
    : 0
  const ackCount = result
    ? result.rows.filter((r) => r.classification === 'acknowledged').length
    : 0
  const matchedCount = result ? result.rows.filter((r) => isMatched(r.classification)).length : 0
  const cleanCount = matchedCount

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-panel px-3 py-2 text-xs">
        <span className="text-muted">Mode:</span>
        <button
          type="button"
          onClick={() => setMode('single')}
          className={`rounded-full px-3 py-0.5 ${
            mode === 'single' ? 'bg-info/20 text-info' : 'text-muted'
          }`}
        >
          Single vendor
        </button>
        <button
          type="button"
          onClick={() => setMode('sweep')}
          className={`rounded-full px-3 py-0.5 ${
            mode === 'sweep' ? 'bg-info/20 text-info' : 'text-muted'
          }`}
        >
          Sweep all vendors ({filteredVendors.length})
        </button>
        <span className="ml-auto text-[10px] text-muted">
          {mode === 'single'
            ? 'Audit one vendor at a time. Best for debugging a specific cheque.'
            : 'Run audits for every (filtered) vendor in parallel. Best for end-of-week cleanup.'}
        </span>
      </div>

      {/* Open booking by ID — bypasses audit / orphan list filters so any
          booking can be re-attributed regardless of how it's classified. */}
      {onOpenById ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-panel px-3 py-2 text-xs">
          <span className="text-muted">Re-attribute any booking by ID:</span>
          <input
            type="text"
            value={openByIdInput}
            onChange={(e) => setOpenByIdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && openByIdInput.trim()) {
                e.preventDefault()
                onOpenById(openByIdInput.trim())
                setOpenByIdInput('')
              }
            }}
            placeholder="ASG260330…"
            className="ui-field min-h-7 w-72 px-2 font-mono text-xs"
            aria-label="Open booking by ID"
          />
          <button
            type="button"
            onClick={() => {
              if (!openByIdInput.trim()) return
              onOpenById(openByIdInput.trim())
              setOpenByIdInput('')
            }}
            disabled={!openByIdInput.trim()}
            className="ui-btn ui-btn-neutral min-h-7 px-3 text-xs"
            title="Open the resolver for any booking, even if it has no vendor attribution and doesn't appear in audit / orphan / pattern views."
          >
            Open
          </button>
          <span className="text-[10px] text-muted">
            Use when a booking should credit a vendor but doesn't appear in any audit / orphan view
            (no vendorId stamped anywhere).
          </span>
        </div>
      ) : null}

      {/* Inputs */}
      <div className="rounded-2xl border border-border bg-panel p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_140px_auto]">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted">Vendor</label>
            <input
              type="text"
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              placeholder="Filter by name / branch / activity / phone"
              className="ui-field mb-1 min-h-7 w-full text-xs"
              aria-label="Filter vendors"
            />
            {mode === 'single' ? (
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="ui-field min-h-8 w-full text-sm"
                aria-label="Pick a vendor"
              >
                <option value="">— pick a vendor —</option>
                {filteredVendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    [{v.vendorType === 'SubLease' ? 'SL' : 'TP'}] {v.name}
                    {v.branch ? ` · ${v.branch}` : ''} · {v.id} · {v.revenueShare}%
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-muted">
                Sweep will run for the {filteredVendors.length} vendor
                {filteredVendors.length === 1 ? '' : 's'} matching your filter. Narrow with the
                filter above to scope.
              </p>
            )}
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="ui-field min-h-8 w-full text-sm"
              aria-label="From date"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="ui-field min-h-8 w-full text-sm"
              aria-label="To date"
            />
          </div>
          <div className="self-end">
            {mode === 'single' ? (
              <button
                type="button"
                onClick={() => void runAudit()}
                disabled={loading || !vendorId}
                className="ui-btn ui-btn-accent min-h-8 px-4 text-sm"
              >
                {loading ? 'Running…' : 'Run audit'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void runSweep()}
                disabled={!!sweepProgress || filteredVendors.length === 0}
                className="ui-btn ui-btn-accent min-h-8 px-4 text-sm"
              >
                {sweepProgress
                  ? `Running ${sweepProgress.done}/${sweepProgress.total}…`
                  : 'Run sweep'}
              </button>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </div>
      ) : null}

      {/* Pattern panel — visible in sweep mode. Detects vendor-stamp
          swaps using billingItems[] as truth, no fuzzy logic. */}
      {mode === 'sweep' ? (
        <div className="rounded-2xl border border-border bg-panel p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-text">Misattribution patterns</h3>
              <p className="text-[11px] text-muted">
                Cross-vendor stamp mismatches — bookings where the ledger credited the wrong vendor
                and billingItems[] proves the rightful one. Swap many bookings in one click.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runPatternScan()}
              disabled={patternsLoading}
              className="ui-btn ui-btn-neutral min-h-7 px-3 text-xs"
            >
              {patternsLoading ? 'Scanning…' : 'Scan for patterns'}
            </button>
          </div>
          {patterns.length === 0 && !patternsLoading ? (
            <p className="text-[11px] text-muted">
              No patterns detected (or scan not run yet). Click <strong>Scan for patterns</strong>{' '}
              after running a sweep to find recurring misattributions.
            </p>
          ) : null}
          {patterns.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-2 py-1 text-left">Catalog item</th>
                  <th className="px-2 py-1 text-left">Wrong vendor</th>
                  <th className="px-2 py-1 text-left">Right vendor</th>
                  <th className="px-2 py-1 text-right">Bookings</th>
                  <th className="px-2 py-1 text-right">Move</th>
                  <th className="px-2 py-1">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {patterns.map((p) => (
                  <tr key={p.key}>
                    <td className="px-2 py-1 font-mono text-[10px]">
                      {p.gameId}/{p.subGameId}/{p.variantId}
                      <div className="text-muted">@ branch {p.branchId}</div>
                    </td>
                    <td className="px-2 py-1">
                      <div className="text-warning">
                        {p.observedVendorName ?? p.observedVendorId}
                      </div>
                      <div className="font-mono text-[10px] text-muted">{p.observedVendorId}</div>
                    </td>
                    <td className="px-2 py-1">
                      <div className="text-success">
                        {p.expectedVendorName ?? p.expectedVendorId}
                      </div>
                      <div className="font-mono text-[10px] text-muted">{p.expectedVendorId}</div>
                    </td>
                    <td className="px-2 py-1 text-right font-semibold">{p.instances.length}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      {currency(p.totalExpectedCredit)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => setActivePattern(p)}
                        className="ui-btn ui-btn-accent min-h-7 px-2 py-0.5 text-[11px]"
                      >
                        Review & swap
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}

      {/* Sweep view (mode === 'sweep') */}
      {mode === 'sweep' ? (
        <SweepView
          results={sweepResults}
          failures={sweepFailures}
          progress={sweepProgress}
          error={sweepError}
          vendors={vendors}
          onDrillDown={(vid) => {
            setVendorId(vid)
            const r = sweepResults.get(vid)
            if (r) setResult(r)
            setMode('single')
          }}
        />
      ) : null}

      {/* Headline panel */}
      {mode === 'single' && result ? (
        <div className="rounded-2xl border border-border bg-panel p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-text">
                {result.vendorName} · {result.branch || '?'} · {result.vendorType} ·{' '}
                {result.sharePercent}%
              </h3>
              <p className="text-xs text-muted">
                {result.fromDate} to {result.toDate} · {result.rows.length} bookings
              </p>
            </div>
          </div>

          {/* SubLease vs ThirdParty share formula:
           *   ThirdParty: vendor gets share% of (base + gst) = share% of gross
           *   SubLease:   vendor gets share% of base only (no GST share);
           *               i.e. share% × (gross × 100/118) = gross × share/118.
           *
           * Without this branch, every panel's "× share%" preview applied
           * the ThirdParty formula universally, making SubLease vendors
           * look perpetually drifted in the C-D and D-(B×share%) panels
           * even when the books were correct. */}
          {(() => {
            const isSubLease = result.vendorType === 'SubLease'
            const shareDivisor = isSubLease ? 118 : 100
            const shareLabel = isSubLease
              ? `× ${result.sharePercent}% × base/gross`
              : `× ${result.sharePercent}%`
            const expectedFromBilling = Math.round(
              (result.totalGrossBilling * result.sharePercent) / shareDivisor,
            )
            const expectedFromItems = Math.round(
              (result.totalGrossItems * result.sharePercent) / shareDivisor,
            )
            const cMinusD = result.totalVendorTotalSum - result.totalLedgerNet
            const dMinusBShare = result.totalLedgerNet - expectedFromBilling
            return (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Card label={`A · Gross from items[]`} value={currency(result.totalGrossItems)}>
                    {shareLabel} = <strong>{currency(expectedFromItems)}</strong>
                  </Card>
                  <Card
                    label={`B · Gross from billingItems[]`}
                    value={currency(result.totalGrossBilling)}
                  >
                    {shareLabel} = <strong>{currency(expectedFromBilling)}</strong>{' '}
                    <span className="text-muted">
                      ({isSubLease ? 'SubLease: base × share%' : 'Game Revenue page'})
                    </span>
                  </Card>
                  <Card
                    label={`C · Σ billingItems[].vendorTotal`}
                    value={currency(result.totalVendorTotalSum)}
                  >
                    <span className="text-muted">
                      per-item splits trigger writes
                      {isSubLease ? ' (SubLease: vendorGst always 0)' : ''}
                    </span>
                  </Card>
                  <Card label={`D · Vendor Ledger net`} value={currency(result.totalLedgerNet)}>
                    {currency(result.totalLedgerCredits)} credits −{' '}
                    {currency(result.totalLedgerDebits)} debits
                  </Card>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-surface p-2 text-xs">
                    <div className="font-semibold">C − D · per-item sum vs ledger</div>
                    <div
                      className={`text-lg font-semibold ${Math.abs(cMinusD) <= 2 ? 'text-success' : 'text-warning'}`}
                    >
                      {currency(cMinusD)}
                    </div>
                    <div className="text-muted">
                      non-zero = manual adjustments / refund corrections / drift
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-surface p-2 text-xs">
                    <div className="font-semibold">
                      D − ({shareLabel}) ·{' '}
                      {isSubLease ? 'cheque vs base × share%' : 'cheque vs Game Revenue'}
                    </div>
                    <div
                      className={`text-lg font-semibold ${
                        Math.abs(dMinusBShare) <= 5 ? 'text-success' : 'text-warning'
                      }`}
                    >
                      {currency(dMinusBShare)}
                    </div>
                    <div className="text-muted">
                      {isSubLease
                        ? 'non-zero = ledger has GST share that SubLease shouldn’t get'
                        : 'non-zero = bundle discounts + rounding + refund debits'}
                    </div>
                  </div>
                </div>
              </>
            )
          })()}

          {/* Ledger source breakdown */}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted">
              Ledger composition ({result.ledgerSourceBreakdown.length} sources)
            </summary>
            <table className="mt-1 w-full text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 py-1 text-left">type / source</th>
                  <th className="px-2 py-1 text-right">count</th>
                  <th className="px-2 py-1 text-right">net total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {result.ledgerSourceBreakdown.map((s) => (
                  <tr key={s.key}>
                    <td className="px-2 py-1 font-mono">{s.key}</td>
                    <td className="px-2 py-1 text-right">{s.count}</td>
                    <td className="px-2 py-1 text-right">{currency(s.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ) : null}

      {/* Per-booking table */}
      {mode === 'single' && result ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-panel">
          <details className="border-b border-border/60 bg-surface/60 px-4 py-2 text-xs">
            <summary className="cursor-pointer font-semibold text-muted">
              What do these actions do?
            </summary>
            <ul className="mt-2 space-y-1 text-muted">
              <li>
                <strong className="text-text">Write credit</strong> — adds a manual_adjustment
                ledger row that <em>increases</em> the vendor's payable. Use for{' '}
                <code>missing-credit</code> rows where billingItems show earnings but ledger has no
                entry.
              </li>
              <li>
                <strong className="text-text">Write debit</strong> — adds a manual_adjustment ledger
                row that <em>reduces</em> the vendor's payable. Use for{' '}
                <code>wrong-vendor-stamp</code> or unexplained over-credits.
              </li>
              <li>
                <strong className="text-text">Refund review</strong> — opens the per-booking refund
                inspector. Use for <code>refund-correction</code> rows to fix which items were
                actually refunded.
              </li>
              <li>
                <strong className="text-text">Re-attribute</strong> — opens the booking item-by-item
                so you can re-pick the vendor / activity / pro-rate. Use for{' '}
                <code>wrong-vendor-stamp</code>, <code>unexplained-diff</code>, or{' '}
                <code>bundle-discount</code> rows where the items themselves need fixing.
              </li>
              <li>
                <strong className="text-text">Acknowledge</strong> — marks the diff as expected
                (with a written reason). Use for genuine discounts / freebies you don't want to see
                again.
              </li>
            </ul>
          </details>
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-surface px-4 py-2 text-xs">
            <span className="text-muted">Show:</span>
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded-full px-2 py-0.5 ${filter === 'all' ? 'bg-info/20 text-info' : 'text-muted'}`}
            >
              All ({result.rows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('fix')}
              className={`rounded-full px-2 py-0.5 ${filter === 'fix' ? 'bg-critical/20 text-critical' : 'text-muted'}`}
            >
              Needs fix ({fixCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('review')}
              className={`rounded-full px-2 py-0.5 ${filter === 'review' ? 'bg-warning/20 text-warning' : 'text-muted'}`}
            >
              Review ({reviewCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('stale-ack')}
              className={`rounded-full px-2 py-0.5 ${filter === 'stale-ack' ? 'bg-critical/20 text-critical' : staleAckCount > 0 ? 'text-critical' : 'text-muted'}`}
              title="Acknowledgments where the underlying diff has changed since the ack was made. The world moved — re-review or re-acknowledge."
            >
              ❌ Stale ack ({staleAckCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('acknowledged')}
              className={`rounded-full px-2 py-0.5 ${filter === 'acknowledged' ? 'bg-info/20 text-info' : 'text-muted'}`}
              title="Marked expected by an admin and the diff hasn't moved since. Click a row to revoke if needed."
            >
              🟡 Acked ({ackCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('matched')}
              className={`rounded-full px-2 py-0.5 ${filter === 'matched' ? 'bg-success/20 text-success' : 'text-muted'}`}
              title="trigger-correct + rounding + refund-debit — within ±₹2 tolerance. No action needed."
            >
              ✅ Matched ({matchedCount})
            </button>
            <span className="text-muted">·</span>
            <span className="text-success">{cleanCount} clean</span>
            <span className="ml-auto" />
            {(() => {
              const refundCount = result.rows.filter(
                (r) => r.classification === 'refund-correction',
              ).length
              const bundleCount = result.rows.filter(
                (r) => r.classification === 'bundle-discount',
              ).length
              const both = refundCount + bundleCount
              return (
                <>
                  {refundCount > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleAutoFixRefundCorrection()}
                        disabled={ackBusy}
                        className="ui-btn ui-btn-accent min-h-7 px-3 py-0.5 text-xs"
                        title={`MOVES MONEY: writes a corrective ledger row for each refund-correction booking sized to close the residual gap, then acks at diff=0. Per-row cap ₹2,000.`}
                      >
                        {ackBusy
                          ? '…'
                          : `Auto-fix refund-correction (${refundCount}) — moves money`}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAckRefundCorrection()}
                        disabled={ackBusy}
                        className="ui-btn ui-btn-neutral min-h-7 px-3 py-0.5 text-xs"
                        title={`No money moves. Acknowledges each refund-correction row at its CURRENT diff value — the residual drift stays on the ledger and invoice. Use only when the gap is intentional (company absorbing cost, goodwill, etc.).`}
                      >
                        {ackBusy ? '…' : `Ack as-is (${refundCount})`}
                      </button>
                    </>
                  ) : null}
                  {bundleCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => void handleAckBundleDiscount()}
                      disabled={ackBusy}
                      className="ui-btn ui-btn-neutral min-h-7 px-3 py-0.5 text-xs"
                      title={`Acknowledge ${bundleCount} bundle-discount row(s) — config-price vs paid-price absorbed by company.`}
                    >
                      {ackBusy ? '…' : `Ack bundle-discount (${bundleCount})`}
                    </button>
                  ) : null}
                  {both > 1 && refundCount > 0 && bundleCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => void handleAckExpected()}
                      disabled={ackBusy}
                      className="ui-btn ui-btn-neutral min-h-7 px-3 py-0.5 text-xs"
                      title={`Acknowledge BOTH bundle-discount and refund-correction rows in one click (${both} total).`}
                    >
                      {ackBusy ? '…' : `Ack all expected (${both})`}
                    </button>
                  ) : null}
                </>
              )
            })()}
            <button
              type="button"
              onClick={() => setShowMirror(true)}
              className="ui-btn ui-btn-neutral min-h-7 px-3 py-0.5 text-xs"
              title="Run the Mirror billingItems → items fix on every booking in this audit. Cleans up empty gameId/subGameId/variantId/vendorId on items[] using the multi-source truth cascade (combo doc, event package, catalog). No money moves."
            >
              Fix item IDs ({result.rows.length})
            </button>
            {autoFixPreview && autoFixPreview.actionable > 0 ? (
              <button
                type="button"
                onClick={() => setShowAutoFix(true)}
                className="ui-btn ui-btn-accent min-h-7 px-3 py-0.5 text-xs"
                title={`Open the auto-fix preview. Will write ${autoFixPreview.writeCredit} credits, ${autoFixPreview.writeDebit} debits, and acknowledge ${autoFixPreview.acknowledge} rows. Unexplained-diff rows are never auto-fixed.`}
              >
                Auto-fix all ({autoFixPreview.actionable})
              </button>
            ) : null}
          </div>

          <table className="w-full text-xs">
            <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Booking</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-right">Σ vendorTotal</th>
                <th className="px-3 py-2 text-right">Ledger</th>
                <th className="px-3 py-2 text-right">Diff (D−C)</th>
                <th className="px-3 py-2 text-left">Classification</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {visibleRows.map((row) => {
                const meta = CLASSIFICATION_META[row.classification]
                return (
                  <RowGroup
                    key={row.bookingId}
                    row={row}
                    meta={meta}
                    sharePercent={result?.sharePercent ?? 0}
                    vendorType={result?.vendorType ?? 'ThirdParty'}
                    busy={busyKey === row.bookingId}
                    onAcknowledge={() => void handleAcknowledge(row)}
                    onRevokeAck={() => void handleRevokeAck(row)}
                    onWriteMissingCredit={() => void handleWriteMissingCredit(row)}
                    onWriteDebit={() => void handleWriteDebit(row)}
                    onOpenRefundReview={() => onOpenRefundReview(row.bookingId, [])}
                    onOpenReattribute={() => onOpenReattribute(row.bookingId)}
                  />
                )
              })}
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted">
                    No rows in this view.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        mode === 'single' &&
        !loading && (
          <p className="text-xs text-muted">
            Pick a vendor and click <strong>Run audit</strong> to compare ledger, billingItems, and
            Game Revenue side-by-side for the period.
          </p>
        )
      )}

      {showAutoFix && result ? (
        <Suspense fallback={null}>
          <AutoFixConfirmModal
            result={result}
            resolvedBy={resolvedBy}
            onClose={() => setShowAutoFix(false)}
            onApplied={() => {
              // Re-run the audit after a successful auto-fix so the
              // headline numbers and per-row classifications refresh.
              void runAudit()
            }}
          />
        </Suspense>
      ) : null}

      {activePattern ? (
        <Suspense fallback={null}>
          <PatternSwapModal
            pattern={activePattern}
            resolvedBy={resolvedBy}
            onClose={() => setActivePattern(null)}
            onApplied={() => {
              // Refresh patterns + sweep so the swapped pattern disappears.
              void runPatternScan()
            }}
          />
        </Suspense>
      ) : null}

      {showMirror && result ? (
        <Suspense fallback={null}>
          <MirrorBillingModal
            resolvedBy={resolvedBy}
            scopedBookingIds={result.rows.map((r) => r.bookingId)}
            scopeLabel={`${result.vendorName} · ${result.fromDate} to ${result.toDate}`}
            onClose={() => setShowMirror(false)}
            onApplied={() => {
              // Re-run the audit so the headline numbers + classifications
              // refresh — items[] just got new gameIds, which feeds the
              // audit's vendor matching.
              void runAudit()
            }}
          />
        </Suspense>
      ) : null}

      {showRefundCorrectionAutoFix && result ? (
        <Suspense fallback={null}>
          <RefundCorrectionAutoFixModal
            result={result}
            resolvedBy={resolvedBy}
            onClose={() => setShowRefundCorrectionAutoFix(false)}
            onApplied={() => {
              // Refresh the audit so reconciled rows reclassify and the
              // bucket counts at the top update.
              void runAudit()
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

const Card = ({
  label,
  value,
  children,
}: {
  label: string
  value: React.ReactNode
  children: React.ReactNode
}) => (
  <div className="rounded-lg border border-border/60 bg-surface p-2">
    <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
    <p className="font-semibold text-text">{value}</p>
    <p className="text-[10px] text-muted">{children}</p>
  </div>
)

const SweepView = ({
  results,
  failures,
  progress,
  error,
  vendors,
  onDrillDown,
}: {
  results: Map<string, AuditResult>
  failures: Array<{ vendorId: string; error: string }>
  progress: { done: number; total: number } | null
  error: string | null
  vendors: VendorOption[]
  onDrillDown: (vendorId: string) => void
}) => {
  const rows = [...results.values()].map((r) => {
    const counts = {
      missingCredit: 0,
      wrongVendorStamp: 0,
      unexplainedDiff: 0,
      bundleDiscount: 0,
      refundCorrection: 0,
      acknowledged: 0,
      ok: 0,
    }
    for (const row of r.rows) {
      switch (row.classification) {
        case 'missing-credit':
          counts.missingCredit++
          break
        case 'wrong-vendor-stamp':
          counts.wrongVendorStamp++
          break
        case 'unexplained-diff':
          counts.unexplainedDiff++
          break
        case 'bundle-discount':
          counts.bundleDiscount++
          break
        case 'refund-correction':
          counts.refundCorrection++
          break
        case 'acknowledged':
          counts.acknowledged++
          break
        default:
          counts.ok++
      }
    }
    const fixCount = counts.missingCredit + counts.wrongVendorStamp + counts.unexplainedDiff
    const ackCount = counts.bundleDiscount + counts.refundCorrection
    // SubLease vendors are credited at `base × share%` (no GST share),
    // ThirdParty at `gross × share%`. Use the right divisor so the
    // "Cheque vs revenue" delta reflects what the vendor was actually
    // entitled to — comparing SubLease ledger against `gross × share%`
    // would always overstate the expected credit by GST/(1+GST), which
    // was the source of the false positive drift on Teja, BADIREDDY,
    // Prathyusha and the other SubLease rows.
    const subLeaseFactor = r.vendorType === 'SubLease' ? 1.18 : 1
    const netGap =
      r.totalLedgerNet - Math.round((r.totalGrossBilling * r.sharePercent) / 100 / subLeaseFactor)
    return { result: r, counts, fixCount, ackCount, netGap }
  })
  rows.sort((a, b) => b.fixCount - a.fixCount || Math.abs(b.netGap) - Math.abs(a.netGap))

  if (progress) {
    return (
      <div className="rounded-2xl border border-info/40 bg-info/5 px-4 py-6">
        <p className="mb-2 text-sm font-semibold text-info">
          Running sweep · {progress.done} / {progress.total} vendors complete
        </p>
        <div className="h-2 overflow-hidden rounded bg-surface">
          <div
            className="h-full bg-info transition-all"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
        {error}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted">
        Pick a date range, narrow the vendor filter if you want a smaller sweep, then click{' '}
        <strong>Run sweep</strong>.
      </p>
    )
  }

  const totalsActionable = rows.reduce((s, r) => s + r.fixCount + r.ackCount, 0)
  const totalsFix = rows.reduce((s, r) => s + r.fixCount, 0)
  const totalsAck = rows.reduce((s, r) => s + r.ackCount, 0)

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-panel p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Card label="Vendors with results" value={String(rows.length)}>
            of {progress ?? '—'} requested
          </Card>
          <Card label="Total actionable rows" value={String(totalsActionable)}>
            across all vendors
          </Card>
          <Card label="Need fix" value={String(totalsFix)}>
            missing-credit + unexplained + wrong-stamp
          </Card>
          <Card label="Expected (ack-able)" value={String(totalsAck)}>
            bundle-discount + refund-correction
          </Card>
        </div>
        {failures.length > 0 ? (
          <div className="mt-2 rounded border border-warning/40 bg-warning/5 px-2 py-1 text-[11px] text-warning">
            <strong>
              {failures.length} vendor audit{failures.length === 1 ? '' : 's'} failed.
            </strong>{' '}
            Click a failed row below to retry, or check the console for details.
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-panel">
        <table className="w-full text-xs">
          <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Vendor</th>
              <th className="px-3 py-2 text-left">Branch</th>
              <th className="px-3 py-2 text-right">Bookings</th>
              <th className="px-3 py-2 text-right">Need fix</th>
              <th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-right">Cheque vs revenue (D−B%)</th>
              <th className="px-3 py-2">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rows.map(({ result: r, fixCount, ackCount, netGap }) => (
              <tr key={r.vendorId} className="hover:bg-surface/40">
                <td className="px-3 py-2">
                  <div className="font-medium text-text">{r.vendorName}</div>
                  <div className="font-mono text-[10px] text-muted">{r.vendorId}</div>
                </td>
                <td className="px-3 py-2 text-muted">{r.branch || '—'}</td>
                <td className="px-3 py-2 text-right">{r.rows.length}</td>
                <td
                  className={`px-3 py-2 text-right font-semibold ${
                    fixCount > 0 ? 'text-critical' : 'text-muted'
                  }`}
                >
                  {fixCount > 0 ? fixCount : '—'}
                </td>
                <td
                  className={`px-3 py-2 text-right ${ackCount > 0 ? 'text-warning' : 'text-muted'}`}
                >
                  {ackCount > 0 ? ackCount : '—'}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono ${
                    Math.abs(netGap) <= 5 ? 'text-success' : 'text-warning'
                  }`}
                >
                  {netGap > 0 ? '+' : ''}
                  {currency(netGap)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onDrillDown(r.vendorId)}
                    className="ui-btn ui-btn-accent min-h-7 px-3 py-0.5 text-[11px]"
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
            {failures.map((f) => {
              const v = vendors.find((vv) => vv.id === f.vendorId)
              return (
                <tr key={`failed-${f.vendorId}`} className="bg-critical/5">
                  <td className="px-3 py-2">
                    <div className="font-medium text-critical">{v?.name ?? f.vendorId}</div>
                    <div className="font-mono text-[10px] text-muted">{f.vendorId}</div>
                  </td>
                  <td className="px-3 py-2 text-muted">{v?.branch || '—'}</td>
                  <td colSpan={4} className="px-3 py-2 text-[11px] text-critical">
                    Failed: {f.error}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onDrillDown(f.vendorId)}
                      className="ui-btn ui-btn-neutral min-h-7 px-3 py-0.5 text-[11px]"
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted">
        Click <strong>Open</strong> to drill into a vendor's audit and use Auto-fix / Ack /
        Re-attribute on individual rows. Sweep is read-only — no writes happen during the sweep
        itself.
      </p>
    </div>
  )
}

// ─── RowGroup: a booking row + its always-visible derivation chain ────────
//
// Renders TWO <tr> per booking so the four numbers (A=gross items, B=gross
// billing, C=Σ vendorTotal, D=ledger net) are visualized as a connected
// chain below the headline row. Every link between adjacent values shows
// either a ✓ when the relationship holds or a Δ with the drift amount —
// so an admin reading the row can see which step in the derivation is
// where the truth breaks. No more dumping four numbers without context.

const RowGroup = ({
  row,
  meta,
  sharePercent,
  vendorType,
  busy,
  onAcknowledge,
  onRevokeAck,
  onWriteMissingCredit,
  onWriteDebit,
  onOpenRefundReview,
  onOpenReattribute,
}: {
  row: AuditBookingRow
  meta: { label: string; tone: 'success' | 'warning' | 'critical' | 'info' | 'muted' }
  sharePercent: number
  vendorType: string
  busy: boolean
  onAcknowledge: () => void
  onRevokeAck: () => void
  onWriteMissingCredit: () => void
  onWriteDebit: () => void
  onOpenRefundReview: () => void
  onOpenReattribute: () => void
}) => {
  return (
    <>
      <tr className="hover:bg-surface/40">
        <td className="px-3 py-2 font-mono text-[10px]">{row.bookingId}</td>
        <td className="px-3 py-2 text-muted">{row.date}</td>
        <td className="px-3 py-2">{row.source || '—'}</td>
        <td className="px-3 py-2 text-right">{currency(row.vendorTotalSum)}</td>
        <td className="px-3 py-2 text-right">{currency(row.ledgerNet)}</td>
        <td
          className={`px-3 py-2 text-right ${
            row.diffLedgerVsVendorTotal === 0
              ? 'text-muted'
              : row.diffLedgerVsVendorTotal > 0
                ? 'text-warning'
                : 'text-success'
          }`}
        >
          {row.diffLedgerVsVendorTotal > 0 ? '+' : ''}
          {currency(row.diffLedgerVsVendorTotal)}
        </td>
        <td className="px-3 py-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TONE_CLASS[meta.tone]}`}
            title={row.classificationReason}
          >
            {meta.label}
          </span>
        </td>
        <td className="px-3 py-2 text-right">
          <RowActions
            row={row}
            busy={busy}
            onAcknowledge={onAcknowledge}
            onRevokeAck={onRevokeAck}
            onWriteMissingCredit={onWriteMissingCredit}
            onWriteDebit={onWriteDebit}
            onOpenRefundReview={onOpenRefundReview}
            onOpenReattribute={onOpenReattribute}
          />
        </td>
      </tr>
      <tr className="border-b border-border/40">
        <td colSpan={8} className="bg-surface/30 px-3 pb-2.5 pt-0.5">
          <DerivationChain row={row} sharePercent={sharePercent} vendorType={vendorType} />
        </td>
      </tr>
    </>
  )
}

const DerivationChain = ({
  row,
  sharePercent,
  vendorType,
}: {
  row: AuditBookingRow
  sharePercent: number
  vendorType: string
}) => {
  const A = row.grossItems
  const B = row.grossBilling
  const C = row.vendorTotalSum
  const D = row.ledgerNet
  // SubLease formula: vendor gets share% of base only, no GST share.
  // ThirdParty formula: vendor gets share% of base + gst = share% of gross.
  // Without this branch, every SubLease row showed a permanent Δ on the
  // B → C link because the chart computed expectedC = gross × share%.
  const isSubLease = vendorType === 'SubLease'
  const shareDivisor = isSubLease ? 118 : 100
  const expectedC = Math.round((B * sharePercent) / shareDivisor)
  const shareLinkLabel = isSubLease ? `× ${sharePercent}% base` : `× ${sharePercent}%`
  const dAB = A - B
  const dBC = expectedC - C
  const dCD = D - C
  const within = (n: number) => Math.abs(n) <= 2
  return (
    <div className="flex flex-wrap items-stretch gap-0 text-[10px] leading-tight">
      <Node id="A" label="gross items[]" value={A} muted={A === 0} />
      <Link
        title="A vs B — items[] gross should equal billingItems[] gross"
        ok={within(dAB)}
        delta={dAB}
        deltaLabel="Δ"
        okLabel="match"
      />
      <Node id="B" label="gross billing[]" value={B} muted={B === 0} />
      <Link
        title={
          isSubLease
            ? `B × ${sharePercent}% × 100/118 should equal C (SubLease: share% of base only)`
            : `B × ${sharePercent}% should equal C — share split applied`
        }
        ok={within(dBC)}
        delta={dBC}
        deltaLabel={shareLinkLabel}
        okLabel={shareLinkLabel}
      />
      <Node id="C" label="Σ vendorTotal" value={C} accent />
      <Link
        title="C vs D — ledger net must equal Σ vendorTotal (the audit's main check)"
        ok={within(dCD)}
        delta={dCD}
        deltaLabel="Δ"
        okLabel="ledger ✓"
      />
      <Node id="D" label="ledger net" value={D} accent />
    </div>
  )
}

const Node = ({
  id,
  label,
  value,
  accent = false,
  muted = false,
}: {
  id: 'A' | 'B' | 'C' | 'D'
  label: string
  value: number
  accent?: boolean
  muted?: boolean
}) => {
  const cls = muted
    ? 'border-border/50 bg-surface text-muted'
    : accent
      ? 'border-text/30 bg-panel text-text'
      : 'border-border/60 bg-surface text-text'
  return (
    <div className={`flex flex-col rounded-md border px-2 py-1 ${cls}`}>
      <span className="flex items-baseline gap-1">
        <span className="text-[9px] font-semibold uppercase tracking-wider opacity-70">{id}</span>
        <span className="font-semibold">{currency(value)}</span>
      </span>
      <span className="text-[9px] opacity-70">{label}</span>
    </div>
  )
}

const Link = ({
  ok,
  delta,
  deltaLabel,
  okLabel,
  title,
}: {
  ok: boolean
  delta: number
  deltaLabel: string
  okLabel: string
  title: string
}) => {
  // Connector: a thin colored bar with a centered chip showing either ✓
  // (link holds) or the actual drift amount. Self-explanatory at a glance.
  const tone = ok
    ? 'border-success/40 bg-success/10 text-success'
    : Math.abs(delta) > 50
      ? 'border-critical/45 bg-critical/10 text-critical'
      : 'border-warning/45 bg-warning/10 text-warning'
  return (
    <div className="flex items-center" title={title}>
      <div className={`h-px w-3 ${ok ? 'bg-success/45' : 'bg-warning/55'}`} aria-hidden="true" />
      <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${tone}`}>
        {ok ? `✓ ${okLabel}` : `${deltaLabel} ${delta > 0 ? '+' : ''}${currency(delta)}`}
      </span>
      <div className={`h-px w-3 ${ok ? 'bg-success/45' : 'bg-warning/55'}`} aria-hidden="true" />
    </div>
  )
}

const RowActions = ({
  row,
  busy,
  onAcknowledge,
  onRevokeAck,
  onWriteMissingCredit,
  onWriteDebit,
  onOpenRefundReview,
  onOpenReattribute,
}: {
  row: AuditBookingRow
  busy: boolean
  onAcknowledge: () => void
  onRevokeAck: () => void
  onWriteMissingCredit: () => void
  onWriteDebit: () => void
  onOpenRefundReview: () => void
  onOpenReattribute: () => void
}) => {
  const c = row.classification
  const showCredit = c === 'missing-credit' || c === 'acknowledged-stale'
  const showDebit =
    c === 'wrong-vendor-stamp' ||
    (c === 'unexplained-diff' && row.ledgerNet > row.vendorTotalSum) ||
    (c === 'acknowledged-stale' && row.ledgerNet > row.vendorTotalSum)
  const showRefund = c === 'refund-correction'
  const showReattribute =
    c === 'wrong-vendor-stamp' ||
    c === 'unexplained-diff' ||
    c === 'bundle-discount' ||
    c === 'missing-credit' ||
    c === 'acknowledged-stale'
  const showAcknowledge =
    c !== 'trigger-correct' && c !== 'rounding' && c !== 'refund-debit' && c !== 'acknowledged' // active ack hides the button — use Revoke instead
  const showRevoke = c === 'acknowledged' || c === 'acknowledged-stale'
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {showCredit ? (
        <button
          type="button"
          onClick={onWriteMissingCredit}
          disabled={busy}
          className="ui-btn ui-btn-accent min-h-7 px-2 py-0.5 text-[11px]"
          title="Add a manual_adjustment credit row for this vendor on this booking. Use when ledger missed a credit it should have written."
        >
          {busy ? '…' : 'Write credit'}
        </button>
      ) : null}
      {showDebit ? (
        <button
          type="button"
          onClick={onWriteDebit}
          disabled={busy}
          className="ui-btn ui-btn-accent min-h-7 px-2 py-0.5 text-[11px]"
          title="Add a manual_adjustment debit row that reduces this vendor's payable. Use for over-credits / wrong-vendor stamps."
        >
          {busy ? '…' : 'Write debit'}
        </button>
      ) : null}
      {showRefund ? (
        <button
          type="button"
          onClick={onOpenRefundReview}
          disabled={busy}
          className="ui-btn ui-btn-neutral min-h-7 px-2 py-0.5 text-[11px]"
          title="Open per-booking refund review — edit refunded flags, recompute corrections, apply per vendor."
        >
          Refund review
        </button>
      ) : null}
      {showReattribute ? (
        <button
          type="button"
          onClick={onOpenReattribute}
          disabled={busy}
          className="ui-btn ui-btn-neutral min-h-7 px-2 py-0.5 text-[11px]"
          title="Open booking item-by-item — re-pick the vendor / activity / pro-rate each item. Use for wrong-vendor stamps or fan-out from a package."
        >
          Re-attribute
        </button>
      ) : null}
      {showAcknowledge ? (
        <button
          type="button"
          onClick={onAcknowledge}
          disabled={busy}
          className="ui-btn ui-btn-neutral min-h-7 px-2 py-0.5 text-[11px]"
          title="Mark this diff as expected (with a reason ≥5 chars). Captures the current diff value so this row auto-resurfaces if the underlying state changes."
        >
          {busy ? '…' : 'Acknowledge'}
        </button>
      ) : null}
      {showRevoke ? (
        <button
          type="button"
          onClick={onRevokeAck}
          disabled={busy}
          className="ui-btn ui-btn-warning min-h-7 px-2 py-0.5 text-[11px]"
          title="Remove this acknowledgment. The row returns to its underlying classification and becomes a candidate for fix or re-acknowledgment."
        >
          {busy ? '…' : 'Revoke ack'}
        </button>
      ) : null}
    </div>
  )
}

export default AuditTab
