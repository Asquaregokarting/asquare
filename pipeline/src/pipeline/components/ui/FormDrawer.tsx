import { ReactNode } from 'react'

export const FormDrawer = ({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) => {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-base/65">
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-border/70 bg-panel p-4 shadow-panel">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-2xl tracking-tight text-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-neutral min-h-8 px-2.5 py-1 text-xs"
          >
            Close
          </button>
        </div>
        {children}
      </aside>
    </div>
  )
}
