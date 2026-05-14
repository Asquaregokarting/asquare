import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { ModulePageLayout } from '../../../components/layout/ModulePageLayout'
import { useAuth } from '../../../features/auth/auth-context'
import { useNativePermission } from '../../../hooks/useNativePermission'
import { initializeFirestore } from '../../../lib/firebase'
import {
  DeepCleanAssignment,
  getOrCreateDailyAssignment,
  subscribeDailyAssignment,
  subscribeKartsByLocation,
} from '../services/kartService'
import { Dashboard } from './Dashboard'
import { HistoryView } from './HistoryView'
import { ManualBillingInput } from './components/ManualBillingInput'
import { LocationSelect } from './components/LocationSelect'
import { NoShiftPrompt, ShiftBanner } from './components/ShiftBanner'
import { ShiftStartVerification } from './components/ShiftStartVerification'
import { ShiftProvider } from './context/ShiftContext'
import { QRScannerView } from './QRScannerView'
import { ScanDetails } from './ScanDetails'
import { useScannerApi } from './hooks/useScannerApi'
import { useShift } from './hooks/useShift'
import { ScanSerial, ShiftVerificationPhotos } from './types/scanner.types'

interface UserProfile {
  name: string
  role: string
}

type InitState = 'checking' | 'needs-setup' | 'ready'
type ScanView = 'dashboard' | 'scanner' | 'history'

const canStartShiftForRole = (role?: string): boolean => {
  const normalizedRole = String(role ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return ['owner', 'admin', 'developer', 'track_marshall', 'trackmarshall'].includes(normalizedRole)
}

const ProfileSetup = ({
  uid,
  onComplete,
}: {
  uid: string
  onComplete: (profile: UserProfile) => void
}) => {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!name.trim()) {
      return
    }

    setSaving(true)
    setError(null)

    const db = initializeFirestore()
    if (!db) {
      setError('Firestore not available. Please try again.')
      setSaving(false)
      return
    }

    try {
      const profile: UserProfile = { name: name.trim(), role: 'staff' }
      await setDoc(
        doc(db, 'users', uid),
        { ...profile, createdAt: serverTimestamp() },
        { merge: true },
      )
      onComplete(profile)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save profile.')
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex min-h-[50vh] flex-col items-center justify-center gap-6 px-2"
    >
      <div className="text-center">
        <h2 className="text-2xl font-bold text-text">Setup Staff Profile</h2>
        <p className="mt-1 text-sm text-muted">Add your display name before using the scanner.</p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        <input
          type="text"
          placeholder="Your full name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="ui-field w-full"
        />

        {error ? (
          <p className="rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!name.trim() || saving}
          onClick={() => void handleSubmit()}
          className="ui-btn ui-btn-primary mt-2 w-full"
        >
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </motion.div>
  )
}

// ─── Deep Clean Notification Popup ──────────────────────────────────────
const DeepCleanPopup = ({
  assignment,
  onDismiss,
}: {
  assignment: DeepCleanAssignment
  onDismiss: () => void
}) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.95, y: -10 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.95, y: -10 }}
    className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
  >
    <div className="w-full max-w-sm rounded-2xl border border-amber-500/30 bg-white p-5 shadow-2xl dark:bg-track-panel">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
          <span className="text-lg">🧹</span>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/80">
            Deep Clean Required
          </p>
          <h3 className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
            Kart {assignment.kartNumber}
          </h3>
        </div>
      </div>
      <p className="mt-3 text-sm text-gray-600 dark:text-white/60">
        This kart is assigned for deep cleaning today. Please complete the deep clean and upload
        proof images from the Karts module.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-4 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-track-surface/80 dark:text-white/70 dark:hover:border-white/20 dark:hover:text-white"
      >
        Got it
      </button>
    </div>
  </motion.div>
)

