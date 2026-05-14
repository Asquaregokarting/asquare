import { useEffect, useState } from 'react'
import {
  type RefundCorrection,
  type RefundReviewContext,
  type VendorOption,
  applyRefundCorrection,
  fetchRefundReviewContext,
  recomputeBookingRefundCorrections,
  updateBookingRefundFlags,
} from '../../../api/reconciliation-firestore'

const currency = (n: number): string => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

interface Props {
  bookingId: string
  /** Pending corrections for THIS booking only. */
  corrections: RefundCorrection[]
  vendors: VendorOption[]
  resolvedBy: { id: string; name: string }
  onClose: () => void
  /** Called whenever a correction is applied so the parent list can shrink. */
  onApplied: (vendorId: string) => void
  /**
   * Called after refunded flags are saved on the booking so the parent
   * list can replace its pending corrections for this booking with the
   * recomputed ones.
   */
  onCorrectionsRecomputed?: (next: RefundCorrection[]) => void
}

export const RefundReviewModal = ({
  bookingId,
  corrections: initialCorrections,
  vendors,
  resolvedBy,
  onClose,
  onApplied,
  onCorrectionsRecomputed,
}: Props) => {
  const [context, setContext] = useState<RefundReviewContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [appliedVendorIds, setAppliedVendorIds] = useState<Set<string>>(new Set())
  const [applyingVendorId, setApplyingVendorId] = useState<string | null>(null)
  // Local copy of the proposed corrections so the modal can refresh them
  // after the admin edits refund flags.
  const [corrections, setCorrections] = useState<RefundCorrection[]>(initialCorrections)
  // Pending edits to items[].refunded — keyed by item index. Saved when
  // the admin clicks "Save refund flags".
  const [refundedEdits, setRefundedEdits] = useState<Map<number, boolean>>(new Map())
  const [savingFlags, setSavingFlags] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchRefundReviewContext(bookingId)
      .then((c) => {
        if (!cancelled) setContext(c)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load booking context.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [bookingId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const vendorMap = new Map<string, VendorOption>()
  for (const v of vendors) vendorMap.set(v.id, v)

  /** Compute the effective refunded value for a given item index. */
  const effectiveRefunded = (idx: number): boolean => {
    if (refundedEdits.has(idx)) return refundedEdits.get(idx) === true
    return context?.items[idx]?.refunded === true
  }

  const toggleItemRefunded = (idx: number) => {
    const original = context?.items[idx]?.refunded === true
    setRefundedEdits((prev) => {
      const next = new Map(prev)
      const newVal = !effectiveRefunded(idx)
      if (newVal === original) {
        next.delete(idx)
      } else {
        next.set(idx, newVal)
      }
      return next
    })
  }

  const hasPendingEdits = refundedEdits.size > 0

  const handleSaveRefundFlags = async () => {
    if (!hasPendingEdits) return
    setSavingFlags(true)
    setError(null)
    try {
      const patches = [...refundedEdits.entries()].map(([itemIndex, refunded]) => ({
        itemIndex,
        refunded,
      }))
      await updateBookingRefundFlags(bookingId, patches, resolvedBy)
      // Re-fetch context so flags + recomputed billingItems reflect the write.
      const fresh = await fetchRefundReviewContext(bookingId)
      setContext(fresh)
      // Recompute corrections for this booking — the deltas may shift
      // because expected debit changed.
      const next = await recomputeBookingRefundCorrections(bookingId)
      setCorrections(next)
      onCorrectionsRecomputed?.(next)
      // Reset edits + applied set (vendor list may have changed).
      setRefundedEdits(new Map())
      setAppliedVendorIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save refund flags.')
    } finally {
      setSavingFlags(false)
    }
  }

  const handleApply = async (row: RefundCorrection) => {
    setApplyingVendorId(row.vendorId)
    setError(null)
    try {
      await applyRefundCorrection({
        bookingId: row.bookingId,
        vendorId: row.vendorId,
        delta: row.delta,
        bookingDate: row.bookingDate,
        invoiceNumber: row.invoiceNumber,
        locationId: row.locationId,
        resolvedBy,
      })
      setAppliedVendorIds((prev) => new Set([...prev, row.vendorId]))
      onApplied(row.vendorId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply correction.')
    } finally {
      setApplyingVendorId(null)
    }
  }

  const refundedItemNames = context
    ? new Set(context.items.filter((i) => i.refunded).map((i) => i.itemName))
    : new Set<string>()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Review refund corrections for ${bookingId}`}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-4">
          <div>
            <p className="font-mono text-sm font-semibold text-text">{bookingId}</p>
            {context ? (
              <p className="text-xs text-muted">
                {context.date.slice(0, 10)} · {context.source || '(no source)'} ·{' '}
                {context.customerName || 'Guest'} · {context.customerPhone} ·{' '}
                {context.branchId ? `branch ${context.branchId}` : '(no branch)'}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-neutral min-h-8 px-3 py-1 text-xs"
          >
            Close
          </button>
        </header>

        {loading ? (
          <div className="flex-1 px-6 py-10 text-center text-sm text-muted">
            Loading booking context…
          </div>
        ) : error && !context ? (
          <div className="flex-1 px-6 py-10">
            <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
              {error}
            </p>
          </div>
        ) : context ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {error ? (
              <p className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
                {error}
              </p>
            ) : null}

            {/* Booking header summary */}
            <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-panel p-3 text-xs sm:grid-cols-4">
              <Field label="Customer paid" value={currency(context.finalAmount)} />
              <Field
                label="Refund amount"
                value={<span className="text-warning">{currency(context.refundAmount)}</span>}
              />
              <Field label="Refund status" value={context.refundStatus || 'None'} />
              <Field label="Invoice" value={context.invoiceNumber} />
            </div>

            {/* Items section — editable refunded flags */}
            <Section
              title={`Items (${context.items.length})`}
              hint="Toggle the Refunded checkbox to fix items where the system marked the wrong activity. Click 'Save refund flags' to write changes back to the booking. The proposed corrections recompute automatically."
              action={
                hasPendingEdits ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-warning">
                      {refundedEdits.size} unsaved edit{refundedEdits.size === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRefundedEdits(new Map())}
                      disabled={savingFlags}
                      className="ui-btn ui-btn-neutral min-h-7 px-2 py-0.5 text-[11px]"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveRefundFlags()}
                      disabled={savingFlags}
                      className="ui-btn ui-btn-accent min-h-7 px-2 py-0.5 text-[11px]"
                    >
                      {savingFlags ? 'Saving…' : 'Save refund flags'}
                    </button>
                  </div>
                ) : null
              }
            >
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="px-2 py-1 text-left">#</th>
                    <th className="px-2 py-1 text-left">Item</th>
                    <th className="px-2 py-1 text-left">gameId / subGameId</th>
                    <th className="px-2 py-1 text-left">Vendor</th>
                    <th className="px-2 py-1 text-right">Qty × Unit</th>
                    <th className="px-2 py-1 text-right">Vendor total</th>
                    <th className="px-2 py-1 text-center">Refunded?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {context.items.map((it, idx) => {
                    const refunded = effectiveRefunded(idx)
                    const edited = refundedEdits.has(idx)
                    return (
                      <tr
                        key={idx}
                        className={edited ? 'bg-info/10' : refunded ? 'bg-warning/5' : ''}
                      >
                        <td className="px-2 py-1 text-muted">{idx}</td>
                        <td className="px-2 py-1">{it.itemName || '(no name)'}</td>
                        <td className="px-2 py-1 text-muted">
                          {it.gameId || '—'} / {it.subGameId || '—'}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {it.vendorId || <span className="text-muted">—</span>}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {it.quantity} × {currency(it.unitPrice)}
                        </td>
                        <td className="px-2 py-1 text-right">{currency(it.vendorTotal)}</td>
                        <td className="px-2 py-1 text-center">
                          <label className="inline-flex cursor-pointer items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={refunded}
                              onChange={() => toggleItemRefunded(idx)}
                              disabled={savingFlags}
                              aria-label={`Mark item ${idx} (${it.itemName}) as refunded`}
                              className="h-3.5 w-3.5"
                            />
                            {refunded ? (
                              <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-semibold text-warning">
                                Refunded
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted">not refunded</span>
                            )}
                            {edited ? (
                              <span className="text-[10px] font-semibold text-info">edited</span>
                            ) : null}
                          </label>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Section>

            {/* Billing items section — only show when different from items */}
            <Section
              title={`Billing items (${context.billingItems.length})`}
              hint="From booking.billingItems[]. mapTransactionRecord prefers this when present; the refunded flag here drives downstream reports."
            >
              {context.billingItems.length === 0 ? (
                <p className="text-xs text-muted">(no billingItems on this booking)</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="px-2 py-1 text-left">Item</th>
                      <th className="px-2 py-1 text-left">Vendor</th>
                      <th className="px-2 py-1 text-right">Qty × Unit</th>
                      <th className="px-2 py-1 text-right">Vendor total</th>
                      <th className="px-2 py-1 text-left">Refunded?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {context.billingItems.map((it, idx) => {
                      const itemMatchesRefundedName =
                        refundedItemNames.size > 0 && refundedItemNames.has(it.itemName)
                      const flagDrift = itemMatchesRefundedName && !it.refunded
                      return (
                        <tr key={idx} className={flagDrift ? 'bg-critical/5' : ''}>
                          <td className="px-2 py-1">{it.itemName || '(no name)'}</td>
                          <td className="px-2 py-1 font-mono">
                            {it.vendorId || <span className="text-muted">—</span>}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {it.quantity} × {currency(it.unitPrice)}
                          </td>
                          <td className="px-2 py-1 text-right">{currency(it.vendorTotal)}</td>
                          <td className="px-2 py-1">
                            {it.refunded ? (
                              <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-semibold text-warning">
                                Refunded
                              </span>
                            ) : flagDrift ? (
                              <span
                                className="rounded-full border border-critical/40 px-2 py-0.5 text-[10px] font-semibold text-critical"
                                title="items[] says refunded but billingItems[] doesn't — mapper drift"
                              >
                                drift
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </Section>

            {/* Existing ledger entries */}
            <Section
              title={`Ledger entries (${context.ledgerEntries.length})`}
              hint="Every vendorLedger row currently referencing this booking. Used to derive 'currently debited' for each correction."
            >
              {context.ledgerEntries.length === 0 ? (
                <p className="text-xs text-muted">(no ledger entries)</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="px-2 py-1 text-left">Doc ID</th>
                      <th className="px-2 py-1 text-left">Vendor</th>
                      <th className="px-2 py-1 text-left">Type</th>
                      <th className="px-2 py-1 text-left">Source</th>
                      <th className="px-2 py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {context.ledgerEntries.map((e) => (
                      <tr key={e.id}>
                        <td className="px-2 py-1 font-mono text-[10px]">{e.id}</td>
                        <td className="px-2 py-1 font-mono">{e.vendorId}</td>
                        <td
                          className={`px-2 py-1 ${
                            e.type === 'debit' ? 'text-warning' : 'text-success'
                          }`}
                        >
                          {e.type}
                        </td>
                        <td className="px-2 py-1">{e.source || '—'}</td>
                        <td className="px-2 py-1 text-right">{currency(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            {/* Pending corrections — the action area */}
            <Section
              title={`Proposed corrections for this booking (${corrections.length})`}
              hint="One row per (booking, vendor) where the current ledger debits don't match what items[].refunded says. Apply each individually."
            >
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="px-2 py-1 text-left">Vendor</th>
                    <th className="px-2 py-1 text-right">Currently debited</th>
                    <th className="px-2 py-1 text-right">Should be</th>
                    <th className="px-2 py-1 text-right">Delta</th>
                    <th className="px-2 py-1 text-left">Direction</th>
                    <th className="px-2 py-1">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {corrections.map((c) => {
                    const v = vendorMap.get(c.vendorId)
                    const isApplied = appliedVendorIds.has(c.vendorId)
                    const isApplying = applyingVendorId === c.vendorId
                    return (
                      <tr key={c.vendorId} className={isApplied ? 'opacity-60' : ''}>
                        <td className="px-2 py-1">
                          <div>{c.vendorName ?? v?.name ?? c.vendorId}</div>
                          <div className="font-mono text-muted">{c.vendorId}</div>
                          {v?.preferredActivity ? (
                            <div className="text-muted">{v.preferredActivity}</div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1 text-right">{currency(c.actual)}</td>
                        <td className="px-2 py-1 text-right">{currency(c.expected)}</td>
                        <td
                          className={`px-2 py-1 text-right font-semibold ${
                            c.delta > 0 ? 'text-warning' : 'text-success'
                          }`}
                        >
                          {c.delta > 0 ? '+' : ''}
                          {currency(c.delta)}
                        </td>
                        <td className="px-2 py-1">
                          {c.direction === 'add-debit' ? (
                            <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-semibold text-warning">
                              add MORE debit
                            </span>
                          ) : (
                            <span className="rounded-full border border-success/40 px-2 py-0.5 text-[10px] font-semibold text-success">
                              reverse some debit
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {isApplied ? (
                            <span className="text-[10px] font-semibold text-success">
                              ✓ applied
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleApply(c)}
                              disabled={isApplying || hasPendingEdits}
                              title={
                                hasPendingEdits
                                  ? 'Save refund flags first — applying now would write against stale data.'
                                  : ''
                              }
                              className="ui-btn ui-btn-accent min-h-7 px-3 py-1 text-xs"
                            >
                              {isApplying ? 'Applying…' : 'Apply this correction'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Section>
          </div>
        ) : null}

        <footer className="flex items-center justify-between gap-3 border-t border-border/60 bg-panel px-6 py-3">
          <p className="text-xs text-muted">
            {appliedVendorIds.size} of {corrections.length} corrections applied for this booking.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-neutral min-h-9 px-4 text-sm"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
    <p className="font-medium text-text">{value}</p>
  </div>
)

const Section = ({
  title,
  hint,
  children,
  action,
}: {
  title: string
  hint?: string
  children: React.ReactNode
  action?: React.ReactNode
}) => (
  <section className="mb-4 overflow-hidden rounded-lg border border-border/60 bg-panel">
    <div className="flex items-start justify-between gap-3 border-b border-border/40 bg-surface/50 px-3 py-2">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text">{title}</h4>
        {hint ? <p className="mt-0.5 text-[10px] text-muted">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
    <div className="p-2">{children}</div>
  </section>
)

export default RefundReviewModal
