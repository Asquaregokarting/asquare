import { ChangeEvent } from 'react'
import { Trash2, Upload } from 'lucide-react'
import { DetailPanel } from '../../../components/ui/DetailPanel'
import type { GameDraft } from './activity-draft-utils'
import { ALL_PLATFORMS, countNonEmptyLines } from './activity-draft-utils'
import { LocationAssignmentPanel } from './LocationAssignmentPanel'
import type { BranchLocationKey } from '../../../api/types'

interface GameDetailEditorProps {
  game: GameDraft
  onUpdate: (updater: (g: GameDraft) => GameDraft) => void
  onRemove: () => void
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void
  onRemoveImage: (index: number) => void
  // Location assignment
  locations: { id: BranchLocationKey; name: string }[]
  activeLocation: BranchLocationKey
  draftsByLocation: Record<string, GameDraft[]>
  onToggleLocation: (locationId: string) => void
  canManage: boolean
  isThirdParty: boolean
  role?: string
}

export const GameDetailEditor = ({
  game,
  onUpdate,
  onRemove,
  onImageChange,
  onRemoveImage,
  locations,
  activeLocation,
  draftsByLocation,
  onToggleLocation,
  canManage,
  isThirdParty,
  role: _role,
}: GameDetailEditorProps) => {
  if (isThirdParty) {
    return (
      <DetailPanel title="Game Details">
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-surface/35 p-3">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
              Game Name
            </p>
            <p className="mt-0.5 text-sm font-medium text-text">{game.name || '—'}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-surface/35 p-3">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
                Status
              </p>
              <p className="mt-0.5 text-sm font-medium text-text">{game.status}</p>
            </div>
            {game.vendorBranchId && (
              <div className="rounded-xl border border-border/60 bg-surface/35 p-3">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
                  Branch
                </p>
                <p className="mt-0.5 text-sm font-medium text-text">
                  {locations.find((l) => l.id === game.vendorBranchId)?.name ?? game.vendorBranchId}
                </p>
              </div>
            )}
          </div>
          {game.imagePreviews.length > 0 && (
            <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-xl border border-border/50">
              {game.imagePreviews.map((src, idx) => (
                <img
                  key={idx}
                  src={src}
                  alt={`${game.name || 'Game'} ${idx + 1}`}
                  className={`${game.imagePreviews.length === 1 ? 'col-span-2 h-48' : 'h-28'} w-full object-cover`}
                />
              ))}
            </div>
          )}
        </div>
      </DetailPanel>
    )
  }

  return (
    <div className="ui-section-stack">
      {/* Game Identity */}
      <DetailPanel title="Game Details">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px),1fr]">
          {/* Image preview */}
          <div className="relative overflow-hidden rounded-xl border border-border/50 bg-panel">
            {game.imagePreviews.length > 0 ? (
              <div className="grid grid-cols-2 gap-1">
                {game.imagePreviews.map((src, idx) => (
                  <div key={idx} className="group/img relative">
                    <img
                      src={src}
                      alt={`${game.name || 'Game'} ${idx + 1}`}
                      className={`${game.imagePreviews.length === 1 ? 'col-span-2 h-48' : 'h-28'} w-full object-cover`}
                    />
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => onRemoveImage(idx)}
                        className="absolute right-1 top-1 hidden rounded-full bg-critical/80 p-0.5 text-white group-hover/img:block"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center bg-[radial-gradient(circle_at_top,#c7d2fe_0%,transparent_45%),linear-gradient(135deg,#111827,#1f2937)] text-sm font-semibold uppercase tracking-[0.18em] text-white/70">
                Game Cover
              </div>
            )}
          </div>

          {/* Game fields */}
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="text"
                value={game.name}
                onChange={(e) => onUpdate((g) => ({ ...g, name: e.target.value }))}
                disabled={!canManage}
                placeholder="Game Name"
                className="ui-field min-h-11 w-full"
              />
              <select
                value={game.status}
                onChange={(e) =>
                  onUpdate((g) => ({
                    ...g,
                    status: e.target.value as GameDraft['status'],
                  }))
                }
                disabled={!canManage}
                className="ui-field min-h-11 w-full"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            {/* Platform availability */}
            <div className="space-y-1.5">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
                Platform Availability
              </p>
              <div className="flex flex-wrap gap-3">
                {ALL_PLATFORMS.map((p) => (
                  <label
                    key={p}
                    className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-text"
                  >
                    <input
                      type="checkbox"
                      checked={game.platforms.includes(p)}
                      onChange={() =>
                        onUpdate((g) => ({
                          ...g,
                          platforms: g.platforms.includes(p)
                            ? g.platforms.filter((x) => x !== p)
                            : [...g.platforms, p],
                        }))
                      }
                      disabled={!canManage}
                      className="rounded border-border"
                    />
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </label>
                ))}
              </div>
              {game.platforms.length === 0 && (
                <p className="text-[0.6rem] text-warning">
                  No platforms selected — this game will be hidden everywhere.
                </p>
              )}
            </div>

            {/* Vendor badge */}
            {(game.gameType === 'vendor_game' || game.gameType === 'sub_lease') && (
              <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2">
                <span className="text-xs font-semibold text-info">
                  {game.gameType === 'sub_lease' ? 'Sub Lease' : 'Vendor Game'}
                </span>
                <span className="text-xs text-muted">— {game.vendorName}</span>
              </div>
            )}

            {/* Image upload */}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/50 px-3 py-2.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent">
              <Upload className="h-4 w-4" />
              Upload Images
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={onImageChange}
                disabled={!canManage}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </DetailPanel>

      {/* Descriptions */}
      <DetailPanel title="Descriptions">
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              Short Description
            </label>
            <input
              type="text"
              value={game.shortDescription}
              onChange={(e) => onUpdate((g) => ({ ...g, shortDescription: e.target.value }))}
              disabled={!canManage}
              placeholder="One-line summary"
              className="ui-field min-h-11 w-full"
            />
            <p
              className={`mt-1 text-xs ${game.shortDescription.length > 150 ? 'text-warning' : 'text-muted'}`}
            >
              {game.shortDescription.length}/150 characters
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              Long Description
            </label>
            <textarea
              value={game.longDescription}
              onChange={(e) => onUpdate((g) => ({ ...g, longDescription: e.target.value }))}
              disabled={!canManage}
              placeholder={
                "Describe this game in 3-4 lines. Include:\n\u2022 What the activity is\n\u2022 Who it's for\n\u2022 Safety info\n\u2022 What to expect"
              }
              className="ui-field min-h-[160px] w-full resize-y py-3"
            />
            {(() => {
              const lineCount = countNonEmptyLines(game.longDescription)
              const colorClass =
                lineCount >= 3 ? 'text-success' : lineCount > 0 ? 'text-warning' : 'text-muted'
              return (
                <div className="mt-1.5 flex items-center justify-between">
                  <p className={`text-xs ${colorClass}`}>
                    {lineCount}/4 lines{' '}
                    {lineCount >= 3 ? '\u2713' : lineCount > 0 ? '(minimum 3 lines)' : ''}
                  </p>
                  <p className="text-xs text-muted">{game.longDescription.length} characters</p>
                </div>
              )
            })()}
          </div>
        </div>
      </DetailPanel>

      {/* Location assignment */}
      <LocationAssignmentPanel
        game={game}
        locations={locations}
        activeLocation={activeLocation}
        draftsByLocation={draftsByLocation}
        onToggle={onToggleLocation}
        canManage={canManage}
      />

      {/* Danger zone */}
      <DetailPanel title="Danger Zone">
        <button
          type="button"
          onClick={onRemove}
          disabled={!canManage}
          className="ui-btn ui-btn-danger min-h-10 px-4 text-sm"
        >
          Remove Game
        </button>
      </DetailPanel>
    </div>
  )
}
