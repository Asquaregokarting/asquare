import { useCallback, useEffect, useState } from 'react'
import {
  couponOutreachApi,
  type CouponOutreachBatch,
  type CouponOutreachConfig,
  istDateString,
} from '../../../api/coupon-outreach'
import { useAuth } from '../../../features/auth/auth-context'
import { logger } from '../../../../lib/logger'

interface PerTelecallerRow {
  telecallerId: string
  total: number
  pending: number
  contacted: number
  done: number
  skipped: number
}

const CouponOutreachBatchView = () => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const today = istDateString()

  const [batch, setBatch] = useState<CouponOutreachBatch | null>(null)
  const [perTelecaller, setPerTelecaller] = useState<PerTelecallerRow[]>([])
  const [config, setConfig] = useState<CouponOutreachConfig | null>(null)
  const [onLeave, setOnLeave] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const [summary, cfg, leaves] = await Promise.all([
        couponOutreachApi.getBatchSummary(token, today),
        couponOutreachApi.getConfig(token),
        couponOutreachApi.listOnLeaveTelecallers(token, today),
      ])
      setBatch(summary.batch)
      setPerTelecaller(summary.perTelecaller)
      setConfig(cfg)
      setOnLeave(leaves)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load batch'
      logger.error('coupon_outreach.batch_load_failed', err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [token, today])

  useEffect(() => {
    void load()
  }, [load])

  const handleMarkLeave = async (uid: string) => {
    setBusyId(uid)
    setActionMsg(null)
    try {
      await couponOutreachApi.markTelecallerOnLeave(token, uid, today)
      const result = await couponOutreachApi.redistribute(token, uid, today)
      setActionMsg(
        `Marked ${uid} on leave. Redistributed ${result.moved} pending items across ${result.remaining} remaining telecallers.`,
      )
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to mark leave'
      logger.error('coupon_outreach.mark_leave_failed', err)
      setError(msg)
    } finally {
      setBusyId(null)
    }
  }

  const handleClearLeave = async (uid: string) => {
    setBusyId(uid)
    setActionMsg(null)
    try {
      await couponOutreachApi.clearTelecallerLeave(token, uid, today)
      setActionMsg(`Cleared leave for ${uid}.`)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to clear leave'
      setError(msg)
    } finally {
      setBusyId(null)
    }
  }

  const handleRunNow = async () => {
    setBusyId('__run__')
    setActionMsg(null)
    try {
      const result = await couponOutreachApi.runDailyBatchNow(token)
      setActionMsg(
        `Built batch ${result.dateStr}: ${result.assigned} assigned, ${result.eligibleScanned} eligible scanned, ${result.skippedByCooldown} skipped by cooldown.`,
      )
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to trigger run'
      logger.error('coupon_outreach.run_now_failed', err)
      setError(msg)
    } finally {
      setBusyId(null)
    }
  }

  const handleConfigSave = async (patch: Partial<CouponOutreachConfig>) => {
    setBusyId('__config__')
    setActionMsg(null)
    try {
      const next = await couponOutreachApi.updateConfig(token, patch)
      setConfig(next)
      setActionMsg('Config saved.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save config'
      setError(msg)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="ui-section-stack">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <div className="ui-panel p-3 sm:p-4">
          <p className="font-display text-2xl font-semibold leading-none text-text">
            {batch?.totalCount ?? 0}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted">Assigned</p>
        </div>
        <div className="ui-panel p-3 sm:p-4">
          <p className="font-display text-2xl font-semibold leading-none text-text">
            {batch?.eligibleScanned ?? 0}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted">
            Eligible Scanned
          </p>
        </div>
        <div className="ui-panel p-3 sm:p-4">
          <p className="font-display text-2xl font-semibold leading-none text-text">
            {batch?.skippedByCooldown ?? 0}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted">
            Cooldown Skipped
          </p>
        </div>
        <div className="ui-panel p-3 sm:p-4">
          <p className="font-display text-2xl font-semibold leading-none text-text">
            {perTelecaller.length}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted">Telecallers</p>
        </div>
      </div>

      <div className="ui-toolbar flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">
          Batch: {batch?.date ?? today} · Status: {batch?.status ?? 'not generated'}
        </span>
        <button
          type="button"
          onClick={handleRunNow}
          disabled={busyId === '__run__'}
          className="ui-btn ui-btn-primary min-h-9 text-xs"
        >
          {busyId === '__run__' ? 'Running…' : 'Run now'}
        </button>
        <button
          type="button"
          onClick={() => void load()}
          className="ui-btn ui-btn-neutral min-h-9 text-xs"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </div>
      ) : null}
      {actionMsg ? (
        <div className="rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {actionMsg}
        </div>
      ) : null}

      {/* Per-telecaller distribution */}
      <div className="rounded-xl border border-border/60 bg-panel shadow-sm overflow-hidden">
        <div className="border-b border-border/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Distribution
        </div>
        {loading ? (
          <div className="px-4 py-6 text-center text-sm text-muted">Loading…</div>
        ) : perTelecaller.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted">No items assigned yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface/40 text-[11px] uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th className="px-4 py-2">Telecaller</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Pending</th>
                  <th className="px-3 py-2">Contacted</th>
                  <th className="px-3 py-2">Done</th>
                  <th className="px-3 py-2">Skipped</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {perTelecaller.map((row) => {
                  const isOnLeave = onLeave.includes(row.telecallerId)
                  return (
                    <tr key={row.telecallerId}>
                      <td className="px-4 py-2 text-text">
                        {row.telecallerId}
                        {isOnLeave ? (
                          <span className="ml-2 ui-pill border-warning/30 bg-warning/15 text-warning text-[10px] px-1.5 py-0.5">
                            on leave
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-text">{row.total}</td>
                      <td className="px-3 py-2 text-text">{row.pending}</td>
                      <td className="px-3 py-2 text-text">{row.contacted}</td>
                      <td className="px-3 py-2 text-text">{row.done}</td>
                      <td className="px-3 py-2 text-text">{row.skipped}</td>
                      <td className="px-3 py-2">
                        {isOnLeave ? (
                          <button
                            type="button"
                            onClick={() => void handleClearLeave(row.telecallerId)}
                            disabled={busyId === row.telecallerId}
                            className="ui-btn ui-btn-neutral min-h-7 text-[11px]"
                          >
                            Clear leave
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleMarkLeave(row.telecallerId)}
                            disabled={busyId === row.telecallerId || row.pending === 0}
                            className="ui-btn ui-btn-warning min-h-7 text-[11px]"
                          >
                            Mark on leave
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Config */}
      {config ? (
        <div className="rounded-xl border border-border/60 bg-panel shadow-sm">
          <div className="border-b border-border/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Config
          </div>
          <ConfigForm config={config} busy={busyId === '__config__'} onSave={handleConfigSave} />
        </div>
      ) : null}
    </div>
  )
}

const ConfigForm = ({
  config,
  busy,
  onSave,
}: {
  config: CouponOutreachConfig
  busy: boolean
  onSave: (patch: Partial<CouponOutreachConfig>) => Promise<void> | void
}) => {
  const [enabled, setEnabled] = useState(config.enabled)
  const [dailyBatchSize, setDailyBatchSize] = useState(config.dailyBatchSize)
  const [cooldownDays, setCooldownDays] = useState(config.cooldownDays)
  const [tierHighSpend, setTierHighSpend] = useState(config.tierHighSpend)
  const [tierHighVisits, setTierHighVisits] = useState(config.tierHighVisits)
  const [tierMidSpend, setTierMidSpend] = useState(config.tierMidSpend)

  return (
    <form
      className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave({
          enabled,
          dailyBatchSize: Math.max(1, Number(dailyBatchSize)),
          cooldownDays: Math.max(0, Number(cooldownDays)),
          tierHighSpend: Math.max(0, Number(tierHighSpend)),
          tierHighVisits: Math.max(0, Number(tierHighVisits)),
          tierMidSpend: Math.max(0, Number(tierMidSpend)),
        })
      }}
    >
      <label className="col-span-2 flex items-center gap-2 sm:col-span-3">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="text-text">Daily 10:30 AM IST cron enabled</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted">Daily batch size</span>
        <input
          type="number"
          min={1}
          value={dailyBatchSize}
          onChange={(e) => setDailyBatchSize(Number(e.target.value))}
          className="ui-field min-h-9 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted">Cooldown (days)</span>
        <input
          type="number"
          min={0}
          value={cooldownDays}
          onChange={(e) => setCooldownDays(Number(e.target.value))}
          className="ui-field min-h-9 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted">Tier HIGH ≥ ₹</span>
        <input
          type="number"
          min={0}
          value={tierHighSpend}
          onChange={(e) => setTierHighSpend(Number(e.target.value))}
          className="ui-field min-h-9 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted">
          Tier HIGH visits ≥
        </span>
        <input
          type="number"
          min={0}
          value={tierHighVisits}
          onChange={(e) => setTierHighVisits(Number(e.target.value))}
          className="ui-field min-h-9 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted">Tier MID ≥ ₹</span>
        <input
          type="number"
          min={0}
          value={tierMidSpend}
          onChange={(e) => setTierMidSpend(Number(e.target.value))}
          className="ui-field min-h-9 text-sm"
        />
      </label>
      <div className="col-span-2 flex justify-end sm:col-span-3">
        <button type="submit" disabled={busy} className="ui-btn ui-btn-primary min-h-9 text-xs">
          {busy ? 'Saving…' : 'Save config'}
        </button>
      </div>
    </form>
  )
}

export default CouponOutreachBatchView
