import { useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  onSubmit: (payload: string) => void
  onCancel: () => void
}

/**
 * Replacement for the legacy `window.prompt('Scan payload or booking ID:')`
 * call. Native prompts can't be styled, can't be auto-focused for QR
 * scanners (which type into the focused input), can't be themed, and look
 * out of place in an audit-grade tool.
 *
 * The input is auto-focused on open so a USB QR scanner can dump its
 * payload straight in, and Enter submits without a mouse trip. Escape
 * cancels.
 */
export const ScanBoardingDialog = ({ open, onSubmit, onCancel }: Props) => {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setValue('')
      // setTimeout 0 — let the modal mount before grabbing focus.
      const t = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-base/68 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Scan boarding"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border/70 bg-panel p-5 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-2xl tracking-tight text-text">Scan boarding</h3>
        <p className="mt-1 text-sm text-muted">
          Scan the QR or paste the booking ID. The customer will be marked as boarded.
        </p>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="ASG… or QR payload"
          aria-label="Booking ID or scan payload"
          className="ui-field mt-4 min-h-11 w-full font-mono text-sm"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="ui-btn ui-btn-neutral min-h-9 px-3">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="ui-btn ui-btn-primary min-h-9 px-3 disabled:opacity-50"
          >
            Mark boarded
          </button>
        </div>
      </div>
    </div>
  )
}
