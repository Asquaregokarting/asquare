import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { ImageLightbox, useLightbox } from '../../../../components/ui/ImageLightbox'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { motion } from 'framer-motion'
import { useAuth } from '../../../auth/auth-context'
import { ensureFirebaseAuthForStorage } from '../../../../lib/firebase-auth'
import { initializeFirebaseApp } from '../../../../lib/firebase'
import { saveKartPhotoRecord } from '../../services/kartService'
import {
  ScannerLocation,
  SCANNER_LOCATION_DOC_IDS,
  ShiftVerificationPhotos,
} from '../types/scanner.types'

type VerificationFileKey = keyof ShiftVerificationPhotos

type SelectedPhoto = {
  file: File
  previewUrl: string
}

const canStartShiftForRole = (role: string): boolean => {
  const allowedRoles = ['owner', 'admin', 'developer', 'track_marshall', 'trackmarshall']
  const normalizedRole = String(role ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return allowedRoles.includes(normalizedRole)
}

const PHOTO_FIELDS: Array<{
  key: VerificationFileKey
  label: string
  capture: 'user' | 'environment'
}> = [
  { key: 'selfie', label: 'Employee Selfie', capture: 'user' },
  { key: 'track', label: 'Track Photo', capture: 'environment' },
  { key: 'kart', label: 'Kart Photo', capture: 'environment' },
]

const toShiftDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toSafePathPart = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || fallback
}

const getExtension = (file: File): string => {
  const match = file.name.toLowerCase().match(/\.[a-z0-9]+$/)
  if (match) {
    return match[0]
  }
  if (file.type === 'image/png') {
    return '.png'
  }
  if (file.type === 'image/webp') {
    return '.webp'
  }
  return '.jpg'
}

const uploadVerificationPhoto = async (
  location: ScannerLocation,
  userId: string,
  field: VerificationFileKey,
  file: File,
): Promise<string> => {
  await ensureFirebaseAuthForStorage()

  const app = initializeFirebaseApp()
  if (!app) {
    throw new Error('Firebase storage is not configured.')
  }

  const storage = getStorage(app)
  const shiftDate = toShiftDate(new Date())
  const safeUserId = toSafePathPart(userId, 'user')
  const timestamp = Date.now()
  const extension = getExtension(file)
  const fileName = `${field}_${safeUserId}_${timestamp}${extension}`
  const storagePath = `shift-verifications/${SCANNER_LOCATION_DOC_IDS[location]}/${shiftDate}/${fileName}`
  const storageRef = ref(storage, storagePath)

  await uploadBytes(storageRef, file, {
    contentType: file.type || undefined,
  })

  return getDownloadURL(storageRef)
}

