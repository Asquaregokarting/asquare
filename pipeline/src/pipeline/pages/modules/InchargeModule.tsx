import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { SummaryCards } from '../../components/ui/SummaryCards'
import { useAuth } from '../../features/auth/auth-context'
import { useLocations } from '../../hooks/useLocations'
import { resolveLocation } from '../../../lib/locations'
import { uploadPipelineFile } from '../../lib/firebase-storage'
import { todayIST, fmtDateShortIST, fmtDateTimeIST } from '../../lib/ist-date'
import {
  inchargeTasksApi,
  INCHARGE_PHOTO_MIN,
  type InchargeDailyRecord,
  type InchargeKartCondition,
  type InchargePhotoTask,
  type InchargeVehicleReport,
  type InchargeVehicleReportEntry,
} from '../../api/incharge-tasks'
import {
  subscribeKartsByLocation,
  type KartRecord,
} from '../../features/track/services/kartService'

export type InchargeView = 'tasks' | 'vehicle' | 'reports'

const titleMap: Record<InchargeView, string> = {
  tasks: 'Incharge — Daily Tasks',
  vehicle: 'Vehicle Report',
  reports: 'Incharge Reports',
}

const subtitleMap: Record<InchargeView, string> = {
  tasks: 'Mandatory daily checks. Complete all three to enable End Shift.',
  vehicle: 'Rate every kart at your branch before submitting.',
  reports: 'Cross-location daily submissions, photos, and kart conditions.',
}

const baseSubnav = [
  { label: 'Tasks', to: '/incharge/tasks' },
  { label: 'Vehicle Report', to: '/incharge/vehicle' },
]
const ownerSubnav = [...baseSubnav, { label: 'Incharge Reports', to: '/incharge/reports' }]

const CONDITION_LABELS: Record<InchargeKartCondition, string> = {
  good: 'Good',
  minor_issue: 'Minor Issue',
  bad: 'Bad',
  engine_failure: 'Engine Failure',
}

const CONDITION_OPTIONS: Array<{ value: InchargeKartCondition; label: string; tone: string }> = [
  { value: 'good', label: 'Good', tone: 'text-success' },
  { value: 'minor_issue', label: 'Minor Issue', tone: 'text-warning' },
  { value: 'bad', label: 'Bad', tone: 'text-critical' },
  { value: 'engine_failure', label: 'Engine Failure', tone: 'text-critical' },
]

interface BranchContext {
  slug: string
  displayName: string
}

const useBranchContext = (): BranchContext | null => {
  const { lockedLocationId, isRoleLocked, enabledLocations } = useLocations()
  const slug = isRoleLocked && lockedLocationId ? lockedLocationId : enabledLocations[0]?.slug || ''

  return useMemo(() => {
    if (!slug) return null
    const resolved = resolveLocation(slug)
    return {
      slug,
      displayName: resolved?.displayName ?? slug,
    }
  }, [slug])
}

// ─── Photo Capture Modal (camera-only) ──────────────────────────────────────

interface PhotoCaptureModalProps {
  open: boolean
  taskKey: 'washroom' | 'housekeeping'
  title: string
  branch: BranchContext
  userId: string
  userName: string
  onClose: () => void
  onSubmitted: () => void
}

