import { useEffect, useState } from 'react'
import { SummaryCards } from '../../../components/ui/SummaryCards'
import { DetailPanel } from '../../../components/ui/DetailPanel'
import { DataTable } from '../../../components/ui/DataTable'
import { useAuth } from '../../../features/auth/auth-context'
import {
  getHelicopterDashboardSummary,
  updateHelicopterConfig,
  setHelicopterBranchEnabled,
  type HelicopterDashboardSummary,
} from '../../../api/helicopter'
import type { HelicopterSlotRecord } from '../../../api/types'
import { branchOptions, currency, branchNameFromId } from './helicopter-shared'
import { logger } from '../../../../lib/logger'

const HelicopterDashboardView = () => {
  const { session } = useAuth()
  const isPrivileged = session?.user.role === 'Owner' || session?.user.role === 'Admin'
  const [branchId, setBranchId] = useState('')
  const [summary, setSummary] = useState<HelicopterDashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async (branch?: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await getHelicopterDashboardSummary(branch || undefined)
      setSummary(data)
    } catch (err) {
      logger.error('helicopter.dashboard.load_failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(branchId)
  }, [branchId])

  const toggleMaster = async () => {
    if (!summary || !session || !isPrivileged) return
    setSaving(true)
    try {
      await updateHelicopterConfig({ enabled: !summary.config.enabled }, session.user.id)
      await load(branchId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle.')
    } finally {
      setSaving(false)
    }
  }

  const toggleEarlyBird = async () => {
    if (!summary || !session || !isPrivileged) return
    setSaving(true)
    try {
      await updateHelicopterConfig(
        { earlyBirdEnabled: !summary.config.earlyBirdEnabled },
        session.user.id,
      )
      await load(branchId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle early bird.')
    } finally {
      setSaving(false)
    }
  }

  const toggleBranch = async (branch: string) => {
    if (!summary || !session || !isPrivileged) return
    const current = summary.config.branchEnabled[branch] !== false
    setSaving(true)
    try {
      await setHelicopterBranchEnabled(branch, !current, session.user.id)
      await load(branchId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle branch.')
    } finally {
      setSaving(false)
    }
  }

  const progress = summary
    ? Math.min(1, summary.counter.count / Math.max(1, summary.counter.earlyBirdThreshold))
    : 0

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">Branch</label>
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

        {summary && isPrivileged && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void toggleMaster()}
              className={`ui-btn min-h-10 px-4 ${
                summary.config.enabled ? 'ui-btn-neutral' : 'ui-btn-primary'
              }`}
            >
              {summary.config.enabled
                ? 'Disable all helicopter bookings'
                : 'Enable all helicopter bookings'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void toggleEarlyBird()}
              className="ui-btn ui-btn-neutral min-h-10 px-4"
            >
              Early bird: {summary.config.earlyBirdEnabled ? 'On' : 'Off'}
            </button>
          </div>
        )}
      </div>

      {summary && !summary.config.enabled && (
        <p className="rounded-lg border border-warning/45 bg-warning/10 px-3 py-2 text-sm text-warning">
          Helicopter bookings are globally disabled. Customers see a closed banner.
        </p>
      )}

      {summary && (
        <SummaryCards
          items={[
            {
              id: 'today-slots',
              label: `Slots ${summary.todayDate}`,
              value: String(summary.todaySlots),
              tone: 'info',
            },
            {
              id: 'today-booked',
              label: 'Seats booked today',
              value: `${summary.todayBooked} / ${summary.todayCapacity || 0}`,
              tone: summary.todayBooked >= summary.todayCapacity ? 'warning' : 'success',
            },
            {
              id: 'today-revenue',
              label: 'Today revenue',
              value: currency(summary.todayRevenue),
              tone: 'success',
            },
            {
              id: 'early-bird',
              label: `Early bird ${summary.config.earlyBirdEnabled ? 'on' : 'off'}`,
              value: `${summary.counter.count} / ${summary.counter.earlyBirdThreshold}`,
              tone: progress >= 1 ? 'muted' : 'warning',
            },
          ]}
        />
      )}

      <DetailPanel title="Per-branch availability">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {branchOptions().map((b) => {
            const on = summary ? summary.config.branchEnabled[b.value] !== false : true
            return (
              <div
                key={b.value}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/60 px-3 py-2"
              >
                <span className="text-sm font-medium text-text">{b.label}</span>
                {isPrivileged ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void toggleBranch(b.value)}
                    className={`ui-btn min-h-8 px-3 py-1 text-xs ${
                      on ? 'ui-btn-neutral' : 'ui-btn-primary'
                    }`}
                  >
                    {on ? 'Enabled' : 'Disabled'}
                  </button>
                ) : (
                  <span className="text-xs text-muted">{on ? 'Enabled' : 'Disabled'}</span>
                )}
              </div>
            )
          })}
        </div>
      </DetailPanel>

      <DetailPanel title="Upcoming slots">
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
          ]}
          rows={summary?.upcomingSlots ?? []}
          rowKey={(s) => s.id}
          emptyMessage={loading ? 'Loading slots...' : 'No upcoming slots.'}
        />
      </DetailPanel>
    </div>
  )
}

export default HelicopterDashboardView
