import { ChangeEvent, useEffect, useState } from 'react'
import { fmtDateTimeFullIST } from '../../../../lib/date-format'
import { DeepCleanAssignment, KartDeepCleanLogRecord } from '../services/kartService'
import { ScannerLocation } from '../scanner/types/scanner.types'
import { ImageLightbox, useLightbox } from '../../../components/ui/ImageLightbox'

type SelectedPhoto = {
  file: File
  previewUrl: string
}

type SelectedVideo = {
  file: File
  previewUrl: string
}

const MAX_VIDEO_SIZE_MB = 100
const MAX_VIDEO_DURATION_SEC = 180 // 3 minutes

export const KartDeepClean = ({
  open,
  location,
  assignment,
  assignmentLoading,
  canUpload,
  loading,
  historyRows,
  onClose,
  onSubmit,
}: {
  open: boolean
  location: ScannerLocation
  assignment: DeepCleanAssignment | null
  assignmentLoading: boolean
  canUpload: boolean
  loading?: boolean
  historyRows: KartDeepCleanLogRecord[]
  onClose: () => void
  onSubmit: (photos: File[], video?: File) => Promise<void>
}) => {
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new')
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([])
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { lightboxImages, lightboxIndex, openLightbox, closeLightbox } = useLightbox()

  useEffect(() => {
    if (!open) return
    setActiveTab('new')
    setSelectedPhotos([])
    setSelectedVideo(null)
    setError(null)
  }, [open])

  useEffect(() => {
    return () => {
      selectedPhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
      if (selectedVideo) URL.revokeObjectURL(selectedVideo.previewUrl)
    }
  }, [selectedPhotos, selectedVideo])

  if (!open) return null

  const alreadyCleaned = assignment?.cleaned === true

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []).slice(0, 2)
    if (nextFiles.length === 0) return

    setSelectedPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
      return nextFiles.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }))
    })
    setError(null)
  }

  const handleVideoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate size
    if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
      setError(`Video must be under ${MAX_VIDEO_SIZE_MB} MB.`)
      return
    }

    // Validate duration (async via video element)
    const videoEl = document.createElement('video')
    videoEl.preload = 'metadata'
    videoEl.onloadedmetadata = () => {
      URL.revokeObjectURL(videoEl.src)
      if (videoEl.duration > MAX_VIDEO_DURATION_SEC) {
        setError(`Video must be under ${Math.round(MAX_VIDEO_DURATION_SEC / 60)} minutes.`)
        return
      }
      if (selectedVideo) URL.revokeObjectURL(selectedVideo.previewUrl)
      setSelectedVideo({ file, previewUrl: URL.createObjectURL(file) })
      setError(null)
    }
    videoEl.onerror = () => {
      URL.revokeObjectURL(videoEl.src)
      setError('Invalid video file.')
    }
    videoEl.src = URL.createObjectURL(file)
  }

  const handleSubmit = async () => {
    if (!canUpload) {
      setError('Only Owner, Admin, or Track Marshall can perform deep clean uploads.')
      return
    }
    if (alreadyCleaned) {
      setError("Today's deep clean already completed.")
      return
    }
    if (!assignment) {
      setError('No kart assigned for deep clean today.')
      return
    }
    if (selectedPhotos.length < 1 || selectedPhotos.length > 2) {
      setError('Upload minimum 1 and maximum 2 images.')
      return
    }
    await onSubmit(
      selectedPhotos.map((item) => item.file),
      selectedVideo?.file,
    )
  }

  const formatDate = (value: KartDeepCleanLogRecord['cleanedAt']): string => {
    return fmtDateTimeFullIST(value)
  }

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center overflow-y-auto bg-base/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-track-panel">
        {/* Fixed header */}
        <div className="shrink-0 p-5 pb-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-track-accent-soft/80">
                Daily Deep Clean
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
                {location}
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-white/60">
                A kart is auto-assigned each day based on least-recent deep clean.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-white/60 dark:hover:text-white"
            >
              Close
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="space-y-4">
            <div className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-track-surface-alt">
              <button
                type="button"
                onClick={() => setActiveTab('new')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  activeTab === 'new'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-track-surface dark:text-white'
                    : 'text-gray-600 dark:text-white/60'
                }`}
              >
                Today&apos;s Clean
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  activeTab === 'history'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-track-surface dark:text-white'
                    : 'text-gray-600 dark:text-white/60'
                }`}
              >
                History
              </button>
            </div>

            {activeTab === 'new' ? (
              <div className="space-y-4">
                {!canUpload ? (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                    Only Owner, Admin, or Track Marshall can perform deep clean uploads.
                  </div>
                ) : null}

                {/* Assignment loading */}
                {assignmentLoading ? (
                  <div className="flex h-32 items-center justify-center text-sm text-gray-500 dark:text-white/50">
                    Assigning kart for today&apos;s deep clean...
                  </div>
                ) : !assignment ? (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                    No eligible karts available for deep cleaning. All karts may be under repair,
                    damaged, or have engine failure.
                  </div>
                ) : alreadyCleaned ? (
                  /* Already cleaned — show completion summary */
                  <div className="rounded-xl border border-success/30 bg-success/10 p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-full bg-success/20 text-lg">
                        ✅
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-success">
                          Today&apos;s deep clean already completed
                        </p>
                        <p className="mt-0.5 text-xs text-success/70">
                          Kart <span className="font-bold">{assignment.kartNumber}</span> cleaned by{' '}
                          <span className="font-medium">{assignment.cleanedBy ?? '—'}</span>
                        </p>
                      </div>
                    </div>

                    {(assignment.images && assignment.images.length > 0) || assignment.videoUrl ? (
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        {assignment.images && assignment.images.length > 0 ? (
                          <div className="grid grid-cols-1 gap-2">
                            {assignment.images.map((url, i) => (
                              <img
                                key={url}
                                src={url}
                                alt={`Deep clean ${i + 1}`}
                                className="h-24 w-full cursor-pointer rounded-lg object-cover transition-opacity hover:opacity-80 sm:h-32"
                                onClick={() => openLightbox(assignment.images!, i)}
                              />
                            ))}
                          </div>
                        ) : null}
                        {assignment.videoUrl ? (
                          <div>
                            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                            <video
                              src={assignment.videoUrl}
                              controls
                              className="h-24 w-full rounded-lg sm:h-32"
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  /* Assignment exists, not yet cleaned — show kart card + upload */
                  <>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-track-surface">
                      <p className="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/45">
                        Assigned Kart
                      </p>
                      <div className="mt-2 flex items-center gap-3">
                        <span className="text-2xl font-bold text-track-accent">
                          {assignment.kartNumber}
                        </span>
                        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-500">
                          Auto-assigned
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400 dark:text-white/35">
                        Selected based on least-recent deep clean date. One clean per location per
                        day.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-track-surface">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          Upload Images (1 to 2)
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-white/45">
                          Use camera/file input. Maximum two images.
                        </p>

                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          multiple
                          onChange={handleFileChange}
                          disabled={!canUpload || loading}
                          className="mt-2 w-full text-sm text-gray-700 file:mr-2 file:rounded-lg file:border-0 file:bg-track-accent file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white disabled:opacity-50 dark:text-white/70"
                        />

                        {selectedPhotos.length > 0 ? (
                          <div className="mt-3 grid grid-cols-1 gap-2">
                            {selectedPhotos.map((photo, index) => (
                              <img
                                key={`${photo.previewUrl}-${index}`}
                                src={photo.previewUrl}
                                alt={`Deep clean preview ${index + 1}`}
                                className="h-24 w-full cursor-pointer rounded-lg object-cover transition-opacity hover:opacity-80 sm:h-32"
                                onClick={() =>
                                  openLightbox(
                                    selectedPhotos.map((p) => p.previewUrl),
                                    index,
                                  )
                                }
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 flex h-24 w-full items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-base/65 sm:h-32">
                            <span className="text-xs text-gray-500 dark:text-white/35">
                              No images selected
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-track-surface">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          Upload Video (optional)
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-white/45">
                          Max {MAX_VIDEO_SIZE_MB} MB, {Math.round(MAX_VIDEO_DURATION_SEC / 60)} min.
                        </p>

                        <input
                          type="file"
                          accept="video/*"
                          capture="environment"
                          onChange={handleVideoChange}
                          disabled={!canUpload || loading}
                          className="mt-2 w-full text-sm text-gray-700 file:mr-2 file:rounded-lg file:border-0 file:bg-track-accent file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white disabled:opacity-50 dark:text-white/70"
                        />

                        {selectedVideo ? (
                          <div className="mt-3">
                            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                            <video
                              src={selectedVideo.previewUrl}
                              controls
                              className="h-24 w-full rounded-lg object-cover sm:h-32"
                            />
                            <p className="mt-1 text-xs text-gray-500 dark:text-white/35">
                              {(selectedVideo.file.size / (1024 * 1024)).toFixed(1)} MB
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-track-panel">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-track-surface-alt">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-gray-500 dark:text-white/55">
                          Kart Number
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-gray-500 dark:text-white/55">
                          Employee Name
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-gray-500 dark:text-white/55">
                          Date & Time
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-gray-500 dark:text-white/55">
                          Uploaded Images
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-gray-500 dark:text-white/55">
                          Video
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {historyRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center text-sm text-gray-500 dark:text-white/50"
                          >
                            No deep clean uploads for this location.
                          </td>
                        </tr>
                      ) : (
                        historyRows.map((row) => {
                          const images =
                            row.photoUrls && row.photoUrls.length > 0
                              ? row.photoUrls
                              : [row.photoUrl]
                          return (
                            <tr key={row.id}>
                              <td className="px-4 py-3 text-gray-900 dark:text-white">
                                {row.kartNumber}
                              </td>
                              <td className="px-4 py-3 text-gray-700 dark:text-white/70">
                                {row.cleanedBy}
                              </td>
                              <td className="px-4 py-3 text-gray-700 dark:text-white/70">
                                {formatDate(row.cleanedAt)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  {images.map((url, imgIdx) => (
                                    <img
                                      key={url}
                                      src={url}
                                      alt={`${row.kartNumber} deep clean`}
                                      className="h-16 w-20 cursor-pointer rounded-lg object-cover transition-opacity hover:opacity-80"
                                      onClick={() =>
                                        openLightbox(images.filter(Boolean) as string[], imgIdx)
                                      }
                                    />
                                  ))}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {row.videoUrl ? (
                                  // eslint-disable-next-line jsx-a11y/media-has-caption
                                  <video
                                    src={row.videoUrl}
                                    controls
                                    className="h-16 w-24 rounded-lg"
                                  />
                                ) : (
                                  <span className="text-xs text-gray-400 dark:text-white/30">
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {error ? (
              <div className="rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">
                {error}
              </div>
            ) : null}
          </div>
        </div>

        {/* Fixed footer */}
        <div className="shrink-0 border-t border-gray-200 p-5 dark:border-gray-700">
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-white/60 dark:hover:text-white sm:w-auto"
            >
              Cancel
            </button>
            {activeTab === 'new' && assignment && !alreadyCleaned ? (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={
                  !canUpload || loading || selectedPhotos.length < 1 || selectedPhotos.length > 2
                }
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-track-surface/80 dark:text-white/70 dark:hover:border-white/20 dark:hover:text-white sm:w-auto"
              >
                {loading ? 'Saving...' : 'Save Deep Clean'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {lightboxImages && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          onClose={closeLightbox}
        />
      )}
    </div>
  )
}
