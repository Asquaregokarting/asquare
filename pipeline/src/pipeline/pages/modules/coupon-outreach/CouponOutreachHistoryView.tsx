import { useCallback, useEffect, useState } from 'react'
import { BarChart3, ListOrdered } from 'lucide-react'
import { couponOutreachApi, type CouponOutreachBatch } from '../../../api/coupon-outreach'
import { useAuth } from '../../../features/auth/auth-context'
import { logger } from '../../../../lib/logger'
import { relativeDateLabel } from '../../../features/coupon-outreach/coupon-outreach-utils'
import CouponOutreachReportView from './CouponOutreachReportView'

type Pane = 'list' | 'report'

const CouponOutreachHistoryView = () => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const [batches, setBatches] = useState<CouponOutreachBatch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane>('list')

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const result = await couponOutreachApi.listRecentBatches(token, 60)
      setBatches(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load history'
      logger.error('coupon_outreach.history_load_failed', err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (pane === 'list') void load()
  }, [load, pane])

  return (
    <div className="ui-section-stack">
      <div className="ui-toolbar flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPane('list')}
          className={`ui-btn min-h-9 px-3 text-xs flex items-center gap-1 ${
            pane === 'list' ? 'ui-btn-info' : 'ui-btn-neutral'
          }`}
        >
          <ListOrdered size={14} /> Past batches
        </button>
        <button
          type="button"
          onClick={() => setPane('report')}
          className={`ui-btn min-h-9 px-3 text-xs flex items-center gap-1 ${
            pane === 'report' ? 'ui-btn-info' : 'ui-btn-neutral'
          }`}
        >
          <BarChart3 size={14} /> Report
        </button>
        {pane === 'list' ? (
          <button
            type="button"
            onClick={() => void load()}
            className="ui-btn ui-btn-neutral min-h-9 text-xs ml-auto"
          >
            Refresh
          </button>
        ) : null}
      </div>

      {pane === 'report' ? (
        <CouponOutreachReportView />
      ) : (
        <>
          {error ? (
            <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
              {error}
            </div>
          ) : null}
          {loading ? (
            <div className="py-12 text-center text-sm text-muted">Loading history…</div>
          ) : batches.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-surface/80 px-5 py-10 text-center text-sm text-muted">
              No batches have been generated yet.
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-panel shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface/40 text-[11px] uppercase tracking-[0.08em] text-muted">
                    <tr>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Total</th>
                      <th className="px-3 py-2">Eligible scanned</th>
                      <th className="px-3 py-2">Cooldown skipped</th>
                      <th className="px-3 py-2">Telecallers</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {batches.map((b) => (
                      <tr key={b.date}>
                        <td className="px-4 py-2 text-text">{b.date}</td>
                        <td className="px-3 py-2 text-muted">{relativeDateLabel(b.createdAt)}</td>
                        <td className="px-3 py-2 text-text">{b.totalCount}</td>
                        <td className="px-3 py-2 text-muted">{b.eligibleScanned}</td>
                        <td className="px-3 py-2 text-muted">{b.skippedByCooldown}</td>
                        <td className="px-3 py-2 text-muted">{b.telecallerIds.length}</td>
                        <td className="px-3 py-2 text-muted">{b.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default CouponOutreachHistoryView
