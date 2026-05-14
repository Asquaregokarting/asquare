import { ReactNode, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ModalShellProps {
  open: boolean
  onClose: () => void
  maxWidth?: string
  children: ReactNode
}

export const ModalShell = ({ open, onClose, maxWidth = 'max-w-lg', children }: ModalShellProps) => {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Hold `onClose` in a ref so the Escape-listener effect doesn't re-bind
  // every time the parent passes a fresh callback. Re-binding caused the
  // dialog div to re-focus on every parent re-render, which yanked focus
  // out of inputs mid-keystroke and made the caret appear to jump back.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handler)
    // Focus the dialog only on the open transition so descendant inputs
    // keep focus across re-renders. autoFocus on a child still works
    // because that fires on the child's mount, after this runs.
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  if (!open) return null

  return createPortal(
    // Scrim: a tinted near-black at low opacity, theme-independent. Keeps
    // the sidebar + topbar visible behind every modal so the user never
    // loses navigational context. (`bg-base/X` was theme-swapping the
    // scrim — in light mode it became a near-white veil that hid the
    // sidebar entirely, which is what shipped before this fix.)
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-[#020617]/55 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-xl border border-border/70 bg-panel shadow-2xl focus:outline-none`}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
