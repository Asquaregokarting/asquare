import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
  addDoc,
  orderBy,
} from 'firebase/firestore'
import { initializeFirestore } from '../../../lib/firebase'
import { ensureFirebaseAuthForStorage } from '../../../lib/firebase-auth'
import { uploadPipelineFile } from '../../../lib/firebase-storage'
import { resolveLocation } from '../../../../lib/locations'
import {
  SCANNER_LOCATION_DOC_IDS,
  SCANNER_LOCATIONS,
  ScannerLocation,
} from '../scanner/types/scanner.types'

export type KartStatus = 'available' | 'under_repair'
export type KartCondition = 'good' | 'damaged'
export type KartEngineStatus = 'working' | 'engine_fail'
export type KartType = 'single' | 'double' | 'children'

// ─── Fixed kart-number-to-type mapping per location ────────────────────
const KART_TYPE_MAP: Record<string, KartType> = {
  // Vizag
  V1: 'single',
  V2: 'single',
  V3: 'single',
  V4: 'single',
  V5: 'single',
  V6: 'double',
  V7: 'double',
  V8: 'children',
  V9: 'children',
  // Kakinada
  K1: 'single',
  K2: 'single',
  K3: 'single',
  K4: 'single',
  K5: 'single',
  K6: 'single',
  K7: 'single',
  K8: 'single',
  K9: 'double',
  K10: 'children',
  K11: 'children',
  // Rajahmundry
  R1: 'single',
  R2: 'single',
  R3: 'single',
  R4: 'single',
  R5: 'single',
  R6: 'single',
  R7: 'single',
  R8: 'single',
  R9: 'double',
  R10: 'double',
  R11: 'children',
}

/** Returns the kart type for a given kart number, or null if invalid. */
export const getKartType = (kartNumber: string): KartType | null =>
  KART_TYPE_MAP[kartNumber.trim().toUpperCase()] ?? null

/** Returns all valid kart numbers for a location. */
export const getValidKartNumbers = (location: ScannerLocation): string[] => {
  const prefix = getLocationPrefix(location)
  return Object.keys(KART_TYPE_MAP).filter((k) => k.startsWith(prefix))
}

export interface KartRecord {
  id: string
  kartNumber: string
  kartType: KartType
  location: ScannerLocation
  status: KartStatus
  condition: KartCondition
  engineStatus: KartEngineStatus
  lastDeepCleanDate?: string
  complaint?: string
  createdBy?: string
  createdAt?: unknown
  updatedAt?: unknown
}

export interface KartDeepCleanLogRecord {
  id: string
  kartId: string
  kartNumber: string
  location: ScannerLocation
  cleanedBy: string
  cleanedByUid: string
  cleanedDate: string
  cleanedAt?: { toDate: () => Date } | null
  photoUrl: string
  photoUrls?: string[]
  videoUrl?: string
}

export type KartPhotoType = 'shift_start' | 'deep_clean'

export interface KartPhotoRecord {
  id: string
  kartId: string
  kartNumber: string
  location: ScannerLocation
  photoType: KartPhotoType
  photoUrl: string
  uploadedBy: string
  uploadedByUid: string
  createdAt?: { toDate: () => Date } | null
}

export interface SaveKartInput {
  id?: string
  kartNumber: string
  kartType: KartType
  location: ScannerLocation
  status: KartStatus
  condition: KartCondition
  engineStatus: KartEngineStatus
  complaint?: string
  userId: string
}

/** Kart-number prefix per location — derived from location short names. */
const LOCATION_PREFIX_MAP: Record<string, string> = Object.fromEntries(
  SCANNER_LOCATIONS.map((name) => {
    const loc = resolveLocation(name)
    return [name, loc?.shortName?.charAt(0).toUpperCase() ?? name.charAt(0).toUpperCase()]
  }),
)

/** Returns the expected kart number prefix for a location. */
export const getLocationPrefix = (location: ScannerLocation): string => {
  const direct = LOCATION_PREFIX_MAP[location]
  if (direct) return direct
  const resolved = resolveLocation(location)
  return resolved?.shortName?.charAt(0).toUpperCase() ?? location.charAt(0).toUpperCase()
}

