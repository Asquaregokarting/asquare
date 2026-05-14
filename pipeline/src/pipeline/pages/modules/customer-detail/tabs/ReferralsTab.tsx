/**
 * Customer 360 — Referrals tab.
 *
 * Two stacked sections:
 *   1. "Referred by" — single customer (or empty state).
 *   2. "Customers I referred" — paginated forward-edge list.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import {
  customerReferralsApi,
  type ReferredCustomerRow,
} from '../../../../api/customer-detail/customer-referrals'
import { DataTable } from '../../../../components/ui/DataTable'
import { fmtDateIST } from '../../../../../lib/date-format'
import ErrorState from '../../../../../components/ui/ErrorState'

const PAGE_SIZE = 50
const fmt = (n: number) => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

interface Props {
  customerId: string
  /** From AsquareCustomer.referredBy — uid of who referred this customer. */
  referredBy: string
  /** From AsquareCustomer.referralCode — code this customer shares. */
  referralCode: string
}

export const ReferralsTab = ({ customerId, referredBy, referralCode }: Props) => {
  const referrerQ = useQuery({
    queryKey: ['customer-detail', customerId, 'referrer', referredBy],
    queryFn: () => customerReferralsApi.getReferrer(referredBy),
    enabled: referredBy.length > 0,
    staleTime: 60_000,
  })

  const [cursorStack, setCursorStack] = useState<QueryDocumentSnapshot<DocumentData>[]>([])
  const cursor = cursorStack[cursorStack.length - 1]

  const referredQ = useQuery({
    queryKey: ['customer-detail', customerId, 'referred', cursorStack.length],
    queryFn: () =>
      customerReferralsApi.listReferredCustomers(customerId, {
        pageSize: PAGE_SIZE,
        cursor,
      }),
    staleTime: 60_000,
  })

  const referrer = referrerQ.data
  const rows: ReferredCustomerRow[] = referredQ.data?.items ?? []
  const nextCursor = referredQ.data?.nextCursor ?? null

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/70 bg-panel p-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
          Referred by
        </h2>
        {!referredBy ? (
          <p className="mt-2 text-sm text-muted">
            This customer joined directly — not through a referral.
          </p>
        ) : referrerQ.isLoading ? (
          <p className="mt-2 text-sm text-muted">Loading referrer…</p>
        ) : !referrer ? (
          <p className="mt-2 text-sm text-muted">
            Referrer record (<code className="text-xs">{referredBy}</code>) is no longer available.
          </p>
        ) : (
          <Link
            to={`/admin/customers/${referrer.id}`}
            className="mt-2 inline-flex items-center gap-2 text-sm text-text hover:text-accent"
          >
            <span className="font-medium">{referrer.displayName || 'Unknown'}</span>
            <span className="text-muted">·</span>
            <span className="text-muted">{referrer.phone || '—'}</span>
            <span className="text-muted">→</span>
          </Link>
        )}
      </section>

      <section className="rounded-xl border border-border/70 bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
            Customers I referred
          </h2>
          {referralCode ? (
            <span className="text-xs text-muted">
              Referral code: <code className="text-text">{referralCode}</code>
            </span>
          ) : null}
        </div>

        {referredQ.isError ? (
          <ErrorState
            title="Couldn't load referred customers"
            description={referredQ.error instanceof Error ? referredQ.error.message : undefined}
            onRetry={() => referredQ.refetch()}
          />
        ) : (
          <DataTable
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (r: ReferredCustomerRow) => r.displayName || '—',
              },
              { key: 'phone', header: 'Phone', render: (r) => r.phone || '—' },
              {
                key: 'joined',
                header: 'Joined',
                render: (r) => (r.joinedAt ? fmtDateIST(r.joinedAt) : '—'),
              },
              {
                key: 'totalSpent',
                header: 'Total spent',
                render: (r) => fmt(r.totalSpent),
              },
              {
                key: 'actions',
                header: '',
                render: (r) => (
                  <Link
                    to={`/admin/customers/${r.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                  >
                    Open
                  </Link>
                ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            emptyMessage={
              referredQ.isLoading ? 'Loading…' : 'This customer has not referred anyone yet.'
            }
          />
        )}

        <div className="mt-2 flex items-center justify-between text-xs text-muted">
          <span>
            {rows.length} on this page
            {cursorStack.length > 0 ? ` · page ${cursorStack.length + 1}` : ''}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={cursorStack.length === 0}
              onClick={() => setCursorStack((s) => s.slice(0, -1))}
              className="ui-btn ui-btn-neutral min-h-7 px-3 text-xs"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={!nextCursor}
              onClick={() => {
                if (nextCursor) setCursorStack((s) => [...s, nextCursor])
              }}
              className="ui-btn ui-btn-neutral min-h-7 px-3 text-xs"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
