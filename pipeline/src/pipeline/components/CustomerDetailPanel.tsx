import { useEffect, useMemo, useState } from 'react'
import type { AsquareCustomer } from '../api/asquare-customers'
import type { AsquareBooking } from '../api/asquare-bookings'
import { asquareBookingsApi } from '../api/asquare-bookings'
import { walletService, type Transaction } from '../../services/walletService'
import { getLocationDisplayName } from '../../lib/locations'
import { fmtDateIST, fmtDateTimeFullIST } from '../../lib/date-format'

const currency = (v: number) => `₹${Math.round(v || 0).toLocaleString('en-IN')}`

interface Props {
  customer: AsquareCustomer
  onClose: () => void
}

export const CustomerDetailPanel = ({ customer, onClose }: Props) => {
  const [bookings, setBookings] = useState<AsquareBooking[]>([])
  const [walletTxns, setWalletTxns] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const [bk, wt] = await Promise.all([
        asquareBookingsApi.listBookingsByUserPhone(customer.phone).catch(() => []),
        walletService.getWalletHistory(customer.id).catch(() => []),
      ])
      if (!cancelled) {
        setBookings(bk)
        setWalletTxns(wt)
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [customer.id, customer.phone])

  // ── Computed stats ──────────────────────────────────────────────
  const completedBookings = useMemo(
    () =>
      bookings.filter((b) => b.paymentStatus === 'completed' && b.bookingStatus !== 'cancelled'),
    [bookings],
  )

  const activityBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>()
    for (const b of completedBookings) {
      for (const item of b.items) {
        const name = item.activity?.name || 'Unknown'
        const prev = map.get(name) || { count: 0, revenue: 0 }
        map.set(name, { count: prev.count + item.quantity, revenue: prev.revenue + item.price })
      }
    }
    return [...map.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count)
  }, [completedBookings])

  const branchBreakdown = useMemo(() => {
    const map = new Map<string, { visits: number; revenue: number }>()
    for (const b of completedBookings) {
      const branch = getLocationDisplayName(b.locationId || '')
      const prev = map.get(branch) || { visits: 0, revenue: 0 }
      map.set(branch, { visits: prev.visits + 1, revenue: prev.revenue + b.finalAmount })
    }
    return [...map.entries()]
      .map(([branch, data]) => ({ branch, ...data }))
      .sort((a, b) => b.visits - a.visits)
  }, [completedBookings])

  const monthlyVisits = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of completedBookings) {
      const d = b.sessionDate || b.createdAt
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map.set(key, (map.get(key) || 0) + 1)
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 12)
      .map(([month, count]) => ({ month, count }))
  }, [completedBookings])

  const avgSpend =
    completedBookings.length > 0
      ? Math.round(
          completedBookings.reduce((s, b) => s + b.finalAmount, 0) / completedBookings.length,
        )
      : 0

  const lastVisit =
    completedBookings.length > 0
      ? completedBookings[0].sessionDate || completedBookings[0].createdAt
      : null

  const lastLocation =
    completedBookings.length > 0
      ? getLocationDisplayName(completedBookings[0].locationId || '')
      : '—'

  const mostVisitedBranch = branchBreakdown.length > 0 ? branchBreakdown[0].branch : '—'

  const favActivity = activityBreakdown.length > 0 ? activityBreakdown[0].name : '—'

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h3 className="font-display text-xl font-bold tracking-tight text-text">
            {customer.displayName || 'Unknown'}
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            {customer.phone} · {customer.email || 'No email'}
            {customer.membership && (
              <span
                className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${
                  customer.membership.toLowerCase() === 'platinum'
                    ? 'bg-accent/15 text-accent'
                    : customer.membership.toLowerCase() === 'gold'
                      ? 'bg-warning/15 text-warning'
                      : 'bg-info/15 text-info'
                }`}
              >
                {customer.membership}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-panel hover:text-text"
        >
          Close
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-muted">Loading customer data...</div>
      ) : (
        <div className="p-5 space-y-5">
          {/* ── Summary Cards ────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: 'Total Visits', value: String(completedBookings.length), tone: 'text-info' },
              { label: 'Total Spent', value: currency(customer.totalSpent), tone: 'text-success' },
              { label: 'Avg. Spend', value: currency(avgSpend), tone: 'text-text' },
              { label: 'Wallet', value: currency(customer.walletBalance), tone: 'text-warning' },
              { label: 'Tires', value: String(customer.tires), tone: 'text-accent' },
              {
                label: 'Coupons',
                value: `${customer.coupons150Available}/${customer.coupons150Earned}`,
                tone: customer.coupons150Available > 0 ? 'text-success' : 'text-muted',
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-lg border border-border bg-panel p-3 text-center"
              >
                <p className={`text-xl font-bold ${card.tone}`}>{card.value}</p>
                <p className="mt-0.5 text-xs text-muted">{card.label}</p>
              </div>
            ))}
          </div>

          {/* ── Quick Info ────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg border border-border bg-panel px-3 py-2">
              <p className="text-xs text-muted">Favourite Activity</p>
              <p className="text-sm font-semibold text-text">{favActivity}</p>
            </div>
            <div className="rounded-lg border border-border bg-panel px-3 py-2">
              <p className="text-xs text-muted">Last Visit</p>
              <p className="text-sm font-semibold text-text">
                {lastVisit ? fmtDateIST(lastVisit.toISOString()) : '—'}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-panel px-3 py-2">
              <p className="text-xs text-muted">Last Location</p>
              <p className="text-sm font-semibold text-text">{lastLocation}</p>
            </div>
            <div className="rounded-lg border border-border bg-panel px-3 py-2">
              <p className="text-xs text-muted">Most Visited Branch</p>
              <p className="text-sm font-semibold text-text">{mostVisitedBranch}</p>
            </div>
            <div className="rounded-lg border border-border bg-panel px-3 py-2">
              <p className="text-xs text-muted">Tier / Verified</p>
              <p className="text-sm font-semibold text-text">
                {customer.tier}
                <span className={`ml-2 ${customer.isVerified ? 'text-success' : 'text-critical'}`}>
                  {customer.isVerified ? '✓ Verified' : '✗ Not verified'}
                </span>
              </p>
            </div>
          </div>

          {/* ── Top Activities ────────────────────────────────── */}
          {activityBreakdown.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                Top Activities
              </h4>
              <div className="space-y-1.5">
                {activityBreakdown.slice(0, 8).map((a) => {
                  const maxCount = activityBreakdown[0].count
                  const pct = Math.round((a.count / maxCount) * 100)
                  return (
                    <div key={a.name} className="flex items-center gap-3">
                      <span className="w-32 truncate text-sm text-text">{a.name}</span>
                      <div className="relative flex-1 h-5 rounded bg-panel overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded bg-accent/20"
                          style={{ width: `${pct}%` }}
                        />
                        <span className="relative z-10 px-2 text-xs font-medium text-text leading-5">
                          {a.count}× · {currency(a.revenue)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Branch Breakdown ──────────────────────────────── */}
          {branchBreakdown.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                Branch-wise Visits
              </h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {branchBreakdown.map((b) => (
                  <div
                    key={b.branch}
                    className="flex items-center justify-between rounded-lg border border-border bg-panel px-3 py-2"
                  >
                    <span className="text-sm text-text">{b.branch}</span>
                    <span className="text-sm font-semibold text-text">
                      {b.visits} visits · {currency(b.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Monthly Visit Timeline ───────────────────────── */}
          {monthlyVisits.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                Visit Timeline
              </h4>
              <div className="flex items-end gap-1.5" style={{ height: 80 }}>
                {[...monthlyVisits].reverse().map((m) => {
                  const maxVisits = Math.max(...monthlyVisits.map((x) => x.count))
                  const h = Math.max(12, Math.round((m.count / maxVisits) * 72))
                  const [y, mo] = m.month.split('-')
                  const label = new Date(Number(y), Number(mo) - 1).toLocaleString('en-IN', {
                    month: 'short',
                  })
                  return (
                    <div key={m.month} className="flex flex-1 flex-col items-center gap-0.5">
                      <span className="text-[10px] font-semibold text-text">{m.count}</span>
                      <div className="w-full rounded-t bg-accent/30" style={{ height: h }} />
                      <span className="text-[10px] text-muted">{label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Booking History ───────────────────────────── */}
          <div>
            <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
              Booking History ({bookings.length})
            </h4>
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {bookings.length === 0 ? (
                <p className="text-sm text-muted">No bookings found.</p>
              ) : (
                bookings.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-panel px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text truncate">
                        {b.items.map((i) => i.activity?.name || 'Activity').join(', ')}
                      </p>
                      <p className="text-xs text-muted">
                        {fmtDateIST((b.sessionDate || b.createdAt).toISOString())}
                        {' · '}
                        {getLocationDisplayName(b.locationId || '')}
                        {b.paymentMethod ? ` · ${b.paymentMethod}` : ''}
                      </p>
                    </div>
                    <div className="text-right ml-3 shrink-0">
                      <p className="text-sm font-bold text-text">{currency(b.finalAmount)}</p>
                      <span
                        className={`text-xs font-medium ${
                          b.paymentStatus === 'completed'
                            ? 'text-success'
                            : b.paymentStatus === 'failed'
                              ? 'text-critical'
                              : 'text-warning'
                        }`}
                      >
                        {b.paymentStatus}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Wallet Transactions (full width, detailed) ─── */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Wallet Transactions ({walletTxns.length})
              </h4>
              {walletTxns.length > 0 && (
                <div className="flex gap-4 text-xs">
                  <span className="text-success font-semibold">
                    Total In:{' '}
                    {currency(
                      walletTxns
                        .filter((t) => t.type === 'credit')
                        .reduce((s, t) => s + Math.abs(t.amount), 0),
                    )}
                  </span>
                  <span className="text-critical font-semibold">
                    Total Out:{' '}
                    {currency(
                      walletTxns
                        .filter((t) => t.type === 'debit')
                        .reduce((s, t) => s + Math.abs(t.amount), 0),
                    )}
                  </span>
                </div>
              )}
            </div>
            <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {walletTxns.length === 0 ? (
                <p className="text-sm text-muted">No wallet transactions.</p>
              ) : (
                walletTxns.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-panel px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text">{tx.description}</p>
                      <p className="text-xs text-muted">
                        {tx.timestamp?.toDate
                          ? fmtDateTimeFullIST(tx.timestamp.toDate().toISOString())
                          : '—'}
                      </p>
                    </div>
                    <span
                      className={`ml-3 shrink-0 text-sm font-bold ${
                        tx.type === 'credit' ? 'text-success' : 'text-critical'
                      }`}
                    >
                      {tx.type === 'credit' ? '+' : '−'}
                      {currency(Math.abs(tx.amount))}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
