import { useEffect, useMemo, useState } from 'react'
import { asquareBookingsApi, type BookingSwapEvent } from '../../../api/asquare-bookings'
import { fmtDateTimeFullIST } from '../../../../lib/date-format'
import { logger } from '../../../../lib/logger'
import { formatCurrency } from './bookings-utils'

interface Props {
  onClose: () => void
}

type SwapRow = BookingSwapEvent & { orderNumber: string; logId: string }

const startOfTodayIST = (): Date => {
  // IST = UTC+5:30. Compute "today's 00:00 in IST" as a JS Date in local TZ.
  const now = new Date()
  const istOffsetMinutes = 5 * 60 + 30
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000
  const istMs = utcMs + istOffsetMinutes * 60_000
  const ist = new Date(istMs)
  ist.setHours(0, 0, 0, 0)
  // Convert back to UTC equivalent by subtracting offsets
  return new Date(ist.getTime() - istOffsetMinutes * 60_000 - now.getTimezoneOffset() * 60_000)
}

const settlementLabel = (s: BookingSwapEvent['settlement']): string =>
  s === 'wallet_credit'
    ? 'Wallet refund'
    : s === 'wallet_debit'
      ? 'Wallet charge'
      : s === 'external_cash'
        ? 'External cash'
        : 'No adjustment'

const SwapsTodayModal = ({ onClose }: Props) => {
  const [rows, setRows] = useState<SwapRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    asquareBookingsApi
      .getSwapLogs({ since: startOfTodayIST() })
      .then((data) => {
        if (!cancelled) setRows(data as SwapRow[])
      })
      .catch((err) => {
        logger.error('swaps_today_modal.fetch_failed', err)
        if (!cancelled) setError('Failed to load swap logs.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    const totalDelta = rows.reduce((sum, r) => sum + Number(r.priceDelta || 0), 0)
    const walletCredits = rows
      .filter((r) => r.settlement === 'wallet_credit')
      .reduce((s, r) => s + Number(r.walletAmount || 0), 0)
    const walletDebits = rows
      .filter((r) => r.settlement === 'wallet_debit')
      .reduce((s, r) => s + Number(r.walletAmount || 0), 0)
    const byStaff: Record<string, number> = {}
    for (const r of rows) {
      const k = r.by?.name ?? 'Unknown'
      byStaff[k] = (byStaff[k] ?? 0) + 1
    }
    const topStaff = Object.entries(byStaff)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
    return { totalDelta, walletCredits, walletDebits, topStaff }
  }, [rows])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-base/70 p-4 pt-10 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-text">Today&apos;s Activity Swaps</h3>
            <p className="text-xs text-muted">
              In-store activity changes settled via wallet, cash, or no adjustment.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-neutral min-h-8 px-3 py-1 text-xs"
          >
            Close
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        )}

        <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-panel px-3 py-2">
            <p className="text-[11px] uppercase text-muted">Swaps</p>
            <p className="text-xl font-semibold text-text">{rows.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-panel px-3 py-2">
            <p className="text-[11px] uppercase text-muted">Net Delta</p>
            <p
              className={`text-xl font-semibold ${
                stats.totalDelta > 0
                  ? 'text-warning'
                  : stats.totalDelta < 0
                    ? 'text-info'
                    : 'text-text'
              }`}
            >
              {stats.totalDelta > 0 ? '+' : ''}
              {formatCurrency(stats.totalDelta)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-panel px-3 py-2">
            <p className="text-[11px] uppercase text-muted">Wallet Refunds</p>
            <p className="text-xl font-semibold text-info">{formatCurrency(stats.walletCredits)}</p>
          </div>
          <div className="rounded-xl border border-border bg-panel px-3 py-2">
            <p className="text-[11px] uppercase text-muted">Wallet Charges</p>
            <p className="text-xl font-semibold text-warning">
              {formatCurrency(stats.walletDebits)}
            </p>
          </div>
        </section>

        {stats.topStaff.length > 0 && (
          <p className="mb-3 text-xs text-muted">
            Most swaps today by:{' '}
            {stats.topStaff.map(([name, n], i) => (
              <span key={name}>
                {i > 0 ? ' · ' : ''}
                <span className="font-medium text-text">{name}</span> ({n})
              </span>
            ))}
          </p>
        )}

        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="min-w-full divide-y divide-border/60 text-sm">
            <thead className="bg-surface/45 text-left text-xs uppercase tracking-[0.08em] text-muted">
              <tr>
                <th className="px-3 py-2">Booking</th>
                <th className="px-3 py-2">From → To</th>
                <th className="px-3 py-2 text-right">Delta</th>
                <th className="px-3 py-2">Settlement</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/55">
              {loading ? (
                <tr>
                  <td className="px-3 py-6 text-center text-muted" colSpan={7}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-muted" colSpan={7}>
                    No swaps logged today.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const at = r.at instanceof Date ? r.at : new Date(r.at as unknown as string)
                  return (
                    <tr key={r.logId} className="hover:bg-panel/40">
                      <td className="px-3 py-2 align-top font-mono text-xs">{r.orderNumber}</td>
                      <td className="px-3 py-2 align-top">
                        <p className="text-text">
                          {r.from.activityName} → {r.to.activityName}
                        </p>
                        <p className="text-[11px] text-muted">Qty {r.to.quantity}</p>
                      </td>
                      <td
                        className={`px-3 py-2 align-top text-right font-semibold ${
                          r.priceDelta > 0
                            ? 'text-warning'
                            : r.priceDelta < 0
                              ? 'text-info'
                              : 'text-muted'
                        }`}
                      >
                        {r.priceDelta > 0 ? '+' : ''}
                        {formatCurrency(r.priceDelta)}
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        {settlementLabel(r.settlement)}
                        {r.walletAmount ? ` (${formatCurrency(r.walletAmount)})` : ''}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted">{r.reason}</td>
                      <td className="px-3 py-2 align-top text-xs">
                        <p className="text-text">{r.by?.name ?? '—'}</p>
                        <p className="text-[11px] text-muted">{r.by?.role ?? ''}</p>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted">
                        {fmtDateTimeFullIST(at)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default SwapsTodayModal
