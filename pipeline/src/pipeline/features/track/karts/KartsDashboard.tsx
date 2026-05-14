import { useEffect, useMemo, useState } from 'react'
import { SummaryCards } from '../../../components/ui/SummaryCards'
import { ensureFirebaseAuthForStorage } from '../../../lib/firebase-auth'
import { todayIST } from '../../../lib/ist-date'
import { useAuth } from '../../auth/auth-context'
import { KartDeepClean } from './KartDeepClean'
import { KartForm } from './KartForm'
import { KartList } from './KartList'
import { KartReportModal } from './KartReportModal'
import {
  DeepCleanAssignment,
  canDeepCleanRole,
  canUpdateKartRole,
  deleteKart,
  getOrCreateDailyAssignment,
  isKartManagerRole,
  KartDeepCleanLogRecord,
  KartRecord,
  loadSelectedKartLocation,
  performKartDeepClean,
  persistSelectedKartLocation,
  saveKart,
  subscribeDailyAssignment,
  subscribeDeepCleanHistoryByLocation,
  subscribeDailyDeepCleanByLocation,
  subscribeKartsByLocation,
} from '../services/kartService'
import {
  canSubmitKartReportRole,
  KartReportEntry,
  KartReportRecord,
  submitKartReport,
  subscribeKartReport,
} from '../services/kartReportService'
import { SCANNER_LOCATIONS, ScannerLocation } from '../scanner/types/scanner.types'
import { useLocations } from '../../../hooks/useLocations'
import { resolveLocation } from '../../../../lib/locations'