const PhotoCaptureModal = ({
  open,
  taskKey,
  title,
  branch,
  userId,
  userName,
  onClose,
  onSubmitted,
}: PhotoCaptureModalProps) => {
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) {
      previews.forEach((url) => URL.revokeObjectURL(url))
      setFiles([])
      setPreviews([])
      setError(null)
      setSubmitting(false)
    }
    // Cleanup on unmount
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const handleCapture = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0]
    if (!next) return
    setFiles((current) => [...current, next])
    setPreviews((current) => [...current, URL.createObjectURL(next)])
    // Reset the input so capturing the same camera image twice still fires onChange.
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleRemove = (index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index))
    setPreviews((current) => {
      const removed = current[index]
      if (removed) URL.revokeObjectURL(removed)
      return current.filter((_, i) => i !== index)
    })
  }

  const handleSubmit = async () => {
    if (files.length < INCHARGE_PHOTO_MIN) {
      setError(`Capture at least ${INCHARGE_PHOTO_MIN} photos before submitting.`)
      return
    }
    setSubmitting(true)
    setError(null)
    const date = todayIST()
    try {
      const urls: string[] = []
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]
        const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.jpg').toLowerCase()
        const path = `inchargeTasks/${branch.slug}/${date}/${taskKey}/${userId}-${Date.now()}-${i}${ext}`
        const { downloadUrl } = await uploadPipelineFile(path, file, 'images')
        urls.push(downloadUrl)
      }
      await inchargeTasksApi.completePhotoTask({
        locationId: branch.slug,
        locationName: branch.displayName,
        date,
        taskKey,
        photoUrls: urls,
        userId,
        userName,
      })
      onSubmitted()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to upload photos.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-base/77 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {branch.displayName}
            </p>
            <h3 className="font-display text-lg font-bold text-text">{title}</h3>
            <p className="mt-1 text-xs text-muted">
              Capture at least {INCHARGE_PHOTO_MIN} photos with the back camera. Gallery upload is
              disabled.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:text-text disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <div className="mt-4">
          <p className="text-xs text-muted">
            Captured: {files.length} / {INCHARGE_PHOTO_MIN}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {previews.map((url, index) => (
              <div
                key={url}
                className="relative aspect-square overflow-hidden rounded-lg border border-border bg-bg"
              >
                <img
                  src={url}
                  alt={`Capture ${index + 1}`}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  disabled={submitting}
                  className="absolute right-1 top-1 rounded-full bg-base/75 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-base/85 disabled:opacity-50"
                  aria-label="Remove photo"
                >
                  ✕
                </button>
              </div>
            ))}
            <label className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-bg text-xs font-semibold text-muted hover:text-text">
              + Capture
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleCapture}
                disabled={submitting}
              />
            </label>
          </div>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-xs text-critical">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:text-text disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || files.length < INCHARGE_PHOTO_MIN}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Uploading…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tasks Landing View ─────────────────────────────────────────────────────

interface TasksLandingProps {
  branch: BranchContext
  userId: string
  userName: string
}

