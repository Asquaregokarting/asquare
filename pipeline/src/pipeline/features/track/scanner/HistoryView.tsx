// A² Scanner — HistoryView
// Shows individual serial rows (not grouped by booking).
// Pending tab: serials awaiting ride, sorted by serial# ASC.
// Completed tab: serials verified today, sorted by serial# ASC.

import { useState } from 'react'
import { motion } from 'framer-motion'
import { fmtTimeShortIST } from '../../../../lib/date-format'
import { useShift } from './hooks/useShift'
import { useTransactionHistory, SerialHistoryRecord } from './hooks/useTransactionHistory'

const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return '****'
  return '****' + digits.slice(-4)
}

const formatTime = (dateStr?: string) => {
  return fmtTimeShortIST(dateStr)
}

const padSerial = (num: number): string => String(num).padStart(3, '0')

type HistoryTab = 'pending' | 'completed'

export const HistoryView = () => {
  const { selectedLocation } = useShift()
  const [activeTab, setActiveTab] = useState<HistoryTab>('pending')

  const {
    records: pendingRecords,
    loading: pendingLoading,
    error: pendingError,
  } = useTransactionHistory(selectedLocation, 'pending')
  const {
    records: completedRecords,
    loading: completedLoading,
    error: completedError,
  } = useTransactionHistory(selectedLocation, 'completed')

  const records = activeTab === 'pending' ? pendingRecords : completedRecords
  const loading = activeTab === 'pending' ? pendingLoading : completedLoading
  const error = activeTab === 'pending' ? pendingError : completedError

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {selectedLocation ? (
          <p className="text-xs text-gray-400 dark:text-white/40">
            <span className="text-gray-600 dark:text-white/60">{selectedLocation}</span>
          </p>
        ) : (
          <p className="text-xs text-gray-400 dark:text-white/40">No location selected.</p>
        )}
        <span className="rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:border-gray-700 dark:bg-track-surface/80 dark:text-white/60">
          Today
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-white/10 dark:bg-white/5">
        {(['pending', 'completed'] as HistoryTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all ${
              activeTab === tab
                ? tab === 'pending'
                  ? 'bg-track-accent-warm/20 text-track-accent-warm shadow'
                  : 'bg-signal-green-bright/20 text-signal-green-bright shadow'
                : 'text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/60'
            }`}
          >
            <span className="capitalize">{tab}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                tab === 'pending'
                  ? 'bg-signal-amber text-black'
                  : 'bg-signal-green-bright text-black'
              }`}
            >
              {tab === 'pending' ? pendingRecords.length : completedRecords.length}
            </span>
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex h-40 items-center justify-center text-sm text-gray-400 dark:text-white/40">
          <svg className="mr-2 size-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Loading {activeTab} serials...
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-signal-red-hot/30 bg-signal-red-hot/10 px-4 py-3 text-sm text-signal-red-hot">
          {error}
        </div>
      )}

      {!loading && !error && records.length === 0 && (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-gray-400 dark:text-white/40">
          <span className="text-sm">No {activeTab} serials today.</span>
        </div>
      )}

      {!loading && records.length > 0 && (
        <div className="flex flex-col gap-2">
          {records.map((record, index) => (
            <SerialCard key={record.id} record={record} tab={activeTab} index={index} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Serial Card ──────────────────────────────────────────────────────────

const SerialCard = ({
  record,
  tab,
  index,
}: {
  record: SerialHistoryRecord
  tab: HistoryTab
  index: number
}) => {
  const isPending = tab === 'pending'
  const isRiding = record.status === 'riding'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      className={`rounded-xl border px-4 py-3 ${
        isRiding
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : 'border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-track-surface/80'
      }`}
    >
      {/* Row 1: Serial # + Status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-gray-200 px-2 py-0.5 font-mono text-sm font-bold text-gray-900 dark:bg-white/10 dark:text-white">
            #{padSerial(record.serialNumber)}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/5 dark:text-white/40">
            {record.kartCc}
          </span>
        </div>
        {isPending ? (
          isRiding ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              Riding {record.kartNumber && `· ${record.kartNumber}`}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-track-accent-warm/15 px-2 py-0.5 text-[10px] font-semibold text-track-accent-warm">
              Waiting
            </span>
          )
        ) : (
          <span className="inline-flex items-center rounded-full bg-signal-green-bright/15 px-2 py-0.5 text-[10px] font-semibold text-signal-green-bright">
            Completed
          </span>
        )}
      </div>

      {/* Row 2: Customer */}
      <div className="mt-1.5 flex items-center gap-2">
        {record.customerName && (
          <p className="text-sm font-semibold text-gray-900 dark:text-white/90">
            {record.customerName}
          </p>
        )}
        {record.customerPhone && (
          <p className="text-xs text-gray-400 dark:text-white/35">
            {maskPhone(record.customerPhone)}
          </p>
        )}
      </div>

      {/* Row 3: Game + Time */}
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <p className="truncate text-xs text-gray-500 dark:text-white/50">{record.itemName}</p>
        <p className="shrink-0 text-[10px] text-gray-400 dark:text-white/30">
          {isPending ? formatTime(record.rideStartedAt) : formatTime(record.verifiedAt)}
        </p>
      </div>
    </motion.div>
  )
}
