/**
 * Customer 360 — shared Wallet / Tires history tab.
 *
 * Parameterized by which fetcher to use, the kind of unit (currency vs
 * tire-points), and the empty-state copy. Concrete tab files
 * (`WalletTab.tsx`, `TiresTab.tsx`) are thin wrappers that pass the
 * right config in.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import {
  type BalanceHistoryFilters,
  type BalanceTransaction,
  type BalanceHistoryOptions,
  type BalanceHistoryPage,
} from '../../../../api/customer-detail/customer-balance-history'
import { DataTable } from '../../../../components/ui/DataTable'
import { FilterBar, FilterField } from '../../../../components/ui/FilterBar'
import { fmtDateTimeFullIST } from '../../../../../lib/date-format'
import ErrorState from '../../../../../components/ui/ErrorState'

const PAGE_SIZE = 50

const parseDate = (s: string): Date | undefined => {
  if (!s) return undefined
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : undefined
}

interface Props {
  customerId: string
  /** Which API to call. */
  fetcher: (customerId: string, opts?: BalanceHistoryOptions) => Promise<BalanceHistoryPage>
  /** Logical name used in queryKey + headings. */
  kind: 'wallet' | 'tires'
  /** Format an amount value for the table cell. */
  formatAmount: (n: number) => string
  /** Top-banner balance label (e.g. "Wallet balance" / "Tire points"). */
  balanceLabel: string
  /** Override balance number (used by Tires tab — root users.tires). */
  balanceOverride?: number
}

export const BalanceHistoryTab = ({
  customerId,
  fetcher,
  kind,
  formatAmount,
  balanceLabel,
  balanceOverride,
}: Props) => {
  const [side, setSide] = useState<'all' | 'credit' | 'debit'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [cursorStack, setCursorStack] = useState<QueryDocumentSnapshot<DocumentData>[]>([])

  const filters: BalanceHistoryFilters = {
    side,
    dateAfter: parseDate(dateFrom),
    dateBefore: parseDate(dateTo),
  }
  const cursor = cursorStack[cursorStack.length - 1]
  const queryKey = ['customer-detail', customerId, kind, filters, cursorStack.length] as const

  const q = useQuery({
    queryKey,
    queryFn: () =>
      fetcher(customerId, {
        pageSize: PAGE_SIZE,
        cursor,
        filters,
      }),
    staleTime: 60_000,
  })

  const onFilterChange =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setCursorStack([])
      setter(value)
    }

  const rows: BalanceTransaction[] = q.data?.items ?? []
  const balance = balanceOverride ?? q.data?.balance ?? 0
  const nextCursor = q.data?.nextCursor ?? null

  return (
    <div>
      <div className="mb-4 rounded-xl border border-border/70 bg-panel p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
          {balanceLabel}
        </p>
        <p className={`mt-1 text-3xl font-semibold ${balance > 0 ? 'text-success' : 'text-text'}`}>
          {formatAmount(balance)}
        </p>
      </div>

      <FilterBar>
        <FilterField label="Type">
          <select
            title="Filter by transaction side"
            className="ui-field min-h-10"
            value={side}
            onChange={(e) => onFilterChange(setSide)(e.target.value as 'all' | 'credit' | 'debit')}
          >
            <option value="all">All</option>
            <option value="credit">Credits only</option>
            <option value="debit">Debits only</option>
          </select>
        </FilterField>
        <FilterField label="Date from">
          <input
            title="Filter from date"
            type="date"
            className="ui-field min-h-10"
            value={dateFrom}
            onChange={(e) => onFilterChange(setDateFrom)(e.target.value)}
          />
        </FilterField>
        <FilterField label="Date to">
          <input
            title="Filter to date"
            type="date"
            className="ui-field min-h-10"
            value={dateTo}
            onChange={(e) => onFilterChange(setDateTo)(e.target.value)}
          />
        </FilterField>
      </FilterBar>

      {q.isError ? (
        <ErrorState
          title={`Couldn't load ${kind} history`}
          description={q.error instanceof Error ? q.error.message : undefined}
          onRetry={() => q.refetch()}
        />
      ) : (
        <DataTable
          columns={[
            {
              key: 'date',
              header: 'Date',
              render: (t: BalanceTransaction) =>
                t.timestamp.getTime() === 0 ? '—' : fmtDateTimeFullIST(t.timestamp),
            },
            {
              key: 'type',
              header: 'Type',
              render: (t: BalanceTransaction) => {
                const isCredit = t.type === 'credit' || t.type === 'tire_credit'
                return (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      isCredit ? 'bg-success/15 text-success' : 'bg-critical/15 text-critical'
                    }`}
                  >
                    {isCredit ? 'credit' : 'debit'}
                  </span>
                )
              },
            },
            {
              key: 'amount',
              header: 'Amount',
              render: (t: BalanceTransaction) => {
                const isCredit = t.type === 'credit' || t.type === 'tire_credit'
                return (
                  <span className={isCredit ? 'text-success' : 'text-critical'}>
                    {isCredit ? '+' : '−'}
                    {formatAmount(Math.abs(t.amount))}
                  </span>
                )
              },
            },
            {
              key: 'description',
              header: 'Description',
              render: (t: BalanceTransaction) => t.description || '—',
            },
          ]}
          rows={rows}
          rowKey={(t) => t.id}
          emptyMessage={q.isLoading ? `Loading ${kind} history…` : `No ${kind} transactions found.`}
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
