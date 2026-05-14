import { useEffect } from 'react'

/**
 * Daily Reports — single global keydown dispatcher.
 *
 * Multiple components used to bind their own `window.addEventListener('keydown', …)`
 * which raced and silently captured each other's keys (date stepper would jump
 * dates while the drawer was open, etc). This hook is the one place all global
 * shortcuts for the surface live.
 *
 * Suspends every shortcut (except `Escape`) when an overlay is active or focus
 * is in a text input — so a cashier typing in the comment composer can press
 * `R` without re-printing.
 */

export interface DailyReportsHotkeys {
  /** Step the date one day backward (←). */
  onPrevDay: () => void
  /** Step the date one day forward (→). */
  onNextDay: () => void
  /** Jump to today (T). */
  onToday: () => void
  /** Cycle the branch filter (B). */
  onCycleBranch: () => void
  /** Re-print the focused shift's Day Report (R). */
  onPrint: () => void
  /** Flag the focused shift (F). */
  onFlag: () => void
  /** Toggle the export menu (E). */
  onToggleExport: () => void
  /** Open the cheatsheet (?). */
  onOpenCheatsheet: () => void
  /** Close any open overlay (Escape). */
  onEscape: () => void
}

export interface HotkeyState {
  /** True while the right-side shift drawer is open. */
  drawerOpen: boolean
  /** True while the cheatsheet modal is open. */
  cheatsheetOpen: boolean
  /** True if the user can moderate (controls whether E is enabled). */
  canModerate: boolean
  /** True if a row is currently selected (so R/F have a target). */
  hasSelection: boolean
  /** True while a date is at today (disables → step). */
  atToday: boolean
}

const isTextLikeTarget = (target: EventTarget | null): boolean => {
  if (!target || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export const useDailyReportsHotkeys = (state: HotkeyState, handlers: DailyReportsHotkeys): void => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape always works — that's the global "get out" key.
      if (e.key === 'Escape') {
        handlers.onEscape()
        return
      }

      // Suspend everything else when typing.
      if (isTextLikeTarget(e.target)) return

      // Modifiers reserved for the OS / browser. We only handle bare keys.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // While an overlay is up, only the cheatsheet's `?` toggle is allowed.
      // Everything else stays inert so the open overlay can do its job.
      if (state.drawerOpen || state.cheatsheetOpen) {
        if (e.key === '?') {
          e.preventDefault()
          handlers.onOpenCheatsheet()
        }
        return
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          handlers.onPrevDay()
          return
        case 'ArrowRight':
          if (state.atToday) return
          e.preventDefault()
          handlers.onNextDay()
          return
        case 't':
        case 'T':
          e.preventDefault()
          handlers.onToday()
          return
        case 'b':
        case 'B':
          e.preventDefault()
          handlers.onCycleBranch()
          return
        case 'r':
        case 'R':
          if (!state.hasSelection) return
          e.preventDefault()
          handlers.onPrint()
          return
        case 'f':
        case 'F':
          if (!state.hasSelection) return
          e.preventDefault()
          handlers.onFlag()
          return
        case 'e':
        case 'E':
          if (!state.canModerate) return
          e.preventDefault()
          handlers.onToggleExport()
          return
        case '?':
          e.preventDefault()
          handlers.onOpenCheatsheet()
          return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    state.drawerOpen,
    state.cheatsheetOpen,
    state.canModerate,
    state.hasSelection,
    state.atToday,
    handlers,
  ])
}
