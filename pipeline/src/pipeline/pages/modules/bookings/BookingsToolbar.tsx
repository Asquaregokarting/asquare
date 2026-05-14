import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
} from 'react'

export interface ToolbarMoreItem {
  label: string
  onClick: () => void
  title?: string
}

interface Branch {
  id: string
  name: string
}

interface Props {
  branches: Branch[]
  activeBranch: string
  onBranchChange: (id: string) => void
  dateFrom: string
  dateTo: string
  onDateFromChange: (v: string) => void
  onDateToChange: (v: string) => void
  searchTerm: string
  onSearchChange: (v: string) => void
  onRefresh: () => void
  exportingExcel: boolean
  onExportCsv: () => void
  onExportExcel: () => void
  moreActions: ToolbarMoreItem[]
}

/**
 * Top workbench row for Manage Bookings. Branch picker + date range +
 * search take the bulk of the row; refresh / export / overflow live on
 * the right. Replaces the prior cluster of six colored buttons (Scan,
 * Refresh, Swaps, Availability, CSV, Excel) plus the standalone branch
 * tabs row, collapsing them into one calm horizontal toolbar.
 *
 * Color usage stays restrained: only Export gets the accent tint as the
 * Owner's primary takeaway action; Refresh and More are neutral.
 */
const Disclosure = ({ trigger, children }: { trigger: ReactNode; children: ReactNode }) => {
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

  // Trigger is always a real <button> from the consumer; we attach the
  // toggle by cloning it instead of wrapping in a click-catching <span>,
  // which would either double up the click target or require fake-button
  // a11y on a non-interactive element.
  const toggle = () => setOpen((v) => !v)
  const trig = isValidElement(trigger)
    ? cloneElement(
        trigger as ReactElement<{
          onClick?: MouseEventHandler
          'aria-expanded'?: boolean
        }>,
        {
          onClick: toggle,
          'aria-expanded': open,
        },
      )
    : trigger

  return (
    <div ref={wrapRef} className="relative inline-block">
      {trig}
      {open && (
        <div
          role="menu"
          tabIndex={-1}
          className="absolute right-0 top-full z-30 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-border/70 bg-panel py-1 shadow-panel"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export const BookingsToolbar = ({
  branches,
  activeBranch,
  onBranchChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  searchTerm,
  onSearchChange,
  onRefresh,
  exportingExcel,
  onExportCsv,
  onExportExcel,
  moreActions,
}: Props) => {
  const branchLabel =
    activeBranch === 'all'
      ? 'All branches'
      : (branches.find((b) => b.id === activeBranch)?.name ?? 'Branch')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Disclosure
        trigger={
          <button
            type="button"
            aria-haspopup="menu"
            className="ui-btn ui-btn-neutral min-h-9 px-3 py-1.5 text-xs"
            title="Filter by branch"
          >
            {branchLabel}{' '}
            <span aria-hidden className="ml-1 text-muted">
              ▾
            </span>
          </button>
        }
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => onBranchChange('all')}
          className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-surface ${
            activeBranch === 'all' ? 'text-info font-semibold' : 'text-text'
          }`}
        >
          All branches
        </button>
        {branches.map((b) => (
          <button
            key={b.id}
            type="button"
            role="menuitem"
            onClick={() => onBranchChange(b.id)}
            className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-surface ${
              activeBranch === b.id ? 'text-info font-semibold' : 'text-text'
            }`}
          >
            {b.name}
          </button>
        ))}
      </Disclosure>

      <div className="inline-flex items-center gap-1 rounded-lg border border-border/55 bg-panel px-2 py-1">
        <label
          className="text-[11px] uppercase tracking-[0.08em] text-muted"
          htmlFor="bk-date-from"
        >
          From
        </label>
        <input
          id="bk-date-from"
          type="date"
          value={dateFrom}
          onChange={(e) => onDateFromChange(e.target.value)}
          className="border-0 bg-transparent p-0 text-xs text-text focus-visible:ring-0"
          title="From date"
        />
        <span className="text-muted" aria-hidden>
          →
        </span>
        <label className="text-[11px] uppercase tracking-[0.08em] text-muted" htmlFor="bk-date-to">
          To
        </label>
        <input
          id="bk-date-to"
          type="date"
          value={dateTo}
          onChange={(e) => onDateToChange(e.target.value)}
          className="border-0 bg-transparent p-0 text-xs text-text focus-visible:ring-0"
          title="To date"
        />
      </div>

      <div className="relative flex-1 min-w-[220px]">
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search ID, name, phone, game, amount…"
          aria-label="Search bookings"
          className="ui-field min-h-9 w-full pl-8 text-sm"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
        >
          ⌕
        </span>
      </div>

      <button
        type="button"
        onClick={onRefresh}
        title="Refresh bookings"
        aria-label="Refresh"
        className="ui-btn ui-btn-neutral min-h-9 px-2.5 py-1.5 text-base"
      >
        ↻
      </button>

      <Disclosure
        trigger={
          <button
            type="button"
            aria-haspopup="menu"
            disabled={exportingExcel}
            className="ui-btn ui-btn-primary min-h-9 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exportingExcel ? 'Exporting…' : 'Export'}{' '}
            <span aria-hidden className="ml-1">
              ▾
            </span>
          </button>
        }
      >
        <button
          type="button"
          role="menuitem"
          onClick={onExportExcel}
          className="block w-full px-3 py-1.5 text-left text-xs text-text hover:bg-surface"
          title="Full booking details with per-vendor revenue split"
        >
          Excel (full detail)
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={onExportCsv}
          className="block w-full px-3 py-1.5 text-left text-xs text-text hover:bg-surface"
        >
          CSV (summary)
        </button>
      </Disclosure>

      {moreActions.length > 0 && (
        <Disclosure
          trigger={
            <button
              type="button"
              aria-haspopup="menu"
              aria-label="More actions"
              className="ui-btn ui-btn-neutral min-h-9 px-3 py-1.5 text-xs"
            >
              More{' '}
              <span aria-hidden className="ml-1">
                ▾
              </span>
            </button>
          }
        >
          {moreActions.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              title={item.title}
              onClick={item.onClick}
              className="block w-full px-3 py-1.5 text-left text-xs text-text hover:bg-surface"
            >
              {item.label}
            </button>
          ))}
        </Disclosure>
      )}
    </div>
  )
}

export default BookingsToolbar
