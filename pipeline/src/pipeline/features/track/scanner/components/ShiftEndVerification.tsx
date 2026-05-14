import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { ImageLightbox, useLightbox } from '../../../../components/ui/ImageLightbox'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { motion } from 'framer-motion'
import { ensureFirebaseAuthForStorage } from '../../../../lib/firebase-auth'
import { initializeFirebaseApp } from '../../../../lib/firebase'
import {
  ScannerLocation,
  SCANNER_LOCATION_DOC_IDS,
  ShiftEndVerificationPhotos,
} from '../types/scanner.types'

type EndVerificationFileKey = keyof ShiftEndVerificationPhotos

type SelectedPhoto = {
  file: File
  previewUrl: string
}

const END_PHOTO_FIELDS: Array<{
  key: EndVerificationFileKey
  label: string
  capture: 'user' | 'environment'
}> = [
  { key: 'selfie', label: 'Employee Selfie', capture: 'user' },
  { key: 'track_north', label: 'Track Photo — North', capture: 'environment' },
  { key: 'track_south', label: 'Track Photo — South', capture: 'environment' },
  { key: 'track_east', label: 'Track Photo — East', capture: 'environment' },
  { key: 'track_west', label: 'Track Photo — West', capture: 'environment' },
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
  if (match) return match[0]
  if (file.type === 'image/png') return '.png'
  if (file.type === 'image/webp') return '.webp'
  return '.jpg'
}

const uploadEndVerificationPhoto = async (
  location: ScannerLocation,
  userId: string,
  field: EndVerificationFileKey,
  file: File,
): Promise<string> => {
  await ensureFirebaseAuthForStorage()

  const app = initializeFirebaseApp()
  if (!app) throw new Error('Firebase storage is not configured.')

  const storage = getStorage(app)
  const shiftDate = toShiftDate(new Date())
  const safeUserId = toSafePathPart(userId, 'user')
  const timestamp = Date.now()
  const extension = getExtension(file)
  const fileName = `${field}_${safeUserId}_${timestamp}${extension}`
  const storagePath = `shift-end-verifications/${SCANNER_LOCATION_DOC_IDS[location]}/${shiftDate}/${fileName}`
  const storageRef = ref(storage, storagePath)

  await uploadBytes(storageRef, file, {
    contentType: file.type || undefined,
  })

  return getDownloadURL(storageRef)
}

export const ShiftEndVerification = ({
  location,
  userId,
  onEndShift,
  onCancel,
}: {
  location: ScannerLocation
  userId: string
  onEndShift: (
    photos: ShiftEndVerificationPhotos,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  onCancel: () => void
}) => {
  const [photos, setPhotos] = useState<Partial<Record<EndVerificationFileKey, SelectedPhoto>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { lightboxImages, lightboxIndex, openLightbox, closeLightbox } = useLightbox()

  useEffect(() => {
    return () => {
      Object.values(photos).forEach((item) => {
        if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      })
    }
  }, [photos])

  const allPhotosSelected = useMemo(
    () => END_PHOTO_FIELDS.every(({ key }) => Boolean(photos[key]?.file)),
    [photos],
  )

  const handleFileChange =
    (key: EndVerificationFileKey) => (event: ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0]
      if (!nextFile) return

      setPhotos((current) => {
        const previous = current[key]
        if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl)

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
    const selfie = photos.selfie?.file
    const trackNorth = photos.track_north?.file
    const trackSouth = photos.track_south?.file
    const trackEast = photos.track_east?.file
    const trackWest = photos.track_west?.file

    if (!selfie || !trackNorth || !trackSouth || !trackEast || !trackWest) {
      setError('Upload all five photos before ending the shift.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const [selfieUrl, northUrl, southUrl, eastUrl, westUrl] = await Promise.all([
        uploadEndVerificationPhoto(location, userId, 'selfie', selfie),
        uploadEndVerificationPhoto(location, userId, 'track_north', trackNorth),
        uploadEndVerificationPhoto(location, userId, 'track_south', trackSouth),
        uploadEndVerificationPhoto(location, userId, 'track_east', trackEast),
        uploadEndVerificationPhoto(location, userId, 'track_west', trackWest),
      ])

      const result = await onEndShift({
        selfie: selfieUrl,
        track_north: northUrl,
        track_south: southUrl,
        track_east: eastUrl,
        track_west: westUrl,
      })

      if (!result.ok) {
        setError(result.error)
        setSubmitting(false)
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
      className="fixed inset-0 z-50 min-h-screen overflow-y-auto bg-base/77 backdrop-blur-sm"
    >
      <div className="flex min-h-screen w-full items-start justify-center p-2 sm:items-center sm:p-4">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          className="w-full max-w-md space-y-4 rounded-3xl border border-gray-700 bg-track-panel p-4 shadow-2xl sm:max-w-3xl lg:max-w-5xl"
        >
          <div className="mx-auto w-full max-w-md space-y-4 sm:max-w-none">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-red-400/70">
                  End Shift Verification
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{location}</h2>
                <p className="mt-2 text-sm text-white/55">
                  Upload all required photos before the shift can be ended.
                </p>
              </div>

              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                className="w-full rounded-full border border-gray-700 px-3 py-2 text-xs font-medium text-white/55 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50 sm:w-auto"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {END_PHOTO_FIELDS.map(({ key, label, capture }) => {
                const selected = photos[key]
                return (
                  <div
                    key={key}
                    className="w-full rounded-xl bg-track-surface/80 p-4 backdrop-blur-md"
                  >
                    <div className="flex flex-col gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{label}</p>
                        <p className="mt-1 text-xs text-white/45">
                          Tap to capture or choose an image.
                        </p>
                      </div>

                      <input
                        type="file"
                        accept="image/*"
                        capture={capture}
                        className="w-full text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-red-500 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
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
                        <div className="flex h-40 w-full items-center justify-center rounded-lg border border-dashed border-gray-700 bg-base/65">
                          <span className="text-xs text-white/35">No photo selected</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {error ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                className="w-full rounded-xl border border-gray-700 px-4 py-3 text-sm font-medium text-white/60 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!allPhotosSelected || submitting}
                className="w-full rounded-lg bg-red-500 py-3 font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-6"
              >
                {submitting ? 'Uploading...' : 'End Shift'}
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
