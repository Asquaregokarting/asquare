import { useCallback, useEffect, useMemo, useState } from 'react'
import { DataTable } from '../../../components/ui/DataTable'
import { DetailPanel } from '../../../components/ui/DetailPanel'
import { SummaryCards } from '../../../components/ui/SummaryCards'
import { listHelicopterBookings, listHelicopterSlots } from '../../../api/helicopter'
import type { HelicopterBookingView, HelicopterSlotRecord } from '../../../api/types'
import { addDaysIso, branchNameFromId, currency, todayIst } from './helicopter-shared'
import { logger } from '../../../../lib/logger'

interface BranchRow {
  branchId: string
  branchName: string
  bookings: number
  seats: number
  revenue: number
  capacity: number
  occupancy: number
}

const HelicopterReportsView = () => {
  const [from, setFrom] = useState(addDaysIso(todayIst(), -7))
  const [to, setTo] = useState(todayIst())
  const [bookings, setBookings] = useState<HelicopterBookingView[]>([])
  const [slots, setSlots] = useState<HelicopterSlotRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [allBookings, slotsList] = await Promise.all([
        listHelicopterBookings({}),
        listHelicopterSlots({ fromDate: from, toDate: to }),
      ])
      const filtered = allBookings.filter((b) => {
        if (!b.sessionDate) return false
        return b.sessionDate >= from && b.sessionDate <= to
      })
      setBookings(filtered)
      setSlots(slotsList)
    } catch (err) {
      logger.error('helicopter.reports.load_failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load reports.')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo(() => {
    const paid = bookings.filter(
      (b) => b.paymentStatus === 'completed' || b.bookingStatus === 'confirmed',
    )
    const totalRevenue = paid.reduce((s, b) => s + b.totalAmount, 0)
    const totalSeats = paid.reduce((s, b) => s + b.seats, 0)
    const noShow = bookings.filter(
      (b) =>
        b.passengers.length > 0 &&
        b.passengers.every((p) => !p.checkedInAt) &&
        b.sessionDate &&
        b.sessionDate < todayIst(),
    ).length
    const capacity = slots.reduce((s, x) => s + x.maxSeats, 0)
    const occupancy = capacity > 0 ? (totalSeats / capacity) * 100 : 0
    return { totalRevenue, totalSeats, noShow, occupancy, bookingsCount: paid.length, capacity }
  }, [bookings, slots])

  const byBranch: BranchRow[] = useMemo(() => {
    const byId = new Map<string, BranchRow>()
    for (const booking of bookings) {
      const id = booking.branchId ?? 'unknown'
      const row = byId.get(id) ?? {
        branchId: id,
        branchName: branchNameFromId(id),
        bookings: 0,
        seats: 0,
        revenue: 0,
        capacity: 0,
        occupancy: 0,
      }
      row.bookings += 1
      row.seats += booking.seats
      if (booking.paymentStatus === 'completed' || booking.bookingStatus === 'confirmed') {
        row.revenue += booking.totalAmount
      }
      byId.set(id, row)
    }
    for (const slot of slots) {
      const row = byId.get(slot.branchId)
      if (row) row.capacity += slot.maxSeats
    }
    for (const row of byId.values()) {
      row.occupancy = row.capacity > 0 ? (row.seats / row.capacity) * 100 : 0
    }
    return Array.from(byId.values()).sort((a, b) => b.revenue - a.revenue)
  }, [bookings, slots])

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
            From
          </label>
          <input
            className="ui-field min-h-10"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            To
          </label>
          <input
            className="ui-field min-h-10"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="ui-btn ui-btn-neutral min-h-10 px-3"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      <SummaryCards
        items={[
          {
            id: 'revenue',
            label: 'Revenue',
            value: currency(summary.totalRevenue),
            tone: 'success',
          },
          {
            id: 'bookings',
            label: 'Confirmed bookings',
            value: String(summary.bookingsCount),
            tone: 'info',
          },
          {
            id: 'occupancy',
            label: 'Occupancy',
            value: `${summary.occupancy.toFixed(1)}%`,
            tone: summary.occupancy >= 80 ? 'warning' : 'muted',
          },
          {
            id: 'noshow',
            label: 'No-shows',
            value: String(summary.noShow),
            tone: summary.noShow > 0 ? 'critical' : 'muted',
          },
        ]}
      />

      <DetailPanel title="By branch">
        <DataTable<BranchRow>
          columns={[
            { key: 'branch', header: 'Branch', render: (r) => r.branchName },
            { key: 'bookings', header: 'Bookings', render: (r) => String(r.bookings) },
            { key: 'seats', header: 'Seats', render: (r) => String(r.seats) },
            { key: 'capacity', header: 'Capacity', render: (r) => String(r.capacity) },
            {
              key: 'occupancy',
              header: 'Occupancy',
              render: (r) => `${r.occupancy.toFixed(1)}%`,
            },
            { key: 'revenue', header: 'Revenue', render: (r) => currency(r.revenue) },
          ]}
          rows={byBranch}
          rowKey={(r) => r.branchId}
          emptyMessage={loading ? 'Loading...' : 'No data for this range.'}
        />
      </DetailPanel>
    </div>
  )
}

export default HelicopterReportsView
