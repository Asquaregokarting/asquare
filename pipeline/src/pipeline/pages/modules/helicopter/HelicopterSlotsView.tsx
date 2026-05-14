import { FormEvent, useCallback, useEffect, useState } from 'react'
import { DataTable } from '../../../components/ui/DataTable'
import { DetailPanel } from '../../../components/ui/DetailPanel'
import {
  bulkCreateHelicopterSlots,
  createHelicopterSlot,
  deleteHelicopterSlot,
  listHelicopterSlots,
  updateHelicopterSlot,
  getHelicopterConfig,
} from '../../../api/helicopter'
import type { HelicopterConfigRecord, HelicopterSlotRecord } from '../../../api/types'
import {
  branchNameFromId,
  branchOptions,
  currency,
  nextNDates,
  todayIst,
} from './helicopter-shared'
import { logger } from '../../../../lib/logger'
import { useAuth } from '../../../features/auth/auth-context'

const HelicopterSlotsView = () => {
  const { session } = useAuth()
  const isPrivileged =
    session?.user.role === 'Owner' ||
    session?.user.role === 'Admin' ||
    session?.user.role === 'Developer' ||
    session?.user.role === 'Backend'
  const [slots, setSlots] = useState<HelicopterSlotRecord[]>([])
  const [config, setConfig] = useState<HelicopterConfigRecord | null>(null)
  const [branchFilter, setBranchFilter] = useState('')
  const [fromDate, setFromDate] = useState(todayIst())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, cfg] = await Promise.all([
        listHelicopterSlots({ branchId: branchFilter || undefined, fromDate }),
        getHelicopterConfig(),
      ])
      setSlots(list)
      setConfig(cfg)
    } catch (err) {
      logger.error('helicopter.slots.load_failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load slots.')
    } finally {
      setLoading(false)
    }
  }, [branchFilter, fromDate])

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isPrivileged) return
    const form = new FormData(event.currentTarget)
    const branchId = String(form.get('branchId') ?? '')
    if (config && config.branchEnabled[branchId] === false) {
      setError(
        `Branch ${branchNameFromId(branchId)} is disabled — enable it from the Dashboard first.`,
      )
      return
    }
    try {
      await createHelicopterSlot({
        date: String(form.get('date') ?? ''),
        startTime: String(form.get('startTime') ?? ''),
        branchId,
        branchName: branchNameFromId(branchId),
        maxSeats: Number(form.get('maxSeats') ?? 6),
        pricePerSeat: Number(form.get('pricePerSeat') ?? 0),
      })
      ;(event.currentTarget as HTMLFormElement).reset()
      setSuccess('Slot created.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create slot.')
    }
  }

  const onBulkGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isPrivileged) return
    const form = new FormData(event.currentTarget)
    const branchId = String(form.get('branchId') ?? '')
    const days = Math.max(1, Math.min(60, Number(form.get('days') ?? 7)))
    const times = String(form.get('times') ?? '10:00,12:00,16:00')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    try {
      const created = await bulkCreateHelicopterSlots({
        dates: nextNDates(days),
        times,
        branchId,
        branchName: branchNameFromId(branchId),
        maxSeats: Number(form.get('maxSeats') ?? 6),
        pricePerSeat: Number(form.get('pricePerSeat') ?? 4999),
      })
      setSuccess(`Created ${created.length} slots.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bulk create.')
    }
  }

  const setStatus = async (slot: HelicopterSlotRecord, status: HelicopterSlotRecord['status']) => {
    try {
      await updateHelicopterSlot(slot.id, { status })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update slot.')
    }
  }

  const remove = async (slot: HelicopterSlotRecord) => {
    if (!confirm(`Delete slot ${slot.date} ${slot.startTime}?`)) return
    try {
      await deleteHelicopterSlot(slot.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.')
    }
  }

  return (
    <div className="space-y-5">
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

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Branch
          </label>
          <select
            className="ui-field min-h-10"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
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
            From
          </label>
          <input
            type="date"
            className="ui-field min-h-10"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
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

      {isPrivileged && (
        <DetailPanel title="Add a slot">
          <form className="grid grid-cols-2 gap-2 md:grid-cols-6" onSubmit={onCreate}>
            <input
              className="ui-field min-h-10"
              name="date"
              type="date"
              defaultValue={todayIst()}
              required
            />
            <input
              className="ui-field min-h-10"
              name="startTime"
              type="time"
              defaultValue="10:00"
              required
            />
            <select className="ui-field min-h-10" name="branchId" required>
              <option value="">Branch</option>
              {branchOptions().map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
            <input
              className="ui-field min-h-10"
              name="maxSeats"
              type="number"
              min={1}
              max={20}
              defaultValue={6}
              placeholder="Seats"
              required
            />
            <input
              className="ui-field min-h-10"
              name="pricePerSeat"
              type="number"
              min={0}
              defaultValue={4999}
              placeholder="Price"
              required
            />
            <button type="submit" className="ui-btn ui-btn-primary min-h-10">
              Add slot
            </button>
          </form>
        </DetailPanel>
      )}

      {isPrivileged && (
        <DetailPanel title="Bulk generate (next N days)">
          <form className="grid grid-cols-2 gap-2 md:grid-cols-6" onSubmit={onBulkGenerate}>
            <select className="ui-field min-h-10" name="branchId" required>
              <option value="">Branch</option>
              {branchOptions().map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
            <input
              className="ui-field min-h-10"
              name="days"
              type="number"
              min={1}
              max={60}
              defaultValue={7}
              placeholder="Days"
              required
            />
            <input
              className="ui-field min-h-10"
              name="times"
              defaultValue="10:00,12:00,16:00"
              placeholder="Times comma sep"
              required
            />
            <input
              className="ui-field min-h-10"
              name="maxSeats"
              type="number"
              min={1}
              max={20}
              defaultValue={6}
              required
            />
            <input
              className="ui-field min-h-10"
              name="pricePerSeat"
              type="number"
              min={0}
              defaultValue={4999}
              required
            />
            <button type="submit" className="ui-btn ui-btn-primary min-h-10">
              Generate
            </button>
          </form>
        </DetailPanel>
      )}

      <DataTable<HelicopterSlotRecord>
        columns={[
          { key: 'date', header: 'Date', render: (s) => s.date },
          { key: 'time', header: 'Time', render: (s) => s.startTime },
          { key: 'branch', header: 'Branch', render: (s) => branchNameFromId(s.branchId) },
          {
            key: 'seats',
            header: 'Seats',
            render: (s) => `${s.bookedSeats} / ${s.maxSeats}`,
          },
          { key: 'price', header: 'Price', render: (s) => currency(s.pricePerSeat) },
          { key: 'status', header: 'Status', render: (s) => s.status },
          {
            key: 'actions',
            header: 'Actions',
            render: (s) =>
              isPrivileged ? (
                <div className="flex gap-2">
                  {s.status !== 'Closed' && (
                    <button
                      type="button"
                      onClick={() => void setStatus(s, 'Closed')}
                      className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                    >
                      Close
                    </button>
                  )}
                  {s.status === 'Closed' && (
                    <button
                      type="button"
                      onClick={() => void setStatus(s, 'Open')}
                      className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                    >
                      Open
                    </button>
                  )}
                  {s.status !== 'Cancelled' && (
                    <button
                      type="button"
                      onClick={() => void setStatus(s, 'Cancelled')}
                      className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                    >
                      Cancel
                    </button>
                  )}
                  {s.bookedSeats === 0 && (
                    <button
                      type="button"
                      onClick={() => void remove(s)}
                      className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs text-critical"
                    >
                      Delete
                    </button>
                  )}
                </div>
              ) : (
                <span className="text-xs text-muted">Read-only</span>
              ),
          },
        ]}
        rows={slots}
        rowKey={(s) => s.id}
        emptyMessage={loading ? 'Loading slots...' : 'No slots configured.'}
      />
    </div>
  )
}

export default HelicopterSlotsView
