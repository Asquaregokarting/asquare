import { useEffect, useMemo, useState } from 'react'
import {
  AsquareBooking,
  AsquareBookingActivity,
  AdminActor,
  asquareBookingsApi,
} from '../../../api/asquare-bookings'
import { listBranchActivityCatalog } from '../../../api/activity-catalog-firestore'
import { isCurrentlyUnavailable, isOnSurface } from '../../../api/activity-availability'
import type { ActivityCatalogRecord, BranchLocationKey } from '../../../api/types'
import { logger } from '../../../../lib/logger'
import { formatCurrency } from './bookings-utils'

type Settlement = 'wallet_credit' | 'wallet_debit' | 'external_cash' | 'no_adjustment'

interface ReplaceActivityModalProps {
  booking: AsquareBooking
  actor: AdminActor
  onClose: () => void
  onSwapped: (updated: AsquareBooking) => void
}

const ReplaceActivityModal = ({
  booking,
  actor,
  onClose,
  onSwapped,
}: ReplaceActivityModalProps) => {
  const [itemIndex, setItemIndex] = useState(0)
  const [catalog, setCatalog] = useState<ActivityCatalogRecord[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null)
  const [unitPriceOverride, setUnitPriceOverride] = useState<string>('')
  const [reason, setReason] = useState('')
  const [settlement, setSettlement] = useState<Settlement>('wallet_credit')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentItem = booking.items[itemIndex]
  const quantity = Math.max(1, Math.floor(currentItem?.quantity || 1))
  const oldUnitPrice = currentItem ? Number(currentItem.price ?? 0) / Math.max(1, quantity) : 0
  const oldLineTotal = oldUnitPrice * quantity

  useEffect(() => {
    let cancelled = false
    setCatalogLoading(true)
    listBranchActivityCatalog(booking.locationId as BranchLocationKey)
      .then((rows) => {
        if (!cancelled) {
          // Hide Inactive (permanently disabled), currently-unavailable
          // (auto-expire honored on the soft flag), and games not exposed to
          // the bookings surface — staff shouldn't be offered to swap into a
          // game that's down or that the operator removed from bookings.
          setCatalog(
            rows.filter(
              (r) => r.active !== false && !isCurrentlyUnavailable(r) && isOnSurface(r, 'bookings'),
            ),
          )
        }
      })
      .catch((err) => {
        logger.error('replace_activity_modal.catalog_load_failed', err)
        if (!cancelled) {
          setError('Failed to load activities catalog.')
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [booking.locationId])

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return catalog.slice(0, 50)
    return catalog
      .filter((r) =>
        [r.bookingName, r.name, r.category, r.subcategory]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q)),
      )
      .slice(0, 50)
  }, [catalog, search])

  const selected = useMemo(
    () => catalog.find((r) => r.id === selectedActivityId) ?? null,
    [catalog, selectedActivityId],
  )

  const catalogUnitPrice = selected
    ? Number(selected.branchPrices?.[booking.locationId as BranchLocationKey] ?? 0)
    : 0

  const effectiveUnitPrice = unitPriceOverride
    ? Math.max(0, Number(unitPriceOverride) || 0)
    : catalogUnitPrice

  const newLineTotal = effectiveUnitPrice * quantity
  const priceDelta = Math.round(newLineTotal - oldLineTotal)

  // Auto-suggest settlement when delta sign flips.
  useEffect(() => {
    if (priceDelta < 0) setSettlement('wallet_credit')
    else if (priceDelta > 0) setSettlement('wallet_debit')
    else setSettlement('no_adjustment')
  }, [priceDelta])

  const validSettlement = useMemo(() => {
    if (priceDelta === 0) return settlement === 'no_adjustment'
    if (priceDelta < 0) {
      return settlement === 'wallet_credit' || settlement === 'external_cash'
    }
    return settlement === 'wallet_debit' || settlement === 'external_cash'
  }, [priceDelta, settlement])

  const canSubmit =
    !!selected && !!reason.trim() && effectiveUnitPrice > 0 && validSettlement && !submitting

  const handleSubmit = async () => {
    if (!selected || !currentItem) return
    setSubmitting(true)
    setError(null)
    try {
      const newActivity: AsquareBookingActivity = {
        id: selected.id,
        name: selected.bookingName || selected.name,
        basePrice: effectiveUnitPrice,
        category: selected.category,
        image: selected.imageUrl ?? selected.image,
        duration: selected.durationMinutes,
        vendorId: selected.vendorId,
      }
      const result = await asquareBookingsApi.replaceActivity(
        booking,
        {
          itemIndex,
          newActivity,
          newUnitPrice: effectiveUnitPrice,
          reason: reason.trim(),
          settlement,
        },
        actor,
      )
      if (!result) {
        setError(
          'Swap failed. The replacement game may have just been marked unavailable, or the wallet adjustment did not complete. Refresh and pick a different game; if the customer was charged, contact owner for manual reconciliation.',
        )
        return
      }
      onSwapped(result.updated)
      onClose()
    } catch (err) {
      logger.error('replace_activity_modal.submit_failed', err)
      setError(err instanceof Error ? err.message : 'Swap failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!currentItem) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-base/70 p-4 pt-10 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-text">Replace Activity</h3>
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
          {booking.items.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                Which line item?
              </span>
              <select
                className="ui-field min-h-10 w-full"
                value={itemIndex}
                onChange={(e) => setItemIndex(Number(e.target.value) || 0)}
              >
                {booking.items.map((it, idx) => (
                  <option key={idx} value={idx}>
                    {idx + 1}. {it.activity?.name ?? 'Activity'} × {it.quantity} —{' '}
                    {formatCurrency(Number(it.price ?? 0))}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="rounded-lg border border-border bg-panel p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Replacing</p>
            <p className="mt-1 font-medium text-text">{currentItem.activity?.name ?? '—'}</p>
            <p className="text-xs text-muted">
              Qty {quantity} × {formatCurrency(oldUnitPrice)} = {formatCurrency(oldLineTotal)}
            </p>
          </div>

          <div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                Search replacement activity
              </span>
              <input
                className="ui-field min-h-10 w-full"
                placeholder="Type a game name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-panel">
              {catalogLoading ? (
                <p className="px-3 py-4 text-center text-xs text-muted">Loading catalog…</p>
              ) : filteredCatalog.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted">No matches.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {filteredCatalog.map((r) => {
                    const price = Number(
                      r.branchPrices?.[booking.locationId as BranchLocationKey] ?? 0,
                    )
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedActivityId(r.id)
                            setUnitPriceOverride('')
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-surface/60 ${
                            selectedActivityId === r.id ? 'bg-accent/10' : ''
                          }`}
                        >
                          <div>
                            <p className="font-medium text-text">{r.bookingName || r.name}</p>
                            <p className="text-[11px] text-muted">
                              {r.category}
                              {r.subcategory ? ` • ${r.subcategory}` : ''}
                            </p>
                          </div>
                          <span className="font-semibold text-text">{formatCurrency(price)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          {selected && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                    Unit Price
                  </span>
                  <input
                    type="number"
                    className="ui-field min-h-10 w-full"
                    placeholder={String(catalogUnitPrice)}
                    value={unitPriceOverride}
                    onChange={(e) => setUnitPriceOverride(e.target.value)}
                  />
                  <p className="mt-1 text-[11px] text-muted">
                    Catalog: {formatCurrency(catalogUnitPrice)}
                  </p>
                </div>
                <div>
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                    Quantity
                  </span>
                  <p className="min-h-10 rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text">
                    {quantity}
                  </p>
                </div>
                <div>
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                    New Line Total
                  </span>
                  <p className="min-h-10 rounded-lg border border-border bg-panel px-3 py-2 text-sm font-semibold text-text">
                    {formatCurrency(newLineTotal)}
                  </p>
                </div>
                <div>
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                    Delta
                  </span>
                  <p
                    className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-semibold ${
                      priceDelta > 0
                        ? 'border-warning/40 bg-warning/10 text-warning'
                        : priceDelta < 0
                          ? 'border-info/40 bg-info/10 text-info'
                          : 'border-border bg-panel text-muted'
                    }`}
                  >
                    {priceDelta > 0 ? '+' : ''}
                    {formatCurrency(priceDelta)}
                  </p>
                </div>
              </div>

              <div>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                  How was the difference settled?
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {priceDelta < 0 && (
                    <label className="flex items-start gap-2 rounded-lg border border-border bg-panel p-3 text-sm">
                      <input
                        type="radio"
                        name="settlement"
                        checked={settlement === 'wallet_credit'}
                        onChange={() => setSettlement('wallet_credit')}
                      />
                      <span>
                        <span className="font-medium text-text">Refund to wallet</span>
                        <span className="block text-[11px] text-muted">
                          Credits {formatCurrency(Math.abs(priceDelta))} to customer wallet.
                        </span>
                      </span>
                    </label>
                  )}
                  {priceDelta > 0 && (
                    <label className="flex items-start gap-2 rounded-lg border border-border bg-panel p-3 text-sm">
                      <input
                        type="radio"
                        name="settlement"
                        checked={settlement === 'wallet_debit'}
                        onChange={() => setSettlement('wallet_debit')}
                      />
                      <span>
                        <span className="font-medium text-text">Charge from wallet</span>
                        <span className="block text-[11px] text-muted">
                          Deducts {formatCurrency(priceDelta)} from customer wallet (must have
                          balance).
                        </span>
                      </span>
                    </label>
                  )}
                  {priceDelta !== 0 && (
                    <label className="flex items-start gap-2 rounded-lg border border-border bg-panel p-3 text-sm">
                      <input
                        type="radio"
                        name="settlement"
                        checked={settlement === 'external_cash'}
                        onChange={() => setSettlement('external_cash')}
                      />
                      <span>
                        <span className="font-medium text-text">Settled externally (cash)</span>
                        <span className="block text-[11px] text-muted">
                          No wallet movement — staff handled cash directly.
                        </span>
                      </span>
                    </label>
                  )}
                  {priceDelta === 0 && (
                    <label className="flex items-start gap-2 rounded-lg border border-border bg-panel p-3 text-sm">
                      <input
                        type="radio"
                        name="settlement"
                        checked={settlement === 'no_adjustment'}
                        onChange={() => setSettlement('no_adjustment')}
                      />
                      <span>
                        <span className="font-medium text-text">No adjustment needed</span>
                        <span className="block text-[11px] text-muted">
                          Same price — only the activity changes.
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                  Reason (required) — why was the original game unavailable?
                </span>
                <textarea
                  className="ui-field min-h-16 w-full"
                  rows={2}
                  placeholder="e.g. Soapy Foose Ball machine under maintenance — customer agreed to bumper cars."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="ui-btn ui-btn-primary min-h-10 px-6 text-sm"
          >
            {submitting ? 'Swapping…' : 'Confirm Swap'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReplaceActivityModal
