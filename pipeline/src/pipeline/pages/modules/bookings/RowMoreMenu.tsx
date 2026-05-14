import { useEffect, useRef, useState } from 'react'

export interface MoreMenuItem {
  label: string
  onClick: () => void
  title?: string
  /** Optional flag for destructive items — they get a red text color. */
  danger?: boolean
}

interface Props {
  items: MoreMenuItem[]
  /** Optional ARIA label for screen readers / hover tooltip. */
  label?: string
}

/**
 * Small per-row overflow menu. Replaces the row's "wall of buttons" by
 * collapsing rarely-used actions (Resend, Swap, Web for helicopter, etc.)
 * into a single "More ▾" trigger. Items render as a vertical popover
 * anchored to the trigger; clicking outside closes it.
 *
 * Intentionally lightweight — no portal, no animation, no aria-haspopup
 * dance. The use case is a small list of 2–6 actions on an audit table
 * row; over-engineering it would be wasteful.
 */
export const RowMoreMenu = ({ items, label = 'More actions' }: Props) => {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-[11px]"
      >
        More ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-border/70 bg-panel py-1 shadow-panel"
        >
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              title={item.title}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs ${
                item.danger ? 'text-critical hover:bg-critical/10' : 'text-text hover:bg-surface'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
