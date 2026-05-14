import { memo, ReactNode } from 'react'

export interface DataTableColumn<RowT> {
  key: string
  header: string
  render: (row: RowT) => ReactNode
}

interface DataTableProps<RowT> {
  columns: Array<DataTableColumn<RowT>>
  rows: RowT[]
  rowKey: (row: RowT) => string
  emptyMessage?: string
  onRowClick?: (row: RowT) => void
  /** Optional per-row extra className — e.g. for status-based highlighting. */
  rowClassName?: (row: RowT) => string | undefined
}

const isActionsColumn = (key: string): boolean => {
  const token = key.toLowerCase()
  return token === 'actions'
}

const DataTableInner = <RowT,>({
  columns,
  rows,
  rowKey,
  emptyMessage = 'No records found.',
  onRowClick,
  rowClassName,
}: DataTableProps<RowT>) => (
  <div className="overflow-hidden rounded-xl border border-border/50 bg-panel shadow-sm">
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border/60 text-sm">
        <thead className="bg-surface/45">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-[0.09em] text-muted ${
                  isActionsColumn(column.key) ? 'text-right' : 'text-left'
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/55">
          {rows.length === 0 ? (
            <tr>
              <td className="px-4 py-8 text-center text-sm text-muted" colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = rowKey(row)
              return (
                <tr
                  key={id}
                  className={`align-middle transition-colors hover:bg-panel/50${onRowClick ? ' cursor-pointer hover:bg-surface/60' : ''}${rowClassName ? ` ${rowClassName(row) ?? ''}` : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => {
                    const actionColumn = isActionsColumn(column.key)
                    return (
                      <td
                        key={`${id}-${column.key}`}
                        className={`px-4 py-3.5 text-text ${actionColumn ? 'text-right' : ''}`}
                      >
                        {actionColumn ? (
                          <div className="inline-flex min-h-10 items-center justify-end gap-2">
                            {column.render(row)}
                          </div>
                        ) : (
                          column.render(row)
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  </div>
)

export const DataTable = memo(DataTableInner) as typeof DataTableInner
