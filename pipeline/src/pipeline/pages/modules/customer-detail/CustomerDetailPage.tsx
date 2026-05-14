/**
 * CustomerDetailPage — Customer 360 detail route at /admin/customers/:id.
 *
 * Renders a header (identity + KPI strip) and a tab nav. Each tab is
 * lazy-loaded only when activated and cached via React Query, so
 * switching tabs after the first visit is instant.
 *
 * Tab state lives in the URL (?tab=...) so the page is deep-linkable.
 *
 * In Phase 1 the tab components are minimal stubs that render
 * "coming soon"; Section E of the implementation plan fills them in
 * one by one.
 */
import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ModulePageLayout } from '../../../components/layout/ModulePageLayout'
import Skeleton from '../../../../components/ui/Skeleton'
import ErrorState from '../../../../components/ui/ErrorState'
import { asquareCustomersApi } from '../../../api/asquare-customers'
import {
  CUSTOMER_DETAIL_TABS,
  isCustomerDetailTab,
  type CustomerDetailTab,
} from './customer-detail-types'
import { OverviewTab } from './tabs/OverviewTab'
import { BookingsTab } from './tabs/BookingsTab'
import { GamesTab } from './tabs/GamesTab'
import { WalletTab } from './tabs/WalletTab'
import { TiresTab } from './tabs/TiresTab'
import { CouponsTab } from './tabs/CouponsTab'
import { ReferralsTab } from './tabs/ReferralsTab'

const fmtCurrency = (n: number): string => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

const fmtDate = (d: Date | null | undefined): string => {
  if (!d) return '—'
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

const KpiCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border/50 bg-surface/30 p-3">
    <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{label}</p>
    <p className="mt-1 text-base font-semibold text-text">{value}</p>
  </div>
)

const CustomerDetailPage = () => {
  const { customerId = '' } = useParams<{ customerId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: CustomerDetailTab = isCustomerDetailTab(tabParam) ? tabParam : 'overview'

  const customerQ = useQuery({
    queryKey: ['customer-detail', customerId],
    queryFn: async () => {
      const c = await asquareCustomersApi.getCustomer(customerId)
      if (!c) throw new Error('Customer not found')
      return c
    },
    staleTime: 60_000,
    enabled: customerId.length > 0,
  })

  const breadcrumbs = useMemo(
    () => ['Admin', 'Customers', customerQ.data?.displayName || customerId || 'Detail'],
    [customerQ.data?.displayName, customerId],
  )

  const setTab = (next: CustomerDetailTab) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('tab', next)
    setSearchParams(nextParams, { replace: true })
  }

  if (customerQ.isLoading) {
    return (
      <ModulePageLayout
        moduleTab="Admin"
        title="Customer"
        subtitle="Loading customer profile…"
        breadcrumbs={['Admin', 'Customers', '…']}
      >
        <Skeleton className="h-40 w-full" />
      </ModulePageLayout>
    )
  }

  if (customerQ.isError || !customerQ.data) {
    return (
      <ModulePageLayout
        moduleTab="Admin"
        title="Customer not found"
        subtitle=""
        breadcrumbs={['Admin', 'Customers', 'Not found']}
      >
        <ErrorState
          title="Customer not found"
          description={
            customerQ.error instanceof Error
              ? customerQ.error.message
              : 'This customer record does not exist or you do not have access to it.'
          }
          secondaryAction={
            <Link to="/admin/customers" className="ui-btn ui-btn-primary min-h-10 px-4 text-sm">
              Back to Customers
            </Link>
          }
        />
      </ModulePageLayout>
    )
  }

  const c = customerQ.data

  return (
    <ModulePageLayout
      moduleTab="Admin"
      title={c.displayName || c.phone || 'Customer'}
      subtitle={`${c.phone || 'no phone'} · ${c.email || 'no email'}`}
      breadcrumbs={breadcrumbs}
    >
      <header className="mb-6 rounded-xl border border-border/70 bg-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              Customer profile
            </p>
            <h1 className="mt-1 font-display text-2xl tracking-tight text-text">
              {c.displayName || 'Unknown'}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {c.phone || '—'} · {c.email || '—'}
            </p>
            <p className="mt-1 text-xs text-muted">
              Joined {fmtDate(c.createdAt)} · Last seen {fmtDate(c.lastLoginAt)} · Last booking{' '}
              {fmtDate(c.lastBookingAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                c.tier.toLowerCase() === 'gold'
                  ? 'bg-warning/15 text-warning'
                  : c.tier.toLowerCase() === 'platinum'
                    ? 'bg-accent/15 text-accent'
                    : c.tier.toLowerCase() === 'silver'
                      ? 'bg-info/15 text-info'
                      : c.tier.toLowerCase() === 'club'
                        ? 'bg-success/15 text-success'
                        : 'bg-surface text-muted'
              }`}
            >
              Tier · {c.tier}
            </span>
            {c.membership ? (
              <span className="rounded bg-surface px-2 py-0.5 text-xs font-medium text-text">
                Member · {c.membership}
              </span>
            ) : null}
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                c.isVerified ? 'bg-success/15 text-success' : 'bg-critical/15 text-critical'
              }`}
            >
              {c.isVerified ? 'Verified' : 'Unverified'}
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Total spent" value={fmtCurrency(c.totalSpent)} />
          <KpiCard label="Bookings" value={String(c.bookingCount)} />
          <KpiCard label="Wallet" value={fmtCurrency(c.walletBalance)} />
          <KpiCard label="Tires" value={String(c.tires)} />
          <KpiCard label="₹150 coupons" value={String(c.coupons150Available)} />
          <KpiCard label="Star" value={c.starStatus || '0'} />
        </div>
      </header>

      <nav
        className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
        aria-label="Customer detail sections"
      >
        {CUSTOMER_DETAIL_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`min-h-10 px-4 text-sm transition-colors ${
              tab === t.key
                ? 'border-b-2 border-accent font-medium text-text'
                : 'text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <OverviewTab
          customerId={c.id}
          referralCode={c.referralCode}
          joinedAt={c.createdAt}
          lastLoginAt={c.lastLoginAt}
        />
      )}
      {tab === 'bookings' && <BookingsTab customerId={c.id} />}
      {tab === 'games' && <GamesTab customerId={c.id} />}
      {tab === 'wallet' && <WalletTab customerId={c.id} />}
      {tab === 'tires' && <TiresTab customerId={c.id} tiresBalance={c.tires} />}
      {tab === 'coupons' && (
        <CouponsTab
          customerId={c.id}
          earned150={c.coupons150Earned}
          redeemed150={c.coupons150Redeemed}
          available150={c.coupons150Available}
        />
      )}
      {tab === 'referrals' && (
        <ReferralsTab customerId={c.id} referredBy={c.referredBy} referralCode={c.referralCode} />
      )}
    </ModulePageLayout>
  )
}

export default CustomerDetailPage
