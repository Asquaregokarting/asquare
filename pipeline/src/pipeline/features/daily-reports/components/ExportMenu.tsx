import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react'

interface ExportMenuProps {
  onExportCsv: () => void | Promise<void>
  /** Disabled (placeholder) for v1 — kept here so the menu reads complete. */
  onExportPdf?: () => void | Promise<void>
  disabled?: boolean
  count: number
  /** Optional controlled open state — allows the parent (e.g. an `E`
   * keyboard shortcut) to programmatically open the menu. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export const ExportMenu = ({
  onExportCsv,
  onExportPdf,
  disabled,
  count,
  open: openProp,
  onOpenChange,
}: ExportMenuProps) => {
  const [openInternal, setOpenInternal] = useState(false)
  const open = openProp ?? openInternal
  const setOpen = (value: boolean) => {
    onOpenChange?.(value)
    if (openProp === undefined) setOpenInternal(value)
  }
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-text/30 disabled:opacity-40"
        title="Export"
      >
        <Download className="h-3.5 w-3.5" />
        Export
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-border bg-panel p-1 shadow-panel"
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false)
              void onExportCsv()
            }}
            className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface"
          >
            <FileSpreadsheet className="mt-0.5 h-4 w-4 text-info" />
            <span>
              <span className="block text-sm font-semibold text-text">CSV ledger</span>
              <span className="block text-[11px] text-muted">
                {count} row{count === 1 ? '' : 's'} · all columns
              </span>
            </span>
          </button>
          {onExportPdf ? (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false)
                void onExportPdf()
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface"
            >
              <FileText className="mt-0.5 h-4 w-4 text-warning" />
              <span>
                <span className="block text-sm font-semibold text-text">PDF day report</span>
                <span className="block text-[11px] text-muted">
                  Per-shift Day Report · re-uses cashier print
                </span>
              </span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
