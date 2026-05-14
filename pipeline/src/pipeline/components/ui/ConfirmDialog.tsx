import { ReactNode } from 'react'

export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) => {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-base/68 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border/70 bg-panel p-4 shadow-panel">
        <h3 className="font-display text-2xl tracking-tight text-text">{title}</h3>
        <div className="mt-2 text-sm text-muted">{description}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="ui-btn ui-btn-neutral">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="ui-btn ui-btn-danger">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
