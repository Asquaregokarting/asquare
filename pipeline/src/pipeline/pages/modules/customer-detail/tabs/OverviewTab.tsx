/**
 * Customer 360 — Overview tab.
 *
 * Pulls the first page from bookings, wallet, and tires in parallel,
 * merges into a single chronological timeline, and renders the 10 most
 * recent events.
 */
import { useQueries } from '@tanstack/react-query'
import { customerBookingsApi } from '../../../../api/customer-detail/customer-bookings'
import {
  customerTiresApi,
  customerWalletApi,
} from '../../../../api/customer-detail/customer-balance-history'
import { fmtDateTimeFullIST } from '../../../../../lib/date-format'

const TIMELINE_MAX = 10
const fmt = (n: number) => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

interface TimelineEvent {
  at: Date
  kind: 'booking' | 'wallet' | 'tires'
  title: string
  detail: string
  amount?: string
  amountColor?: 'success' | 'critical'
}

interface Props {
  customerId: string
  referralCode: string
  joinedAt: Date
  lastLoginAt: Date
}

export const OverviewTab = ({ customerId, referralCode, joinedAt, lastLoginAt }: Props) => {
  const queries = useQueries({
    queries: [
      {
        queryKey: ['customer-detail', customerId, 'overview-bookings'],
        queryFn: () => customerBookingsApi.listBookings(customerId, { pageSize: 10 }),
        staleTime: 60_000,
      },
      {
        queryKey: ['customer-detail', customerId, 'overview-wallet'],
        queryFn: () => customerWalletApi.listTransactions(customerId, { pageSize: 10 }),
        staleTime: 60_000,
      },
      {
        queryKey: ['customer-detail', customerId, 'overview-tires'],
        queryFn: () => customerTiresApi.listTransactions(customerId, { pageSize: 10 }),
        staleTime: 60_000,
      },
    ],
  })

  const [bookingsQ, walletQ, tiresQ] = queries
  const isLoading = queries.some((q) => q.isLoading)

  const events: TimelineEvent[] = []
  for (const b of bookingsQ.data?.items ?? []) {
    if (!b.sessionDate || b.sessionDate.getTime() === 0) continue
    events.push({
      at: b.sessionDate,
      kind: 'booking',
      title: `Booking · ${b.locationId || 'unknown branch'}`,
      detail:
        b.items?.map((it) => `${it.activity?.name ?? '?'} × ${it.quantity}`).join(', ') || '—',
      amount: fmt(b.finalAmount),
    })
  }
  for (const t of walletQ.data?.items ?? []) {
    if (!t.timestamp || t.timestamp.getTime() === 0) continue
    const isCredit = t.type === 'credit'
    events.push({
      at: t.timestamp,
      kind: 'wallet',
      title: `Wallet ${isCredit ? 'credit' : 'debit'}`,
      detail: t.description || '—',
      amount: `${isCredit ? '+' : '−'}${fmt(Math.abs(t.amount))}`,
      amountColor: isCredit ? 'success' : 'critical',
    })
  }
  for (const t of tiresQ.data?.items ?? []) {
    if (!t.timestamp || t.timestamp.getTime() === 0) continue
    const isCredit = t.type === 'tire_credit' || t.type === 'credit'
    events.push({
      at: t.timestamp,
      kind: 'tires',
      title: `Tires ${isCredit ? 'earned' : 'redeemed'}`,
      detail: t.description || '—',
      amount: `${isCredit ? '+' : '−'}${Math.round(Math.abs(t.amount))} pts`,
      amountColor: isCredit ? 'success' : 'critical',
    })
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime())
  const top = events.slice(0, TIMELINE_MAX)

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/70 bg-panel p-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Identity</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">Joined</p>
            <p className="text-text">{fmtDateTimeFullIST(joinedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Last seen</p>
            <p className="text-text">
              {lastLoginAt && lastLoginAt.getTime() > 0 ? fmtDateTimeFullIST(lastLoginAt) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Referral code</p>
            <p className="font-mono text-text">{referralCode || '—'}</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
            Recent activity
          </h2>
          <span className="text-xs text-muted">last {TIMELINE_MAX} events</span>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted">Loading activity…</p>
        ) : top.length === 0 ? (
          <p className="text-sm text-muted">No activity yet for this customer.</p>
        ) : (
          <ol className="space-y-3">
            {top.map((e, i) => (
              <li
                key={`${e.at.getTime()}-${i}`}
                className="flex items-start justify-between gap-3 border-b border-border/40 pb-3 last:border-b-0 last:pb-0"
              >
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-[0.06em] text-muted">{e.kind}</p>
                  <p className="mt-0.5 text-sm font-medium text-text">{e.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{e.detail}</p>
                </div>
                <div className="text-right">
                  {e.amount ? (
                    <p
                      className={`text-sm font-medium ${
                        e.amountColor === 'success'
                          ? 'text-success'
                          : e.amountColor === 'critical'
                            ? 'text-critical'
                            : 'text-text'
                      }`}
                    >
                      {e.amount}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-muted">{fmtDateTimeFullIST(e.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="text-xs text-muted">
        Tier change history will appear here once admin-edit auditing ships in Phase 3.
      </p>
    </div>
  )
}