export const ShiftStartVerification = ({
  location,
  userId,
  canStartShift,
  permissionMessage,
  kartPhotoTarget,
  onStartShift,
  onCancel,
}: {
  location: ScannerLocation
  userId: string
  canStartShift: boolean
  permissionMessage?: string | null
  kartPhotoTarget?: {
    kartId: string
    kartNumber: string
  } | null
  onStartShift: (
    photos: ShiftVerificationPhotos,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  onCancel: () => void
}) => {
  const { session } = useAuth()
  const [photos, setPhotos] = useState<Partial<Record<VerificationFileKey, SelectedPhoto>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(permissionMessage ?? null)
  const roleAllowed = canStartShiftForRole(session?.user.role ?? '')
  const { lightboxImages, lightboxIndex, openLightbox, closeLightbox } = useLightbox()

  const canStartShiftForUser = useMemo(
    () => roleAllowed && canStartShift,
    [roleAllowed, canStartShift],
  )

  useEffect(() => {
    setError(
      canStartShiftForUser
        ? (permissionMessage ?? null)
        : 'Only Owner, Admin, or Track Marshall can start the shift.',
    )
  }, [canStartShiftForUser, permissionMessage])

  useEffect(() => {
    return () => {
      Object.values(photos).forEach((item) => {
        if (item?.previewUrl) {
          URL.revokeObjectURL(item.previewUrl)
        }
      })
    }
  }, [photos])

  const allPhotosSelected = useMemo(
    () => PHOTO_FIELDS.every(({ key }) => Boolean(photos[key]?.file)),
    [photos],
  )

  const handleFileChange = (key: VerificationFileKey) => (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]
    if (!nextFile) {
      return
    }

    setPhotos((current) => {
      const previous = current[key]
      if (previous?.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl)
      }

      return {
        ...current,
        [key]: {
          file: nextFile,
          previewUrl: URL.createObjectURL(nextFile),
        },
      }
    })
  }

  const handleSubmit = async () => {
    if (!canStartShiftForUser) {
      setError('Only Owner, Admin, or Track Marshall can start the shift.')
      return
    }

    const selfie = photos.selfie?.file
    const track = photos.track?.file
    const kart = photos.kart?.file
    if (!selfie || !track || !kart) {
      setError('Upload all three photos before starting the shift.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const [selfieUrl, trackUrl, kartUrl] = await Promise.all([
        uploadVerificationPhoto(location, userId, 'selfie', selfie),
        uploadVerificationPhoto(location, userId, 'track', track),
        uploadVerificationPhoto(location, userId, 'kart', kart),
      ])

      const result = await onStartShift({
        selfie: selfieUrl,
        track: trackUrl,
        kart: kartUrl,
      })

      if (!result.ok) {
        setError(result.error)
        setSubmitting(false)
        return
      }

      if (kartPhotoTarget) {
        await saveKartPhotoRecord({
          kartId: kartPhotoTarget.kartId,
          kartNumber: kartPhotoTarget.kartNumber,
          location,
          photoType: 'shift_start',
          photoUrl: kartUrl,
          uploadedBy: session?.user.name || 'Track Staff',
          uploadedByUid: userId,
        })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to upload verification photos.')
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 min-h-screen overflow-y-auto bg-gray-100/80 backdrop-blur-sm dark:bg-base/77"
    >
      <div className="flex min-h-screen w-full items-start justify-center p-2 sm:items-center sm:p-4">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          className="w-full max-w-md space-y-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-track-panel sm:max-w-3xl lg:max-w-5xl"
        >
          <div className="mx-auto w-full max-w-md space-y-4 sm:max-w-none">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-track-accent-soft/70">
                  Shift Verification
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
                  {location}
                </h2>
                <p className="mt-2 text-sm text-gray-600 dark:text-white/55">
                  Upload all required photos before the shift can be started.
                </p>
              </div>

              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                className="w-full rounded-full border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-white/55 dark:hover:border-white/20 dark:hover:text-white sm:w-auto"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PHOTO_FIELDS.map(({ key, label, capture }) => {
                const selected = photos[key]
                return (
                  <div
                    key={key}
                    className="w-full rounded-xl bg-gray-50 p-4 backdrop-blur-md dark:bg-track-surface/80"
                  >
                    <div className="flex flex-col gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-white/45">
                          Tap to capture or choose an image.
                        </p>
                      </div>

                      <input
                        type="file"
                        accept="image/*"
                        capture={capture}
                        className="w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-track-accent file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:text-white/70"
                        onChange={handleFileChange(key)}
                      />

                      {selected ? (
                        <img
                          src={selected.previewUrl}
                          alt={label}
                          className="h-40 w-full cursor-pointer rounded-lg object-cover transition-opacity hover:opacity-80"
                          onClick={() => {
                            const allUrls = Object.values(photos)
                              .filter(Boolean)
                              .map((p) => p!.previewUrl)
                            const idx = allUrls.indexOf(selected.previewUrl)
                            openLightbox(allUrls, Math.max(0, idx))
                          }}
                        />
                      ) : (
                        <div className="flex h-40 w-full items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-base/65">
                          <span className="text-xs text-gray-500 dark:text-white/35">
                            No photo selected
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {error ? (
              <div className="rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">
                {error}
              </div>
            ) : null}

            {!canStartShiftForUser ? (
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                Only Owner, Admin, or Track Marshall can start the shift.
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-white/60 dark:hover:border-white/20 dark:hover:text-white sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canStartShiftForUser || !allPhotosSelected || submitting}
                className="w-full rounded-lg bg-track-accent py-3 font-medium text-white transition-colors hover:bg-track-accent-soft disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-6"
              >
                {submitting ? 'Uploading...' : 'Start Shift'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
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
