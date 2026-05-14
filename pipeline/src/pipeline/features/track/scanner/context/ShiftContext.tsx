/* eslint-disable react-refresh/only-export-components -- idiomatic context: provider + useShift hook co-located */
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useAuth } from '../../../auth/auth-context'
import { initializeFirestore } from '../../../../lib/firebase'
import {
  resolveLocation,
  normalizeLocationId,
  getLocationDisplayName,
} from '../../../../../lib/locations'
import {
  SCANNER_LOCATION_DOC_IDS,
  SCANNER_LOCATIONS,
  ScannerLocation,
  Shift,
  ShiftEndVerificationPhotos,
  ShiftParticipant,
  ShiftVerificationPhotos,
} from '../types/scanner.types'
import { logger } from '../../../../../lib/logger'

const LOCATION_KEY = 'scanner-location'
const SHIFTS_COLLECTION = 'shifts'
const ALLOWED_SHIFT_START_ROLES = new Set(['owner', 'admin', 'track_marshall', 'trackmarshall'])

const isTrackMarshallRole = (role: string): boolean =>
  ['track_marshall', 'trackmarshall'].includes(normalizeRole(role))

const normalizeRole = (role: string): string =>
  String(role ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

const canStartShift = (role: string): boolean => ALLOWED_SHIFT_START_ROLES.has(normalizeRole(role))

interface ShiftContextValue {
  selectedLocation: ScannerLocation | null
  selectLocation: (location: ScannerLocation) => void
  clearLocation: () => void
  shift: Shift | null
  loading: boolean
  error: string | null
  needsVerification: boolean
  /** True when the current user has explicitly joined today's shift (clicked Start/Join). */
  hasJoinedShift: boolean
  startShift: (
    verificationPhotos?: ShiftVerificationPhotos | null,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  refreshShift: () => Promise<void>
}

type RawParticipant = {
  userId?: string
  userName?: string
  role?: string
  joinedAt?: Timestamp | string | null
}

type ShiftDocument = {
  location?: string
  startedBy?: string
  startedByUid?: string
  startedAt?: Timestamp | null
  shiftDate?: string
  active?: boolean
  endedAt?: Timestamp | null
  endedBy?: string
  autoClosed?: boolean
  verificationPhotos?: Partial<ShiftVerificationPhotos>
  endVerificationPhotos?: Partial<ShiftEndVerificationPhotos>
  participants?: RawParticipant[]
}

const ShiftContext = createContext<ShiftContextValue | null>(null)

/** Resolve any location variant to its canonical display name (ScannerLocation). */
const toScannerLocation = (value: string): ScannerLocation | null => {
  if (SCANNER_LOCATIONS.includes(value)) return value
  const resolved = resolveLocation(value)
  if (resolved && SCANNER_LOCATIONS.includes(resolved.displayName)) {
    logger.debug('shift_context.location_resolved', { value, displayName: resolved.displayName })
    return resolved.displayName
  }
  logger.warn('shift_context.location_unresolved', { value })
  return null
}

const loadStoredLocation = (): ScannerLocation | null => {
  try {
    const raw = localStorage.getItem(LOCATION_KEY)
    if (!raw) return null
    // Resolve any variant (slug, shortName, etc.) to the canonical display name
    const canonical = toScannerLocation(raw)
    if (canonical && canonical !== raw) {
      localStorage.setItem(LOCATION_KEY, canonical)
    }
    return canonical
  } catch {
    return null
  }
}

const persistLocation = (location: ScannerLocation | null) => {
  if (!location) {
    localStorage.removeItem(LOCATION_KEY)
    return
  }
  localStorage.setItem(LOCATION_KEY, location)
}

const toShiftDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const todayShiftDate = (): string => toShiftDate(new Date())

const toIsoString = (value?: Timestamp | null): string | undefined => {
  if (!value) return undefined
  return value.toDate().toISOString()
}

const normalizeParticipant = (p: RawParticipant): ShiftParticipant => ({
  userId: String(p.userId ?? ''),
  userName: String(p.userName ?? 'Unknown'),
  role: String(p.role ?? 'staff'),
  joinedAt:
    p.joinedAt instanceof Timestamp
      ? p.joinedAt.toDate().toISOString()
      : typeof p.joinedAt === 'string'
        ? p.joinedAt
        : new Date().toISOString(),
})

const normalizeShift = (locationId: string, record: ShiftDocument): Shift | null => {
  const rawLocation = record.location
  if (!rawLocation) {
    logger.warn('shift_context.shift_doc_no_location', { locationId })
    return null
  }
  // Resolve any variant (slug, shortName, case mismatch) to canonical display name
  const location = toScannerLocation(rawLocation)
  if (!location) {
    // Safe fallback: if we can't resolve but the shift is active, use the raw value
    // so the shift is still visible rather than silently hidden
    logger.warn('shift_context.shift_doc_unknown_location', { locationId, rawLocation })
  }
  const effectiveLocation = location ?? rawLocation
  logger.debug('shift_context.normalize_shift', {
    locationId,
    rawLocation,
    effectiveLocation,
    active: record.active,
    shiftDate: record.shiftDate,
  })

  return {
    id: locationId,
    location: effectiveLocation,
    startedBy: String(record.startedBy ?? 'Unknown'),
    startedByUid: String(record.startedByUid ?? ''),
    startedAt: toIsoString(record.startedAt) ?? new Date().toISOString(),
    shiftDate: String(record.shiftDate ?? ''),
    active: record.active === true,
    endedAt: toIsoString(record.endedAt),
    endedBy: record.endedBy ? String(record.endedBy) : undefined,
    autoClosed: record.autoClosed === true,
    verificationPhotos:
      record.verificationPhotos?.selfie &&
      record.verificationPhotos.track &&
      record.verificationPhotos.kart
        ? {
            selfie: String(record.verificationPhotos.selfie),
            track: String(record.verificationPhotos.track),
            kart: String(record.verificationPhotos.kart),
          }
        : undefined,
    endVerificationPhotos:
      record.endVerificationPhotos?.selfie &&
      record.endVerificationPhotos.track_north &&
      record.endVerificationPhotos.track_south &&
      record.endVerificationPhotos.track_east &&
      record.endVerificationPhotos.track_west
        ? {
            selfie: String(record.endVerificationPhotos.selfie),
            track_north: String(record.endVerificationPhotos.track_north),
            track_south: String(record.endVerificationPhotos.track_south),
            track_east: String(record.endVerificationPhotos.track_east),
            track_west: String(record.endVerificationPhotos.track_west),
          }
        : undefined,
    participants: ensureStarterInParticipants(
      (record.participants ?? []).filter((p) => p.userId).map(normalizeParticipant),
      String(record.startedByUid ?? ''),
      String(record.startedBy ?? 'Unknown'),
      toIsoString(record.startedAt),
    ),
  }
}

/** Guarantees the shift starter appears first in the participants list. */
const ensureStarterInParticipants = (
  participants: ShiftParticipant[],
  starterUid: string,
  starterName: string,
  startedAt?: string,
): ShiftParticipant[] => {
  if (!starterUid) return participants
  if (participants.some((p) => p.userId === starterUid)) return participants
  return [
    {
      userId: starterUid,
      userName: starterName,
      role: 'staff',
      joinedAt: startedAt ?? new Date().toISOString(),
    },
    ...participants,
  ]
}

const docHasTodayPhotos = (data: ShiftDocument | null): boolean => {
  if (!data || data.shiftDate !== todayShiftDate()) return false
  const vp = data.verificationPhotos
  return Boolean(vp?.selfie && vp?.track && vp?.kart)
}

const getShiftDocRef = (location: ScannerLocation) => {
  const db = initializeFirestore()
  if (!db) return null
  return doc(db, 'shifts', SCANNER_LOCATION_DOC_IDS[location])
}

const autoCloseIfExpired = async (
  location: ScannerLocation,
  shift: Shift | null,
): Promise<Shift | null> => {
  if (!shift || !shift.active || shift.shiftDate === todayShiftDate()) return shift

  const shiftRef = getShiftDocRef(location)
  if (!shiftRef) return null

  await updateDoc(shiftRef, {
    active: false,
    endedAt: serverTimestamp(),
    autoClosed: true,
  })

  return null
}

export const ShiftProvider = ({ children }: { children: ReactNode }) => {
  const { session } = useAuth()
  const [selectedLocation, setSelectedLocation] = useState<ScannerLocation | null>(() =>
    loadStoredLocation(),
  )
  const [shift, setShift] = useState<Shift | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [todayHasPhotos, setTodayHasPhotos] = useState(false)
  const [hasJoinedShift, setHasJoinedShift] = useState(false)

  const currentUserId = session?.user.id?.trim() ?? ''
  const unsubRef = useRef<(() => void) | null>(null)

  const selectLocation = useCallback((location: ScannerLocation) => {
    persistLocation(location)
    setSelectedLocation(location)
  }, [])

  const clearLocation = useCallback(() => {
    if (unsubRef.current) {
      unsubRef.current()
      unsubRef.current = null
    }
    persistLocation(null)
    setSelectedLocation(null)
    setShift(null)
    setTodayHasPhotos(false)
    setHasJoinedShift(false)
    setError(null)
  }, [])

  /** Check participants array to see if current user already joined. */
  const checkIfJoined = useCallback(
    (rawData: ShiftDocument | null) => {
      if (!currentUserId || !rawData?.active || rawData.shiftDate !== todayShiftDate()) {
        setHasJoinedShift(false)
        return
      }
      const joined = (rawData.participants ?? []).some(
        (p) => String(p.userId ?? '') === currentUserId,
      )
      setHasJoinedShift(joined)
    },
    [currentUserId],
  )

  const refreshShift = useCallback(async () => {
    if (!selectedLocation) {
      setShift(null)
      setTodayHasPhotos(false)
      setHasJoinedShift(false)
      setLoading(false)
      return
    }

    const shiftRef = getShiftDocRef(selectedLocation)
    if (!shiftRef) {
      setError('Firestore not available. Please try again.')
      setShift(null)
      setTodayHasPhotos(false)
      setHasJoinedShift(false)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const snapshot = await getDoc(shiftRef)
      const rawData = snapshot.exists() ? (snapshot.data() as ShiftDocument) : null
      setTodayHasPhotos(docHasTodayPhotos(rawData))
      checkIfJoined(rawData)

      const nextShift = rawData ? normalizeShift(snapshot.id, rawData) : null
      const activeShift = await autoCloseIfExpired(selectedLocation, nextShift)
      setShift(activeShift?.active ? activeShift : null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load shift.')
      setShift(null)
    } finally {
      setLoading(false)
    }
  }, [checkIfJoined, selectedLocation])

  useEffect(() => {
    const syncLocation = (event: StorageEvent) => {
      if (event.key !== LOCATION_KEY) return
      const nextLocation = loadStoredLocation()
      setSelectedLocation((currentLocation) =>
        currentLocation === nextLocation ? currentLocation : nextLocation,
      )
    }

    window.addEventListener('storage', syncLocation)
    return () => window.removeEventListener('storage', syncLocation)
  }, [])

  useEffect(() => {
    if (!selectedLocation) {
      setShift(null)
      setTodayHasPhotos(false)
      setHasJoinedShift(false)
      setLoading(false)
      setError(null)
      return
    }

    const shiftRef = getShiftDocRef(selectedLocation)
    if (!shiftRef) {
      setError('Firestore not available. Please try again.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    logger.debug('shift_context.snapshot_subscribe', {
      docId: SCANNER_LOCATION_DOC_IDS[selectedLocation],
      location: selectedLocation,
    })

    const unsubscribe = onSnapshot(
      shiftRef,
      (snapshot) => {
        const exists = snapshot.exists()
        const rawData = exists ? (snapshot.data() as ShiftDocument) : null
        logger.debug('shift_context.snapshot_fired', {
          exists,
          location: rawData?.location,
          active: rawData?.active,
          shiftDate: rawData?.shiftDate,
          today: todayShiftDate(),
        })

        setTodayHasPhotos(docHasTodayPhotos(rawData))
        checkIfJoined(rawData)

        const nextShift = rawData ? normalizeShift(snapshot.id, rawData) : null
        if (!nextShift) {
          logger.debug('shift_context.snapshot_no_valid_shift')
          setShift(null)
          setLoading(false)
          return
        }

        if (nextShift.active && nextShift.shiftDate !== todayShiftDate()) {
          void autoCloseIfExpired(selectedLocation, nextShift)
            .catch((reason) => {
              setError(reason instanceof Error ? reason.message : 'Failed to close old shift.')
            })
            .finally(() => {
              setShift(null)
              setHasJoinedShift(false)
              setLoading(false)
            })
          return
        }

        setShift(nextShift.active ? nextShift : null)
        setLoading(false)
      },
      (reason) => {
        setError(reason.message || 'Failed to watch shift.')
        setShift(null)
        setLoading(false)
      },
    )
    unsubRef.current = unsubscribe

    return () => {
      unsubscribe()
      unsubRef.current = null
    }
  }, [checkIfJoined, selectedLocation])

  const startShift = useCallback(
    async (verificationPhotos?: ShiftVerificationPhotos | null) => {
      if (!selectedLocation) {
        return { ok: false as const, error: 'Select a location first.' }
      }

      const shiftRef = getShiftDocRef(selectedLocation)
      if (!shiftRef) {
        return { ok: false as const, error: 'Firestore not available. Please try again.' }
      }

      const userName = session?.user.name?.trim() || 'Track Staff'
      const userId = session?.user.id?.trim()
      if (!userId) {
        return { ok: false as const, error: 'User session is missing.' }
      }

      const userRole = session?.user.role ?? 'staff'
      if (!canStartShift(userRole)) {
        return {
          ok: false as const,
          error: 'Only Owner, Admin, or Track Marshall can start the shift.',
        }
      }

      setError(null)
      setLoading(true)

      const participantEntry: RawParticipant = {
        userId,
        userName,
        role: userRole,
        joinedAt: new Date().toISOString(),
      }

      try {
        await runTransaction(shiftRef.firestore, async (transaction) => {
          const snapshot = await transaction.get(shiftRef)
          const existing = snapshot.exists() ? (snapshot.data() as ShiftDocument) : null

          const isActiveToday =
            existing?.active === true && existing?.shiftDate === todayShiftDate()
          const hasPhotosToday = docHasTodayPhotos(existing)

          if (isActiveToday) {
            // Shift already active — add current user to participants (skip if already joined)
            const participants: RawParticipant[] = [...(existing?.participants ?? [])]

            // Backfill: if the shift starter is not in the participants array
            // (e.g. shift was created before participants tracking existed), add them.
            const starterUid = String(existing?.startedByUid ?? '')
            if (starterUid && !participants.some((p) => String(p.userId ?? '') === starterUid)) {
              participants.unshift({
                userId: starterUid,
                userName: existing?.startedBy ?? 'Unknown',
                role: 'staff',
                joinedAt:
                  existing?.startedAt instanceof Timestamp
                    ? existing.startedAt.toDate().toISOString()
                    : new Date().toISOString(),
              })
            }

            const alreadyJoined = participants.some((p) => String(p.userId ?? '') === userId)
            if (!alreadyJoined) {
              transaction.update(shiftRef, {
                participants: [...participants, participantEntry],
              })
            } else if (participants.length !== (existing?.participants ?? []).length) {
              // Starter was backfilled but current user already present — still write the backfill
              transaction.update(shiftRef, { participants })
            }
            return
          }

          // Archive previous day's shift data to history subcollection before overwriting
          const previousDate = existing?.shiftDate
          const hasPreviousPhotos =
            existing?.verificationPhotos?.selfie ||
            existing?.verificationPhotos?.track ||
            existing?.verificationPhotos?.kart

          if (previousDate && previousDate !== todayShiftDate() && hasPreviousPhotos) {
            const historyRef = doc(
              collection(shiftRef.firestore, 'shifts', snapshot.id, 'history'),
              previousDate,
            )
            transaction.set(historyRef, {
              shiftDate: previousDate,
              location: existing?.location ?? selectedLocation,
              startedBy: existing?.startedBy ?? 'Unknown',
              startedByUid: existing?.startedByUid ?? '',
              startedAt: existing?.startedAt ?? null,
              endedAt: existing?.endedAt ?? null,
              endedBy: existing?.endedBy ?? null,
              autoClosed: existing?.autoClosed ?? false,
              verificationPhotos: existing?.verificationPhotos ?? null,
              endVerificationPhotos: existing?.endVerificationPhotos ?? null,
              participants: existing?.participants ?? [],
              archivedAt: serverTimestamp(),
            })
          }

          // Standardized location fields for cross-system consistency
          const locId = normalizeLocationId(selectedLocation)
          const locName = getLocationDisplayName(locId)

          if (hasPhotosToday) {
            // Shift ended but photos exist — restart without new photos
            transaction.set(
              shiftRef,
              {
                location: selectedLocation,
                locationId: locId,
                locationName: locName,
                startedBy: userName,
                startedByUid: userId,
                startedAt: serverTimestamp(),
                shiftDate: todayShiftDate(),
                active: true,
                endedAt: null,
                autoClosed: false,
                participants: [participantEntry],
              },
              { merge: true },
            )
            return
          }

          // First user of the day — photos required
          if (
            !verificationPhotos?.selfie ||
            !verificationPhotos?.track ||
            !verificationPhotos?.kart
          ) {
            throw new Error('Verification photos are required to start the first shift of the day.')
          }

          transaction.set(
            shiftRef,
            {
              location: selectedLocation,
              locationId: locId,
              locationName: locName,
              startedBy: userName,
              startedByUid: userId,
              startedAt: serverTimestamp(),
              shiftDate: todayShiftDate(),
              active: true,
              endedAt: null,
              autoClosed: false,
              verificationPhotos,
              participants: [participantEntry],
            },
            { merge: true },
          )
        })

        // Bridge: create a ShiftRecord for Track Marshalls so Owner/Admin see it in the Shifts module
        if (isTrackMarshallRole(userRole)) {
          try {
            const db = initializeFirestore()
            if (db) {
              const locId = normalizeLocationId(selectedLocation)
              const locName = getLocationDisplayName(locId)
              const todayDate = todayShiftDate()
              const startTimeIso = new Date().toISOString()

              // Check if user already has an active shift record for today to avoid duplicates
              const existingQuery = query(
                collection(db, SHIFTS_COLLECTION),
                where('userId', '==', userId),
                where('shiftDate', '==', todayDate),
                where('role', '==', 'TrackMarshall'),
              )
              const existingSnap = await getDocs(existingQuery)
              const hasActiveRecord = existingSnap.docs.some((d) => !d.data().endTime)

              if (!hasActiveRecord) {
                await addDoc(collection(db, SHIFTS_COLLECTION), {
                  userId,
                  role: 'TrackMarshall',
                  locationId: locId,
                  locationName: locName,
                  shiftDate: todayDate,
                  startTime: startTimeIso,
                  breaks: [],
                  createdAt: startTimeIso,
                  updatedAt: startTimeIso,
                })
              }
            }
          } catch (bridgeErr) {
            // Non-critical: log but don't block the scanner shift
            logger.warn('shift_context.create_shift_record_failed', { error: bridgeErr })
          }
        }

        setHasJoinedShift(true)
        return { ok: true as const }
      } catch (reason) {
        setLoading(false)
        return {
          ok: false as const,
          error: reason instanceof Error ? reason.message : 'Failed to start shift.',
        }
      }
    },
    [selectedLocation, session?.user.id, session?.user.name, session?.user.role],
  )

  const needsVerification = !todayHasPhotos

  const value = useMemo<ShiftContextValue>(
    () => ({
      selectedLocation,
      selectLocation,
      clearLocation,
      shift,
      loading,
      error,
      needsVerification,
      hasJoinedShift,
      startShift,
      refreshShift,
    }),
    [
      clearLocation,
      error,
      hasJoinedShift,
      loading,
      needsVerification,
      refreshShift,
      selectLocation,
      selectedLocation,
      shift,
      startShift,
    ],
  )

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
}

export const useShiftContext = (): ShiftContextValue => {
  const ctx = useContext(ShiftContext)
  if (!ctx) {
    throw new Error('useShiftContext must be used inside ShiftProvider')
  }
  return ctx
}
