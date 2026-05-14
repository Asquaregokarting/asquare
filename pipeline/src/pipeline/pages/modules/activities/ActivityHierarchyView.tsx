import { useCallback, useMemo, useState } from 'react'
import { AsyncContent } from '../../../components/ui/AsyncContent'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { FeedbackBannerStack } from '../../../components/ui/FeedbackBanner'
import { SummaryCards } from '../../../components/ui/SummaryCards'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ModalShell } from '../../../components/ui/ModalShell'
import { useActivitiesEditor } from './useActivitiesEditor'
import { useAutoSave } from './useAutoSave'
import { isSaveable, type GameType } from './activity-draft-utils'
import { ActivitySidebar } from './ActivitySidebar'
import { GameDetailEditor } from './GameDetailEditor'
import { SubGameDetailEditor } from './SubGameDetailEditor'
import { SaveStatusBar } from './SaveStatusBar'
import { AddGameDialog } from './AddGameDialog'
import { ThirdPartyActivityView } from './ThirdPartyActivityView'

const ActivityHierarchyView = () => {
  const editor = useActivitiesEditor()
  const [showAddGame, setShowAddGame] = useState(false)
  const [showAddLocation, setShowAddLocation] = useState(false)
  const [newLocationName, setNewLocationName] = useState('')
  const [newLocationShortName, setNewLocationShortName] = useState('')

  // Wire auto-save
  const autoSave = useAutoSave({
    data: editor.currentDrafts,
    isSaveable: (drafts) => isSaveable(drafts),
    onSave: async (drafts) => {
      await editor.performSave(drafts)
    },
    debounceMs: 2000,
    enabled: editor.canManageActivities && !editor.loading,
  })

  // Flush before switching locations
  const handleLocationChange = useCallback(
    async (loc: string) => {
      await autoSave.flush()
      editor.setActiveLocation(loc as Parameters<typeof editor.setActiveLocation>[0])
    },
    [autoSave, editor],
  )

  // Game selection
  const handleSelectGame = useCallback(
    (key: string) => {
      editor.setSelectedGameKey(key)
      editor.setSelectedSubGameKey(null)
    },
    [editor],
  )

  const handleSelectSubGame = useCallback(
    (gameKey: string, subGameKey: string) => {
      editor.setSelectedGameKey(gameKey)
      editor.setSelectedSubGameKey(subGameKey)
    },
    [editor],
  )

  // Add game
  const handleAddGameSubmit = useCallback(
    (data: {
      name: string
      imageFiles: File[]
      imagePreviews: string[]
      gameType: GameType
      vendorUserId: string
      vendorName: string
      vendorBranchId: string
    }) => {
      editor.addGame({
        name: data.name,
        imageFiles: data.imageFiles,
        imagePreviews: data.imagePreviews,
        ...(data.gameType !== 'our_game'
          ? {
              gameType: data.gameType,
              vendorUserId: data.vendorUserId,
              vendorName: data.vendorName,
              vendorBranchId: data.vendorBranchId,
            }
          : {}),
      })
      setShowAddGame(false)
    },
    [editor],
  )

  // Delete handlers
  const handleDeleteGame = useCallback(
    (gameKey: string, gameName: string) => {
      editor.setConfirmDialog({
        title: 'Remove Game',
        description: `Remove "${gameName || 'Untitled Game'}" and all its sub games and variants from this location?`,
        confirmLabel: 'Remove',
        onConfirm: () => {
          editor.removeGame(gameKey)
          editor.setConfirmDialog(null)
        },
      })
    },
    [editor],
  )

  const handleDeleteSubGame = useCallback(
    (gameKey: string, subGameKey: string, subGameName: string) => {
      editor.setConfirmDialog({
        title: 'Delete Sub Game',
        description: `Are you sure you want to delete "${subGameName || 'Untitled Sub Game'}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        onConfirm: () => {
          editor.removeSubGame(gameKey, subGameKey)
          if (editor.selectedSubGameKey === subGameKey) {
            editor.setSelectedSubGameKey(null)
          }
          editor.setConfirmDialog(null)
        },
      })
    },
    [editor],
  )

  const handleDeleteVariant = useCallback(
    (variantKey: string, variantLabel: string) => {
      if (!editor.selectedGame || !editor.selectedSubGame) return
      const gameKey = editor.selectedGame.key
      const subGameKey = editor.selectedSubGame.key
      editor.setConfirmDialog({
        title: 'Delete Variant',
        description: `Are you sure you want to delete "${variantLabel}"?`,
        confirmLabel: 'Delete',
        onConfirm: () => {
          editor.removeVariant(gameKey, subGameKey, variantKey)
          editor.setConfirmDialog(null)
        },
      })
    },
    [editor],
  )

  // Add location
  const handleAddLocationSubmit = async () => {
    const name = newLocationName.trim()
    if (!name) return
    await editor.handleAddLocation(name, newLocationShortName.trim() || undefined)
    setShowAddLocation(false)
    setNewLocationName('')
    setNewLocationShortName('')
  }

  // Compute locations where the selected game exists (for sub-game location overrides).
  // Must be declared before any early return so the hook order is stable.
  const gameLocations = useMemo(() => {
    if (!editor.selectedGame) return []
    const gameName = editor.selectedGame.name.trim().toLowerCase()
    return editor.availableLocations.filter((loc) =>
      (editor.draftsByLocation[loc.id] ?? []).some((g) => g.name.trim().toLowerCase() === gameName),
    )
  }, [editor.selectedGame, editor.availableLocations, editor.draftsByLocation])

  // ThirdParty gets a separate view
  if (editor.isThirdParty) {
    return (
      <ThirdPartyActivityView
        games={editor.currentDrafts}
        locationName={editor.currentLocationName}
        locations={editor.availableLocations}
        activeLocation={editor.activeLocation}
        onLocationChange={(loc) => editor.setActiveLocation(loc)}
      />
    )
  }

  // Determine what to show in detail panel
  const renderDetailPanel = () => {
    if (!editor.selectedGame && editor.currentDrafts.length === 0) {
      return (
        <EmptyState
          title={`No games configured for ${editor.currentLocationName}`}
          description="Start with Add Game in the sidebar, then drill down into sub games and variants."
        />
      )
    }

    // If a sub-game is selected, show SubGameDetailEditor
    if (editor.selectedGame && editor.selectedSubGame) {
      return (
        <SubGameDetailEditor
          subGame={editor.selectedSubGame}
          gameName={editor.selectedGame.name}
          parentGame={editor.selectedGame}
          gameLocations={gameLocations}
          onUpdateName={(name) =>
            editor.updateSubGame(editor.selectedGame!.key, editor.selectedSubGame!.key, (sg) => ({
              ...sg,
              name,
            }))
          }
          onUpdateNotes={(notes) =>
            editor.updateSubGame(editor.selectedGame!.key, editor.selectedSubGame!.key, (sg) => ({
              ...sg,
              notes,
            }))
          }
          onUpdatePlatforms={(platforms) =>
            editor.updateSubGame(editor.selectedGame!.key, editor.selectedSubGame!.key, (sg) => ({
              ...sg,
              platforms,
            }))
          }
          onUpdateLocationKeys={(locationKeys) =>
            editor.updateSubGame(editor.selectedGame!.key, editor.selectedSubGame!.key, (sg) => ({
              ...sg,
              locationKeys,
            }))
          }
          onUpdateInteraktTemplateId={(interaktTemplateId) =>
            editor.updateSubGame(editor.selectedGame!.key, editor.selectedSubGame!.key, (sg) => ({
              ...sg,
              interaktTemplateId,
            }))
          }
          onUpdateInteraktTemplateLanguage={(interaktTemplateLanguage) =>
            editor.updateSubGame(editor.selectedGame!.key, editor.selectedSubGame!.key, (sg) => ({
              ...sg,
              interaktTemplateLanguage,
            }))
          }
          onUpdateVariant={(variantKey, updater) =>
            editor.updateVariant(
              editor.selectedGame!.key,
              editor.selectedSubGame!.key,
              variantKey,
              updater,
            )
          }
          onDeleteVariant={handleDeleteVariant}
          onAddVariant={() =>
            editor.addVariant(editor.selectedGame!.key, editor.selectedSubGame!.key)
          }
          canManage={editor.canManageActivities}
          isThirdParty={false}
        />
      )
    }

    // If a game is selected (but no sub-game), show GameDetailEditor
    if (editor.selectedGame) {
      return (
        <GameDetailEditor
          game={editor.selectedGame}
          onUpdate={(updater) => editor.updateGame(editor.selectedGame!.key, updater)}
          onRemove={() => handleDeleteGame(editor.selectedGame!.key, editor.selectedGame!.name)}
          onImageChange={(e) => void editor.handleImageChange(editor.selectedGame!.key, e)}
          onRemoveImage={(idx) => editor.removeGameImage(editor.selectedGame!.key, idx)}
          locations={editor.availableLocations}
          activeLocation={editor.activeLocation}
          draftsByLocation={editor.draftsByLocation}
          onToggleLocation={editor.toggleGameInLocation}
          canManage={editor.canManageActivities}
          isThirdParty={false}
          role={editor.role}
        />
      )
    }

    return (
      <EmptyState
        title="Select a game"
        description="Choose a game from the sidebar to start editing."
      />
    )
  }

  return (
    <div className="ui-section-stack">
      <FeedbackBannerStack error={editor.error} success={editor.success} />
      <SummaryCards items={editor.summaryItems} />

      <AsyncContent
        loading={editor.loading}
        error={null}
        isEmpty={false}
        emptyTitle=""
        emptyDescription=""
        loadingTitle="Loading Activity Hierarchy"
        loadingDescription="Fetching the activity catalog for this location."
        onRetry={() => void editor.loadHierarchy()}
      >
        {/* Main layout: Sidebar + Detail */}
        <div className="flex gap-5">
          <ActivitySidebar
            locations={editor.availableLocations}
            activeLocation={editor.activeLocation}
            onLocationChange={(loc) => void handleLocationChange(loc)}
            onAddLocation={() => setShowAddLocation(true)}
            games={editor.currentDrafts}
            selectedGameKey={editor.selectedGameKey}
            onSelectGame={handleSelectGame}
            selectedSubGameKey={editor.selectedSubGameKey}
            onSelectSubGame={handleSelectSubGame}
            onAddGame={() => setShowAddGame(true)}
            onAddSubGame={(gameKey, name) => editor.addSubGame(gameKey, name)}
            onDeleteGame={handleDeleteGame}
            onDeleteSubGame={handleDeleteSubGame}
            canManage={editor.canManageActivities}
            isThirdParty={false}
          />

          {/* Detail panel */}
          <div className="min-w-0 flex-1 space-y-3">
            <SaveStatusBar
              status={autoSave.status}
              error={autoSave.error}
              onRetry={autoSave.retry}
              onSave={() => void autoSave.flush()}
              canSave={editor.canManageActivities && isSaveable(editor.currentDrafts)}
            />
            {renderDetailPanel()}
          </div>
        </div>

        {/* Mobile: game pills (visible on < lg when sidebar is hidden) */}
        <div className="lg:hidden">
          <div className="ui-toolbar mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={editor.activeLocation}
                onChange={(e) => void handleLocationChange(e.target.value)}
                className="ui-field min-h-9 text-sm"
              >
                {editor.availableLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                Game
              </span>
              {editor.currentDrafts.map((game) => (
                <button
                  key={game.key}
                  type="button"
                  onClick={() => handleSelectGame(game.key)}
                  className={`ui-btn min-h-9 px-3 py-1.5 text-xs ${
                    editor.selectedGameKey === game.key ? 'ui-btn-info' : 'ui-btn-neutral'
                  }`}
                >
                  {game.name.trim() || 'Untitled'}
                </button>
              ))}
              {editor.canManageActivities && (
                <button
                  type="button"
                  onClick={() => setShowAddGame(true)}
                  className="ui-btn ui-btn-primary min-h-9 px-3 text-xs"
                >
                  + Add Game
                </button>
              )}
            </div>
          </div>
        </div>
      </AsyncContent>

      {/* Add Game Dialog */}
      <AddGameDialog
        open={showAddGame}
        onClose={() => setShowAddGame(false)}
        onSubmit={handleAddGameSubmit}
        approvedVendors={editor.approvedVendors}
        locationOptions={editor.locationOptions}
        canManage={editor.canManageActivities}
      />

      {/* Add Location Dialog */}
      <ModalShell
        open={showAddLocation}
        onClose={() => {
          setShowAddLocation(false)
          setNewLocationName('')
          setNewLocationShortName('')
        }}
        maxWidth="max-w-sm"
      >
        <div className="border-b border-border px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
            Add Location
          </p>
          <h3 className="mt-1 font-display text-lg tracking-tight text-text">
            Create New Branch Location
          </h3>
        </div>
        <div className="space-y-4 p-6">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              Location Name *
            </label>
            <input
              type="text"
              value={newLocationName}
              onChange={(e) => setNewLocationName(e.target.value)}
              placeholder="e.g. Srikakulam"
              className="ui-field min-h-11 w-full"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus first field on dialog open
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              Short Name (optional)
            </label>
            <input
              type="text"
              value={newLocationShortName}
              onChange={(e) => setNewLocationShortName(e.target.value)}
              placeholder="e.g. Srikakulam"
              className="ui-field min-h-11 w-full"
            />
            <p className="text-[11px] text-muted">Used as abbreviation in compact views.</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={() => {
              setShowAddLocation(false)
              setNewLocationName('')
              setNewLocationShortName('')
            }}
            className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleAddLocationSubmit()}
            disabled={!newLocationName.trim() || editor.saving}
            className="ui-btn ui-btn-primary min-h-10 px-4 text-sm"
          >
            {editor.saving ? 'Creating...' : 'Create Location'}
          </button>
        </div>
      </ModalShell>

      {/* Confirm dialog for destructive actions */}
      <ConfirmDialog
        open={!!editor.confirmDialog}
        title={editor.confirmDialog?.title ?? ''}
        description={editor.confirmDialog?.description ?? ''}
        confirmLabel={editor.confirmDialog?.confirmLabel ?? 'Confirm'}
        onConfirm={() => editor.confirmDialog?.onConfirm()}
        onCancel={() => editor.setConfirmDialog(null)}
      />
    </div>
  )
}

export default ActivityHierarchyView
