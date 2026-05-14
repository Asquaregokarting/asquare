import { useState } from 'react'
import { DataTable } from '../../../components/ui/DataTable'
import { KartRecord } from '../services/kartService'
import { KartDetails } from './KartDetails'

const formatLabel = (value: string): string =>
  value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

const toneClassMap = {
  available: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
  under_repair: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
  good: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200',
  damaged: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
  working: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
  engine_fail: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
  single: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200',
  double: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-200',
  children: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200',
} as const

const Chip = ({ value }: { value: keyof typeof toneClassMap }) => (
  <span
    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${toneClassMap[value]}`}
  >
    {formatLabel(value)}
  </span>
)

export const KartList = ({
  karts,
  canManage,
  canUpdate,
  loading,
  onEdit,
  onDelete,
  deleting,
}: {
  karts: KartRecord[]
  canManage: boolean
  canUpdate: boolean
  loading?: boolean
  onEdit: (kart: KartRecord) => void
  onDelete: (kart: KartRecord) => Promise<void>
  deleting?: boolean
}) => {
  const [detailsKart, setDetailsKart] = useState<KartRecord | null>(null)
  const [pendingDeleteKart, setPendingDeleteKart] = useState<KartRecord | null>(null)

  return (
    <>
      <DataTable
        columns={[
          {
            key: 'kartNumber',
            header: 'Kart Number',
            render: (kart) => <span className="font-medium">{kart.kartNumber}</span>,
          },
          { key: 'kartType', header: 'Type', render: (kart) => <Chip value={kart.kartType} /> },
          {
            key: 'condition',
            header: 'Condition',
            render: (kart) => <Chip value={kart.condition} />,
          },
          {
            key: 'engineStatus',
            header: 'Engine Status',
            render: (kart) => <Chip value={kart.engineStatus} />,
          },
          { key: 'status', header: 'Status', render: (kart) => <Chip value={kart.status} /> },
          {
            key: 'lastDeepCleanDate',
            header: 'Last Deep Clean Date',
            render: (kart) => (
              <span className="text-sm text-gray-600 dark:text-white/65">
                {kart.lastDeepCleanDate || 'Not cleaned yet'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: 'Actions',
            render: (kart) => (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDetailsKart(kart)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-white/70 dark:hover:text-white"
                >
                  Details
                </button>
                {canUpdate ? (
                  <button
                    type="button"
                    onClick={() => onEdit(kart)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-white/70 dark:hover:text-white"
                  >
                    Update
                  </button>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => setPendingDeleteKart(kart)}
                    disabled={deleting}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={karts}
        rowKey={(kart) => kart.id}
        emptyMessage={loading ? 'Loading karts...' : 'No karts found for this location.'}
      />

      <KartDetails
        open={Boolean(detailsKart)}
        kart={detailsKart}
        onClose={() => setDetailsKart(null)}
      />

      {pendingDeleteKart ? (
        <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center bg-base/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-track-panel">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Delete Kart</h4>
            <p className="mt-2 text-sm text-gray-600 dark:text-white/60">
              Are you sure you want to delete this kart?
            </p>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {pendingDeleteKart.kartNumber}
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setPendingDeleteKart(null)}
                disabled={deleting}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-white/70 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  void onDelete(pendingDeleteKart).finally(() => {
                    setPendingDeleteKart(null)
                  })
                }
                disabled={deleting}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