const ScannerApp = ({ staffName }: { staffName: string }) => {
  const { session } = useAuth()
  const {
    selectedLocation,
    selectLocation,
    clearLocation,
    shift,
    loading: shiftLoading,
    error: shiftError,
    needsVerification,
    hasJoinedShift,
    startShift,
  } = useShift()
  const { phase, result, errorMsg, fetchBill, submitVerification, reset } = useScannerApi()
  const { gate: cameraGate, ensurePermission: ensureCameraPermission } =
    useNativePermission('camera')
  const [view, setView] = useState<ScanView>('dashboard')
  const [showCameraScanner, setShowCameraScanner] = useState(false)
  const [showStartShiftVerification, setShowStartShiftVerification] = useState(false)
  const [startShiftError, setStartShiftError] = useState<string | null>(null)

  const normalizedRole = String(session?.user.role ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

  // Owner/Admin see pricing; Track Marshall and others do not
  const showPricing = ['owner', 'admin', 'developer'].includes(normalizedRole)

  // Owner/Admin/Developer bypass shift join — they can view all data directly
  const isAdminViewer = ['owner', 'admin', 'developer'].includes(normalizedRole)

  // ─── Deep clean notification state ────────────────────────────────
  const [deepCleanAssignment, setDeepCleanAssignment] = useState<DeepCleanAssignment | null>(null)
  const [deepCleanDismissed, setDeepCleanDismissed] = useState(false)

  // Subscribe to today's deep clean assignment (real-time)
  useEffect(() => {
    if (!selectedLocation || !shift) {
      setDeepCleanAssignment(null)
      setDeepCleanDismissed(false)
      return
    }

    // First ensure an assignment exists, then subscribe
    let cancelled = false

    const setup = async () => {
      try {
        // Load karts to create assignment if needed
        await new Promise<void>((resolve) => {
          const unsub = subscribeKartsByLocation(selectedLocation, (karts) => {
            unsub()
            if (!cancelled) {
              void getOrCreateDailyAssignment(selectedLocation, karts).catch(() => {})
            }
            resolve()
          })
        })
      } catch {
        // Ignore — assignment may already exist
      }
    }

    void setup()

    const unsubscribe = subscribeDailyAssignment(selectedLocation, (a) => {
      if (!cancelled) {
        setDeepCleanAssignment(a)
        // Auto-hide popup when cleaned becomes true
        if (a?.cleaned) {
          setDeepCleanDismissed(true)
        }
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [selectedLocation, shift])

  // Reset dismissed state when location changes
  useEffect(() => {
    setDeepCleanDismissed(false)
  }, [selectedLocation])

  const showDeepCleanPopup =
    deepCleanAssignment &&
    !deepCleanAssignment.cleaned &&
    !deepCleanDismissed &&
    (hasJoinedShift || isAdminViewer)

  const scannerSubnav: Array<{ id: ScanView; label: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'scanner', label: 'Scanner' },
    { id: 'history', label: 'History' },
  ]

  const shiftActive = Boolean(shift)
  const scannerUnlocked = shiftActive && (hasJoinedShift || isAdminViewer)

  useEffect(() => {
    if (!selectedLocation) {
      setShowCameraScanner(false)
      setView('dashboard')
      reset()
    }
  }, [reset, selectedLocation])

  // Auto-close the verification modal when another user starts the shift
  useEffect(() => {
    if (shift && showStartShiftVerification) {
      setShowStartShiftVerification(false)
      setStartShiftError(null)
    }
  }, [shift, showStartShiftVerification])

  const handleScanSuccess = useCallback(
    (raw: string) => {
      let billingId = raw.trim()

      // QR codes may contain a JSON payload — extract the id field
      if (billingId.startsWith('{')) {
        try {
          const parsed = JSON.parse(billingId) as { id?: string }
          if (parsed.id) {
            billingId = parsed.id
          }
        } catch {
          // not valid JSON — use raw value as-is
        }
      }

      if (!scannerUnlocked || !shift || !selectedLocation) {
        return
      }
      setShowCameraScanner(false)
      setView('scanner')
      void fetchBill(billingId, {
        scannedBy: staffName,
        location: selectedLocation,
        shiftStartedBy: shift.startedBy,
      })
    },
    [fetchBill, scannerUnlocked, shift, selectedLocation, staffName],
  )

  const canStartShift = canStartShiftForRole(session?.user.role)

  const handleOpenStartShift = useCallback(() => {
    if (!canStartShift) {
      setStartShiftError('Only Owner, Admin, or Track Marshall can start the shift.')
      return
    }

    if (needsVerification) {
      // First user of the day — show photo upload modal
      setStartShiftError(null)
      setShowStartShiftVerification(true)
      return
    }

    // Photos already exist for today — join/restart directly without modal
    setStartShiftError(null)
    void startShift(null).then((res) => {
      if (!res.ok) setStartShiftError(res.error)
    })
  }, [canStartShift, needsVerification, startShift])

  const handleJoinShift = useCallback(() => {
    setStartShiftError(null)
    void startShift(null).then((res) => {
      if (!res.ok) setStartShiftError(res.error)
    })
  }, [startShift])

  const joinOrStartPrompt =
    shiftActive && selectedLocation ? (
      // Owner/Admin bypass join — they already see data via scannerUnlocked
      isAdminViewer ? null : (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-12 text-center dark:border-signal-green-bright/20 dark:bg-signal-green-bright/10"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600 dark:text-signal-green-glow">
              Shift Active
            </p>
            <h3 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
              {selectedLocation}
            </h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-white/50">
              Join this shift to start scanning and validating bookings.
            </p>
          </div>
          {canStartShift ? (
            <button
              type="button"
              onClick={handleJoinShift}
              disabled={shiftLoading}
              className="ui-btn ui-btn-primary min-w-36"
            >
              {shiftLoading ? 'Joining...' : 'Join Shift'}
            </button>
          ) : (
            <p className="text-sm text-red-600 dark:text-red-300">
              Only Owner, Admin, or Track Marshall can join the shift.
            </p>
          )}
        </motion.div>
      )
    ) : selectedLocation ? (
      isAdminViewer ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-12 text-center dark:border-warning/20 dark:bg-warning/10"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-600 dark:text-warning">
              No Active Shift
            </p>
            <h3 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
              {selectedLocation}
            </h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-white/50">
              No one has started the shift yet for this location.
            </p>
          </div>
        </motion.div>
      ) : (
        <NoShiftPrompt
          location={selectedLocation}
          onStart={handleOpenStartShift}
          onChangeLocation={clearLocation}
          loading={shiftLoading}
        />
      )
    ) : null

  const handleStartShift = useCallback(
    async (photos: ShiftVerificationPhotos) => {
      const response = await startShift(photos)
      if (!response.ok) {
        setStartShiftError(response.error)
        return response
      }
      setStartShiftError(null)
      setShowStartShiftVerification(false)
      return response
    },
    [startShift],
  )

  const handleSubmit = useCallback(
    (selected: ScanSerial[]) => {
      if (!shift || !selectedLocation) return

      void submitVerification(selected, {
        scannedBy: staffName,
        location: selectedLocation,
        shiftStartedBy: shift.startedBy,
      })
    },
    [selectedLocation, shift, staffName, submitVerification],
  )

  if (!selectedLocation) {
    return <LocationSelect selectedLocation={selectedLocation} onSelect={selectLocation} />
  }

  return (
    <div className="flex flex-col gap-4">
      {shift ? <ShiftBanner shift={shift} onChangeLocation={clearLocation} /> : null}

      {!shift ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-track-surface/80">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500 dark:text-white/40">
                Selected Location
              </p>
              <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                {selectedLocation}
              </p>
            </div>
            <button
              type="button"
              onClick={clearLocation}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-white/65 dark:hover:border-white/20 dark:hover:text-white"
            >
              Change Location
            </button>
          </div>
        </div>
      ) : null}

      {shiftError ? (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {shiftError}
        </div>
      ) : null}

      {startShiftError ? (
        <div className="rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">
          {startShiftError}
        </div>
      ) : null}

      <div className="flex gap-1 rounded-xl border border-border bg-base p-1">
        {scannerSubnav.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setView(id)
              if (id === 'scanner' && phase !== 'result') {
                reset()
              }
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium ${
              view === id ? 'bg-accent/15 text-accent shadow' : 'text-muted'
            }`}
          >
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="min-h-[40vh]">
        <AnimatePresence mode="wait">
          {view === 'dashboard' ? (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
            >
              {scannerUnlocked ? (
                <Dashboard
                  location={selectedLocation}
                  shiftActive
                  onScanNow={() => {
                    setView('scanner')
                    reset()
                  }}
                  onViewHistory={() => {
                    setShowCameraScanner(false)
                    setView('history')
                  }}
                />
              ) : (
                joinOrStartPrompt
              )}
            </motion.div>
          ) : null}

          {view === 'scanner' ? (
            <motion.div
              key="scanner"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="flex flex-col gap-4"
            >
              {!scannerUnlocked ? (
                joinOrStartPrompt
              ) : (phase === 'result' || phase === 'updating' || phase === 'done') && result ? (
                <ScanDetails
                  result={result}
                  isUpdating={phase === 'updating'}
                  isSuccess={phase === 'done'}
                  showPricing={showPricing}
                  onSubmit={handleSubmit}
                  onReset={reset}
                />
              ) : (
                <>
                  <motion.button
                    type="button"
                    disabled={phase === 'loading'}
                    onClick={() => {
                      void ensureCameraPermission().then((granted) => {
                        if (granted) setShowCameraScanner(true)
                      })
                    }}
                    whileTap={{ scale: 0.97 }}
                    className="flex w-full flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center disabled:opacity-50 dark:border-gray-700 dark:bg-track-surface"
                  >
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">Scan QR Code</p>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-white/45">
                        Use device camera
                      </p>
                    </div>
                  </motion.button>

                  <ManualBillingInput
                    onSubmit={(billingId) => {
                      if (!shift || !selectedLocation) return
                      void fetchBill(billingId, {
                        scannedBy: staffName,
                        location: selectedLocation,
                        shiftStartedBy: shift.startedBy,
                      })
                    }}
                    loading={phase === 'loading'}
                  />

                  {phase === 'loading' ? (
                    <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-panel/50 py-4 text-sm text-muted">
                      <svg className="size-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
                      Looking up billing ID...
                    </div>
                  ) : null}

                  {phase === 'error' && errorMsg ? (
                    <div className="rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">
                      {errorMsg}
                    </div>
                  ) : null}
                </>
              )}
            </motion.div>
          ) : null}

          {view === 'history' ? (
            <motion.div
              key="history"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
            >
              {scannerUnlocked ? <HistoryView /> : joinOrStartPrompt}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {cameraGate}

      <AnimatePresence>
        {showCameraScanner && scannerUnlocked ? (
          <QRScannerView
            onScanSuccess={handleScanSuccess}
            onClose={() => setShowCameraScanner(false)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showStartShiftVerification && selectedLocation && session?.user.id ? (
          <ShiftStartVerification
            location={selectedLocation}
            userId={session.user.id}
            canStartShift={canStartShift}
            permissionMessage={
              canStartShift ? null : 'Only Owner, Admin, or Track Marshall can start the shift.'
            }
            onStartShift={handleStartShift}
            onCancel={() => setShowStartShiftVerification(false)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showDeepCleanPopup ? (
          <DeepCleanPopup
            assignment={deepCleanAssignment}
            onDismiss={() => setDeepCleanDismissed(true)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

const ScannerModuleInner = ({ embedded = false }: { embedded?: boolean }) => {
  const { session } = useAuth()
  const [initState, setInitState] = useState<InitState>('checking')
  const [staffProfile, setStaffProfile] = useState<UserProfile | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  useEffect(() => {
    if (!session?.user?.id) {
      return
    }

    let cancelled = false
    const uid = session.user.id
    const db = initializeFirestore()

    if (!db) {
      setStaffProfile({ name: session.user.name, role: 'staff' })
      setInitState('ready')
      return
    }

    void getDoc(doc(db, 'users', uid))
      .then((snapshot) => {
        if (cancelled) {
          return
        }

        if (snapshot.exists()) {
          const data = snapshot.data() as Partial<UserProfile>
          setStaffProfile({
            name: data.name?.trim() || session.user.name,
            role: data.role?.trim() || 'staff',
          })
          setInitState('ready')
          return
        }

        setInitState('needs-setup')
      })
      .catch((reason: Error) => {
        if (cancelled) {
          return
        }

        setCheckError(reason.message)
        setStaffProfile({ name: session.user.name, role: 'staff' })
        setInitState('ready')
      })

    return () => {
      cancelled = true
    }
  }, [session?.user.id, session?.user.name])

  if (!session) {
    return null
  }

  const subtitle = staffProfile ? `Staff: ${staffProfile.name}` : 'QR-based booking validation'

  const content = (
    <AnimatePresence mode="wait">
      {initState === 'checking' ? (
        <motion.div
          key="checking"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex flex-col items-center justify-center gap-4 py-24"
        >
          <svg className="size-8 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
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
          <p className="text-sm text-muted">Loading staff profile...</p>
        </motion.div>
      ) : null}

      {initState === 'needs-setup' ? (
        <motion.div
          key="setup"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <ProfileSetup
            uid={session.user.id}
            onComplete={(profile) => {
              setStaffProfile(profile)
              setInitState('ready')
            }}
          />
        </motion.div>
      ) : null}

      {initState === 'ready' && staffProfile ? (
        <motion.div
          key="app"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {checkError ? (
            <div className="mb-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-xs text-warning">
              Firestore unavailable: {checkError}. Working in offline mode.
            </div>
          ) : null}
          <ScannerApp staffName={staffProfile.name} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )

  if (embedded) {
    return content
  }

  return (
    <ModulePageLayout
      moduleTab="Track"
      title="Go-Kart Scanner"
      subtitle={subtitle}
      breadcrumbs={['Pipeline', 'Track', 'Scanner']}
    >
      {content}
    </ModulePageLayout>
  )
}

const ScannerModule = ({ embedded = false }: { embedded?: boolean }) => (
  <ShiftProvider>
    <ScannerModuleInner embedded={embedded} />
  </ShiftProvider>
)

export default ScannerModule