const StatusPill = ({ completed }: { completed: boolean }) => (
  <span
    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
      completed ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
    }`}
  >
    {completed ? 'Completed' : 'Pending'}
  </span>
)

const TasksLandingView = ({ branch, userId, userName }: TasksLandingProps) => {
  const navigate = useNavigate()
  const [record, setRecord] = useState<InchargeDailyRecord | null>(null)
  const [karts, setKarts] = useState<KartRecord[]>([])
  const [openTask, setOpenTask] = useState<'washroom' | 'housekeeping' | null>(null)

  useEffect(() => {
    const unsub = inchargeTasksApi.subscribeForToday(branch.slug, setRecord)
    return () => unsub()
  }, [branch.slug])

  useEffect(() => {
    const unsub = subscribeKartsByLocation(branch.displayName, setKarts)
    return () => unsub()
  }, [branch.displayName])

  const washroomDone = inchargeTasksApi.isPhotoTaskComplete(record?.washroom ?? null)
  const housekeepingDone = inchargeTasksApi.isPhotoTaskComplete(record?.housekeeping ?? null)
  const vehicleDone = inchargeTasksApi.isVehicleReportComplete(record?.vehicleReport ?? null)
  const allDone = washroomDone && housekeepingDone && vehicleDone

  const washroomCount = record?.washroom?.photos.length ?? 0
  const housekeepingCount = record?.housekeeping?.photos.length ?? 0
  const reviewedCount = record?.vehicleReport?.entries.length ?? 0

  return (
    <>
      <SummaryCards
        items={[
          { id: 'branch', label: 'Branch', value: branch.displayName, tone: 'info' },
          { id: 'date', label: 'Today', value: fmtDateShortIST(todayIST()), tone: 'muted' },
          {
            id: 'status',
            label: 'Overall',
            value: allDone ? 'All done' : 'Pending',
            tone: allDone ? 'success' : 'warning',
          },
        ]}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Washroom */}
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Task 1</p>
              <h3 className="font-display text-lg font-bold text-text">Washroom Cleaning</h3>
            </div>
            <StatusPill completed={washroomDone} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {washroomCount} / {INCHARGE_PHOTO_MIN} photos captured
          </p>
          <button
            type="button"
            onClick={() => setOpenTask('washroom')}
            className="mt-3 w-full rounded-lg border border-primary/45 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
          >
            {washroomDone ? 'Re-submit' : 'Open'}
          </button>
        </div>

        {/* Housekeeping */}
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Task 2</p>
              <h3 className="font-display text-lg font-bold text-text">Housekeeping</h3>
            </div>
            <StatusPill completed={housekeepingDone} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {housekeepingCount} / {INCHARGE_PHOTO_MIN} photos captured
          </p>
          <button
            type="button"
            onClick={() => setOpenTask('housekeeping')}
            className="mt-3 w-full rounded-lg border border-primary/45 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
          >
            {housekeepingDone ? 'Re-submit' : 'Open'}
          </button>
        </div>

        {/* Vehicle Report */}
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Task 3</p>
              <h3 className="font-display text-lg font-bold text-text">Vehicle Report</h3>
            </div>
            <StatusPill completed={vehicleDone} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {reviewedCount} / {karts.length} karts reviewed
          </p>
          <button
            type="button"
            onClick={() => navigate('/incharge/vehicle')}
            className="mt-3 w-full rounded-lg border border-primary/45 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
          >
            {vehicleDone ? 'Review' : 'Open'}
          </button>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted">
        All three tasks must be completed to enable the End Shift button on the Shifts page.
      </p>

      <PhotoCaptureModal
        open={openTask !== null}
        taskKey={openTask ?? 'washroom'}
        title={openTask === 'housekeeping' ? 'Housekeeping' : 'Washroom Cleaning'}
        branch={branch}
        userId={userId}
        userName={userName}
        onClose={() => setOpenTask(null)}
        onSubmitted={() => setOpenTask(null)}
      />
    </>
  )
}

// ─── Vehicle Report View ────────────────────────────────────────────────────

interface VehicleReportProps {
  branch: BranchContext
  userId: string
  userName: string
}

interface DraftEntry {
  condition: InchargeKartCondition | ''
  remarks: string
}

const VehicleReportView = ({ branch, userId, userName }: VehicleReportProps) => {
  const [karts, setKarts] = useState<KartRecord[]>([])
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [record, setRecord] = useState<InchargeDailyRecord | null>(null)
  const [editing, setEditing] = useState<boolean>(true)
  // Tracks whether we've handled the first snapshot for this branch — used to
  // auto-flip into review mode exactly once when an existing submission loads.
  const firstSnapshotHandled = useRef<boolean>(false)

  // Reset the first-snapshot flag whenever the branch changes so the auto-flip
  // logic runs again for the new branch's daily doc.
  useEffect(() => {
    firstSnapshotHandled.current = false
    setEditing(true)
  }, [branch.slug])

  // Live subscription to today's incharge doc — single source of truth shared
  // with TasksLandingView, ShiftsModule, and IncharageReportsView.
  useEffect(() => {
    const unsub = inchargeTasksApi.subscribeForToday(branch.slug, (rec) => {
      setRecord(rec)
      if (!firstSnapshotHandled.current) {
        firstSnapshotHandled.current = true
        if (rec?.vehicleReport?.completed === true) {
          setEditing(false)
        }
      }
    })
    return () => unsub()
  }, [branch.slug])

  useEffect(() => {
    const unsub = subscribeKartsByLocation(branch.displayName, setKarts)
    return () => unsub()
  }, [branch.displayName])

  // Merge stored entries into the draft form. Runs whenever the kart list or
  // the live record changes. Preserves the user's in-flight edits when they
  // are actively editing — only fills slots that the user has not touched.
  useEffect(() => {
    if (karts.length === 0) return
    const stored = record?.vehicleReport?.entries ?? []
    const byKartId = new Map(stored.map((e) => [e.kartId, e]))
    setDrafts((current) => {
      const next: Record<string, DraftEntry> = {}
      for (const k of karts) {
        const existing = current[k.id]
        const fromDoc = byKartId.get(k.id)
        if (editing && existing && existing.condition) {
          // User is mid-edit on this kart — keep their input.
          next[k.id] = existing
        } else if (fromDoc) {
          next[k.id] = { condition: fromDoc.condition, remarks: fromDoc.remarks ?? '' }
        } else {
          next[k.id] = existing ?? { condition: '', remarks: '' }
        }
      }
      return next
    })
  }, [karts, record, editing])

  const reviewedCount = useMemo(
    () => karts.filter((k) => drafts[k.id]?.condition).length,
    [drafts, karts],
  )
  const allReviewed = karts.length > 0 && reviewedCount === karts.length

  const updateDraft = (kartId: string, patch: Partial<DraftEntry>) => {
    setDrafts((current) => ({
      ...current,
      [kartId]: { ...(current[kartId] ?? { condition: '', remarks: '' }), ...patch },
    }))
  }

  const handleSubmit = async () => {
    if (!allReviewed) {
      setError('Rate every kart before submitting.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const entries: InchargeVehicleReportEntry[] = karts.map((k) => {
        const draft = drafts[k.id]
        return {
          kartId: k.id,
          kartNumber: k.kartNumber,
          condition: draft.condition as InchargeKartCondition,
          remarks: draft.remarks.trim() || undefined,
        }
      })
      await inchargeTasksApi.completeVehicleReport({
        locationId: branch.slug,
        locationName: branch.displayName,
        date: todayIST(),
        entries,
        userId,
        userName,
      })
      // Stay on the page so the live snapshot can repaint the review banner
      // with the fresh completedAt / completedByName — gives the user direct
      // confirmation of what they just saved.
      setEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to submit vehicle report.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {record?.vehicleReport?.completed ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/45 bg-success/10 px-4 py-3">
          <div className="text-sm">
            <p className="font-semibold text-success">
              ✓ Submitted by {record.vehicleReport.completedByName ?? '—'}
              {record.vehicleReport.completedAt
                ? ` at ${fmtDateTimeIST(record.vehicleReport.completedAt)}`
                : ''}
            </p>
            <p className="text-xs text-muted">
              {record.vehicleReport.entries.length} kart
              {record.vehicleReport.entries.length !== 1 ? 's' : ''} reviewed.
            </p>
          </div>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg border border-primary/45 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
            >
              Edit &amp; Resubmit
            </button>
          ) : null}
        </div>
      ) : null}

      <SummaryCards
        items={[
          { id: 'branch', label: 'Branch', value: branch.displayName, tone: 'info' },
          { id: 'date', label: 'Date', value: fmtDateShortIST(todayIST()), tone: 'muted' },
          {
            id: 'progress',
            label: 'Reviewed',
            value: `${reviewedCount} / ${karts.length}`,
            tone: allReviewed ? 'success' : 'warning',
          },
        ]}
      />

      <div className="mt-4 space-y-3">
        {karts.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
            No karts found at this branch.
          </p>
        ) : (
          karts.map((kart) => {
            const draft = drafts[kart.id] ?? { condition: '', remarks: '' }
            return (
              <div key={kart.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-text">{kart.kartNumber}</p>
                    <p className="text-xs text-muted">{kart.kartType}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {CONDITION_OPTIONS.map((opt) => {
                      const checked = draft.condition === opt.value
                      return (
                        <label
                          key={opt.value}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                            checked
                              ? 'border-primary bg-primary/15 text-primary'
                              : 'border-border text-muted hover:text-text'
                          } ${editing ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
                        >
                          <input
                            type="radio"
                            name={`cond-${kart.id}`}
                            value={opt.value}
                            checked={checked}
                            disabled={!editing}
                            onChange={() => updateDraft(kart.id, { condition: opt.value })}
                            className="hidden"
                          />
                          {opt.label}
                        </label>
                      )
                    })}
                  </div>
                </div>
                <input
                  type="text"
                  value={draft.remarks}
                  onChange={(e) => updateDraft(kart.id, { remarks: e.target.value })}
                  placeholder="Optional remarks"
                  disabled={!editing}
                  className="ui-field mt-2 min-h-9 w-full text-sm disabled:cursor-not-allowed disabled:opacity-70"
                />
              </div>
            )
          })
        )}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}

      {editing ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !allReviewed}
            title={!allReviewed ? `${karts.length - reviewedCount} kart(s) pending` : undefined}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit Report'}
          </button>
        </div>
      ) : null}
    </>
  )
}

// ─── Photo Preview Modal (read-only lightbox) ───────────────────────────────

interface PhotoPreviewModalProps {
  open: boolean
  title: string
  photos: string[]
  onClose: () => void
}

const PhotoPreviewModal = ({ open, title, photos, onClose }: PhotoPreviewModalProps) => {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    if (!open) setActive(null)
  }, [open])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-base/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-border bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Photo Preview
            </p>
            <h3 className="font-display text-lg font-bold text-text">{title}</h3>
            <p className="mt-1 text-xs text-muted">
              {photos.length} photo{photos.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:text-text"
          >
            Close
          </button>
        </div>

        {active ? (
          <div className="mt-4">
            <img
              src={active}
              alt="Preview"
              className="mx-auto max-h-[70vh] w-auto rounded-lg object-contain"
            />
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={() => setActive(null)}
                className="text-xs text-muted hover:text-text"
              >
                ← Back to thumbnails
              </button>
            </div>
          </div>
        ) : photos.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-bg px-4 py-6 text-center text-sm text-muted">
            No photos uploaded.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                onClick={() => setActive(url)}
                className="aspect-square overflow-hidden rounded-lg border border-border bg-bg hover:border-primary"
              >
                <img src={url} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Incharge Reports View ──────────────────────────────────────────────────

type CellStatus = 'completed' | 'partial' | 'pending'

interface ReportCell {
  key: string // `${slug}_${date}`
  date: string
  locationSlug: string
  locationName: string
  record: InchargeDailyRecord | null
  status: CellStatus
  inchargeName: string
}

const computeCellStatus = (record: InchargeDailyRecord | null): CellStatus => {
  if (!record) return 'pending'
  const w = inchargeTasksApi.isPhotoTaskComplete(record.washroom)
  const h = inchargeTasksApi.isPhotoTaskComplete(record.housekeeping)
  const v = inchargeTasksApi.isVehicleReportComplete(record.vehicleReport)
  const done = [w, h, v].filter(Boolean).length
  if (done === 3) return 'completed'
  if (done === 0) return 'pending'
  return 'partial'
}

const cellInchargeName = (record: InchargeDailyRecord | null): string => {
  if (!record) return ''
  return (
    record.washroom?.completedByName ??
    record.housekeeping?.completedByName ??
    record.vehicleReport?.completedByName ??
    ''
  )
}

const lastUpdatedAt = (record: InchargeDailyRecord | null): string | undefined => {
  if (!record) return undefined
  const candidates = [
    record.updatedAt,
    record.washroom?.completedAt,
    record.housekeeping?.completedAt,
    record.vehicleReport?.completedAt,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (candidates.length === 0) return undefined
  return candidates.sort().reverse()[0]
}

const StatusPillReports = ({ status }: { status: CellStatus }) => {
  const tone =
    status === 'completed'
      ? 'bg-success/15 text-success'
      : status === 'partial'
        ? 'bg-warning/15 text-warning'
        : 'bg-critical/15 text-critical'
  const label = status === 'completed' ? 'Completed' : status === 'partial' ? 'Partial' : 'Pending'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
  )
}

const TaskRow = ({
  icon,
  label,
  task,
  onPreview,
}: {
  icon: string
  label: string
  task: InchargePhotoTask | null
  onPreview: () => void
}) => {
  const completed = inchargeTasksApi.isPhotoTaskComplete(task)
  const photoCount = task?.photos.length ?? 0
  const status: CellStatus = completed ? 'completed' : photoCount > 0 ? 'partial' : 'pending'
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span aria-hidden>{icon}</span>
        <span className="font-medium text-text">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <StatusPillReports status={status} />
        <span className="text-xs text-muted">
          {photoCount} photo{photoCount !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={onPreview}
          disabled={photoCount === 0}
          className="rounded border border-border px-2 py-1 text-xs font-semibold text-muted hover:text-text disabled:opacity-40"
        >
          Preview
        </button>
      </div>
    </div>
  )
}

const VehicleSummaryRow = ({ report }: { report: InchargeVehicleReport | null }) => {
  const [expanded, setExpanded] = useState(false)
  if (!report) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span aria-hidden>🚗</span>
          <span className="font-medium text-text">Vehicle Report</span>
        </div>
        <div className="flex items-center gap-3">
          <StatusPillReports status="pending" />
          <span className="text-xs text-muted">0 karts</span>
        </div>
      </div>
    )
  }
  const total = report.entries.length
  const issues = report.entries.filter((e) => e.condition !== 'good')
  const status: CellStatus =
    report.completed && total > 0 ? 'completed' : total > 0 ? 'partial' : 'pending'
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden>🚗</span>
          <span className="font-medium text-text">Vehicle Report</span>
        </div>
        <div className="flex items-center gap-3">
          <StatusPillReports status={status} />
          <span className="text-xs text-muted">
            {total} kart{total !== 1 ? 's' : ''} checked
          </span>
        </div>
      </div>
      {issues.length > 0 ? (
        <div className="mt-2 space-y-1">
          {(expanded ? report.entries : issues).map((entry) => {
            const tone =
              entry.condition === 'good'
                ? 'text-success'
                : entry.condition === 'minor_issue'
                  ? 'text-warning'
                  : 'text-critical'
            return (
              <div key={entry.kartId} className="text-xs">
                <span className="font-semibold text-text">{entry.kartNumber}</span>
                <span className={`mx-1 font-semibold ${tone}`}>
                  — {CONDITION_LABELS[entry.condition]}
                </span>
                {entry.remarks ? <span className="text-muted">— {entry.remarks}</span> : null}
              </div>
            )
          })}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {expanded ? 'Show only issues' : `Show all ${total} karts`}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-success">All karts marked Good.</p>
      )}
    </div>
  )
}

const ReportsCard = ({
  cell,
  onPreview,
}: {
  cell: ReportCell
  onPreview: (title: string, photos: string[]) => void
}) => {
  const updated = lastUpdatedAt(cell.record)
  const inchargeName = cell.inchargeName || '—'
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-text">
            {cell.locationName} — {cell.date}
          </h3>
          <p className="mt-1 text-xs text-muted">
            {cell.record ? (
              <>
                Submitted by {inchargeName}
                {updated ? ` · Last update ${fmtDateTimeIST(updated)}` : ''}
              </>
            ) : (
              'No submissions for this date.'
            )}
          </p>
        </div>
        <StatusPillReports status={cell.status} />
      </div>

      {cell.record ? (
        <div className="mt-3 space-y-2">
          <TaskRow
            icon="🧻"
            label="Washroom Cleaning"
            task={cell.record.washroom}
            onPreview={() =>
              onPreview(
                `Washroom — ${cell.locationName} — ${cell.date}`,
                cell.record!.washroom?.photos ?? [],
              )
            }
          />
          <TaskRow
            icon="🧹"
            label="Housekeeping"
            task={cell.record.housekeeping}
            onPreview={() =>
              onPreview(
                `Housekeeping — ${cell.locationName} — ${cell.date}`,
                cell.record!.housekeeping?.photos ?? [],
              )
            }
          />
          <VehicleSummaryRow report={cell.record.vehicleReport} />
        </div>
      ) : null}
    </div>
  )
}

interface IncharageReportsViewProps {
  defaultLocationSlugs: string[]
  locationOptions: Array<{ slug: string; displayName: string }>
}

const IncharageReportsView = ({
  defaultLocationSlugs,
  locationOptions,
}: IncharageReportsViewProps) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const today = todayIST()
  const from = searchParams.get('from') ?? today
  const to = searchParams.get('to') ?? today
  const locationFilter = searchParams.get('location') ?? ''
  const inchargeFilter = searchParams.get('incharge') ?? ''

  const [rows, setRows] = useState<InchargeDailyRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewTitle, setPreviewTitle] = useState('')
  const [previewPhotos, setPreviewPhotos] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    inchargeTasksApi
      .listForRange({
        from,
        to,
        locationSlugs: locationFilter ? [locationFilter] : defaultLocationSlugs,
      })
      .then((result) => {
        if (cancelled) return
        setRows(result)
      })
      .catch((reason) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : 'Failed to load reports.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [from, to, locationFilter, defaultLocationSlugs])

  // Build the (date × location) matrix so locations with no doc on a day still show.
  const cells = useMemo<ReportCell[]>(() => {
    const dateList: string[] = []
    const start = new Date(from)
    const end = new Date(to)
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dateList.push(d.toISOString().slice(0, 10))
    }
    if (dateList.length === 0) dateList.push(from)

    const slugs = locationFilter
      ? locationOptions.filter((l) => l.slug === locationFilter)
      : locationOptions

    const recordByKey = new Map<string, InchargeDailyRecord>()
    for (const r of rows) recordByKey.set(`${r.locationId}_${r.date}`, r)

    const matrix: ReportCell[] = []
    for (const date of dateList) {
      for (const loc of slugs) {
        const record = recordByKey.get(`${loc.slug}_${date}`) ?? null
        const inchargeName = cellInchargeName(record)
        if (inchargeFilter && !inchargeName.toLowerCase().includes(inchargeFilter.toLowerCase())) {
          continue
        }
        matrix.push({
          key: `${loc.slug}_${date}`,
          date,
          locationSlug: loc.slug,
          locationName: loc.displayName,
          record,
          status: computeCellStatus(record),
          inchargeName,
        })
      }
    }
    matrix.sort(
      (a, b) => b.date.localeCompare(a.date) || a.locationName.localeCompare(b.locationName),
    )
    return matrix
  }, [from, to, locationFilter, inchargeFilter, locationOptions, rows])

  const summary = useMemo(() => {
    let completed = 0
    let partial = 0
    let pending = 0
    for (const cell of cells) {
      if (cell.status === 'completed') completed++
      else if (cell.status === 'partial') partial++
      else pending++
    }
    return { total: cells.length, completed, partial, pending }
  }, [cells])

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const handleReset = () => {
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  const handlePreview = (title: string, photos: string[]) => {
    setPreviewTitle(title)
    setPreviewPhotos(photos)
    setPreviewOpen(true)
  }

  return (
    <>
      <div className="mb-4 rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-muted">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => updateParam('from', e.target.value)}
              className="ui-field mt-1 min-h-9"
            />
          </label>
          <label className="flex flex-col text-xs text-muted">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => updateParam('to', e.target.value)}
              className="ui-field mt-1 min-h-9"
            />
          </label>
          <label className="flex flex-col text-xs text-muted">
            Location
            <select
              value={locationFilter}
              onChange={(e) => updateParam('location', e.target.value)}
              className="ui-field mt-1 min-h-9"
            >
              <option value="">All locations</option>
              {locationOptions.map((loc) => (
                <option key={loc.slug} value={loc.slug}>
                  {loc.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-muted">
            Incharge name
            <input
              type="text"
              value={inchargeFilter}
              onChange={(e) => updateParam('incharge', e.target.value)}
              placeholder="Search…"
              className="ui-field mt-1 min-h-9 w-48"
            />
          </label>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:text-text"
          >
            Reset
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled
            title="Coming soon"
            className="rounded-lg border border-border bg-bg px-3 py-2 text-xs font-semibold text-muted opacity-60"
          >
            Download report
          </button>
        </div>
      </div>

      <SummaryCards
        items={[
          { id: 'total', label: 'Locations × Days', value: String(summary.total), tone: 'info' },
          {
            id: 'completed',
            label: 'Completed',
            value: String(summary.completed),
            tone: 'success',
          },
          { id: 'partial', label: 'Partial', value: String(summary.partial), tone: 'warning' },
          { id: 'pending', label: 'Pending', value: String(summary.pending), tone: 'critical' },
        ]}
      />

      {error ? (
        <p className="mt-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cells.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted md:col-span-2 xl:col-span-3">
            {loading ? 'Loading…' : 'No records for the selected filters.'}
          </p>
        ) : (
          cells.map((cell) => <ReportsCard key={cell.key} cell={cell} onPreview={handlePreview} />)
        )}
      </div>

      <PhotoPreviewModal
        open={previewOpen}
        title={previewTitle}
        photos={previewPhotos}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  )
}

// ─── Module entry ───────────────────────────────────────────────────────────

const InchargeModule = ({ view }: { view: InchargeView }) => {
  const { session } = useAuth()
  const branch = useBranchContext()
  const { enabledLocations } = useLocations()

  if (!session) return null

  const isOwnerOrAdmin = session.user.role === 'Owner' || session.user.role === 'Admin'
  const subnav = isOwnerOrAdmin ? ownerSubnav : baseSubnav

  // Reports tab is Owner/Admin only — anyone else is bounced back to Tasks.
  if (view === 'reports' && !isOwnerOrAdmin) {
    return <Navigate replace to="/incharge/tasks" />
  }

  const locationOptions = enabledLocations.map((l) => ({
    slug: l.slug,
    displayName: l.displayName,
  }))
  const defaultLocationSlugs = locationOptions.map((l) => l.slug)

  return (
    <ModulePageLayout
      moduleTab="Incharge"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={['Pipeline', 'Incharge', titleMap[view]]}
      subnav={subnav}
    >
      {view === 'reports' ? (
        <IncharageReportsView
          defaultLocationSlugs={defaultLocationSlugs}
          locationOptions={locationOptions}
        />
      ) : !branch ? (
        <p className="rounded-lg border border-warning/45 bg-warning/10 px-4 py-3 text-sm text-warning">
          No branch is assigned to your account. Please contact an administrator.
        </p>
      ) : view === 'tasks' ? (
        <TasksLandingView branch={branch} userId={session.user.id} userName={session.user.name} />
      ) : (
        <VehicleReportView branch={branch} userId={session.user.id} userName={session.user.name} />
      )}
    </ModulePageLayout>
  )
}

export default InchargeModule
