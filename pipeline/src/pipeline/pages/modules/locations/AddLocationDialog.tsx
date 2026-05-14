import { FormEvent, useState } from 'react'
import { ModalShell } from '../../../components/ui/ModalShell'
import { asquareLocationsApi } from '../../../api/asquare-locations'
import { getAllLocations } from '../../../../lib/locations'

interface AddLocationDialogProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export const AddLocationDialog = ({ open, onClose, onCreated }: AddLocationDialogProps) => {
  const [displayName, setDisplayName] = useState('')
  const [shortName, setShortName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slug = displayName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')

  const existingLocations = getAllLocations()
  const slugTaken = existingLocations.some((l) => l.slug === slug)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const name = displayName.trim()
    if (!name) {
      setError('Display name is required.')
      return
    }
    if (slugTaken) {
      setError(`A location with slug "${slug}" already exists.`)
      return
    }

    setSaving(true)
    setError(null)
    try {
      await asquareLocationsApi.createLocation(
        name,
        shortName.trim() || undefined,
        existingLocations,
      )
      // Reset form
      setDisplayName('')
      setShortName('')
      setError(null)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create location.')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    setDisplayName('')
    setShortName('')
    setError(null)
    onClose()
  }

  return (
    <ModalShell open={open} onClose={handleClose} maxWidth="max-w-md">
      <form onSubmit={(e) => void handleSubmit(e)} className="p-5">
        <h2 className="font-display text-lg font-bold text-text">Add New Location</h2>
        <p className="mt-1 text-xs text-muted">
          Create a new branch location. Activities and staff can be assigned after creation.
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="loc-display-name"
              className="block text-xs font-semibold uppercase tracking-widest text-muted"
            >
              Display Name *
            </label>
            <input
              id="loc-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="ui-field mt-1 min-h-10 w-full"
              placeholder="e.g. Srikakulam"
              required
            />
            {displayName.trim() && (
              <p className="mt-1 text-[11px] text-muted">
                Slug:{' '}
                <span className={`font-mono ${slugTaken ? 'text-critical' : 'text-text'}`}>
                  {slug}
                </span>
                {slugTaken && <span className="ml-1 text-critical">(already exists)</span>}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="loc-short-name"
              className="block text-xs font-semibold uppercase tracking-widest text-muted"
            >
              Short Name
            </label>
            <input
              id="loc-short-name"
              type="text"
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              className="ui-field mt-1 min-h-10 w-full"
              placeholder="e.g. Vjwd (optional, defaults to display name)"
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={handleClose} className="ui-btn min-h-9 px-4 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !displayName.trim() || slugTaken}
            className="ui-btn ui-btn-primary min-h-9 px-4 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Location'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
