import { useEffect, useMemo, useState } from 'react'
import { fmtDateTimeFullIST } from '../../../../lib/date-format'
import { resolveLocation } from '../../../../lib/locations'
import { useAuth } from '../../auth/auth-context'
import { todayIST } from '../../../lib/ist-date'
import {
  canViewAllKartReportsRole,
  KartReportFilters,
  KartReportRecord,
  resolveLocationDocId,
  subscribeAllKartReports,
} from '../services/kartReportService'
import { SCANNER_LOCATIONS } from '../scanner/types/scanner.types'
import { useLocations } from '../../../hooks/useLocations'

const formatSubmittedAt = (value: KartReportRecord['submittedAt']): string => {
  if (!value) return '—'
  try {
    const dateObj = typeof value.toDate === 'function' ? value.toDate() : null
    return dateObj ? fmtDateTimeFullIST(dateObj.toISOString()) : '—'
  } catch {
    return '—'
  }
}

export const KartReportsViewer = () => {
  const { session } = useAuth()
  const { isRoleLocked, allowedSlugs } = useLocations()

  const role = session?.user.role ?? ''
  const canView = canViewAllKartReportsRole(role)

  const visibleLocations = useMemo(() => {
    if (!isRoleLocked) return SCANNER_LOCATIONS
    return SCANNER_LOCATIONS.filter((name) => {
      const loc = resolveLocation(name)
      return loc && allowedSlugs.includes(loc.slug)
    })
  }, [isRoleLocked, allowedSlugs])

  const [filterDate, setFilterDate] = useState<string>(todayIST())
  const [filterLocation, setFilterLocation] = useState<string>('')
  const [reports, setReports] = useState<KartReportRecord[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Stabilize the allowedSlugs reference for the effect deps so we don't
  // resubscribe on every render (useLocations() returns a fresh array each call).
  const allowedSlugsKey = allowedSlugs.join(',')

  useEffect(() => {
    if (!canView) return
    setLoading(true)
    setError(null)

    const filters: KartReportFilters = {}
    if (filterDate) filters.date = filterDate
    if (filterLocation) {
      // Use the same resolver as submitKartReport so the doc-id we
      // filter on matches what was actually written. resolveLocation()
      // alone returns the LIVE Firestore doc id (e.g. "0") which does
      // not match the slug-based ids used by the karts/kartReports paths.
      filters.locationDocId = resolveLocationDocId(filterLocation)
    }

    const allowedList = allowedSlugsKey ? allowedSlugsKey.split(',') : []

    const unsubscribe = subscribeAllKartReports(
      filters,
      (records) => {
        // For non-privileged-but-allowed roles, also filter to allowed locations.
        const filtered = isRoleLocked
          ? records.filter((r) => allowedList.includes(r.locationDocId))
          : records
        setReports(filtered)
        setLoading(false)
      },
      (reason) => {
        setError(reason.message)
        setLoading(false)
      },
    )
    return () => unsubscribe()
  }, [canView, filterDate, filterLocation, isRoleLocked, allowedSlugsKey])

  if (!session) return null

  if (!canView) {
    return (
      <div className="rounded-2xl border border-critical/30 bg-critical/10 p-6 text-sm text-critical">
        Access denied. Kart Reports are visible to Owner, Admin, and Developer roles only.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-track-surface">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-track-accent-soft/80">
              Daily Inspection Audit
            </p>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Kart Reports</h2>
            <p className="text-sm text-gray-600 dark:text-white/60">
              Browse Track Marshall kart reports across locations and dates.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-white/45">
                Date
              </span>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="ui-field min-h-10 min-w-[160px]"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-white/45">
                Location
              </span>
              <select
                value={filterLocation}
                onChange={(e) => setFilterLocation(e.target.value)}
                className="ui-field min-h-10 min-w-[200px]"
              >
                <option value="">All locations</option>
                {visibleLocations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-track-surface dark:text-white/55">
          Loading reports...
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-track-surface dark:text-white/55">
          No kart reports found for the selected filters.
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const isExpanded = expandedId === report.id
            return (
              <div
                key={report.id}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-track-surface"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : report.id)}
                  className="flex w-full flex-col gap-3 text-left sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-gray-900 dark:text-white">
                      {report.locationName} · {report.reportDate}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-white/55">
                      Submitted by {report.submittedBy || '—'} on{' '}
                      {formatSubmittedAt(report.submittedAt)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge tone="info">Total {report.summary.total}</Badge>
                    <Badge tone="success">Good {report.summary.good}</Badge>
                    <Badge tone="warning">Repair {report.summary.underRepair}</Badge>
                    <Badge tone="critical">Engine Fail {report.summary.engineFail}</Badge>
                    {report.summary.critical > 0 ? (
                      <Badge tone="critical">⚠️ Critical {report.summary.critical}</Badge>
                    ) : null}
                  </div>
                </button>

                {isExpanded ? (
                  <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-track-surface-alt">
                          <tr>
                            <Th>Kart</Th>
                            <Th>Type</Th>
                            <Th>Condition</Th>
                            <Th>Engine</Th>
                            <Th>Status</Th>
                            <Th>Notes</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {report.karts.map((entry) => {
                            const critical =
                              entry.condition === 'damaged' || entry.engineStatus === 'engine_fail'
                            return (
                              <tr
                                key={entry.kartId}
                                className={critical ? 'bg-critical/8' : undefined}
                              >
                                <td className="px-3 py-2 font-semibold text-gray-900 dark:text-white">
                                  {critical ? '⚠️ ' : ''}
                                  {entry.kartNumber}
                                </td>
                                <td className="px-3 py-2 text-gray-700 dark:text-white/70">
                                  {entry.kartType}
                                </td>
                                <td className="px-3 py-2">
                                  <ValueBadge value={entry.condition} />
                                </td>
                                <td className="px-3 py-2">
                                  <ValueBadge value={entry.engineStatus} />
                                </td>
                                <td className="px-3 py-2">
                                  <ValueBadge value={entry.status} />
                                </td>
                                <td className="px-3 py-2 text-gray-600 dark:text-white/55">
                                  {entry.notes ?? '—'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {report.notes ? (
                      <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-track-surface-alt dark:text-white/70">
                        <span className="font-medium">Overall notes:</span> {report.notes}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-gray-500 dark:text-white/55">
    {children}
  </th>
)

const Badge = ({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'info' | 'success' | 'warning' | 'critical'
}) => {
  const toneClasses: Record<string, string> = {
    info: 'border-info/30 bg-info/10 text-info',
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    critical: 'border-critical/30 bg-critical/10 text-critical',
  }
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${toneClasses[tone]}`}
    >
      {children}
    </span>
  )
}

const ValueBadge = ({ value }: { value: string }) => {
  const lower = value.toLowerCase()
  let tone: 'info' | 'success' | 'warning' | 'critical' = 'info'
  if (lower === 'good' || lower === 'working' || lower === 'available') tone = 'success'
  else if (lower === 'damaged' || lower === 'engine_fail') tone = 'critical'
  else if (lower === 'under_repair') tone = 'warning'
  const label = value.replace(/_/g, ' ')
  return <Badge tone={tone}>{label}</Badge>
}
