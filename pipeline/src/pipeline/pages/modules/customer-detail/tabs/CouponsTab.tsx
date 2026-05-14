/**
 * Customer 360 — Coupons tab.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import {
  customerCouponsApi,
  type CouponRow,
  type CouponsFilters,
} from '../../../../api/customer-detail/customer-coupons'
import { DataTable } from '../../../../components/ui/DataTable'
import { FilterBar, FilterField } from '../../../../components/ui/FilterBar'
import { fmtDateIST } from '../../../../../lib/date-format'
import ErrorState from '../../../../../components/ui/ErrorState'

const PAGE_SIZE = 50

interface Props {
  customerId: string
  earned150: number
  redeemed150: number
  available150: number
}

const KpiCard = ({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: 'success'
}) => (
  <div className="rounded-lg border border-border/50 bg-surface/30 p-3">
    <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{label}</p>
    <p
      className={`mt-1 text-xl font-semibold ${accent === 'success' ? 'text-success' : 'text-text'}`}
    >
      {value}
    </p>
  </div>
)

export const CouponsTab = ({ customerId, earned150, redeemed150, available150 }: Props) => {
  const [source, setSource] = useState('')
  const [usedFilter, setUsedFilter] = useState<'' | 'used' | 'unused'>('')
  const [cursorStack, setCursorStack] = useState<QueryDocumentSnapshot<DocumentData>[]>([])

  const filters: CouponsFilters = {
    source: source || undefined,
    isUsed: usedFilter === '' ? undefined : usedFilter === 'used',
  }
  const cursor = cursorStack[cursorStack.length - 1]
  const queryKey = ['customer-detail', customerId, 'coupons', filters, cursorStack.length] as const

  const q = useQuery({
    queryKey,
    queryFn: () =>
      customerCouponsApi.listCoupons(customerId, {
        pageSize: PAGE_SIZE,
        cursor,
        filters,
      }),
    staleTime: 60_000,
  })

  const onFilterChange =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setCursorStack([])
      setter(v)
    }

  const rows: CouponRow[] = q.data?.items ?? []
  const nextCursor = q.data?.nextCursor ?? null

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <KpiCard label="₹150 earned" value={String(earned150)} />
        <KpiCard label="₹150 redeemed" value={String(redeemed150)} />
        <KpiCard
          label="₹150 available"
          value={String(available150)}
          accent={available150 > 0 ? 'success' : undefined}
        />
      </div>

      <FilterBar>
        <FilterField label="Source">
          <select
            title="Filter coupons by source"
            className="ui-field min-h-10"
            value={source}
            onChange={(e) => onFilterChange(setSource)(e.target.value)}
          >
            <option value="">All</option>
            <option value="member_150">₹150 member reward</option>
            <option value="reward">Reward</option>
            <option value="promo">Promo</option>
          </select>
        </FilterField>
        <FilterField label="Status">
          <select
            title="Filter coupons by used/unused"
            className="ui-field min-h-10"
            value={usedFilter}
            onChange={(e) =>
              onFilterChange(setUsedFilter)(e.target.value as '' | 'used' | 'unused')
            }
          >
            <option value="">All</option>
            <option value="unused">Unused</option>
            <option value="used">Used</option>
          </select>
        </FilterField>
      </FilterBar>

      {q.isError ? (
        <ErrorState
          title="Couldn't load coupons"
          description={q.error instanceof Error ? q.error.message : undefined}
          onRetry={() => q.refetch()}
        />
      ) : (
        <DataTable
          columns={[
            { key: 'code', header: 'Code', render: (c: CouponRow) => c.code || '—' },
            { key: 'type', header: 'Type', render: (c) => c.type },
            { key: 'discount', header: 'Discount', render: (c) => `₹${c.discount}` },
            { key: 'source', header: 'Source', render: (c) => c.source },
            {
              key: 'created',
              header: 'Created',
              render: (c) => (c.createdAt ? fmtDateIST(c.createdAt) : '—'),
            },
            { key: 'expiry', header: 'Expiry', render: (c) => c.expiryDate || '—' },
            {
              key: 'used',
              header: 'Used',
              render: (c) => (
                <span className={c.isUsed ? 'text-muted' : 'text-success'}>
                  {c.isUsed ? '\u2713' : '—'}
                </span>
              ),
            },
            {
              key: 'description',
              header: 'Description',
              render: (c) => c.description || '—',
            },
          ]}
          rows={rows}
          rowKey={(c) => c.id}
          emptyMessage={q.isLoading ? 'Loading coupons…' : 'No coupons found.'}
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
    </div>
  )
}
