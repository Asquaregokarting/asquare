import type { AppPlatform } from '../../../../lib/platform'
import { DetailPanel } from '../../../components/ui/DetailPanel'
import type { GameDraft, SubGameDraft, VariantDraft } from './activity-draft-utils'
import { ALL_PLATFORMS } from './activity-draft-utils'
import { VariantTableEditor } from './VariantTableEditor'

interface SubGameDetailEditorProps {
  subGame: SubGameDraft
  gameName: string
  parentGame: GameDraft
  gameLocations: { id: string; name: string }[]
  onUpdateName: (name: string) => void
  onUpdateNotes: (notes: string) => void
  onUpdatePlatforms: (platforms: AppPlatform[]) => void
  onUpdateLocationKeys: (locationKeys: string[]) => void
  onUpdateInteraktTemplateId: (templateId: string) => void
  onUpdateInteraktTemplateLanguage: (lang: string) => void
  onUpdateVariant: (variantKey: string, updater: (v: VariantDraft) => VariantDraft) => void
  onDeleteVariant: (variantKey: string, variantLabel: string) => void
  onAddVariant: () => void
  canManage: boolean
  isThirdParty: boolean
}

export const SubGameDetailEditor = ({
  subGame,
  gameName,
  parentGame,
  gameLocations,
  onUpdateName,
  onUpdateNotes,
  onUpdatePlatforms,
  onUpdateLocationKeys,
  onUpdateInteraktTemplateId,
  onUpdateInteraktTemplateLanguage,
  onUpdateVariant,
  onDeleteVariant,
  onAddVariant,
  canManage,
  isThirdParty,
}: SubGameDetailEditorProps) => {
  const hasPlatformOverride = subGame.platforms.length > 0
  const hasLocationOverride = subGame.locationKeys.length > 0

  const effectivePlatforms = hasPlatformOverride ? subGame.platforms : parentGame.platforms
  const effectiveLocations = hasLocationOverride
    ? gameLocations.filter((l) => subGame.locationKeys.includes(l.id))
    : gameLocations

  return (
    <div className="ui-section-stack">
      {/* Sub game identity */}
      <DetailPanel title="Sub Game Details">
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Part of <span className="font-semibold text-text">{gameName}</span>
          </p>
          {isThirdParty ? (
            <div className="rounded-xl border border-border/60 bg-surface/35 p-3">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
                Name
              </p>
              <p className="mt-0.5 text-sm font-medium text-text">{subGame.name || '—'}</p>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={subGame.name}
                onChange={(e) => onUpdateName(e.target.value)}
                disabled={!canManage}
                placeholder="Sub game name"
                className="ui-field min-h-11 w-full"
              />
              <input
                type="text"
                value={subGame.notes}
                onChange={(e) => onUpdateNotes(e.target.value)}
                disabled={!canManage}
                placeholder="Notes (optional)"
                className="ui-field min-h-11 w-full"
              />
            </>
          )}
        </div>
      </DetailPanel>

      {/* Visibility overrides */}
      <DetailPanel title="Visibility">
        <div className="space-y-4">
          {/* Platform availability */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
                Platform Availability
              </p>
              {!isThirdParty && canManage && (
                <button
                  type="button"
                  onClick={() =>
                    hasPlatformOverride
                      ? onUpdatePlatforms([])
                      : onUpdatePlatforms([...parentGame.platforms])
                  }
                  className="text-[0.6rem] font-medium text-primary hover:underline"
                >
                  {hasPlatformOverride ? 'Reset to inherit' : 'Override'}
                </button>
              )}
            </div>

            {isThirdParty || !hasPlatformOverride ? (
              <p className="text-xs text-muted">
                {hasPlatformOverride
                  ? effectivePlatforms.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
                  : `Inheriting from ${gameName}: ${parentGame.platforms.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ') || 'None'}`}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-3">
                  {ALL_PLATFORMS.map((p) => (
                    <label
                      key={p}
                      className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-text"
                    >
                      <input
                        type="checkbox"
                        checked={subGame.platforms.includes(p)}
                        onChange={() =>
                          onUpdatePlatforms(
                            subGame.platforms.includes(p)
                              ? subGame.platforms.filter((x) => x !== p)
                              : [...subGame.platforms, p],
                          )
                        }
                        disabled={!canManage}
                        className="rounded border-border"
                      />
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </label>
                  ))}
                </div>
                {subGame.platforms.length === 0 && (
                  <p className="text-[0.6rem] text-warning">
                    No platforms selected — this sub-game will be hidden everywhere.
                  </p>
                )}
                {subGame.platforms.some((p) => !parentGame.platforms.includes(p)) && (
                  <p className="text-[0.6rem] text-warning">
                    Some platforms are not enabled on the parent game.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Location visibility */}
          {gameLocations.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
                  Location Visibility
                </p>
                {!isThirdParty && canManage && (
                  <button
                    type="button"
                    onClick={() =>
                      hasLocationOverride
                        ? onUpdateLocationKeys([])
                        : onUpdateLocationKeys(gameLocations.map((l) => l.id))
                    }
                    className="text-[0.6rem] font-medium text-primary hover:underline"
                  >
                    {hasLocationOverride ? 'Reset to inherit' : 'Override'}
                  </button>
                )}
              </div>

              {isThirdParty || !hasLocationOverride ? (
                <p className="text-xs text-muted">
                  {hasLocationOverride
                    ? effectiveLocations.map((l) => l.name).join(', ')
                    : `Available at all ${gameLocations.length} location${gameLocations.length !== 1 ? 's' : ''} with this game`}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-3">
                    {gameLocations.map((loc) => (
                      <label
                        key={loc.id}
                        className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-text"
                      >
                        <input
                          type="checkbox"
                          checked={subGame.locationKeys.includes(loc.id)}
                          onChange={() =>
                            onUpdateLocationKeys(
                              subGame.locationKeys.includes(loc.id)
                                ? subGame.locationKeys.filter((k) => k !== loc.id)
                                : [...subGame.locationKeys, loc.id],
                            )
                          }
                          disabled={!canManage}
                          className="rounded border-border"
                        />
                        {loc.name}
                      </label>
                    ))}
                  </div>
                  {subGame.locationKeys.length === 0 && (
                    <p className="text-[0.6rem] text-warning">
                      No locations selected — this sub-game will be hidden everywhere.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </DetailPanel>

      {/* Booking-confirmation Interakt template (per-sub-game override). */}
      {!isThirdParty && (
        <DetailPanel title="Booking Confirmation (WhatsApp)">
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Approved Interakt template used to send the WhatsApp booking confirmation for this
              sub-game. Leave blank to inherit the global default from{' '}
              <span className="font-semibold">Settings</span>.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
              <div>
                <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
                  Template ID
                </p>
                <input
                  type="text"
                  value={subGame.interaktTemplateId}
                  onChange={(e) => onUpdateInteraktTemplateId(e.target.value)}
                  disabled={!canManage}
                  placeholder="e.g. booking_confirm_pdf_util"
                  className="ui-field min-h-11 w-full font-mono text-sm"
                />
              </div>
              <div>
                <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
                  Language
                </p>
                <input
                  type="text"
                  value={subGame.interaktTemplateLanguage}
                  onChange={(e) => onUpdateInteraktTemplateLanguage(e.target.value)}
                  disabled={!canManage}
                  placeholder="en"
                  className="ui-field min-h-11 w-full font-mono text-sm"
                />
              </div>
            </div>
            {subGame.interaktTemplateId.trim() && !subGame.interaktTemplateLanguage.trim() && (
              <p className="text-[0.6rem] text-warning">
                Language is empty — the global default will be used.
              </p>
            )}
          </div>
        </DetailPanel>
      )}

      {/* Variant table — inline editing */}
      <DetailPanel title={`Variants (${subGame.variants.length})`}>
        {isThirdParty ? (
          <div className="space-y-2">
            {subGame.variants.map((v) => (
              <div
                key={v.key}
                className="flex items-center justify-between rounded-lg border border-border/40 bg-surface/30 px-3 py-2"
              >
                <span className="text-sm font-medium text-text">{v.label || 'Variant'}</span>
                <span className="text-sm text-muted">₹{v.price || '0'}</span>
              </div>
            ))}
          </div>
        ) : (
          <VariantTableEditor
            variants={subGame.variants}
            onUpdate={onUpdateVariant}
            onDelete={onDeleteVariant}
            onAdd={onAddVariant}
            disabled={!canManage}
            isCompanyGame={parentGame.gameType === 'our_game'}
          />
        )}
      </DetailPanel>
    </div>
  )
}
