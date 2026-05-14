import { useCallback, useEffect, useMemo, useState } from 'react'
import { AsquareBooking, asquareBookingsApi } from '../../../api/asquare-bookings'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { useAuth } from '../../../features/auth/auth-context'
import { fmtDateIST } from '../../../../lib/date-format'
import { getLocationDisplayName } from '../../../../lib/locations'
import { normalizeRole, PROTOCOL_MAX_LAPS } from './bookings-utils'

const ProtocolApprovalView = () => {
  const { session } = useAuth()
  const role = normalizeRole(session?.user.role)
  const isOwner = role === 'owner'
  const actor = {
    id: session?.user.id || 'unknown',
    name: session?.user.name || 'Unknown',
    role,
  }

  const [protocolBookings, setProtocolBookings] = useState<AsquareBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [rejectReasonMap, setRejectReasonMap] = useState<Record<string, string>>({})
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
    type: 'approve' | 'reject'
    orderNumber: string
  } | null>(null)

  const loadProtocol = useCallback(async () => {
    setLoading(true)
    try {
      const bookings = await asquareBookingsApi.listProtocolBookings()
      setProtocolBookings(bookings)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load protocol bookings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProtocol()
  }, [loadProtocol])

  const handleApprove = async (orderNumber: string) => {
    if (!isOwner) {
      setActionError('Only the Owner can approve protocol bookings.')
      return
    }
    setProcessingId(orderNumber)
    setActionError(null)
    try {
      await asquareBookingsApi.approveProtocol(orderNumber, { id: actor.id, name: actor.name })
      setActionSuccess(`Protocol ${orderNumber} approved and confirmed.`)
      await loadProtocol()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve.')
    } finally {
      setProcessingId(null)
    }
  }

  const handleReject = async (orderNumber: string) => {
    if (!isOwner) {
      setActionError('Only the Owner can reject protocol bookings.')
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
      await asquareBookingsApi.rejectProtocol(
        orderNumber,
        { id: actor.id, name: actor.name },
        reason,
      )
      setActionSuccess(`Protocol ${orderNumber} rejected.`)
      setRejectReasonMap((prev) => {
        const next = { ...prev }
        delete next[orderNumber]
        return next
      })
      await loadProtocol()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reject.')
    } finally {
      setProcessingId(null)
    }
  }

  const pending = useMemo(
    () =>
      protocolBookings.filter(
        (b) => (b as Record<string, unknown>).protocolStatus === 'pending_approval',
      ),
    [protocolBookings],
  )
  const resolved = useMemo(
    () =>
      protocolBookings.filter(
        (b) => (b as Record<string, unknown>).protocolStatus !== 'pending_approval',
      ),
    [protocolBookings],
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
      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
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
        <p className="text-sm text-muted">Loading protocol bookings...</p>
      ) : pending.length === 0 && resolved.length === 0 ? (
        <p className="text-sm text-muted">No protocol bookings found.</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-warning">
                Pending Approval ({pending.length})
              </h4>
              {pending.map((booking) => {
                const raw = booking as unknown as Record<string, unknown>
                return (
                  <div
                    key={booking.id}
                    className="rounded-xl border border-warning/30 bg-warning/5 p-4"
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
                            {String(raw.protocolRequestedBy ?? raw.createdByAdminName ?? 'Unknown')}
                          </span>
                          {raw.createdByRole ? ` (${String(raw.createdByRole)})` : ''}
                        </p>
                        {Boolean(raw.protocolReason) && (
                          <p className="text-xs text-muted break-words">
                            Reason:{' '}
                            <span className="italic text-text">{String(raw.protocolReason)}</span>
                          </p>
                        )}
                        <p className="text-xs font-medium text-warning">
                          Go-Karting — Free Entry (max {PROTOCOL_MAX_LAPS} laps)
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
                          Only the Owner can approve or reject protocol bookings.
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
                const status = String(raw.protocolStatus ?? 'unknown')
                return (
                  <div key={booking.id} className="rounded-xl border border-border bg-surface p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-text">{booking.id}</p>
                          {statusBadge(status)}
                        </div>
                        <p className="text-sm text-muted">
                          {String(raw.userDisplayName ?? raw.customerName ?? 'Unknown')} &middot;{' '}
                          {String(raw.userPhone ?? raw.customerPhone ?? '')}
                        </p>
                        <p className="text-xs text-muted">
                          Branch:{' '}
                          <span className="font-medium text-text">
                            {getLocationDisplayName(booking.locationId)}
                          </span>
                        </p>
                        <p className="text-xs text-muted">Date: {fmtDateIST(booking.createdAt)}</p>
                        {(() => {
                          const items = booking.items ?? []
                          const count = items.length
                          return (
                            <>
                              <p className="text-xs text-muted">
                                {count} {count === 1 ? 'Game' : 'Games'}
                                {count > 0 ? ':' : ''}
                              </p>
                              {count > 0 && (
                                <ul className="ml-3 space-y-0.5 text-xs text-muted">
                                  {items.map((item, idx) => (
                                    <li key={idx}>
                                      •{' '}
                                      <span className="text-text/80">
                                        {item.activity?.name ?? 'Activity'}
                                      </span>
                                      {' × '}
                                      {item.quantity || 1}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </>
                          )
                        })()}
                        {Boolean(raw.protocolReason) && (
                          <p className="text-xs text-muted">Reason: {String(raw.protocolReason)}</p>
                        )}
                        {status === 'approved' && Boolean(raw.protocolApprovedBy) && (
                          <p className="text-xs text-success">
                            Approved by {String(raw.protocolApprovedBy)}
                          </p>
                        )}
                        {status === 'rejected' && (
                          <p className="text-xs text-critical">
                            Rejected by {String(raw.protocolRejectedBy ?? 'Unknown')}
                            {raw.protocolRejectReason
                              ? ` — ${String(raw.protocolRejectReason)}`
                              : ''}
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
        title={
          confirmAction?.type === 'approve' ? 'Approve Protocol Booking' : 'Reject Protocol Booking'
        }
        description={
          confirmAction?.type === 'approve'
            ? `Approve protocol booking ${confirmAction?.orderNumber}? This will confirm the free Go-Karting entry.`
            : `Reject protocol booking ${confirmAction?.orderNumber}?`
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

export default ProtocolApprovalView
