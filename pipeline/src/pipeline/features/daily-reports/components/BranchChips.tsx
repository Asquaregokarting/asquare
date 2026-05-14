import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { BranchLocation } from '../../../../types'

interface BranchChipsProps {
  branches: BranchLocation[]
  selected: Set<string>
  /**
   * Pure setter: receives the desired final selection. Caller is responsible
   * for "all selected" vs "single select" semantics. We unify add/remove so
   * touch and pointer behave identically.
   */
  onChange: (next: Set<string>) => void
}

/**
 * Single-row chip filter. Same interaction on every device:
 *   • Tap a chip → single-select that branch.
 *   • Tap "All branches" → clear filter.
 *   • Tap a chip's × badge → remove from the current selection (lets you go
 *     from "Vizag + Kakinada" back to just "Vizag" without re-tapping all).
 *   • Tap the "+ Add" affordance after at least one branch is selected →
 *     opens a popover of remaining branches; tap any to add to the filter.
 *
 * Cmd/Ctrl-click still adds a branch on desktop for power users. Long-press
 * was rejected in favour of the explicit + affordance: it's discoverable on
 * touch, doesn't fight scroll gestures, and reads symmetric across devices.
 */
export const BranchChips = ({ branches, selected, onChange }: BranchChipsProps) => {
  const allActive = selected.size === 0 || selected.size === branches.length
  const visibleSelection = allActive ? new Set<string>() : selected
  const remaining = branches.filter((b) => !visibleSelection.has(b.slug))
  const [adderOpen, setAdderOpen] = useState(false)

  const setSingle = (slug: string) => onChange(new Set([slug]))
  const addOne = (slug: string) => {
    const next = new Set(visibleSelection)
    next.add(slug)
    onChange(next)
    setAdderOpen(false)
  }
  const removeOne = (slug: string) => {
    const next = new Set(visibleSelection)
    next.delete(slug)
    onChange(next)
  }
  const clearAll = () => onChange(new Set())

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className="dr-chip"
        data-active={allActive ? 'true' : 'false'}
        onClick={clearAll}
        title="All branches · click to reset filter"
      >
        All branches
      </button>

      {/* Active chips first (selected branches), shown with a remove badge. */}
      {[...visibleSelection].map((slug) => {
        const branch = branches.find((b) => b.slug === slug)
        if (!branch) return null
        return (
          <span key={branch.slug} className="dr-chip dr-chip-active" data-active="true">
            <button
              type="button"
              onClick={() => setSingle(branch.slug)}
              className="-mx-1 px-1 outline-none"
              title={`${branch.displayName} · click to view this branch only`}
            >
              {branch.shortName}
            </button>
            {visibleSelection.size > 1 ? (
              <button
                type="button"
                onClick={() => removeOne(branch.slug)}
                aria-label={`Remove ${branch.displayName}`}
                className="grid h-4 w-4 place-items-center rounded-full text-current/70 hover:text-current"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </span>
        )
      })}

      {/* Inactive chips: tap-to-single-select, Cmd/Ctrl-click to add. */}
      {(allActive ? branches : []).map((branch) => (
        <button
          key={branch.slug}
          type="button"
          className="dr-chip"
          data-active="false"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              addOne(branch.slug)
            } else {
              setSingle(branch.slug)
            }
          }}
          title={`${branch.displayName} · ⌘-click to add to multi-filter`}
        >
          {branch.shortName}
        </button>
      ))}

      {/* + Add another, only when at least one branch is already selected
          and there's at least one remaining branch to add. */}
      {!allActive && remaining.length > 0 ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setAdderOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={adderOpen}
            className="dr-chip dr-chip-add"
            title="Add another branch to the filter"
          >
            <Plus className="h-3 w-3" />
            <span>Add</span>
          </button>
          {adderOpen ? (
            <div
              role="menu"
              className="absolute left-0 top-full z-30 mt-1 min-w-[140px] rounded-lg border border-border bg-panel p-1 shadow-panel"
            >
              {remaining.map((branch) => (
                <button
                  key={branch.slug}
                  type="button"
                  role="menuitem"
                  onClick={() => addOne(branch.slug)}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-[12px] text-text transition-colors hover:bg-surface"
                >
                  {branch.displayName}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
