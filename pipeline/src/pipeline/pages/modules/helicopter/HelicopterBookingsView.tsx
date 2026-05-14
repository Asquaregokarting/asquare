import { useCallback, useEffect, useState } from 'react'
import { DataTable } from '../../../components/ui/DataTable'
import { DetailPanel } from '../../../components/ui/DetailPanel'
import {
  cancelHelicopterBooking,
  checkInHelicopterPassenger,
  listHelicopterBookings,
} from '../../../api/helicopter'
import type { HelicopterBookingView as BookingView } from '../../../api/types'
import { branchNameFromId, branchOptions, currency } from './helicopter-shared'
import { useAuth } from '../../../features/auth/auth-context'
import { logger } from '../../../../lib/logger'

const STATUS_OPTIONS = ['', 'confirmed', 'pending', 'completed', 'cancelled']

const HelicopterBookingsView = () => {
  const { session } = useAuth()
  const canMutate =
    session?.user.role === 'Owner' ||
    session?.user.role === 'Admin' ||
    session?.user.role === 'Incharge' ||
    session?.user.role === 'Developer' ||
    session?.user.role === 'Backend'
  const [branchId, setBranchId] = useState('')
  const [date, setDate] = useState('')
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<BookingView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<BookingView | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listHelicopterBookings({
        branchId: branchId || undefined,
        date: date || undefined,
        status: status || undefined,
      })
      setRows(data)
    } catch (err) {
      logger.error('helicopter.bookings.load_failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load bookings.')
    } finally {
      setLoading(false)
    }
  }, [branchId, date, status])

  useEffect(() => {
    void load()
  }, [load])

  const onCheckIn = async (bookingId: string, index: number) => {
    try {
      await checkInHelicopterPassenger(bookingId, index)
      await load()
      if (selected && selected.bookingId === bookingId) {
        const refreshed = rows.find((r) => r.bookingId === bookingId)
        if (refreshed) setSelected(refreshed)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed.')
    }
  }

  const onCancel = async (bookingId: string) => {
    const reason = prompt('Cancellation reason?') ?? ''
    if (!reason) return
    try {
      await cancelHelicopterBooking(bookingId, reason)
      await load()
      setSelected(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed.')
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Branch
          </label>
          <select
            className="ui-field min-h-10"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">All branches</option>
            {branchOptions().map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Date
          </label>
          <input
            className="ui-field min-h-10"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Status
          </label>
          <select
            className="ui-field min-h-10"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || 'Any'}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="ui-btn ui-btn-neutral min-h-10 px-3"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      <DataTable<BookingView>
        columns={[
          { key: 'date', header: 'Date', render: (r) => r.sessionDate ?? '—' },
          { key: 'time', header: 'Time', render: (r) => r.startTime ?? '—' },
          { key: 'customer', header: 'Customer', render: (r) => r.customerName || '—' },
          { key: 'phone', header: 'Phone', render: (r) => r.customerPhone || '—' },
          { key: 'branch', header: 'Branch', render: (r) => branchNameFromId(r.branchId ?? '') },
          { key: 'seats', header: 'Seats', render: (r) => String(r.seats) },
          { key: 'weight', header: 'Weight (kg)', render: (r) => r.totalWeightKg.toFixed(1) },
          { key: 'amount', header: 'Amount', render: (r) => currency(r.totalAmount) },
          { key: 'status', header: 'Status', render: (r) => r.bookingStatus },
        ]}
        rows={rows}
        rowKey={(r) => r.bookingId}
        emptyMessage={loading ? 'Loading bookings...' : 'No helicopter bookings found.'}
        onRowClick={(r) => setSelected(r)}
      />

      {selected && (
        <DetailPanel title={`Booking ${selected.orderNumber ?? selected.bookingId}`}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <div>
                <span className="text-muted">Customer:</span> {selected.customerName || '—'}
              </div>
              <div>
                <span className="text-muted">Phone:</span> {selected.customerPhone || '—'}
              </div>
              <div>
                <span className="text-muted">Date:</span> {selected.sessionDate ?? '—'}
              </div>
              <div>
                <span className="text-muted">Time:</span> {selected.startTime ?? '—'}
              </div>
              <div>
                <span className="text-muted">Seats:</span> {selected.seats}
              </div>
              <div>
                <span className="text-muted">Weight:</span> {selected.totalWeightKg.toFixed(1)} kg
              </div>
              <div>
                <span className="text-muted">Amount:</span> {currency(selected.totalAmount)}
              </div>
              <div>
                <span className="text-muted">Status:</span> {selected.bookingStatus}
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Passengers
              </h4>
              <div className="space-y-2">
                {selected.passengers.length === 0 && (
                  <p className="text-sm text-muted">No passenger details captured.</p>
                )}
                {selected.passengers.map((p, i) => (
                  <div
                    key={`${selected.bookingId}-${i}`}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/60 px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">{p.name || `Passenger ${i + 1}`}</span>
                      {p.weight ? ` · ${p.weight}kg` : ''}
                      {p.age ? ` · ${p.age}y` : ''}
                      {p.gender ? ` · ${p.gender}` : ''}
                    </span>
                    <span className="flex items-center gap-2">
                      {p.checkedInAt ? (
                        <span className="text-xs text-success">Checked in</span>
                      ) : canMutate ? (
                        <button
                          type="button"
                          className="ui-btn ui-btn-primary min-h-8 px-2 py-1 text-xs"
                          onClick={() => void onCheckIn(selected.bookingId, i)}
                        >
                          Check in
                        </button>
                      ) : (
                        <span className="text-xs text-muted">Pending</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="ui-btn ui-btn-neutral min-h-8 px-3 py-1 text-xs"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
              {canMutate && selected.bookingStatus !== 'cancelled' && (
                <button
                  type="button"
                  className="ui-btn min-h-8 rounded-lg border border-critical/45 bg-critical/10 px-3 py-1 text-xs text-critical"
                  onClick={() => void onCancel(selected.bookingId)}
                >
                  Cancel booking
                </button>
              )}
            </div>
          </div>
        </DetailPanel>
      )}
    </div>
  )
}

export default HelicopterBookingsView
