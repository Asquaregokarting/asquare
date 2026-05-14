import { useTransactionCounts } from './hooks/useTransactionCounts'
import { ScannerLocation } from './types/scanner.types'

interface DashboardProps {
  location: ScannerLocation | null
  shiftActive: boolean
  onScanNow: () => void
  onViewHistory: () => void
}

const CountCard = ({
  label,
  count,
  loading,
  accent,
}: {
  label: string
  count: number
  loading: boolean
  accent: string
}) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4 backdrop-blur-xl dark:border-gray-700 dark:bg-track-surface/80">
    <p className="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/45">
      {label}
    </p>
    <p className="mt-2 text-3xl font-bold" style={{ color: accent }}>
      {loading ? '—' : count}
    </p>
  </div>
)

export const Dashboard = ({ location, shiftActive, onScanNow, onViewHistory }: DashboardProps) => {
  const { total, pending, completed, loading } = useTransactionCounts(location)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3">
        <CountCard label="Total Scans" count={total} loading={loading} accent="#42A5F5" />
        <CountCard label="Pending" count={pending} loading={loading} accent="#FF1744" />
        <CountCard label="Completed" count={completed} loading={loading} accent="#00C853" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onScanNow}
          disabled={!shiftActive}
          className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-track-surface/80 dark:text-white/70"
        >
          Scan Now
        </button>
        <button
          type="button"
          onClick={onViewHistory}
          className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-700 dark:border-gray-700 dark:bg-track-surface/80 dark:text-white/70"
        >
          View History
        </button>
      </div>
    </div>
  )
}