export const KartsDashboard = () => {
  const { session } = useAuth()
  const { isRoleLocked, allowedSlugs } = useLocations()

  // Filter locations by role-based access
  const visibleLocations = useMemo(() => {
    if (!isRoleLocked) return SCANNER_LOCATIONS
    return SCANNER_LOCATIONS.filter((name) => {
      const loc = resolveLocation(name)
      return loc && allowedSlugs.includes(loc.slug)
    })
  }, [isRoleLocked, allowedSlugs])

  const defaultLocation = loadSelectedKartLocation() || visibleLocations[0] || SCANNER_LOCATIONS[0]
  const [selectedLocation, setSelectedLocation] = useState<ScannerLocation>(defaultLocation)

  // Auto-select for restricted roles with exactly one location
  useEffect(() => {
    if (isRoleLocked && visibleLocations.length === 1 && selectedLocation !== visibleLocations[0]) {
      setSelectedLocation(visibleLocations[0])
    }
  }, [isRoleLocked, visibleLocations, selectedLocation])
  const [karts, setKarts] = useState<KartRecord[]>([])
  const [, setTodayDeepClean] = useState<KartDeepCleanLogRecord | null>(null)
  const [assignment, setAssignment] = useState<DeepCleanAssignment | null>(null)
  const [assignmentLoading, setAssignmentLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deepCleaning, setDeepCleaning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [deepCleanOpen, setDeepCleanOpen] = useState(false)
  const [editingKart, setEditingKart] = useState<KartRecord | null>(null)
  const [deepCleanHistoryRows, setDeepCleanHistoryRows] = useState<KartDeepCleanLogRecord[]>([])
  const [kartReportOpen, setKartReportOpen] = useState(false)
  const [kartReport, setKartReport] = useState<KartReportRecord | null>(null)
  const [kartReportSubmitting, setKartReportSubmitting] = useState(false)

  const role = session?.user.role ?? ''
  const canManage = isKartManagerRole(role) // Owner, Admin — add/delete
  const canUpdate = canUpdateKartRole(role) // Owner, Admin, Track Marshall — edit
  const canDeepClean = canDeepCleanRole(role)
  const canSubmitReport = canSubmitKartReportRole(role)

  useEffect(() => {
    persistSelectedKartLocation(selectedLocation)
  }, [selectedLocation])

  useEffect(() => {
    let disposed = false
    let unsubscribeKarts: (() => void) | null = null
    let unsubscribeDeepClean: (() => void) | null = null
    let unsubscribeDeepCleanHistory: (() => void) | null = null
    let unsubscribeAssignment: (() => void) | null = null
    let unsubscribeReport: (() => void) | null = null

    const setup = async () => {
      setLoading(true)
      setError(null)

      try {
        await ensureFirebaseAuthForStorage()
        if (disposed) return
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : 'Firebase authentication failed.')
          setLoading(false)
        }
        return
      }

      unsubscribeKarts = subscribeKartsByLocation(
        selectedLocation,
        (records) => {
          if (disposed) return
          setKarts(records)
          setLoading(false)
        },
        (reason) => {
          if (disposed) return
          setError(reason.message)
          setLoading(false)
        },
      )

      unsubscribeDeepClean = subscribeDailyDeepCleanByLocation(
        selectedLocation,
        (record) => {
          if (!disposed) setTodayDeepClean(record)
        },
        (reason) => {
          if (!disposed) setError(reason.message)
        },
      )

      unsubscribeDeepCleanHistory = subscribeDeepCleanHistoryByLocation(
        selectedLocation,
        (records) => {
          if (!disposed) setDeepCleanHistoryRows(records)
        },
        (reason) => {
          if (!disposed) setError(reason.message)
        },
      )

      unsubscribeAssignment = subscribeDailyAssignment(
        selectedLocation,
        (data) => {
          if (!disposed) setAssignment(data)
        },
        (reason) => {
          if (!disposed) setError(reason.message)
        },
      )

      unsubscribeReport = subscribeKartReport(
        selectedLocation,
        todayIST(),
        (record) => {
          if (!disposed) setKartReport(record)
        },
        (reason) => {
          if (!disposed) setError(reason.message)
        },
      )
    }

    void setup()

    return () => {
      disposed = true
      unsubscribeKarts?.()
      unsubscribeDeepClean?.()
      unsubscribeDeepCleanHistory?.()
      unsubscribeAssignment?.()
      unsubscribeReport?.()
    }
  }, [selectedLocation])

  const stats = useMemo(
    () => [
      { id: 'total', label: 'Total Karts', value: String(karts.length), tone: 'info' as const },
      {
        id: 'good',
        label: 'Good Condition',
        value: String(karts.filter((item) => item.condition === 'good').length),
        tone: 'success' as const,
      },
      {
        id: 'repair',
        label: 'Under Repair',
        value: String(karts.filter((item) => item.status === 'under_repair').length),
        tone: 'warning' as const,
      },
      {
        id: 'engine',
        label: 'Engine Fail',
        value: String(karts.filter((item) => item.engineStatus === 'engine_fail').length),
        tone: 'critical' as const,
      },
    ],
    [karts],
  )

  const openCreate = () => {
    setEditingKart(null)
    setFormOpen(true)
  }

  const openEdit = (kart: KartRecord) => {
    setEditingKart(kart)
    setFormOpen(true)
  }

  const handleOpenDeepClean = async () => {
    setDeepCleanOpen(true)

    // If no assignment yet, auto-create one
    if (!assignment) {
      setAssignmentLoading(true)
      try {
        await getOrCreateDailyAssignment(selectedLocation, karts)
        // The real-time subscription will pick up the new doc
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to assign kart for deep clean.')
      } finally {
        setAssignmentLoading(false)
      }
    }
  }

  const handleSaveKart = async (values: {
    kartNumber: string
    kartType: 'single' | 'double' | 'children'
    location: ScannerLocation
    condition: 'good' | 'damaged'
    engineStatus: 'working' | 'engine_fail'
    status: 'available' | 'under_repair'
    complaint: string
  }) => {
    if (!session) return
    const isNewKart = !editingKart
    if (isNewKart && !canManage) {
      setError('Only Owner or Admin can add new karts.')
      return
    }
    if (!isNewKart && !canUpdate) {
      setError('You do not have permission to update karts.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      await saveKart({
        id: editingKart?.id,
        kartNumber: values.kartNumber,
        kartType: values.kartType,
        location: values.location,
        condition: values.condition,
        engineStatus: values.engineStatus,
        status: values.status,
        complaint: values.complaint,
        userId: session.user.id,
      })
      setSuccess(editingKart ? 'Kart updated successfully.' : 'Kart added successfully.')
      setFormOpen(false)
      setEditingKart(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save kart.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeepClean = async (photos: File[]) => {
    if (!session || !assignment) return
    if (!canDeepClean) {
      setError('Only Owner, Admin, or Track Marshall can perform deep clean.')
      return
    }

    const kart = karts.find((k) => k.id === assignment.kartId)
    if (!kart) {
      setError('Assigned kart not found in the current location.')
      return
    }

    setDeepCleaning(true)
    setError(null)
    setSuccess(null)

    try {
      await performKartDeepClean({
        kart,
        location: selectedLocation,
        cleanedBy: session.user.name || 'Track Staff',
        cleanedByUid: session.user.id,
        photos,
      })
      setSuccess(`Deep clean completed for ${kart.kartNumber}.`)
      setDeepCleanOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save deep clean.')
    } finally {
      setDeepCleaning(false)
    }
  }

  const handleSubmitKartReport = async (entries: KartReportEntry[], notes: string) => {
    if (!session) return
    if (!canSubmitReport) {
      setError('You do not have permission to submit a kart report.')
      return
    }
    setKartReportSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await submitKartReport({
        location: selectedLocation,
        entries,
        notes,
        submittedBy: session.user.name || 'Track Staff',
        submittedByUid: session.user.id,
      })
      setSuccess('Kart report submitted and locked for today.')
      setKartReportOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to submit kart report.')
    } finally {
      setKartReportSubmitting(false)
    }
  }

  const handleDeleteKart = async (kart: KartRecord) => {
    if (!canManage) {
      setError('Only Owner or Admin can delete karts.')
      return
    }

    setDeleting(true)
    setError(null)
    setSuccess(null)
    try {
      await deleteKart(kart.location, kart.id)
      setSuccess(`Deleted ${kart.kartNumber}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to delete kart.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-track-surface">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-track-accent-soft/80">
              Location Based Kart Ops
            </p>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Karts</h2>
            <p className="text-sm text-gray-600 dark:text-white/60">
              Manage kart readiness, repairs, and the daily deep clean for the selected location.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-white/45">
                Location{isRoleLocked ? ' (Locked)' : ''}
              </span>
              <select
                value={selectedLocation}
                disabled={isRoleLocked}
                onChange={(event) => setSelectedLocation(event.target.value as ScannerLocation)}
                className={`min-w-56 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-track-accent dark:border-gray-700 dark:bg-track-panel dark:text-white disabled:opacity-60${isRoleLocked ? ' appearance-none' : ''}`}
              >
                {visibleLocations.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => void handleOpenDeepClean()}
              className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-white/70 dark:hover:border-white/20 dark:hover:text-white"
            >
              Deep Clean
            </button>

            {canSubmitReport ? (
              <button
                type="button"
                onClick={() => setKartReportOpen(true)}
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                  kartReport
                    ? 'border-success/40 bg-success/10 text-success hover:bg-success/15'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/15 dark:text-amber-300'
                }`}
              >
                {kartReport ? 'View Report' : 'Kart Report'}
              </button>
            ) : null}

            {canManage ? (
              <button
                type="button"
                onClick={openCreate}
                className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-white/70 dark:hover:border-white/20 dark:hover:text-white"
              >
                Add Kart
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {success}
        </div>
      ) : null}

      {assignment && !assignment.cleaned ? (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <span className="text-lg">🧹</span>
          <p className="text-sm font-medium text-amber-600 dark:text-amber-300">
            Kart {assignment.kartNumber} should be deep cleaned today.
          </p>
        </div>
      ) : null}

      {!kartReport ? (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <span className="text-lg">⚠️</span>
          <p className="text-sm font-medium text-amber-600 dark:text-amber-300">
            Kart report pending for today — cashier shift cannot start until submitted.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
          <span className="text-lg">✅</span>
          <p className="text-sm font-medium text-success">
            Kart report submitted by {kartReport.submittedBy || '—'} — locked for today.
          </p>
        </div>
      )}

      <SummaryCards items={stats} />

      <KartList
        karts={karts}
        canManage={canManage}
        canUpdate={canUpdate}
        loading={loading}
        onEdit={openEdit}
        onDelete={handleDeleteKart}
        deleting={deleting}
      />

      <KartForm
        open={formOpen}
        initialKart={editingKart}
        existingKarts={karts}
        selectedLocation={selectedLocation}
        submitting={saving}
        onClose={() => {
          setFormOpen(false)
          setEditingKart(null)
        }}
        onSubmit={handleSaveKart}
      />

      <KartDeepClean
        open={deepCleanOpen}
        location={selectedLocation}
        assignment={assignment}
        assignmentLoading={assignmentLoading}
        canUpload={canDeepClean}
        loading={deepCleaning}
        historyRows={deepCleanHistoryRows}
        onClose={() => {
          setDeepCleanOpen(false)
        }}
        onSubmit={handleDeepClean}
      />

      <KartReportModal
        open={kartReportOpen}
        location={selectedLocation}
        karts={karts}
        existingReport={kartReport}
        canSubmit={canSubmitReport}
        loading={kartReportSubmitting}
        onClose={() => setKartReportOpen(false)}
        onSubmit={handleSubmitKartReport}
      />
    </div>
  )
}