/** Validates kart number format: location prefix + positive integer (e.g. V1, K12, R3). */
export const isValidKartNumberFormat = (kartNumber: string, location: ScannerLocation): boolean => {
  const prefix = getLocationPrefix(location)
  return new RegExp(`^${prefix}\\d+$`).test(kartNumber)
}

export interface KartDeepCleanInput {
  kart: KartRecord
  location: ScannerLocation
  cleanedBy: string
  cleanedByUid: string
  photos: File[]
}

export interface SaveKartPhotoInput {
  kartId: string
  kartNumber: string
  location: ScannerLocation
  photoType: KartPhotoType
  photoUrl: string
  uploadedBy: string
  uploadedByUid: string
}

export interface DeepCleanAssignment {
  id: string
  kartId: string
  kartNumber: string
  location: ScannerLocation
  assignedAt?: { toDate: () => Date } | null
  cleaned: boolean
  cleanedBy?: string
  cleanedAt?: { toDate: () => Date } | null
  images?: string[]
  videoUrl?: string
}

const KARTS_SUBCOLLECTION = 'karts'
const KART_DEEP_CLEAN_SUBCOLLECTION = 'kartDeepCleanLogs'
const KART_PHOTOS_SUBCOLLECTION = 'kartPhotos'
const DEEP_CLEAN_ASSIGNMENTS = 'deepCleanAssignments'
const STORAGE_KEY = 'scanner-location'

const normalizeRole = (role: string): string =>
  String(role ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

const toSafePathPart = (value: string, fallback: string): string => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || fallback
}

const getExtension = (file: File): string => {
  const byName = file.name.toLowerCase().match(/\.[a-z0-9]+$/)
  if (byName) {
    return byName[0]
  }
  if (file.type === 'image/png') {
    return '.png'
  }
  if (file.type === 'image/webp') {
    return '.webp'
  }
  return '.jpg'
}

const toDateString = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const mapLocation = (value: string | null): ScannerLocation | '' => {
  if (!value) return ''
  if (SCANNER_LOCATIONS.includes(value)) return value
  const resolved = resolveLocation(value)
  if (resolved && SCANNER_LOCATIONS.includes(resolved.displayName)) return resolved.displayName
  return ''
}

const getKartDocId = (location: ScannerLocation, kartNumber: string): string =>
  `${SCANNER_LOCATION_DOC_IDS[location]}-${toSafePathPart(kartNumber, 'kart')}`

export const loadSelectedKartLocation = (): ScannerLocation | '' =>
  mapLocation(localStorage.getItem(STORAGE_KEY))

export const persistSelectedKartLocation = (location: ScannerLocation): void => {
  localStorage.setItem(STORAGE_KEY, location)
}

export const isKartManagerRole = (role: string): boolean => {
  const normalized = normalizeRole(role)
  return ['owner', 'admin', 'developer'].includes(normalized)
}

export const canUpdateKartRole = (role: string): boolean => {
  const normalized = normalizeRole(role)
  return ['owner', 'admin', 'developer', 'track_marshall', 'trackmarshall'].includes(normalized)
}

export const canDeepCleanRole = (role: string): boolean => {
  const normalized = normalizeRole(role)
  return ['owner', 'admin', 'developer', 'track_marshall', 'trackmarshall'].includes(normalized)
}

/**
 * Returns the count of available karts for a given location identifier.
 * Resolves through SCANNER_LOCATION_DOC_IDS (display name → Firestore kart path)
 * because karts live at `locations/visakhapatnam/karts`, not `locations/0/karts`.
 */
export const getAvailableKartCountByLocation = async (
  locationIdOrSlug: string,
): Promise<number> => {
  const db = initializeFirestore()
  if (!db) return 0

  // Resolve input to a display name, then look up the kart document path
  const resolved = resolveLocation(locationIdOrSlug)
  const displayName = resolved?.displayName ?? locationIdOrSlug
  const docId =
    SCANNER_LOCATION_DOC_IDS[displayName] ?? resolved?.firestoreDocId ?? locationIdOrSlug

  try {
    const kartsSnap = await getDocs(collection(db, 'locations', docId, KARTS_SUBCOLLECTION))
    return kartsSnap.docs.filter((d) => {
      const status = String((d.data() as Record<string, unknown>).status ?? '').toLowerCase()
      return status === 'available'
    }).length
  } catch {
    return 0
  }
}

