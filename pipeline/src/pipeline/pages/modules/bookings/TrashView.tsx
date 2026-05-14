import { useCallback, useEffect, useMemo, useState } from 'react'
import { AsquareBooking, asquareBookingsApi } from '../../../api/asquare-bookings'
import { useAuth } from '../../../features/auth/auth-context'
import { useLocations } from '../../../hooks/useLocations'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { fmtDateIST, fmtDateTimeFullIST } from '../../../../lib/date-format'
import { formatCurrency, normalizeRole } from './bookings-utils'

type TrashedBooking = AsquareBooking & {
  deletedAt: Date
  deletedBy: { id: string; name: string; role: string }
  /** True for legacy hard-deleted rows from the `deleted_bookings/`
   *  archive — the original doc is gone, so Restore isn't possible. */
  permanentlyDeleted: boolean
}

const TrashView = () => {
  const { session } = useAuth()
  const role = normalizeRole(session?.user.role)
  const actor = {
    id: session?.user.id || 'unknown',
    name: session?.user.name || 'Unknown',
    role,
  }
  const canHardDelete = ['owner', 'admin'].includes(role)

  const { enabledLocations } = useLocations()
  const ADMIN_LOCATIONS = useMemo(
    () => enabledLocations.map((l) => ({ id: l.slug, name: l.displayName })),
    [enabledLocations],
  )

  const [trashed, setTrashed] = useState<TrashedBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmHardDelete, setConfirmHardDelete] = useState<TrashedBooking | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await asquareBookingsApi.listDeletedBookings()
      setTrashed(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Trash.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const term = search.toLowerCase()
    if (!term) return trashed
    return trashed.filter(
      (b) =>
        b.id.toLowerCase().includes(term) ||
        (b.userDisplayName ?? '').toLowerCase().includes(term) ||
        (b.userPhone ?? '').includes(term),
    )
  }, [trashed, search])

  const handleRestore = async (booking: TrashedBooking) => {
    setError(null)
    setBusyId(booking.id)
    const ok = await asquareBookingsApi.restoreBooking(booking.id, booking.userId)
    setBusyId(null)
    if (ok) {
      setSuccess(`Restored ${booking.id} to the live booking list.`)
      void load()
    } else {
      setError(`Failed to restore ${booking.id}. Try again.`)
    }
  }

  const requestHardDelete = async (booking: TrashedBooking) => {
    setError(null)
    setBusyId(booking.id)
    const { allowed, reason } = await asquareBookingsApi.canDeleteBooking(booking)
    setBusyId(null)
    if (!allowed) {
      setError(reason ?? 'This booking cannot be permanently deleted.')
      return
    }
    setConfirmHardDelete(booking)
  }

  const executeHardDelete = async () => {
    if (!confirmHardDelete) return
    const booking = confirmHardDelete
    setConfirmHardDelete(null)
    setBusyId(booking.id)
    const ok = await asquareBookingsApi.deleteBooking(
      booking.id,
      booking.userId,
      actor,
      booking.createdAt,
    )
    setBusyId(null)
    if (ok) {
      setSuccess(
        `${booking.id} permanently deleted. Vendor ledger entries cleared, invoices regenerated.`,
      )
      void load()
    } else {
      setError(`Failed to permanently delete ${booking.id}.`)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ID, name, phone…"
            aria-label="Search Trash"
            className="ui-field min-h-9 w-full pl-8 text-sm"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          >
            ⌕
          </span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh Trash"
          title="Refresh"
          className="ui-btn ui-btn-neutral min-h-9 px-2.5 py-1.5 text-base"
        >
          ↻
        </button>
      </div>

      <div className="rounded-xl border border-border/60 bg-panel/60">
        <table className="w-full table-fixed divide-y divide-border/60 text-sm">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[18%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-surface text-left text-xs uppercase tracking-[0.08em] text-muted">
            <tr>
              <th className="px-3 py-2">Booking</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Branch</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Deleted</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/55">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted">
                  Trash is empty.
                </td>
              </tr>
            ) : (
              filtered.map((b) => {
                const branchName =
                  ADMIN_LOCATIONS.find((l) => l.id === b.locationId)?.name ?? b.locationId
                const isBusy = busyId === b.id
                return (
                  <tr
                    key={b.id}
                    className={
                      b.permanentlyDeleted ? 'opacity-70 hover:bg-panel/40' : 'hover:bg-panel/40'
                    }
                  >
                    <td className="px-3 py-2 align-top">
                      <p
                        className="truncate font-mono text-xs font-semibold text-text"
                        title={b.id}
                      >
                        {b.id}
                      </p>
                      <p className="text-[10px] text-muted">
                        {b.permanentlyDeleted
                          ? 'Permanently deleted (forensic)'
                          : 'In Trash · restorable'}
                      </p>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <p className="truncate text-text" title={String(b.userDisplayName ?? '')}>
                        {b.userDisplayName || b.userId}
                      </p>
                      <p className="text-xs text-muted">{b.userPhone || '—'}</p>
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-muted">{branchName}</td>
                    <td className="px-3 py-2 align-top text-right text-sm font-semibold tabular-nums text-text">
                      {formatCurrency(b.finalAmount)}
                    </td>
                    <td
                      className="px-3 py-2 align-top text-xs text-muted"
                      title={fmtDateTimeFullIST(b.deletedAt)}
                    >
                      {fmtDateIST(b.deletedAt)}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-text">
                      {b.deletedBy.name} <span className="text-muted">({b.deletedBy.role})</span>
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <div className="inline-flex justify-end gap-1.5 whitespace-nowrap">
                        {!b.permanentlyDeleted && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleRestore(b)}
                            className="ui-btn ui-btn-neutral min-h-7 px-2 py-0.5 text-[11px] disabled:opacity-50"
                            title="Restore this booking back to the live list"
                          >
                            {isBusy ? '…' : 'Restore'}
                          </button>
                        )}
                        {canHardDelete && !b.permanentlyDeleted && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void requestHardDelete(b)}
                            className="ui-btn ui-btn-danger min-h-7 px-2 py-0.5 text-[11px] disabled:opacity-50"
                            title="Permanently remove this booking, ledger entries, and regenerate invoices"
                          >
                            Delete permanently
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmHardDelete !== null}
        title="Permanently delete booking"
        description={
          confirmHardDelete
            ? `Permanently delete ${confirmHardDelete.id}? This cannot be undone. The booking record and all linked vendor-ledger entries will be removed, and invoices for the period will regenerate.`
            : ''
        }
        confirmLabel="Delete permanently"
        onConfirm={() => void executeHardDelete()}
        onCancel={() => setConfirmHardDelete(null)}
      />
    </div>
  )
}

export default TrashView
