import { useState } from 'react'
import { ChevronRight, Plus, MoreVertical, Trash2 } from 'lucide-react'
import type { GameDraft, SubGameDraft } from './activity-draft-utils'
import type { BranchLocationKey } from '../../../api/types'

interface ActivitySidebarProps {
  locations: { id: BranchLocationKey; name: string }[]
  activeLocation: BranchLocationKey
  onLocationChange: (loc: BranchLocationKey) => void
  onAddLocation: () => void
  games: GameDraft[]
  selectedGameKey: string | null
  onSelectGame: (key: string) => void
  selectedSubGameKey: string | null
  onSelectSubGame: (gameKey: string, subGameKey: string) => void
  onAddGame: () => void
  onAddSubGame: (gameKey: string, name: string) => void
  onDeleteGame: (gameKey: string, gameName: string) => void
  onDeleteSubGame: (gameKey: string, subGameKey: string, subGameName: string) => void
  canManage: boolean
  isThirdParty: boolean
}

export const ActivitySidebar = ({
  locations,
  activeLocation,
  onLocationChange,
  onAddLocation,
  games,
  selectedGameKey,
  onSelectGame,
  selectedSubGameKey,
  onSelectSubGame,
  onAddGame,
  onAddSubGame,
  onDeleteGame,
  onDeleteSubGame,
  canManage,
  isThirdParty,
}: ActivitySidebarProps) => {
  const [expandedGames, setExpandedGames] = useState<Set<string>>(new Set())
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const [inlineAddForGame, setInlineAddForGame] = useState<string | null>(null)
  const [inlineName, setInlineName] = useState('')

  const toggleExpand = (key: string) => {
    setExpandedGames((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleGameClick = (key: string) => {
    onSelectGame(key)
    // Auto-expand when selecting
    setExpandedGames((prev) => new Set(prev).add(key))
  }

  const handleSubGameClick = (gameKey: string, subGameKey: string) => {
    onSelectSubGame(gameKey, subGameKey)
  }

  const handleInlineSubmit = (gameKey: string) => {
    const name = inlineName.trim()
    if (name) {
      onAddSubGame(gameKey, name)
    }
    setInlineAddForGame(null)
    setInlineName('')
  }

  return (
    <aside className="hidden w-72 shrink-0 lg:block">
      <div className="sticky top-4 space-y-3">
        {/* Location selector */}
        <div className="rounded-xl border border-border/45 bg-panel p-3 shadow-sm">
          <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Location
          </label>
          <div className="mt-1.5 flex gap-2">
            <select
              value={activeLocation}
              onChange={(e) => onLocationChange(e.target.value as BranchLocationKey)}
              className="ui-field min-h-9 w-full text-sm"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
            {canManage && (
              <button
                type="button"
                onClick={onAddLocation}
                className="ui-btn ui-btn-neutral min-h-9 px-2"
                title="Add location"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Game tree */}
        <nav
          className="rounded-xl border border-border/45 bg-panel shadow-sm"
          aria-label="Activity hierarchy"
        >
          <div className="max-h-[calc(100vh-240px)] overflow-y-auto p-2">
            {games.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted">No games yet</p>
            ) : (
              <ul className="space-y-0.5">
                {games.map((game) => {
                  const isExpanded = expandedGames.has(game.key)
                  const isSelected = selectedGameKey === game.key && !selectedSubGameKey

                  return (
                    <li key={game.key}>
                      {/* Game node */}
                      <div className="group relative flex items-center">
                        <button
                          type="button"
                          onClick={() => toggleExpand(game.key)}
                          className="flex h-8 w-6 shrink-0 items-center justify-center text-muted transition-colors hover:text-text"
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          <ChevronRight
                            className={`h-3.5 w-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGameClick(game.key)}
                          className={`flex min-h-8 flex-1 items-center rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors ${
                            isSelected
                              ? 'border border-accent/40 bg-accent/10 text-accent'
                              : 'text-text hover:bg-surface/60'
                          }`}
                        >
                          <span className="truncate">{game.name.trim() || 'Untitled Game'}</span>
                          {game.status === 'Inactive' && (
                            <span className="ml-auto shrink-0 rounded-full bg-muted/20 px-1.5 py-0.5 text-[9px] font-semibold text-muted">
                              OFF
                            </span>
                          )}
                        </button>

                        {/* Context menu trigger */}
                        {canManage && !isThirdParty && (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setMenuKey(menuKey === game.key ? null : game.key)
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted opacity-0 transition-all hover:bg-surface hover:text-text group-hover:opacity-100"
                              aria-label="Game options"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </button>
                            {menuKey === game.key && (
                              <div className="absolute right-0 top-8 z-30 w-36 rounded-lg border border-border bg-panel py-1 shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuKey(null)
                                    onDeleteGame(game.key, game.name)
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-critical hover:bg-critical/10"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Remove Game
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Sub-game children */}
                      {isExpanded && (
                        <ul className="ml-6 space-y-0.5 border-l border-border/30 pl-2">
                          {game.subGames.map((subGame: SubGameDraft) => {
                            const isSgSelected =
                              selectedGameKey === game.key && selectedSubGameKey === subGame.key

                            return (
                              <li key={subGame.key}>
                                <div className="group/sg relative flex items-center">
                                  <button
                                    type="button"
                                    onClick={() => handleSubGameClick(game.key, subGame.key)}
                                    className={`flex min-h-7 flex-1 items-center rounded-lg px-2.5 py-1 text-left text-[13px] transition-colors ${
                                      isSgSelected
                                        ? 'border border-info/30 bg-info/10 text-info'
                                        : 'text-text/80 hover:bg-surface/50 hover:text-text'
                                    }`}
                                  >
                                    <span className="truncate">
                                      {subGame.name.trim() || 'Untitled'}
                                    </span>
                                    <span className="ml-auto shrink-0 pl-2 text-[10px] text-muted">
                                      {subGame.variants.length}v
                                    </span>
                                  </button>
                                  {canManage && !isThirdParty && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onDeleteSubGame(game.key, subGame.key, subGame.name)
                                      }
                                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-all hover:text-critical group-hover/sg:opacity-100"
                                      title="Delete sub game"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              </li>
                            )
                          })}

                          {/* Inline add sub game */}
                          {canManage && !isThirdParty && (
                            <li>
                              {inlineAddForGame === game.key ? (
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault()
                                    handleInlineSubmit(game.key)
                                  }}
                                  className="flex items-center gap-1 px-1 py-1"
                                >
                                  <input
                                    type="text"
                                    value={inlineName}
                                    onChange={(e) => setInlineName(e.target.value)}
                                    placeholder="Sub game name..."
                                    className="ui-field min-h-7 flex-1 px-2 text-xs"
                                    // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus inline edit input on activation
                                    autoFocus
                                    onBlur={() => {
                                      if (!inlineName.trim()) {
                                        setInlineAddForGame(null)
                                        setInlineName('')
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        setInlineAddForGame(null)
                                        setInlineName('')
                                      }
                                    }}
                                  />
                                </form>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInlineAddForGame(game.key)
                                    setInlineName('')
                                  }}
                                  className="flex min-h-7 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-accent"
                                >
                                  <Plus className="h-3 w-3" />
                                  Sub Game
                                </button>
                              )}
                            </li>
                          )}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Add game button */}
          {canManage && !isThirdParty && (
            <div className="border-t border-border/30 p-2">
              <button
                type="button"
                onClick={onAddGame}
                className="flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border/50 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-accent/40 hover:text-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Game
              </button>
            </div>
          )}
        </nav>
      </div>
    </aside>
  )
}
