import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react'
import { ModalShell } from '../../../components/ui/ModalShell'
import type { GameType } from './activity-draft-utils'
import { readFileAsDataUrl } from './activity-draft-utils'
import type { VendorDetailsRecord, BranchLocationKey } from '../../../api/types'
import { Trash2 } from 'lucide-react'
import { logger } from '../../../../lib/logger'

interface AddGameDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: {
    name: string
    imageFiles: File[]
    imagePreviews: string[]
    gameType: GameType
    vendorUserId: string
    vendorName: string
    vendorBranchId: string
  }) => void
  approvedVendors: VendorDetailsRecord[]
  locationOptions: { id: BranchLocationKey; name: string }[]
  canManage: boolean
}

interface ImageAttachment {
  id: string
  file: File
  preview: string
}

const MAX_IMAGES = 5
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB per image — keeps Storage payload sane

const newAttachmentId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const formatVendorLabel = (vendor: VendorDetailsRecord): string =>
  `${vendor.vendorName} (${vendor.particular})`

export const AddGameDialog = ({
  open,
  onClose,
  onSubmit,
  approvedVendors,
  locationOptions,
  canManage,
}: AddGameDialogProps) => {
  const [name, setName] = useState('')
  const [gameType, setGameType] = useState<GameType>('our_game')
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [vendorUserId, setVendorUserId] = useState('')
  const [vendorBranchId, setVendorBranchId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)

  const resetForm = useCallback(() => {
    setName('')
    setGameType('our_game')
    setAttachments([])
    setVendorUserId('')
    setVendorBranchId('')
    setError(null)
    setIsReading(false)
  }, [])

  // Reset whenever the dialog transitions to closed — covers backdrop/Esc
  // closes that bypass `handleClose`, so reopening starts clean.
  useEffect(() => {
    if (!open) resetForm()
  }, [open, resetForm])

  const handleClose = useCallback(() => {
    resetForm()
    onClose()
  }, [resetForm, onClose])

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    event.target.value = ''
    if (!fileList || fileList.length === 0) return

    const picked = Array.from(fileList)
    const accepted: File[] = []
    const rejections: string[] = []

    for (const file of picked) {
      if (!file.type.startsWith('image/')) {
        rejections.push(`${file.name}: not an image`)
        continue
      }
      if (file.size > MAX_IMAGE_BYTES) {
        rejections.push(`${file.name}: > 5 MB`)
        continue
      }
      accepted.push(file)
    }

    if (attachments.length + accepted.length > MAX_IMAGES) {
      const room = Math.max(0, MAX_IMAGES - attachments.length)
      rejections.push(`Only ${MAX_IMAGES} images allowed; dropped ${accepted.length - room}`)
      accepted.splice(room)
    }

    if (accepted.length === 0) {
      setError(rejections.join(' · ') || 'No valid images selected.')
      return
    }

    setIsReading(true)
    try {
      const previews = await Promise.all(accepted.map((f) => readFileAsDataUrl(f)))
      const next: ImageAttachment[] = accepted.map((file, i) => ({
        id: newAttachmentId(),
        file,
        preview: previews[i],
      }))
      setAttachments((prev) => [...prev, ...next])
      setError(rejections.length > 0 ? rejections.join(' · ') : null)
    } catch (err) {
      logger.error('add_game.image_read_failed', err)
      setError('Failed to read image.')
    } finally {
      setIsReading(false)
    }
  }

  const removeImage = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleSubmit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!canManage) return // defense in depth — button is disabled but Enter-submit could still fire
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Game name is required.')
      return
    }
    const needsVendor = gameType === 'vendor_game' || gameType === 'sub_lease'
    if (needsVendor && !vendorBranchId) {
      setError('Please select a location for the vendor game.')
      return
    }
    if (needsVendor && !vendorUserId) {
      setError('Please select a vendor.')
      return
    }
    // Resolve the vendor label from the live list at submit time so a
    // mid-edit rename in another tab doesn't leak a stale string downstream.
    const vendor = needsVendor ? approvedVendors.find((v) => v.userId === vendorUserId) : undefined
    if (needsVendor && !vendor) {
      setError('Selected vendor is no longer available. Please re-select.')
      return
    }
    onSubmit({
      name: trimmed,
      imageFiles: attachments.map((a) => a.file),
      imagePreviews: attachments.map((a) => a.preview),
      gameType,
      vendorUserId,
      vendorName: vendor ? formatVendorLabel(vendor) : '',
      vendorBranchId,
    })
    resetForm()
  }

  const showVendorFields = gameType === 'vendor_game' || gameType === 'sub_lease'
  const disableInputs = !canManage

  return (
    <ModalShell open={open} onClose={handleClose} maxWidth="max-w-[520px]">
      <form onSubmit={handleSubmit}>
        <div className="border-b border-border px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Add Game</p>
          <h3 className="mt-1 font-display text-lg tracking-tight text-text">Create New Game</h3>
        </div>

        <fieldset disabled={disableInputs} className="space-y-4 p-6">
          {!canManage && (
            <p
              className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
              role="status"
            >
              You don’t have permission to create games.
            </p>
          )}
          {error && (
            <p
              className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="add-game-type"
              className="text-xs font-semibold uppercase tracking-[0.06em] text-muted"
            >
              Game Type
            </label>
            <select
              id="add-game-type"
              value={gameType}
              onChange={(e) => {
                const value = e.target.value as GameType
                setGameType(value)
                if (value === 'our_game') {
                  setVendorUserId('')
                  setVendorBranchId('')
                }
              }}
              className="ui-field min-h-11 w-full"
            >
              <option value="our_game">Our Game</option>
              <option value="vendor_game">Vendor Game</option>
              <option value="sub_lease">Sub Lease</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="add-game-name"
              className="text-xs font-semibold uppercase tracking-[0.06em] text-muted"
            >
              Game Name
            </label>
            <input
              id="add-game-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Game Name"
              maxLength={120}
              className="ui-field min-h-11 w-full"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus first field on dialog open
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="add-game-images"
              className="text-xs font-semibold uppercase tracking-[0.06em] text-muted"
            >
              Cover Images ({attachments.length}/{MAX_IMAGES}, max 5 MB each)
            </label>
            <input
              id="add-game-images"
              type="file"
              accept="image/*"
              multiple
              disabled={disableInputs || isReading || attachments.length >= MAX_IMAGES}
              onChange={(e) => void handleImageChange(e)}
              className="ui-field min-h-11 w-full py-2.5"
            />
          </div>

          {attachments.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {attachments.map((att, idx) => (
                <div
                  key={att.id}
                  className="group/img relative overflow-hidden rounded-xl border border-border"
                >
                  <img
                    src={att.preview}
                    alt={`Preview ${idx + 1}`}
                    className="h-28 w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(att.id)}
                    className="absolute right-1 top-1 hidden rounded-full bg-critical/80 p-0.5 text-white group-hover/img:block"
                    aria-label={`Remove image ${idx + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showVendorFields && (
            <>
              <div className="space-y-1.5">
                <label
                  htmlFor="add-game-branch"
                  className="text-xs font-semibold uppercase tracking-[0.06em] text-muted"
                >
                  Location (Branch)
                </label>
                <select
                  id="add-game-branch"
                  value={vendorBranchId}
                  onChange={(e) => {
                    setVendorBranchId(e.target.value)
                    setVendorUserId('')
                  }}
                  className="ui-field min-h-11 w-full"
                >
                  <option value="">Select Branch...</option>
                  {locationOptions.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="add-game-vendor"
                  className="text-xs font-semibold uppercase tracking-[0.06em] text-muted"
                >
                  Vendor Name
                </label>
                <select
                  id="add-game-vendor"
                  value={vendorUserId}
                  onChange={(e) => setVendorUserId(e.target.value)}
                  className="ui-field min-h-11 w-full"
                >
                  <option value="">Select Vendor...</option>
                  {approvedVendors
                    .filter((v) =>
                      gameType === 'sub_lease'
                        ? v.vendorType === 'SubLease'
                        : v.vendorType !== 'SubLease',
                    )
                    .map((vendor) => (
                      <option key={vendor.userId} value={vendor.userId}>
                        {vendor.vendorName} — {vendor.particular}
                      </option>
                    ))}
                </select>
              </div>
            </>
          )}
        </fieldset>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canManage || isReading}
            className="ui-btn ui-btn-primary min-h-10 px-4 text-sm"
          >
            Create Game
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
