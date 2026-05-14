import { useEffect, useState } from 'react'
import { fmtDateTimeFullIST } from '../../../../lib/date-format'
import { KartPhotoRecord, subscribeKartPhotoHistory } from '../services/kartService'
import { ScannerLocation } from '../scanner/types/scanner.types'
import { ImageLightbox, useLightbox } from '../../../components/ui/ImageLightbox'

const formatType = (value: KartPhotoRecord['photoType']): string =>
  value === 'shift_start' ? 'Shift Start' : 'Deep Clean'

const formatDate = (value: KartPhotoRecord['createdAt']): string => {
  return fmtDateTimeFullIST(value)
}

export const KartPhotoHistory = ({
  kartId,
  location,
}: {
  kartId: string
  location: ScannerLocation
}) => {
  const [records, setRecords] = useState<KartPhotoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { lightboxImages, lightboxIndex, openLightbox, closeLightbox } = useLightbox()

  useEffect(() => {
    setLoading(true)
    setError(null)

    const unsubscribe = subscribeKartPhotoHistory(
      location,
      kartId,
      (rows) => {
        setRecords(rows)
        setLoading(false)
      },
      (reason) => {
        setError(reason.message)
        setLoading(false)
      },
    )

    return () => unsubscribe()
  }, [kartId, location])

  if (loading) {
    return <p className="text-sm text-gray-500 dark:text-white/50">Loading photo history...</p>
  }

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
  }

  if (records.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-white/50">
        No photo history available for this kart.
      </p>
    )
  }

  const allUrls = records.map((r) => r.photoUrl)

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {records.map((photo, idx) => (
          <div
            key={photo.id}
            className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-track-surface"
          >
            <img
              src={photo.photoUrl}
              alt={`${photo.kartNumber} ${photo.photoType}`}
              className="h-32 w-40 cursor-pointer rounded-lg object-cover transition-opacity hover:opacity-80"
              onClick={() => openLightbox(allUrls, idx)}
            />
            <div className="mt-3 space-y-1 text-xs text-gray-600 dark:text-white/65">
              <p className="font-semibold text-gray-900 dark:text-white">
                {formatType(photo.photoType)}
              </p>
              <p>Uploaded by {photo.uploadedBy}</p>
              <p>{formatDate(photo.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>
      {lightboxImages && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          onClose={closeLightbox}
        />
      )}
    </>
  )
}