export const subscribeKartsByLocation = (
  location: ScannerLocation,
  onData: (records: KartRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const db = initializeFirestore()
  if (!db) {
    onData([])
    return () => undefined
  }

  const locationId = SCANNER_LOCATION_DOC_IDS[location]
  const kartQuery = query(collection(db, 'locations', locationId, KARTS_SUBCOLLECTION))
  return onSnapshot(
    kartQuery,
    (snapshot) => {
      const records = snapshot.docs
        .map((item): KartRecord => {
          const data = item.data() as Omit<KartRecord, 'id'>
          return {
            id: item.id,
            ...data,
            // Backfill kartType from mapping if missing in Firestore
            kartType: data.kartType ?? getKartType(data.kartNumber) ?? 'single',
          }
        })
        .sort((left, right) =>
          left.kartNumber.localeCompare(right.kartNumber, undefined, { numeric: true }),
        )
      onData(records)
    },
    (reason) => onError?.(reason as Error),
  )
}

export const subscribeDailyDeepCleanByLocation = (
  location: ScannerLocation,
  onData: (record: KartDeepCleanLogRecord | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const db = initializeFirestore()
  if (!db) {
    onData(null)
    return () => undefined
  }

  const today = toDateString(new Date())
  const locationId = SCANNER_LOCATION_DOC_IDS[location]
  const dailyQuery = query(
    collection(db, 'locations', locationId, KART_DEEP_CLEAN_SUBCOLLECTION),
    where('cleanedDate', '==', today),
  )

  return onSnapshot(
    dailyQuery,
    (snapshot) => {
      const first = snapshot.docs[0]
      if (!first) {
        onData(null)
        return
      }

      onData({
        id: first.id,
        ...(first.data() as Omit<KartDeepCleanLogRecord, 'id'>),
      })
    },
    (reason) => onError?.(reason as Error),
  )
}

export const saveKart = async ({
  id,
  kartNumber,
  kartType,
  location,
  status,
  condition,
  engineStatus,
  complaint,
  userId,
}: SaveKartInput): Promise<string> => {
  await ensureFirebaseAuthForStorage()

  const db = initializeFirestore()
  if (!db) {
    throw new Error('Firestore not available.')
  }

  const normalizedKartNumber = kartNumber.trim().toUpperCase()
  if (!normalizedKartNumber) {
    throw new Error('Kart number is required.')
  }

  // Validate format: must be location prefix + number
  if (!isValidKartNumberFormat(normalizedKartNumber, location)) {
    const prefix = getLocationPrefix(location)
    throw new Error(
      `Kart number must start with "${prefix}" followed by a number (e.g. ${prefix}1, ${prefix}12).`,
    )
  }

  const locationId = SCANNER_LOCATION_DOC_IDS[location]

  // On create, check for duplicate kart number at this location
  if (!id) {
    const proposedDocId = getKartDocId(location, normalizedKartNumber)
    const existingSnap = await getDoc(
      doc(db, 'locations', locationId, KARTS_SUBCOLLECTION, proposedDocId),
    )
    if (existingSnap.exists()) {
      throw new Error(`Kart "${normalizedKartNumber}" already exists at ${location}.`)
    }
  }

  // On update, prevent type changes
  if (id) {
    const existingSnap = await getDoc(doc(db, 'locations', locationId, KARTS_SUBCOLLECTION, id))
    if (existingSnap.exists()) {
      const existingType = existingSnap.data().kartType
      if (existingType && existingType !== kartType) {
        throw new Error(
          `Kart type cannot be changed. "${normalizedKartNumber}" is permanently "${existingType}".`,
        )
      }
    }
  }

  const docId = id ?? getKartDocId(location, normalizedKartNumber)
  const now = serverTimestamp()

  await setDoc(
    doc(db, 'locations', locationId, KARTS_SUBCOLLECTION, docId),
    {
      kartNumber: normalizedKartNumber,
      kartType,
      location,
      status,
      condition,
      engineStatus,
      complaint: complaint ?? '',
      updatedAt: now,
      ...(id
        ? {}
        : {
            createdBy: userId,
            createdAt: now,
          }),
    },
    { merge: true },
  )

  return docId
}

export const performKartDeepClean = async ({
  kart,
  location,
  cleanedBy,
  cleanedByUid,
  photos,
}: KartDeepCleanInput): Promise<void> => {
  await ensureFirebaseAuthForStorage()

  const db = initializeFirestore()
  if (!db) {
    throw new Error('Firestore not available.')
  }

  const today = toDateString(new Date())
  const locationId = SCANNER_LOCATION_DOC_IDS[location]
  const existingLogs = await getDocs(
    query(
      collection(db, 'locations', locationId, KART_DEEP_CLEAN_SUBCOLLECTION),
      where('cleanedDate', '==', today),
    ),
  )
  if (!existingLogs.empty) {
    throw new Error("Today's deep clean already completed.")
  }

  if (photos.length < 1 || photos.length > 2) {
    throw new Error('Upload minimum 1 and maximum 2 images.')
  }

  const uploadedUrls: string[] = []
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index]
    const extension = getExtension(photo)
    const suffix = photos.length > 1 ? `-${index + 1}` : ''
    const storagePath = `kart-deep-clean/${SCANNER_LOCATION_DOC_IDS[location]}/${today}/${toSafePathPart(kart.kartNumber, 'kart')}${suffix}${extension}`
    const uploaded = await uploadPipelineFile(storagePath, photo, 'images')
    uploadedUrls.push(uploaded.downloadUrl)
  }

  const deepCleanDocId = `${SCANNER_LOCATION_DOC_IDS[location]}-${today}`
  await setDoc(doc(db, 'locations', locationId, KART_DEEP_CLEAN_SUBCOLLECTION, deepCleanDocId), {
    kartId: kart.id,
    kartNumber: kart.kartNumber,
    location,
    cleanedBy,
    cleanedByUid,
    cleanedDate: today,
    cleanedAt: serverTimestamp(),
    photoUrl: uploadedUrls[0],
    photoUrls: uploadedUrls,
  })

  await Promise.all(
    uploadedUrls.map((url) =>
      saveKartPhotoRecord({
        kartId: kart.id,
        kartNumber: kart.kartNumber,
        location,
        photoType: 'deep_clean',
        photoUrl: url,
        uploadedBy: cleanedBy,
        uploadedByUid: cleanedByUid,
      }),
    ),
  )

  await updateDoc(doc(db, 'locations', locationId, KARTS_SUBCOLLECTION, kart.id), {
    lastDeepCleanDate: today,
    updatedAt: serverTimestamp(),
  })

  // Mark today's assignment as completed
  const assignmentRef = doc(db, 'locations', locationId, DEEP_CLEAN_ASSIGNMENTS, today)
  const assignmentSnap = await getDoc(assignmentRef)
  if (assignmentSnap.exists()) {
    await updateDoc(assignmentRef, {
      cleaned: true,
      cleanedBy,
      cleanedAt: serverTimestamp(),
      images: uploadedUrls,
    })
  }
}

