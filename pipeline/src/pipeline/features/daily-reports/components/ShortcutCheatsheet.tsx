import { useEffect } from 'react'
import { X } from 'lucide-react'

interface ShortcutCheatsheetProps {
  open: boolean
  onClose: () => void
}

const SHORTCUTS: Array<{ keys: string[]; action: string }> = [
  { keys: ['←'], action: 'Previous day' },
  { keys: ['→'], action: 'Next day' },
  { keys: ['T'], action: 'Jump to today' },
  { keys: ['B'], action: 'Cycle branch filter' },
  { keys: ['R'], action: 'Re-print focused shift' },
  { keys: ['F'], action: 'Flag focused shift' },
  { keys: ['E'], action: 'Open export menu' },
  { keys: ['Esc'], action: 'Close drawer / overlay' },
  { keys: ['?'], action: 'Show this cheatsheet' },
  { keys: ['⌘', '⏎'], action: 'Submit comment / flag' },
]

export const ShortcutCheatsheet = ({ open, onClose }: ShortcutCheatsheetProps) => {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-base/60 px-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-panel p-5 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <ul className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <li key={s.action} className="flex items-center justify-between text-sm">
              <span className="text-text">{s.action}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="dr-keycap">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
