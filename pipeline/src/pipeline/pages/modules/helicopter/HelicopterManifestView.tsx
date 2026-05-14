import { useCallback, useEffect, useMemo, useState } from 'react'
import { DataTable } from '../../../components/ui/DataTable'
import { DetailPanel } from '../../../components/ui/DetailPanel'
import {
  checkInHelicopterPassenger,
  getHelicopterConfig,
  listHelicopterBookings,
} from '../../../api/helicopter'
import type { HelicopterBookingView, HelicopterConfigRecord } from '../../../api/types'
import { branchNameFromId, branchOptions, todayIst } from './helicopter-shared'
import { logger } from '../../../../lib/logger'
import { useAuth } from '../../../features/auth/auth-context'

interface ManifestRow {
  bookingId: string
  orderNumber?: string
  customer: string
  seatNumber: number
  name: string
  weight: number
  age?: number
  gender?: string
  checkedInAt?: string
  passengerIndex: number
}

const HelicopterManifestView = () => {
  const { session } = useAuth()
  const canCheckIn =
    session?.user.role === 'Owner' ||
    session?.user.role === 'Admin' ||
    session?.user.role === 'Incharge'
  const [date, setDate] = useState(todayIst())
  const [branchId, setBranchId] = useState('')
  const [bookings, setBookings] = useState<HelicopterBookingView[]>([])
  const [config, setConfig] = useState<HelicopterConfigRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, cfg] = await Promise.all([
        listHelicopterBookings({ date, branchId: branchId || undefined }),
        getHelicopterConfig(),
      ])
      setBookings(list.filter((b) => b.bookingStatus !== 'cancelled'))
      setConfig(cfg)
    } catch (err) {
      logger.error('helicopter.manifest.load_failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load manifest.')
    } finally {
      setLoading(false)
    }
  }, [date, branchId])

  useEffect(() => {
    void load()
  }, [load])

  const rows: ManifestRow[] = useMemo(() => {
    const result: ManifestRow[] = []
    let seat = 1
    for (const booking of bookings) {
      booking.passengers.forEach((passenger, index) => {
        result.push({
          bookingId: booking.bookingId,
          orderNumber: booking.orderNumber,
          customer: booking.customerName || '—',
          seatNumber: seat++,
          name: passenger.name || `Passenger ${index + 1}`,
          weight: passenger.weight ?? 0,
          age: passenger.age,
          gender: passenger.gender,
          checkedInAt: passenger.checkedInAt,
          passengerIndex: index,
        })
      })
    }
    return result
  }, [bookings])

  const totalWeight = rows.reduce((sum, r) => sum + (r.weight ?? 0), 0)
  const maxWeight = config?.maxTotalWeightKg ?? 540
  const overWeight = totalWeight > maxWeight

  const onCheckIn = async (row: ManifestRow) => {
    try {
      await checkInHelicopterPassenger(row.bookingId, row.passengerIndex)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed.')
    }
  }

  const doPrint = () => window.print()

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 print:hidden">
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
        <button type="button" onClick={doPrint} className="ui-btn ui-btn-primary min-h-10 px-4">
          Print manifest
        </button>
      </div>

      <DetailPanel
        title={`Manifest — ${date}${branchId ? ` · ${branchNameFromId(branchId)}` : ''}`}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            <span className="text-muted">Passengers:</span> {rows.length}
          </span>
          <span className={overWeight ? 'font-semibold text-critical' : ''}>
            <span className="text-muted">Total weight:</span> {totalWeight.toFixed(1)} kg /{' '}
            {maxWeight} kg
            {overWeight ? ' (exceeds limit)' : ''}
          </span>
        </div>

        <DataTable<ManifestRow>
          columns={[
            { key: 'seat', header: '#', render: (r) => String(r.seatNumber) },
            { key: 'name', header: 'Passenger', render: (r) => r.name },
            { key: 'weight', header: 'Weight (kg)', render: (r) => String(r.weight || '—') },
            { key: 'age', header: 'Age', render: (r) => (r.age ? String(r.age) : '—') },
            { key: 'gender', header: 'Gender', render: (r) => r.gender ?? '—' },
            { key: 'customer', header: 'Booked by', render: (r) => r.customer },
            {
              key: 'order',
              header: 'Order',
              render: (r) => r.orderNumber ?? r.bookingId.slice(0, 8),
            },
            {
              key: 'checkin',
              header: 'Check-in',
              render: (r) =>
                r.checkedInAt ? (
                  <span className="text-xs text-success">Checked in</span>
                ) : canCheckIn ? (
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary min-h-8 px-2 py-1 text-xs print:hidden"
                    onClick={() => void onCheckIn(r)}
                  >
                    Check in
                  </button>
                ) : (
                  <span className="text-xs text-muted">Pending</span>
                ),
            },
          ]}
          rows={rows}
          rowKey={(r) => `${r.bookingId}-${r.passengerIndex}`}
          emptyMessage={loading ? 'Loading manifest...' : 'No passengers booked.'}
        />
      </DetailPanel>
    </div>
  )
}

export default HelicopterManifestView
