import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { normalizeLocationId } from '../../../../../lib/locations'
import { AnimatePresence, motion } from 'framer-motion'
import { fmtDateIST, fmtTimeShortIST } from '../../../../../lib/date-format'
import { todayIST } from '../../../../lib/ist-date'
import { useAuth } from '../../../auth/auth-context'
import { isLocationRestrictedRole } from '../../../../api/firestore-session'
import { initializeFirestore } from '../../../../lib/firebase'
import { DeepCleanAssignment, subscribeDailyAssignment } from '../../services/kartService'
import { ImageLightbox, useLightbox } from '../../../../components/ui/ImageLightbox'
import {
  SCANNER_LOCATION_DOC_IDS,
  ScannerLocation,
  Shift,
  ShiftEndVerificationPhotos,
  ShiftParticipant,
  ShiftVerificationPhotos,
} from '../types/scanner.types'
import { ShiftEndVerification } from './ShiftEndVerification'
import { logger } from '../../../../../lib/logger'

// ─── Helpers ────────────────────────────────────────────────────────────

const normalizeRole = (role: string): string =>
  String(role ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

const canStartShift = (role: string): boolean =>
  ['owner', 'admin', 'track_marshall', 'trackmarshall'].includes(normalizeRole(role))

const isAdminOrOwner = (role: string): boolean => ['owner', 'admin'].includes(normalizeRole(role))

const formatTime = (iso: string): string => {
  return fmtTimeShortIST(iso)
}

const formatDate = (dateStr: string): string => {
  return fmtDateIST(dateStr)
}

const calcElapsed = (startIso: string, nowMs: number): string => {
  const diffMs = nowMs - new Date(startIso).getTime()
  if (diffMs < 0) return '0m'
  const h = Math.floor(diffMs / 3_600_000)
  const m = Math.floor((diffMs % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ─── Shift Images Modal ─────────────────────────────────────────────────

interface ShiftImageRecord {
  id: string
  shiftDate: string
  location: ScannerLocation
  startedBy: string
  photos: ShiftVerificationPhotos
}

const PHOTO_LABELS: Array<{ key: keyof ShiftVerificationPhotos; label: string }> = [
  { key: 'selfie', label: 'Staff Selfie' },
  { key: 'track', label: 'Track Photo' },
  { key: 'kart', label: 'Kart Photo' },
]

const ShiftImagesModal = ({
  location,
  onClose,
}: {
  location: ScannerLocation
  onClose: () => void
}) => {
  const [records, setRecords] = useState<ShiftImageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const { lightboxImages, lightboxIndex, openLightbox, closeLightbox } = useLightbox()

  useEffect(() => {
    const db = initializeFirestore()
    if (!db) {
      setLoading(false)
      return
    }

    const locationDocId = SCANNER_LOCATION_DOC_IDS[location]
    const shiftDocRef = doc(db, 'shifts', locationDocId)

    const fetchAll = async () => {
      const items: ShiftImageRecord[] = []

      // 1. Current shift document (today's data)
      const currentSnap = await getDoc(shiftDocRef)
      if (currentSnap.exists()) {
        const data = currentSnap.data()
        if (
          data.verificationPhotos?.selfie ||
          data.verificationPhotos?.track ||
          data.verificationPhotos?.kart
        ) {
          items.push({
            id: currentSnap.id,
            shiftDate: String(data.shiftDate ?? ''),
            location: data.location as ScannerLocation,
            startedBy: String(data.startedBy ?? ''),
            photos: data.verificationPhotos as ShiftVerificationPhotos,
          })
        }
      }

      // 2. History subcollection (past shift records)
      const historySnap = await getDocs(
        query(collection(db, 'shifts', locationDocId, 'history'), orderBy('shiftDate', 'desc')),
      )

      for (const histDoc of historySnap.docs) {
        const data = histDoc.data()
        if (
          data.verificationPhotos?.selfie ||
          data.verificationPhotos?.track ||
          data.verificationPhotos?.kart
        ) {
          items.push({
            id: histDoc.id,
            shiftDate: String(data.shiftDate ?? ''),
            location: (data.location as ScannerLocation) ?? location,
            startedBy: String(data.startedBy ?? ''),
            photos: data.verificationPhotos as ShiftVerificationPhotos,
          })
        }
      }

      // Deduplicate by shiftDate
      const seen = new Set<string>()
      const deduplicated = items.filter((item) => {
        if (seen.has(item.shiftDate)) return false
        seen.add(item.shiftDate)
        return true
      })

      deduplicated.sort((a, b) => b.shiftDate.localeCompare(a.shiftDate))
      setRecords(deduplicated)
      setLoading(false)
    }

    void fetchAll().catch(() => setLoading(false))
  }, [location])

  const today = todayIST()
  const todayRecords = records.filter((r) => r.shiftDate === today)
  const historyRecords = records.filter((r) => r.shiftDate !== today)
  const displayRecords = showHistory ? historyRecords : todayRecords

  const renderImageGrid = (rec: ShiftImageRecord) => (
    <div key={rec.id} className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-white/80">
          {rec.shiftDate === today ? 'Today' : formatDate(rec.shiftDate)}
        </p>
        {rec.shiftDate === today ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
            Current
          </span>
        ) : null}
        <span className="text-xs text-white/35">by {rec.startedBy}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {PHOTO_LABELS.map(({ key, label }) => {
          const allUrls = PHOTO_LABELS.map((p) => rec.photos[p.key]).filter(Boolean) as string[]
          const idx = allUrls.indexOf(rec.photos[key] as string)
          return (
            <div key={key} className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-white/30">{label}</p>
              {rec.photos[key] ? (
                <img
                  src={rec.photos[key]}
                  alt={label}
                  className="aspect-square w-full cursor-pointer rounded-lg border border-white/10 object-cover transition-opacity hover:opacity-80"
                  onClick={() => openLightbox(allUrls, Math.max(0, idx))}
                />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-white/20">
                  N/A
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-700 bg-track-panel p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">
              Shift Start Images
            </p>
            <p className="mt-1 text-sm text-white/60">{location}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-700 px-3 py-1.5 text-xs text-white/60"
          >
            Close
          </button>
        </div>

        {/* Tab bar: Today / History */}
        <div className="mt-4 flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          <button
            type="button"
            onClick={() => setShowHistory(false)}
            className={`flex flex-1 items-center justify-center rounded-lg py-2 text-xs font-medium ${
              !showHistory ? 'bg-emerald-500/15 text-emerald-400 shadow' : 'text-white/40'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className={`flex flex-1 items-center justify-center rounded-lg py-2 text-xs font-medium ${
              showHistory ? 'bg-emerald-500/15 text-emerald-400 shadow' : 'text-white/40'
            }`}
          >
            History
          </button>
        </div>

        <div className="mt-5 space-y-6">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-white/40">
              Loading images...
            </div>
          ) : displayRecords.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-white/40">
              {showHistory ? 'No previous shift images found.' : 'No shift images for today.'}
            </div>
          ) : (
            displayRecords.map(renderImageGrid)
          )}
        </div>
      </motion.div>
      {lightboxImages && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          onClose={closeLightbox}
        />
      )}
    </motion.div>
  )
}

// ─── End Shift Images Modal ─────────────────────────────────────────────

interface EndShiftImageRecord {
  id: string
  shiftDate: string
  location: ScannerLocation
  endedBy: string
  photos: ShiftEndVerificationPhotos
}

const END_PHOTO_LABELS: Array<{ key: keyof ShiftEndVerificationPhotos; label: string }> = [
  { key: 'selfie', label: 'Employee Selfie' },
  { key: 'track_north', label: 'Track — North' },
  { key: 'track_south', label: 'Track — South' },
  { key: 'track_east', label: 'Track — East' },
  { key: 'track_west', label: 'Track — West' },
]

const EndShiftImagesModal = ({
  location,
  onClose,
}: {
  location: ScannerLocation
  onClose: () => void
}) => {
  const [records, setRecords] = useState<EndShiftImageRecord[]>([])
  const {
    lightboxImages: endLbImages,
    lightboxIndex: endLbIndex,
    openLightbox: openEndLb,
    closeLightbox: closeEndLb,
  } = useLightbox()
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    const db = initializeFirestore()
    if (!db) {
      setLoading(false)
      return
    }

    const locationDocId = SCANNER_LOCATION_DOC_IDS[location]
    const shiftDocRef = doc(db, 'shifts', locationDocId)

    const fetchAll = async () => {
      const items: EndShiftImageRecord[] = []

      const currentSnap = await getDoc(shiftDocRef)
      if (currentSnap.exists()) {
        const data = currentSnap.data()
        if (data.endVerificationPhotos?.selfie) {
          items.push({
            id: currentSnap.id,
            shiftDate: String(data.shiftDate ?? ''),
            location: data.location as ScannerLocation,
            endedBy: String(data.endedBy ?? ''),
            photos: data.endVerificationPhotos as ShiftEndVerificationPhotos,
          })
        }
      }

      const historySnap = await getDocs(
        query(collection(db, 'shifts', locationDocId, 'history'), orderBy('shiftDate', 'desc')),
      )

      for (const histDoc of historySnap.docs) {
        const data = histDoc.data()
        if (data.endVerificationPhotos?.selfie) {
          items.push({
            id: histDoc.id,
            shiftDate: String(data.shiftDate ?? ''),
            location: (data.location as ScannerLocation) ?? location,
            endedBy: String(data.endedBy ?? ''),
            photos: data.endVerificationPhotos as ShiftEndVerificationPhotos,
          })
        }
      }

      const seen = new Set<string>()
      const deduplicated = items.filter((item) => {
        if (seen.has(item.shiftDate)) return false
        seen.add(item.shiftDate)
        return true
      })

      deduplicated.sort((a, b) => b.shiftDate.localeCompare(a.shiftDate))
      setRecords(deduplicated)
      setLoading(false)
    }

    void fetchAll().catch(() => setLoading(false))
  }, [location])

  const today = todayIST()
  const todayRecords = records.filter((r) => r.shiftDate === today)
  const historyRecords = records.filter((r) => r.shiftDate !== today)
  const displayRecords = showHistory ? historyRecords : todayRecords

  const renderImageGrid = (rec: EndShiftImageRecord) => (
    <div key={rec.id} className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-white/80">
          {rec.shiftDate === today ? 'Today' : formatDate(rec.shiftDate)}
        </p>
        {rec.shiftDate === today ? (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            Current
          </span>
        ) : null}
        <span className="text-xs text-white/35">by {rec.endedBy}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {END_PHOTO_LABELS.map(({ key, label }) => {
          const allUrls = END_PHOTO_LABELS.map((p) => rec.photos[p.key]).filter(Boolean) as string[]
          const idx = allUrls.indexOf(rec.photos[key] as string)
          return (
            <div key={key} className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-white/30">{label}</p>
              {rec.photos[key] ? (
                <img
                  src={rec.photos[key]}
                  alt={label}
                  className="aspect-square w-full cursor-pointer rounded-lg border border-white/10 object-cover transition-opacity hover:opacity-80"
                  onClick={() => openEndLb(allUrls, Math.max(0, idx))}
                />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-white/20">
                  N/A
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-700 bg-track-panel p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-400/70">
              End Shift Images
            </p>
            <p className="mt-1 text-sm text-white/60">{location}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-700 px-3 py-1.5 text-xs text-white/60"
          >
            Close
          </button>
        </div>

        <div className="mt-4 flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          <button
            type="button"
            onClick={() => setShowHistory(false)}
            className={`flex flex-1 items-center justify-center rounded-lg py-2 text-xs font-medium ${
              !showHistory ? 'bg-red-500/15 text-red-400 shadow' : 'text-white/40'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className={`flex flex-1 items-center justify-center rounded-lg py-2 text-xs font-medium ${
              showHistory ? 'bg-red-500/15 text-red-400 shadow' : 'text-white/40'
            }`}
          >
            History
          </button>
        </div>

        <div className="mt-5 space-y-6">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-white/40">
              Loading images...
            </div>
          ) : displayRecords.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-white/40">
              {showHistory
                ? 'No previous end shift images found.'
                : 'No end shift images for today.'}
            </div>
          ) : (
            displayRecords.map(renderImageGrid)
          )}
        </div>
      </motion.div>
      {endLbImages && (
        <ImageLightbox images={endLbImages} initialIndex={endLbIndex} onClose={closeEndLb} />
      )}
    </motion.div>
  )
}

// ─── Shift Team Dialog ──────────────────────────────────────────────────

const ShiftTeamDialog = ({
  open,
  participants,
  onClose,
}: {
  open: boolean
  participants: ShiftParticipant[]
  onClose: () => void
}) => {
  if (!open) return null

  const sorted = [...participants].sort(
    (a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime(),
  )

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-gray-700 bg-track-panel p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400/70">
                  Today&apos;s Shift Team
                </p>
                <p className="mt-1 text-sm text-white/45">
                  {sorted.length} member{sorted.length !== 1 ? 's' : ''} joined
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-gray-700 px-3 py-1.5 text-xs text-white/60 hover:border-white/30 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-4">
              {sorted.length === 0 ? (
                <p className="py-8 text-center text-sm text-white/35">
                  No team members joined yet.
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-gray-800">
                  {sorted.map((p) => (
                    <div key={p.userId} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{p.userName}</p>
                        <p className="text-xs text-white/40">{p.role}</p>
                      </div>
                      <span className="shrink-0 text-xs text-white/30">
                        {formatTime(p.joinedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

// ─── Shift Banner (Redesigned) ──────────────────────────────────────────

export const ShiftBanner = ({
  shift,
  onChangeLocation,
}: {
  shift: Shift
  onChangeLocation: () => void
}) => {
  const { session } = useAuth()
  const canChangeLocation = !isLocationRestrictedRole(session?.user.role ?? 'TrackMarshall')
  const [now, setNow] = useState(() => Date.now())
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teamDialogOpen, setTeamDialogOpen] = useState(false)
  const [imagesModalOpen, setImagesModalOpen] = useState(false)
  const [endImagesModalOpen, setEndImagesModalOpen] = useState(false)
  const [endVerificationOpen, setEndVerificationOpen] = useState(false)
  const [deepCleanAssignment, setDeepCleanAssignment] = useState<DeepCleanAssignment | null>(null)

  const role = session?.user.role ?? ''
  const showImagesButton = isAdminOrOwner(role)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // Deep clean subscription
  useEffect(() => {
    const unsubscribe = subscribeDailyAssignment(shift.location, (a) => setDeepCleanAssignment(a))
    return () => unsubscribe()
  }, [shift.location])

  const deepCleanPending = deepCleanAssignment != null && !deepCleanAssignment.cleaned

  const endShiftDocument = async (payload: {
    endedBy?: string
    autoClosed?: boolean
    endVerificationPhotos?: ShiftEndVerificationPhotos
  }) => {
    const db = initializeFirestore()
    if (!db) throw new Error('Firestore not available. Please try again.')
    await updateDoc(doc(db, 'shifts', shift.id), {
      active: false,
      endedAt: serverTimestamp(),
      ...(payload.endedBy ? { endedBy: payload.endedBy } : {}),
      ...(payload.autoClosed ? { autoClosed: true } : {}),
      ...(payload.endVerificationPhotos
        ? { endVerificationPhotos: payload.endVerificationPhotos }
        : {}),
    })
  }

  // Auto-close yesterday's shift
  useEffect(() => {
    const today = todayIST()
    if (shift.shiftDate === today) return
    setEnding(true)
    setError(null)
    void endShiftDocument({ autoClosed: true })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Failed to close old shift.'),
      )
      .finally(() => setEnding(false))
  }, [shift.id, shift.shiftDate])

  const isAfterCutoff = useMemo(() => {
    const current = new Date(now)
    return current.getHours() > 23 || (current.getHours() === 23 && current.getMinutes() >= 30)
  }, [now])

  const canEndShift = isAfterCutoff && !deepCleanPending

  const handleOpenEndShift = () => {
    if (!canEndShift || ending) return
    setEndVerificationOpen(true)
  }

  const handleEndShiftWithPhotos = async (
    photos: ShiftEndVerificationPhotos,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    setEnding(true)
    setError(null)
    try {
      await endShiftDocument({
        endedBy: session?.user.name?.trim() || 'Track Staff',
        endVerificationPhotos: photos,
      })

      // Bridge: end all active TrackMarshall ShiftRecords at this location for today
      try {
        const db = initializeFirestore()
        if (db) {
          const locId = normalizeLocationId(shift.location)
          const today = todayIST()
          const endTimeIso = new Date().toISOString()

          const activeQuery = query(
            collection(db, 'shifts'),
            where('role', '==', 'TrackMarshall'),
            where('locationId', '==', locId),
            where('shiftDate', '==', today),
          )
          const activeSnap = await getDocs(activeQuery)

          for (const shiftDoc of activeSnap.docs) {
            const data = shiftDoc.data()
            if (data.endTime) continue // already ended
            const startMs = new Date(String(data.startTime ?? '')).getTime()
            const endMs = new Date(endTimeIso).getTime()
            const totalActiveHours =
              startMs && endMs > startMs
                ? Math.round(((endMs - startMs) / 3_600_000) * 100) / 100
                : 0
            await updateDoc(doc(db, 'shifts', shiftDoc.id), {
              endTime: endTimeIso,
              totalActiveHours,
              updatedAt: endTimeIso,
            })
          }
        }
      } catch (bridgeErr) {
        logger.warn('shift_banner.end_shift_records_failed', { error: bridgeErr })
      }

      return { ok: true }
    } catch (reason) {
      const msg = reason instanceof Error ? reason.message : 'Failed to end shift.'
      setError(msg)
      setEnding(false)
      return { ok: false, error: msg }
    }
  }

  const participantCount = shift.participants?.length ?? 0
  const elapsed = calcElapsed(shift.startedAt, now)

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-track-surface"
      >
        {/* Top bar: status + location */}
        <div className="flex items-center justify-between border-b border-gray-200/60 px-4 py-2.5 dark:border-gray-700/60">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Shift Active
            </p>
          </div>
          <span className="text-xs text-gray-400 dark:text-white/30">{elapsed}</span>
        </div>

        {/* Main content */}
        <div className="px-4 py-3">
          {/* Location + info grid */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{shift.location}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-white/50">
                <span>Started at {formatTime(shift.startedAt)}</span>
                <span>by {shift.startedBy}</span>
              </div>
            </div>

            {canChangeLocation ? (
              <button
                type="button"
                onClick={onChangeLocation}
                className="shrink-0 rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-white/60 dark:hover:border-white/25 dark:hover:text-white"
              >
                Change
              </button>
            ) : null}
          </div>

          {/* Action buttons row */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTeamDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-white/5 dark:text-white/70 dark:hover:border-white/25 dark:hover:text-white"
            >
              Shift Team
              {participantCount > 0 ? (
                <span className="inline-flex size-4 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-400">
                  {participantCount}
                </span>
              ) : null}
            </button>

            {showImagesButton ? (
              <>
                <button
                  type="button"
                  onClick={() => setImagesModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-white/5 dark:text-white/70 dark:hover:border-white/25 dark:hover:text-white"
                >
                  Start Shift Images
                </button>
                <button
                  type="button"
                  onClick={() => setEndImagesModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-white/5 dark:text-white/70 dark:hover:border-white/25 dark:hover:text-white"
                >
                  End Shift Images
                </button>
              </>
            ) : null}

            <div className="flex-1" />

            <button
              type="button"
              onClick={handleOpenEndShift}
              disabled={!canEndShift || ending}
              title={
                canEndShift
                  ? 'End shift'
                  : deepCleanPending
                    ? "Complete today's deep clean before ending shift."
                    : 'End shift is only activated after 11:30 PM.'
              }
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-5 py-2.5 text-sm font-medium text-red-400 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {ending ? 'Ending...' : 'End Shift'}
            </button>
          </div>
        </div>

        {/* Deep clean warning bar */}
        {deepCleanPending ? (
          <div className="flex items-center gap-2 border-t border-amber-500/20 bg-amber-500/5 px-4 py-2">
            <span className="text-sm">🧹</span>
            <p className="text-xs text-amber-400">
              Kart {deepCleanAssignment!.kartNumber} needs deep cleaning today
              {isAfterCutoff ? ' — complete to enable End Shift' : ''}
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="border-t border-red-500/20 bg-red-500/5 px-4 py-2">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        ) : null}
      </motion.div>

      <ShiftTeamDialog
        open={teamDialogOpen}
        participants={shift.participants ?? []}
        onClose={() => setTeamDialogOpen(false)}
      />

      <AnimatePresence>
        {imagesModalOpen ? (
          <ShiftImagesModal location={shift.location} onClose={() => setImagesModalOpen(false)} />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {endImagesModalOpen ? (
          <EndShiftImagesModal
            location={shift.location}
            onClose={() => setEndImagesModalOpen(false)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {endVerificationOpen && session?.user.id ? (
          <ShiftEndVerification
            location={shift.location}
            userId={session.user.id}
            onEndShift={handleEndShiftWithPhotos}
            onCancel={() => setEndVerificationOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </>
  )
}

// ─── No Shift Prompt ────────────────────────────────────────────────────

export const NoShiftPrompt = ({
  location,
  onStart,
  onChangeLocation,
  loading,
}: {
  location: ScannerLocation
  onStart: () => void
  onChangeLocation: () => void
  loading?: boolean
}) => {
  const { session } = useAuth()
  const canChangeLocation = !isLocationRestrictedRole(session?.user.role ?? 'TrackMarshall')
  const roleAllowed = canStartShift(session?.user.role ?? '')

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-gray-200 bg-gray-50 px-6 py-12 text-center dark:border-gray-700 dark:bg-track-surface/80"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-400 dark:text-white/40">
          No Active Shift
        </p>
        <h3 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">{location}</h3>
        <p className="mt-2 text-sm text-gray-500 dark:text-white/50">
          Start the day&apos;s shift for this location to enable QR scanning and manual billing
          lookup.
        </p>
      </div>

      {!roleAllowed ? (
        <p className="text-sm text-red-400">
          Only Owner, Admin, or Track Marshall can start the shift.
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        {roleAllowed ? (
          <button
            type="button"
            onClick={onStart}
            disabled={loading}
            className="ui-btn ui-btn-primary min-w-36"
          >
            {loading ? 'Starting...' : 'Start Shift'}
          </button>
        ) : null}
        {canChangeLocation ? (
          <button
            type="button"
            onClick={onChangeLocation}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-white/60 dark:hover:border-white/25 dark:hover:text-white"
          >
            Change Location
          </button>
        ) : null}
      </div>
    </motion.div>
  )
}
