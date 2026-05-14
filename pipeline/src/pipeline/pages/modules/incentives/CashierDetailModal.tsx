import { useMemo } from 'react'
import { X } from 'lucide-react'
import { ModalShell } from '../../../components/ui/ModalShell'
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable'
import { fmtDateIST } from '../../../../lib/date-format'
import type { CashierIncentiveRecord } from '../../../api/types'

const currency = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

const reasonLabel = (reason: string): string => {
  switch (reason) {
    case 'non_performing':
      return 'Non-Performing'
    case 'gokart_laps':
      return 'Go-Kart Laps'
    case 'both':
      return 'Both'
    default:
      return reason
  }
}

interface Props {
  open: boolean
  onClose: () => void
  cashierName: string
  branchName: string
  monthLabel: string
  records: CashierIncentiveRecord[]
}

export const CashierDetailModal = ({
  open,
  onClose,
  cashierName,
  branchName,
  monthLabel,
  records,
}: Props) => {
  const sorted = useMemo(
    () =>
      [...records].sort((a, b) =>
        a.transactionDate === b.transactionDate
          ? a.invoiceNumber.localeCompare(b.invoiceNumber)
          : a.transactionDate.localeCompare(b.transactionDate),
      ),
    [records],
  )

  const totals = useMemo(
    () =>
      sorted.reduce(
        (acc, r) => ({
          item: acc.item + r.itemAmount,
          incentive: acc.incentive + r.incentiveAmount,
        }),
        { item: 0, incentive: 0 },
      ),
    [sorted],
  )

  const columns: DataTableColumn<CashierIncentiveRecord>[] = [
    {
      key: 'date',
      header: 'Date',
      render: (r) => <span className="whitespace-nowrap">{fmtDateIST(r.transactionDate)}</span>,
    },
    {
      key: 'invoice',
      header: 'Invoice',
      render: (r) => <span className="font-mono text-xs">{r.invoiceNumber}</span>,
    },
    {
      key: 'item',
      header: 'Activity / Item',
      render: (r) => (
        <span className="text-sm">
          {r.itemName}
          {r.isComboItem && r.comboName && (
            <span className="ml-1 text-[10px] text-muted">(in {r.comboName})</span>
          )}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => <span className="text-xs">{reasonLabel(r.reason)}</span>,
    },
    {
      key: 'laps',
      header: 'Laps',
      render: (r) => (r.laps != null ? r.laps : '-'),
    },
    {
      key: 'item_amount',
      header: 'Item Amount',
      render: (r) => currency(r.itemAmount),
    },
    {
      key: 'pct',
      header: '%',
      render: (r) => `${r.incentivePercent}%`,
    },
    {
      key: 'incentive',
      header: 'Incentive',
      render: (r) => (
        <span className="font-semibold text-green-600 dark:text-green-400">
          {currency(r.incentiveAmount)}
        </span>
      ),
    },
  ]

  return (
    <ModalShell open={open} onClose={onClose} maxWidth="max-w-5xl">
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
        <div>
          <h3 className="text-base font-semibold text-text">{cashierName}</h3>
          <p className="text-xs text-muted">
            {branchName} · {monthLabel} · {sorted.length}{' '}
            {sorted.length === 1 ? 'transaction' : 'transactions'}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-text"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-6 py-4">
        <DataTable
          columns={columns}
          rows={sorted}
          rowKey={(r) => r.id}
          emptyMessage="No transactions"
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-6 border-t border-border/50 px-6 py-3 text-sm">
        <div>
          <span className="text-muted">Total Item Amount: </span>
          <span className="font-semibold">{currency(totals.item)}</span>
        </div>
        <div>
          <span className="text-muted">Total Incentive: </span>
          <span className="font-semibold text-green-600 dark:text-green-400">
            {currency(totals.incentive)}
          </span>
        </div>
      </div>
    </ModalShell>
  )
}
