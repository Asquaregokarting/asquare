import { useCallback, useEffect, useMemo, useState } from 'react'
import { AsquareBooking, asquareBookingsApi } from '../../../api/asquare-bookings'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { useAuth } from '../../../features/auth/auth-context'
import { fmtDateIST } from '../../../../lib/date-format'
import { normalizeRole } from './bookings-utils'

const OfferApprovalView = () => {
  const { session } = useAuth()
  const role = normalizeRole(session?.user.role)
  const isOwner = role === 'owner'
  const actor = {
    id: session?.user.id || 'unknown',
    name: session?.user.name || 'Unknown',
    role,
  }

  const [offerBookings, setOfferBookings] = useState<AsquareBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [rejectReasonMap, setRejectReasonMap] = useState<Record<string, string>>({})
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
    type: 'approve' | 'reject'
    orderNumber: string
  } | null>(null)

  const loadOffers = useCallback(async () => {
    setLoading(true)
    try {
      const bookings = await asquareBookingsApi.listOfferBookings()
      setOfferBookings(bookings)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load offer bookings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOffers()
  }, [loadOffers])

  const handleApprove = async (orderNumber: string) => {
    if (!isOwner) {
      setActionError('Only the Owner can approve offer bookings.')
      return
    }
    setProcessingId(orderNumber)
    setActionError(null)
    try {
      await asquareBookingsApi.approveOffer(orderNumber, { id: actor.id, name: actor.name })
      setActionSuccess(`Offer ${orderNumber} approved and confirmed.`)
      await loadOffers()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve.')
    } finally {
      setProcessingId(null)
    }
  }

  const handleReject = async (orderNumber: string) => {
    if (!isOwner) {
      setActionError('Only the Owner can reject offer bookings.')
      return
    }
    const reason = rejectReasonMap[orderNumber]?.trim()
    if (!reason) {
      setActionError('Please provide a reason for rejection.')
      return
    }
    setProcessingId(orderNumber)
    setActionError(null)
    try {
      await asquareBookingsApi.rejectOffer(orderNumber, { id: actor.id, name: actor.name }, reason)
      setActionSuccess(`Offer ${orderNumber} rejected.`)
      setRejectReasonMap((prev) => {
        const next = { ...prev }
        delete next[orderNumber]
        return next
      })
      await loadOffers()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reject.')
    } finally {
      setProcessingId(null)
    }
  }

  const currency = (value: number): string => `₹${Math.round(value || 0).toLocaleString('en-IN')}`

  const pending = useMemo(
    () =>
      offerBookings.filter(
        (b) => (b as Record<string, unknown>).offerStatus === 'pending_approval',
      ),
    [offerBookings],
  )
  const resolved = useMemo(
    () =>
      offerBookings.filter(
        (b) => (b as Record<string, unknown>).offerStatus !== 'pending_approval',
      ),
    [offerBookings],
  )

  const statusBadge = (status: string) => {
    if (status === 'approved')
      return (
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
          Approved
        </span>
      )
    if (status === 'rejected')
      return (
        <span className="rounded-full bg-critical/15 px-2 py-0.5 text-xs font-semibold text-critical">
          Rejected
        </span>
      )
    return (
      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
        Pending
      </span>
    )
  }

  return (
    <div className="space-y-4">
      {actionError && (
        <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {actionError}
        </p>
      )}
      {actionSuccess && (
        <p className="rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {actionSuccess}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading offer bookings...</p>
      ) : pending.length === 0 && resolved.length === 0 ? (
        <p className="text-sm text-muted">No offer bookings found.</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-blue-700">
                Pending Approval ({pending.length})
              </h4>
              {pending.map((booking) => {
                const raw = booking as unknown as Record<string, unknown>
                return (
                  <div
                    key={booking.id}
                    className="rounded-xl border border-blue-300/30 bg-blue-50/50 p-4"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                      <div className="space-y-1 min-w-0 flex-1">
                        <p className="font-semibold text-text break-all">{booking.id}</p>
                        <p className="text-sm text-muted">
                          {String(raw.userDisplayName ?? raw.customerName ?? 'Unknown')} &middot;{' '}
                          {String(raw.userPhone ?? raw.customerPhone ?? '')}
                        </p>
                        <p className="text-xs text-muted">
                          Branch: {booking.locationId} &middot; Created:{' '}
                          {fmtDateIST(booking.createdAt)}
                        </p>
                        <p className="text-xs text-muted">
                          Requested by:{' '}
                          <span className="font-medium text-text">
                            {String(raw.offerRequestedBy ?? raw.createdByAdminName ?? 'Unknown')}
                          </span>
                          {raw.createdByRole ? ` (${String(raw.createdByRole)})` : ''}
                        </p>
                        {Boolean(raw.offerReason) && (
                          <p className="text-xs text-muted break-words">
                            Reason:{' '}
                            <span className="italic text-text">{String(raw.offerReason)}</span>
                          </p>
                        )}
                        <p className="text-xs font-medium text-blue-700">
                          Go-Karting Offer — {currency(Number(raw.totalAmount ?? 0))} (
                          {String(raw.paymentMethod ?? 'Cash')})
                        </p>
                      </div>
                      {isOwner && (
                        <div className="flex flex-col gap-2 w-full lg:w-56 lg:shrink-0">
                          <button
                            type="button"
                            disabled={processingId === booking.id}
                            onClick={() =>
                              setConfirmAction({ type: 'approve', orderNumber: booking.id })
                            }
                            className="ui-btn ui-btn-success min-h-9 w-full text-xs disabled:opacity-50"
                          >
                            {processingId === booking.id ? 'Processing...' : 'Approve'}
                          </button>
                          <input
                            className="ui-field min-h-8 w-full text-xs"
                            placeholder="Rejection reason"
                            value={rejectReasonMap[booking.id] ?? ''}
                            onChange={(e) =>
                              setRejectReasonMap((prev) => ({
                                ...prev,
                                [booking.id]: e.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            disabled={processingId === booking.id}
                            onClick={() =>
                              setConfirmAction({ type: 'reject', orderNumber: booking.id })
                            }
                            className="ui-btn ui-btn-critical min-h-9 w-full text-xs disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {!isOwner && (
                        <div className="rounded-lg bg-muted/10 px-3 py-2 text-xs text-muted">
                          Only the Owner can approve or reject offer bookings.
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {resolved.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">
                History ({resolved.length})
              </h4>
              {resolved.map((booking) => {
                const raw = booking as unknown as Record<string, unknown>
                const status = String(raw.offerStatus ?? 'unknown')
                return (
                  <div key={booking.id} className="rounded-xl border border-border bg-surface p-4">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-text break-all">{booking.id}</p>
                          {statusBadge(status)}
                        </div>
                        <p className="text-sm text-muted">
                          {String(raw.userDisplayName ?? raw.customerName ?? 'Unknown')} &middot;{' '}
                          {String(raw.userPhone ?? raw.customerPhone ?? '')}
                        </p>
                        {Boolean(raw.offerReason) && (
                          <p className="text-xs text-muted">Reason: {String(raw.offerReason)}</p>
                        )}
                        <p className="text-xs text-muted">
                          {currency(Number(raw.totalAmount ?? 0))} (
                          {String(raw.paymentMethod ?? 'Cash')})
                        </p>
                        {status === 'approved' && Boolean(raw.offerApprovedBy) && (
                          <p className="text-xs text-success">
                            Approved by {String(raw.offerApprovedBy)}
                          </p>
                        )}
                        {status === 'rejected' && (
                          <p className="text-xs text-critical">
                            Rejected
                            {raw.offerRejectReason ? ` — ${String(raw.offerRejectReason)}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.type === 'approve' ? 'Approve Offer Booking' : 'Reject Offer Booking'}
        description={
          confirmAction?.type === 'approve'
            ? `Approve offer booking ${confirmAction?.orderNumber}? This will confirm the billing transaction.`
            : `Reject offer booking ${confirmAction?.orderNumber}?`
        }
        confirmLabel={confirmAction?.type === 'approve' ? 'Approve' : 'Reject'}
        onConfirm={() => {
          if (!confirmAction) return
          if (confirmAction.type === 'approve') {
            void handleApprove(confirmAction.orderNumber)
          } else {
            void handleReject(confirmAction.orderNumber)
          }
          setConfirmAction(null)
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}

export default OfferApprovalView