export const subscribeDeepCleanHistoryByLocation = (
  location: ScannerLocation,
  onData: (records: KartDeepCleanLogRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const db = initializeFirestore()
  if (!db) {
    onData([])
    return () => undefined
  }

  const locationId = SCANNER_LOCATION_DOC_IDS[location]
  const historyQuery = query(
    collection(db, 'locations', locationId, KART_DEEP_CLEAN_SUBCOLLECTION),
    orderBy('cleanedAt', 'desc'),
  )

  return onSnapshot(
    historyQuery,
    (snapshot) => {
      const records = snapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<KartDeepCleanLogRecord, 'id'>),
      }))
      onData(records)
    },
    (reason) => onError?.(reason as Error),
  )
}

export const saveKartPhotoRecord = async ({
  kartId,
  kartNumber,
  location,
  photoType,
  photoUrl,
  uploadedBy,
  uploadedByUid,
}: SaveKartPhotoInput): Promise<void> => {
  await ensureFirebaseAuthForStorage()

  const db = initializeFirestore()
  if (!db) {
    throw new Error('Firestore not available.')
  }

  const locationId = SCANNER_LOCATION_DOC_IDS[location]
  await addDoc(collection(db, 'locations', locationId, KART_PHOTOS_SUBCOLLECTION), {
    kartId,
    kartNumber,
    location,
    photoType,
    photoUrl,
    uploadedBy,
    uploadedByUid,
    createdAt: serverTimestamp(),
  })
}

