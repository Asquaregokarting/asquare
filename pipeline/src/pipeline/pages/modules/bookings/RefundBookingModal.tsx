import { useMemo, useState } from 'react'
import { AdminActor, AsquareBooking, asquareBookingsApi } from '../../../api/asquare-bookings'
import { logger } from '../../../../lib/logger'
import { formatCurrency } from './bookings-utils'

interface RefundBookingModalProps {
  booking: AsquareBooking
  actor: AdminActor
  onClose: () => void
  onRefunded: (message: string) => void
}

type RefundMode = 'cash' | 'wallet'
type RefundScope = 'full' | 'partial'

const RefundBookingModal = ({ booking, actor, onClose, onRefunded }: RefundBookingModalProps) => {
  const finalAmount = Math.round(Number(booking.finalAmount || 0))
  const alreadyRefunded = Math.round(Number((booking as Record<string, unknown>).refundAmount ?? 0))
  const remaining = Math.max(0, finalAmount - alreadyRefunded)

  const rawItems = useMemo(() => {
    const fromBilling = (booking as Record<string, unknown>).billingItems
    const list = Array.isArray(fromBilling) && fromBilling.length > 0 ? fromBilling : booking.items
    return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : []
  }, [booking])

  const refundableIndices = useMemo(
    () => rawItems.map((it, idx) => (it.refunded === true ? -1 : idx)).filter((i) => i >= 0),
    [rawItems],
  )

  const [mode, setMode] = useState<RefundMode>(booking.paymentMethod === 'cash' ? 'cash' : 'wallet')
  const [scope, setScope] = useState<RefundScope>('full')
  const [partialAmount, setPartialAmount] = useState<string>('')
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set(refundableIndices))
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const phone = String(booking.userPhone ?? '').trim()
  const customerName = String(booking.userDisplayName ?? 'Customer')

  const itemizedSelectionTotal = useMemo(() => {
    let sum = 0
    for (const idx of selectedIndices) {
      const it = rawItems[idx]
      if (!it) continue
      // Prefer the canonical line total: itemBaseAmount + itemGstAmount when
      // present (POS/billingItems), else fall back to price (customer app items).
      const base = Number(it.itemBaseAmount ?? 0)
      const gst = Number(it.itemGstAmount ?? 0)
      const itemTotal = base + gst > 0 ? base + gst : Number(it.price ?? 0)
      sum += itemTotal
    }
    return Math.round(sum)
  }, [selectedIndices, rawItems])

  const computedAmount = useMemo(() => {
    if (scope === 'full') return remaining
    // Partial: prefer per-item selection if any items chosen, else manual amount.
    if (selectedIndices.size > 0 && selectedIndices.size < refundableIndices.length) {
      return Math.min(itemizedSelectionTotal, remaining)
    }
    const manual = Math.round(Number(partialAmount || 0))
    if (!Number.isFinite(manual) || manual <= 0) return 0
    return Math.min(manual, remaining)
  }, [
    scope,
    remaining,
    selectedIndices,
    refundableIndices.length,
    itemizedSelectionTotal,
    partialAmount,
  ])

  const itemIndicesToFlag = useMemo(() => {
    if (scope === 'full') return refundableIndices
    if (selectedIndices.size > 0 && selectedIndices.size < refundableIndices.length) {
      return [...selectedIndices].sort((a, b) => a - b)
    }
    // Pure-amount partial — don't flag any items.
    return []
  }, [scope, selectedIndices, refundableIndices])

  const submit = async () => {
    setError(null)
    if (computedAmount <= 0) {
      setError('Refund amount must be greater than zero.')
      return
    }
    if (computedAmount > remaining) {
      setError(`Refund amount ₹${computedAmount} exceeds remaining ₹${remaining}.`)
      return
    }
    if (!reason.trim()) {
      setError('Reason is required.')
      return
    }
    if (mode === 'wallet' && !phone) {
      setError('No phone number on this booking — wallet refund not possible. Use cash mode.')
      return
    }
    setSubmitting(true)
    try {
      const result = await asquareBookingsApi.refundBooking(booking, {
        mode,
        amount: computedAmount,
        itemIndices: itemIndicesToFlag,
        reason: reason.trim(),
        actor,
      })
      if (!result.success) {
        setError(result.message || 'Refund failed.')
        return
      }
      const baseMsg = `Refunded ${formatCurrency(computedAmount)} on ${booking.id} (${mode}).`
      const walletMsg =
        mode === 'wallet'
          ? result.walletCredited
            ? ' Wallet credited.'
            : result.walletError
              ? ` Wallet credit FAILED: ${result.walletError}`
              : ''
          : ''
      onRefunded(baseMsg + walletMsg)
      onClose()
    } catch (err) {
      logger.error('refund_booking_modal.submit_failed', err, { orderNumber: booking.id })
      setError(err instanceof Error ? err.message : 'Refund failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleIndex = (idx: number) => {
    setSelectedIndices((c) => {
      const n = new Set(c)
      if (n.has(idx)) n.delete(idx)
      else n.add(idx)
      return n
    })
  }

  if (remaining <= 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-base/70 p-4 pt-10 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
          <h3 className="mb-2 text-lg font-semibold text-text">Already Refunded</h3>
          <p className="mb-4 text-sm text-muted">
            Booking {booking.id} has no remaining amount to refund.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="ui-btn ui-btn-neutral min-h-9 px-3 py-1.5 text-xs"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-base/70 p-4 pt-10 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-text">Refund Booking</h3>
            <p className="text-xs font-mono text-muted">{booking.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-neutral min-h-8 px-3 py-1 text-xs"
          >
            Close
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        )}

        <div className="space-y-5">
          {/* Customer + amounts summary */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-panel p-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">Customer</p>
              <p className="truncate font-medium text-text">{customerName}</p>
              <p className="truncate text-[11px] text-muted">{phone || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">Final</p>
              <p className="font-semibold text-text">{formatCurrency(finalAmount)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">Already Refunded</p>
              <p className="font-semibold text-text">{formatCurrency(alreadyRefunded)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">Remaining</p>
              <p className="font-semibold text-success">{formatCurrency(remaining)}</p>
            </div>
          </div>

          {/* Mode picker */}
          <div>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
              Refund Mode
            </span>
            <div className="grid grid-cols-2 gap-2">
              <label
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm cursor-pointer ${
                  mode === 'cash'
                    ? 'border-warning/60 bg-warning/10'
                    : 'border-border bg-panel hover:bg-panel/70'
                }`}
              >
                <input
                  type="radio"
                  name="refund-mode"
                  checked={mode === 'cash'}
                  onChange={() => setMode('cash')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-text">Cash</span>
                  <span className="block text-[11px] text-muted">
                    Cashier hands cash to the customer. Logged for till reconciliation; no wallet
                    movement.
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm cursor-pointer ${
                  mode === 'wallet'
                    ? 'border-info/60 bg-info/10'
                    : 'border-border bg-panel hover:bg-panel/70'
                } ${!phone ? 'opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name="refund-mode"
                  checked={mode === 'wallet'}
                  onChange={() => setMode('wallet')}
                  disabled={!phone}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-text">Wallet</span>
                  <span className="block text-[11px] text-muted">
                    {phone
                      ? 'Credits the customer wallet atomically. Customer can use it on the next booking.'
                      : 'Disabled — no phone on booking.'}
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* Scope: full vs partial */}
          <div>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
              Refund Scope
            </span>
            <div className="grid grid-cols-2 gap-2">
              <label
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm cursor-pointer ${
                  scope === 'full'
                    ? 'border-accent/60 bg-accent/10'
                    : 'border-border bg-panel hover:bg-panel/70'
                }`}
              >
                <input
                  type="radio"
                  name="refund-scope"
                  checked={scope === 'full'}
                  onChange={() => {
                    setScope('full')
                    setSelectedIndices(new Set(refundableIndices))
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-text">Full</span>
                  <span className="block text-[11px] text-muted">
                    Refund the entire remaining {formatCurrency(remaining)}.
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm cursor-pointer ${
                  scope === 'partial'
                    ? 'border-warning/60 bg-warning/10'
                    : 'border-border bg-panel hover:bg-panel/70'
                }`}
              >
                <input
                  type="radio"
                  name="refund-scope"
                  checked={scope === 'partial'}
                  onChange={() => {
                    setScope('partial')
                    setSelectedIndices(new Set())
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-text">Partial</span>
                  <span className="block text-[11px] text-muted">
                    Pick specific items, or enter a custom amount.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* Partial inputs */}
          {scope === 'partial' && (
            <div className="space-y-3 rounded-lg border border-border bg-panel/50 p-3">
              {refundableIndices.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    Select items to refund (optional)
                  </p>
                  <ul className="divide-y divide-border/60 rounded border border-border bg-panel">
                    {rawItems.map((it, idx) => {
                      const alreadyDone = it.refunded === true
                      const name =
                        String(it.itemName ?? '') ||
                        String((it.activity as Record<string, unknown> | undefined)?.name ?? 'Item')
                      const qty = Number(it.quantity ?? 1)
                      const base = Number(it.itemBaseAmount ?? 0)
                      const gst = Number(it.itemGstAmount ?? 0)
                      const total = base + gst > 0 ? base + gst : Number(it.price ?? 0)
                      return (
                        <li key={idx}>
                          <label
                            className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-xs ${
                              alreadyDone ? 'opacity-50' : 'cursor-pointer hover:bg-surface/40'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectedIndices.has(idx)}
                                onChange={() => toggleIndex(idx)}
                                disabled={alreadyDone}
                              />
                              <span>
                                <span
                                  className={`font-medium text-text ${alreadyDone ? 'line-through' : ''}`}
                                >
                                  {name}
                                </span>
                                <span className="ml-2 text-muted">× {qty}</span>
                                {alreadyDone && (
                                  <span className="ml-2 text-[10px] uppercase text-info">
                                    Refunded
                                  </span>
                                )}
                              </span>
                            </span>
                            <span className="font-semibold text-text">
                              {formatCurrency(Math.round(total))}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                  {selectedIndices.size > 0 && (
                    <p className="mt-2 text-[11px] text-muted">
                      Selected items total:{' '}
                      <span className="font-semibold text-text">
                        {formatCurrency(itemizedSelectionTotal)}
                      </span>
                    </p>
                  )}
                </div>
              )}

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                  Or enter custom amount (₹)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  className="ui-field min-h-10 w-full"
                  placeholder="0"
                  value={partialAmount}
                  onChange={(e) => {
                    setPartialAmount(e.target.value)
                    if (e.target.value) setSelectedIndices(new Set())
                  }}
                  disabled={selectedIndices.size > 0}
                />
                {selectedIndices.size > 0 && (
                  <p className="mt-1 text-[11px] text-muted">
                    Disabled — using selected items total. Uncheck all items to enter a custom
                    amount.
                  </p>
                )}
              </label>
            </div>
          )}

          {/* Reason */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
              Reason (required)
            </span>
            <textarea
              className="ui-field min-h-16 w-full"
              rows={2}
              placeholder="e.g. Customer reported equipment fault — refund agreed by branch manager."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          {/* Preview */}
          <div className="rounded-lg border border-success/40 bg-success/5 p-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-muted">Refund amount</span>
              <span className="text-lg font-semibold text-success">
                {formatCurrency(computedAmount)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Mode: <span className="font-medium text-text">{mode}</span> · After this refund, total
              refunded will be{' '}
              <span className="font-medium text-text">
                {formatCurrency(alreadyRefunded + computedAmount)}
              </span>{' '}
              of {formatCurrency(finalAmount)}. Vendor cheque(s) for this booking will be reduced
              proportionally.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="ui-btn ui-btn-neutral min-h-9 px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || computedAmount <= 0 || !reason.trim()}
              className="ui-btn ui-btn-success min-h-9 px-4 py-1.5 text-xs disabled:opacity-50"
            >
              {submitting ? 'Refunding…' : `Refund ${formatCurrency(computedAmount)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default RefundBookingModal
