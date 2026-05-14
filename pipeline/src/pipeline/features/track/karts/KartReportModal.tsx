import { useEffect, useMemo, useState } from 'react'
import { fmtDateTimeFullIST } from '../../../../lib/date-format'
import { KartRecord } from '../services/kartService'
import {
  KartReportEntry,
  KartReportRecord,
  seedEntriesFromKarts,
} from '../services/kartReportService'
import { ScannerLocation } from '../scanner/types/scanner.types'

const isCritical = (entry: Pick<KartReportEntry, 'condition' | 'engineStatus'>): boolean =>
  entry.condition === 'damaged' || entry.engineStatus === 'engine_fail'

export const KartReportModal = ({
  open,
  location,
  karts,
  existingReport,
  canSubmit,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean
  location: ScannerLocation
  karts: KartRecord[]
  existingReport: KartReportRecord | null
  canSubmit: boolean
  loading: boolean
  onClose: () => void
  onSubmit: (entries: KartReportEntry[], notes: string) => Promise<void>
}) => {
  const [entries, setEntries] = useState<KartReportEntry[]>([])
  const [notes, setNotes] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (existingReport) {
      setEntries(existingReport.karts)
      setNotes(existingReport.notes ?? '')
    } else {
      setEntries(seedEntriesFromKarts(karts))
      setNotes('')
    }
  }, [open, existingReport, karts])

  const summary = useMemo(() => {
    let good = 0
    let underRepair = 0
    let engineFail = 0
    let critical = 0
    for (const entry of entries) {
      if (entry.condition === 'good') good += 1
      if (entry.status === 'under_repair') underRepair += 1
      if (entry.engineStatus === 'engine_fail') engineFail += 1
      if (isCritical(entry)) critical += 1
    }
    return { total: entries.length, good, underRepair, engineFail, critical }
  }, [entries])

  if (!open) return null

  const isLocked = Boolean(existingReport)

  const updateEntry = (kartId: string, patch: Partial<KartReportEntry>) => {
    setEntries((current) =>
      current.map((entry) => (entry.kartId === kartId ? { ...entry, ...patch } : entry)),
    )
  }

  const handleSubmit = async () => {
    if (isLocked) return
    if (!canSubmit) {
      setError('Only Owner, Admin, Developer or Track Marshall can submit a kart report.')
      return
    }
    if (entries.length === 0) {
      setError('There are no karts to report on for this location.')
      return
    }
    setError(null)
    await onSubmit(entries, notes)
  }

  const submittedAtLabel = (() => {
    const ts = existingReport?.submittedAt
    if (!ts) return null
    try {
      const dateObj = typeof ts.toDate === 'function' ? ts.toDate() : null
      return dateObj ? fmtDateTimeFullIST(dateObj.toISOString()) : null
    } catch {
      return null
    }
  })()

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center overflow-y-auto bg-base/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-track-panel">
        {/* Fixed header */}
        <div className="shrink-0 p-5 pb-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-track-accent-soft/80">
                {isLocked ? "Today's Kart Report (Locked)" : 'Submit Daily Kart Report'}
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
                {location}
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-white/60">
                {isLocked
                  ? 'This report has been submitted and locked. No further edits are allowed today.'
                  : "Review and update each kart's condition. Submission is final and unlocks cashier shift start."}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-white/60 dark:hover:text-white"
            >
              Close
            </button>
          </div>

          {isLocked && existingReport ? (
            <div className="mt-4 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
              <p className="text-sm font-semibold text-success">
                ✅ Submitted by {existingReport.submittedBy || '—'}
                {submittedAtLabel ? ` on ${submittedAtLabel}` : ''}
              </p>
            </div>
          ) : null}
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <SummaryTile label="Total" value={summary.total} tone="info" />
              <SummaryTile label="Good" value={summary.good} tone="success" />
              <SummaryTile label="Under Repair" value={summary.underRepair} tone="warning" />
              <SummaryTile label="Engine Fail" value={summary.engineFail} tone="critical" />
              <SummaryTile label="Critical" value={summary.critical} tone="critical" />
            </div>

            {entries.length === 0 ? (
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                No karts found for this location. Add karts before submitting a report.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-track-panel">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-track-surface-alt">
                      <tr>
                        <Th>Kart</Th>
                        <Th>Type</Th>
                        <Th>Condition</Th>
                        <Th>Engine</Th>
                        <Th>Status</Th>
                        <Th>Last Deep Clean</Th>
                        <Th>Notes</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {entries.map((entry) => {
                        const critical = isCritical(entry)
                        return (
                          <tr key={entry.kartId} className={critical ? 'bg-critical/8' : undefined}>
                            <td className="px-3 py-2 font-semibold text-gray-900 dark:text-white">
                              <div className="flex items-center gap-2">
                                {critical ? <span title="Critical">⚠️</span> : null}
                                <span>{entry.kartNumber}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-gray-700 dark:text-white/70">
                              {entry.kartType}
                            </td>
                            <td className="px-3 py-2">
                              <select
                                disabled={isLocked || loading}
                                value={entry.condition}
                                onChange={(e) =>
                                  updateEntry(entry.kartId, {
                                    condition: e.target.value as KartReportEntry['condition'],
                                  })
                                }
                                className="ui-field min-h-9 min-w-[110px] disabled:opacity-70"
                              >
                                <option value="good">Good</option>
                                <option value="damaged">Damaged</option>
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <select
                                disabled={isLocked || loading}
                                value={entry.engineStatus}
                                onChange={(e) =>
                                  updateEntry(entry.kartId, {
                                    engineStatus: e.target.value as KartReportEntry['engineStatus'],
                                  })
                                }
                                className="ui-field min-h-9 min-w-[120px] disabled:opacity-70"
                              >
                                <option value="working">Working</option>
                                <option value="engine_fail">Engine Fail</option>
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <select
                                disabled={isLocked || loading}
                                value={entry.status}
                                onChange={(e) =>
                                  updateEntry(entry.kartId, {
                                    status: e.target.value as KartReportEntry['status'],
                                  })
                                }
                                className="ui-field min-h-9 min-w-[130px] disabled:opacity-70"
                              >
                                <option value="available">Available</option>
                                <option value="under_repair">Under Repair</option>
                              </select>
                            </td>
                            <td className="px-3 py-2 text-gray-600 dark:text-white/55">
                              {entry.lastDeepCleanDate ?? '—'}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                disabled={isLocked || loading}
                                value={entry.notes ?? ''}
                                onChange={(e) =>
                                  updateEntry(entry.kartId, { notes: e.target.value })
                                }
                                placeholder="Optional"
                                className="ui-field min-h-9 min-w-[180px] disabled:opacity-70"
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-track-surface">
              <label className="text-sm font-medium text-gray-900 dark:text-white">
                Overall notes (optional)
              </label>
              <textarea
                disabled={isLocked || loading}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Anything the cashier or owner should know about today's karts..."
                className="ui-field mt-2 w-full disabled:opacity-70"
              />
            </div>

            {error ? (
              <div className="rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">
                {error}
              </div>
            ) : null}
          </div>
        </div>

        {/* Fixed footer */}
        <div className="shrink-0 border-t border-gray-200 p-5 dark:border-gray-700">
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-white/60 dark:hover:text-white sm:w-auto"
            >
              {isLocked ? 'Close' : 'Cancel'}
            </button>
            {!isLocked ? (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit || loading || entries.length === 0}
                className="w-full rounded-xl border border-track-accent bg-track-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-track-accent-soft disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {loading ? 'Submitting...' : 'Submit Report (Lock)'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-gray-500 dark:text-white/55">
    {children}
  </th>
)

const SummaryTile = ({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'info' | 'success' | 'warning' | 'critical'
}) => {
  const toneClasses: Record<string, string> = {
    info: 'border-info/30 bg-info/10 text-info',
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    critical: 'border-critical/30 bg-critical/10 text-critical',
  }
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClasses[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">{label}</p>
      <p className="mt-0.5 text-xl font-semibold">{value}</p>
    </div>
  )
}
