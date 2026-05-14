import { useCallback, useRef, useState } from 'react'
import { Upload, X, Link as LinkIcon, Image as ImageIcon } from 'lucide-react'
import { uploadPipelineFile } from '../../../lib/firebase-storage'
import type { EventCampaignStatus } from '../../../features/event-campaigns/event-campaign-types'

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const ACCEPTED_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES]
const MAX_IMAGE_SIZE = 2 * 1024 * 1024 // 2 MB
const MAX_VIDEO_SIZE = 20 * 1024 * 1024 // 20 MB

const isVideoFile = (file: File) => ACCEPTED_VIDEO_TYPES.includes(file.type)
const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)

interface Props {
  title: string
  description: string
  heroImageUrl: string
  promoText: string
  startDate: string
  endDate: string
  status: EventCampaignStatus
  onChange: (field: string, value: string) => void
}

const EventDetailsSection = ({
  title,
  description,
  heroImageUrl,
  promoText,
  startDate,
  endDate,
  status,
  onChange,
}: Props) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadMode, setUploadMode] = useState<'upload' | 'url'>(heroImageUrl ? 'url' : 'upload')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const validateFile = (file: File): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return 'Only JPG, PNG, WebP images or MP4, WebM, MOV videos are allowed.'
    }
    const limit = isVideoFile(file) ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE
    const limitMb = limit / 1024 / 1024
    if (file.size > limit) {
      return `File size must be under ${limitMb} MB. Selected file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`
    }
    return null
  }

  const handleUpload = useCallback(
    async (file: File) => {
      const error = validateFile(file)
      if (error) {
        setUploadError(error)
        return
      }

      setUploadError(null)
      setUploading(true)
      setUploadProgress(0)

      try {
        const safeName = file.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '-')
        const folder = isVideoFile(file) ? 'video' : 'hero'
        const storagePath = `event-campaigns/${folder}/${Date.now()}-${safeName}`

        // Simulate progress since uploadPipelineFile doesn't expose it
        const progressTimer = setInterval(() => {
          setUploadProgress((prev) => Math.min(prev + 15, 90))
        }, 200)

        const result = await uploadPipelineFile(
          storagePath,
          file,
          isVideoFile(file) ? 'files' : 'images',
        )

        clearInterval(progressTimer)
        setUploadProgress(100)
        onChange('heroImageUrl', result.downloadUrl)

        setTimeout(() => {
          setUploading(false)
          setUploadProgress(0)
        }, 500)
      } catch (err) {
        setUploading(false)
        setUploadProgress(0)
        setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
      }
    },
    [onChange],
  )

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void handleUpload(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleUpload(file)
  }

  const handleRemoveImage = () => {
    onChange('heroImageUrl', '')
    setUploadError(null)
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Event Details</h3>

      <div className="mt-4 space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => onChange('title', e.target.value)}
            placeholder="e.g. Summer Festival 2026"
            className="ui-field min-h-10 w-full text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Description</label>
          <textarea
            value={description}
            onChange={(e) => onChange('description', e.target.value)}
            placeholder="Promotional description shown to customers"
            rows={3}
            className="ui-field w-full text-sm"
          />
        </div>

        {/* Hero Image — Upload or URL */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="block text-xs font-medium text-muted">Hero Image / Video</label>
            <div className="flex rounded-lg border border-border bg-panel/40">
              <button
                type="button"
                onClick={() => setUploadMode('upload')}
                className={`flex items-center gap-1.5 rounded-l-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                  uploadMode === 'upload'
                    ? 'bg-accent/10 text-accent'
                    : 'text-muted hover:text-text'
                }`}
              >
                <Upload className="h-3 w-3" />
                Upload
              </button>
              <button
                type="button"
                onClick={() => setUploadMode('url')}
                className={`flex items-center gap-1.5 rounded-r-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                  uploadMode === 'url' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text'
                }`}
              >
                <LinkIcon className="h-3 w-3" />
                URL
              </button>
            </div>
          </div>

          {uploadMode === 'upload' ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,.m4v"
                onChange={handleFileSelect}
                className="hidden"
              />

              {/* Drop zone */}
              {!heroImageUrl && !uploading && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 transition ${
                    dragOver
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-accent/40 hover:bg-panel/20'
                  }`}
                >
                  <ImageIcon className="mb-2 h-8 w-8 text-muted" />
                  <p className="text-sm font-medium text-text">
                    Drop image or video here, or click to browse
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    JPG/PNG/WebP (max 2 MB) or MP4/WebM/MOV (max 20 MB)
                  </p>
                </div>
              )}

              {/* Upload progress */}
              {uploading && (
                <div className="rounded-xl border border-border bg-panel/40 px-4 py-6 text-center">
                  <div className="mx-auto mb-3 h-1.5 w-48 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted">Uploading... {uploadProgress}%</p>
                </div>
              )}
            </>
          ) : (
            <input
              type="text"
              value={heroImageUrl}
              onChange={(e) => onChange('heroImageUrl', e.target.value)}
              placeholder="https://..."
              className="ui-field min-h-10 w-full text-sm"
            />
          )}

          {uploadError && (
            <div className="mt-2 rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
              {uploadError}
            </div>
          )}

          {/* Image / video preview */}
          {heroImageUrl && !uploading && (
            <div className="relative mt-2">
              {isVideoUrl(heroImageUrl) ? (
                <video
                  src={heroImageUrl}
                  className="h-36 w-full rounded-xl border border-border object-cover"
                  controls
                  muted
                  playsInline
                />
              ) : (
                <img
                  src={heroImageUrl}
                  alt="Hero preview"
                  className="h-36 w-full rounded-xl border border-border object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              )}
              <div className="absolute right-2 top-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setUploadMode('upload')
                    fileInputRef.current?.click()
                  }}
                  className="rounded-lg bg-surface/90 px-2 py-1 text-[11px] font-semibold text-text shadow-sm backdrop-blur-sm transition hover:bg-surface"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface/90 text-critical shadow-sm backdrop-blur-sm transition hover:bg-surface"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            Promo Text (shown on customer page)
          </label>
          <textarea
            value={promoText}
            onChange={(e) => onChange('promoText', e.target.value)}
            placeholder="e.g. Buy 2 Get 1 Free on all activities!"
            rows={2}
            className="ui-field w-full text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Start Date *</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => onChange('startDate', e.target.value)}
              className="ui-field min-h-10 w-full text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">End Date *</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => onChange('endDate', e.target.value)}
              className="ui-field min-h-10 w-full text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Status</label>
            <select
              value={status}
              onChange={(e) => onChange('status', e.target.value)}
              className="ui-field min-h-10 w-full text-sm"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="ended">Ended</option>
            </select>
          </div>
        </div>
      </div>
    </section>
  )
}

export default EventDetailsSection