export const subscribeKartPhotoHistory = (
  location: ScannerLocation,
  kartId: string,
  onData: (records: KartPhotoRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const db = initializeFirestore()
  if (!db) {
    onData([])
    return () => undefined
  }

  const locationId = SCANNER_LOCATION_DOC_IDS[location]
  const historyQuery = query(
    collection(db, 'locations', locationId, KART_PHOTOS_SUBCOLLECTION),
    where('kartId', '==', kartId),
    orderBy('createdAt', 'desc'),
  )

  return onSnapshot(
    historyQuery,
    (snapshot) => {
      const records = snapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<KartPhotoRecord, 'id'>),
      }))
      onData(records)
    },
    (reason) => onError?.(reason as Error),
  )
}

/**
 * Returns (or creates) today's deep-clean assignment for a location.
 * The kart is auto-selected: least-recently deep-cleaned eligible kart
 * (condition good, engine working, not under repair). Returns null when
 * no eligible kart exists.
 */
export const getOrCreateDailyAssignment = async (
  location: ScannerLocation,
  eligibleKarts: KartRecord[],
): Promise<DeepCleanAssignment | null> => {
  await ensureFirebaseAuthForStorage()

  const db = initializeFirestore()
  if (!db) throw new Error('Firestore not available.')

  const today = toDateString(new Date())
  const locationId = SCANNER_LOCATION_DOC_IDS[location]
  const assignmentRef = doc(db, 'locations', locationId, DEEP_CLEAN_ASSIGNMENTS, today)

  const existing = await getDoc(assignmentRef)
  if (existing.exists()) {
    return { id: existing.id, ...(existing.data() as Omit<DeepCleanAssignment, 'id'>) }
  }

  const candidates = eligibleKarts
    .filter(
      (k) => k.condition === 'good' && k.engineStatus === 'working' && k.status === 'available',
    )
    .sort((a, b) => {
      if (!a.lastDeepCleanDate && !b.lastDeepCleanDate) return 0
      if (!a.lastDeepCleanDate) return -1
      if (!b.lastDeepCleanDate) return 1
      return a.lastDeepCleanDate.localeCompare(b.lastDeepCleanDate)
    })

  if (candidates.length === 0) return null

  const kart = candidates[0]
  const data = {
    kartId: kart.id,
    kartNumber: kart.kartNumber,
    location,
    assignedAt: serverTimestamp(),
    cleaned: false,
  }

  await setDoc(assignmentRef, data)
  return {
    id: today,
    kartId: kart.id,
    kartNumber: kart.kartNumber,
    location,
    assignedAt: null,
    cleaned: false,
  }
}

export const subscribeDailyAssignment = (
  location: ScannerLocation,
  onData: (assignment: DeepCleanAssignment | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const db = initializeFirestore()
  if (!db) {
    onData(null)
    return () => undefined
  }

  const today = toDateString(new Date())
  const locationId = SCANNER_LOCATION_DOC_IDS[location]
  const assignmentRef = doc(db, 'locations', locationId, DEEP_CLEAN_ASSIGNMENTS, today)

  return onSnapshot(
    assignmentRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null)
        return
      }
      onData({ id: snapshot.id, ...(snapshot.data() as Omit<DeepCleanAssignment, 'id'>) })
    },
    (err) => onError?.(err as Error),
  )
}

export const deleteKart = async (location: ScannerLocation, kartId: string): Promise<void> => {
  await ensureFirebaseAuthForStorage()

  const db = initializeFirestore()
  if (!db) {
    throw new Error('Firestore not available.')
  }

  const locationId = SCANNER_LOCATION_DOC_IDS[location]
  await deleteDoc(doc(db, 'locations', locationId, KARTS_SUBCOLLECTION, kartId))
}
